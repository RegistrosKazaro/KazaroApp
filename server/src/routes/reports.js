// server/src/routes/reports.js
import { Router } from "express";
import {
  db,
  getBudgetByServiceId,
  getServiceNameById,
  getServiceById,
  getEmployeeDisplayName,
} from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  listWarehouses,
  getWarehouseById,
  listWarehouseChildServices,
} from "../warehouses.js";

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

/* ======================= HELPER: filtro para el reporte GENERAL =======================
   El reporte General (Resumen, Actividad, Insumos, Servicios, Por día, Anual,
   Trazabilidad) debe EXCLUIR:
     - Pedidos de los servicios que son "hijos" de algún depósito
       (ej: TADICOR, VIAL TRUCK, RECURSOS HUMANOS, etc.).
     - Pedidos que contengan al menos un producto de una categoría marcada
       como "de depósito aparte" (por ahora solo "Uniformes").

   Esta función devuelve:
     { sqlExclusions, params }
   donde sqlExclusions es un string listo para concatenar con AND, y params
   son los parámetros posicionales a agregar.

   Uso típico:
     const { sqlExclusions, params: extra } = buildGeneralReportFilter();
     const sql = `SELECT ... WHERE p.Fecha >= ? AND p.Fecha < ? ${sqlExclusions}`;
     stmt.all(start, end, ...extra);
======================================================================== */

// Lista de nombres de categorías "separadas" (que tienen su propio reporte).
// Si en el futuro sumás más categorías separadas, agregalas acá.
const CATEGORIAS_SEPARADAS = ["Uniformes"];

