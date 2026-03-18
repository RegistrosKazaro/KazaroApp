// server/src/routes/reports.js
import { Router } from "express";
import {
  db,
  getBudgetByServiceId,
  getServiceNameById,
  getServiceById,
} from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const mustBeAdmin = [requireAuth, requireRole(["admin", "Admin"])];

function _tinfo(table) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all();
  } catch {
    return [];
  }
}

function _norm(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function _pickCol(info, candidates) {
  const names = info.map((c) => c.name);
  for (const cand of candidates) {
    const n = names.find((nm) => _norm(nm) === _norm(cand));
    if (n) return n;
  }
  return null;
}

function resolveServicesTableLocal() {
  const table = "Servicios";
  const info = _tinfo(table);
  if (!info.length) return null;

  const idCol =
    _pickCol(info, [
      "ServiciosID",
      "ServicioID",
      "IdServicio",
      "ServiceID",
      "service_id",
      "servicio_id",
      "id",
    ]) ||
    info.find((c) => c.pk === 1)?.name ||
    "ServiciosID";

  const nameCol =
    _pickCol(info, [
      "ServicioNombre",
      "Nombre",
      "Servicio",
      "Descripcion",
      "Detalle",
      "Titulo",
      "NombreServicio",
    ]) || idCol;

  const nameExpr = `COALESCE(NULLIF(TRIM(s.${nameCol}), ''), CAST(s.${idCol} AS TEXT))`;
  return { table, idCol, nameCol, nameExpr };
}

function monthRange(y, m) {
  const now = new Date();
  const year = Number(y) || now.getFullYear();
  const month = Number(m) || now.getMonth() + 1;
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  const fmt = (d) => d.toISOString().slice(0, 19).replace("T", " ");
  return { year, month, start: fmt(start), end: fmt(end) };
}

/**
 * Resuelve nombre de servicio con fallbacks seguros,
 * usando helpers de db.js sin romper nada.
 */
function resolveServiceName(servicioId) {
  const sid = String(servicioId ?? "").trim();
  if (!sid) return "—";
  const key = /^\d+$/.test(sid) ? Number(sid) : sid;

  try {
    return (
      getServiceNameById(key) || // intento directo
      getServiceById(key)?.name || // fallback por búsqueda completa
      "—"
    );
  } catch {
    // por si getServiceById lanza algo
    return getServiceNameById(key) || "—";
  }
}

/* ======================= LISTA DE SERVICIOS ======================= */

router.get("/services", mustBeAdmin, (_req, res) => {
  const spec = resolveServicesTableLocal();

  // Ruta "bonita" con tabla Servicios detectada
  if (spec) {
    try {
      const rows = db
        .prepare(
          `
        SELECT CAST(s.${spec.idCol} AS TEXT) AS id,
               ${spec.nameExpr}                AS name
        FROM ${spec.table} s
        ORDER BY name COLLATE NOCASE
      `
        )
        .all();

      return res.json(rows.map((r) => ({ id: r.id, name: r.name })));
    } catch (e) {
      console.error("[reports] GET /services error:", e);
      // cae al fallback de abajo
    }
  }

  // Fallback: servicios vistos sólo en Pedidos
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

    return res.json(
      rows.map((r) => ({
        id: r.id,
        name: resolveServiceName(r.id),
      }))
    );
  } catch (e) {
    console.error("[reports] GET /services fallback error:", e);
    return res.json([]);
  }
});

/* ======================= INFORME MENSUAL GLOBAL ======================= */

