// Filtrar el listado de productos del panel por categoría (18/11/2026).
// Antes filtraba en el navegador sobre los primeros 500 por nombre: con más de
// 1.000 insumos, la categoría Papel salía vacía.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = path.join(os.tmpdir(), `kz_admcat_${Date.now()}.db`);
const origen = path.resolve(import.meta.dirname, "../Kazaro.db");
let db = null, handler = null;

before(async () => {
  if (!fs.existsSync(origen)) return;
  fs.copyFileSync(origen, tmp);
  process.env.DB_PATH = tmp;
  ({ db } = await import("../src/db.js"));
  const admin = (await import("../src/routes/admin.js")).default;
  handler = admin.stack.find((l) => l.route?.path === "/products" && l.route.methods.get)?.route.stack.at(-1).handle;
});

after(() => {
  for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + ext); } catch {} }
});

async function listar(query) {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } };
  await handler({ query, user: { empresaId: 1 } }, res);
  return res.body;
}

test("filtrar por categoría encuentra el insumo aunque haya cientos antes por nombre", async () => {
  if (!handler) return;
  const cat = Number(db.prepare(`INSERT INTO Categorias (CategoriaNombre, empresa_id) VALUES ('Papel prueba', 1)`).run().lastInsertRowid);
  const ins = db.prepare(`INSERT INTO Productos (ProductName, Precio, Stock, empresa_id, is_active, Code, CategoriaID) VALUES (?, 1, 1, 1, 1, ?, ?)`);
  db.transaction(() => { for (let i = 0; i < 600; i += 1) ins.run(`AAA RELLENO ${i}`, `REL${Date.now()}${i}`, null); })();
  const id = Number(ins.run("ZZZ PAPEL HIGIENICO PRUEBA", `PAP${Date.now()}`, cat).lastInsertRowid);

  const filas = await listar({ catId: String(cat) });
  assert.deepEqual(filas.map((p) => Number(p.id)), [id], "sólo el de la categoría, y aparece");
  assert.ok((await listar({})).some((p) => Number(p.id) === id), "sin filtro también se ve, ya no corta en 500");
});
