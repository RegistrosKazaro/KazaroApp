// flexxusDepositos.js — El mapeo entre un servicio de la app y su depósito en
// Flexxus. Cada servicio es un depósito del otro lado, y ese código es lo que
// necesita el remito de transferencia para saber a dónde va la mercadería.
//
// Varios servicios PUEDEN compartir depósito: Flexxus a veces agrupa (una zona,
// un complejo) lo que la app tiene separado. No es un error.
//
// Un servicio SIN depósito tampoco es un error: existe en la app y no en
// Flexxus (por ejemplo UEPC - Sede Administrativa). Se deja asentado con
// codigo_deposito en NULL para distinguirlo de "todavía no lo miramos".
//
// Las funciones reciben `db` como primer parámetro: así se pueden probar contra
// una base en memoria, y db.js puede importar este archivo sin que se arme una
// importación circular.

/** DEPOSITO CENTRAL, Córdoba. Es el origen de todo lo que sale. */
export const DEPOSITO_CENTRAL = "001";

/** De dónde salió el mapeo. 'confirmado' manda sobre 'automatico'. */
export const ORIGENES = ["confirmado", "automatico", "manual"];

const ahora = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const texto = (v) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

export function ensureTablas(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS flexxus_depositos (
      servicio_id     INTEGER PRIMARY KEY,
      codigo_deposito TEXT,
      nombre_deposito TEXT,
      origen          TEXT NOT NULL DEFAULT 'manual',
      motivo          TEXT,
      actualizado_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_fdep_codigo ON flexxus_depositos(codigo_deposito);
  `);
}

/**
 * Asigna (o reasigna) el depósito de un servicio.
 * `codigoDeposito` en null o vacío significa "no existe en Flexxus".
 */
export function asignar(db, { servicioId, codigoDeposito = null, nombreDeposito = null,
                              origen = "manual", motivo = null } = {}) {
  const id = Number(servicioId);
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, error: "Falta el servicio." };
  }
  if (!ORIGENES.includes(origen)) {
    return { ok: false, error: `Origen desconocido: "${origen}".` };
  }
  db.prepare(`
    INSERT INTO flexxus_depositos (servicio_id, codigo_deposito, nombre_deposito, origen, motivo, actualizado_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(servicio_id) DO UPDATE SET
      codigo_deposito = excluded.codigo_deposito,
      nombre_deposito = excluded.nombre_deposito,
      origen          = excluded.origen,
      motivo          = excluded.motivo,
      actualizado_at  = excluded.actualizado_at
  `).run(id, texto(codigoDeposito), texto(nombreDeposito), origen, texto(motivo), ahora());
  return { ok: true, servicioId: id, codigoDeposito: texto(codigoDeposito) };
}

/**
 * El depósito de un servicio.
 * - null            -> nunca se miró
 * - { codigo: null }-> se miró y NO existe en Flexxus
 */
export function depositoDe(db, servicioId) {
  const row = db.prepare(`
    SELECT servicio_id, codigo_deposito, nombre_deposito, origen, motivo
    FROM flexxus_depositos WHERE servicio_id = ?`).get(Number(servicioId));
  if (!row) return null;
  return {
    servicioId: row.servicio_id,
    codigo: row.codigo_deposito,
    nombre: row.nombre_deposito,
    origen: row.origen,
    motivo: row.motivo,
  };
}

/**
 * Carga el archivo de decisiones confirmadas (confirmados.json).
 * Lo que ya esté confirmado NO se pisa con algo automático: las decisiones
 * tomadas a mano mandan.
 */
export function importarConfirmados(db, datos) {
  const mapeos = Array.isArray(datos?.mapeos) ? datos.mapeos : [];
  const sinDeposito = Array.isArray(datos?.sin_deposito) ? datos.sin_deposito : [];
  const resultado = { asignados: 0, sinDeposito: 0, respetados: 0, errores: [] };

  const aplicar = (m, codigo, nombre) => {
    const previo = depositoDe(db, m.servicio_id);
    if (previo?.origen === "confirmado" && previo.codigo !== codigo) {
      resultado.respetados += 1;
      return null;
    }
    return asignar(db, {
      servicioId: m.servicio_id,
      codigoDeposito: codigo,
      nombreDeposito: nombre,
      origen: "confirmado",
      motivo: m.motivo ?? null,
    });
  };

  const tx = db.transaction(() => {
    for (const m of mapeos) {
      const r = aplicar(m, m.codigo_deposito, m.deposito);
      if (r === null) continue;
      if (!r.ok) resultado.errores.push(`Servicio ${m.servicio_id}: ${r.error}`);
      else resultado.asignados += 1;
    }
    for (const m of sinDeposito) {
      const r = aplicar(m, null, null);
      if (r === null) continue;
      if (!r.ok) resultado.errores.push(`Servicio ${m.servicio_id}: ${r.error}`);
      else resultado.sinDeposito += 1;
    }
  });
  tx();
  return resultado;
}

/**
 * Servicios de Kazaro que todavía no tienen mapeo (ni siquiera uno que diga
 * "no existe en Flexxus"). Ordenados por cuánto piden: lo que más se mueve,
 * primero.
 */
export function listarSinMapear(db, { soloConPedidos = false, limite = 500 } = {}) {
  return db.prepare(`
    SELECT s.ServiciosID AS servicioId, s.ServicioNombre AS servicio,
           (SELECT COUNT(*) FROM Pedidos p
             WHERE p.ServicioID = s.ServiciosID AND p.deleted_at IS NULL) AS pedidos
    FROM Servicios s
    WHERE s.empresa_id = 1
      AND s.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM flexxus_depositos d WHERE d.servicio_id = s.ServiciosID)
    ${soloConPedidos ? "AND pedidos > 0" : ""}
    ORDER BY pedidos DESC, s.ServicioNombre
    LIMIT ?`).all(limite);
}

/** Los tres estados en que puede estar un servicio frente a Flexxus. */
export const ESTADOS_MAPEO = ["mapeado", "sin_deposito", "sin_mapear"];

/**
 * El mapeo completo para la pantalla: todos los servicios de Kazaro con su
 * depósito, si lo tienen. Trae también los que no se miraron nunca, porque son
 * justamente los que hay que resolver.
 *
 * `estado` filtra: mapeado (tiene depósito), sin_deposito (se miró y no existe
 * en Flexxus) o sin_mapear (nadie lo tocó todavía).
 */
export function listarMapeo(db, { busqueda = "", estado = null, soloConPedidos = false,
                                  limite = 1000 } = {}) {
  const texto = String(busqueda || "").trim().toUpperCase();
  const filtros = [];
  const params = [];

  if (texto) {
    filtros.push(`(UPPER(s.ServicioNombre) LIKE ? OR UPPER(COALESCE(d.nombre_deposito,'')) LIKE ?
                   OR COALESCE(d.codigo_deposito,'') LIKE ?)`);
    params.push(`%${texto}%`, `%${texto}%`, `%${texto}%`);
  }
  if (estado === "mapeado") filtros.push(`d.codigo_deposito IS NOT NULL`);
  else if (estado === "sin_deposito") filtros.push(`d.servicio_id IS NOT NULL AND d.codigo_deposito IS NULL`);
  else if (estado === "sin_mapear") filtros.push(`d.servicio_id IS NULL`);

  // El filtro por pedidos va en el WHERE con la subconsulta repetida, no en un
  // HAVING: sin GROUP BY, SQLite rechaza el HAVING.
  if (soloConPedidos) {
    filtros.push(`(SELECT COUNT(*) FROM Pedidos p
                    WHERE p.ServicioID = s.ServiciosID AND p.deleted_at IS NULL) > 0`);
  }
  const where = filtros.length ? `AND ${filtros.join(" AND ")}` : "";

  const filas = db.prepare(`
    SELECT s.ServiciosID AS servicioId, s.ServicioNombre AS servicio,
           s.zona, s.grupo,
           d.codigo_deposito AS codigo, d.nombre_deposito AS deposito,
           d.origen, d.motivo, d.actualizado_at AS actualizadoAt,
           (SELECT COUNT(*) FROM Pedidos p
             WHERE p.ServicioID = s.ServiciosID AND p.deleted_at IS NULL) AS pedidos
    FROM Servicios s
    LEFT JOIN flexxus_depositos d ON d.servicio_id = s.ServiciosID
    WHERE s.empresa_id = 1 AND s.deleted_at IS NULL ${where}
    ORDER BY pedidos DESC, s.ServicioNombre
    LIMIT ?`).all(...params, limite);

  return filas.map((f) => ({
    ...f,
    estado: f.codigo ? "mapeado" : (f.origen ? "sin_deposito" : "sin_mapear"),
  }));
}

/**
 * Cuántos servicios están mapeados, cuántos sin depósito y cuántos sin mirar.
 * `sinMapear` cruza con la tabla Servicios; si por lo que sea no se puede leer,
 * vuelve en null en vez de romper: esto alimenta una pantalla, no una decisión.
 */
export function resumen(db) {
  const m = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN codigo_deposito IS NOT NULL THEN 1 ELSE 0 END) AS conDeposito,
      SUM(CASE WHEN codigo_deposito IS NULL THEN 1 ELSE 0 END) AS sinDeposito,
      SUM(CASE WHEN origen = 'confirmado' THEN 1 ELSE 0 END) AS confirmados
    FROM flexxus_depositos`).get();
  return {
    total: m.total ?? 0,
    conDeposito: m.conDeposito ?? 0,
    sinDeposito: m.sinDeposito ?? 0,
    confirmados: m.confirmados ?? 0,
    sinMapear: contarSinMapear(db),
  };
}

function contarSinMapear(db) {
  try {
    return listarSinMapear(db, { limite: 100000 }).length;
  } catch (e) {
    console.warn("[flexxus] no se pudo contar los servicios sin mapear:", e?.message || e);
    return null;
  }
}

/** Los servicios que comparten un mismo depósito. Es válido, pero se muestra. */
export function compartidos(db) {
  return db.prepare(`
    SELECT codigo_deposito AS codigo, COUNT(*) AS cuantos,
           GROUP_CONCAT(servicio_id) AS servicios
    FROM flexxus_depositos
    WHERE codigo_deposito IS NOT NULL
    GROUP BY codigo_deposito HAVING COUNT(*) > 1
    ORDER BY cuantos DESC`).all();
}
