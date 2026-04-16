// server/src/routes/orders.js
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  createOrder, getFullOrder, getEmployeeDisplayName,
  getServiceById, getServiceEmails, getServiceNameById,
  getBudgetSettingsByServiceId, DEFAULT_SERVICE_PCT,
  getUserRoles, listServicesByUser, getUserById, db,
} from "../db.js";
import { generateRemitoPDFBuffer } from "../utils/remitoPdf.js";
import { sendMail } from "../utils/mailer.js";

const router = Router();
const pad7 = (n) => String(n ?? "").padStart(7, "0");

function sqlLocalToISO(sqlTs) {
  if (!sqlTs) return new Date().toISOString();
  try {
    const clean = String(sqlTs).replace(" ", "T");
    const d = new Date(clean + "-03:00");
    if (Number.isNaN(d.getTime())) return new Date().toISOString();
    return d.toISOString();
  } catch { return new Date().toISOString(); }
}

function primaryRole(userId) {
  const roles = (getUserRoles(userId) || []).map((r) => String(r).toLowerCase());
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

function resolveEmpresaNombre(empresaId) {
  if (!empresaId) return "Kazaro";
  try {
    const row = db.prepare(`SELECT nombre FROM Empresas WHERE id = ? LIMIT 1`).get(empresaId);
    return row?.nombre ?? "Kazaro";
  } catch {
    return "Kazaro";
  }
}

router.post("/", requireAuth, async (req, res) => {
  try {
    const empleadoId    = req.user.id;
    const empresaId     = req.user.empresaId ?? null;
    const empresaNombre = resolveEmpresaNombre(empresaId);
    const asRoleClient  = normalizeRoleName(req.body?.asRole ?? req.body?.rol);
    const rolEfectivo   = asRoleClient || primaryRole(empleadoId);

    let { servicioId = null, nota = "", items } = req.body || {};

    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: "Faltan items" });

    if (rolEfectivo === "supervisor") {
      if (!servicioId) {
        const mios = listServicesByUser(empleadoId);
        if (Array.isArray(mios) && mios.length === 1) servicioId = mios[0].id;
      }
      if (!servicioId)
        return res.status(400).json({ error: "servicioId es requerido para pedidos de supervisor" });
    } else {
      servicioId = null;
    }

    let budgetSettings = { budget: null, maxPct: DEFAULT_SERVICE_PCT };
    let maxTotalAllowed = null;

    if (rolEfectivo === "supervisor" && servicioId) {
      budgetSettings = getBudgetSettingsByServiceId(servicioId) || budgetSettings;
      if (budgetSettings?.budget > 0) {
        const pct = Number(budgetSettings.maxPct ?? DEFAULT_SERVICE_PCT);
        if (Number.isFinite(pct) && pct > 0)
          maxTotalAllowed = (budgetSettings.budget * pct) / 100;
      }
    }

    let pedidoId;
    try {
      pedidoId = createOrder({ empleadoId, servicioId, nota, items, maxTotalAllowed });
    } catch (err) {
      if (err?.message === "ORDER_OVER_LIMIT") {
        const pct = Number(budgetSettings.maxPct ?? DEFAULT_SERVICE_PCT);
        return res.status(400).json({ error: `El pedido excede el ${pct}% del presupuesto del servicio` });
      }
      throw err;
    }

    const pedidosInfo   = db.prepare("PRAGMA table_info(Pedidos)").all();
    const hasEmpresaCol = pedidosInfo.some((c) => c.name === "empresa_id");
    if (hasEmpresaCol && empresaId)
      db.prepare("UPDATE Pedidos SET Rol = ?, empresa_id = ? WHERE PedidoID = ?").run(rolEfectivo, empresaId, Number(pedidoId));
    else
      db.prepare("UPDATE Pedidos SET Rol = ? WHERE PedidoID = ?").run(rolEfectivo, Number(pedidoId));

    const pedido = getFullOrder(pedidoId);
    if (!pedido) return res.status(500).json({ error: "No se pudo recuperar el pedido" });

    const nro            = pad7(pedidoId);
    const empleadoNombre = getEmployeeDisplayName(empleadoId) || `Empleado ${empleadoId}`;
    const usuario        = pedido.user || getUserById(empleadoId);
    const rol            = rolEfectivo;

    const sidResolved = rol === "supervisor"
      ? String(pedido.ServicioID ?? servicioId ?? "").trim()
      : "";
    const serviceName = sidResolved ? resolveServiceName(sidResolved, pedido?.servicio?.name) : "";

    const total          = Number(pedido.Total || 0);
    const notaFinal      = String(nota || pedido.Nota || "—");
    const servicioParaPdf = rol === "supervisor" && sidResolved
      ? { id: sidResolved, name: serviceName || sidResolved }
      : null;

    const pedidoParaPdf = {
      ...pedido,
      ServicioID: sidResolved || null,
      Rol: rol,
      empresaNombre,
      servicio: servicioParaPdf,
    };

    let buffer = null, filename = `remito_${nro}.pdf`;
    try {
      const out = await generateRemitoPDFBuffer({ pedido: pedidoParaPdf });
      buffer = out.buffer;
      filename = out.filename || filename;
    } catch (e) { console.warn("[orders] No se pudo generar PDF:", e?.message); }

    let mailStatus = { sent: false, skipped: true };
    try {
      const toArr = rol === "supervisor" && sidResolved ? getServiceEmails(sidResolved) || [] : [];
      const info = await sendMail({
        to: toArr.length ? toArr.join(",") : undefined,
        subject: `NUEVO PEDIDO DE INSUMOS #${nro}`,
        text: `Pedido #${nro} generado.`,
        attachments: buffer ? [{ filename, content: buffer, contentType: "application/pdf" }] : undefined,
        displayAsUser: true,
        userName: empleadoNombre,
        userEmail: usuario?.email || null,
        empresaId,
        empresaNombre,
      });
      mailStatus = { sent: true, messageId: info?.messageId };
    } catch (e) { mailStatus = { sent: false, error: e?.message }; }

    return res.status(201).json({
      ok: true, pedidoId,
      remito: {
        numero: nro,
        fecha: sqlLocalToISO(pedido.Fecha),
        empleado: empleadoNombre,
        total,
        nota: notaFinal,
        pdfUrl: `/orders/pdf/${pedidoId}`,
        servicio: servicioParaPdf,
      },
      rol: rolEfectivo,
      mail: mailStatus,
    });
  } catch (e) {
    console.error("[orders] POST / error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
});

router.get("/pdf/:id", requireAuth, async (req, res) => {
  const id     = Number(req.params.id);
  const pedido = getFullOrder(id);
  if (!pedido) return res.status(404).end();

  try {
    const rol          = String(pedido.Rol || "").toLowerCase();
    const isSupervisor = rol.includes("super");

    let sidFromDb = null, empresaIdDb = null;
    try {
      const row = db.prepare("SELECT ServicioID, empresa_id FROM Pedidos WHERE PedidoID = ? LIMIT 1").get(id);
      sidFromDb    = row?.ServicioID ?? null;
      empresaIdDb  = row?.empresa_id ?? null;
    } catch {}

    const sidResolved    = isSupervisor && sidFromDb != null ? String(sidFromDb).trim() : "";
    const serviceName    = sidResolved ? resolveServiceName(sidResolved, pedido?.servicio?.name) : "";
    const empresaNombre  = resolveEmpresaNombre(empresaIdDb);
    const servicioParaPdf = isSupervisor && sidResolved
      ? { id: sidResolved, name: serviceName || sidResolved }
      : null;

    const pedidoParaPdf = {
      ...pedido,
      ServicioID: sidResolved || null,
      Rol: rol,
      empresaNombre,
      servicio: servicioParaPdf,
    };

    const { filename, buffer } = await generateRemitoPDFBuffer({ pedido: pedidoParaPdf });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    return res.send(buffer);
  } catch (e) {
    console.error("[orders] GET /pdf/:id error:", e);
    return res.status(500).json({ error: "No se pudo generar el PDF" });
  }
});

export default router;