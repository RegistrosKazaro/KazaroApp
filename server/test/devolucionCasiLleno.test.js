// Devoluciones de líquidos: la pregunta es CUÁNTO QUEDA, no si se abrió.
//
// El agujero que esto cierra: un bidón de 5 litros al que le falta uno está
// abierto, pero prácticamente entero. Con la pregunta vieja ("¿sin abrir o
// abierto?") el depósito marcaba "abierto" y al servicio se le cobraban los 5
// litros enteros. Por eso las devoluciones de líquidos estaban trabadas.
//
// Desde el 15/10/2026 hay tres estados, y la raya la puso el usuario en 3/4:
//
//   sin_abrir   → vuelve al stock y se le descuenta el consumo
//   casi_lleno  → vuelve al stock y se le descuenta el consumo (más de 3/4)
//   usado       → vuelve al stock pero se le cobra igual (media carga)
//
// No se fraccionan los envases: media carga se paga entera. Es la decisión del
// usuario, porque llevar fracciones de bidón en el stock era peor que esto.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = path.join(os.tmpdir(), `kz_casilleno_${Date.now()}.db`);
const origen = path.resolve(import.meta.dirname, "../Kazaro.db");
let db = null;
let router = null;

before(async () => {
  if (!fs.existsSync(origen)) return;
  fs.copyFileSync(origen, tmp);
  process.env.DB_PATH = tmp;
  router = (await import("../src/routes/deposito.js")).default;
  ({ db } = await import("../src/db.js"));
});

after(() => {
  for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + ext); } catch {} }
});

const sinBase = () => !db;
let seq = 0;
const unico = () => `${Date.now()}${(seq += 1).toString().padStart(3, "0")}`;

/** Un bidón de 5 litros, de los que se le pregunta el estado. */
function bidonEntregado({ cantidad = 10, precio = 1000, preguntaEstado = 1 } = {}) {
  const productoId = Number(db.prepare(
    `INSERT INTO Productos (ProductName, Precio, Stock, empresa_id, is_active, Code, pregunta_estado)
     VALUES ('BIDON PRUEBA X 5 LTS', ?, 100, 1, 1, ?, ?)`
  ).run(precio, `BD-${unico()}`, preguntaEstado).lastInsertRowid);

  // Retirado: si no, la devolución se rechaza.
  const pedidoId = Number(db.prepare(
    `INSERT INTO Pedidos (EmpleadoID, Rol, Total, empresa_id, Status, closedat, retiro_at)
     VALUES (1, 'supervisor', ?, 1, 'closed', datetime('now'), datetime('now'))`
  ).run(precio * cantidad).lastInsertRowid);

  db.prepare(
    `INSERT INTO PedidoItems (PedidoID, ProductoID, Nombre, Cantidad, Precio, Subtotal, cantidad_pendiente)
     VALUES (?, ?, 'BIDON PRUEBA X 5 LTS', ?, ?, ?, 0)`
  ).run(pedidoId, productoId, cantidad, precio, precio * cantidad);

  return { pedidoId, productoId, precio, cantidad };
}

function handler(metodo, ruta) {
  const capa = router.stack.find((l) => l.route?.path === ruta && l.route.methods[metodo]);
  return capa.route.stack.at(-1).handle;
}

const devolver = (pedidoId, productoId, cantidad, estado) =>
  new Promise((resolve) => {
    const req = {
      params: {}, query: {},
      body: { pedidoId, items: [{ productoId: String(productoId), cantidad, estado }],
              motivo: "prueba" },
      user: { id: 1, empresaId: 1, roles: ["deposito"], username: "test" },
    };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(d) { resolve({ status: this.statusCode, body: d }); },
    };
    Promise.resolve(handler("post", "/devoluciones")(req, res))
      .catch((e) => resolve({ status: 500, body: { error: e.message } }));
  });

const tipoGuardado = (pedidoId) =>
  db.prepare(`SELECT tipo FROM devoluciones WHERE pedido_id = ?`).get(pedidoId)?.tipo;

const stockDe = (productoId) =>
  db.prepare(`SELECT Stock s FROM Productos WHERE ProductID = ?`).get(productoId).s;

const remanenteDe = (productoId) =>
  db.prepare(`SELECT COALESCE(stock_remanente,0) r FROM Productos WHERE ProductID = ?`).get(productoId).r;

