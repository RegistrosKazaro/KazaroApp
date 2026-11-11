// server/src/routes/apiPublica.js
//
// API de sólo lectura para que otras áreas consulten los pedidos.
// Se monta en /v1, y como Nginx quita el prefijo /api, para el consumidor
// queda en https://<host>/api/v1/...
//
// Autenticación: token fijo por empresa, en el header
//     Authorization: Bearer <token>
//   o X-API-Key: <token>
//
// Los tokens se configuran en el .env:
//     PEDIDOS_API_TOKENS=<token_kazaro>:1,<token_pazar>:2
//
// El token determina la empresa: un consumidor nunca puede pedir datos de otra.

import { Router } from "express";
import crypto from "crypto";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { db, getEmployeeDisplayName } from "../db.js";
import { toISO, fmtAr, diaAr } from "../utils/fechas.js";
import { sinAcentosSql, normalizarBusqueda } from "../utils/busqueda.js";

const router = Router();

/* ─────────────── Autenticación ─────────────── */

function cargarTokens() {
  const crudo = String(process.env.PEDIDOS_API_TOKENS || "").trim();
  const mapa = new Map();
  for (const parte of crudo.split(",")) {
    const [token, empresa] = parte.split(":").map((x) => (x || "").trim());
    if (token && empresa && Number.isFinite(Number(empresa))) {
      mapa.set(token, Number(empresa));
    }
  }
  return mapa;
}

// Comparación en tiempo constante: comparar con === filtra por longitud y por
// el primer byte distinto, lo que permite adivinar el token midiendo tiempos.
function tokenValido(recibido, mapa) {
  const bufRec = Buffer.from(String(recibido));
  for (const [token, empresaId] of mapa) {
    const bufOk = Buffer.from(token);
    if (bufRec.length === bufOk.length && crypto.timingSafeEqual(bufRec, bufOk)) {
      return empresaId;
    }
  }
  return null;
}

function requiereToken(req, res, next) {
  const mapa = cargarTokens();
  if (mapa.size === 0) {
    return res.status(503).json({
      error: "api_no_configurada",
      mensaje: "La API no tiene tokens configurados en el servidor.",
    });
  }

  const recibido = tokenDelRequest(req);

  if (!recibido) {
    return res.status(401).json({
      error: "falta_token",
      mensaje: "Enviá el token en el header Authorization: Bearer <token> o X-API-Key.",
    });
  }

  const empresaId = tokenValido(recibido, mapa);
  if (!empresaId) {
    return res.status(403).json({ error: "token_invalido", mensaje: "El token no es válido." });
  }

  req.apiEmpresaId = empresaId;
  next();
}

/** Extrae el token del header, sea Bearer o X-API-Key. */
function tokenDelRequest(req) {
  const auth = String(req.get("authorization") || "");
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  return bearer || req.get("x-api-key") || "";
}

const limitador = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true, // devuelve RateLimit-Limit / -Remaining / -Reset
  legacyHeaders: false,
  // Se cuenta POR TOKEN, no por IP (que es el default de express-rate-limit).
  // Así cada consumidor tiene su propio presupuesto: no compite con la otra
  // empresa aunque compartan la instancia, ni consigo mismo si sale por varias
  // IPs o por un NAT compartido. El token se hashea para no dejarlo en las
  // claves del store en memoria.
  keyGenerator: (req) => {
    const token = tokenDelRequest(req);
    if (token) return "tok:" + crypto.createHash("sha256").update(token).digest("hex");
    // ipKeyGenerator agrupa las IPv6 por subred: si no, cada dirección de
    // una misma red contaría aparte y se podría esquivar el límite.
    return "ip:" + ipKeyGenerator(req.ip || "0.0.0.0");
  },
  message: {
    error: "demasiadas_consultas",
    mensaje: "Máximo 60 consultas por minuto por token. Reintentá en unos segundos.",
  },
});

