// server/src/routes/deposito.js
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { db, getFutureIncomingForProduct, getUserRoles } from "../db.js";

const router = Router();

/* ------------------------ Auth: Depósito sólo ------------------------ */
function requireDepositoSolo(req, res, next) {
  try {
    if (!req.user?.id) return res.status(401).json({ ok: false, error: "No autenticado" });

    const roles = (req.user.roles?.length ? req.user.roles : getUserRoles(req.user.id) || [])
      .map((r) => String(r).toLowerCase());

    const isDepositoSolo = roles.includes("deposito") && roles.length === 1;
    if (!isDepositoSolo) return res.status(403).json({ ok: false, error: "Sin permiso para Depósito" });

    return next();
  } catch (e) {
    console.error("[deposito] requireDepositoSolo:", e?.message || e);
    return res.status(403).json({ ok: false, error: "Sin permiso" });
  }
}
const mustWarehouse = [requireAuth, requireDepositoSolo];

/* ----------------------------- Helpers ----------------------------- */
function parseISO(d) {
  if (!d) return null;
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  return x.toISOString().slice(0, 10);
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function firstDayOfMonthISO(dt = new Date()) {
  const d = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1));
  return d.toISOString().slice(0, 10);
}

function getTableColumnsLower(tableName) {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return new Set(cols.map((c) => String(c.name || "").toLowerCase()));
}
function pickCol(colsLower, candidates) {
  for (const name of candidates) if (colsLower.has(name.toLowerCase())) return name;
  return null;
}
function normalizeOrder(row, map) {
  const get = (k) => (k ? row[k] : null);

  const id = get(map.id);
  const empleadoId = get(map.empleadoId);
  const rol = get(map.rol);
  const fecha = get(map.fecha);
  const total = get(map.total) == null ? null : Number(get(map.total));
  const statusVal = (get(map.status) ?? "").toString().toLowerCase();
  const estadoVal = (get(map.estado) ?? "").toString().toLowerCase();
  const isClosedVal = get(map.isClosed);
  const closedAtVal = get(map.closedAt);
  const remito =
    get(map.remito) ??
    get(map.remito2) ??
    get(map.remito3) ??
    get(map.remito4) ??
    get(map.remito5) ??
    null;

  const closed =
    statusVal === "closed" ||
    estadoVal === "cerrado" ||
    estadoVal === "completado" ||
    estadoVal === "completo" ||
    isClosedVal === 1 ||
    isClosedVal === true ||
    isClosedVal === "1" ||
    isClosedVal === "true" ||
    closedAtVal != null;

  return {
    id,
    empleadoId,
    rol,
    fecha,
    total,
    remito,
    status: statusVal || estadoVal || (closed ? "closed" : "open"),
    isClosed: closed,
    closedAt: closedAtVal ?? null,
  };
}
function detectIdColumn() {
  const cols = getTableColumnsLower("Pedidos");
  return (
    pickCol(cols, ["pedidoid"]) ||
    pickCol(cols, ["pedido_id"]) ||
    pickCol(cols, ["id"])
  );
}

