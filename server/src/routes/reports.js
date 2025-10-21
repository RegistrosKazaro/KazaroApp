// server/src/routes/reports.js
import { Router } from "express";
import { db, getBudgetByServiceId, getServiceNameById, getServiceById } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const mustBeAdmin = [requireAuth, requireRole(["admin", "Admin"])];

function _tinfo(table) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all(); } catch { return []; }
}
function _norm(s) {
  return String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}
function _pickCol(info, candidates) {
  const names = info.map(c => c.name);
  for (const cand of candidates) {
    const n = names.find(nm => _norm(nm) === _norm(cand));
    if (n) return n;
  }
  return null;
}
function resolveServicesTableLocal() {
  const table = "Servicios";
  const info = _tinfo(table);
  if (!info.length) return null;
  const idCol =
    _pickCol(info, ["ServiciosID", "ServicioID", "IdServicio", "ServiceID", "service_id", "servicio_id", "id"]) ||
    (info.find(c => c.pk === 1)?.name) ||
    "ServiciosID";
  const nameCol =
    _pickCol(info, ["ServicioNombre", "Nombre", "Servicio", "Descripcion", "Detalle", "Titulo", "NombreServicio"]) ||
    idCol;
  const nameExpr = `COALESCE(NULLIF(TRIM(s.${nameCol}), ''), CAST(s.${idCol} AS TEXT))`;
  return { table, idCol, nameCol, nameExpr };
}
function monthRange(y, m) {
  const now = new Date();
  const year = Number(y) || now.getFullYear();
  const month = Number(m) || now.getMonth() + 1;
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  const fmt = d => d.toISOString().slice(0, 19).replace("T", " ");
  return { year, month, start: fmt(start), end: fmt(end) };
}

/** Resuelve nombre de servicio con fallbacks seguros */
function resolveServiceName(servicioId) {
  const sid = String(servicioId ?? "").trim();
  if (!sid) return "—";
  const key = /^\d+$/.test(sid) ? Number(sid) : sid;
  try {
    return (
      getServiceNameById(key) ||              // intento directo
      getServiceById(key)?.name ||            // fallback por búsqueda completa
      "—"
    );
  } catch {
    return getServiceNameById(key) || "—";
  }
}

router.get("/services", mustBeAdmin, (_req, res) => {
  const spec = resolveServicesTableLocal();
  if (spec) {
    try {
      const rows = db
        .prepare(
          `
        SELECT CAST(s.${spec.idCol} AS TEXT) AS id, ${spec.nameExpr} AS name
        FROM ${spec.table} s
        ORDER BY name COLLATE NOCASE
      `
        )
        .all();
      return res.json(rows.map(r => ({ id: r.id, name: r.name })));
    } catch (e) {
      console.error("[reports] GET /services error:", e);
    }
  }
  try {
    const rows = db
      .prepare(
        `
      SELECT DISTINCT CAST(COALESCE(ServicioID,'') AS TEXT) AS id
      FROM Pedidos
      WHERE COALESCE(ServicioID,'') <> ''
      ORDER BY id
    `
      )
      .all();
    return res.json(rows.map(r => ({ id: r.id, name: resolveServiceName(r.id) })));
  } catch (e) {
    console.error("[reports] GET /services fallback error:", e);
    return res.json([]);
  }
});

