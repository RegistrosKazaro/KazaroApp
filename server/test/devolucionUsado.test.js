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

test("el 'va y vuelve' mantiene las unidades y saca la plata del consumo", () => {
  if (sinBase()) return;
  const { pedidoId, productoId, precio, cantidad } = pedidoCon({ precio: 50000, cantidad: 2 });
  devolver(pedidoId, productoId, 2, "retornable");
  assert.equal(neto(pedidoId).Cantidad, cantidad, "los 2 tachos se usaron");
  assert.equal(totalNeto(pedidoId), 0, "pero volvieron: no son consumo (cambió el 13/10/2026)");
  assert.equal(neto(pedidoId).MontoPrestado, cantidad * precio);
});

test("los tres tipos conviven en un mismo pedido", () => {
  if (sinBase()) return;
  const { pedidoId, productoId, precio } = pedidoCon({ precio: 100, cantidad: 20 });
  devolver(pedidoId, productoId, 5, "no_usado");   // baja unidades y plata
  devolver(pedidoId, productoId, 3, "usado");      // no baja nada: se lo cobra
  devolver(pedidoId, productoId, 2, "retornable"); // baja sólo la plata
  const n = neto(pedidoId);
  assert.equal(n.Cantidad, 15, "20 - 5 sin abrir; lo usado y lo prestado siguen contando");
  assert.equal(n.Prestado, 2);
  assert.equal(n.Subtotal, 13 * precio, "de las 15 usadas, 2 son equipamiento que volvió");
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

/* ---------------------------------------------------------------------------
   Equipamiento prestado: las unidades cuentan como usadas, la plata no.
   Decidido con el usuario el 13/10/2026. El caso que lo motivó: SE - AIRBAG
   figuraba con $1.539.386 de consumo, de los cuales $1.418.336 eran 20 cestos
   que volvieron al depósito.
--------------------------------------------------------------------------- */

test("el equipamiento que volvió sigue contando en UNIDADES", () => {
  if (sinBase()) return;
  const { pedidoId, productoId, cantidad } = pedidoCon({ precio: 66116, cantidad: 20 });
  devolver(pedidoId, productoId, 20, "retornable");
  const n = neto(pedidoId);
  assert.equal(n.Cantidad, cantidad, "pidió 20 cestos y los usó: siguen siendo 20");
  assert.equal(n.Prestado, 20);
});

test("pero su PLATA no cuenta como consumo", () => {
  if (sinBase()) return;
  const { pedidoId, productoId, precio } = pedidoCon({ precio: 66116, cantidad: 20 });
  devolver(pedidoId, productoId, 20, "retornable");
  const n = neto(pedidoId);
  assert.equal(n.Subtotal, 0, "los 20 cestos volvieron: no se gastó nada");
  assert.equal(n.MontoPrestado, 20 * precio);
  assert.equal(totalNeto(pedidoId), 0);
  assert.equal(
    db.prepare(`SELECT EquipamientoPrestado FROM v_pedidos_neto WHERE PedidoID = ?`).get(pedidoId).EquipamientoPrestado,
    20 * precio,
  );
});

test("si se prestaron 10 y volvieron 6, se cobran los 4 que no volvieron", () => {
  if (sinBase()) return;
  const { pedidoId, productoId, precio } = pedidoCon({ precio: 1000, cantidad: 10 });
  devolver(pedidoId, productoId, 6, "retornable");
  const n = neto(pedidoId);
  assert.equal(n.Cantidad, 10, "las 10 se usaron");
  assert.equal(n.Prestado, 6);
  assert.equal(n.Subtotal, 4 * precio, "4 no volvieron: esos sí son consumo");
  assert.equal(totalNeto(pedidoId), 4 * precio);
});

test("el caso SE - AIRBAG, con sus numeros", () => {
  if (sinBase()) return;
  // 20 cestos que volvieron + el resto del pedido, que sí se consumió.
  const cestos = pedidoCon({ precio: 66116, cantidad: 20 });
  const otro = db.prepare(
    `INSERT INTO Productos (ProductName, Precio, Stock, empresa_id, is_active, Code)
     VALUES ('INSUMO CONSUMIBLE AIRBAG', 1210.50, 100, 1, 1, ?)`
  ).run(`DV-${Math.random().toString(36).slice(2, 8)}`);
  db.prepare(`INSERT INTO PedidoItems (PedidoID, ProductoID, Cantidad, Precio) VALUES (?, ?, 100, 1210.50)`)
    .run(cestos.pedidoId, Number(otro.lastInsertRowid));
  db.prepare(`UPDATE Pedidos SET Total = ? WHERE PedidoID = ?`)
    .run(20 * 66116 + 100 * 1210.50, cestos.pedidoId);
  devolver(cestos.pedidoId, cestos.productoId, 20, "retornable");

  const v = db.prepare(`SELECT * FROM v_pedidos_neto WHERE PedidoID = ?`).get(cestos.pedidoId);
  assert.equal(Math.round(v.EquipamientoPrestado), 1322320, "los cestos van aparte");
  assert.equal(Math.round(v.TotalNeto), 121050, "el consumo real");
  // Y las unidades no se pierden.
  const filas = db.prepare(`SELECT * FROM v_pedido_items_neto WHERE PedidoID = ?`).all(cestos.pedidoId);
  assert.equal(filas.find((f) => f.ProductoID === cestos.productoId).Cantidad, 20);
});

test("un pedido sin equipamiento no cambia en nada", () => {
  if (sinBase()) return;
  const { pedidoId, precio, cantidad } = pedidoCon({ precio: 500, cantidad: 8 });
  const n = neto(pedidoId);
  assert.equal(n.Prestado, 0);
  assert.equal(n.MontoPrestado, 0);
  assert.equal(n.Subtotal, cantidad * precio);
  assert.equal(totalNeto(pedidoId), cantidad * precio);
});

test("el equipamiento y lo devuelto sin abrir se descuentan por separado", () => {
  if (sinBase()) return;
  const { pedidoId, productoId, precio } = pedidoCon({ precio: 100, cantidad: 20 });
  devolver(pedidoId, productoId, 5, "no_usado");    // baja las unidades
  devolver(pedidoId, productoId, 10, "retornable"); // baja sólo la plata
  const n = neto(pedidoId);
  assert.equal(n.Cantidad, 15, "20 - 5 sin abrir");
  assert.equal(n.Prestado, 10);
  assert.equal(n.Subtotal, 5 * precio, "de las 15 usadas, 10 son equipamiento que volvió");
});
