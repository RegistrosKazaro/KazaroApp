// Tests de la cola de movimientos. Base SQLite en memoria: se prueba el SQL
// real, incluido el UNIQUE que impide mandar dos veces el mismo movimiento.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { asignar } from "../src/integrations/flexxusDepositos.js";
import {
  ensureTablas, encolar, pendientes, tomar, marcarEnviado, marcarError,
  reintentar, reencolarSinMapeo, resumen, porPedido,
} from "../src/integrations/flexxusOutbox.js";

const ITEMS = [
  { codigo: "004", cantidad: 400, nombre: "BOLSA NEGRA 80*100*35" },
  { codigo: "100000292", cantidad: 3, nombre: "ALCOHOL AL 70% X 5 LTS" },
];
const DESPACHO = {
  tipo: "salida", pedidoId: 1053, servicioId: 412,
  fecha: "2026-09-18 19:05:20", usuario: "GGONZALEZ", items: ITEMS,
};

function baseNueva({ conDeposito = true } = {}) {
  const db = new Database(":memory:");
  ensureTablas(db);
  if (conDeposito) {
    asignar(db, { servicioId: 412, codigoDeposito: "412",
      nombreDeposito: "MIN. EDUC - ZONA SANTA MARIA", origen: "confirmado" });
  }
  return db;
}

test("encola un despacho y queda listo para enviar", () => {
  const db = baseNueva();
  const r = encolar(db, DESPACHO);
  assert.equal(r.ok, true);
  assert.equal(r.estado, "pendiente");
  assert.equal(r.externalId, "OUT-0001053-1");

  const [fila] = pendientes(db);
  assert.equal(fila.pedidoId, 1053);
  assert.equal(fila.body.codigodepositoorigen, "001");
  assert.equal(fila.body.codigodepositodestino, "412");
  assert.equal(fila.body.comentarios, "OP-0001053");
  assert.equal(fila.body.productos.length, 2);
});

test("la devolución se encola invertida", () => {
  const db = baseNueva();
  const r = encolar(db, { ...DESPACHO, tipo: "entrada" });
  assert.equal(r.estado, "pendiente");
  assert.equal(r.externalId, "IN-0001053-1");
  const [fila] = pendientes(db);
  assert.equal(fila.body.codigodepositoorigen, "412");
  assert.equal(fila.body.codigodepositodestino, "001");
});

test("un servicio sin depósito queda en sin_mapeo, no se pierde", () => {
  const db = baseNueva({ conDeposito: false });
  const r = encolar(db, DESPACHO);
  assert.equal(r.ok, false);
  assert.equal(r.estado, "sin_mapeo");
  assert.match(r.errores.join(" "), /todavía no tiene depósito/);
  assert.equal(resumen(db).sin_mapeo, 1);
});

test("un servicio que NO existe en Flexxus también queda asentado", () => {
  const db = baseNueva({ conDeposito: false });
  asignar(db, { servicioId: 412, codigoDeposito: null, motivo: "No existe en Flexxus." });
  const r = encolar(db, DESPACHO);
  assert.equal(r.estado, "sin_mapeo");
  assert.match(r.errores.join(" "), /No existe en Flexxus/);
});

