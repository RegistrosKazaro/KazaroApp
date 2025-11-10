// server/src/routes/deposito.js
import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { db, getFutureIncomingForProduct } from "../db.js";

const router = Router();

// Solo rol "Deposito" (o "Admin") puede entrar
const mustWarehouse = [requireAuth, requireRole(["deposito", "admin"])];

// Helpers de fecha
function parseISO(d) {
  if (!d) return null;
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  // YYYY-MM-DD
  return x.toISOString().slice(0, 10);
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function firstDayOfMonthISO(dt = new Date()) {
  const d = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1));
  return d.toISOString().slice(0, 10);
}

/**
 * GET /deposito/top-consumidos?start=YYYY-MM-DD&end=YYYY-MM-DD&limit=20
 * Usa Pedidos + PedidoItems para ver los productos más consumidos en el período.
 */
router.get("/top-consumidos", mustWarehouse, (req, res) => {
  try {
    const start = parseISO(req.query.start) || firstDayOfMonthISO();
    const end = parseISO(req.query.end) || todayISO();
    const limit = Math.min(parseInt(req.query.limit ?? "20", 10) || 20, 200);

    const rows = db
      .prepare(
        `
        SELECT
          pi.ProductoID AS productId,
          p.ProductName AS name,
          COALESCE(p.Unit, '') AS unit,
          COALESCE(p.Code, '') AS code,
          SUM(pi.Cantidad) AS total
        FROM PedidoItems pi
        JOIN Pedidos pe ON pe.PedidoID = pi.PedidoID
        JOIN Productos p ON p.ProductID = pi.ProductoID
        WHERE date(pe.Fecha) BETWEEN date(?) AND date(?)
        GROUP BY pi.ProductoID
        ORDER BY total DESC
        LIMIT ?
      `,
      )
      .all(start, end, limit)
      .map((r) => ({ ...r, total: Number(r.total || 0) }));

    return res.json({ start, end, rows });
  } catch (e) {
    console.error("[deposito] /top-consumidos error:", e);
    return res
      .status(500)
      .json({ error: "No se pudo calcular los productos más consumidos" });
  }
});

/**
 * GET /deposito/low-stock?threshold=10&limit=200
 * Lista productos con stock bajo, usando Productos + Stock.
 */
router.get("/low-stock", mustWarehouse, (req, res) => {
  try {
    const threshold =
      Math.max(0, parseInt(req.query.threshold ?? "10", 10) || 10);
    const limit = Math.min(parseInt(req.query.limit ?? "200", 10) || 200, 500);

    const rows = db
      .prepare(
        `
        SELECT
          p.ProductID AS productId,
          p.ProductName AS name,
          COALESCE(p.Unit, '') AS unit,
          COALESCE(p.Code, '') AS code,
          COALESCE(s.CantidadActual, p.Stock, 0) AS stock
        FROM Productos p
        LEFT JOIN Stock s ON s.ProductoID = p.ProductID
        WHERE COALESCE(s.CantidadActual, p.Stock, 0) <= ?
        ORDER BY stock ASC, name COLLATE NOCASE
        LIMIT ?
      `,
      )
      .all(threshold, limit)
      .map((r) => ({ ...r, stock: Number(r.stock || 0) }));

    return res.json({ threshold, rows });
  } catch (e) {
    console.error("[deposito] /low-stock error:", e);
    return res
      .status(500)
      .json({ error: "No se pudo listar los productos con stock bajo" });
  }
});