router.get("/monthly", mustBeAdmin, (req, res) => {
  const { year, month, start, end } = (() => {
    const r = monthRange(req.query.year, req.query.month);
    return { ...r, start: r.start, end: r.end };
  })();

  try {
    // Totales generales del período
    const totals = (() => {
      const ordersCount =
        db
          .prepare(
            `
        SELECT COUNT(*) AS c
        FROM Pedidos
        WHERE Fecha >= ? AND Fecha < ?
      `
          )
          .get(start, end)?.c || 0;

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
        db
          .prepare(
            `
        SELECT COALESCE(SUM(Total),0) AS s
        FROM Pedidos
        WHERE Fecha >= ? AND Fecha < ?
      `
          )
          .get(start, end)?.s || 0;

      return {
        ordersCount: Number(ordersCount),
        itemsCount: Number(itemsCount),
        amount: Number(amount),
      };
    })();

    // Top servicios por monto
    const top_services_raw = db
      .prepare(
        `
      SELECT COALESCE(p.ServicioID,'')           AS serviceId,
             COUNT(DISTINCT p.PedidoID)          AS pedidos,
             COALESCE(SUM(i.Cantidad),0)         AS qty,
             COALESCE(SUM(i.Subtotal),0)         AS amount
      FROM Pedidos p
      LEFT JOIN PedidoItems i ON i.PedidoID = p.PedidoID
      WHERE p.Fecha >= ? AND p.Fecha < ?
      GROUP BY p.ServicioID
      ORDER BY amount DESC
      LIMIT 10
    `
      )
      .all(start, end);

    const top_services = top_services_raw.map((r) => ({
      serviceId: r.serviceId || null,
      serviceName: resolveServiceName(r.serviceId),
      pedidos: Number(r.pedidos || 0),
      qty: Number(r.qty || 0),
      amount: Number(r.amount || 0),
    }));

    // Top productos por monto
    const top_products = db
      .prepare(
        `
      SELECT COALESCE(i.ProductoID, 0)          AS productId,
             COALESCE(MAX(i.Codigo), '')        AS code,
             COALESCE(MAX(i.Nombre), '')        AS name,
             COUNT(DISTINCT i.PedidoID)         AS pedidos,
             COALESCE(SUM(i.Cantidad),0)        AS qty,
             COALESCE(SUM(i.Subtotal),0)        AS amount
      FROM PedidoItems i
      JOIN Pedidos p ON p.PedidoID = i.PedidoID
      WHERE p.Fecha >= ? AND p.Fecha < ?
      GROUP BY i.ProductoID, LOWER(i.Nombre), LOWER(i.Codigo)
      ORDER BY amount DESC
      LIMIT 10
    `
      )
      .all(start, end)
      .map((r) => ({
        productId: Number(r.productId || 0),
        code: String(r.code || ""),
        name: String(r.name || ""),
        pedidos: Number(r.pedidos || 0),
        qty: Number(r.qty || 0),
        amount: Number(r.amount || 0),
      }));

    // Evolución diaria
    const by_day = db
      .prepare(
        `
      SELECT SUBSTR(p.Fecha,1,10)              AS day,
             COUNT(*)                          AS pedidos,
             COALESCE(SUM(p.Total),0)          AS monto
      FROM Pedidos p
      WHERE p.Fecha >= ? AND p.Fecha < ?
      GROUP BY day
      ORDER BY day
    `
      )
      .all(start, end)
      .map((r) => ({
        day: r.day,
        pedidos: Number(r.pedidos || 0),
        monto: Number(r.monto || 0),
      }));

    // Totales del mes anterior (para comparativa ▲▼)
    const prevMonthRange = (() => {
      let pm = month - 1, py = year;
      if (pm <= 0) { pm = 12; py--; }
      return monthRange(py, pm);
    })();

    const prev_totals = (() => {
      try {
        const ordersCount = db.prepare(`
          SELECT COUNT(*) AS c FROM Pedidos
          WHERE Fecha >= ? AND Fecha < ?
        `).get(prevMonthRange.start, prevMonthRange.end)?.c || 0;

        const itemsCount = db.prepare(`
          SELECT COALESCE(SUM(i.Cantidad),0) AS c
          FROM PedidoItems i
          JOIN Pedidos p ON p.PedidoID = i.PedidoID
          WHERE p.Fecha >= ? AND p.Fecha < ?
        `).get(prevMonthRange.start, prevMonthRange.end)?.c || 0;

        const amount = db.prepare(`
          SELECT COALESCE(SUM(Total),0) AS s FROM Pedidos
          WHERE Fecha >= ? AND Fecha < ?
        `).get(prevMonthRange.start, prevMonthRange.end)?.s || 0;

        return {
          ordersCount: Number(ordersCount),
          itemsCount:  Number(itemsCount),
          amount:      Number(amount),
        };
      } catch {
        return null;
      }
    })();

    return res.json({
      ok: true,
      period: { year, month, start, end },
      totals,
      top_services,
      top_products,
      by_day,
      prev_totals,
    });
  } catch (e) {
    console.error("[reports] GET /monthly error:", e);
    return res
      .status(500)
      .json({ error: "No se pudo construir el informe" });
  }
});

