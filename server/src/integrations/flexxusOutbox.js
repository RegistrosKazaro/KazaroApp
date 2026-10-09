// flexxusOutbox.js — La cola de movimientos que van a Flexxus.
//
// Regla de oro: NADA se envía dentro de la petición del depósito. Cuando se
// marca un pedido como listo para retirar, acá se deja una fila y se responde
// al instante. Si Flexxus está caído, el remito sale igual y el movimiento
// queda esperando. Lo que hoy se carga a mano no puede empeorar porque un
// servidor ajeno no conteste.
//
// Estados:
//   pendiente  listo para enviar
//   enviando   alguien lo tomó (evita que dos procesos manden lo mismo)
//   enviado    Flexxus lo aceptó; queda guardado el número de movimiento
//   error      falló; se puede reintentar
//   sin_mapeo  el servicio no tiene depósito en Flexxus todavía
//
// La defensa contra el movimiento duplicado son dos: el external_id lo genera
// la app ANTES de enviar, y la columna es UNIQUE.

import { construirRemito } from "./flexxusRemito.js";
import { ensureTablas as ensureDepositos, depositoDe, DEPOSITO_CENTRAL } from "./flexxusDepositos.js";

export const ESTADOS = ["pendiente", "enviando", "enviado", "error", "sin_mapeo"];

const ahora = () => new Date().toISOString().slice(0, 19).replace("T", " ");

/**
 * Crea las dos tablas (ésta y la del mapeo). Se llama al arrancar, así que si
 * algo fallara NO puede tirar el servidor: se avisa y la app sigue andando sin
 * la cola, igual que antes de que existiera. Devuelve si quedó lista.
 */
export function ensureTablas(db) {
  try {
    crearTablas(db);
    return true;
  } catch (e) {
    console.error("[flexxus] no se pudieron crear las tablas de la cola:", e?.message || e);
    return false;
  }
}