/**
 * GET /deposito/consumo-desde-ultimo-ingreso/:productId?fallbackStart=YYYY-MM-DD
 *
 * - Busca el último ingreso en stock_movements (qty > 0).
 * - Si aún no hay movimientos, usa fallbackStart (por defecto, primer día del mes).
 * - Calcula consumo desde esa fecha con Pedidos + PedidoItems.
 * - Devuelve también los ingresos futuros desde IncomingStock (vía getFutureIncomingForProduct).
 */
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

      // Último ingreso real registrado en stock_movements (qty > 0)
      const lastInRow = db
        .prepare(
          `
          SELECT MAX(timestamp) AS ts
          FROM stock_movements
          WHERE product_id = ? AND qty > 0
        `,
        )
        .get(productId);

      const lastIn = lastInRow?.ts || null;
      const startDate = (lastIn || fallbackStart).slice(0, 10);

      // Consumo = sumatoria de cantidades de PedidoItems desde esa fecha
      const consumoRow = db
        .prepare(
          `
          SELECT
            COALESCE(SUM(pi.Cantidad), 0) AS consumido,
            MIN(date(pe.Fecha)) AS first_date,
            MAX(date(pe.Fecha)) AS last_date
          FROM PedidoItems pi
          JOIN Pedidos pe ON pe.PedidoID = pi.PedidoID
          WHERE pi.ProductoID = ?
            AND date(pe.Fecha) >= date(?)
        `,
        )
        .get(productId, startDate);

      // Ingresos futuros desde IncomingStock (sección Futuro Ingreso)
      const incoming = getFutureIncomingForProduct(productId) || {
        incoming: 0,
        nextEta: null,
      };

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
        e,
      );
      return res
        .status(500)
        .json({ error: "No se pudo calcular el consumo desde el último ingreso" });
    }
  },
);

/**
 * GET /deposito/overview?start&end&threshold
 * Devuelve todo junto para renderizar rápido:
 *  - top: más consumidos
 *  - low: stock bajo
 */
router.get("/overview", mustWarehouse, (req, res) => {
  try {
    const start = parseISO(req.query.start) || firstDayOfMonthISO();
    const end = parseISO(req.query.end) || todayISO();
    const threshold =
      Math.max(0, parseInt(req.query.threshold ?? "10", 10) || 10);

    const top = db
      .prepare(
        `
        SELECT
          pi.ProductoID AS productId,
          p.ProductName AS name,
          COALESCE(p.Unit, '') AS unit,
          COALESCE(p.Code, '') AS code,
          SUM(pi.Cantidad) AS total
        FROM PedidoItems pi
        JOIN Pedidos pe ON pe.PedidoID = pi.PedidoID
        JOIN Productos p ON p.ProductID = pi.ProductoID
        WHERE date(pe.Fecha) BETWEEN date(?) AND date(?)
        GROUP BY pi.ProductoID
        ORDER BY total DESC
        LIMIT 20
      `,
      )
      .all(start, end)
      .map((r) => ({ ...r, total: Number(r.total || 0) }));

    const low = db
      .prepare(
        `
        SELECT
          p.ProductID AS productId,
          p.ProductName AS name,
          COALESCE(p.Unit, '') AS unit,
          COALESCE(p.Code, '') AS code,
          COALESCE(s.CantidadActual, p.Stock, 0) AS stock
        FROM Productos p
        LEFT JOIN Stock s ON s.ProductoID = p.ProductID
        WHERE COALESCE(s.CantidadActual, p.Stock, 0) <= ?
        ORDER BY stock ASC, name COLLATE NOCASE
        LIMIT 200
      `,
      )
      .all(threshold)
      .map((r) => ({ ...r, stock: Number(r.stock || 0) }));

    return res.json({ start, end, threshold, top, low });
  } catch (e) {
    console.error("[deposito] /overview error:", e);
    return res
      .status(500)
      .json({ error: "No se pudo construir el resumen de Depósito" });
  }
});

/**
 * Sanity check: confirma que las tablas clave existen
 */
router.get("/_selfcheck", requireAuth, (_req, res) => {
  try {
    const hasPedidos = !!db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='Pedidos'`,
      )
      .get();
    const hasPedidoItems = !!db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='PedidoItems'`,
      )
      .get();
    const hasProductos = !!db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='Productos'`,
      )
      .get();
    const hasStock = !!db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='Stock'`,
      )
      .get();
    const hasMov = !!db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='stock_movements'`,
      )
      .get();
    const hasIncoming = !!db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='IncomingStock'`,
      )
      .get();

    return res.json({
      ok: hasPedidos && hasPedidoItems && hasProductos,
      tables: {
        Pedidos: hasPedidos,
        PedidoItems: hasPedidoItems,
        Productos: hasProductos,
        Stock: hasStock,
        stock_movements: hasMov,
        IncomingStock: hasIncoming,
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

export default router;