/** Saca unidades del remanente: al stock o al tacho de basura. */
const moverRemanente = (productoId, body) =>
  new Promise((resolve) => {
    const req = { params: { productoId: String(productoId) }, query: {}, body,
                  user: { id: 1, empresaId: 1, roles: ["deposito"], username: "test" } };
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; },
                  json(d) { resolve({ status: this.statusCode, body: d }); } };
    Promise.resolve(handler("put", "/remanentes/:productoId")(req, res))
      .catch((e) => resolve({ status: 500, body: { error: e.message } }));
  });

const listarRemanentes = () =>
  new Promise((resolve) => {
    const req = { params: {}, query: {}, body: {},
                  user: { id: 1, empresaId: 1, roles: ["deposito"], username: "test" } };
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; },
                  json(d) { resolve({ status: this.statusCode, body: d }); } };
    Promise.resolve(handler("get", "/remanentes")(req, res))
      .catch((e) => resolve({ status: 500, body: { error: e.message } }));
  });

const neto = (pedidoId) =>
  db.prepare(`SELECT * FROM v_pedido_items_neto WHERE PedidoID = ?`).get(pedidoId);

/* ===================== El caso que trababa todo ===================== */

test("el bidon casi lleno va a REMANENTES y se le descuenta el consumo", async () => {
  if (sinBase()) return;
  // 5 litros y se uso 1: casi ni se distingue. Antes se le cobraba entero.
  // Y no entra al stock general: medio abierto no es un bidon lleno.
  const { pedidoId, productoId, cantidad } = bidonEntregado({ cantidad: 10 });
  const antes = stockDe(productoId);

  const r = await devolver(pedidoId, productoId, 4, "casi_lleno");
  assert.equal(r.status, 200);
  assert.equal(tipoGuardado(pedidoId), "casi_lleno");
  assert.equal(stockDe(productoId), antes, "el stock general NO se tenia que mover");
  assert.equal(remanenteDe(productoId), 4, "tenia que entrar a remanentes");
  assert.equal(neto(pedidoId).Cantidad, cantidad - 4, "y descontarse del consumo igual");
});

test("el bidon por la mitad va a remanentes y se le cobra igual", async () => {
  if (sinBase()) return;
  const { pedidoId, productoId, cantidad } = bidonEntregado({ cantidad: 10 });
  const antes = stockDe(productoId);

  const r = await devolver(pedidoId, productoId, 4, "usado");
  assert.equal(r.status, 200);
  assert.equal(tipoGuardado(pedidoId), "usado");
  assert.equal(stockDe(productoId), antes, "el stock general NO se mueve");
  assert.equal(remanenteDe(productoId), 4);
  assert.equal(neto(pedidoId).Cantidad, cantidad, "y el consumo no baja");
});

test("sin abrir sigue yendo al stock general, como siempre", async () => {
  if (sinBase()) return;
  const { pedidoId, productoId, cantidad } = bidonEntregado({ cantidad: 10 });
  const antes = stockDe(productoId);
  await devolver(pedidoId, productoId, 3, "sin_abrir");
  assert.equal(tipoGuardado(pedidoId), "no_usado");
  assert.equal(stockDe(productoId), antes + 3, "cerrado va al stock de siempre");
  assert.equal(remanenteDe(productoId), 0);
  assert.equal(neto(pedidoId).Cantidad, cantidad - 3);
});

/* ============ Herramientas: la misma mecánica, otra pregunta ============ */

test("la herramienta que vuelve en buen estado es como si nunca hubiera salido", async () => {
  if (sinBase()) return;
  // Un embudo que sale y vuelve intacto no se consumio: ni unidades ni plata.
  const { pedidoId, productoId, cantidad } = bidonEntregado({ cantidad: 6, preguntaEstado: 2 });
  const antes = stockDe(productoId);

  const r = await devolver(pedidoId, productoId, 6, "buen_estado");
  assert.equal(r.status, 200);
  assert.equal(tipoGuardado(pedidoId), "no_usado");
  assert.equal(stockDe(productoId), antes + 6, "vuelve al stock general");
  assert.equal(remanenteDe(productoId), 0);
  assert.equal(neto(pedidoId).Cantidad, cantidad - 6, "no consumio nada");
  assert.equal(neto(pedidoId).Subtotal, 0);
});

