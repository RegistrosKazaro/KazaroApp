// La API de insumos que consultan otras áreas.
//
// Lo que se vigila: que nunca cruce de empresa (el token decide cuál ve), que
// el consumo sea el mismo número que muestra el panel de stock crítico, que el
// stock sembrado venga marcado como dudoso en vez de pasar por real, y que los
// endpoints nuevos queden detrás del token como los de pedidos.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

const tmp = path.join(os.tmpdir(), `kz_apiins_${Date.now()}.db`);
const origen = path.resolve(import.meta.dirname, "../Kazaro.db");
let db = null, api = null, ingresos = null;

const TOKEN_KAZARO = "token-de-prueba-kazaro-1234567890";
const TOKEN_PAZAR = "token-de-prueba-pazar-0987654321";

before(async () => {
  if (!fs.existsSync(origen)) return;
  fs.copyFileSync(origen, tmp);
  process.env.DB_PATH = tmp;
  process.env.PEDIDOS_API_TOKENS = `${TOKEN_KAZARO}:1,${TOKEN_PAZAR}:2`;
  api = (await import("../src/routes/apiPublica.js")).default;
  ingresos = await import("../src/ingresos.js");
  ({ db } = await import("../src/db.js"));
});

after(() => {
  for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + ext); } catch {} }
});

const sinBase = () => !db;
let seq = 0;
const unico = () => `${Date.now()}${(seq += 1).toString().padStart(3, "0")}`;

function insumo({ nombre = `INSUMO API ${unico()}`, code = `AI${unico()}`.slice(-12),
                  stock = 100, empresaId = 1, precio = 500 } = {}) {
  const id = Number(db.prepare(
    `INSERT INTO Productos (ProductName, Precio, Stock, empresa_id, is_active, Code)
     VALUES (?, ?, ?, ?, 1, ?)`
  ).run(nombre, precio, stock, empresaId, code).lastInsertRowid);
  return { id, code, nombre };
}

function pedidoDe(productoId, cantidad) {
  const pedidoId = Number(db.prepare(
    `INSERT INTO Pedidos (EmpleadoID, Rol, Total, empresa_id, Status, Fecha, closedat, retiro_at, contabilizado_at)
     VALUES (1, 'supervisor', ?, 1, 'closed', datetime('now'), datetime('now'), datetime('now'), datetime('now'))`
  ).run(cantidad * 10).lastInsertRowid);
  db.prepare(
    `INSERT INTO PedidoItems (PedidoID, ProductoID, Nombre, Codigo, Cantidad, Precio, Subtotal, cantidad_pendiente)
     VALUES (?, ?, 'X', 'X', ?, 10, ?, 0)`
  ).run(pedidoId, productoId, cantidad, cantidad * 10);
  return pedidoId;
}

/** Llama al handler de verdad, con la empresa que pondría el token. */
async function llamar(ruta, { query = {}, params = {}, empresaId = 1 } = {}) {
  const handler = api.stack.find((l) => l.route?.path === ruta && l.route.methods.get).route.stack.at(-1).handle;
  const res = {
    statusCode: 200,
    status(c) { this.statusCode = c; return this; },
    json(d) { this.body = d; return this; },
  };
  await handler({ query, params, apiEmpresaId: empresaId }, res);
  return res;
}

/* ─────────────── Lo que no se puede romper ─────────────── */

