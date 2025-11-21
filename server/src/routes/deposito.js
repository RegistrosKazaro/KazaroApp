// server/src/routes/deposito.js
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { db, getFutureIncomingForProduct, getUserRoles } from "../db.js";

const router = Router();
console.log("[deposito] router de deposito CARGADO");

/* ------------------------ Auth: Depósito / Admin ------------------------ */
function requireDepositoOrAdmin(req, res, next) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ ok: false, error: "No autenticado" });
    }

    const roles = (
      req.user.roles?.length ? req.user.roles : getUserRoles(req.user.id) || []
    ).map((r) => String(r).toLowerCase());

    if (!roles.includes("deposito") && !roles.includes("admin")) {
      return res
        .status(403)
        .json({ ok: false, error: "Sin permiso para Depósito/Admin" });
    }

    return next();
  } catch (e) {
    console.error("[deposito] requireDepositoOrAdmin:", e?.message || e);
    return res.status(403).json({ ok: false, error: "Sin permiso" });
  }
}

const mustWarehouse = [requireAuth, requireDepositoOrAdmin];

/* ----------------------------- Helpers ----------------------------- */
const parseISO = (d) => {
  if (!d) return null;
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? null : x.toISOString().slice(0, 10);
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const firstDayOfMonthISO = (dt = new Date()) =>
  new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);

const hasTable = (name) =>
  !!db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1"
    )
    .get(name);

const getTableColumnsLower = (tableName) =>
  new Set(
    db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all()
      .map((c) => String(c.name || "").toLowerCase())
  );

const pickCol = (colsLower, candidates) =>
  candidates.find((name) => colsLower.has(name.toLowerCase())) || null;

const detectIdColumn = () => {
  const cols = getTableColumnsLower("Pedidos");
  return (
    pickCol(cols, ["pedidoid", "pedido_id", "idpedido"]) ||
    pickCol(cols, ["id"])
  );
};

const normalizeOrder = (row, map) => {
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
    ["cerrado", "completado", "completo"].includes(estadoVal) ||
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
};

const isPreparingStatus = (status) => {
  const s = String(status || "").toLowerCase();
  return (
    s === "preparing" ||
    s === "preparacion" ||
    s === "preparación" ||
    s === "en preparacion" ||
    s === "en preparación"
  );
};

const canUsePedidosProductos = () =>
  hasTable("Pedidos") && hasTable("PedidoItems") && hasTable("Productos");

/* ========================= 1) Pedidos (Depósito) ========================= */

router.get("/orders", mustWarehouse, (req, res) => {
  try {
    const statusParam = String(req.query.status || "open").toLowerCase();

    if (!hasTable("Pedidos")) {
      console.warn("[deposito] GET /orders: tabla Pedidos inexistente");
      return res.json([]);
    }

    const cols = getTableColumnsLower("Pedidos");
    const map = {
      id: pickCol(cols, ["pedidoid", "pedido_id", "idpedido", "id"]),
      empleadoId: pickCol(cols, [
        "empleadoid",
        "empleado_id",
        "empleado",
        "user_id",
      ]),
      rol: pickCol(cols, ["rol", "role", "cargo", "puesto"]),
      fecha: pickCol(cols, [
        "fecha",
        "created_at",
        "fecha_creacion",
        "fecha_alta",
      ]),
      total: pickCol(cols, [
        "total",
        "importe",
        "monto",
        "amount",
        "total_amount",
      ]),
      status: pickCol(cols, ["status"]),
      estado: pickCol(cols, ["estado"]),
      isClosed: pickCol(cols, ["isclosed", "is_closed", "cerrado"]),
      closedAt: pickCol(cols, ["closedat", "closed_at", "fecha_cierre"]),
      remito: pickCol(cols, [
        "remitonumber",
        "remito",
        "remito_numero",
        "numero_remito",
        "nro_remito",
      ]),
      remito2: pickCol(cols, ["remito_numero", "numero_remito"]),
      remito3: pickCol(cols, ["nro_remito"]),
      remito4: pickCol(cols, ["remito"]),
      remito5: pickCol(cols, ["remitonumber"]),
    };

    if (!map.id) {
      console.error("[deposito] GET /orders: no se encontró columna ID");
      return res.json([]);
    }

    const orderBy = map.fecha || map.id;
    const sel = (col, alias) => `${col || "NULL"} AS ${col || alias}`;
    const rawRows = db
      .prepare(
        `SELECT
          ${
            [
              sel(map.id, "id"),
              sel(map.empleadoId, "empleadoid"),
              sel(map.rol, "rol"),
              sel(map.fecha, "fecha"),
              sel(map.total, "total"),
              sel(map.status, "status"),
              sel(map.estado, "estado"),
              sel(map.isClosed, "isclosed"),
              sel(map.closedAt, "closedat"),
              sel(map.remito, "remito"),
              sel(map.remito2, "remito2"),
              sel(map.remito3, "remito3"),
              sel(map.remito4, "remito4"),
              sel(map.remito5, "remito5"),
            ].join(", ")
          }
        FROM Pedidos
        ORDER BY ${orderBy} DESC`
      )
      .all();

    const norm = rawRows.map((r) => normalizeOrder(r, map));
    const wantPreparing =
      statusParam === "preparing" ||
      statusParam === "preparacion" ||
      statusParam === "preparación";

    let filtered;
    if (statusParam === "closed") {
      filtered = norm.filter((o) => o.isClosed);
    } else if (wantPreparing) {
      filtered = norm.filter(
        (o) => !o.isClosed && isPreparingStatus(o.status)
      );
    } else {
      filtered = norm.filter(
        (o) => !o.isClosed && !isPreparingStatus(o.status)
      );
    }

    return res.json(filtered);
  } catch (e) {
    console.error("[deposito] GET /orders error:", e);
    return res
      .status(500)
      .json({ error: "No se pudieron listar los pedidos" });
  }
});

