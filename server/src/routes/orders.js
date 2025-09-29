import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { db, getFullOrder, createOrder, getProductForOrder, getEmployeeDisplayName } from "../db.js";
import { generateRemitoPDF } from "../utils/remitoPdf.js";
import { sendMail } from "../utils/mailer.js";

const router = Router();

/* ===================== Helpers locales (no tocan db.js) ===================== */
function _tinfo(table) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all(); } catch { return []; }
}
function _pickCol(info, candidates) {
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
  for (const cand of candidates) {
    const hit = info.find(c => norm(c.name) === norm(cand));
    if (hit) return hit.name;
  }
  return null;
}
function resolveServicesTableLocal() {
  const tryTables = ["Servicios", "Servicos"];
  for (const table of tryTables) {
    try {
      const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
      if (!exists) continue;
      const info = _tinfo(table);
      if (!info.length) continue;

      const idCol =
        _pickCol(info, ["ServiciosID","ServicioID","IdServicio","ID","Id","id"]) ||
        (info.find(c => c.pk === 1)?.name) || "ServicioID";

      const nameCol =
        _pickCol(info, ["ServicioNombre","Nombre","Servicio","Descripcion","Detalle","Titulo","NombreServicio"]) ||
        (info.find(c => /TEXT|CHAR/i.test(String(c.type)))?.name) || idCol;

      const nameExpr = `COALESCE(NULLIF(TRIM(s.${nameCol}), ''), CAST(s.${idCol} AS TEXT))`;
      return { table, idCol, nameCol, nameExpr };
    } catch { /* ignore */ }
  }
  return null;
}
function getServiceNameByIdLocal(servicioId) {
  const spec = resolveServicesTableLocal();
  if (!spec) return null;
  try {
    const row = db.prepare(`
      SELECT ${spec.nameExpr} AS name
      FROM ${spec.table} s
      WHERE CAST(s.${spec.idCol} AS TEXT) = CAST(? AS TEXT)
      LIMIT 1
    `).get(servicioId);
    return row?.name || null;
  } catch {
    return null;
  }
}
/* ========================================================================== */

/**
 * POST /orders
 * body: { rol, nota, items:[{productId,qty}], servicioId?, servicioName? }
 * resp: { ok, pedidoId, remito:{ numero, fecha, total, empleado, rol, servicio?, pdfUrl } }
 */
router.post("/", requireAuth, async (req, res) => {
  try {
    const empleadoId = Number(req.user.id);
    const rol = String(req.body?.rol || "");
    const nota = String(req.body?.nota || "");
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const servicioId = req.body?.servicioId != null ? Number(req.body.servicioId) : null;
    const servicioNameIn = req.body?.servicioName || null;

    if (!empleadoId) return res.status(400).json({ error: "Empleado inválido" });
    if (!items.length) return res.status(400).json({ error: "El pedido no tiene items" });

    let pedidoId, total;
    try {
      ({ pedidoId, total } = createOrder({ empleadoId, rol, nota, items, servicioId }));
    } catch (e) {
      if (e?.code === "OUT_OF_STOCK") {
        // Validación dura de stock: 400 con mensaje claro
        return res.status(400).json({ error: e.message, ...e.extra });
      }
      throw e;
    }

    const { cab, items: fullItems } = getFullOrder(pedidoId);
    const empleado = getEmployeeDisplayName(empleadoId);

    // Nombre del servicio (si aplica) sin depender de nada externo
    const servicioNombre = servicioId
      ? (getServiceNameByIdLocal(servicioId) || servicioNameIn || `Servicio ${servicioId}`)
      : null;

    const remito = {
      numero: String(pedidoId).padStart(8, "0"),
      fecha: cab?.Fecha || new Date().toISOString(),
      total,
      empleado,
      rol,
      servicio: servicioId ? { id: servicioId, name: servicioNombre } : null,
    };

    const { filePath, fileName } = await generateRemitoPDF({ remito, items: fullItems });

    // Asunto del mail
    const subject = servicioId
      ? `NUEVO PEDIDO DE INSUMOS - "${servicioNombre}"`
      : `NUEVO PEDIDO DE INSUMOS - "${empleado}"`;

    try {
      await sendMail({
        to: process.env.MAIL_TO || process.env.SMTP_USER,
        subject,
        html: `
          <p>Se generó el pedido <strong>#${remito.numero}</strong>.</p>
          <p><strong>Empleado:</strong> ${empleado}<br/>
             <strong>Rol:</strong> ${rol || "-"}<br/>
             ${remito.servicio ? `<strong>Servicio:</strong> ${remito.servicio.name}<br/>` : ""}
             <strong>Total:</strong> ${total}
          </p>
          <p>Se adjunta PDF del remito.</p>
        `,
        attachments: [{ filename: fileName, path: filePath }],
      });
    } catch (e) {
      console.warn("[orders] sendMail falló:", e?.message || e);
    }

    const pdfUrl = `/orders/pdf/${pedidoId}`;
    return res.status(201).json({ ok: true, pedidoId, remito: { ...remito, pdfUrl } });
  } catch (e) {
    console.error("[orders] POST / error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
});

router.get("/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });
  try {
    const data = getFullOrder(id);
    if (!data?.cab) return res.status(404).json({ error: "Pedido no encontrado" });
    return res.json(data);
  } catch (e) {
    console.error("[orders] GET /:id error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
});

router.get("/product/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });
  try {
    const p = getProductForOrder(id);
    if (!p) return res.status(404).json({ error: "Producto no encontrado" });
    return res.json(p);
  } catch (e) {
    console.error("[orders] GET /product/:id error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
});

router.get("/pdf/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });
  try {
    const { cab, items } = getFullOrder(id);
    if (!cab) return res.status(404).json({ error: "Pedido no encontrado" });

    const empleado = getEmployeeDisplayName(cab.EmpleadoID);
    const servicioNombre = cab.ServicioID ? (getServiceNameByIdLocal(cab.ServicioID) || `Servicio ${cab.ServicioID}`) : null;

    const remito = {
      numero: String(cab.PedidoID).padStart(8, "0"),
      fecha: cab.Fecha,
      total: cab.Total || 0,
      empleado,
      rol: cab.Rol || "",
      servicio: cab.ServicioID ? { id: cab.ServicioID, name: servicioNombre } : null,
    };

    const { filePath, fileName } = await generateRemitoPDF({ remito, items });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.sendFile(filePath);
  } catch (e) {
    console.error("[orders] GET /pdf/:id error:", e);
    return res.status(500).json({ error: "No se pudo generar el PDF" });
  }
});

export default router;