function crearTablas(db) {
  ensureDepositos(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS flexxus_outbox (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id    TEXT NOT NULL UNIQUE,
      pedido_id      INTEGER NOT NULL,
      servicio_id    INTEGER,
      tipo           TEXT NOT NULL,
      estado         TEXT NOT NULL,
      cuerpo         TEXT,
      intentos       INTEGER NOT NULL DEFAULT 0,
      ultimo_error   TEXT,
      numero_mov     TEXT,
      creado_at      TEXT NOT NULL,
      actualizado_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_fout_estado ON flexxus_outbox(estado);
    CREATE INDEX IF NOT EXISTS idx_fout_pedido ON flexxus_outbox(pedido_id);
  `);
}

/**
 * Deja un movimiento listo para enviar. No envía nada.
 *
 * @returns {{ ok, id, estado, externalId, errores, duplicado }}
 *   ok=false con estado 'sin_mapeo' o 'error' igual deja la fila: el problema
 *   tiene que verse, no desaparecer.
 */
export function encolar(db, { tipo = "salida", pedidoId, servicioId, fecha, usuario,
                              items = [], comentario = null, intento = 1 } = {}) {
  const dep = depositoDe(db, servicioId);

  // El servicio todavía no se miró, o se miró y no existe en Flexxus.
  if (!dep || !dep.codigo) {
    const motivo = dep
      ? `El servicio ${servicioId} no existe en Flexxus${dep.motivo ? `: ${dep.motivo}` : "."}`
      : `El servicio ${servicioId} todavía no tiene depósito de Flexxus asignado.`;
    const fila = construirRemito({ tipo, pedidoId, fecha, depositoCentral: DEPOSITO_CENTRAL,
      depositoServicio: "", usuario, items, comentario, intento });
    return guardar(db, {
      externalId: fila.externalId, pedidoId, servicioId, tipo,
      estado: "sin_mapeo", cuerpo: null, error: motivo,
    });
  }

  const armado = construirRemito({
    tipo, pedidoId, fecha, usuario, items, comentario, intento,
    depositoCentral: DEPOSITO_CENTRAL,
    depositoServicio: dep.codigo,
  });

  return guardar(db, {
    externalId: armado.externalId, pedidoId, servicioId, tipo,
    estado: armado.ok ? "pendiente" : "error",
    cuerpo: armado.ok ? JSON.stringify(armado.body) : null,
    error: armado.ok ? null : armado.errores.join(" "),
    errores: armado.errores,
  });
}

function guardar(db, { externalId, pedidoId, servicioId, tipo, estado, cuerpo, error, errores = [] }) {
  const ya = db.prepare(`SELECT id, estado FROM flexxus_outbox WHERE external_id = ?`).get(externalId);
  if (ya) {
    // No se pisa: si ya se envió, mandarlo otra vez sería duplicar el movimiento.
    return { ok: false, duplicado: true, id: ya.id, estado: ya.estado, externalId,
             errores: [`Ya existe un movimiento con el identificador ${externalId} (estado: ${ya.estado}).`] };
  }
  const t = ahora();
  const info = db.prepare(`
    INSERT INTO flexxus_outbox (external_id, pedido_id, servicio_id, tipo, estado, cuerpo,
                                ultimo_error, creado_at, actualizado_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(externalId, Number(pedidoId) || 0, servicioId ?? null, tipo, estado, cuerpo, error ?? null, t, t);
  return {
    ok: estado === "pendiente",
    duplicado: false,
    id: Number(info.lastInsertRowid),
    estado,
    externalId,
    errores: estado === "pendiente" ? [] : (errores.length ? errores : [error]),
  };
}

/** Los que están listos para enviar, del más viejo al más nuevo. */
export function pendientes(db, limite = 50) {
  return db.prepare(`
    SELECT id, external_id AS externalId, pedido_id AS pedidoId, servicio_id AS servicioId,
           tipo, cuerpo, intentos
    FROM flexxus_outbox WHERE estado = 'pendiente'
    ORDER BY id LIMIT ?`).all(limite).map((r) => ({ ...r, body: r.cuerpo ? JSON.parse(r.cuerpo) : null }));
}

/**
 * Marca una fila como "la estoy enviando". Devuelve false si otro ya la tomó,
 * así dos procesos no mandan el mismo movimiento.
 */
export function tomar(db, id) {
  const info = db.prepare(`
    UPDATE flexxus_outbox
    SET estado = 'enviando', intentos = intentos + 1, actualizado_at = ?
    WHERE id = ? AND estado = 'pendiente'`).run(ahora(), Number(id));
  return info.changes === 1;
}

/** Flexxus lo aceptó. Guarda el número de movimiento que devolvió. */
export function marcarEnviado(db, id, numeroMovimiento = null) {
  db.prepare(`
    UPDATE flexxus_outbox
    SET estado = 'enviado', numero_mov = ?, ultimo_error = NULL, actualizado_at = ?
    WHERE id = ?`).run(numeroMovimiento ? String(numeroMovimiento) : null, ahora(), Number(id));
  return true;
}

/** Falló. Queda en 'error' con el motivo, para verlo y reintentar. */
export function marcarError(db, id, mensaje) {
  db.prepare(`
    UPDATE flexxus_outbox SET estado = 'error', ultimo_error = ?, actualizado_at = ?
    WHERE id = ?`).run(String(mensaje ?? "").slice(0, 500), ahora(), Number(id));
  return true;
}

/**
 * Vuelve a poner en cola algo que falló o que quedó colgado en 'enviando'.
 * Lo ya enviado NO se reintenta: sería duplicar el movimiento.
 */
export function reintentar(db, id) {
  const info = db.prepare(`
    UPDATE flexxus_outbox SET estado = 'pendiente', actualizado_at = ?
    WHERE id = ? AND estado IN ('error', 'enviando')`).run(ahora(), Number(id));
  return info.changes === 1;
}

/**
 * Después de asignarle el depósito a un servicio, sus movimientos que habían
 * quedado en 'sin_mapeo' se vuelven a armar con el depósito nuevo.
 */
export function reencolarSinMapeo(db, servicioId, { usuario, items, fecha } = {}) {
  const filas = db.prepare(`
    SELECT id, external_id AS externalId, pedido_id AS pedidoId, tipo
    FROM flexxus_outbox WHERE estado = 'sin_mapeo' AND servicio_id = ?`).all(Number(servicioId));
  const dep = depositoDe(db, servicioId);
  if (!dep?.codigo) return { reencolados: 0, motivo: "El servicio sigue sin depósito." };

  let n = 0;
  for (const f of filas) {
    const armado = construirRemito({
      tipo: f.tipo, pedidoId: f.pedidoId, fecha, usuario, items,
      depositoCentral: DEPOSITO_CENTRAL, depositoServicio: dep.codigo,
    });
    if (!armado.ok) continue;
    db.prepare(`
      UPDATE flexxus_outbox SET estado = 'pendiente', cuerpo = ?, ultimo_error = NULL, actualizado_at = ?
      WHERE id = ?`).run(JSON.stringify(armado.body), ahora(), f.id);
    n += 1;
  }
  return { reencolados: n };
}

/** Cuántos hay en cada estado. Para la pantalla del panel. */
export function resumen(db) {
  const filas = db.prepare(`SELECT estado, COUNT(*) AS n FROM flexxus_outbox GROUP BY estado`).all();
  const out = Object.fromEntries(ESTADOS.map((e) => [e, 0]));
  for (const f of filas) out[f.estado] = f.n;
  out.total = filas.reduce((a, f) => a + f.n, 0);
  return out;
}

/** El historial de un pedido: qué movimientos generó y cómo terminaron. */
export function porPedido(db, pedidoId) {
  return db.prepare(`
    SELECT id, external_id AS externalId, tipo, estado, intentos, ultimo_error AS ultimoError,
           numero_mov AS numeroMovimiento, creado_at AS creadoAt
    FROM flexxus_outbox WHERE pedido_id = ? ORDER BY id`).all(Number(pedidoId));
}