/* ================== ACTUALIZAR ESTADO DE PEDIDOS ================== */
function applyOrderStatus(id, makeClosed) {
  if (!hasTable("Pedidos")) throw new Error("Tabla 'Pedidos' inexistente");

  const colsLower = getTableColumnsLower("Pedidos");
  const idCol = detectIdColumn();
  if (!idCol) throw new Error("No se encontró columna ID en 'Pedidos'");

  let hasStatusCol =
    [
      "status",
      "estado",
      "isclosed",
      "is_closed",
      "cerrado",
      "closedat",
      "closed_at",
    ].some((c) => colsLower.has(c));

  if (!hasStatusCol) {
    try {
      db.exec("ALTER TABLE Pedidos ADD COLUMN cerrado INTEGER DEFAULT 0");
      colsLower.add("cerrado");
      hasStatusCol = true;
      console.log(
        "[deposito] applyOrderStatus: columna 'cerrado' agregada automáticamente"
      );
    } catch (e) {
      console.warn(
        "[deposito] applyOrderStatus: no se pudo agregar columna 'cerrado':",
        e.message
      );
    }
  }

  let changes = 0;
  const exec = (sql, params = []) => {
    try {
      const info = db.prepare(sql).run(...params);
      changes += info.changes || 0;
    } catch (e) {
      console.warn("[deposito] applyOrderStatus columna opcional:", e.message);
    }
  };

  if (colsLower.has("status"))
    exec(`UPDATE Pedidos SET status = ? WHERE ${idCol} = ?`, [
      makeClosed ? "closed" : "open",
      id,
    ]);
  if (colsLower.has("estado"))
    exec(`UPDATE Pedidos SET estado = ? WHERE ${idCol} = ?`, [
      makeClosed ? "cerrado" : "abierto",
      id,
    ]);
  if (colsLower.has("isclosed"))
    exec(`UPDATE Pedidos SET isClosed = ? WHERE ${idCol} = ?`, [
      makeClosed ? 1 : 0,
      id,
    ]);
  if (colsLower.has("is_closed"))
    exec(`UPDATE Pedidos SET is_closed = ? WHERE ${idCol} = ?`, [
      makeClosed ? 1 : 0,
      id,
    ]);
  if (colsLower.has("cerrado"))
    exec(`UPDATE Pedidos SET cerrado = ? WHERE ${idCol} = ?`, [
      makeClosed ? 1 : 0,
      id,
    ]);
  if (colsLower.has("closedat"))
    exec(
      `UPDATE Pedidos SET ClosedAt = ${
        makeClosed ? "datetime('now')" : "NULL"
      } WHERE ${idCol} = ?`,
      [id]
    );
  if (colsLower.has("closed_at"))
    exec(
      `UPDATE Pedidos SET closed_at = ${
        makeClosed ? "datetime('now')" : "NULL"
      } WHERE ${idCol} = ?`,
      [id]
    );

  if (changes === 0) {
    console.warn(
      "[deposito] applyOrderStatus: no se modificó ninguna fila para el pedido",
      id
    );
  }
}