test("la herramienta rota se le cobra al servicio y no entra al stock general", async () => {
  if (sinBase()) return;
  const { pedidoId, productoId, cantidad, precio } = bidonEntregado({ cantidad: 6, preguntaEstado: 2 });
  const antes = stockDe(productoId);

  const r = await devolver(pedidoId, productoId, 2, "roto");
  assert.equal(r.status, 200);
  assert.equal(tipoGuardado(pedidoId), "roto");
  assert.equal(stockDe(productoId), antes, "rota no vuelve al stock");
  assert.equal(remanenteDe(productoId), 2, "queda en remanentes para descartar");
  assert.equal(neto(pedidoId).Cantidad, cantidad, "se le cobra: la rompio el");
  assert.equal(neto(pedidoId).Subtotal, cantidad * precio);
});

test("a un 'va y vuelve' no se le pregunta y entra al stock general", async () => {
  if (sinBase()) return;
  // El tacho vuelve entero y se presta de nuevo: no es un remanente.
  const { pedidoId, productoId } = bidonEntregado({ cantidad: 5, preguntaEstado: 1 });
  db.prepare(`UPDATE Productos SET retornable = 1 WHERE ProductID = ?`).run(productoId);
  const antes = stockDe(productoId);

  await devolver(pedidoId, productoId, 5, "usado");
  assert.equal(tipoGuardado(pedidoId), "retornable");
  assert.equal(stockDe(productoId), antes + 5);
  assert.equal(remanenteDe(productoId), 0);
});

test("casi lleno y sin abrir caen en el mismo lado de la plata", async () => {
  if (sinBase()) return;
  const a = bidonEntregado({ cantidad: 10, precio: 1000 });
  const b = bidonEntregado({ cantidad: 10, precio: 1000 });
  await devolver(a.pedidoId, a.productoId, 4, "sin_abrir");
  await devolver(b.pedidoId, b.productoId, 4, "casi_lleno");
  assert.equal(neto(a.pedidoId).Subtotal, neto(b.pedidoId).Subtotal);
});

/* ===================== Que no se rompa lo de antes ===================== */

test("un insumo que no pregunta estado no se ve afectado", async () => {
  if (sinBase()) return;
  // Mandar "usado" para uno no marcado no tiene que cobrarle nada: la pregunta
  // no se le hace, así que lo que llegue en el cuerpo se ignora.
  const { pedidoId, productoId, cantidad } = bidonEntregado({ cantidad: 10, preguntaEstado: 0 });
  await devolver(pedidoId, productoId, 4, "usado");
  assert.equal(tipoGuardado(pedidoId), "no_usado");
  assert.equal(neto(pedidoId).Cantidad, cantidad - 4);
});

test("un estado que no existe se trata como sin abrir, no rompe", async () => {
  if (sinBase()) return;
  const { pedidoId, productoId, cantidad } = bidonEntregado({ cantidad: 10 });
  const r = await devolver(pedidoId, productoId, 2, "cualquier_cosa");
  assert.equal(r.status, 200);
  assert.equal(tipoGuardado(pedidoId), "no_usado");
  assert.equal(neto(pedidoId).Cantidad, cantidad - 2);
});

test("sin estado (pantalla vieja) tampoco rompe", async () => {
  if (sinBase()) return;
  const { pedidoId, productoId, cantidad } = bidonEntregado({ cantidad: 10 });
  const r = await devolver(pedidoId, productoId, 2, undefined);
  assert.equal(r.status, 200);
  assert.equal(tipoGuardado(pedidoId), "no_usado");
  assert.equal(neto(pedidoId).Cantidad, cantidad - 2);
});