function buildGeneralReportFilter() {
  const exclusions = [];
  const params = [];

  // 1) Excluir pedidos de servicios hijos de depósitos
  try {
    const childServiceIds = db.prepare(`
      SELECT DISTINCT CAST(service_id AS TEXT) AS sid
      FROM warehouse_services
    `).all().map(r => r.sid);

    if (childServiceIds.length) {
      const placeholders = childServiceIds.map(() => "?").join(",");
      exclusions.push(`
        AND (p.ServicioID IS NULL OR CAST(p.ServicioID AS TEXT) NOT IN (${placeholders}))
      `);
      params.push(...childServiceIds);
    }
  } catch (e) {
    // Si la tabla warehouse_services no existe todavía, no filtramos.
  }

  // 2) Excluir pedidos que contengan productos de categorías separadas.
  //    Buscamos los IDs de categoría (puede haber duplicados por nombre).
  try {
    const catIdsSeparadas = [];
    const catRows = db.prepare(`SELECT CategoriaID AS id, CategoriaNombre AS name FROM Categorias`).all();
    const normalize = (s) => String(s || "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .trim();

    for (const r of catRows) {
      const nm = normalize(r.name);
      if (CATEGORIAS_SEPARADAS.some(c => normalize(c) === nm)) {
        catIdsSeparadas.push(String(r.id));
      }
    }

    if (catIdsSeparadas.length) {
      // Necesitamos detectar la tabla de productos y la columna de categoría.
      const prod = resolveProductsTableLocal();
      if (prod) {
        const prodInfo = _tinfo(prod.table);
        const catCol = _pickCol(prodInfo, ["CategoriaID", "IdCategoria", "categoria_id"]);
        if (catCol) {
          const catPlaceholders = catIdsSeparadas.map(() => "?").join(",");
          exclusions.push(`
            AND NOT EXISTS (
              SELECT 1
              FROM PedidoItems pi2
              JOIN ${prod.table} pr2 ON CAST(pr2.${prod.idCol} AS TEXT) = CAST(pi2.ProductoID AS TEXT)
              WHERE pi2.PedidoID = p.PedidoID
                AND CAST(pr2.${catCol} AS TEXT) IN (${catPlaceholders})
            )
          `);
          params.push(...catIdsSeparadas);
        }
      }
    }
  } catch (e) {
    // Si algo falla (tabla no existe, schema distinto), no filtramos.
    console.warn("[reports] buildGeneralReportFilter categorias warn:", e?.message || e);
  }

  return {
    sqlExclusions: exclusions.join(" "),
    params,
  };
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
    // Filtro para excluir pedidos de depósitos y categorías separadas
    const { sqlExclusions, params: exclusionParams } = buildGeneralReportFilter();

    // Helper corto para ejecutar queries con el filtro aplicado
    const runSql = (sql, ...extraBefore) => {
      return db.prepare(sql).get(...extraBefore, ...exclusionParams);
    };
    const runAll = (sql, ...extraBefore) => {
      return db.prepare(sql).all(...extraBefore, ...exclusionParams);
    };

    // Totales generales del período
    const totals = (() => {
      const ordersCount = runSql(`
        SELECT COUNT(*) AS c
        FROM Pedidos p
        WHERE p.Fecha >= ? AND p.Fecha < ?
        ${sqlExclusions}
      `, start, end)?.c || 0;

      const itemsCount = runSql(`
        SELECT COALESCE(SUM(i.Cantidad),0) AS c
        FROM PedidoItems i
        JOIN Pedidos p ON p.PedidoID = i.PedidoID
        WHERE p.Fecha >= ? AND p.Fecha < ?
        ${sqlExclusions}
      `, start, end)?.c || 0;

      const amount = runSql(`
        SELECT COALESCE(SUM(p.Total),0) AS s
        FROM Pedidos p
        WHERE p.Fecha >= ? AND p.Fecha < ?
        ${sqlExclusions}
      `, start, end)?.s || 0;

      return {
        ordersCount: Number(ordersCount),
        itemsCount: Number(itemsCount),
        amount: Number(amount),
      };
    })();

    // Top servicios por monto
    const top_services_raw = runAll(`
      SELECT COALESCE(p.ServicioID,'')           AS serviceId,
             COUNT(DISTINCT p.PedidoID)          AS pedidos,
             COALESCE(SUM(i.Cantidad),0)         AS qty,
             COALESCE(SUM(i.Subtotal),0)         AS amount
      FROM Pedidos p
      LEFT JOIN PedidoItems i ON i.PedidoID = p.PedidoID
      WHERE p.Fecha >= ? AND p.Fecha < ?
      ${sqlExclusions}
      GROUP BY p.ServicioID
      ORDER BY amount DESC
      LIMIT 10
    `, start, end);

    const top_services = top_services_raw.map((r) => ({
      serviceId: r.serviceId || null,
      serviceName: resolveServiceName(r.serviceId),
      pedidos: Number(r.pedidos || 0),
      qty: Number(r.qty || 0),
      amount: Number(r.amount || 0),
    }));

    // Top productos por monto
    const top_products = runAll(`
      SELECT COALESCE(i.ProductoID, 0)          AS productId,
             COALESCE(MAX(i.Codigo), '')        AS code,
             COALESCE(MAX(i.Nombre), '')        AS name,
             COUNT(DISTINCT i.PedidoID)         AS pedidos,
             COALESCE(SUM(i.Cantidad),0)        AS qty,
             COALESCE(SUM(i.Subtotal),0)        AS amount
      FROM PedidoItems i
      JOIN Pedidos p ON p.PedidoID = i.PedidoID
      WHERE p.Fecha >= ? AND p.Fecha < ?
      ${sqlExclusions}
      GROUP BY i.ProductoID, LOWER(i.Nombre), LOWER(i.Codigo)
      ORDER BY amount DESC
      LIMIT 10
    `, start, end).map((r) => ({
      productId: Number(r.productId || 0),
      code: String(r.code || ""),
      name: String(r.name || ""),
      pedidos: Number(r.pedidos || 0),
      qty: Number(r.qty || 0),
      amount: Number(r.amount || 0),
    }));

    // Evolución diaria
    const by_day = runAll(`
      SELECT SUBSTR(p.Fecha,1,10)              AS day,
             COUNT(*)                          AS pedidos,
             COALESCE(SUM(p.Total),0)          AS monto
      FROM Pedidos p
      WHERE p.Fecha >= ? AND p.Fecha < ?
      ${sqlExclusions}
      GROUP BY day
      ORDER BY day
    `, start, end).map((r) => ({
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
        const ordersCount = runSql(`
          SELECT COUNT(*) AS c FROM Pedidos p
          WHERE p.Fecha >= ? AND p.Fecha < ?
          ${sqlExclusions}
        `, prevMonthRange.start, prevMonthRange.end)?.c || 0;

        const itemsCount = runSql(`
          SELECT COALESCE(SUM(i.Cantidad),0) AS c
          FROM PedidoItems i
          JOIN Pedidos p ON p.PedidoID = i.PedidoID
          WHERE p.Fecha >= ? AND p.Fecha < ?
          ${sqlExclusions}
        `, prevMonthRange.start, prevMonthRange.end)?.c || 0;

        const amount = runSql(`
          SELECT COALESCE(SUM(p.Total),0) AS s FROM Pedidos p
          WHERE p.Fecha >= ? AND p.Fecha < ?
          ${sqlExclusions}
        `, prevMonthRange.start, prevMonthRange.end)?.s || 0;

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

  // Si NO hay servicio específico, aplicamos el filtro general (excluir depósitos/uniformes).
  // Si hay servicio específico, el caller ya sabe qué quiere y no filtramos.
  const { sqlExclusions, params: exclusionParams } = hasService
    ? { sqlExclusions: "", params: [] }
    : buildGeneralReportFilter();

  const ordersCount = hasService
    ? (db.prepare(`
        SELECT COUNT(*) AS c
        FROM Pedidos
        WHERE Fecha >= ? AND Fecha < ?
          AND CAST(ServicioID AS TEXT) = CAST(? AS TEXT)
      `).get(start, end, serviceId)?.c || 0)
    : (db.prepare(`
        SELECT COUNT(*) AS c
        FROM Pedidos p
        WHERE p.Fecha >= ? AND p.Fecha < ?
        ${sqlExclusions}
      `).get(start, end, ...exclusionParams)?.c || 0);

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
        ${sqlExclusions}
      `).get(start, end, ...exclusionParams)?.c || 0);

  const amount = hasService
    ? (db.prepare(`
        SELECT COALESCE(SUM(Total),0) AS s
        FROM Pedidos
        WHERE Fecha >= ? AND Fecha < ?
          AND CAST(ServicioID AS TEXT) = CAST(? AS TEXT)
      `).get(start, end, serviceId)?.s || 0)
    : (db.prepare(`
        SELECT COALESCE(SUM(p.Total),0) AS s
        FROM Pedidos p
        WHERE p.Fecha >= ? AND p.Fecha < ?
        ${sqlExclusions}
      `).get(start, end, ...exclusionParams)?.s || 0);

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
      "EmpleadosID", "EmpleadoID", "IdEmpleado",
      "empleado_id", "user_id", "id",
    ]) ||
    info.find((c) => c.pk === 1)?.name ||
    "EmpleadoID";

  const nombreCol   = _pickCol(info, ["Nombre", "nombre", "Name", "name", "FirstName"]);
  const apellidoCol = _pickCol(info, ["Apellido", "apellido", "LastName", "Apellidos"]);
  const usernameCol = _pickCol(info, ["username", "usuario", "Usuario", "user", "ApellidoNombre"]);

  // Expresión SQL: "Apellido, Nombre" si existen ambos, sino el que haya
  let fullNameExpr;
  if (nombreCol && apellidoCol) {
    fullNameExpr = `TRIM(
      COALESCE(NULLIF(TRIM(e.${apellidoCol}),''), '') ||
      CASE WHEN NULLIF(TRIM(e.${apellidoCol}),'') IS NOT NULL
                AND NULLIF(TRIM(e.${nombreCol}),'')  IS NOT NULL
           THEN ', ' ELSE '' END ||
      COALESCE(NULLIF(TRIM(e.${nombreCol}),''), '')
    )`;
  } else if (apellidoCol) {
    fullNameExpr = `TRIM(e.${apellidoCol})`;
  } else if (nombreCol) {
    fullNameExpr = `TRIM(e.${nombreCol})`;
  } else if (usernameCol) {
    fullNameExpr = `TRIM(e.${usernameCol})`;
  } else {
    fullNameExpr = `CAST(e.${idCol} AS TEXT)`;
  }

  // Verificar si la tabla Pedidos tiene columna Rol (guardada por orders.js)
  const pedidosInfo = _tinfo("Pedidos");
  const pedidosRolCol = _pickCol(pedidosInfo, ["Rol", "rol", "role", "Role"]);

  return { table, idCol, fullNameExpr, pedidosRolCol };
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

    // Filtro para excluir pedidos de depósitos y categorías separadas
    const { sqlExclusions, params: exclusionParams } = buildGeneralReportFilter();

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
      ${sqlExclusions}
      GROUP BY i.ProductoID, LOWER(i.Nombre), LOWER(i.Codigo)
      ORDER BY qty DESC, amount DESC
    `).all(start, end, ...exclusionParams).map((r) => ({
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
        ${sqlExclusions}
        GROUP BY p.ServicioID
        ORDER BY amount DESC, qty DESC
      `).all(start, end, ...exclusionParams).map((r) => ({
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
      // Seleccionar Rol directamente de Pedidos si existe la columna
      const rolSelect = emp.pedidosRolCol
        ? `, MAX(p.${emp.pedidosRolCol}) AS rol`
        : `, NULL AS rol`;

      const rawSupervisors = db.prepare(`
        SELECT
          CAST(p.EmpleadoID AS TEXT) AS employeeId,
          COALESCE(
            NULLIF(TRIM(${emp.fullNameExpr}), ''),
            CAST(p.EmpleadoID AS TEXT)
          ) AS employeeName
          ${rolSelect},
          COUNT(DISTINCT p.PedidoID) AS pedidos,
          COALESCE(SUM(i.Cantidad), 0) AS qty,
          COALESCE(SUM(i.Subtotal), 0) AS amount
        FROM Pedidos p
        JOIN PedidoItems i ON i.PedidoID = p.PedidoID
        LEFT JOIN ${emp.table} e ON CAST(e.${emp.idCol} AS TEXT) = CAST(p.EmpleadoID AS TEXT)
        WHERE p.Fecha >= ? AND p.Fecha < ?
        ${sqlExclusions}
        GROUP BY p.EmpleadoID
        ORDER BY pedidos DESC, qty DESC, amount DESC
      `).all(start, end, ...exclusionParams);

      supervisors = rawSupervisors.map((r) => {
        // Usar getEmployeeDisplayName como fallback si el JOIN no dio nombre completo
        const rawName = String(r.employeeName || "").trim();
        const fallback = rawName && rawName !== String(r.employeeId)
          ? rawName
          : getEmployeeDisplayName(r.employeeId);

        return {
          employeeId:   String(r.employeeId || ""),
          employeeName: fallback || rawName || "—",
          rol:          r.rol ? String(r.rol).toLowerCase().trim() : null,
          pedidos:      Number(r.pedidos || 0),
          qty:          Number(r.qty || 0),
          amount:       Number(r.amount || 0),
        };
      });
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


/* ======================= DEPÓSITOS (WAREHOUSES) ======================= */

router.get("/warehouses", mustBeAdmin, (_req, res) => {
  try {
    const rows = listWarehouses();
    return res.json(rows.map(w => ({
      id: w.id,
      name: w.name,
      linkedServiceId: w.linkedServiceId || null,
    })));
  } catch (e) {
    console.error("[reports] GET /warehouses error:", e);
    return res.status(500).json({ error: "No se pudieron cargar los depósitos" });
  }
});

router.get("/warehouse/:id", mustBeAdmin, (req, res) => {
  const warehouseId = Number(req.params.id);
  if (!Number.isFinite(warehouseId)) {
    return res.status(400).json({ error: "id de depósito inválido" });
  }

  const warehouse = getWarehouseById(warehouseId);
  if (!warehouse) {
    return res.status(404).json({ error: "Depósito no encontrado" });
  }

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
    const totalsOut = db.prepare(`
      SELECT
        COUNT(DISTINCT pedido_id) AS ordersCount,
        COALESCE(SUM(qty), 0)     AS itemsCount,
        COALESCE(SUM(subtotal),0) AS amount
      FROM warehouse_movements
      WHERE warehouse_id = ?
        AND type = 'OUT'
        AND created_at >= ? AND created_at < ?
    `).get(warehouseId, start, end) || { ordersCount: 0, itemsCount: 0, amount: 0 };

    const totalsIn = db.prepare(`
      SELECT
        COUNT(DISTINCT pedido_id) AS ordersCount,
        COALESCE(SUM(qty), 0)     AS itemsCount,
        COALESCE(SUM(subtotal),0) AS amount
      FROM warehouse_movements
      WHERE warehouse_id = ?
        AND type = 'IN'
        AND created_at >= ? AND created_at < ?
    `).get(warehouseId, start, end) || { ordersCount: 0, itemsCount: 0, amount: 0 };

    const top_products = db.prepare(`
      SELECT
        product_id                  AS productId,
        COALESCE(MAX(code), '')     AS code,
        COALESCE(MAX(name), '')     AS name,
        COUNT(DISTINCT pedido_id)   AS pedidos,
        COALESCE(SUM(qty), 0)       AS qty,
        COALESCE(SUM(subtotal), 0)  AS amount
      FROM warehouse_movements
      WHERE warehouse_id = ?
        AND type = 'OUT'
        AND created_at >= ? AND created_at < ?
      GROUP BY product_id, LOWER(COALESCE(name,'')), LOWER(COALESCE(code,''))
      ORDER BY amount DESC, qty DESC
      LIMIT 15
    `).all(warehouseId, start, end).map(r => ({
      productId: r.productId,
      code: String(r.code || ""),
      name: String(r.name || ""),
      pedidos: Number(r.pedidos || 0),
      qty: Number(r.qty || 0),
      amount: Number(r.amount || 0),
    }));

    const by_service_raw = db.prepare(`
      SELECT
        CAST(service_id AS TEXT)   AS serviceId,
        COUNT(DISTINCT pedido_id)  AS pedidos,
        COALESCE(SUM(qty), 0)      AS qty,
        COALESCE(SUM(subtotal), 0) AS amount
      FROM warehouse_movements
      WHERE warehouse_id = ?
        AND type = 'OUT'
        AND created_at >= ? AND created_at < ?
        AND service_id IS NOT NULL
      GROUP BY service_id
      ORDER BY amount DESC
    `).all(warehouseId, start, end);

    const by_service = by_service_raw.map(r => ({
      serviceId: r.serviceId,
      serviceName: resolveServiceName(r.serviceId),
      pedidos: Number(r.pedidos || 0),
      qty: Number(r.qty || 0),
      amount: Number(r.amount || 0),
    }));

    const by_day = db.prepare(`
      SELECT
        SUBSTR(created_at, 1, 10)  AS day,
        COUNT(DISTINCT pedido_id)  AS pedidos,
        COALESCE(SUM(subtotal), 0) AS monto,
        COALESCE(SUM(qty), 0)      AS qty
      FROM warehouse_movements
      WHERE warehouse_id = ?
        AND type = 'OUT'
        AND created_at >= ? AND created_at < ?
      GROUP BY day
      ORDER BY day
    `).all(warehouseId, start, end).map(r => ({
      day: r.day,
      pedidos: Number(r.pedidos || 0),
      monto: Number(r.monto || 0),
      qty: Number(r.qty || 0),
    }));

    const orders = db.prepare(`
      SELECT
        m.pedido_id                    AS id,
        MIN(m.created_at)              AS fecha,
        CAST(MAX(m.service_id) AS TEXT) AS serviceId,
        COALESCE(SUM(m.subtotal), 0)   AS total,
        COALESCE(SUM(m.qty), 0)        AS qty
      FROM warehouse_movements m
      WHERE m.warehouse_id = ?
        AND m.type = 'OUT'
        AND m.created_at >= ? AND m.created_at < ?
        AND m.pedido_id IS NOT NULL
      GROUP BY m.pedido_id
      ORDER BY fecha DESC
    `).all(warehouseId, start, end).map(r => ({
      id: Number(r.id),
      fecha: r.fecha,
      serviceId: r.serviceId,
      serviceName: resolveServiceName(r.serviceId),
      total: Number(r.total || 0),
      qty: Number(r.qty || 0),
    }));

    const current_stock = db.prepare(`
      SELECT
        ws.product_id                AS productId,
        COALESCE(ws.qty, 0)          AS qty,
        (
          SELECT m2.name FROM warehouse_movements m2
          WHERE m2.warehouse_id = ws.warehouse_id
            AND CAST(m2.product_id AS TEXT) = CAST(ws.product_id AS TEXT)
          ORDER BY m2.id DESC LIMIT 1
        ) AS name,
        (
          SELECT m2.code FROM warehouse_movements m2
          WHERE m2.warehouse_id = ws.warehouse_id
            AND CAST(m2.product_id AS TEXT) = CAST(ws.product_id AS TEXT)
          ORDER BY m2.id DESC LIMIT 1
        ) AS code
      FROM warehouse_stock ws
      WHERE ws.warehouse_id = ?
      ORDER BY qty DESC
    `).all(warehouseId).map(r => ({
      productId: r.productId,
      name: String(r.name || ""),
      code: String(r.code || ""),
      stock: Number(r.qty || 0),
    }));

    const child_service_ids = listWarehouseChildServices(warehouseId);
    const child_services = child_service_ids.map(sid => ({
      serviceId: sid,
      serviceName: resolveServiceName(sid),
    }));

    return res.json({
      ok: true,
      period: { year, month, start, end },
      warehouse: {
        id: warehouse.id,
        name: warehouse.name,
        linkedServiceId: warehouse.linkedServiceId || null,
      },
      child_services,
      totals: {
        ordersCount: Number(totalsOut.ordersCount || 0),
        itemsCount:  Number(totalsOut.itemsCount  || 0),
        amount:      Number(totalsOut.amount      || 0),
      },
      totals_in: {
        ordersCount: Number(totalsIn.ordersCount || 0),
        itemsCount:  Number(totalsIn.itemsCount  || 0),
        amount:      Number(totalsIn.amount      || 0),
      },
      top_products,
      by_service,
      by_day,
      orders,
      current_stock,
    });
  } catch (e) {
    console.error("[reports] GET /warehouse/:id error:", e);
    return res.status(500).json({
      error: "No se pudo construir el informe del depósito",
    });
  }
});

/* ======================= INFORME POR CATEGORÍA (POR NOMBRE) =======================
   Este endpoint sirve para generar un reporte tipo "depósito" pero basado en una
   categoría de productos. Se usa para la pestaña "Depósito Uniformes" que no
   requiere tener un warehouse creado: simplemente filtra los pedidos donde al
   menos un ítem pertenece a la categoría pedida.

   GET /reports/category/by-name/:name?year=&month=
======================================================================== */

router.get("/category/by-name/:name", mustBeAdmin, (req, res) => {
  const rawName = String(req.params.name || "").trim();
  if (!rawName) {
    return res.status(400).json({ error: "nombre de categoría requerido" });
  }

  // Resolver IDs de categoría por nombre (matching flexible, sin acentos / case insensitive).
  // Importante: puede haber duplicados (pasó en tu caso con Uniformes). Tomamos TODOS
  // los IDs que matchean para no perder datos.
  const normalize = (s) => String(s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

  let categoryIds = [];
  let categoryName = rawName;
  try {
    const catRows = db.prepare(`SELECT CategoriaID AS id, CategoriaNombre AS name FROM Categorias`).all();
    const wanted = normalize(rawName);
    const matches = catRows.filter(r => normalize(r.name) === wanted);
    if (!matches.length) {
      return res.status(404).json({
        error: `No se encontró la categoría "${rawName}"`,
      });
    }
    categoryIds = matches.map(r => String(r.id));
    categoryName = matches[0].name; // nombre canónico
  } catch (e) {
    console.error("[reports] /category/by-name resolve error:", e);
    return res.status(500).json({ error: "No se pudo resolver la categoría" });
  }

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
    // Descubrir schema de productos para JOIN con categorías
    const prod = resolveProductsTableLocal();
    if (!prod) {
      return res.status(500).json({ error: "No se pudo detectar la tabla de productos" });
    }

    // Determinar la columna que enlaza productos con categorías.
    // Normalmente es "CategoriaID" en la tabla de productos.
    const prodInfo = _tinfo(prod.table);
    const catCol = _pickCol(prodInfo, ["CategoriaID", "IdCategoria", "categoria_id"]);
    if (!catCol) {
      return res.status(500).json({ error: "No se encontró columna de categoría en productos" });
    }

    // IN clause dinámico
    const catPlaceholders = categoryIds.map(() => "?").join(",");

    // ── Totales del mes ──
    const totals = db.prepare(`
      SELECT
        COUNT(DISTINCT p.PedidoID)    AS ordersCount,
        COALESCE(SUM(i.Cantidad), 0)  AS itemsCount,
        COALESCE(SUM(i.Subtotal), 0)  AS amount
      FROM PedidoItems i
      JOIN Pedidos p ON p.PedidoID = i.PedidoID
      JOIN ${prod.table} pr ON CAST(pr.${prod.idCol} AS TEXT) = CAST(i.ProductoID AS TEXT)
      WHERE p.Fecha >= ? AND p.Fecha < ?
        AND CAST(pr.${catCol} AS TEXT) IN (${catPlaceholders})
    `).get(start, end, ...categoryIds) || { ordersCount: 0, itemsCount: 0, amount: 0 };

    // ── Top productos de la categoría en el mes ──
    const top_products = db.prepare(`
      SELECT
        i.ProductoID                             AS productId,
        COALESCE(MAX(i.Codigo), '')              AS code,
        COALESCE(MAX(i.Nombre), '')              AS name,
        COUNT(DISTINCT i.PedidoID)               AS pedidos,
        COALESCE(SUM(i.Cantidad), 0)             AS qty,
        COALESCE(SUM(i.Subtotal), 0)             AS amount
      FROM PedidoItems i
      JOIN Pedidos p ON p.PedidoID = i.PedidoID
      JOIN ${prod.table} pr ON CAST(pr.${prod.idCol} AS TEXT) = CAST(i.ProductoID AS TEXT)
      WHERE p.Fecha >= ? AND p.Fecha < ?
        AND CAST(pr.${catCol} AS TEXT) IN (${catPlaceholders})
      GROUP BY i.ProductoID, LOWER(COALESCE(i.Nombre,'')), LOWER(COALESCE(i.Codigo,''))
      ORDER BY amount DESC, qty DESC
      LIMIT 15
    `).all(start, end, ...categoryIds).map(r => ({
      productId: r.productId,
      code: String(r.code || ""),
      name: String(r.name || ""),
      pedidos: Number(r.pedidos || 0),
      qty: Number(r.qty || 0),
      amount: Number(r.amount || 0),
    }));

    // ── Desglose por servicio ──
    const by_service_raw = db.prepare(`
      SELECT
        CAST(p.ServicioID AS TEXT)   AS serviceId,
        COUNT(DISTINCT p.PedidoID)   AS pedidos,
        COALESCE(SUM(i.Cantidad), 0) AS qty,
        COALESCE(SUM(i.Subtotal), 0) AS amount
      FROM PedidoItems i
      JOIN Pedidos p ON p.PedidoID = i.PedidoID
      JOIN ${prod.table} pr ON CAST(pr.${prod.idCol} AS TEXT) = CAST(i.ProductoID AS TEXT)
      WHERE p.Fecha >= ? AND p.Fecha < ?
        AND CAST(pr.${catCol} AS TEXT) IN (${catPlaceholders})
        AND p.ServicioID IS NOT NULL
      GROUP BY p.ServicioID
      ORDER BY amount DESC
    `).all(start, end, ...categoryIds);

    const by_service = by_service_raw.map(r => ({
      serviceId: r.serviceId,
      serviceName: resolveServiceName(r.serviceId),
      pedidos: Number(r.pedidos || 0),
      qty: Number(r.qty || 0),
      amount: Number(r.amount || 0),
    }));

    // ── Evolución diaria ──
    const by_day = db.prepare(`
      SELECT
        SUBSTR(p.Fecha, 1, 10)       AS day,
        COUNT(DISTINCT p.PedidoID)   AS pedidos,
        COALESCE(SUM(i.Subtotal), 0) AS monto,
        COALESCE(SUM(i.Cantidad), 0) AS qty
      FROM PedidoItems i
      JOIN Pedidos p ON p.PedidoID = i.PedidoID
      JOIN ${prod.table} pr ON CAST(pr.${prod.idCol} AS TEXT) = CAST(i.ProductoID AS TEXT)
      WHERE p.Fecha >= ? AND p.Fecha < ?
        AND CAST(pr.${catCol} AS TEXT) IN (${catPlaceholders})
      GROUP BY day
      ORDER BY day
    `).all(start, end, ...categoryIds).map(r => ({
      day: r.day,
      pedidos: Number(r.pedidos || 0),
      monto: Number(r.monto || 0),
      qty: Number(r.qty || 0),
    }));

    // ── Listado de pedidos (solo los que tengan productos de la categoría) ──
    const orders = db.prepare(`
      SELECT
        p.PedidoID                        AS id,
        p.Fecha                           AS fecha,
        CAST(p.ServicioID AS TEXT)        AS serviceId,
        COALESCE(SUM(i.Subtotal), 0)      AS total,
        COALESCE(SUM(i.Cantidad), 0)      AS qty
      FROM PedidoItems i
      JOIN Pedidos p ON p.PedidoID = i.PedidoID
      JOIN ${prod.table} pr ON CAST(pr.${prod.idCol} AS TEXT) = CAST(i.ProductoID AS TEXT)
      WHERE p.Fecha >= ? AND p.Fecha < ?
        AND CAST(pr.${catCol} AS TEXT) IN (${catPlaceholders})
      GROUP BY p.PedidoID
      ORDER BY p.Fecha DESC
    `).all(start, end, ...categoryIds).map(r => ({
      id: Number(r.id),
      fecha: r.fecha,
      serviceId: r.serviceId,
      serviceName: resolveServiceName(r.serviceId),
      total: Number(r.total || 0),
      qty: Number(r.qty || 0),
    }));

    // ── Stock actual de productos de la categoría ──
    const current_stock = prod.stockCol ? db.prepare(`
      SELECT
        pr.${prod.idCol}                            AS productId,
        COALESCE(NULLIF(TRIM(pr.${prod.nameCol}), ''), 'Sin nombre') AS name,
        ${prod.codeCol ? `COALESCE(NULLIF(TRIM(pr.${prod.codeCol}), ''), '')` : `''`} AS code,
        COALESCE(pr.${prod.stockCol}, 0)            AS stock
      FROM ${prod.table} pr
      WHERE CAST(pr.${catCol} AS TEXT) IN (${catPlaceholders})
      ORDER BY name COLLATE NOCASE
    `).all(...categoryIds).map(r => ({
      productId: r.productId,
      name: String(r.name || ""),
      code: String(r.code || ""),
      stock: Number(r.stock || 0),
    })) : [];

    return res.json({
      ok: true,
      period: { year, month, start, end },
      category: {
        name: categoryName,
        ids: categoryIds,
      },
      totals: {
        ordersCount: Number(totals.ordersCount || 0),
        itemsCount:  Number(totals.itemsCount  || 0),
        amount:      Number(totals.amount      || 0),
      },
      top_products,
      by_service,
      by_day,
      orders,
      current_stock,
    });
  } catch (e) {
    console.error("[reports] GET /category/by-name error:", e);
    return res.status(500).json({
      error: "No se pudo construir el informe de la categoría",
    });
  }
});

export default router;