// El despachador: toma lo que hay en cola y lo manda. Con un cliente falso,
// base en memoria y sin red.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { asignar } from "../src/integrations/flexxusDepositos.js";
import { ensureTablas, encolar, resumen, porPedido } from "../src/integrations/flexxusOutbox.js";
import { despacharPendientes, numeroDeMovimiento, sabemosQueNoEntro, probarConexion }
  from "../src/integrations/flexxusDespachador.js";

const CALLADO = { log() {}, warn() {} };
const ITEMS = [{ codigo: "004", cantidad: 400, nombre: "BOLSA NEGRA" }];
const DESPACHO = {
  tipo: "salida", pedidoId: 1053, servicioId: 412,
  fecha: "2026-09-18 19:05:20", usuario: "GGONZALEZ", items: ITEMS,
};

function base() {
  const db = new Database(":memory:");
  ensureTablas(db);
  asignar(db, { servicioId: 412, codigoDeposito: "722", origen: "confirmado" });
  return db;
}

/** Cliente falso: se le dice qué hacer y anota lo que recibió. */
function clienteFalso(responder = async () => ({ numerocomprobante: "0001-00037590" })) {
  const envios = [];
  const hacer = (tipo) => async (cuerpo) => {
    envios.push({ tipo, cuerpo });
    return responder(cuerpo, tipo, envios.length);
  };
  return { envios, remitoDeSalida: hacer("salida"), remitoDeEntrada: hacer("entrada") };
}

const errorHttp = (status, mensaje) => Object.assign(new Error(mensaje), { status });

test("manda lo que está en cola y guarda el número que devuelve Flexxus", async () => {
  const db = base();
  encolar(db, DESPACHO);
  const c = clienteFalso();
  const r = await despacharPendientes(db, c, { log: CALLADO });

  assert.deepEqual([r.tomados, r.enviados, r.fallidos], [1, 1, 0]);
  assert.equal(c.envios.length, 1);
  assert.equal(c.envios[0].tipo, "salida");
  assert.equal(c.envios[0].cuerpo.comentarios, "OP-0001053");

  const [h] = porPedido(db, 1053);
  assert.equal(h.estado, "enviado");
  assert.equal(h.numeroMovimiento, "0001-00037590");
});

test("una devolución va por el endpoint de entrada", async () => {
  const db = base();
  encolar(db, { ...DESPACHO, tipo: "entrada" });
  const c = clienteFalso();
  await despacharPendientes(db, c, { log: CALLADO });
  assert.equal(c.envios[0].tipo, "entrada");
});

test("lo ya enviado no se vuelve a mandar", async () => {
  const db = base();
  encolar(db, DESPACHO);
  const c = clienteFalso();
  await despacharPendientes(db, c, { log: CALLADO });
  const segunda = await despacharPendientes(db, c, { log: CALLADO });
  assert.equal(segunda.tomados, 0);
  assert.equal(c.envios.length, 1, "una sola vez, pase lo que pase");
});

test("un rechazo del servidor queda en error, y se sabe que NO entró", async () => {
  const db = base();
  encolar(db, DESPACHO);
  const c = clienteFalso(async () => { throw errorHttp(400, "codigodeposito inexistente"); });
  const r = await despacharPendientes(db, c, { log: CALLADO });

  assert.deepEqual([r.enviados, r.fallidos, r.dudosos], [0, 1, 0]);
  const [h] = porPedido(db, 1053);
  assert.equal(h.estado, "error");
  assert.match(h.ultimoError, /codigodeposito inexistente/);
  assert.doesNotMatch(h.ultimoError, /REVISAR EN FLEXXUS/, "un 400 no es dudoso");
});

test("si se corta la conexión, se avisa que hay que revisar antes de reintentar", async () => {
  const db = base();
  encolar(db, DESPACHO);
  // Sin status: no hubo respuesta, puede haber entrado igual.
  const c = clienteFalso(async () => { throw new Error("socket hang up"); });
  const r = await despacharPendientes(db, c, { log: CALLADO });

  assert.equal(r.dudosos, 1);
  const [h] = porPedido(db, 1053);
  assert.equal(h.estado, "error");
  assert.match(h.ultimoError, /REVISAR EN FLEXXUS/);
  assert.match(h.ultimoError, /queda duplicado/);
});

test("lo dudoso NO se reintenta solo en la pasada siguiente", async () => {
  const db = base();
  encolar(db, DESPACHO);
  const c = clienteFalso(async () => { throw new Error("timeout"); });
  await despacharPendientes(db, c, { log: CALLADO });
  const segunda = await despacharPendientes(db, c, { log: CALLADO });
  assert.equal(segunda.tomados, 0, "queda esperando que lo mire una persona");
  assert.equal(c.envios.length, 1);
});

