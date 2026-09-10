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
//   · Si en 360 se cambia el nombre, se cambia acá (PUT, o reenviando el alta).
//   · Si en 360 se asigna el supervisor, se asigna acá (sólo Kazaro: en Pazar
//     todos los supervisores ven todos los servicios). Se busca por nombre y
//     sólo se asigna si coincide con exactamente un supervisor activo.
//   · Presupuesto y mails del servicio se asignan únicamente desde el panel:
//     si 360 los manda, se ignoran y se avisa en `camposIgnorados`.

import { Router } from "express";
import crypto from "crypto";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { db, audit, empresaVeTodosLosServicios } from "../db.js";

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

/**
 * Campos que 360 mandó pero que esta API no usa (ej. supervisor, presupuesto,
 * mails: eso se maneja sólo desde el panel). No se rechaza el pedido; se
 * informa en la respuesta para que del otro lado no crean que se cargaron.
 */
export function camposIgnorados(body, permitidos) {
  if (!body || typeof body !== "object") return [];
  return Object.keys(body).filter((k) => !permitidos.includes(k));
}
const CAMPOS_ALTA = ["externoId", "empresa", "nombre", "direccion", "ciudad", "supervisor"];
const CAMPOS_CAMBIO = ["nombre", "empresa"];
const CAMPOS_SUPERVISOR = ["nombre", "dni"];

/* ─────────────── Supervisor (pura, testeable) ─────────────── */

/**
 * Lee el supervisor que manda 360. Acepta `"Juan Pérez"` o
 * `{ nombre: "Juan Pérez", dni: "30123456" }`. Si no vino, datos = null.
 */
export function leerSupervisor(valor) {
  if (valor == null || valor === "") return { ok: true, datos: null };
  if (typeof valor === "string") {
    const nombre = normalizarNombre(valor);
    return nombre ? { ok: true, datos: { nombre, dni: null } } : { ok: true, datos: null };
  }
  if (typeof valor !== "object" || Array.isArray(valor)) {
    return { ok: false, campo: "supervisor", mensaje: "supervisor tiene que ser un texto o { nombre, dni }." };
  }
  const nombre = normalizarNombre(valor.nombre);
  if (!nombre) return { ok: false, campo: "supervisor.nombre", mensaje: "Falta el nombre del supervisor." };
  if (nombre.length > 200) return { ok: false, campo: "supervisor.nombre", mensaje: "El nombre del supervisor no puede superar los 200 caracteres." };
  const dni = normalizarNombre(valor.dni).slice(0, 30) || null;
  return { ok: true, datos: { nombre, dni } };
}

/** "MURUA, Juan  Domingo" → ["murua", "juan", "domingo"]: sin acentos, mayúsculas ni signos. */
export function palabrasNombre(s) {
  return String(s ?? "")
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/).filter(Boolean);
}

/**
 * Busca el supervisor que corresponde al nombre que manda 360 (que allá sale
 * del DNI, así que puede venir en otro orden, con los dos apellidos o sin el
 * segundo nombre).
 *
 * Un supervisor coincide si el nombre de 360 contiene TODO su apellido y AL
 * MENOS UNO de sus nombres. Sólo se asigna si coincide exactamente uno: con
 * cero o con más de uno no se adivina.
 *
 * @returns {{ tipo: "unico"|"ninguno"|"varios", coincidencias: object[] }}
 */
export function buscarSupervisor(nombre360, supervisores) {
  const del360 = new Set(palabrasNombre(nombre360));
  if (!del360.size) return { tipo: "ninguno", coincidencias: [] };
  const coincidencias = supervisores.filter((s) => {
    const apellido = palabrasNombre(s.Apellido);
    const nombres = palabrasNombre(s.Nombre);
    return apellido.length > 0 && nombres.length > 0
      && apellido.every((p) => del360.has(p))
      && nombres.some((p) => del360.has(p));
  });
  if (coincidencias.length === 1) return { tipo: "unico", coincidencias };
  return { tipo: coincidencias.length ? "varios" : "ninguno", coincidencias };
}

