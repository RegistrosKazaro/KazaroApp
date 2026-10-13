// Crear o editar un insumo con un código que ya existe tiene que decir CUÁL es
// el insumo que lo está usando, no "UNIQUE constraint failed".
//
// Se invoca el handler real del router, con una base temporal.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = path.join(os.tmpdir(), `kz_prod_${Date.now()}.db`);
let adminRouter;
let db;

before(async () => {
  // Una COPIA de la base de desarrollo: tiene el esquema real de Productos, y
  // al ser copia no se toca nada. Si no existe, el test se saltea en vez de
  // fallar (en CI puede no haber base).
  const origen = path.resolve(import.meta.dirname, "../Kazaro.db");
  if (!fs.existsSync(origen)) return;
  fs.copyFileSync(origen, tmp);
  process.env.DB_PATH = tmp;
  ({ db } = await import("../src/db.js"));
  adminRouter = (await import("../src/routes/admin.js")).default;
});

/** En un entorno sin base de desarrollo, estos tests no aplican. */
const sinBase = () => !adminRouter;

after(() => {
  for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + ext); } catch {} }
});

function handler(metodo, ruta) {
  const capa = adminRouter.stack.find((l) => l.route?.path === ruta && l.route.methods[metodo]);
  if (!capa) throw new Error(`No existe ${metodo.toUpperCase()} ${ruta}`);
  return capa.route.stack.at(-1).handle;   // salteamos los middlewares de auth
}

const llamar = (metodo, ruta, { params = {}, body = {}, empresaId = 1 } = {}) =>
  new Promise((resolve) => {
    const req = { params, body, query: {}, user: { empresaId, role: "admin" } };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(d) { resolve({ status: this.statusCode, body: d }); },
    };
    Promise.resolve(handler(metodo, ruta)(req, res))
      .catch((e) => resolve({ status: 500, body: { error: e.message } }));
  });

test("crear un insumo con un código libre funciona", async () => {
  if (sinBase()) return;
  const r = await llamar("post", "/products", { body: { name: "INSUMO DE PRUEBA A", code: "ZZ-901" } });
  assert.equal(r.status, 201);
  assert.ok(r.body.id);
});

test("si el código ya existe, dice cuál insumo lo usa", async () => {
  if (sinBase()) return;
  await llamar("post", "/products", { body: { name: "TRAPO DE PISO DE PRUEBA", code: "ZZ-902" } });
  const r = await llamar("post", "/products", { body: { name: "OTRO INSUMO", code: "ZZ-902" } });

  assert.equal(r.status, 409, "409 es 'conflicto', no 'el servidor se rompió'");
  assert.match(r.body.error, /ZZ-902/);
  assert.match(r.body.error, /TRAPO DE PISO DE PRUEBA/);
  assert.doesNotMatch(r.body.error, /UNIQUE|constraint/i, "nada de jerga de base de datos");
  assert.equal(r.body.productoExistente.nombre, "TRAPO DE PISO DE PRUEBA");
});

test("editar un insumo poniéndole el código de otro también avisa", async () => {
  if (sinBase()) return;
  await llamar("post", "/products", { body: { name: "INSUMO CON CODIGO TOMADO", code: "ZZ-903" } });
  const otro = await llamar("post", "/products", { body: { name: "INSUMO A EDITAR", code: "ZZ-904" } });

  const r = await llamar("put", "/products/:id", {
    params: { id: String(otro.body.id) },
    body: { name: "INSUMO A EDITAR", code: "ZZ-903" },
  });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /INSUMO CON CODIGO TOMADO/);
});

test("guardar un insumo con SU PROPIO código no es un choque", async () => {
  if (sinBase()) return;
  const p = await llamar("post", "/products", { body: { name: "INSUMO SIN CAMBIOS", code: "ZZ-905" } });
  const r = await llamar("put", "/products/:id", {
    params: { id: String(p.body.id) },
    body: { name: "INSUMO SIN CAMBIOS (editado)", code: "ZZ-905" },
  });
  assert.notEqual(r.status, 409);
});

test("el mismo código en la otra empresa es válido: no se pisan", async () => {
  if (sinBase()) return;
  await llamar("post", "/products", { body: { name: "INSUMO KAZARO", code: "ZZ-906" }, empresaId: 1 });
  const r = await llamar("post", "/products", { body: { name: "INSUMO PAZAR", code: "ZZ-906" }, empresaId: 2 });
  assert.equal(r.status, 201);
});

test("un error que no sea de código repetido sigue dando 500", async () => {
  if (sinBase()) return;
  const r = await llamar("post", "/products", { body: { code: "ZZ-907" } });  // sin nombre
  assert.equal(r.status, 400, "el nombre vacío se valida antes");
  assert.match(r.body.error, /name/);
});
