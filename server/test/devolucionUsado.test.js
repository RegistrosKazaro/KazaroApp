// Tercer estado de devolución: "usado".
//
// Decidido con el usuario el 13/10/2026. Un envase que vuelve ABIERTO o un
// textil que vuelve sucio suma stock igual (se puede usar en otro lado) pero
// NO se le descuenta el consumo al servicio: el costo queda en quien lo abrió.
//
// Lo ya cargado sigue siendo "no_usado", así que ningún pedido viejo cambia.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = path.join(os.tmpdir(), `kz_dev_${Date.now()}.db`);
let db;

before(async () => {
  const origen = path.resolve(import.meta.dirname, "../Kazaro.db");
  if (!fs.existsSync(origen)) return;
  fs.copyFileSync(origen, tmp);
  process.env.DB_PATH = tmp;
  ({ db } = await import("../src/db.js"));
});

after(() => {
  for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + ext); } catch {} }
});

const sinBase = () => !db;

/** Arma un pedido con un ítem y devuelve sus ids. */
function pedidoCon({ precio = 1000, cantidad = 10 } = {}) {
  const prod = db.prepare(
    `INSERT INTO Productos (ProductName, Precio, Stock, empresa_id, is_active, Code)
     VALUES ('INSUMO DE PRUEBA DEV', ?, 100, 1, 1, ?)`
  ).run(precio, `DV-${Math.random().toString(36).slice(2, 8)}`);
  const productoId = Number(prod.lastInsertRowid);

  const ped = db.prepare(
    `INSERT INTO Pedidos (EmpleadoID, Rol, Total, empresa_id, Status) VALUES (1, 'supervisor', ?, 1, 'closed')`
  ).run(precio * cantidad);
  const pedidoId = Number(ped.lastInsertRowid);

  db.prepare(
    `INSERT INTO PedidoItems (PedidoID, ProductoID, Cantidad, Precio) VALUES (?, ?, ?, ?)`
  ).run(pedidoId, productoId, cantidad, precio);

  return { pedidoId, productoId, precio, cantidad };
}

const devolver = (pedidoId, productoId, cantidad, tipo) =>
  db.prepare(
    `INSERT INTO devoluciones (pedido_id, producto_id, cantidad, empresa_id, estado, tipo, fecha_resolucion)
     VALUES (?, ?, ?, 1, 'aprobada', ?, datetime('now'))`
  ).run(pedidoId, productoId, cantidad, tipo);

const neto = (pedidoId) =>
  db.prepare(`SELECT * FROM v_pedido_items_neto WHERE PedidoID = ?`).get(pedidoId);

const totalNeto = (pedidoId) =>
  db.prepare(`SELECT TotalNeto FROM v_pedidos_neto WHERE PedidoID = ?`).get(pedidoId)?.TotalNeto;

test("la columna pregunta_estado existe y arranca apagada", () => {
  if (sinBase()) return;
  const cols = db.prepare(`PRAGMA table_info(Productos)`).all().map((c) => c.name);
  assert.ok(cols.includes("pregunta_estado"));
  const prendidos = db.prepare(`SELECT COUNT(*) n FROM Productos WHERE COALESCE(pregunta_estado,0) = 1`).get().n;
  assert.equal(prendidos, 0, "hasta que se marquen los insumos, nada cambia");
});

test("lo que vuelve SIN ABRIR se le descuenta al servicio, como siempre", () => {
  if (sinBase()) return;
  const { pedidoId, productoId, precio } = pedidoCon({ precio: 1000, cantidad: 10 });
  devolver(pedidoId, productoId, 4, "no_usado");
  const n = neto(pedidoId);
  assert.equal(n.Cantidad, 6, "salieron 10, volvieron 4 sin abrir: consumió 6");
  assert.equal(n.Subtotal, 6 * precio);
  assert.equal(totalNeto(pedidoId), 6 * precio);
});

test("lo que vuelve ABIERTO o USADO NO se le descuenta: se lo cobra igual", () => {
  if (sinBase()) return;
  const { pedidoId, productoId, precio, cantidad } = pedidoCon({ precio: 8118, cantidad: 3 });
  devolver(pedidoId, productoId, 3, "usado");
  const n = neto(pedidoId);
  assert.equal(n.Cantidad, cantidad, "el consumo no baja");
  assert.equal(n.Subtotal, cantidad * precio);
  assert.equal(totalNeto(pedidoId), cantidad * precio, "el pedido sigue valiendo lo mismo");
});

test("el 'va y vuelve' sigue funcionando igual que antes", () => {
  if (sinBase()) return;
  const { pedidoId, productoId, precio, cantidad } = pedidoCon({ precio: 50000, cantidad: 2 });
  devolver(pedidoId, productoId, 2, "retornable");
  assert.equal(neto(pedidoId).Cantidad, cantidad);
  assert.equal(totalNeto(pedidoId), cantidad * precio);
});

test("los tres tipos conviven en un mismo pedido", () => {
  if (sinBase()) return;
  const { pedidoId, productoId, precio } = pedidoCon({ precio: 100, cantidad: 20 });
  devolver(pedidoId, productoId, 5, "no_usado");   // sólo este descuenta
  devolver(pedidoId, productoId, 3, "usado");
  devolver(pedidoId, productoId, 2, "retornable");
  const n = neto(pedidoId);
  assert.equal(n.Cantidad, 15, "20 - 5");
  assert.equal(n.Subtotal, 15 * precio);
  assert.equal(n.Devuelto, 5, "sólo cuenta como devuelto lo que no se usó");
});

test("una devolución vieja, sin tipo, se sigue descontando", () => {
  if (sinBase()) return;
  const { pedidoId, productoId } = pedidoCon({ precio: 100, cantidad: 10 });
  // Así quedaron las filas anteriores a la columna `tipo`.
  db.prepare(
    `INSERT INTO devoluciones (pedido_id, producto_id, cantidad, empresa_id, estado, tipo)
     VALUES (?, ?, 4, 1, 'aprobada', 'no_usado')`
  ).run(pedidoId, productoId);
  assert.equal(neto(pedidoId).Cantidad, 6);
});

test("una devolución pendiente no cuenta hasta que se aprueba", () => {
  if (sinBase()) return;
  const { pedidoId, productoId, cantidad } = pedidoCon({ precio: 100, cantidad: 10 });
  db.prepare(
    `INSERT INTO devoluciones (pedido_id, producto_id, cantidad, empresa_id, estado, tipo)
     VALUES (?, ?, 4, 1, 'pendiente', 'no_usado')`
  ).run(pedidoId, productoId);
  assert.equal(neto(pedidoId).Cantidad, cantidad);
});