/** Middleware: agrega `camposIgnorados` a la respuesta si vino algo de más. */
function avisarIgnorados(permitidos) {
  return (req, res, next) => {
    const ign = camposIgnorados(req.body, permitidos);
    if (ign.length) {
      const original = res.json.bind(res);
      res.json = (b) => original(b && typeof b === "object" && !Array.isArray(b) ? { ...b, camposIgnorados: ign } : b);
    }
    next();
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

/**
 * Cambia el nombre del servicio vinculado a un externoId. El nombre de 360
 * manda: lo que se renombre allá se renombra acá.
 *
 * No renombra (y no toca nada) si:
 *   · el nombre nuevo ya lo usa OTRO servicio de la misma empresa: acá los
 *     nombres son únicos por empresa.
 *   · el servicio lo comparten dos servicios de 360 (quedaron vinculados al
 *     mismo por tener el mismo nombre): renombrarlo por uno le cambiaría el
 *     nombre al otro. Lo tiene que separar una persona.
 *
 * Devuelve { status, body }. El cambio queda en la auditoría.
 */
function renombrar(vinculo, nombreNuevo, empresas) {
  const r = db.transaction(() => {
    const actual = servicioPorId(vinculo.servicio_id);
    if (!actual) {
      return { status: 404, body: { error: "no_encontrado", mensaje: "El servicio vinculado ya no existe en Insumos." } };
    }
    if (actual.nombre === nombreNuevo) return { status: 200, tipo: "sin_cambios" };

    const otroVinculo = db.prepare(
      `SELECT externo_id FROM servicios_externos
       WHERE origen = ? AND servicio_id = ? AND externo_id <> ? LIMIT 1`
    ).get(ORIGEN, vinculo.servicio_id, vinculo.externo_id);
    if (otroVinculo) {
      return {
        status: 409,
        body: {
          error: "servicio_compartido",
          mensaje: `Este servicio también está vinculado al servicio de 360 "${otroVinculo.externo_id}". `
            + "No se renombra para no cambiarle el nombre al otro: hay que separarlos a mano.",
        },
      };
    }

    const choque = db.prepare(
      `SELECT ServiciosID AS id FROM Servicios
       WHERE empresa_id = ? AND deleted_at IS NULL AND ServiciosID <> ?
         AND lower(trim(ServicioNombre)) = lower(trim(?)) LIMIT 1`
    ).get(vinculo.empresa_id, vinculo.servicio_id, nombreNuevo);
    if (choque) {
      return {
        status: 409,
        body: {
          error: "nombre_en_uso",
          mensaje: `Ya hay otro servicio llamado "${nombreNuevo}" en esta empresa (id ${choque.id}). No se renombró.`,
        },
      };
    }

    db.prepare(`UPDATE Servicios SET ServicioNombre = ? WHERE ServiciosID = ?`).run(nombreNuevo, vinculo.servicio_id);
    return { status: 200, tipo: "actualizado", anterior: actual.nombre };
  })();

  if (r.body) {
    return { status: r.status, body: { ...r.body, ...respuestaServicio(vinculo, servicioPorId(vinculo.servicio_id), empresas) } };
  }

  if (r.tipo === "actualizado") {
    audit({
      empresaId: vinculo.empresa_id,
      usuario: "integracion-360",
      accion: "update",
      entidad: "Servicio",
      entidadId: String(vinculo.servicio_id),
      detalle: `360 externoId=${vinculo.externo_id}: renombrado de "${r.anterior}" a "${nombreNuevo}"`,
    });
    console.log(`[360] Servicio renombrado: "${r.anterior}" -> "${nombreNuevo}" (id ${vinculo.servicio_id}, externoId ${vinculo.externo_id})`);
  }

  return {
    status: 200,
    body: {
      resultado: r.tipo,
      ...(r.tipo === "actualizado" ? { nombreAnterior: r.anterior } : {}),
      ...respuestaServicio(vinculo, servicioPorId(vinculo.servicio_id), empresas),
    },
  };
}

/**
 * Asigna al servicio el supervisor que manda 360, buscándolo por nombre.
 *
 *   · Pazar: no se asigna nada. Allá todos los supervisores ven todos los
 *     servicios (empresaVeTodosLosServicios), así que el servicio ya lo ve
 *     cualquiera sin asignación.
 *   · Cada servicio tiene UN supervisor: si ya tenía otro (asignado desde el
 *     panel o antes desde 360), se reemplaza. Es lo mismo que "reasignar" en
 *     el panel.
 *   · Si el nombre no coincide con ningún supervisor, o con más de uno, no se
 *     toca la asignación que hubiera.
 *
 * Devuelve { status, body } con body = { resultado, mensaje, supervisor, ... }.
 * `dni` se guarda en la auditoría: acá no hay DNI de los empleados para
 * comparar, pero queda registrado qué persona mandó 360.
 */
function asignarSupervisor(vinculo, datos) {
  const nombre = normalizarNombre(datos?.nombre);
  const dni = normalizarNombre(datos?.dni) || null;
  if (!nombre) {
    return { status: 400, body: { resultado: "error", error: "parametro_invalido", campo: "supervisor.nombre", mensaje: "Falta el nombre del supervisor." } };
  }

  if (empresaVeTodosLosServicios(vinculo.empresa_id)) {
    return {
      status: 200,
      body: {
        resultado: "no_aplica",
        mensaje: "En esta empresa todos los supervisores ven todos los servicios: no se asigna supervisor.",
        supervisor: null,
      },
    };
  }

  const supervisores = db.prepare(`
    SELECT e.EmpleadosID AS id, e.Nombre, e.Apellido
    FROM Empleados e
    WHERE e.empresa_id = ? AND COALESCE(e.is_active, 1) = 1
      AND EXISTS (SELECT 1 FROM Roles_Empleados re JOIN Roles r ON r.RolID = re.RolID
                  WHERE re.EmpleadoID = e.EmpleadosID AND lower(r.Nombre) = 'supervisor')
  `).all(vinculo.empresa_id);

  const nombreDe = (s) => `${s.Nombre || ""} ${s.Apellido || ""}`.trim();
  const b = buscarSupervisor(nombre, supervisores);

  if (b.tipo === "ninguno") {
    return {
      status: 422,
      body: {
        resultado: "no_encontrado", error: "supervisor_no_encontrado",
        mensaje: `No hay ningún supervisor activo llamado "${nombre}" en Insumos. No se asignó: hay que revisar el nombre o crear el usuario.`,
        supervisor: null,
      },
    };
  }
  if (b.tipo === "varios") {
    return {
      status: 422,
      body: {
        resultado: "ambiguo", error: "supervisor_ambiguo",
        mensaje: `"${nombre}" coincide con más de un supervisor. No se asignó para no elegir mal.`,
        candidatos: b.coincidencias.map(nombreDe),
        supervisor: null,
      },
    };
  }

  const elegido = b.coincidencias[0];
  const previo = db.prepare(
    `SELECT a.EmpleadoID AS id, e.Nombre, e.Apellido FROM supervisor_services a
     LEFT JOIN Empleados e ON e.EmpleadosID = a.EmpleadoID
     WHERE a.ServicioID = ? LIMIT 1`
  ).get(vinculo.servicio_id);

  const supervisorJson = { id: Number(elegido.id), nombre: nombreDe(elegido) };
  if (previo && Number(previo.id) === Number(elegido.id)) {
    return { status: 200, body: { resultado: "ya_asignado", supervisor: supervisorJson } };
  }

  // Lo mismo que hace el panel al cambiar de supervisor: se borra el que
  // estaba y se asigna el nuevo, pero en una sola transacción. No se usa
  // reassignServiceToSupervisor() de db.js porque compara con
  // CAST(? AS TEXT), y un número de JS se convierte en "907.0": no borra al
  // anterior y el alta choca con el índice único de ServicioID.
  db.transaction(() => {
    db.prepare(`DELETE FROM supervisor_services WHERE ServicioID = ?`).run(Number(vinculo.servicio_id));
    db.prepare(`INSERT INTO supervisor_services (EmpleadoID, ServicioID) VALUES (?, ?)`)
      .run(Number(elegido.id), Number(vinculo.servicio_id));
  })();

  audit({
    empresaId: vinculo.empresa_id,
    usuario: "integracion-360",
    accion: "assign",
    entidad: "Servicio",
    entidadId: String(vinculo.servicio_id),
    detalle: `360 externoId=${vinculo.externo_id}: supervisor "${nombreDe(elegido)}" (id ${elegido.id})`
      + (previo ? `, reemplaza a "${nombreDe(previo)}" (id ${previo.id})` : "")
      + ` — 360 mandó "${nombre}"${dni ? `, DNI ${dni}` : ""}`,
  });
  console.log(`[360] Supervisor asignado: servicio ${vinculo.servicio_id} -> ${nombreDe(elegido)} (id ${elegido.id})`);

  return {
    status: 200,
    body: {
      resultado: "asignado",
      supervisor: supervisorJson,
      ...(previo ? { reemplazoA: { id: Number(previo.id), nombre: nombreDe(previo) } } : {}),
    },
  };
}

/* ─────────────── Endpoints ─────────────── */

/**
 * POST /v1/360/servicios
 *   { externoId, empresa, nombre, direccion?, ciudad? }
 *
 * 201 creado      — se creó el servicio.
 * 200 ya_existia  — ese externoId ya se había procesado (reintento): no se toca nada.
 * 200 actualizado — ya existía pero llegó con otro nombre: se renombró (ver renombrar()).
 * 200 vinculado   — ya había un servicio con ese nombre en esa empresa: se vinculó a ése.
 * 409 ya_creado_en_otra_empresa — ese externoId ya existe, pero en la otra empresa.
 */
router.post("/servicios", avisarIgnorados(CAMPOS_ALTA), (req, res) => {
  try {
    const empresas = empresasActivas();
    const v = validarAlta(req.body, empresas);
    if (!v.ok) return res.status(400).json({ error: "parametro_invalido", campo: v.campo, mensaje: v.mensaje });
    const { externoId, empresa, nombre, direccion, ciudad } = v.datos;
    const empresaId = Number(empresa.EmpresaID);

    // Supervisor opcional en el alta. Se valida ANTES de crear nada, para no
    // dejar un alta a medias por un dato mal armado.
    const sup = leerSupervisor(req.body?.supervisor);
    if (!sup.ok) return res.status(400).json({ error: "parametro_invalido", campo: sup.campo, mensaje: sup.mensaje });

    // El supervisor se asigna después del alta o del cambio de nombre, y su
    // resultado viaja aparte: que no se encuentre al supervisor no deshace el
    // alta del servicio.
    const responder = (status, body, vinc) => {
      if (sup.datos && vinc && status < 500) {
        body = { ...body, asignacionSupervisor: asignarSupervisor(vinc, sup.datos).body };
      }
      return res.status(status).json(body);
    };

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

    // Reenvío del alta con OTRO nombre: se toma como un cambio de nombre. Así
    // funciona aunque 360 mande siempre el mismo aviso al guardar el servicio.
    if (tipo === "ya_existia" && servicio && servicio.nombre !== nombre) {
      const r = renombrar(vinculo, nombre, empresas);
      return responder(r.status, r.body, vinculo);
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

    return responder(tipo === "creado" ? 201 : 200, {
      resultado: tipo,
      ...respuestaServicio(vinculo, servicio, empresas),
      ...(advertencias.length ? { advertencias } : {}),
    }, vinculo);
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
    // Supervisor actual, para que 360 pueda confirmar cómo quedó.
    const sa = db.prepare(
      `SELECT a.EmpleadoID AS id, e.Nombre, e.Apellido FROM supervisor_services a
       LEFT JOIN Empleados e ON e.EmpleadosID = a.EmpleadoID WHERE a.ServicioID = ? LIMIT 1`
    ).get(vinculo.servicio_id);
    res.json({
      ...respuestaServicio(vinculo, servicioPorId(vinculo.servicio_id), empresasActivas()),
      supervisorActual: empresaVeTodosLosServicios(vinculo.empresa_id)
        ? "todos (en esta empresa todos los supervisores ven todos los servicios)"
        : (sa ? { id: Number(sa.id), nombre: `${sa.Nombre || ""} ${sa.Apellido || ""}`.trim() } : null),
    });
  } catch (e) {
    console.error("[360] GET /servicios/:id", e?.message);
    res.status(500).json({ error: "error_interno", mensaje: "No se pudo procesar la consulta." });
  }
});

/**
 * PUT /v1/360/servicios/:externoId
 *   { nombre, empresa? }
 *
 * Cambia el nombre. Es lo único que se puede cambiar desde 360: supervisor,
 * presupuesto y mails del servicio se manejan sólo desde el panel.
 * `empresa` es opcional; si viene y no coincide con la del servicio, 409.
 */
router.put("/servicios/:externoId", avisarIgnorados(CAMPOS_CAMBIO), (req, res) => {
  try {
    const empresas = empresasActivas();
    const externoId = normalizarNombre(req.params.externoId);
    const b = req.body && typeof req.body === "object" ? req.body : {};

    const nombre = normalizarNombre(b.nombre);
    if (!nombre) return res.status(400).json({ error: "parametro_invalido", campo: "nombre", mensaje: "Falta el nombre nuevo del servicio." });
    if (nombre.length > 200) return res.status(400).json({ error: "parametro_invalido", campo: "nombre", mensaje: "El nombre no puede superar los 200 caracteres." });

    const vinculo = db.prepare(
      `SELECT * FROM servicios_externos WHERE origen = ? AND externo_id = ?`
    ).get(ORIGEN, externoId);
    if (!vinculo) {
      return res.status(404).json({
        error: "no_encontrado",
        mensaje: "Ese servicio de 360 todavía no se dio de alta acá. Primero hay que crearlo con POST /servicios.",
      });
    }

    if (b.empresa != null && String(b.empresa).trim() !== "") {
      const emp = resolverEmpresa(b.empresa, empresas);
      if (!emp) {
        return res.status(400).json({ error: "parametro_invalido", campo: "empresa", mensaje: `Empresa desconocida: "${b.empresa}". Valores válidos: ${listaEmpresas(empresas)}.` });
      }
      if (Number(emp.EmpresaID) !== Number(vinculo.empresa_id)) {
        const suya = empresas.find((e) => Number(e.EmpresaID) === Number(vinculo.empresa_id));
        return res.status(409).json({
          error: "ya_creado_en_otra_empresa",
          mensaje: `Ese servicio de 360 está dado de alta en ${suya?.nombre || "otra empresa"}, no en ${emp.nombre}. `
            + "Un servicio no se cambia de empresa desde 360.",
          ...respuestaServicio(vinculo, servicioPorId(vinculo.servicio_id), empresas),
        });
      }
    }

    const r = renombrar(vinculo, nombre, empresas);
    res.status(r.status).json(r.body);
  } catch (e) {
    console.error("[360] PUT /servicios/:id", e?.message);
    res.status(500).json({ error: "error_interno", mensaje: "No se pudo procesar el cambio." });
  }
});

/**
 * PUT /v1/360/servicios/:externoId/supervisor
 *   { nombre, dni? }
 *
 * Asigna (o reemplaza) el supervisor del servicio. En Pazar responde
 * "no_aplica" sin tocar nada. Si el nombre no coincide con exactamente un
 * supervisor activo, 422 y no se toca la asignación que hubiera.
 */
router.put("/servicios/:externoId/supervisor", avisarIgnorados(CAMPOS_SUPERVISOR), (req, res) => {
  try {
    const externoId = normalizarNombre(req.params.externoId);
    const sup = leerSupervisor(req.body && typeof req.body === "object" ? req.body : null);
    if (!sup.ok || !sup.datos) {
      return res.status(400).json({ error: "parametro_invalido", campo: "nombre", mensaje: "Falta el nombre del supervisor." });
    }

    const vinculo = db.prepare(
      `SELECT * FROM servicios_externos WHERE origen = ? AND externo_id = ?`
    ).get(ORIGEN, externoId);
    if (!vinculo) {
      return res.status(404).json({
        error: "no_encontrado",
        mensaje: "Ese servicio de 360 todavía no se dio de alta acá. Primero hay que crearlo con POST /servicios.",
      });
    }

    const r = asignarSupervisor(vinculo, sup.datos);
    res.status(r.status).json({
      ...r.body,
      ...respuestaServicio(vinculo, servicioPorId(vinculo.servicio_id), empresasActivas()),
    });
  } catch (e) {
    console.error("[360] PUT /servicios/:id/supervisor", e?.message);
    res.status(500).json({ error: "error_interno", mensaje: "No se pudo asignar el supervisor." });
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