/* ======================= FORECAST (PRÓXIMO MES) ======================= */

function shiftMonth(year, month, delta) {
  let y = Number(year);
  let m = Number(month);
  m += delta;
  while (m <= 0) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return { year: y, month: m };
}

function normalizeWeights(weights, n) {
  const w = weights.slice(0, n);
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  return w.map((x) => x / sum);
}

function wma(series, key, weights) {
  const w = normalizeWeights(weights, series.length);
  let out = 0;
  for (let i = 0; i < series.length; i++) {
    out += Number(series[i][key] || 0) * w[i];
  }
  return out;
}

function totalsForRange(start, end, serviceId) {
  const hasService = String(serviceId ?? "").trim() !== "";

  const ordersCount = hasService
    ? (db.prepare(`
        SELECT COUNT(*) AS c
        FROM Pedidos
        WHERE Fecha >= ? AND Fecha < ?
          AND CAST(ServicioID AS TEXT) = CAST(? AS TEXT)
      `).get(start, end, serviceId)?.c || 0)
    : (db.prepare(`
        SELECT COUNT(*) AS c
        FROM Pedidos
        WHERE Fecha >= ? AND Fecha < ?
      `).get(start, end)?.c || 0);

  const itemsCount = hasService
    ? (db.prepare(`
        SELECT COALESCE(SUM(i.Cantidad),0) AS c
        FROM PedidoItems i
        JOIN Pedidos p ON p.PedidoID = i.PedidoID
        WHERE p.Fecha >= ? AND p.Fecha < ?
          AND CAST(p.ServicioID AS TEXT) = CAST(? AS TEXT)
      `).get(start, end, serviceId)?.c || 0)
    : (db.prepare(`
        SELECT COALESCE(SUM(i.Cantidad),0) AS c
        FROM PedidoItems i
        JOIN Pedidos p ON p.PedidoID = i.PedidoID
        WHERE p.Fecha >= ? AND p.Fecha < ?
      `).get(start, end)?.c || 0);

  const amount = hasService
    ? (db.prepare(`
        SELECT COALESCE(SUM(Total),0) AS s
        FROM Pedidos
        WHERE Fecha >= ? AND Fecha < ?
          AND CAST(ServicioID AS TEXT) = CAST(? AS TEXT)
      `).get(start, end, serviceId)?.s || 0)
    : (db.prepare(`
        SELECT COALESCE(SUM(Total),0) AS s
        FROM Pedidos
        WHERE Fecha >= ? AND Fecha < ?
      `).get(start, end)?.s || 0);

  return {
    ordersCount: Number(ordersCount),
    itemsCount: Number(itemsCount),
    amount: Number(amount),
  };
}

