import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  createOrder,
  getFullOrder,
  getEmployeeDisplayName,
  getServiceById,
  getServiceEmails,
  getServiceNameById,
  getBudgetSettingsByServiceId,
  DEFAULT_SERVICE_PCT,
  getUserRoles,
  listServicesByUser,
  getUserById,
  db,
} from "../db.js";
import { generateRemitoPDFBuffer } from "../utils/remitoPdf.js";
import { sendMail } from "../utils/mailer.js";

const router = Router();

/* ===== Helpers ===== */
const pad7 = (n) => String(n ?? "").padStart(7, "0");

const money = (v) => {
  const n = Number(v || 0);
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
    }).format(n);
  } catch {
    return `$ ${n.toFixed(2)}`;
  }
};

// Convierte fecha SQLite local a ISO válido (FIX Invalid Date)
function sqlLocalToISO(sqlTs) {
  if (!sqlTs) return new Date().toISOString();
  try {
    const base = String(sqlTs).replace(" ", "T");
    const d = new Date(base + "-03:00"); // Argentina
    if (Number.isNaN(d.getTime())) return new Date().toISOString();
    return d.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function primaryRole(userId) {
  const roles = (getUserRoles(userId) || []).map((r) =>
    String(r).toLowerCase()
  );
  if (roles.includes("supervisor")) return "supervisor";
  if (roles.includes("administrativo") || roles.includes("admin"))
    return "administrativo";
  return roles[0] || "administrativo";
}

function normalizeRoleName(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "supervisor") return "supervisor";
  if (s === "administrativo" || s === "admin") return "administrativo";
  return null;
}

function resolveServiceName(servicioId, hintedName) {
  if (hintedName && String(hintedName).trim()) return String(hintedName).trim();
  const sid = String(servicioId ?? "").trim();
  if (!sid) return "—";
  return getServiceNameById(sid) || getServiceById(sid)?.name || "—";
}

/* ===== Rutas ===== */

router.post("/", requireAuth, async (req, res) => {
  try {
    const empleadoId = req.user.id;

    const asRoleClient = normalizeRoleName(
      req.body?.asRole ?? req.body?.rol
    );
    const rolEfectivo = asRoleClient || primaryRole(empleadoId);

    let { servicioId = null, nota = "", items } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Faltan items" });
    }

    if (rolEfectivo === "supervisor") {
      if (!servicioId) {
        const mios = listServicesByUser(empleadoId);
        if (Array.isArray(mios) && mios.length === 1) {
          servicioId = mios[0].id;
        }
      }
      if (!servicioId) {
        return res.status(400).json({
          error: "servicioId es requerido para pedidos de supervisor",
        });
      }
    } else {
      servicioId = null;
    }

    let budgetSettings = { budget: null, maxPct: DEFAULT_SERVICE_PCT };
    let maxTotalAllowed = null;

    if (rolEfectivo === "supervisor" && servicioId) {
      budgetSettings =
        getBudgetSettingsByServiceId(servicioId) || budgetSettings;
      if (budgetSettings?.budget > 0) {
        const pct = Number(budgetSettings.maxPct ?? DEFAULT_SERVICE_PCT);
        if (Number.isFinite(pct) && pct > 0) {
          maxTotalAllowed = (budgetSettings.budget * pct) / 100;
        }
      }
    }

    let pedidoId;
    try {
      pedidoId = createOrder({
        empleadoId,
        servicioId,
        nota,
        items,
        maxTotalAllowed,
      });
    } catch (err) {
      if (err?.message === "ORDER_OVER_LIMIT") {
        const pct = Number(budgetSettings.maxPct ?? DEFAULT_SERVICE_PCT);
        return res.status(400).json({
          error: `El pedido excede el ${pct}% del presupuesto del servicio`,
        });
      }
      throw err;
    }

    db.prepare(`UPDATE Pedidos SET Rol = ? WHERE PedidoID = ?`).run(
      rolEfectivo,
      Number(pedidoId)
    );

    const pedido = getFullOrder(pedidoId);
    if (!pedido)
      return res.status(500).json({ error: "No se pudo recuperar el pedido" });

    const nro = pad7(pedidoId);
    const empleadoNombre =
      getEmployeeDisplayName(empleadoId) || `Empleado ${empleadoId}`;
    const usuario = pedido.user || getUserById(empleadoId);
    const rol = rolEfectivo;

    const sid =
      rol === "supervisor"
        ? String(pedido.ServicioID ?? servicioId ?? "").trim()
        : "";

    const serviceName =
      rol === "supervisor"
        ? resolveServiceName(sid, pedido?.servicio?.name)
        : "";

    const total = Number(pedido.Total || 0);
    const notaFinal = String(nota || pedido.Nota || "—");

    /* ===== PDF ===== */
    const pedidoParaPdf = {
      ...pedido,
      rol,
      servicio:
        rol === "supervisor"
          ? { id: sid || null, name: serviceName }
          : null,
    };

    let buffer = null;
    let filename = `remito_${nro}.pdf`;

    try {
      const out = await generateRemitoPDFBuffer({ pedido: pedidoParaPdf });
      buffer = out.buffer;
      filename = out.filename || filename;
    } catch (e) {
      console.warn("[orders] No se pudo generar PDF:", e?.message);
    }

    /* ===== MAIL ===== */
    let mailStatus = { sent: false, skipped: true };

    try {
      const toArr =
        rol === "supervisor" && sid ? getServiceEmails(sid) || [] : [];

      const info = await sendMail({
        to: toArr.length ? toArr.join(",") : undefined,
        subject: `NUEVO PEDIDO DE INSUMOS #${nro}`,
        text: `Pedido #${nro} generado.`,
        attachments: buffer
          ? [
              {
                filename,
                content: buffer,
                contentType: "application/pdf",
              },
            ]
          : undefined,
        displayAsUser: true,
        userName: empleadoNombre,
        userEmail: usuario?.email || null,
      });

      mailStatus = { sent: true, messageId: info?.messageId };
    } catch (e) {
      mailStatus = { sent: false, error: e?.message };
    }

    /* ===== RESPUESTA FINAL (FIX) ===== */
    const pdfUrl = `/orders/pdf/${pedidoId}`;

    const remito = {
      numero: nro,
      fecha: sqlLocalToISO(pedido.Fecha),
      empleado: empleadoNombre,
      total,
      nota: notaFinal,
      pdfUrl,
      servicio:
        rol === "supervisor"
          ? { id: sid || null, name: serviceName }
          : null,
    };

    return res.status(201).json({
      ok: true,
      pedidoId,
      remito,
      rol: rolEfectivo,
      mail: mailStatus,
    });
  } catch (e) {
    console.error("[orders] POST / error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
});

router.get("/pdf/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const pedido = getFullOrder(id);
  if (!pedido) return res.status(404).end();

  try {
    const rol = String(pedido.Rol || "").toLowerCase();
    const sid =
      rol === "supervisor" ? String(pedido.ServicioID ?? "").trim() : "";

    const serviceName =
      rol === "supervisor"
        ? resolveServiceName(sid, pedido?.servicio?.name)
        : "";

    const pedidoParaPdf = {
      ...pedido,
      rol,
      servicio:
        rol === "supervisor"
          ? { id: sid || null, name: serviceName }
          : null,
    };

    const { filename, buffer } =
      await generateRemitoPDFBuffer({ pedido: pedidoParaPdf });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    return res.send(buffer);
  } catch (e) {
    return res.status(500).json({ error: "No se pudo generar el PDF" });
  }
});

export default router;
