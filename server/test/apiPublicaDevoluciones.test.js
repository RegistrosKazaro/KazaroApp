// La API que consulta el otro área, ¿devuelve el dato con la devolución ya
// impactada?
//
// Importa de verdad: esa área factura o controla con estos números. Si
// informara lo pedido en bruto, un servicio que devolvió media carga quedaría
// con un consumo que nunca tuvo.
//
// Y desde el 15/10/2026 hay devoluciones que NO descuentan a propósito (lo que
// el servicio gastó o rompió). Esto fija qué informa la API en cada caso.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = path.join(os.tmpdir(), `kz_apidev_${Date.now()}.db`);
const origen = path.resolve(import.meta.dirname, "../Kazaro.db");
let db = null, apiRouter = null, depositoRouter = null;

before(async () => {
  if (!fs.existsSync(origen)) return;
  fs.copyFileSync(origen, tmp);
  process.env.DB_PATH = tmp;
  apiRouter = (await import("../src/routes/apiPublica.js")).default;
  depositoRouter = (await import("../src/routes/deposito.js")).default;
  ({ db } = await import("../src/db.js"));
});

after(() => {
  for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + ext); } catch {} }
});

const sinBase = () => !db;
let seq = 0;
const unico = () => `${Date.now()}${(seq += 1).toString().padStart(3, "0")}`;

function pedidoRetirado({ cantidad = 10, precio = 1000, preguntaEstado = 1 } = {}) {
  const productoId = Number(db.prepare(
    `INSERT INTO Productos (ProductName, Precio, Stock, empresa_id, is_active, Code, pregunta_estado)
     VALUES ('BIDON API X 5 LTS', ?, 100, 1, 1, ?, ?)`
  ).run(precio, `AP-${unico()}`, preguntaEstado).lastInsertRowid);

  const pedidoId = Number(db.prepare(
    // contabilizado_at: la API sólo expone los pedidos ya contabilizados.
    `INSERT INTO Pedidos (EmpleadoID, Rol, Total, empresa_id, Status, Fecha, closedat, retiro_at, contabilizado_at)
     VALUES (1, 'supervisor', ?, 1, 'closed', datetime('now'), datetime('now'), datetime('now'), datetime('now'))`
  ).run(precio * cantidad).lastInsertRowid);

  db.prepare(
    `INSERT INTO PedidoItems (PedidoID, ProductoID, Nombre, Codigo, Cantidad, Precio, Subtotal, cantidad_pendiente)
     VALUES (?, ?, 'BIDON API X 5 LTS', 'AP', ?, ?, ?, 0)`
  ).run(pedidoId, productoId, cantidad, precio, precio * cantidad);

  return { pedidoId, productoId, precio, cantidad };
}

const handler = (router, metodo, ruta) =>
  router.stack.find((l) => l.route?.path === ruta && l.route.methods[metodo]).route.stack.at(-1).handle;

const devolver = (pedidoId, productoId, cantidad, estado) =>
  new Promise((resolve) => {
    const req = { params: {}, query: {},
      body: { pedidoId, items: [{ productoId: String(productoId), cantidad, estado }], motivo: "prueba" },
      user: { id: 1, empresaId: 1, roles: ["deposito"], username: "test" } };
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; },
                  json(d) { resolve({ status: this.statusCode, body: d }); } };
    Promise.resolve(handler(depositoRouter, "post", "/devoluciones")(req, res))
      .catch((e) => resolve({ status: 500, body: { error: e.message } }));
  });

/** Lo que vería el otro área consultando ese pedido. */
const consultar = (pedidoId) =>
  new Promise((resolve) => {
    const req = { params: {}, query: { limit: "500" }, apiEmpresaId: 1, headers: {} };
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; },
                  json(d) { resolve({ status: this.statusCode, body: d }); } };
    Promise.resolve(handler(apiRouter, "get", "/pedidos")(req, res))
      .catch((e) => resolve({ status: 500, body: { error: e.message } }));
  }).then((r) => ({ ...r, pedido: r.body?.pedidos?.find((p) => p.pedidoId === pedidoId) }));

test("sin devoluciones, la API informa lo pedido", async () => {
  if (sinBase()) return;
  const { pedidoId, cantidad, precio } = pedidoRetirado({ cantidad: 10, precio: 1000 });
  const { pedido } = await consultar(pedidoId);
  assert.ok(pedido, "el pedido tenia que estar en la respuesta");
  assert.equal(pedido.total, cantidad * precio);
  assert.equal(pedido.totalPedido, cantidad * precio);
  assert.equal(pedido.tuvoDevolucion, false);
});

test("una devolucion que descuenta baja el total de la API", async () => {
  if (sinBase()) return;
  const { pedidoId, productoId, precio } = pedidoRetirado({ cantidad: 10, precio: 1000 });
  await devolver(pedidoId, productoId, 4, "sin_abrir");

  const { pedido } = await consultar(pedidoId);
  assert.equal(pedido.total, 6 * precio, "el total tiene que venir neto");
  assert.equal(pedido.totalPedido, 10 * precio, "y lo pedido original tambien se informa");
  assert.equal(pedido.montoDevuelto, 4 * precio);
  assert.equal(pedido.tuvoDevolucion, true);

  const item = pedido.items[0];
  assert.equal(item.cantidad, 6, "cantidad neta");
  assert.equal(item.cantidadPedida, 10);
  assert.equal(item.devuelto, 4);
  assert.equal(item.subtotal, 6 * precio);
});