test("los endpoints de insumos quedan detras del token", async () => {
  if (sinBase()) return;
  // Pasa por todo el router: el limitador, el filtro de sólo lectura y el token.
  const app = express();
  app.use("/v1", api);
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  try {
    for (const ruta of ["/insumos", "/insumos/1", "/categorias"]) {
      assert.equal((await fetch(base + ruta)).status, 401, `${ruta} sin token`);
      assert.equal((await fetch(base + ruta, { headers: { "X-API-Key": "cualquiera" } })).status, 403, `${ruta} token malo`);
    }
    const ok = await fetch(base + "/insumos?limit=1", { headers: { Authorization: `Bearer ${TOKEN_KAZARO}` } });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).empresaId, 1);

    const post = await fetch(base + "/insumos", { method: "POST", headers: { "X-API-Key": TOKEN_KAZARO } });
    assert.equal(post.status, 405, "es de sólo lectura");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("un insumo de la otra empresa no aparece en la lista", async () => {
  if (sinBase()) return;
  const dePazar = insumo({ empresaId: 2 });

  const { body } = await llamar("/insumos", { query: { codigo: dePazar.code, incluirInactivos: "1" } });

  assert.equal(body.paginado.total, 0);
});

test("el detalle de un insumo de la otra empresa contesta 404, como si no existiera", async () => {
  if (sinBase()) return;
  // No confirma ni niega: un 403 diría que el id existe del otro lado.
  const dePazar = insumo({ empresaId: 2 });

  const res = await llamar("/insumos/:id", { params: { id: String(dePazar.id) } });

  assert.equal(res.statusCode, 404);
});

/* ─────────────── La ficha ─────────────── */

test("la ficha trae todos los bloques", async () => {
  if (sinBase()) return;
  const p = insumo({ stock: 42 });

  const { body } = await llamar("/insumos", { query: { codigo: p.code } });
  const f = body.insumos[0];

  assert.equal(f.id, p.id);
  assert.equal(f.nombre, p.nombre);
  for (const bloque of ["categoria", "rubros", "stock", "consumo", "devolucion", "flexxus",
                        "serviciosAsignados", "visiblePara", "ultimoPrecioCompra"]) {
    assert.ok(bloque in f, `falta ${bloque}`);
  }
  assert.equal(f.stock.disponible, 42);
  assert.equal(f.stock.dudoso, false);
  assert.equal(f.devolucion.preguntaAlVolver, "ninguna");
});

test("el stock sembrado viene marcado como dudoso", async () => {
  if (sinBase()) return;
  // 499.998.534 pastillas de cloro existen en la base pero no en el depósito.
  // Pasarlo sin aviso a otra área sería venderle un número inventado.
  const p = insumo({ stock: 499998534 });

  const { body } = await llamar("/insumos", { query: { codigo: p.code } });

  assert.equal(body.insumos[0].stock.dudoso, true);
});

test("el consumo es el neto de los ultimos 90 dias, igual que el panel", async () => {
  if (sinBase()) return;
  const p = insumo({ stock: 300 });
  pedidoDe(p.id, 30);
  pedidoDe(p.id, 60);

  const { body } = await llamar("/insumos", { query: { codigo: p.code } });
  const c = body.insumos[0].consumo;

  assert.equal(c.ultimos90Dias, 90);
  assert.equal(c.promedioMensual, 30);
  assert.equal(c.mesesDeCobertura, 10);   // 300 de stock / 30 por mes
  assert.ok(c.ultimoPedido, "tiene que decir cuándo se pidió por última vez");
});

test("sin consumo, la cobertura es null y no infinito", async () => {
  if (sinBase()) return;
  const p = insumo({ stock: 300 });

  const { body } = await llamar("/insumos", { query: { codigo: p.code } });

  assert.equal(body.insumos[0].consumo.mesesDeCobertura, null);
  assert.equal(body.insumos[0].consumo.ultimoPedido, null);
});

/* ─────────────── Los filtros ─────────────── */

test("el codigo con y sin ceros adelante es el mismo", async () => {
  if (sinBase()) return;
  const n = String(Date.now()).slice(-7);
  const p = insumo({ code: `00${n}` });

  const { body } = await llamar("/insumos", { query: { codigo: n } });

  assert.ok(body.insumos.some((i) => i.id === p.id));
});

test("codigo=0 no trae los insumos sin codigo", async () => {
  if (sinBase()) return;
  // Sacarle los ceros a "0" deja vacío, igual que un código vacío.
  const sinCodigo = insumo({ code: "" });

  const { body } = await llamar("/insumos", { query: { codigo: "0", limit: "500" } });

  assert.ok(!body.insumos.some((i) => i.id === sinCodigo.id));
});

test("la busqueda no distingue acentos ni mayusculas", async () => {
  if (sinBase()) return;
  const marca = unico();
  const p = insumo({ nombre: `PAÑO ÁCIDO ${marca}` });

  const { body } = await llamar("/insumos", { query: { q: `pano acido ${marca}` } });

  assert.ok(body.insumos.some((i) => i.id === p.id));
});

test("un filtro que no es numero contesta 400", async () => {
  if (sinBase()) return;
  const res = await llamar("/insumos", { query: { categoriaId: "bolsas" } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.campo, "categoriaId");
});

test("el limite por pagina no pasa de 500", async () => {
  if (sinBase()) return;
  const { body } = await llamar("/insumos", { query: { limit: "99999" } });
  assert.equal(body.paginado.limit, 500);
});

/* ─────────────── El detalle ─────────────── */

test("el detalle trae lo comprado, con el precio de la factura conciliada", async () => {
  if (sinBase()) return;
  const p = insumo({ stock: 0 });
  const remitoId = ingresos.crearRemito({ empresaId: 1, proveedor: "PROV API", numero: unico(),
    fecha: "2026-11-01", items: [{ productoId: p.id, cantidad: 12 }] });
  const itemId = db.prepare(`SELECT id FROM ingreso_items WHERE ingreso_id = ?`).get(remitoId).id;
  ingresos.asociarFactura({ empresaId: 1, ingresoIds: [remitoId], numeroFactura: "A-0001-00000077",
    fechaFactura: "2026-11-02", lineas: [{ itemId, cantidad: 12, precioUnitario: 850.5 }] });

  const { body } = await llamar("/insumos/:id", { params: { id: String(p.id) } });
  const ins = body.insumo;

  assert.equal(ins.ultimoPrecioCompra, 850.5);
  assert.equal(ins.compras.length, 1);
  assert.equal(ins.compras[0].estado, "conciliado");
  assert.equal(ins.compras[0].factura, "A-0001-00000077");
  assert.equal(ins.stock.disponible, 12, "el stock que subió al conciliar");
});

test("el detalle trae el consumo mes a mes y los servicios que lo tienen", async () => {
  if (sinBase()) return;
  const p = insumo();
  pedidoDe(p.id, 7);
  const servicio = db.prepare(
    `SELECT ServiciosID AS id FROM Servicios WHERE empresa_id = 1 AND deleted_at IS NULL LIMIT 1`
  ).get();
  if (servicio) {
    db.prepare(`INSERT INTO service_products (service_id, product_id) VALUES (?, ?)`).run(servicio.id, p.id);
  }

  const { body } = await llamar("/insumos/:id", { params: { id: String(p.id) } });
  const ins = body.insumo;

  const esteMes = ins.consumo.porMes.at(-1);
  assert.equal(esteMes.cantidad, 7);
  assert.equal(esteMes.pedidos, 1);
  if (servicio) {
    assert.ok(ins.servicios.some((s) => s.id === Number(servicio.id)));
    assert.equal(ins.serviciosAsignados, ins.servicios.length);
  }
});

test("un id que no es numero contesta 400", async () => {
  if (sinBase()) return;
  const res = await llamar("/insumos/:id", { params: { id: "abc" } });
  assert.equal(res.statusCode, 400);
});

test("las categorias son sólo de la empresa del token", async () => {
  if (sinBase()) return;
  const deKazaro = await llamar("/categorias", { empresaId: 1 });
  const dePazar = await llamar("/categorias", { empresaId: 2 });

  const idsK = new Set(deKazaro.body.categorias.map((c) => c.id));
  assert.ok(!dePazar.body.categorias.some((c) => idsK.has(c.id)), "no comparten categorías");
  assert.ok(Array.isArray(deKazaro.body.rubros));
});