test("la vista excluye lo que se le cobra al servicio, y solo eso", () => {
  if (sinBase()) return;
  // Si alguien toca este NOT IN, casi_lleno deja de descontar —o roto empieza
  // a descontar— sin que nadie se entere. Por eso el test mira el texto.
  const sql = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='view' AND name='v_devoluciones_aprobadas'`
  ).get().sql;
  assert.match(sql, /NOT IN \('retornable', 'usado', 'roto'\)/);
});

/* ========================= Remanentes ========================= */

test("el remanente aparece en la lista, con su plata", async () => {
  if (sinBase()) return;
  const { pedidoId, productoId, precio } = bidonEntregado({ cantidad: 10, precio: 500 });
  await devolver(pedidoId, productoId, 3, "usado");

  const r = await listarRemanentes();
  assert.equal(r.status, 200);
  const fila = r.body.rows.find((x) => String(x.productoId) === String(productoId));
  assert.ok(fila, "tenia que estar en la lista");
  assert.equal(fila.remanente, 3);
  assert.equal(fila.precio, precio);
});

test("pasarlo al stock lo saca de remanentes y lo suma al general", async () => {
  if (sinBase()) return;
  const { pedidoId, productoId } = bidonEntregado({ cantidad: 10 });
  await devolver(pedidoId, productoId, 5, "usado");
  const antes = stockDe(productoId);

  const r = await moverRemanente(productoId, { accion: "al_stock", cantidad: 3 });
  assert.equal(r.status, 200);
  assert.equal(remanenteDe(productoId), 2, "quedan los que no se pasaron");
  assert.equal(stockDe(productoId), antes + 3);
});

test("descartar lo saca de remanentes y no lo suma a ningun lado", async () => {
  if (sinBase()) return;
  const { pedidoId, productoId } = bidonEntregado({ cantidad: 10 });
  await devolver(pedidoId, productoId, 4, "roto");
  const antes = stockDe(productoId);

  const r = await moverRemanente(productoId, { accion: "descartar", cantidad: 4, motivo: "vencido" });
  assert.equal(r.status, 200);
  assert.equal(remanenteDe(productoId), 0);
  assert.equal(stockDe(productoId), antes, "descartar no suma stock");
});

test("no se puede sacar mas de lo que hay", async () => {
  if (sinBase()) return;
  const { pedidoId, productoId } = bidonEntregado({ cantidad: 10 });
  await devolver(pedidoId, productoId, 2, "usado");

  const r = await moverRemanente(productoId, { accion: "al_stock", cantidad: 5 });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Sólo hay 2/);
  assert.equal(remanenteDe(productoId), 2, "no se tenia que mover nada");
});

test("descartar sin decir por que no se puede: se pierde plata", async () => {
  if (sinBase()) return;
  const { pedidoId, productoId } = bidonEntregado({ cantidad: 10 });
  await devolver(pedidoId, productoId, 2, "usado");

  const r = await moverRemanente(productoId, { accion: "descartar", cantidad: 2, motivo: "  " });
  assert.equal(r.status, 400);
  assert.equal(remanenteDe(productoId), 2);
});

test("cantidades invalidas y acciones raras no hacen nada", async () => {
  if (sinBase()) return;
  const { pedidoId, productoId } = bidonEntregado({ cantidad: 10 });
  await devolver(pedidoId, productoId, 3, "usado");

  for (const body of [
    { accion: "al_stock", cantidad: 0 },
    { accion: "al_stock", cantidad: -2 },
    { accion: "al_stock", cantidad: "hola" },
    { accion: "regalar", cantidad: 1 },
  ]) {
    const r = await moverRemanente(productoId, body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal(remanenteDe(productoId), 3);
});

test("mover el remanente NO cambia el consumo del servicio", async () => {
  if (sinBase()) return;
  // Eso ya se decidio al devolver. Pasarlo al stock despues no se lo perdona.
  const { pedidoId, productoId, cantidad } = bidonEntregado({ cantidad: 10 });
  await devolver(pedidoId, productoId, 4, "usado");
  assert.equal(neto(pedidoId).Cantidad, cantidad);

  await moverRemanente(productoId, { accion: "al_stock", cantidad: 4 });
  assert.equal(neto(pedidoId).Cantidad, cantidad, "el consumo no se toca");
});

test("no se toca el remanente de otra empresa", async () => {
  if (sinBase()) return;
  const { pedidoId, productoId } = bidonEntregado({ cantidad: 10 });
  await devolver(pedidoId, productoId, 3, "usado");
  db.prepare(`UPDATE Productos SET empresa_id = 2 WHERE ProductID = ?`).run(productoId);

  const r = await moverRemanente(productoId, { accion: "al_stock", cantidad: 3 });
  assert.equal(r.status, 404);
  assert.equal(remanenteDe(productoId), 3);
});

test("el resumen cuenta casi_lleno del lado que descuenta", async () => {
  if (sinBase()) return;
  const { pedidoId, productoId } = bidonEntregado({ cantidad: 10 });
  const r = await devolver(pedidoId, productoId, 4, "casi_lleno");
  assert.equal(r.body.unidadesDescontadas, 4);
  assert.equal(r.body.unidadesUsadas, 0);
});