test("el bidon casi lleno tambien baja el total, aunque vaya a remanentes", async () => {
  if (sinBase()) return;
  const { pedidoId, productoId, precio } = pedidoRetirado({ cantidad: 10, precio: 1000 });
  await devolver(pedidoId, productoId, 4, "casi_lleno");

  const { pedido } = await consultar(pedidoId);
  assert.equal(pedido.total, 6 * precio);
  assert.equal(pedido.items[0].devuelto, 4);
  assert.equal(pedido.tuvoDevolucion, true);
});

test("lo que el servicio gasto NO baja el total: es correcto que se lo cobren", async () => {
  if (sinBase()) return;
  const { pedidoId, productoId, precio } = pedidoRetirado({ cantidad: 10, precio: 1000 });
  await devolver(pedidoId, productoId, 4, "usado");

  const { pedido } = await consultar(pedidoId);
  assert.equal(pedido.total, 10 * precio, "lo gasto: se le cobra entero");
  assert.equal(pedido.items[0].cantidad, 10);
});

test("la herramienta rota tampoco baja el total", async () => {
  if (sinBase()) return;
  const { pedidoId, productoId, precio } = pedidoRetirado({ cantidad: 6, precio: 500, preguntaEstado: 2 });
  await devolver(pedidoId, productoId, 2, "roto");

  const { pedido } = await consultar(pedidoId);
  assert.equal(pedido.total, 6 * 500, "la rompio el: la paga");
});

test("la herramienta sana baja el total entero", async () => {
  if (sinBase()) return;
  const { pedidoId, productoId } = pedidoRetirado({ cantidad: 6, precio: 500, preguntaEstado: 2 });
  await devolver(pedidoId, productoId, 6, "buen_estado");

  const { pedido } = await consultar(pedidoId);
  assert.equal(pedido.total, 0, "volvio entera: no consumio nada");
  assert.equal(pedido.items[0].cantidad, 0);
});

// Esto es un límite conocido, no un error: la API informa la devolución que
// afecta la plata. Una devolución que no descuenta (gastada o rota) sube el
// stock y queda en remanentes, pero desde afuera el pedido se ve como si no
// hubiera vuelto nada. Para ese detalle está el panel del depósito.
test("una devolucion que no descuenta no se ve desde la API", async () => {
  if (sinBase()) return;
  const { pedidoId, productoId } = pedidoRetirado({ cantidad: 10, precio: 1000 });
  await devolver(pedidoId, productoId, 4, "usado");

  const { pedido } = await consultar(pedidoId);
  assert.equal(pedido.tuvoDevolucion, false, "shortcut conocido: la API sólo ve lo que descuenta");
  assert.equal(pedido.items[0].devuelto, 0);
});

test("lo pendiente de entregar tampoco se informa como consumido", async () => {
  if (sinBase()) return;
  // Esto estaba mal hasta el 15/10/2026: el total salia de restarle las
  // devoluciones a Pedidos.Total y se olvidaba lo pendiente, asi que informaba
  // mercaderia que nunca salio del deposito.
  const { pedidoId, productoId, precio } = pedidoRetirado({ cantidad: 10, precio: 1000 });
  db.prepare(`UPDATE PedidoItems SET cantidad_pendiente = 3 WHERE PedidoID = ? AND ProductoID = ?`)
    .run(pedidoId, productoId);

  const { pedido } = await consultar(pedidoId);
  assert.equal(pedido.total, 7 * precio, "lo que no salio del deposito no se consumio");
  assert.equal(pedido.items[0].cantidad, 7);
});

test("el total SIEMPRE cierra con la suma de sus items", async () => {
  if (sinBase()) return;
  // Es lo que mira el que consume la API: si no cierra, no puede conciliar.
  const { pedidoId, productoId } = pedidoRetirado({ cantidad: 10, precio: 1000 });
  db.prepare(`UPDATE PedidoItems SET cantidad_pendiente = 2 WHERE PedidoID = ? AND ProductoID = ?`)
    .run(pedidoId, productoId);
  await devolver(pedidoId, productoId, 3, "sin_abrir");

  const { pedido } = await consultar(pedidoId);
  const suma = pedido.items.reduce((a, i) => a + i.subtotal, 0);
  assert.equal(pedido.total, suma, "el total y los items tienen que coincidir");
  assert.equal(pedido.total, 5 * 1000, "10 - 2 pendientes - 3 devueltas");
});

test("y tambien cierra cuando hay equipamiento prestado", async () => {
  if (sinBase()) return;
  const { pedidoId, productoId } = pedidoRetirado({ cantidad: 10, precio: 1000 });
  db.prepare(`UPDATE Productos SET retornable = 1 WHERE ProductID = ?`).run(productoId);
  await devolver(pedidoId, productoId, 4, "sin_abrir");

  const { pedido } = await consultar(pedidoId);
  const suma = pedido.items.reduce((a, i) => a + i.subtotal, 0);
  assert.equal(pedido.total, suma);
});
