// El código de barras es lo que hace que la pistola sirva. La pistola es un
// teclado: escanea, escribe el código y manda Enter. Si dos insumos tuvieran
// el mismo, el escaneo sería ambiguo y el picking elegiría cualquiera.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Una COPIA de la base de desarrollo: importar las rutas carga db.js.
const tmp = path.join(os.tmpdir(), `kz_barra_${Date.now()}.db`);
const origen = path.resolve(import.meta.dirname, "../Kazaro.db");
const hayBase = fs.existsSync(origen);
if (hayBase) { fs.copyFileSync(origen, tmp); process.env.DB_PATH = tmp; }

const adminRouter = (await import("../src/routes/admin.js")).default;
const { db } = await import("../src/db.js");

after(() => {
  for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + ext); } catch {} }
});

function handler(metodo, ruta) {
  const capa = adminRouter.stack.find((l) => l.route?.path === ruta && l.route.methods[metodo]);
  return capa.route.stack.at(-1).handle;
}

const llamar = (metodo, ruta, { params = {}, body = {}, query = {}, empresaId = 1 } = {}) =>
  new Promise((resolve) => {
    const req = { params, body, query, user: { empresaId, role: "admin", id: 1 } };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(d) { resolve({ status: this.statusCode, body: d }); },
    };
    Promise.resolve(handler(metodo, ruta)(req, res))
      .catch((e) => resolve({ status: 500, body: { error: e.message } }));
  });

const crear = (name, codigoBarra) => llamar("post", "/products", { body: { name, codigoBarra } });
const leer  = (id) => db.prepare(`SELECT codigo_barra FROM Productos WHERE ProductID = ?`).get(id)?.codigo_barra;

test("la columna existe y queda con indice unico", () => {
  if (!hayBase) return;
  const cols = db.prepare(`PRAGMA table_info(Productos)`).all().map((c) => c.name);
  assert.ok(cols.includes("codigo_barra"), "falta la columna");
  const idx = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_prod_codbarra'`
  ).get();
  assert.ok(idx, "falta el indice unico");
});

test("se guarda al crear el insumo", async () => {
  if (!hayBase) return;
  const r = await crear("PRUEBA PISTOLA A", "7790001234567");
  assert.equal(r.status, 201);
  assert.equal(leer(r.body.id), "7790001234567");
});

test("vacio se guarda como NULL, no como texto vacio", async () => {
  if (!hayBase) return;
  // Si quedara "", el segundo insumo sin codigo chocaria contra el unico.
  const a = await crear("PRUEBA PISTOLA SIN A", "");
  const b = await crear("PRUEBA PISTOLA SIN B", "   ");
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(leer(a.body.id), null);
  assert.equal(leer(b.body.id), null);
});

test("no se puede repetir, y dice cual lo tiene", async () => {
  if (!hayBase) return;
  await crear("PRUEBA PISTOLA DUENIO", "7790009999999");
  const r = await crear("PRUEBA PISTOLA REPETIDO", "7790009999999");
  assert.equal(r.status, 409);
  assert.match(r.body.error, /PRUEBA PISTOLA DUENIO/);
});

test("se puede cambiar desde el ABM", async () => {
  if (!hayBase) return;
  const { body } = await crear("PRUEBA PISTOLA EDIT", "7790001111111");
  const r = await llamar("put", "/products/:id", {
    params: { id: String(body.id) }, body: { codigoBarra: "7790002222222" },
  });
  assert.equal(r.status, 200);
  assert.equal(leer(body.id), "7790002222222");
});

test("y se puede borrar", async () => {
  if (!hayBase) return;
  const { body } = await crear("PRUEBA PISTOLA BORRAR", "7790005555555");
  await llamar("put", "/products/:id", {
    params: { id: String(body.id) }, body: { codigoBarra: "" },
  });
  assert.equal(leer(body.id), null);
});

test("si el pedido no lo menciona, no se pisa", async () => {
  if (!hayBase) return;
  // Es lo que pasa al guardar desde una pantalla que no conoce el campo.
  const { body } = await crear("PRUEBA PISTOLA INTACTO", "7790006666666");
  await llamar("put", "/products/:id", {
    params: { id: String(body.id) }, body: { name: "PRUEBA PISTOLA INTACTO 2" },
  });
  assert.equal(leer(body.id), "7790006666666");
});

test("el detalle lo devuelve para que el ABM lo muestre", async () => {
  if (!hayBase) return;
  const { body } = await crear("PRUEBA PISTOLA DETALLE", "7790003333333");
  const r = await llamar("get", "/products/:id", { params: { id: String(body.id) } });
  assert.equal(r.body.codigoBarra, "7790003333333");
});

test("buscar por el codigo escaneado encuentra el insumo", async () => {
  if (!hayBase) return;
  const { body } = await crear("PRUEBA PISTOLA BUSCAR", "7790004444444");
  const r = await llamar("get", "/products", { query: { q: "7790004444444" } });
  const fila = r.body.find((p) => p.id === body.id);
  assert.ok(fila, "no lo encontro buscando por el codigo");
  assert.equal(fila.codigoBarra, "7790004444444");
});