test("un fallo no frena a los demás", async () => {
  const db = base();
  asignar(db, { servicioId: 500, codigoDeposito: "999", origen: "manual" });
  encolar(db, DESPACHO);
  encolar(db, { ...DESPACHO, pedidoId: 1054, servicioId: 500 });
  encolar(db, { ...DESPACHO, pedidoId: 1055 });

  const c = clienteFalso(async (cuerpo) => {
    if (cuerpo.comentarios === "OP-0001054") throw errorHttp(400, "mal");
    return { numerocomprobante: "OK-" + cuerpo.comentarios };
  });
  const r = await despacharPendientes(db, c, { log: CALLADO });

  assert.deepEqual([r.tomados, r.enviados, r.fallidos], [3, 2, 1]);
  assert.equal(resumen(db).enviado, 2);
  assert.equal(resumen(db).error, 1);
});

test("respeta el límite de cuántos manda por pasada", async () => {
  const db = base();
  for (let i = 0; i < 5; i += 1) encolar(db, { ...DESPACHO, pedidoId: 2000 + i });
  const c = clienteFalso();
  const r = await despacharPendientes(db, c, { limite: 2, log: CALLADO });
  assert.equal(r.enviados, 2);
  assert.equal(resumen(db).pendiente, 3);
});

test("lo que quedó en sin_mapeo no se manda", async () => {
  const db = base();
  encolar(db, { ...DESPACHO, servicioId: 777 });   // sin depósito
  const c = clienteFalso();
  const r = await despacharPendientes(db, c, { log: CALLADO });
  assert.equal(r.tomados, 0);
  assert.equal(c.envios.length, 0);
});

test("si Flexxus no devuelve número, igual queda como enviado", async () => {
  const db = base();
  encolar(db, DESPACHO);
  const c = clienteFalso(async () => ({ mensaje: "ok" }));
  const r = await despacharPendientes(db, c, { log: CALLADO });
  assert.equal(r.enviados, 1);
  const [h] = porPedido(db, 1053);
  assert.equal(h.estado, "enviado");
  assert.equal(h.numeroMovimiento, null);
});

test("encuentra el número de comprobante se llame como se llame", () => {
  assert.equal(numeroDeMovimiento({ numerocomprobante: "0001-1" }), "0001-1");
  assert.equal(numeroDeMovimiento({ numeroComprobante: "0001-2" }), "0001-2");
  assert.equal(numeroDeMovimiento({ data: { numero: "0001-3" } }), "0001-3");
  assert.equal(numeroDeMovimiento({ otra: "cosa" }), null);
  assert.equal(numeroDeMovimiento(null), null);
  assert.equal(numeroDeMovimiento({ numerocomprobante: "  " }), null);
});

test("sabemosQueNoEntro distingue respuesta del servidor de corte de red", () => {
  assert.equal(sabemosQueNoEntro({ status: 400 }), true);
  assert.equal(sabemosQueNoEntro({ status: 403 }), true);
  assert.equal(sabemosQueNoEntro({ status: 500 }), false, "el servidor pudo haberlo grabado antes de romperse");
  assert.equal(sabemosQueNoEntro({}), false);
  assert.equal(sabemosQueNoEntro(new Error("timeout")), false);
});

test("la prueba de conexión informa paso por paso sin escribir nada", async () => {
  const cliente = {
    login: async () => ({ token: "T1" }),
    depositos: async () => ({ data: [{ codigo: "001" }, { codigo: "722" }] }),
    stockPorDeposito: async () => ({ data: [{ codigoarticulo: "004" }] }),
  };
  const r = await probarConexion(cliente);
  assert.equal(r.ok, true);
  assert.deepEqual(r.pasos.map((p) => p.paso), ["login", "leer depósitos", "leer stock por depósito"]);
  assert.match(r.pasos[1].detalle, /2 depósitos/);
});

test("la prueba de conexión no se corta en el primer error: los informa todos", async () => {
  const cliente = {
    login: async () => ({ token: "T1" }),
    depositos: async () => { throw Object.assign(new Error("sin permiso"), { status: 403 }); },
    stockPorDeposito: async () => ({ data: [] }),
  };
  const r = await probarConexion(cliente);
  assert.equal(r.ok, false);
  assert.equal(r.pasos[0].ok, true);
  assert.equal(r.pasos[1].ok, false);
  assert.equal(r.pasos[1].status, 403);
  assert.equal(r.pasos[2].ok, true, "sigue probando aunque uno falle");
});
