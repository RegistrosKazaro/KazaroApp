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
import rateLimit from "express-rate-limit";
import { db, getEmployeeDisplayName } from "../db.js";
import { toISO, fmtAr, diaAr } from "../utils/fechas.js";

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
    return "ip:" + (req.ip || "desconocida");
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

    const where = ["p.deleted_at IS NULL", "p.empresa_id = @empresaId"];
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

    const stmtItems = db.prepare(`
      SELECT Codigo AS codigo, Nombre AS nombre, Cantidad AS cantidad,
             Precio AS precio, Subtotal AS subtotal
      FROM PedidoItems WHERE PedidoID = ? ORDER BY PedidoItemID
    `);

    const pedidos = filas.map((r) => {
      const items = stmtItems.all(r.id).map((i) => ({
        codigo: i.codigo || null,
        insumo: i.nombre || "",
        cantidad: Number(i.cantidad || 0),
        precioUnitario: Number(i.precio || 0),
        subtotal: Number(i.subtotal ?? Number(i.precio || 0) * Number(i.cantidad || 0)),
      }));
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
        total: Number(r.total || 0),
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

/** GET /v1/ping — para que el consumidor valide su token sin traer datos. */
router.get("/ping", (req, res) => {
  res.json({ ok: true, empresaId: req.apiEmpresaId, servidor: new Date().toISOString() });
});

export default router;