router.get("/monthly", mustBeAdmin, (req, res) => {
  const { year, month, start, end } = (() => {
    const r = monthRange(req.query.year, req.query.month);
    return { ...r, start: r.start, end: r.end };
  })();
  try {
    const totals = (() => {
      const ordersCount =
        db.prepare(`SELECT COUNT(*) AS c FROM Pedidos WHERE Fecha >= ? AND Fecha < ?`).get(start, end)?.c || 0;
      const itemsCount =
        db
          .prepare(
            `
        SELECT COALESCE(SUM(i.Cantidad),0) AS c
        FROM PedidoItems i
        JOIN Pedidos p ON p.PedidoID = i.PedidoID
        WHERE p.Fecha >= ? AND p.Fecha < ?
      `
          )
          .get(start, end)?.c || 0;
      const amount =
        db.prepare(`SELECT COALESCE(SUM(Total),0) AS s FROM Pedidos WHERE Fecha >= ? AND Fecha < ?`).get(start, end)
          ?.s || 0;
      return { ordersCount: Number(ordersCount), itemsCount: Number(itemsCount), amount: Number(amount) };
    })();

    const top_services_raw = db
      .prepare(
        `
      SELECT COALESCE(p.ServicioID,'') AS serviceId,
             COUNT(DISTINCT p.PedidoID) AS pedidos,
             COALESCE(SUM(i.Cantidad),0) AS qty,
             COALESCE(SUM(i.Subtotal),0) AS amount
      FROM Pedidos p
      LEFT JOIN PedidoItems i ON i.PedidoID = p.PedidoID
      WHERE p.Fecha >= ? AND p.Fecha < ?
      GROUP BY p.ServicioID
      ORDER BY amount DESC
      LIMIT 10
    `
      )
      .all(start, end);

    const top_services = top_services_raw.map(r => ({
      serviceId: r.serviceId || null,
      serviceName: resolveServiceName(r.serviceId),
      pedidos: Number(r.pedidos || 0),
      qty: Number(r.qty || 0),
      amount: Number(r.amount || 0),
    }));

    const top_products = db
      .prepare(
        `
      SELECT COALESCE(i.ProductoID, 0) AS productId,
             COALESCE(MAX(i.Codigo), '') AS code,
             COALESCE(MAX(i.Nombre), '') AS name,
             COUNT(DISTINCT i.PedidoID) AS pedidos,
             COALESCE(SUM(i.Cantidad),0) AS qty,
             COALESCE(SUM(i.Subtotal),0) AS amount
      FROM PedidoItems i
      JOIN Pedidos p ON p.PedidoID = i.PedidoID
      WHERE p.Fecha >= ? AND p.Fecha < ?
      GROUP BY i.ProductoID, LOWER(i.Nombre), LOWER(i.Codigo)
      ORDER BY amount DESC
      LIMIT 10
    `
      )
      .all(start, end)
      .map(r => ({
        productId: Number(r.productId || 0),
        code: String(r.code || ""),
        name: String(r.name || ""),
        pedidos: Number(r.pedidos || 0),
        qty: Number(r.qty || 0),
        amount: Number(r.amount || 0),
      }));

    const by_day = db
      .prepare(
        `
      SELECT SUBSTR(p.Fecha,1,10) AS day,
             COUNT(*) AS pedidos,
             COALESCE(SUM(p.Total),0) AS monto
      FROM Pedidos p
      WHERE p.Fecha >= ? AND p.Fecha < ?
      GROUP BY day
      ORDER BY day
    `
      )
      .all(start, end)
      .map(r => ({
        day: r.day,
        pedidos: Number(r.pedidos || 0),
        monto: Number(r.monto || 0),
      }));

    return res.json({
      ok: true,
      period: { year, month, start, end },
      totals,
      top_services,
      top_products,
      by_day,
    });
  } catch (e) {
    console.error("[reports] GET /monthly error:", e);
    return res.status(500).json({ error: "No se pudo construir el informe" });
  }
});