router.get("/forecast", mustBeAdmin, (req, res) => {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    const serviceId = req.query.serviceId ? String(req.query.serviceId) : "";

    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({ error: "Parámetros inválidos: year, month" });
    }

    const weights = [0.5, 0.3, 0.2];

    const p1 = shiftMonth(year, month, -1);
    const p2 = shiftMonth(year, month, -2);
    const p3 = shiftMonth(year, month, -3);

    const r1 = monthRange(p1.year, p1.month);
    const r2 = monthRange(p2.year, p2.month);
    const r3 = monthRange(p3.year, p3.month);

    const s1 = totalsForRange(r1.start, r1.end, serviceId);
    const s2 = totalsForRange(r2.start, r2.end, serviceId);
    const s3 = totalsForRange(r3.start, r3.end, serviceId);

    const series = [
      { year: p1.year, month: p1.month, ...s1 },
      { year: p2.year, month: p2.month, ...s2 },
      { year: p3.year, month: p3.month, ...s3 },
    ].filter(x => x.ordersCount || x.itemsCount || x.amount);

    const forecast = series.length
      ? {
          ordersCount: wma(series, "ordersCount", weights),
          itemsCount: wma(series, "itemsCount", weights),
          amount: wma(series, "amount", weights),
        }
      : { ordersCount: 0, itemsCount: 0, amount: 0 };

    return res.json({
      ok: true,
      target: { year, month },
      serviceId: serviceId || null,
      series,
      forecast,
      method: "WMA_3",
      weights,
    });
  } catch (e) {
    console.error("[reports] GET /forecast error:", e);
    return res.status(500).json({ error: "No se pudo generar el forecast" });
  }
});
/* ======================= INFORME POR SERVICIO ======================= */

router.get("/forecast", (req, res) => {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    const serviceId = req.query.serviceId ? String(req.query.serviceId) : "";

    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({ error: "Parámetros inválidos: year, month" });
    }

    // Pesos: mes -1, -2, -3 (más peso al reciente)
    const weights = [0.5, 0.3, 0.2];

    // Target: (year, month). Usamos 3 meses anteriores para predecir ese target.
    const p1 = shiftMonth(year, month, -1);
    const p2 = shiftMonth(year, month, -2);
    const p3 = shiftMonth(year, month, -3);

    const r1 = monthRange(p1.year, p1.month);
    const r2 = monthRange(p2.year, p2.month);
    const r3 = monthRange(p3.year, p3.month);

    const s1 = totalsForRange(r1.start, r1.end, serviceId);
    const s2 = totalsForRange(r2.start, r2.end, serviceId);
    const s3 = totalsForRange(r3.start, r3.end, serviceId);

    // Serie en orden "más reciente primero" para que coincida con weights
    const series = [
      { year: p1.year, month: p1.month, ...s1 },
      { year: p2.year, month: p2.month, ...s2 },
      { year: p3.year, month: p3.month, ...s3 },
    ].filter(x => x.ordersCount || x.itemsCount || x.amount);

    const forecast = series.length
      ? {
          ordersCount: wma(series, "ordersCount", weights),
          itemsCount: wma(series, "itemsCount", weights),
          amount: wma(series, "amount", weights),
        }
      : { ordersCount: 0, itemsCount: 0, amount: 0 };

    return res.json({
      ok: true,
      target: { year, month },
      serviceId: serviceId || null,
      series,
      forecast,
      method: "WMA_3",
      weights,
    });
  } catch (e) {
    console.error("[reports] GET /forecast error:", e);
    return res.status(500).json({ error: "No se pudo generar el forecast" });
  }
});

/* ======================= TRAZABILIDAD BASE ======================= */

function resolveProductsTableLocal() {
  const table = "Productos";
  const info = _tinfo(table);
  if (!info.length) return null;

  const idCol =
    _pickCol(info, [
      "ProductosID",
      "ProductoID",
      "IdProducto",
      "product_id",
      "producto_id",
      "id",
    ]) ||
    info.find((c) => c.pk === 1)?.name ||
    "ProductoID";

  const codeCol =
    _pickCol(info, [
      "Codigo",
      "Code",
      "SKU",
      "sku",
      "codigo",
    ]) || null;

  const priceCol =
    _pickCol(info, [
      "Precio",
      "PrecioUnitario",
      "price",
      "precio",
    ]) || null;

  const stockCol =
    _pickCol(info, [
      "Stock",
      "Existencia",
      "Cantidad",
      "Disponibilidad",
      "stock",
    ]) || null;

  // Buscar nombre real con más variantes posibles
  let nameCol = _pickCol(info, [
    "Nombre",
    "Producto",
    "ProductoNombre",
    "NombreProducto",
    "Descripcion",
    "Descripción",
    "Detalle",
    "Denominacion",
    "Denominación",
    "Articulo",
    "Artículo",
    "Item",
    "Insumo",
    "name",
  ]);

  // Si no encontró una columna conocida, elegir la primera columna de texto
  // que no sea ID, código, precio ni stock
  if (!nameCol) {
    const excluded = new Set([idCol, codeCol, priceCol, stockCol].filter(Boolean).map(String));
    const textCandidate = info.find((c) => {
      const n = String(c.name || "");
      const t = String(c.type || "").toUpperCase();
      if (excluded.has(n)) return false;
      return t.includes("CHAR") || t.includes("TEXT") || t.includes("CLOB") || t === "";
    });
    if (textCandidate) nameCol = textCandidate.name;
  }

  // Último fallback: nunca volver al ID si existe código
  if (!nameCol) nameCol = codeCol || idCol;

  return { table, idCol, nameCol, codeCol, priceCol, stockCol };
}

