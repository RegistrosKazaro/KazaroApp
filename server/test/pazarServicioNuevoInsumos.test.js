// Pazar: un servicio nuevo nace con todos los insumos activos (19/11/2026),
// lo cree quien lo cree. Kazaro no: ahí la lista sale de los rubros.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = path.join(os.tmpdir(), `kz_pazarsrv_${Date.now()}.db`);
const origen = path.resolve(import.meta.dirname, "../Kazaro.db");
let db = null;

before(async () => {
  if (!fs.existsSync(origen)) return;
  fs.copyFileSync(origen, tmp);
  process.env.DB_PATH = tmp;
  ({ db } = await import("../src/db.js"));
});

after(() => {
  for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + ext); } catch {} }
});

const nuevo = (empresa) => Number(db.prepare(`INSERT INTO Servicios (ServicioNombre, empresa_id) VALUES (?, ?)`)
  .run(`SERVICIO NUEVO ${Date.now()} ${empresa}`, empresa).lastInsertRowid);
const asignados = (sid) => db.prepare(`SELECT COUNT(*) n FROM service_products WHERE service_id = ?`).get(sid).n;
const activos = (empresa) => db.prepare(`SELECT COUNT(*) n FROM Productos WHERE empresa_id = ? AND COALESCE(is_active,1) = 1`).get(empresa).n;

test("un servicio nuevo de Pazar nace con todos los insumos activos", () => {
  if (!db) return;
  const inactivo = Number(db.prepare(`INSERT INTO Productos (ProductName, Precio, Stock, empresa_id, is_active, Code) VALUES ('BAJA PAZAR', 1, 1, 2, 0, ?)`).run(`BP${Date.now()}`).lastInsertRowid);
  const sid = nuevo(2);
  assert.equal(asignados(sid), activos(2));
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM service_products WHERE service_id = ? AND product_id = ?`).get(sid, inactivo).n, 0, "los inactivos no");
});

test("un servicio nuevo de Kazaro no recibe nada automático", () => {
  if (!db) return;
  assert.equal(asignados(nuevo(1)), 0);
});