/* ========================= 1) Pedidos (Depósito) ========================= */
// GET /deposito/orders?status=open|closed
router.get("/orders", mustWarehouse, (req, res) => {
  try {
    const statusParam = String(req.query.status || "open").toLowerCase();

    const hasPedidos = !!db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='Pedidos'`)
      .get();
    if (!hasPedidos) return res.status(500).json({ error: "Tabla 'Pedidos' inexistente" });

    const cols = getTableColumnsLower("Pedidos");
    const map = {
      id:        pickCol(cols, ["pedidoid", "pedido_id", "id"]),
      empleadoId:pickCol(cols, ["empleadoid", "empleado_id", "user_id", "empleado"]),
      rol:       pickCol(cols, ["rol", "role", "cargo", "puesto"]),
      fecha:     pickCol(cols, ["fecha", "created_at", "fecha_creacion", "fecha_alta"]),
      total:     pickCol(cols, ["total", "importe", "monto", "amount", "total_amount"]),
      status:    pickCol(cols, ["status"]),
      estado:    pickCol(cols, ["estado"]),
      isClosed:  pickCol(cols, ["isclosed", "is_closed", "cerrado"]),
      closedAt:  pickCol(cols, ["closedat", "closed_at", "fecha_cierre"]),
      remito:    pickCol(cols, ["remitonumber", "remito", "remito_numero", "numero_remito", "nro_remito"]),
      remito2:   pickCol(cols, ["remito_numero", "numero_remito"]),
      remito3:   pickCol(cols, ["nro_remito"]),
      remito4:   pickCol(cols, ["remito"]),
      remito5:   pickCol(cols, ["remitonumber"]),
    };
    if (!map.id) return res.status(500).json({ error: "No se encontró columna ID en 'Pedidos'" });

    const orderBy = map.fecha || map.id;
    const selectParts = [
      `${map.id} AS ${map.id}`,
      `${map.empleadoId || "NULL"} AS ${map.empleadoId || "empleadoid"}`,
      `${map.rol || "NULL"} AS ${map.rol || "rol"}`,
      `${map.fecha || "NULL"} AS ${map.fecha || "fecha"}`,
      `${map.total || "NULL"} AS ${map.total || "total"}`,
      `${map.status || "NULL"} AS ${map.status || "status"}`,
      `${map.estado || "NULL"} AS ${map.estado || "estado"}`,
      `${map.isClosed || "NULL"} AS ${map.isClosed || "isclosed"}`,
      `${map.closedAt || "NULL"} AS ${map.closedAt || "closedat"}`,
      `${map.remito || "NULL"} AS ${map.remito || "remito"}`,
      `${map.remito2 || "NULL"} AS ${map.remito2 || "remito2"}`,
      `${map.remito3 || "NULL"} AS ${map.remito3 || "remito3"}`,
      `${map.remito4 || "NULL"} AS ${map.remito4 || "remito4"}`,
      `${map.remito5 || "NULL"} AS ${map.remito5 || "remito5"}`,
    ];
    const rawRows = db.prepare(`SELECT ${selectParts.join(", ")} FROM Pedidos ORDER BY ${orderBy} DESC`).all();
    const norm = rawRows.map((r) => normalizeOrder(r, map));
    const filtered = statusParam === "closed" ? norm.filter((o) => o.isClosed) : norm.filter((o) => !o.isClosed);
    return res.json(filtered);
  } catch (e) {
    console.error("[deposito] GET /orders error:", e);
    return res.status(500).json({ error: "No se pudieron listar los pedidos" });
  }
});

function applyOrderStatus(id, makeClosed) {
  const cols = getTableColumnsLower("Pedidos");
  const idCol = detectIdColumn();
  if (!idCol) throw new Error("No se encontró columna ID en 'Pedidos'");
  let changes = 0;

  const exec = (sql, params = []) => {
    try {
      const info = db.prepare(sql).run(...params);
      changes += info.changes || 0;
    } catch {/* la columna puede no existir en este esquema */}
  };

  if (cols.has("status"))
    exec(`UPDATE Pedidos SET status = ? WHERE ${idCol} = ?`, [makeClosed ? "closed" : "open", id]);
  if (cols.has("estado"))
    exec(`UPDATE Pedidos SET estado = ? WHERE ${idCol} = ?`, [makeClosed ? "cerrado" : "abierto", id]);
  if (cols.has("isclosed")) exec(`UPDATE Pedidos SET isClosed = ? WHERE ${idCol} = ?`, [makeClosed ? 1 : 0, id]);
  if (cols.has("is_closed")) exec(`UPDATE Pedidos SET is_closed = ? WHERE ${idCol} = ?`, [makeClosed ? 1 : 0, id]);
  if (cols.has("cerrado"))   exec(`UPDATE Pedidos SET cerrado = ? WHERE ${idCol} = ?`, [makeClosed ? 1 : 0, id]);
  if (cols.has("closedat"))  exec(`UPDATE Pedidos SET ClosedAt = ${makeClosed ? "datetime('now')" : "NULL"} WHERE ${idCol} = ?`, [id]);
  if (cols.has("closed_at")) exec(`UPDATE Pedidos SET closed_at = ${makeClosed ? "datetime('now')" : "NULL"} WHERE ${idCol} = ?`, [id]);

  if (changes === 0)
    throw new Error("No se pudo actualizar estado (ninguna columna de estado encontrada)");
}

/* ---- CLOSE (acepta PUT/POST/PATCH y dos variantes de path) ---- */
const closeHandler = (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });
    applyOrderStatus(id, true);
    return res.json({ ok: true, id });
  } catch (e) {
    console.error("[deposito] close order:", e);
    return res.status(500).json({ error: e?.message || "No se pudo cerrar el pedido" });
  }
};
router.put(  "/orders/:id/close",   mustWarehouse, closeHandler);
router.post( "/orders/:id/close",   mustWarehouse, closeHandler);
router.patch("/orders/:id/close",   mustWarehouse, closeHandler);
router.put(  "/orders/close/:id",   mustWarehouse, closeHandler);
router.post( "/orders/close/:id",   mustWarehouse, closeHandler);
router.patch("/orders/close/:id",   mustWarehouse, closeHandler);

/* ---- REOPEN (acepta PUT/POST/PATCH y dos variantes de path) ---- */
const reopenHandler = (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });
    applyOrderStatus(id, false);
    return res.json({ ok: true, id });
  } catch (e) {
    console.error("[deposito] reopen order:", e);
    return res.status(500).json({ error: e?.message || "No se pudo reabrir el pedido" });
  }
};
router.put(  "/orders/:id/reopen",  mustWarehouse, reopenHandler);
router.post( "/orders/:id/reopen",  mustWarehouse, reopenHandler);
router.patch("/orders/:id/reopen",  mustWarehouse, reopenHandler);
router.put(  "/orders/reopen/:id",  mustWarehouse, reopenHandler);
router.post( "/orders/reopen/:id",  mustWarehouse, reopenHandler);
router.patch("/orders/reopen/:id",  mustWarehouse, reopenHandler);

/* ==================== 2) Rutas de analytics existentes ==================== */
router.get("/top-consumidos", mustWarehouse, (req, res) => {
  try {
    const start = parseISO(req.query.start) || firstDayOfMonthISO();
    const end = parseISO(req.query.end) || todayISO();
    const limit = Math.min(parseInt(req.query.limit ?? "20", 10) || 20, 200);

    const rows = db
      .prepare(`
        SELECT
          pi.ProductoID        AS productId,
          p.ProductName        AS name,
          COALESCE(p.Unit,'')  AS unit,
          COALESCE(p.Code,'')  AS code,
          SUM(pi.Cantidad)     AS total
        FROM PedidoItems pi
        JOIN Pedidos pe ON pe.PedidoID = pi.PedidoID
        JOIN Productos p ON p.ProductID = pi.ProductoID
        WHERE date(pe.Fecha) BETWEEN date(?) AND date(?)
        GROUP BY pi.ProductoID
        ORDER BY total DESC
        LIMIT ?
      `)
      .all(start, end, limit)
      .map((r) => ({ ...r, total: Number(r.total || 0) }));

    return res.json({ start, end, rows });
  } catch (e) {
    console.error("[deposito] /top-consumidos error:", e);
    return res.status(500).json({ error: "No se pudo calcular los productos más consumidos" });
  }
});

router.get("/low-stock", mustWarehouse, (req, res) => {
  try {
    const threshold = Math.max(0, parseInt(req.query.threshold ?? "10", 10)) || 10;
    const limit = Math.min(parseInt(req.query.limit ?? "200", 10) || 200, 500);

    const rows = db
      .prepare(`
        SELECT
          p.ProductID                           AS productId,
          p.ProductName                         AS name,
          COALESCE(p.Unit,'')                   AS unit,
          COALESCE(p.Code,'')                   AS code,
          COALESCE(s.CantidadActual, p.Stock,0) AS stock
        FROM Productos p
        LEFT JOIN Stock s ON s.ProductoID = p.ProductID
        WHERE COALESCE(s.CantidadActual, p.Stock, 0) <= ?
        ORDER BY stock ASC, name COLLATE NOCASE
        LIMIT ?
      `)
      .all(threshold, limit)
      .map((r) => ({ ...r, stock: Number(r.stock || 0) }));

    return res.json({ threshold, rows });
  } catch (e) {
    console.error("[deposito] /low-stock error:", e);
    return res.status(500).json({ error: "No se pudo listar los productos con stock bajo" });
  }
});

router.get("/consumo-desde-ultimo-ingreso/:productId", mustWarehouse, (req, res) => {
  try {
    const productId = Number(req.params.productId);
    if (!Number.isFinite(productId)) return res.status(400).json({ error: "productId inválido" });

    const fallbackStart = parseISO(req.query.fallbackStart) || firstDayOfMonthISO();

    const lastInRow = db
      .prepare(`SELECT MAX(timestamp) AS ts FROM stock_movements WHERE product_id = ? AND qty > 0`)
      .get(productId);

    const lastIn = lastInRow?.ts || null;
    const startDate = (lastIn || fallbackStart).slice(0, 10);

    const consumoRow = db
      .prepare(`
        SELECT
          COALESCE(SUM(pi.Cantidad),0) AS consumido,
          MIN(date(pe.Fecha))          AS first_date,
          MAX(date(pe.Fecha))          AS last_date
        FROM PedidoItems pi
        JOIN Pedidos pe ON pe.PedidoID = pi.PedidoID
        WHERE pi.ProductoID = ?
          AND date(pe.Fecha) >= date(?)
      `)
      .get(productId, startDate);

    const incoming = getFutureIncomingForProduct(productId) || { incoming: 0, nextEta: null };

    return res.json({
      productId,
      last_ingreso: lastIn,
      start: startDate,
      consumido: Number(consumoRow?.consumido || 0),
      first_date: consumoRow?.first_date || null,
      last_date: consumoRow?.last_date || null,
      incoming_total: Number(incoming.incoming || 0),
      next_eta: incoming.nextEta || null,
    });
  } catch (e) {
    console.error("[deposito] /consumo-desde-ultimo-ingreso error:", e);
    return res.status(500).json({ error: "No se pudo calcular el consumo desde el último ingreso" });
  }
});

router.get("/overview", mustWarehouse, (req, res) => {
  try {
    const start = parseISO(req.query.start) || firstDayOfMonthISO();
    const end = parseISO(req.query.end) || todayISO();
    const threshold = Math.max(0, parseInt(req.query.threshold ?? "10", 10)) || 10;

    const top = db
      .prepare(`
        SELECT
          pi.ProductoID        AS productId,
          p.ProductName        AS name,
          COALESCE(p.Unit,'')  AS unit,
          COALESCE(p.Code,'')  AS code,
          SUM(pi.Cantidad)     AS total
        FROM PedidoItems pi
        JOIN Pedidos pe ON pe.PedidoID = pi.PedidoID
        JOIN Productos p ON p.ProductID = pi.ProductoID
        WHERE date(pe.Fecha) BETWEEN date(?) AND date(?)
        GROUP BY pi.ProductoID
        ORDER BY total DESC
        LIMIT 20
      `)
      .all(start, end)
      .map((r) => ({ ...r, total: Number(r.total || 0) }));

    const low = db
      .prepare(`
        SELECT
          p.ProductID                           AS productId,
          p.ProductName                         AS name,
          COALESCE(p.Unit,'')                   AS unit,
          COALESCE(p.Code,'')                   AS code,
          COALESCE(s.CantidadActual, p.Stock,0) AS stock
        FROM Productos p
        LEFT JOIN Stock s ON s.ProductoID = p.ProductID
        WHERE COALESCE(s.CantidadActual, p.Stock, 0) <= ?
        ORDER BY stock ASC, name COLLATE NOCASE
        LIMIT 200
      `)
      .all(threshold)
      .map((r) => ({ ...r, stock: Number(r.stock || 0) }));

    return res.json({ start, end, threshold, top, low });
  } catch (e) {
    console.error("[deposito] /overview error:", e);
    return res.status(500).json({ error: "No se pudo construir el resumen de Depósito" });
  }
});

/* ------------------------------- Selfcheck ------------------------------- */
router.get("/_selfcheck", requireAuth, (_req, res) => {
  try {
    const has = (name) =>
      !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
    return res.json({
      ok: has("Pedidos") && has("PedidoItems") && has("Productos"),
      tables: {
        Pedidos: has("Pedidos"),
        PedidoItems: has("PedidoItems"),
        Productos: has("Productos"),
        Stock: has("Stock"),
        stock_movements: has("stock_movements"),
        IncomingStock: has("IncomingStock"),
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

export default router;