function resolveEmployeesTableLocal() {
  const table = "Empleados";
  const info = _tinfo(table);
  if (!info.length) return null;

  const idCol =
    _pickCol(info, [
      "EmpleadosID",
      "EmpleadoID",
      "IdEmpleado",
      "empleado_id",
      "user_id",
      "id",
    ]) ||
    info.find((c) => c.pk === 1)?.name ||
    "EmpleadoID";

  const nameCol =
    _pickCol(info, [
      "Nombre",
      "nombre",
      "username",
      "usuario",
      "Usuario",
      "user",
      "ApellidoNombre",
      "Name",
    ]) || idCol;

  return { table, idCol, nameCol };
}

router.get("/traceability", mustBeAdmin, (req, res) => {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    const top = Math.max(1, Math.min(8, Number(req.query.top) || 8));

    const { start, end } = monthRange(year, month);

    const prod = resolveProductsTableLocal();
    const srv = resolveServicesTableLocal();
    const emp = resolveEmployeesTableLocal();

    /* ===================== SALIDAS DEL MES ===================== */
    const outgoing = db.prepare(`
      SELECT
        i.ProductoID AS productId,
        COALESCE(NULLIF(TRIM(i.Codigo), ''), '') AS code,
        COALESCE(NULLIF(TRIM(i.Nombre), ''), 'Sin nombre') AS name,
        COUNT(DISTINCT p.PedidoID) AS pedidos,
        COALESCE(SUM(i.Cantidad), 0) AS qty,
        COALESCE(SUM(i.Subtotal), 0) AS amount
      FROM PedidoItems i
      JOIN Pedidos p ON p.PedidoID = i.PedidoID
      WHERE p.Fecha >= ? AND p.Fecha < ?
      GROUP BY i.ProductoID, LOWER(i.Nombre), LOWER(i.Codigo)
      ORDER BY qty DESC, amount DESC
    `).all(start, end).map((r) => ({
      productId: Number(r.productId || 0),
      code: String(r.code || ""),
      name: String(r.name || ""),
      pedidos: Number(r.pedidos || 0),
      qty: Number(r.qty || 0),
      amount: Number(r.amount || 0),
    }));

    const totalOutgoing = outgoing.reduce((acc, row) => {
      acc.qty += Number(row.qty || 0);
      acc.amount += Number(row.amount || 0);
      return acc;
    }, { qty: 0, amount: 0 });

    /* ===================== TOP USADOS ===================== */
    const topUsed = [...outgoing]
      .sort((a, b) => Number(b.qty || 0) - Number(a.qty || 0))
      .slice(0, top);

    /* ===================== TOP CAROS ===================== */
    let topExpensive = [];
    if (prod && prod.priceCol) {
      topExpensive = db.prepare(`
        SELECT
          p.${prod.idCol} AS productId,
          COALESCE(NULLIF(TRIM(p.${prod.nameCol}), ''), 'Sin nombre') AS name,
          ${prod.codeCol ? `COALESCE(NULLIF(TRIM(p.${prod.codeCol}), ''), '')` : `''`} AS code,
          COALESCE(p.${prod.priceCol}, 0) AS unitPrice,
          ${prod.stockCol ? `COALESCE(p.${prod.stockCol}, 0)` : `0`} AS stock
        FROM ${prod.table} p
        ORDER BY unitPrice DESC, name ASC
        LIMIT ?
      `).all(top).map((r) => ({
        productId: Number(r.productId || 0),
        code: String(r.code || ""),
        name: String(r.name || ""),
        unitPrice: Number(r.unitPrice || 0),
        stock: Number(r.stock || 0),
        totalSpentInPeriod: (() => {
          const out = outgoing.find(x => String(x.productId) === String(r.productId));
          return out ? Number(out.amount || 0) : 0;
        })(),
        qtyOutInPeriod: (() => {
          const out = outgoing.find(x => String(x.productId) === String(r.productId));
          return out ? Number(out.qty || 0) : 0;
        })(),
      }));
    }

    /* ===================== INGRESOS DEL MES ===================== */
    let incoming = [];
    if (prod) {
      incoming = db.prepare(`
        SELECT
          inc.product_id AS productId,
          COALESCE(NULLIF(TRIM(p.${prod.nameCol}), ''), 'Sin nombre') AS name,
          ${prod.codeCol ? `COALESCE(NULLIF(TRIM(p.${prod.codeCol}), ''), '')` : `''`} AS code,
          COALESCE(SUM(inc.qty), 0) AS qty,
          ${prod.priceCol ? `COALESCE(p.${prod.priceCol}, 0)` : `0`} AS unitPrice,
          ${prod.stockCol ? `COALESCE(p.${prod.stockCol}, 0)` : `0`} AS stock
        FROM IncomingStock inc
        LEFT JOIN ${prod.table} p ON CAST(p.${prod.idCol} AS TEXT) = CAST(inc.product_id AS TEXT)
        WHERE inc.eta >= ? AND inc.eta < ?
        GROUP BY inc.product_id, p.${prod.nameCol}
        ORDER BY qty DESC
      `).all(start, end).map((r) => ({
        productId: Number(r.productId || 0),
        code: String(r.code || ""),
        name: String(r.name || ""),
        qty: Number(r.qty || 0),
        unitPrice: Number(r.unitPrice || 0),
        amount: Number(r.qty || 0) * Number(r.unitPrice || 0),
        stock: Number(r.stock || 0),
      }));
    }

    const totalIncoming = incoming.reduce((acc, row) => {
      acc.qty += Number(row.qty || 0);
      acc.amount += Number(row.amount || 0);
      return acc;
    }, { qty: 0, amount: 0 });

    /* ===================== DESTINO POR SERVICIO ===================== */
    let byService = [];
    if (srv) {
      byService = db.prepare(`
        SELECT
          CAST(p.ServicioID AS TEXT) AS serviceId,
          ${srv.nameExpr} AS serviceName,
          COUNT(DISTINCT p.PedidoID) AS pedidos,
          COALESCE(SUM(i.Cantidad), 0) AS qty,
          COALESCE(SUM(i.Subtotal), 0) AS amount
        FROM Pedidos p
        JOIN PedidoItems i ON i.PedidoID = p.PedidoID
        LEFT JOIN ${srv.table} s ON CAST(s.${srv.idCol} AS TEXT) = CAST(p.ServicioID AS TEXT)
        WHERE p.Fecha >= ? AND p.Fecha < ?
        GROUP BY p.ServicioID
        ORDER BY amount DESC, qty DESC
      `).all(start, end).map((r) => ({
        serviceId: String(r.serviceId || ""),
        serviceName: String(r.serviceName || "—"),
        pedidos: Number(r.pedidos || 0),
        qty: Number(r.qty || 0),
        amount: Number(r.amount || 0),
        pctAmount: totalOutgoing.amount > 0 ? (Number(r.amount || 0) / totalOutgoing.amount) * 100 : 0,
      }));
    }

    /* ===================== RANKING DE SOLICITANTES / SUPERVISORES ===================== */
    let supervisors = [];
    if (emp) {
      supervisors = db.prepare(`
        SELECT
          CAST(p.EmpleadoID AS TEXT) AS employeeId,
          COALESCE(NULLIF(TRIM(e.${emp.nameCol}), ''), CAST(p.EmpleadoID AS TEXT)) AS employeeName,
          COUNT(DISTINCT p.PedidoID) AS pedidos,
          COALESCE(SUM(i.Cantidad), 0) AS qty,
          COALESCE(SUM(i.Subtotal), 0) AS amount
        FROM Pedidos p
        JOIN PedidoItems i ON i.PedidoID = p.PedidoID
        LEFT JOIN ${emp.table} e ON CAST(e.${emp.idCol} AS TEXT) = CAST(p.EmpleadoID AS TEXT)
        WHERE p.Fecha >= ? AND p.Fecha < ?
        GROUP BY p.EmpleadoID
        ORDER BY pedidos DESC, qty DESC, amount DESC
      `).all(start, end).map((r) => ({
        employeeId: String(r.employeeId || ""),
        employeeName: String(r.employeeName || "—"),
        pedidos: Number(r.pedidos || 0),
        qty: Number(r.qty || 0),
        amount: Number(r.amount || 0),
      }));
    }

    /* ===================== STOCK BAJO EN TOP USADOS ===================== */
    let stockAlerts = [];
    if (prod && prod.stockCol) {
      const usedIds = topUsed.map(x => x.productId).filter(Boolean);
      if (usedIds.length) {
        const placeholders = usedIds.map(() => "?").join(",");
        stockAlerts = db.prepare(`
          SELECT
            p.${prod.idCol} AS productId,
            COALESCE(NULLIF(TRIM(p.${prod.nameCol}), ''), 'Sin nombre') AS name,
            ${prod.codeCol ? `COALESCE(NULLIF(TRIM(p.${prod.codeCol}), ''), '')` : `''`} AS code,
            COALESCE(p.${prod.stockCol}, 0) AS stock,
            ${prod.priceCol ? `COALESCE(p.${prod.priceCol}, 0)` : `0`} AS unitPrice
          FROM ${prod.table} p
          WHERE p.${prod.idCol} IN (${placeholders})
          ORDER BY stock ASC, name ASC
        `).all(...usedIds).map((r) => ({
          productId: Number(r.productId || 0),
          code: String(r.code || ""),
          name: String(r.name || ""),
          stock: Number(r.stock || 0),
          unitPrice: Number(r.unitPrice || 0),
        }));
      }
    }

    return res.json({
      ok: true,
      period: { year, month, start, end },
      summary: {
        totalIncomingQty: totalIncoming.qty,
        totalIncomingAmount: totalIncoming.amount,
        totalOutgoingQty: totalOutgoing.qty,
        totalOutgoingAmount: totalOutgoing.amount,
        balanceQty: totalIncoming.qty - totalOutgoing.qty,
        balanceAmount: totalIncoming.amount - totalOutgoing.amount,
      },
      incoming,
      outgoing,
      topUsed,
      topExpensive,
      byService,
      supervisors,
      stockAlerts,
    });
  } catch (e) {
    console.error("[reports] GET /traceability error:", e);
    return res.status(500).json({ error: "No se pudo construir la trazabilidad" });
  }
});