router.get("/service/:serviceId", mustBeAdmin, (req, res) => {
  const servicioId = req.params.serviceId;
  const { year, month, start, end } = (() => {
    const r = monthRange(req.query.year, req.query.month);
    const startQ = req.query.start ? String(req.query.start).trim() + " 00:00:00" : r.start;
    const endQ = req.query.end ? String(req.query.end).trim() + " 23:59:59" : r.end;
    return { ...r, start: startQ, end: endQ };
  })();
  try {
    const serviceName = resolveServiceName(servicioId);

    const totals = (() => {
      const ordersCount =
        db
          .prepare(
            `
        SELECT COUNT(*) AS c FROM Pedidos
        WHERE Fecha >= ? AND Fecha < ? AND CAST(ServicioID AS TEXT) = CAST(? AS TEXT)
      `
          )
          .get(start, end, servicioId)?.c || 0;
      const itemsCount =
        db
          .prepare(
            `
        SELECT COALESCE(SUM(i.Cantidad),0) AS c
        FROM PedidoItems i
        JOIN Pedidos p ON p.PedidoID = i.PedidoID
        WHERE p.Fecha >= ? AND p.Fecha < ? AND CAST(p.ServicioID AS TEXT) = CAST(? AS TEXT)
      `
          )
          .get(start, end, servicioId)?.c || 0;
      const amount =
        db
          .prepare(
            `
        SELECT COALESCE(SUM(Total),0) AS s FROM Pedidos
        WHERE Fecha >= ? AND Fecha < ? AND CAST(ServicioID AS TEXT) = CAST(? AS TEXT)
      `
          )
          .get(start, end, servicioId)?.s || 0;
      return { ordersCount: Number(ordersCount), itemsCount: Number(itemsCount), amount: Number(amount) };
    })();

    const top_products = db
      .prepare(
        `
      SELECT COALESCE(i.ProductoID, 0) AS productId,
             COALESCE(MAX(i.Codigo), '') AS code,
             COALESCE(MAX(i.Nombre), '') AS name,
             COUNT(DISTINCT i.PedidoID) AS pedidos,
             COALESCE(SUM(i.Cantidad),0) AS qty,
             COALESCE(SUM(i.Subtotal),0) AS amount
      FROM PedidoItems i
      JOIN Pedidos p ON p.PedidoID = i.PedidoID
      WHERE p.Fecha >= ? AND p.Fecha < ? AND CAST(p.ServicioID AS TEXT) = CAST(? AS TEXT)
      GROUP BY i.ProductoID, LOWER(i.Nombre), LOWER(i.Codigo)
      ORDER BY amount DESC
      LIMIT 15
    `
      )
      .all(start, end, servicioId)
      .map(r => ({
        productId: Number(r.productId || 0),
        code: String(r.code || ""),
        name: String(r.name || ""),
        pedidos: Number(r.pedidos || 0),
        qty: Number(r.qty || 0),
        amount: Number(r.amount || 0),
      }));

    const by_day = db
      .prepare(
        `
      SELECT SUBSTR(p.Fecha,1,10) AS day,
             COUNT(*) AS pedidos,
             COALESCE(SUM(p.Total),0) AS monto
      FROM Pedidos p
      WHERE p.Fecha >= ? AND p.Fecha < ? AND CAST(p.ServicioID AS TEXT) = CAST(? AS TEXT)
      GROUP BY day
      ORDER BY day
    `
      )
      .all(start, end, servicioId)
      .map(r => ({
        day: r.day,
        pedidos: Number(r.pedidos || 0),
        monto: Number(r.monto || 0),
      }));

    const orders = db
      .prepare(
        `
      SELECT p.PedidoID AS id, p.Fecha AS fecha, COALESCE(p.Total,0) AS total
      FROM Pedidos p
      WHERE p.Fecha >= ? AND p.Fecha < ? AND CAST(p.ServicioID AS TEXT) = CAST(? AS TEXT)
      ORDER BY p.Fecha DESC
    `
      )
      .all(start, end, servicioId)
      .map(r => ({
        id: Number(r.id),
        fecha: r.fecha,
        total: Number(r.total),
      }));

    const budget = getBudgetByServiceId(servicioId);
    const utilization = budget && budget > 0 ? totals.amount / budget : null;

    return res.json({
      ok: true,
      period: { year, month, start, end },
      service: { id: servicioId, name: serviceName, budget: budget ?? null, utilization },
      totals,
      top_products,
      by_day,
      orders,
    });
  } catch (e) {
    console.error("[reports] GET /service/:serviceId error:", e);
    return res.status(500).json({ error: "No se pudo construir el informe del servicio" });
  }
});

export default router;
