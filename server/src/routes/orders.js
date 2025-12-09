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
import { generateRemitoPDFBuffer } from "../utils/remitoPdf.js"; // PDF en memoria
import { sendMail } from "../utils/mailer.js";

const router = Router();

/* ===== Helpers ===== */
const pad7 = (n) => String(n ?? "").padStart(7, "0");
const money = (v) => {
  const n = Number(v || 0);
  try { return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n); }
  catch { return `$ ${n.toFixed(2)}`; }
};
function fmtLocal(sqlTs) {
  if (!sqlTs) return "";
  try {
    // DB guarda hora local, la interpretamos como Argentina (-03:00)
    const base = String(sqlTs).replace(" ", "T");
    const d = new Date(base + "-03:00");
    return d.toLocaleString("es-AR", {
      timeZone: "America/Argentina/Cordoba",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return String(sqlTs);
  }
}


function primaryRole(userId) {
  const roles = (getUserRoles(userId) || []).map(r => String(r).toLowerCase());
  if (roles.includes("supervisor")) return "supervisor";
  if (roles.includes("administrativo") || roles.includes("admin")) return "administrativo";
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

    // del front puede venir asRole o rol
    const asRoleClient = normalizeRoleName(req.body?.asRole ?? req.body?.rol);
    const rolEfectivo = asRoleClient || primaryRole(empleadoId);

    // payload base
    let { servicioId = null, nota = "", items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Faltan items" });
    }

    // Reglas por rol: supervisor requiere servicio; administrativo NO lleva servicio
    if (rolEfectivo === "supervisor") {
      // Si no vino servicioId, y el usuario tiene exactamente 1 asignado, usarlo
      if (servicioId == null || String(servicioId).trim() === "") {
        const mios = listServicesByUser(empleadoId);
        if (Array.isArray(mios) && mios.length === 1) {
          servicioId = mios[0].id;
        }
      }
      // A esta altura, si sigue faltando, es error
      if (servicioId == null || String(servicioId).trim() === "") {
        return res.status(400).json({ error: "servicioId es requerido para pedidos de supervisor" });
      }
    } else {
      // administrativo: forzar sin servicio
      servicioId = null;
    }
    let budgetSettings = { budget: null, maxPct: DEFAULT_SERVICE_PCT };
    let maxTotalAllowed = null;
    if (rolEfectivo === "supervisor" && servicioId != null && String(servicioId).trim() !== "") {
      budgetSettings = getBudgetSettingsByServiceId(servicioId) || budgetSettings;
      if (budgetSettings?.budget && Number(budgetSettings.budget) > 0) {
        const pct = Number(budgetSettings.maxPct ?? DEFAULT_SERVICE_PCT);
        if (Number.isFinite(pct) && pct > 0) {
          maxTotalAllowed = (Number(budgetSettings.budget) * pct) / 100;
        }
      }
    }
    // Crear pedido
   let pedidoId = null;
    try {
      pedidoId = createOrder({ empleadoId, servicioId, nota, items, maxTotalAllowed });
    } catch (err) {
      if (err?.code === "ORDER_OVER_LIMIT" || err?.message === "ORDER_OVER_LIMIT") {
        const pct = Number(budgetSettings?.maxPct ?? DEFAULT_SERVICE_PCT);
        const pctMsg = Number.isFinite(pct) ? pct : DEFAULT_SERVICE_PCT;
        return res.status(400).json({
          error: `El pedido excede el ${pctMsg}% del presupuesto del servicio`,
        });
      }
      throw err;
    }
    // Guardar el rol explícitamente en la fila creada
    db.prepare(`UPDATE Pedidos SET Rol = ? WHERE PedidoID = ?`).run(rolEfectivo, Number(pedidoId));

    // Leer el pedido persistido
    const pedido = getFullOrder(pedidoId);
    if (!pedido) return res.status(500).json({ error: "No se pudo recuperar el pedido" });

    // Datos base
    const nro = pad7(pedidoId);
    const empleadoNombre = getEmployeeDisplayName(empleadoId) || `Empleado ${empleadoId}`;
    const usuario = pedido.user || getUserById(empleadoId);
    const rol = rolEfectivo; // ya normalizado y persistido

    // Servicio (solo supervisor)
    const sid = rol === "supervisor"
      ? String(pedido.ServicioID ?? servicioId ?? "").trim()
      : ""; // administrativo: vacío

    const serviceName = rol === "supervisor"
      ? resolveServiceName(sid, pedido?.servicio?.name)
      : ""; // administrativo: no mostrar

    const total      = Number(pedido.Total || 0);
    const fechaLocal = fmtLocal(pedido.Fecha);
    const notaFinal  = String(nota || pedido.Nota || "—");

    // ===== Generar PDF EN MEMORIA (sin tocar disco) =====
    const pedidoParaPdf = {
      ...pedido,
      rol,
      // administrativo: ocultar servicio completamente
      servicio: rol === "supervisor" ? { id: sid || null, name: serviceName } : null,
    };
    let filename = `remito_${nro}.pdf`;
    let buffer = null;
    try {
      const out = await generateRemitoPDFBuffer({ pedido: pedidoParaPdf });
      filename = out.filename || filename;
      buffer = out.buffer;
    } catch (e) {
      console.warn("[orders] No se pudo generar PDF en memoria:", e?.message || e);
    }

    // ===== Email =====
    try {
      let presupuestoLinea = "";
      if (rol === "supervisor" && sid) {
        const presupuesto = budgetSettings?.budget;
        if (presupuesto && presupuesto > 0) {
          const pct = Math.min(100, (total / presupuesto) * 100);
          presupuestoLinea = `\nUsado: ${pct.toFixed(1)}%`;
        }
      }

      const subject =
        rol === "supervisor"
          ? `NUEVO PEDIDO DE INSUMOS - "${serviceName}"`
          : `NUEVO PEDIDO DE INSUMOS - Administrativo`;

      const text =
        rol === "supervisor"
          ? `Se generó el pedido #${nro}.

Empleado: ${empleadoNombre}
Rol: ${rol}
Servicio: ${serviceName}
Fecha: ${fechaLocal}
Total: ${money(total)}
Nota: ${notaFinal}${presupuestoLinea}

Se adjunta PDF del remito.`
          : `Se generó el pedido #${nro}.

Empleado: ${empleadoNombre}
Rol: ${rol}
Fecha: ${fechaLocal}
Total: ${money(total)}
Nota: ${notaFinal}

Se adjunta PDF del remito.`;

      const html =
        rol === "supervisor"
          ? `
<p>Se generó el pedido <strong>#${nro}</strong>.</p>

<p><strong>Empleado:</strong> ${empleadoNombre}<br/>
<strong>Rol:</strong> ${rol}<br/>
<strong>Servicio:</strong> ${serviceName}<br/>
<strong>Fecha:</strong> ${fechaLocal}<br/>
<strong>Total:</strong> ${money(total)}<br/>
<strong>Nota:</strong> ${notaFinal}</p>
${presupuestoLinea ? `<p><strong>${presupuestoLinea.replace("\n", "")}</strong></p>` : ""}
<p>Se adjunta PDF del remito.</p>
`.trim()
          : `
<p>Se generó el pedido <strong>#${nro}</strong>.</p>

<p><strong>Empleado:</strong> ${empleadoNombre}<br/>
<strong>Rol:</strong> ${rol}<br/>
<strong>Fecha:</strong> ${fechaLocal}<br/>
<strong>Total:</strong> ${money(total)}<br/>
<strong>Nota:</strong> ${notaFinal}</p>
<p>Se adjunta PDF del remito.</p>
`.trim();

      // Solo enviar a destinatarios del servicio si es supervisor
      const toArr = rol === "supervisor" && sid ? (getServiceEmails(sid) || []) : [];
      const to = toArr.length ? toArr.join(",") : undefined;

      const attachments = buffer
        ? [{ filename, content: buffer, contentType: "application/pdf" }]
        : undefined;

      await sendMail({
        to,
        subject,
        text,
        html,
        attachments,
        entityType: "pedido",
        entityId: pedidoId,
        displayAsUser: true,               // muestra nombre del usuario
        userName: empleadoNombre,
        userEmail: usuario?.email || null, // si hay mail del usuario
        systemTag: "Kazaro Pedidos",       // etiqueta si no hay mail del user
      });
    } catch (e) {
      console.warn("[orders] sendMail falló:", e?.message || e);
    }

    const pdfUrl = `/orders/pdf/${pedidoId}`;
    return res.status(201).json({ ok: true, pedidoId, remito: { pdfUrl }, rol: rolEfectivo });
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
    const rol = String(pedido.Rol || "").trim().toLowerCase();

    // Solo mostrar servicio si el pedido es de supervisor
    const sid = rol === "supervisor" ? String(pedido.ServicioID ?? "").trim() : "";
    const serviceName = rol === "supervisor" ? resolveServiceName(sid, pedido?.servicio?.name) : "";

    const pedidoParaPdf = {
      ...pedido,
      rol,
      servicio: rol === "supervisor" ? { id: sid || null, name: serviceName } : null,
    };

    // Generar PDF en memoria y devolverlo
    const { filename, buffer } = await generateRemitoPDFBuffer({ pedido: pedidoParaPdf });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    return res.send(buffer);
  } catch (e) {
    return res.status(500).json({ error: "No se pudo generar el PDF" });
  }
});

export default router;