/* ======================= INFORME POR SERVICIO ======================= */

router.get("/service/:serviceId", mustBeAdmin, (req, res) => {
  const servicioId = req.params.serviceId;

  const { year, month, start, end } = (() => {
    const r = monthRange(req.query.year, req.query.month);
    const startQ = req.query.start
      ? String(req.query.start).trim() + " 00:00:00"
      : r.start;
    const endQ = req.query.end
      ? String(req.query.end).trim() + " 23:59:59"
      : r.end;
    return { ...r, start: startQ, end: endQ };
  })();

  try {
    const serviceName = resolveServiceName(servicioId);

    // Totales del servicio
    const totals = (() => {
      const ordersCount =
        db
          .prepare(
            `
        SELECT COUNT(*) AS c
        FROM Pedidos
        WHERE Fecha >= ? AND Fecha < ?
          AND CAST(ServicioID AS TEXT) = CAST(? AS TEXT)
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
        WHERE p.Fecha >= ? AND p.Fecha < ?
          AND CAST(p.ServicioID AS TEXT) = CAST(? AS TEXT)
      `
          )
          .get(start, end, servicioId)?.c || 0;

      const amount =
        db
          .prepare(
            `
        SELECT COALESCE(SUM(Total),0) AS s
        FROM Pedidos
        WHERE Fecha >= ? AND Fecha < ?
          AND CAST(ServicioID AS TEXT) = CAST(? AS TEXT)
      `
          )
          .get(start, end, servicioId)?.s || 0;

      return {
        ordersCount: Number(ordersCount),
        itemsCount: Number(itemsCount),
        amount: Number(amount),
      };
    })();

    // Top productos del servicio
    const top_products = db
      .prepare(
        `
      SELECT COALESCE(i.ProductoID, 0)      AS productId,
             COALESCE(MAX(i.Codigo), '')    AS code,
             COALESCE(MAX(i.Nombre), '')    AS name,
             COUNT(DISTINCT i.PedidoID)     AS pedidos,
             COALESCE(SUM(i.Cantidad),0)    AS qty,
             COALESCE(SUM(i.Subtotal),0)    AS amount
      FROM PedidoItems i
      JOIN Pedidos p ON p.PedidoID = i.PedidoID
      WHERE p.Fecha >= ? AND p.Fecha < ?
        AND CAST(p.ServicioID AS TEXT) = CAST(? AS TEXT)
      GROUP BY i.ProductoID, LOWER(i.Nombre), LOWER(i.Codigo)
      ORDER BY amount DESC
      LIMIT 15
    `
      )
      .all(start, end, servicioId)
      .map((r) => ({
        productId: Number(r.productId || 0),
        code: String(r.code || ""),
        name: String(r.name || ""),
        pedidos: Number(r.pedidos || 0),
        qty: Number(r.qty || 0),
        amount: Number(r.amount || 0),
      }));

    // Evolución diaria del servicio
    const by_day = db
      .prepare(
        `
      SELECT SUBSTR(p.Fecha,1,10)            AS day,
             COUNT(*)                        AS pedidos,
             COALESCE(SUM(p.Total),0)        AS monto
      FROM Pedidos p
      WHERE p.Fecha >= ? AND p.Fecha < ?
        AND CAST(p.ServicioID AS TEXT) = CAST(? AS TEXT)
      GROUP BY day
      ORDER BY day
    `
      )
      .all(start, end, servicioId)
      .map((r) => ({
        day: r.day,
        pedidos: Number(r.pedidos || 0),
        monto: Number(r.monto || 0),
      }));

    // Listado de pedidos del servicio
    const orders = db
      .prepare(
        `
      SELECT p.PedidoID        AS id,
             p.Fecha           AS fecha,
             COALESCE(p.Total,0) AS total
      FROM Pedidos p
      WHERE p.Fecha >= ? AND p.Fecha < ?
        AND CAST(p.ServicioID AS TEXT) = CAST(? AS TEXT)
      ORDER BY p.Fecha DESC
    `
      )
      .all(start, end, servicioId)
      .map((r) => ({
        id: Number(r.id),
        fecha: r.fecha,
        total: Number(r.total),
      }));

    // Presupuesto y % de uso
    const budget = getBudgetByServiceId(servicioId);
    const utilization =
      budget && budget > 0 ? totals.amount / budget : null;

    return res.json({
      ok: true,
      period: { year, month, start, end },
      service: {
        id: servicioId,
        name: serviceName,
        budget: budget ?? null,
        utilization,
      },
      totals,
      top_products,
      by_day,
      orders,
    });
  } catch (e) {
    console.error("[reports] GET /service/:serviceId error:", e);
    return res.status(500).json({
      error: "No se pudo construir el informe del servicio",
    });
  }
});

export default router;