function applyOrderPrepare(id) {
  if (!hasTable("Pedidos")) throw new Error("Tabla 'Pedidos' inexistente");

  const colsLower = getTableColumnsLower("Pedidos");
  const idCol = detectIdColumn();
  if (!idCol) throw new Error("No se encontró columna ID en 'Pedidos'");

  let changes = 0;
  const exec = (sql, params = []) => {
    try {
      const info = db.prepare(sql).run(...params);
      changes += info.changes || 0;
    } catch (e) {
      console.warn(
        "[deposito] applyOrderPrepare columna opcional:",
        e.message
      );
    }
  };

  // Estado textual (preparación)
  if (colsLower.has("status"))
    exec(`UPDATE Pedidos SET status = ? WHERE ${idCol} = ?`, [
      "preparing",
      id,
    ]);
  if (colsLower.has("estado"))
    exec(`UPDATE Pedidos SET estado = ? WHERE ${idCol} = ?`, [
      "preparacion",
      id,
    ]);

  // Aseguramos que NO figure como cerrado
  if (colsLower.has("isclosed"))
    exec(`UPDATE Pedidos SET isClosed = ? WHERE ${idCol} = ?`, [0, id]);
  if (colsLower.has("is_closed"))
    exec(`UPDATE Pedidos SET is_closed = ? WHERE ${idCol} = ?`, [0, id]);
  if (colsLower.has("cerrado"))
    exec(`UPDATE Pedidos SET cerrado = ? WHERE ${idCol} = ?`, [0, id]);
  if (colsLower.has("closedat"))
    exec(`UPDATE Pedidos SET ClosedAt = NULL WHERE ${idCol} = ?`, [id]);
  if (colsLower.has("closed_at"))
    exec(`UPDATE Pedidos SET closed_at = NULL WHERE ${idCol} = ?`, [id]);

  if (changes === 0) {
    console.warn(
      "[deposito] applyOrderPrepare: no se modificó ninguna fila para el pedido",
      id
    );
  }
}

const makeStatusHandler = (makeClosed) => (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "id inválido" });
    }
    applyOrderStatus(id, makeClosed);
    return res.json({ ok: true, id });
  } catch (e) {
    console.error(
      `[deposito] ${makeClosed ? "close" : "reopen"} order:`,
      e
    );
    return res.status(500).json({
      error:
        e?.message ||
        `No se pudo ${makeClosed ? "cerrar" : "reabrir"} el pedido`,
    });
  }
};

const closeHandler = makeStatusHandler(true);
const reopenHandler = makeStatusHandler(false);

const prepareHandler = (req, res) => {
  console.log("[deposito] prepareHandler llamado", req.method, req.params.id);
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "id inválido" });
    }
    applyOrderPrepare(id);
    return res.json({ ok: true, id });
  } catch (e) {
    console.error("[deposito] prepare order:", e);
    return res.status(500).json({
      error: e?.message || "No se pudo pasar el pedido a preparación",
    });
  }
};

// Rutas de cambio de estado
router.put("/orders/:id/close", mustWarehouse, closeHandler);
router.put("/orders/close/:id", mustWarehouse, closeHandler);

router.put("/orders/:id/reopen", mustWarehouse, reopenHandler);
router.put("/orders/reopen/:id", mustWarehouse, reopenHandler);

router.put("/orders/:id/prepare", mustWarehouse, prepareHandler);
router.put("/orders/prepare/:id", mustWarehouse, prepareHandler);

/* ==================== 2) Analytics ==================== */
const TOP_SQL = `
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
`;

const LOW_SQL = `
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
`;

const mapTopRows = (rows) =>
  rows.map((r) => ({ ...r, total: Number(r.total || 0) }));

const mapLowRows = (rows) =>
  rows.map((r) => ({ ...r, stock: Number(r.stock || 0) }));

router.get("/top-consumidos", mustWarehouse, (req, res) => {
  try {
    const start = parseISO(req.query.start) || firstDayOfMonthISO();
    const end = parseISO(req.query.end) || todayISO();
    const limit = Math.min(
      parseInt(req.query.limit ?? "20", 10) || 20,
      200
    );

    if (!canUsePedidosProductos()) {
      console.warn("[deposito] /top-consumidos: tablas faltantes");
      return res.json({ start, end, rows: [] });
    }

    const rows = mapTopRows(
      db.prepare(TOP_SQL).all(start, end, limit)
    );

    return res.json({ start, end, rows });
  } catch (e) {
    console.error("[deposito] /top-consumidos error:", e);
    return res.status(500).json({
      error: "No se pudo calcular los productos más consumidos",
    });
  }
});

router.get("/low-stock", mustWarehouse, (req, res) => {
  try {
    const threshold =
      Math.max(parseInt(req.query.threshold ?? "10", 10) || 0, 0) || 10;
    const limit = Math.min(
      parseInt(req.query.limit ?? "200", 10) || 200,
      500
    );

    if (!hasTable("Productos") || !hasTable("Stock")) {
      console.warn("[deposito] /low-stock: tablas faltantes");
      return res.json({ threshold, rows: [] });
    }

    const rows = mapLowRows(
      db.prepare(LOW_SQL).all(threshold, limit)
    );

    return res.json({ threshold, rows });
  } catch (e) {
    console.error("[deposito] /low-stock error:", e);
    return res.status(500).json({
      error: "No se pudo listar los productos con stock bajo",
    });
  }
});

