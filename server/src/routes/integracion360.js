// server/src/routes/integracion360.js
//
// Alta de servicios desde la aplicación 360.
//
// Cuando en 360 se crea un servicio, 360 llama a esta API y el servicio se crea
// acá, en la empresa que se eligió allá (Kazaro o Pazar). Así el servicio se
// da de alta UNA sola vez, en 360, y no hay que cargarlo a mano en cada lado.
//
// Se monta en /v1/360 y, como Nginx quita el prefijo /api, para 360 queda en
// https://<host>/api/v1/360/...
//
// Autenticación: token fijo, en el header
//     Authorization: Bearer <token>
//   o X-API-Key: <token>
// configurado en el .env del servidor:
//     INTEGRACION_360_TOKEN=<token>
// (admite varios separados por coma, para poder rotarlo sin cortar el servicio).
//
// Es un token distinto al de la API de pedidos: aquel sólo lee, éste crea
// servicios. Si se filtra el de lectura, no alcanza para dar de alta nada.
//
// Garantías:
//   · La empresa es OBLIGATORIA. Nunca se crea en una empresa "por defecto".
//   · Cada servicio de 360 (su externoId) se crea una sola vez y en una sola
//     empresa. Reintentos del mismo aviso no duplican; mandarlo con la otra
//     empresa se rechaza.
//   · Si en esa empresa ya había un servicio con el mismo nombre (cargado a
//     mano antes de la integración), se vincula a ése en vez de duplicarlo.

import { Router } from "express";
import crypto from "crypto";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { db, audit } from "../db.js";

const router = Router();
const ORIGEN = "360";

/* ─────────────── Tabla de vínculos ─────────────── */