// Sólo lectura: cualquier método que no sea GET se rechaza.
router.use((req, res, next) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "metodo_no_permitido", mensaje: "Esta API es de sólo lectura." });
  }
  next();
});
router.use(limitador);
router.use(requiereToken);

/* ─────────────── Helpers ─────────────── */

const ES_DIA = /^\d{4}-\d{2}-\d{2}$/;

/** El día argentino arranca a las 03:00 UTC (Argentina es UTC-3 fijo). */
function rangoUtc(desde, hasta) {
  const r = {};
  if (desde) r.desdeUtc = `${desde} 03:00:00`;
  if (hasta) {
    const d = new Date(`${hasta}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    r.hastaUtc = `${d.toISOString().slice(0, 10)} 03:00:00`;
  }
  return r;
}

function errorParametro(res, campo, mensaje) {
  return res.status(400).json({ error: "parametro_invalido", campo, mensaje });
}

/* ─────────────── Endpoints ─────────────── */

/**
 * GET /v1/pedidos
 *   desde, hasta   aaaa-mm-dd, inclusive, en día argentino
 *   servicioId     opcional
 *   page, limit    limit máximo 500 (por defecto 100)
 */
router.get("/pedidos", (req, res) => {
  try {
    const empresaId = req.apiEmpresaId;

    const desde = String(req.query.desde || "").trim() || null;
    const hasta = String(req.query.hasta || "").trim() || null;
    if (desde && !ES_DIA.test(desde)) return errorParametro(res, "desde", "Formato esperado aaaa-mm-dd.");
    if (hasta && !ES_DIA.test(hasta)) return errorParametro(res, "hasta", "Formato esperado aaaa-mm-dd.");
    if (desde && hasta && desde > hasta) return errorParametro(res, "hasta", "'hasta' no puede ser anterior a 'desde'.");

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));

    // Sólo pedidos contabilizados (retirados o administrativos): los que el
    // depósito todavía está trabajando no se exponen hasta marcarse retirados.
    const where = ["p.deleted_at IS NULL", "p.empresa_id = @empresaId", "p.contabilizado_at IS NOT NULL"];
    const params = { empresaId, limit, offset: (page - 1) * limit };

    const { desdeUtc, hastaUtc } = rangoUtc(desde, hasta);
    if (desdeUtc) { where.push("p.Fecha >= @desdeUtc"); params.desdeUtc = desdeUtc; }
    if (hastaUtc) { where.push("p.Fecha < @hastaUtc"); params.hastaUtc = hastaUtc; }

    if (req.query.servicioId != null && String(req.query.servicioId).trim() !== "") {
      const sid = Number(req.query.servicioId);
      if (!Number.isFinite(sid)) return errorParametro(res, "servicioId", "Debe ser un número.");
      where.push("p.ServicioID = @servicioId");
      params.servicioId = sid;
    }

    const fromSql = "FROM Pedidos p LEFT JOIN Servicios s ON s.ServiciosID = p.ServicioID";
    const whereSql = `WHERE ${where.join(" AND ")}`;

    const { total } = db.prepare(`SELECT COUNT(*) AS total ${fromSql} ${whereSql}`).get(params);

    const filas = db.prepare(`
      SELECT p.PedidoID AS id, p.Fecha AS fecha, p.Total AS total, p.Rol AS rol,
             p.Nota AS nota, p.EmpleadoID AS empleadoId,
             p.Status AS status, p.closedat AS closedAt,
             p.ServicioID AS servicioId, s.ServicioNombre AS servicioNombre
      ${fromSql} ${whereSql}
      ORDER BY p.Fecha DESC, p.PedidoID DESC
      LIMIT @limit OFFSET @offset
    `).all(params);

    // Cantidades y totales NETOS de devoluciones aprobadas (se informa además
    // lo pedido originalmente y lo devuelto, para que quede trazable).
    const stmtItems = db.prepare(`
      SELECT Codigo AS codigo, Nombre AS nombre, Precio AS precio,
             CantidadOriginal AS cantidadOriginal, Devuelto AS devuelto,
             Cantidad AS cantidad, Subtotal AS subtotal
      FROM v_pedido_items_neto WHERE PedidoID = ? ORDER BY Nombre COLLATE NOCASE
    `);
    const stmtNeto = db.prepare(`SELECT TotalOriginal, MontoDevuelto, TotalNeto FROM v_pedidos_neto WHERE PedidoID = ?`);

    const pedidos = filas.map((r) => {
      const items = stmtItems.all(r.id).map((i) => ({
        codigo: i.codigo || null,
        insumo: i.nombre || "",
        cantidad: Number(i.cantidad || 0),
        cantidadPedida: Number(i.cantidadOriginal || 0),
        devuelto: Number(i.devuelto || 0),
        precioUnitario: Number(i.precio || 0),
        subtotal: Number(i.subtotal || 0),
      }));
      const neto = stmtNeto.get(r.id) || {};
      const montoDevuelto = Number(neto.MontoDevuelto || 0);
      return {
        pedidoId: r.id,
        numero: String(r.id).padStart(7, "0"),
        fechaHora: toISO(r.fecha),          // ISO-8601 en UTC
        fechaHoraArgentina: fmtAr(r.fecha), // dd/mm/aaaa hh:mm
        dia: diaAr(r.fecha),                // aaaa-mm-dd, día argentino
        servicio: r.servicioId
          ? { id: r.servicioId, nombre: r.servicioNombre || "" }
          : null,
        solicitante: r.empleadoId ? getEmployeeDisplayName(r.empleadoId) : "",
        rol: r.rol || null,
        estado: r.closedAt != null || String(r.status || "").toLowerCase() === "closed" ? "cerrado" : "abierto",
        nota: r.nota || null,
        total: Number(neto.TotalNeto ?? r.total ?? 0),
        totalPedido: Number(neto.TotalOriginal ?? r.total ?? 0),
        montoDevuelto,
        tuvoDevolucion: montoDevuelto > 0 || items.some((i) => i.devuelto > 0),
        items,
      };
    });

    res.json({
      empresaId,
      filtros: { desde, hasta, servicioId: params.servicioId ?? null },
      paginado: { page, limit, total, paginas: Math.max(1, Math.ceil(total / limit)) },
      pedidos,
    });
  } catch (e) {
    console.error("[api/v1/pedidos]", e?.message);
    res.status(500).json({ error: "error_interno", mensaje: "No se pudo procesar la consulta." });
  }
});

/** GET /v1/servicios — para que el consumidor sepa qué ids usar. */
router.get("/servicios", (req, res) => {
  try {
    const filas = db.prepare(`
      SELECT s.ServiciosID AS id, s.ServicioNombre AS nombre,
             COUNT(p.PedidoID) AS pedidos, MAX(p.Fecha) AS ultimoPedido
      FROM Servicios s
      LEFT JOIN Pedidos p ON p.ServicioID = s.ServiciosID
                         AND p.deleted_at IS NULL AND p.empresa_id = @empresaId
      WHERE s.empresa_id = @empresaId AND s.deleted_at IS NULL
      GROUP BY s.ServiciosID, s.ServicioNombre
      ORDER BY s.ServicioNombre COLLATE NOCASE
    `).all({ empresaId: req.apiEmpresaId });

    res.json({
      empresaId: req.apiEmpresaId,
      servicios: filas.map((s) => ({
        id: s.id,
        nombre: s.nombre || "",
        cantidadPedidos: Number(s.pedidos || 0),
        ultimoPedido: s.ultimoPedido ? toISO(s.ultimoPedido) : null,
      })),
    });
  } catch (e) {
    console.error("[api/v1/servicios]", e?.message);
    res.status(500).json({ error: "error_interno", mensaje: "No se pudo procesar la consulta." });
  }
});

/* ─────────────── Insumos ─────────────── */

// shortcut: el mismo umbral está escrito a mano en /deposito/stock-critico;
// si se cambia allá hay que cambiarlo acá. Unificar si aparece un tercer uso.
// Por encima de esto el stock es el número sembrado al arrancar la app para
// que nada frenara los pedidos: existe, pero no es mercadería real.
const STOCK_DUDOSO = 10000;

const PREGUNTA_AL_VOLVER = { 0: "ninguna", 1: "cuanto_queda", 2: "estado" };

/** Agrupa filas en un Map por id de producto: { 4 => [fila, fila], ... }. */
function porProducto(filas) {
  const m = new Map();
  for (const f of filas) {
    const k = Number(f.pid);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(f);
  }
  return m;
}

/**
 * Arma la ficha de cada insumo con todo lo que la base sabe de él.
 * Las tablas satélite se consultan una vez para todos los ids juntos, no una
 * vez por insumo: con 500 insumos serían miles de consultas.
 *
 * En las tablas chicas los ids se comparan con CAST AS INTEGER, por si alguna
 * los guarda como texto. En service_products no: es grande y el CAST le
 * impide a SQLite usar el índice.
 */
function fichas(empresaId, productos) {
  if (!productos.length) return [];
  const ids = JSON.stringify(productos.map((p) => Number(p.id)));
  const enIds = (col) => `CAST(${col} AS INTEGER) IN (SELECT value FROM json_each(@ids))`;

  const rubros = porProducto(db.prepare(`
    SELECT CAST(pr.product_id AS INTEGER) AS pid, r.id, r.nombre
      FROM producto_rubro pr JOIN insumo_rubros r ON r.id = pr.rubro_id
     WHERE r.empresa_id = @empresaId AND ${enIds("pr.product_id")}
  `).all({ empresaId, ids }));

  // Mismo cálculo que /deposito/stock-critico: neto de devoluciones, últimos
  // 90 días en hora argentina. Si la API y el panel dieran números distintos,
  // nadie sabría cuál creer.
  const consumo = new Map(db.prepare(`
    SELECT i.ProductoID AS pid,
           SUM(CASE WHEN datetime(d.Fecha, '-3 hours') >= datetime('now', '-90 days')
                    THEN i.Cantidad ELSE 0 END) AS c90,
           MAX(d.Fecha) AS ultimo
      FROM v_pedido_items_neto i
      JOIN Pedidos d ON d.PedidoID = i.PedidoID
     WHERE d.deleted_at IS NULL AND d.empresa_id = @empresaId AND ${enIds("i.ProductoID")}
     GROUP BY i.ProductoID
  `).all({ empresaId, ids }).map((r) => [Number(r.pid), r]));

  const enCamino = new Map(db.prepare(`
    SELECT CAST(product_id AS INTEGER) AS pid, SUM(qty) AS q
      FROM IncomingStock
     WHERE DATE(eta) >= DATE('now') AND ${enIds("product_id")}
     GROUP BY CAST(product_id AS INTEGER)
  `).all({ ids }).map((r) => [Number(r.pid), Number(r.q || 0)]));

  const flexxus = new Map(db.prepare(`
    SELECT CAST(product_id AS INTEGER) AS pid, estado, flexxus_sku, flexxus_name,
           flexxus_stock, ultima_sync
      FROM FlexxusProductMatch
     WHERE empresa_id = @empresaId AND ${enIds("product_id")}
  `).all({ empresaId, ids }).map((r) => [Number(r.pid), r]));

  // Sin CAST a propósito: son 159.000 filas y el CAST no deja usar los índices
  // (6 segundos contra 60 ms). El "=" numérico ya iguala 904 con 904.0, que es
  // lo que el CAST cuidaba; el bug viejo era comparar como texto.
  const servicios = new Map(db.prepare(`
    SELECT sp.product_id AS pid, COUNT(DISTINCT s.ServiciosID) AS n
      FROM service_products sp
      JOIN Servicios s ON s.ServiciosID = sp.service_id
     WHERE s.empresa_id = @empresaId AND s.deleted_at IS NULL
       AND sp.product_id IN (SELECT value FROM json_each(@ids))
     GROUP BY sp.product_id
  `).all({ empresaId, ids }).map((r) => [Number(r.pid), Number(r.n)]));

  const roles = porProducto(db.prepare(`
    SELECT CAST(product_id AS INTEGER) AS pid, LOWER(role) AS role
      FROM ProductRoleVisibility WHERE ${enIds("product_id")}
  `).all({ ids }));

  // El último precio al que se compró: sólo existe una vez conciliada la factura.
  const compra = new Map(db.prepare(`
    SELECT t.producto_id AS pid, t.precio_unitario AS precio, i.factura_fecha, i.fecha
      FROM ingreso_items t
      JOIN ingresos_mercaderia i ON i.id = t.ingreso_id
     WHERE i.empresa_id = @empresaId AND i.estado = 'facturado'
       AND t.precio_unitario IS NOT NULL AND ${enIds("t.producto_id")}
     ORDER BY COALESCE(i.factura_fecha, i.fecha) ASC, t.id ASC
  `).all({ empresaId, ids }).map((r) => [Number(r.pid), r]));   // el Map se queda con el último

  return productos.map((p) => {
    const id = Number(p.id);
    const stock = Number(p.stock || 0);
    const c = consumo.get(id);
    const c90 = Number(c?.c90 || 0);
    const porMes = c90 / 3;
    const fx = flexxus.get(id);
    const ultimaCompra = compra.get(id);
    return {
      id,
      codigo: p.codigo ? String(p.codigo).trim() : null,
      nombre: p.nombre || "",
      codigoBarra: p.codigoBarra || null,
      activo: Number(p.activo ?? 1) === 1,
      imagen: p.imagen || null,
      categoria: p.categoriaId != null ? { id: Number(p.categoriaId), nombre: p.categoriaNombre || null } : null,
      rubros: (rubros.get(id) || []).map((r) => ({ id: Number(r.id), nombre: r.nombre })),
      precio: Number(p.precio || 0),
      ultimoPrecioCompra: ultimaCompra ? Number(ultimaCompra.precio) : null,
      stock: {
        disponible: stock,
        // Lo que volvió abierto, usado o roto: no está en el disponible.
        remanente: Number(p.remanente || 0),
        enCamino: enCamino.get(id) || 0,
        dudoso: stock >= STOCK_DUDOSO,
      },
      consumo: {
        ultimos90Dias: c90,
        promedioMensual: Math.round(porMes),
        // Sin consumo no hay cobertura que calcular: null, no infinito.
        mesesDeCobertura: porMes > 0 ? Math.round((stock / porMes) * 10) / 10 : null,
        ultimoPedido: c?.ultimo ? toISO(c.ultimo) : null,
      },
      devolucion: {
        retornable: Number(p.retornable || 0) === 1,
        preguntaAlVolver: PREGUNTA_AL_VOLVER[Number(p.preguntaEstado || 0)] || "ninguna",
      },
      flexxus: fx ? {
        estado: fx.estado || null,
        sku: fx.flexxus_sku || null,
        nombre: fx.flexxus_name || null,
        stock: fx.flexxus_stock == null ? null : Number(fx.flexxus_stock),
        ultimaSincronizacion: fx.ultima_sync ? toISO(fx.ultima_sync) : null,
      } : null,
      serviciosAsignados: servicios.get(id) || 0,
      visiblePara: [...new Set((roles.get(id) || []).map((r) => r.role))].sort(),
    };
  });
}

// Productos.Unit queda afuera a propósito: sólo vale "0" o "1", ninguna
// pantalla lo usa y no es una unidad de medida. Publicado como "unidad" se
// leería como "se mide en 0".
const COLUMNAS_PRODUCTO = `
  p.ProductID AS id, p.Code AS codigo, p.ProductName AS nombre, p.codigo_barra AS codigoBarra,
  p.is_active AS activo, p.image_url AS imagen, p.Precio AS precio,
  p.Stock AS stock, p.stock_remanente AS remanente, p.retornable AS retornable,
  p.pregunta_estado AS preguntaEstado, p.CategoriaID AS categoriaId, c.CategoriaNombre AS categoriaNombre`;
const FROM_PRODUCTO = `FROM Productos p LEFT JOIN Categorias c ON c.CategoriaID = p.CategoriaID`;

/**
 * GET /v1/insumos
 *   q                  busca en nombre o código, sin importar acentos ni mayúsculas
 *   codigo             código exacto (004 y 4 son el mismo)
 *   categoriaId        filtra por categoría (ver /v1/categorias)
 *   rubroId            filtra por rubro (ver /v1/categorias)
 *   incluirInactivos   1 para traer también los dados de baja
 *   page, limit        limit máximo 500 (por defecto 100)
 */
router.get("/insumos", (req, res) => {
  try {
    const empresaId = req.apiEmpresaId;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));

    const where = ["p.empresa_id = @empresaId"];
    const params = { empresaId, limit, offset: (page - 1) * limit };

    if (String(req.query.incluirInactivos || "") !== "1") where.push("COALESCE(p.is_active, 1) = 1");

    const q = String(req.query.q || "").trim();
    if (q) {
      where.push(`(${sinAcentosSql("p.ProductName")} LIKE @q OR ${sinAcentosSql("p.Code")} LIKE @q)`);
      params.q = `%${normalizarBusqueda(q)}%`;
    }

    const codigo = String(req.query.codigo || "").trim();
    if (codigo) {
      // Los códigos vienen con y sin ceros adelante según quién los cargó.
      where.push("TRIM(COALESCE(p.Code, '')) <> '' AND LTRIM(TRIM(p.Code), '0') = LTRIM(@codigo, '0')");
      params.codigo = codigo;
    }

    for (const campo of ["categoriaId", "rubroId"]) {
      const crudo = req.query[campo];
      if (crudo == null || String(crudo).trim() === "") continue;
      const n = Number(crudo);
      if (!Number.isInteger(n)) return errorParametro(res, campo, "Debe ser un número entero.");
      params[campo] = n;
    }
    if (params.categoriaId != null) where.push("p.CategoriaID = @categoriaId");
    if (params.rubroId != null) {
      where.push(`EXISTS (SELECT 1 FROM producto_rubro pr
                   WHERE CAST(pr.product_id AS INTEGER) = p.ProductID AND pr.rubro_id = @rubroId)`);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;
    const { total } = db.prepare(`SELECT COUNT(*) AS total ${FROM_PRODUCTO} ${whereSql}`).get(params);
    const productos = db.prepare(`
      SELECT ${COLUMNAS_PRODUCTO} ${FROM_PRODUCTO} ${whereSql}
      ORDER BY p.ProductName COLLATE NOCASE, p.ProductID
      LIMIT @limit OFFSET @offset
    `).all(params);

    res.json({
      empresaId,
      filtros: {
        q: q || null, codigo: codigo || null,
        categoriaId: params.categoriaId ?? null, rubroId: params.rubroId ?? null,
        incluirInactivos: String(req.query.incluirInactivos || "") === "1",
      },
      paginado: { page, limit, total, paginas: Math.max(1, Math.ceil(total / limit)) },
      insumos: fichas(empresaId, productos),
    });
  } catch (e) {
    console.error("[api/v1/insumos]", e?.message);
    res.status(500).json({ error: "error_interno", mensaje: "No se pudo procesar la consulta." });
  }
});

/**
 * GET /v1/insumos/:id — la ficha completa de un insumo: todo lo de la lista
 * más el detalle que en la lista sería demasiado (servicios, historial,
 * compras, devoluciones, consumo mes a mes, stock por depósito).
 */
router.get("/insumos/:id", (req, res) => {
  try {
    const empresaId = req.apiEmpresaId;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return errorParametro(res, "id", "Debe ser un número entero positivo.");

    const producto = db.prepare(
      `SELECT ${COLUMNAS_PRODUCTO} ${FROM_PRODUCTO} WHERE p.ProductID = @id AND p.empresa_id = @empresaId`
    ).get({ id, empresaId });
    // Un insumo de la otra empresa contesta igual que uno que no existe: no se
    // confirma ni se niega que el id exista del otro lado.
    if (!producto) return res.status(404).json({ error: "no_encontrado", mensaje: "No existe ese insumo." });

    const [ficha] = fichas(empresaId, [producto]);

    const consumoPorMes = db.prepare(`
      SELECT strftime('%Y-%m', datetime(d.Fecha, '-3 hours')) AS mes,
             SUM(i.Cantidad) AS cantidad, SUM(i.Subtotal) AS monto, COUNT(DISTINCT d.PedidoID) AS pedidos
        FROM v_pedido_items_neto i
        JOIN Pedidos d ON d.PedidoID = i.PedidoID
       WHERE d.deleted_at IS NULL AND d.empresa_id = @empresaId AND i.ProductoID = @id
         AND datetime(d.Fecha, '-3 hours') >= datetime('now', 'start of month', '-11 months')
       GROUP BY mes ORDER BY mes
    `).all({ empresaId, id }).map((r) => ({
      mes: r.mes,
      cantidad: Number(r.cantidad || 0),
      monto: Number(r.monto || 0),
      pedidos: Number(r.pedidos || 0),
    }));

    const porDeposito = db.prepare(`
      SELECT w.id, w.name AS nombre, ws.qty AS cantidad
        FROM warehouse_stock ws JOIN warehouses w ON w.id = ws.warehouse_id
       WHERE CAST(ws.product_id AS INTEGER) = @id
       ORDER BY w.name COLLATE NOCASE
    `).all({ id }).map((r) => ({ id: r.id, nombre: r.nombre, cantidad: Number(r.cantidad || 0) }));

    const enCamino = db.prepare(`
      SELECT qty AS cantidad, eta FROM IncomingStock
       WHERE CAST(product_id AS INTEGER) = @id AND DATE(eta) >= DATE('now') ORDER BY eta
    `).all({ id }).map((r) => ({ cantidad: Number(r.cantidad || 0), llega: r.eta }));

    const ingresos = db.prepare(`
      SELECT i.id, i.proveedor, i.numero AS remito, i.fecha, i.estado,
             i.factura_numero AS factura, i.factura_fecha AS fechaFactura,
             t.cantidad, t.precio_unitario AS precioUnitario
        FROM ingreso_items t JOIN ingresos_mercaderia i ON i.id = t.ingreso_id
       WHERE i.empresa_id = @empresaId AND t.producto_id = @id
       ORDER BY i.fecha DESC, i.id DESC LIMIT 20
    `).all({ empresaId, id }).map((r) => ({
      ingresoId: r.id,
      proveedor: r.proveedor,
      remito: r.remito,
      fecha: r.fecha,
      // Mismo nombre que en la pantalla: "conciliado" es que la factura del
      // proveedor ya se comparó con el remito y el stock subió.
      estado: r.estado === "facturado" ? "conciliado" : "sin_conciliar",
      factura: r.factura || null,
      fechaFactura: r.fechaFactura || null,
      cantidad: Number(r.cantidad || 0),
      precioUnitario: r.precioUnitario == null ? null : Number(r.precioUnitario),
    }));

    const devoluciones = db.prepare(`
      SELECT COALESCE(estado, 'sin_estado') AS estado, COALESCE(tipo, 'sin_tipo') AS tipo,
             COUNT(*) AS veces, SUM(cantidad) AS cantidad
        FROM devoluciones
       WHERE empresa_id = @empresaId AND CAST(producto_id AS INTEGER) = @id
       GROUP BY estado, tipo ORDER BY estado, tipo
    `).all({ empresaId, id }).map((r) => ({
      estado: r.estado, tipo: r.tipo, veces: Number(r.veces), cantidad: Number(r.cantidad || 0),
    }));

    // Sin CAST por la misma razón que en fichas(): usa los índices.
    const servicios = db.prepare(`
      SELECT DISTINCT s.ServiciosID AS id, s.ServicioNombre AS nombre
        FROM service_products sp
        JOIN Servicios s ON s.ServiciosID = sp.service_id
       WHERE s.empresa_id = @empresaId AND s.deleted_at IS NULL AND sp.product_id = @id
       ORDER BY s.ServicioNombre COLLATE NOCASE
    `).all({ empresaId, id }).map((r) => ({ id: Number(r.id), nombre: r.nombre || "" }));

    const historial = db.prepare(`
      SELECT fecha, tipo, campo, valor_anterior AS anterior, valor_nuevo AS nuevo,
             diferencia, usuario
        FROM ProductoHistorial
       WHERE CAST(product_id AS INTEGER) = @id
       ORDER BY fecha DESC, id DESC LIMIT 50
    `).all({ id }).map((r) => ({
      fecha: r.fecha ? toISO(r.fecha) : null,
      tipo: r.tipo || null,
      campo: r.campo || null,
      anterior: r.anterior ?? null,
      nuevo: r.nuevo ?? null,
      diferencia: r.diferencia == null ? null : Number(r.diferencia),
      usuario: r.usuario || null,
    }));

    res.json({
      empresaId,
      insumo: {
        ...ficha,
        stock: { ...ficha.stock, porDeposito, enCaminoDetalle: enCamino },
        consumo: { ...ficha.consumo, porMes: consumoPorMes },
        compras: ingresos,
        devoluciones,
        servicios,
        historial,
      },
    });
  } catch (e) {
    console.error("[api/v1/insumos/:id]", e?.message);
    res.status(500).json({ error: "error_interno", mensaje: "No se pudo procesar la consulta." });
  }
});

/** GET /v1/categorias — categorías y rubros, para saber qué ids usar en los filtros. */
router.get("/categorias", (req, res) => {
  try {
    const empresaId = req.apiEmpresaId;
    const categorias = db.prepare(`
      SELECT c.CategoriaID AS id, c.CategoriaNombre AS nombre, COUNT(p.ProductID) AS insumos
        FROM Categorias c
        LEFT JOIN Productos p ON p.CategoriaID = c.CategoriaID
                             AND p.empresa_id = @empresaId AND COALESCE(p.is_active, 1) = 1
       WHERE c.empresa_id = @empresaId
       GROUP BY c.CategoriaID ORDER BY c.CategoriaNombre COLLATE NOCASE
    `).all({ empresaId });
    const rubros = db.prepare(`
      SELECT r.id, r.nombre, r.criterio, COUNT(p.ProductID) AS insumos
        FROM insumo_rubros r
        LEFT JOIN producto_rubro pr ON pr.rubro_id = r.id
        LEFT JOIN Productos p ON p.ProductID = CAST(pr.product_id AS INTEGER)
                             AND p.empresa_id = @empresaId AND COALESCE(p.is_active, 1) = 1
       WHERE r.empresa_id = @empresaId
       GROUP BY r.id ORDER BY r.orden, r.nombre COLLATE NOCASE
    `).all({ empresaId });
    res.json({
      empresaId,
      categorias: categorias.map((c) => ({ id: c.id, nombre: c.nombre || "", insumosActivos: Number(c.insumos) })),
      rubros: rubros.map((r) => ({ id: r.id, nombre: r.nombre, criterio: r.criterio || null, insumosActivos: Number(r.insumos) })),
    });
  } catch (e) {
    console.error("[api/v1/categorias]", e?.message);
    res.status(500).json({ error: "error_interno", mensaje: "No se pudo procesar la consulta." });
  }
});

/** GET /v1/ping — para que el consumidor valide su token sin traer datos. */
router.get("/ping", (req, res) => {
  res.json({ ok: true, empresaId: req.apiEmpresaId, servidor: new Date().toISOString() });
});

export default router;
