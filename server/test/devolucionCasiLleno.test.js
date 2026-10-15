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

const neto = (pedidoId) =>
  db.prepare(`SELECT * FROM v_pedido_items_neto WHERE PedidoID = ?`).get(pedidoId);

/* ===================== El caso que trababa todo ===================== */

test("el bidon casi lleno vuelve al stock Y se le descuenta el consumo", async () => {
  if (sinBase()) return;
  // 5 litros y se uso 1: casi ni se distingue. Antes se le cobraba entero.
  const { pedidoId, productoId, cantidad } = bidonEntregado({ cantidad: 10 });
  const antes = stockDe(productoId);

  const r = await devolver(pedidoId, productoId, 4, "casi_lleno");
  assert.equal(r.status, 200);
  assert.equal(tipoGuardado(pedidoId), "casi_lleno");
  assert.equal(stockDe(productoId), antes + 4, "tenia que volver al stock");
  assert.equal(neto(pedidoId).Cantidad, cantidad - 4, "y descontarse del consumo");
});

test("el bidon por la mitad vuelve al stock pero se le cobra igual", async () => {
  if (sinBase()) return;
  const { pedidoId, productoId, cantidad } = bidonEntregado({ cantidad: 10 });
  const antes = stockDe(productoId);

  const r = await devolver(pedidoId, productoId, 4, "usado");
  assert.equal(r.status, 200);
  assert.equal(tipoGuardado(pedidoId), "usado");
  assert.equal(stockDe(productoId), antes + 4, "igual vuelve al stock");
  assert.equal(neto(pedidoId).Cantidad, cantidad, "pero el consumo no baja");
});

test("sin abrir sigue funcionando como siempre", async () => {
  if (sinBase()) return;
  const { pedidoId, productoId, cantidad } = bidonEntregado({ cantidad: 10 });
  await devolver(pedidoId, productoId, 3, "sin_abrir");
  assert.equal(tipoGuardado(pedidoId), "no_usado");
  assert.equal(neto(pedidoId).Cantidad, cantidad - 3);
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

test("la vista de neto no necesito cambiar: excluye solo retornable y usado", () => {
  if (sinBase()) return;
  const sql = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='view' AND name='v_devoluciones_aprobadas'`
  ).get().sql;
  assert.match(sql, /NOT IN \('retornable', 'usado'\)/,
    "si esto cambia, casi_lleno deja de descontar sin que nadie se entere");
});

test("el resumen cuenta casi_lleno del lado que descuenta", async () => {
  if (sinBase()) return;
  const { pedidoId, productoId } = bidonEntregado({ cantidad: 10 });
  const r = await devolver(pedidoId, productoId, 4, "casi_lleno");
  assert.equal(r.body.unidadesDescontadas, 4);
  assert.equal(r.body.unidadesUsadas, 0);
});