// Qué servicio de 360 corresponde a qué servicio de esta app. Es la que
// garantiza que cada uno se cree una sola vez: la clave única es el id de 360,
// sin importar la empresa.
function ensureTablaVinculos() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS servicios_externos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      origen      TEXT    NOT NULL,
      externo_id  TEXT    NOT NULL,
      empresa_id  INTEGER NOT NULL,
      servicio_id INTEGER NOT NULL,
      resultado   TEXT    NOT NULL,      -- 'creado' | 'vinculado'
      payload     TEXT,                  -- lo que mandó 360, para trazabilidad
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (origen, externo_id)
    )
  `);
}
ensureTablaVinculos();

/* ─────────────── Validación (pura, testeable) ─────────────── */

/** Espacios de más afuera y adentro: "  Super   Mami " → "Super Mami". */
export function normalizarNombre(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Traduce lo que manda 360 a una empresa. Acepta el id (1, "2"), el slug o el
 * nombre ("kazaro", "PAZAR"). Devuelve null si no corresponde a ninguna activa.
 */
export function resolverEmpresa(valor, empresas) {
  if (valor == null) return null;
  const v = String(valor).trim().toLowerCase();
  if (!v) return null;
  const e = empresas.find((x) =>
    String(x.EmpresaID) === v
    || String(x.slug || "").toLowerCase() === v
    || String(x.nombre || "").toLowerCase() === v);
  return e && Number(e.is_active ?? 1) === 1 ? e : null;
}

/** Valida el cuerpo del alta. Devuelve { ok, datos } o { ok:false, campo, mensaje }. */
export function validarAlta(body, empresas) {
  const b = body && typeof body === "object" ? body : {};

  const externoId = normalizarNombre(b.externoId);
  if (!externoId) {
    return { ok: false, campo: "externoId", mensaje: "Falta el id del servicio en 360 (externoId)." };
  }
  if (externoId.length > 100) {
    return { ok: false, campo: "externoId", mensaje: "externoId no puede superar los 100 caracteres." };
  }

  if (b.empresa == null || String(b.empresa).trim() === "") {
    return { ok: false, campo: "empresa", mensaje: "Falta la empresa. Valores válidos: " + listaEmpresas(empresas) + "." };
  }
  const empresa = resolverEmpresa(b.empresa, empresas);
  if (!empresa) {
    return { ok: false, campo: "empresa", mensaje: `Empresa desconocida: "${b.empresa}". Valores válidos: ${listaEmpresas(empresas)}.` };
  }

  const nombre = normalizarNombre(b.nombre);
  if (!nombre) return { ok: false, campo: "nombre", mensaje: "Falta el nombre del servicio." };
  if (nombre.length > 200) return { ok: false, campo: "nombre", mensaje: "El nombre no puede superar los 200 caracteres." };

  const opcional = (campo) => {
    const v = normalizarNombre(b[campo]);
    return v ? v.slice(0, 300) : null;
  };

  return {
    ok: true,
    datos: { externoId, empresa, nombre, direccion: opcional("direccion"), ciudad: opcional("ciudad") },
  };
}

function listaEmpresas(empresas) {
  return empresas
    .filter((e) => Number(e.is_active ?? 1) === 1)
    .map((e) => `"${e.slug}" (${e.EmpresaID})`)
    .join(" o ");
}

/* ─────────────── Autenticación ─────────────── */

function cargarTokens() {
  return String(process.env.INTEGRACION_360_TOKEN || "")
    .split(",").map((t) => t.trim()).filter(Boolean);
}

function tokenDelRequest(req) {
  const auth = String(req.get("authorization") || "");
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  return bearer || req.get("x-api-key") || "";
}

// Comparación en tiempo constante, igual que en la API de pedidos.
function tokenValido(recibido, tokens) {
  const bufRec = Buffer.from(String(recibido));
  return tokens.some((t) => {
    const bufOk = Buffer.from(t);
    return bufRec.length === bufOk.length && crypto.timingSafeEqual(bufRec, bufOk);
  });
}

function requiereToken(req, res, next) {
  const tokens = cargarTokens();
  if (!tokens.length) {
    return res.status(503).json({
      error: "api_no_configurada",
      mensaje: "La integración con 360 no tiene token configurado en el servidor.",
    });
  }
  const recibido = tokenDelRequest(req);
  if (!recibido) {
    return res.status(401).json({
      error: "falta_token",
      mensaje: "Enviá el token en el header Authorization: Bearer <token> o X-API-Key.",
    });
  }
  if (!tokenValido(recibido, tokens)) {
    return res.status(403).json({ error: "token_invalido", mensaje: "El token no es válido." });
  }
  next();
}

const limitador = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const token = tokenDelRequest(req);
    if (token) return "360:" + crypto.createHash("sha256").update(token).digest("hex");
    // ipKeyGenerator agrupa las IPv6 por subred: si no, cada dirección de
    // una misma red contaría aparte y se podría esquivar el límite.
    return "360ip:" + ipKeyGenerator(req.ip || "0.0.0.0");
  },
  message: {
    error: "demasiadas_consultas",
    mensaje: "Máximo 60 consultas por minuto. Reintentá en unos segundos.",
  },
});

router.use(limitador);
router.use(requiereToken);

/* ─────────────── Helpers de datos ─────────────── */

function empresasActivas() {
  return db.prepare(`SELECT EmpresaID, slug, nombre, is_active FROM Empresas`).all();
}

function servicioPorId(id) {
  return db.prepare(
    `SELECT ServiciosID AS id, ServicioNombre AS nombre, Direccion AS direccion, Ciudad AS ciudad,
            empresa_id AS empresaId, deleted_at AS eliminadoAt
     FROM Servicios WHERE ServiciosID = ?`
  ).get(id);
}

function respuestaServicio(vinculo, servicio, empresas) {
  const emp = empresas.find((e) => Number(e.EmpresaID) === Number(vinculo.empresa_id));
  return {
    externoId: vinculo.externo_id,
    empresa: emp ? { id: emp.EmpresaID, slug: emp.slug, nombre: emp.nombre } : { id: vinculo.empresa_id },
    servicio: servicio
      ? {
          id: servicio.id,
          nombre: servicio.nombre || "",
          direccion: servicio.direccion || null,
          ciudad: servicio.ciudad || null,
          // Si alguien lo dio de baja en esta app, se avisa en vez de esconderlo.
          activo: !servicio.eliminadoAt,
        }
      : null,
    vinculadoEl: vinculo.created_at,
  };
}

/* ─────────────── Endpoints ─────────────── */

/**
 * POST /v1/360/servicios
 *   { externoId, empresa, nombre, direccion?, ciudad? }
 *
 * 201 creado      — se creó el servicio.
 * 200 ya_existia  — ese externoId ya se había procesado (reintento): no se toca nada.
 * 200 vinculado   — ya había un servicio con ese nombre en esa empresa: se vinculó a ése.
 * 409 ya_creado_en_otra_empresa — ese externoId ya existe, pero en la otra empresa.
 */
router.post("/servicios", (req, res) => {
  try {
    const empresas = empresasActivas();
    const v = validarAlta(req.body, empresas);
    if (!v.ok) return res.status(400).json({ error: "parametro_invalido", campo: v.campo, mensaje: v.mensaje });
    const { externoId, empresa, nombre, direccion, ciudad } = v.datos;
    const empresaId = Number(empresa.EmpresaID);

    // Todo en una transacción: better-sqlite3 es sincrónico, así que dos avisos
    // simultáneos del mismo servicio no pueden intercalarse. La clave única de
    // la tabla queda además como red de seguridad.
    const resultado = db.transaction(() => {
      const previo = db.prepare(
        `SELECT * FROM servicios_externos WHERE origen = ? AND externo_id = ?`
      ).get(ORIGEN, externoId);

      if (previo) {
        if (Number(previo.empresa_id) !== empresaId) {
          return { tipo: "otra_empresa", vinculo: previo };
        }
        return { tipo: "ya_existia", vinculo: previo };
      }

      const mismoNombre = db.prepare(
        `SELECT ServiciosID AS id FROM Servicios
         WHERE empresa_id = ? AND deleted_at IS NULL
           AND lower(trim(ServicioNombre)) = lower(trim(?))
         ORDER BY ServiciosID LIMIT 1`
      ).get(empresaId, nombre);

      let servicioId;
      let tipo;
      if (mismoNombre) {
        servicioId = Number(mismoNombre.id);
        tipo = "vinculado";
      } else {
        const info = db.prepare(
          `INSERT INTO Servicios (ServicioNombre, Direccion, Ciudad, empresa_id) VALUES (?, ?, ?, ?)`
        ).run(nombre, direccion, ciudad, empresaId);
        servicioId = Number(info.lastInsertRowid);
        tipo = "creado";
      }

      db.prepare(
        `INSERT INTO servicios_externos (origen, externo_id, empresa_id, servicio_id, resultado, payload)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(ORIGEN, externoId, empresaId, servicioId, tipo, JSON.stringify(req.body ?? {}).slice(0, 4000));

      const vinculo = db.prepare(
        `SELECT * FROM servicios_externos WHERE origen = ? AND externo_id = ?`
      ).get(ORIGEN, externoId);
      return { tipo, vinculo };
    })();

    const { tipo, vinculo } = resultado;
    const servicio = servicioPorId(vinculo.servicio_id);

    if (tipo === "otra_empresa") {
      const otra = empresas.find((e) => Number(e.EmpresaID) === Number(vinculo.empresa_id));
      return res.status(409).json({
        error: "ya_creado_en_otra_empresa",
        mensaje: `Ese servicio de 360 ya se creó en ${otra?.nombre || "otra empresa"}. `
          + "No se crea en las dos: si la empresa estaba mal, hay que corregirlo a mano.",
        ...respuestaServicio(vinculo, servicio, empresas),
      });
    }

    if (tipo === "creado" || tipo === "vinculado") {
      audit({
        empresaId,
        usuario: "integracion-360",
        accion: tipo === "creado" ? "create" : "link",
        entidad: "Servicio",
        entidadId: String(vinculo.servicio_id),
        detalle: `360 externoId=${externoId}: ${tipo === "creado" ? "creado" : "vinculado a existente"} "${nombre}"`,
      });
      console.log(`[360] Servicio ${tipo}: "${nombre}" (empresa ${empresaId}, externoId ${externoId}, id ${vinculo.servicio_id})`);
    }

    // Aviso, sin bloquear: mismo nombre en la OTRA empresa. Puede ser legítimo
    // (un cliente atendido por las dos), pero conviene que alguien lo mire.
    const enOtra = db.prepare(
      `SELECT s.ServiciosID AS id, e.nombre AS empresa FROM Servicios s
       JOIN Empresas e ON e.EmpresaID = s.empresa_id
       WHERE s.empresa_id <> ? AND s.deleted_at IS NULL
         AND lower(trim(s.ServicioNombre)) = lower(trim(?)) LIMIT 1`
    ).get(empresaId, nombre);

    // Aviso: otro servicio de 360 ya apuntaba a este mismo servicio (tienen el
    // mismo nombre). Acá los nombres son únicos por empresa, así que no se
    // puede crear un segundo; pero si en 360 son dos servicios distintos,
    // alguien tiene que diferenciarlos por nombre.
    const compartido = db.prepare(
      `SELECT externo_id FROM servicios_externos
       WHERE origen = ? AND servicio_id = ? AND externo_id <> ? LIMIT 1`
    ).get(ORIGEN, vinculo.servicio_id, externoId);

    const advertencias = [];
    if (enOtra) advertencias.push(`Ya existe un servicio con el mismo nombre en ${enOtra.empresa} (id ${enOtra.id}).`);
    if (compartido) advertencias.push(`El servicio de 360 "${compartido.externo_id}" también está vinculado a este mismo servicio.`);

    return res.status(tipo === "creado" ? 201 : 200).json({
      resultado: tipo,
      ...respuestaServicio(vinculo, servicio, empresas),
      ...(advertencias.length ? { advertencias } : {}),
    });
  } catch (e) {
    console.error("[360] POST /servicios", e?.message);
    res.status(500).json({ error: "error_interno", mensaje: "No se pudo procesar el alta." });
  }
});

/** GET /v1/360/servicios/:externoId — para que 360 consulte cómo quedó un alta. */
router.get("/servicios/:externoId", (req, res) => {
  try {
    const externoId = normalizarNombre(req.params.externoId);
    const vinculo = db.prepare(
      `SELECT * FROM servicios_externos WHERE origen = ? AND externo_id = ?`
    ).get(ORIGEN, externoId);
    if (!vinculo) {
      return res.status(404).json({ error: "no_encontrado", mensaje: "Ese servicio de 360 todavía no se dio de alta acá." });
    }
    res.json(respuestaServicio(vinculo, servicioPorId(vinculo.servicio_id), empresasActivas()));
  } catch (e) {
    console.error("[360] GET /servicios/:id", e?.message);
    res.status(500).json({ error: "error_interno", mensaje: "No se pudo procesar la consulta." });
  }
});

/** GET /v1/360/ping — para validar el token sin crear nada. */
router.get("/ping", (req, res) => {
  res.json({ ok: true, integracion: "360", servidor: new Date().toISOString() });
});

// Cualquier otra ruta o método bajo /v1/360 no existe.
router.use((req, res) => {
  res.status(404).json({ error: "no_encontrado", mensaje: "Ruta inexistente en la integración 360." });
});

export default router;
