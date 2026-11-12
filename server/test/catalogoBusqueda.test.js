// La búsqueda del catálogo, la que usan el supervisor al pedir y el botón
// "Agregar insumos" del carrito.
//
// Usaba un LIKE pelado: SQLite sólo baja letras ASCII, así que "paño" no
// encontraba "PAÑO" y los insumos están cargados en mayúscula.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = path.join(os.tmpdir(), `kz_catbusq_${Date.now()}.db`);
const origen = path.resolve(import.meta.dirname, "../Kazaro.db");
let db = null, listProductsByCategory = null;

before(async () => {
  if (!fs.existsSync(origen)) return;
  fs.copyFileSync(origen, tmp);
  process.env.DB_PATH = tmp;
  ({ db, listProductsByCategory } = await import("../src/db.js"));
});

after(() => {
  for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + ext); } catch {} }
});

const marca = String(Date.now()).slice(-6);

function insumo(nombre, code) {
  const id = Number(db.prepare(
    `INSERT INTO Productos (ProductName, Precio, Stock, empresa_id, is_active, Code) VALUES (?, 1, 10, 1, 1, ?)`
  ).run(nombre, code).lastInsertRowid);
  db.prepare(`INSERT OR IGNORE INTO ProductRoleVisibility (product_id, role) VALUES (?, 'supervisor')`).run(id);
  return id;
}

const busca = (q) => listProductsByCategory("__all__", { q, roles: ["supervisor"], empresaId: 1 }).map((p) => Number(p.id));

test("encuentra la Ñ y las tildes en mayúscula, se escriba como se escriba", () => {
  if (!db) return;
  const pano = insumo(`PAÑO PRUEBA ${marca}`, `PP${marca}`);
  const algodon = insumo(`GUANTE ALGODÓN ${marca}`, `GA${marca}`);

  for (const q of [`paño prueba ${marca}`, `pano prueba ${marca}`, `PAÑO PRUEBA ${marca}`]) {
    assert.ok(busca(q).includes(pano), `"${q}" tendría que encontrar el PAÑO`);
  }
  assert.ok(busca(`algodon ${marca}`).includes(algodon));
  assert.ok(busca(`algodón ${marca}`).includes(algodon));
});

test("por código sigue funcionando", () => {
  if (!db) return;
  const id = insumo(`ESCOBA ${marca}`, `ES${marca}`);
  assert.ok(busca(`es${marca}`).includes(id));
});

test("lo que no coincide no aparece", () => {
  if (!db) return;
  insumo(`BALDE ALBAÑIL ${marca}`, `BA${marca}`);
  assert.equal(busca(`zzz${marca}`).length, 0);
});
