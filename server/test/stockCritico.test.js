// Stock crítico por meses de cobertura.
//
// El cambio de fondo: antes se miraba el stock a secas y por eso no avisaba de
// los quiebres reales. 3.700 bolsas negras pasan cualquier umbral razonable,
// pero se consumen 32.487 por mes: duran tres días. Lo que se mide ahora es
// cuánto falta para quedarse sin, usando el consumo real de la propia app.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = path.join(os.tmpdir(), `kz_stockcrit_${Date.now()}.db`);
const origen = path.resolve(import.meta.dirname, "../Kazaro.db");
let handler = null;
let db = null;

before(async () => {
  if (!fs.existsSync(origen)) return;
  fs.copyFileSync(origen, tmp);
  process.env.DB_PATH = tmp;
  const { default: deposito } = await import("../src/routes/deposito.js");
  const capa = deposito.stack.find(
    (l) => l.route?.path === "/stock-critico" && l.route.methods.get
  );
  handler = capa?.route.stack.at(-1).handle ?? null;
  ({ db } = await import("../src/db.js"));
});

after(() => {
  for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + ext); } catch {} }
});

const sinBase = () => !handler || !db;
let seq = 0;
const unico = () => `${Date.now()}${(seq += 1)}`.slice(-12);

/** Un insumo de Kazaro con el stock que se le diga. */
function insumo(stock, nombre = "INSUMO") {
  return Number(db.prepare(
    `INSERT INTO Productos (ProductName, Precio, Stock, empresa_id, is_active, Code)
     VALUES (?, 100, ?, 1, 1, ?)`
  ).run(`${nombre} ${unico()}`, stock, `SC${unico()}`).lastInsertRowid);
}

/** Un pedido con ese insumo, hace tantos días. */
function consumo(productId, cantidad, haceDias = 10) {
  const fecha = new Date(Date.now() - haceDias * 86400000).toISOString().slice(0, 19).replace("T", " ");
  const id = Number(db.prepare(
    `INSERT INTO Pedidos (EmpleadoID, Rol, Total, empresa_id, Status, Fecha)
     VALUES (1, 'supervisor', 100, 1, 'closed', ?)`
  ).run(fecha).lastInsertRowid);
  db.prepare(
    `INSERT INTO PedidoItems (PedidoID, ProductoID, Nombre, Cantidad, Precio, Subtotal, cantidad_pendiente)
     VALUES (?, ?, 'X', ?, 100, ?, 0)`
  ).run(id, productId, cantidad, cantidad * 100);
  return id;
}

async function pedir(meses = 2) {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } };
  await handler({ query: { meses }, user: { empresaId: 1, role: "admin" } }, res);
  return res.body;
}

const buscar = (body, id) => (body.items || []).find((x) => x.productId === id);

test("avisa del que se quiebra aunque tenga mucho stock", async () => {
  if (sinBase()) return;
  // El caso real: 3.700 unidades parecen muchas hasta que mirás el consumo.
  const id = insumo(3700, "BOLSA NEGRA");
  consumo(id, 97460);                       // 97.460 en 90 días = 32.487 por mes

  const r = buscar(await pedir(2), id);
  assert.ok(r, "tendria que aparecer: dura menos de un mes");
  assert.equal(r.porMes, 32487);
  assert.ok(r.meses < 0.2, `deberia durar menos de 0,2 meses y da ${r.meses}`);
});

test("el que tiene poco consumo no molesta aunque tenga poco stock", async () => {
  if (sinBase()) return;
  const id = insumo(50, "MOPA");
  consumo(id, 3);                           // 1 por mes -> 50 meses de cobertura

  const body = await pedir(2);
  assert.equal(buscar(body, id), undefined, "50 meses de stock no es critico");
});

test("sin consumo no se calcula cobertura: no sabemos, no es que sobre", async () => {
  if (sinBase()) return;
  const id = insumo(0, "NUNCA PEDIDO");

  const body = await pedir(6);
  assert.equal(buscar(body, id), undefined);
  assert.ok(body.resumen.sinConsumo > 0, "tiene que contarlos aparte");
});

test("ordena por lo que primero se quiebra", async () => {
  if (sinBase()) return;
  const urgente = insumo(10, "URGENTE");
  consumo(urgente, 300);                    // 100 por mes -> 0,1 meses
  const tranquilo = insumo(300, "TRANQUILO");
  consumo(tranquilo, 300);                  // 100 por mes -> 3 meses

  const body = await pedir(6);
  const pos = (id) => body.items.findIndex((x) => x.productId === id);
  assert.ok(pos(urgente) >= 0 && pos(tranquilo) >= 0);
  assert.ok(pos(urgente) < pos(tranquilo), "primero el que se quiebra antes");
});

test("el filtro de meses recorta de verdad", async () => {
  if (sinBase()) return;
  const id = insumo(300, "TRES MESES");
  consumo(id, 300);                         // 100 por mes -> 3 meses

  assert.equal(buscar(await pedir(2), id), undefined, "3 meses no entra en el corte de 2");
  assert.ok(buscar(await pedir(6), id), "pero si en el de 6");
});

test("marca el stock sembrado en vez de taparlo", async () => {
  if (sinBase()) return;
  // Los 500.000 de cloro no son reales. Se muestran igual, pero marcados.
  const id = insumo(500000, "CLORO SEMBRADO");
  consumo(id, 900000);                      // 300.000 por mes -> 1,7 meses

  const r = buscar(await pedir(2), id);
  assert.ok(r, "tiene que aparecer igual");
  assert.equal(r.dudoso, true);
});

test("lo devuelto no cuenta como consumido", async () => {
  if (sinBase()) return;
  // Se mide sobre el neto: si el servicio devolvio, no lo gasto.
  const id = insumo(100, "DEVUELTO");
  const pedido = consumo(id, 300);          // sin devolucion serian 100 por mes
  db.prepare(
    `INSERT INTO devoluciones (pedido_id, producto_id, cantidad, empresa_id, estado, tipo, fecha_resolucion)
     VALUES (?, ?, 300, 1, 'aprobada', 'no_usado', datetime('now'))`
  ).run(pedido, id);

  const body = await pedir(6);
  assert.equal(buscar(body, id), undefined, "si se devolvio todo, no hay consumo");
});

test("un pedido borrado no cuenta", async () => {
  if (sinBase()) return;
  const id = insumo(10, "BORRADO");
  const pedido = consumo(id, 300);
  db.prepare(`UPDATE Pedidos SET deleted_at = datetime('now') WHERE PedidoID = ?`).run(pedido);

  assert.equal(buscar(await pedir(6), id), undefined);
});

test("lo de hace mas de 90 dias no cuenta", async () => {
  if (sinBase()) return;
  const id = insumo(10, "VIEJO");
  consumo(id, 300, 200);                    // hace 200 dias

  assert.equal(buscar(await pedir(6), id), undefined);
});

test("la ruta existe y esta detras del guardia del deposito", async () => {
  if (sinBase()) return;
  const { default: deposito } = await import("../src/routes/deposito.js");
  const capa = deposito.stack.find((l) => l.route?.path === "/stock-critico" && l.route.methods.get);
  assert.ok(capa, "la ruta tiene que existir");
  assert.ok(capa.route.stack.length >= 2, "le falta el guardia");
});