test("no se encola dos veces el mismo movimiento", () => {
  const db = baseNueva();
  const primero = encolar(db, DESPACHO);
  const segundo = encolar(db, DESPACHO);
  assert.equal(primero.ok, true);
  assert.equal(segundo.ok, false);
  assert.equal(segundo.duplicado, true);
  assert.equal(segundo.id, primero.id);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM flexxus_outbox`).get().n, 1);
});

test("un remito mal armado queda en error, con el motivo", () => {
  const db = baseNueva();
  const r = encolar(db, { ...DESPACHO, fecha: "ayer" });
  assert.equal(r.ok, false);
  assert.equal(r.estado, "error");
  assert.match(r.errores.join(" "), /Fecha inválida/);
  assert.equal(pendientes(db).length, 0);
});

test("tomar() lo reserva y sólo funciona una vez", () => {
  const db = baseNueva();
  const { id } = encolar(db, DESPACHO);
  assert.equal(tomar(db, id), true);
  assert.equal(tomar(db, id), false);   // otro proceso no se lo lleva
  assert.equal(pendientes(db).length, 0);
  assert.equal(db.prepare(`SELECT intentos FROM flexxus_outbox WHERE id = ?`).get(id).intentos, 1);
});

test("marcarEnviado guarda el número de movimiento de Flexxus", () => {
  const db = baseNueva();
  const { id } = encolar(db, DESPACHO);
  tomar(db, id);
  marcarEnviado(db, id, "0001-00037590");
  const [h] = porPedido(db, 1053);
  assert.equal(h.estado, "enviado");
  assert.equal(h.numeroMovimiento, "0001-00037590");
  assert.equal(h.ultimoError, null);
});

test("un error se puede reintentar; lo enviado no", () => {
  const db = baseNueva();
  const a = encolar(db, DESPACHO);
  tomar(db, a.id);
  marcarError(db, a.id, "Flexxus no responde");
  assert.equal(reintentar(db, a.id), true);
  assert.equal(pendientes(db).length, 1);

  tomar(db, a.id);
  marcarEnviado(db, a.id, "0001-00037590");
  assert.equal(reintentar(db, a.id), false);   // no se duplica un movimiento ya hecho
});

test("lo que quedó colgado en 'enviando' se puede destrabar", () => {
  const db = baseNueva();
  const { id } = encolar(db, DESPACHO);
  tomar(db, id);                                // se cortó la luz acá
  assert.equal(reintentar(db, id), true);
  assert.equal(pendientes(db).length, 1);
});

test("al asignarle el depósito, lo que estaba en sin_mapeo se reencola", () => {
  const db = baseNueva({ conDeposito: false });
  encolar(db, DESPACHO);
  assert.equal(resumen(db).sin_mapeo, 1);

  asignar(db, { servicioId: 412, codigoDeposito: "412", origen: "manual" });
  const r = reencolarSinMapeo(db, 412, {
    usuario: "GGONZALEZ", items: ITEMS, fecha: "2026-09-18 19:05:20",
  });
  assert.equal(r.reencolados, 1);
  assert.equal(resumen(db).sin_mapeo, 0);
  const [fila] = pendientes(db);
  assert.equal(fila.body.codigodepositodestino, "412");
});

test("reencolar sin depósito asignado no hace nada", () => {
  const db = baseNueva({ conDeposito: false });
  encolar(db, DESPACHO);
  const r = reencolarSinMapeo(db, 412, { usuario: "X", items: ITEMS, fecha: "2026-09-18 19:05:20" });
  assert.equal(r.reencolados, 0);
  assert.match(r.motivo, /sigue sin depósito/);
});

test("el resumen cuenta por estado", () => {
  const db = baseNueva();
  encolar(db, DESPACHO);
  encolar(db, { ...DESPACHO, tipo: "entrada" });
  encolar(db, { ...DESPACHO, pedidoId: 1054, fecha: "ayer" });
  const r = resumen(db);
  assert.equal(r.pendiente, 2);
  assert.equal(r.error, 1);
  assert.equal(r.total, 3);
});

test("el historial de un pedido trae salida y devolución", () => {
  const db = baseNueva();
  encolar(db, DESPACHO);
  encolar(db, { ...DESPACHO, tipo: "entrada" });
  const h = porPedido(db, 1053);
  assert.equal(h.length, 2);
  assert.deepEqual(h.map((x) => x.tipo), ["salida", "entrada"]);
});

test("ensureTablas devuelve true cuando las crea", () => {
  const db = new Database(":memory:");
  assert.equal(ensureTablas(db), true);
});

test("si no se pueden crear las tablas, avisa pero NO tira el servidor", () => {
  // db.js llama a esto al arrancar: una excepción acá dejaría la app sin levantar.
  const roto = { exec() { throw new Error("disco lleno"); }, prepare() { throw new Error("disco lleno"); } };
  let ok;
  assert.doesNotThrow(() => { ok = ensureTablas(roto); });
  assert.equal(ok, false);
});