router.get(
  "/consumo-desde-ultimo-ingreso/:productId",
  mustWarehouse,
  (req, res) => {
    try {
      const productId = Number(req.params.productId);
      if (!Number.isFinite(productId)) {
        return res.status(400).json({ error: "productId inválido" });
      }

      const fallbackStart =
        parseISO(req.query.fallbackStart) || firstDayOfMonthISO();

      let lastIn = null;
      if (hasTable("stock_movements")) {
        try {
          const colsLower = getTableColumnsLower("stock_movements");

          const dateCol = ["timestamp", "created_at", "fecha", "date"].find(
            (c) => colsLower.has(c)
          );

          if (dateCol) {
            const lastInRow = db
              .prepare(
                `SELECT MAX(${dateCol}) AS ts FROM stock_movements WHERE product_id = ? AND qty > 0`
              )
              .get(productId);
            lastIn = lastInRow?.ts || null;
          } else {
            console.warn(
              "[deposito] consumo-desde-ultimo-ingreso: tabla stock_movements sin columna de fecha conocida; se omite para último ingreso"
            );
          }
        } catch (e) {
          console.warn(
            "[deposito] consumo-desde-ultimo-ingreso: error en stock_movements (opcional):",
            e.message
          );
        }
      }

      const startDate = (lastIn || fallbackStart).slice(0, 10);

      if (!hasTable("Pedidos") || !hasTable("PedidoItems")) {
        console.warn(
          "[deposito] consumo-desde-ultimo-ingreso: faltan tablas Pedidos/PedidoItems"
        );
        const incomingSafe = (() => {
          try {
            return getFutureIncomingForProduct(productId) || {
              incoming: 0,
              nextEta: null,
            };
          } catch {
            return { incoming: 0, nextEta: null };
          }
        })();

        return res.json({
          productId,
          last_ingreso: lastIn,
          start: startDate,
          consumido: 0,
          first_date: null,
          last_date: null,
          incoming_total: Number(incomingSafe.incoming || 0),
          next_eta: incomingSafe.nextEta || null,
        });
      }

      const consumoRow = db
        .prepare(
          `
        SELECT
          COALESCE(SUM(pi.Cantidad),0) AS consumido,
          MIN(date(pe.Fecha))          AS first_date,
          MAX(date(pe.Fecha))          AS last_date
        FROM PedidoItems pi
        JOIN Pedidos pe ON pe.PedidoID = pi.PedidoID
        WHERE pi.ProductoID = ?
          AND date(pe.Fecha) >= date(?)
      `
        )
        .get(productId, startDate);

      let incoming;
      try {
        incoming =
          getFutureIncomingForProduct(productId) || {
            incoming: 0,
            nextEta: null,
          };
      } catch (e) {
        console.warn(
          "[deposito] consumo-desde-ultimo-ingreso: error en IncomingStock:",
          e.message
        );
        incoming = { incoming: 0, nextEta: null };
      }

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
      console.error(
        "[deposito] /consumo-desde-ultimo-ingreso error:",
        e
      );
      return res.status(500).json({
        error: "No se pudo calcular el consumo desde el último ingreso",
      });
    }
  }
);

router.get("/overview", mustWarehouse, (req, res) => {
  try {
    const start = parseISO(req.query.start) || firstDayOfMonthISO();
    const end = parseISO(req.query.end) || todayISO();
    const threshold =
      Math.max(parseInt(req.query.threshold ?? "10", 10) || 0, 0) || 10;

    if (!canUsePedidosProductos()) {
      console.warn("[deposito] /overview: tablas faltantes");
      return res.json({ start, end, threshold, top: [], low: [] });
    }

    const top = mapTopRows(db.prepare(TOP_SQL).all(start, end, 20));

    let low = [];
    if (hasTable("Stock")) {
      low = mapLowRows(
        db.prepare(LOW_SQL).all(threshold, 200)
      );
    }

    return res.json({ start, end, threshold, top, low });
  } catch (e) {
    console.error("[deposito] /overview error:", e);
    return res.status(500).json({
      error: "No se pudo construir el resumen de Depósito",
    });
  }
});

/* ------------------------------- Selfcheck ------------------------------- */
router.get("/_selfcheck", requireAuth, (_req, res) => {
  try {
    const has = (name) =>
      !!db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
        )
        .get(name);
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

// exportamos esta función para usarla en index.js si hace falta ruta directa
export { applyOrderPrepare };

export default router;
