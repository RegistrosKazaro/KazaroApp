// "Pedidos Maralim" (19/11/2026): los servicios marcados salen sólo en su
// sección, no en la de Supervisor, y pueden repetir pedidos.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = path.join(os.tmpdir(), `kz_maralim_${Date.now()}.db`);
const origen = path.resolve(import.meta.dirname, "../Kazaro.db");
let M = null, handler = null;

before(async () => {
  if (!fs.existsSync(origen)) return;
  fs.copyFileSync(origen, tmp);
  process.env.DB_PATH = tmp;
  M = await import("../src/db.js");
  const sup = (await import("../src/routes/supervisor.js")).default;
  handler = sup.stack.find((l) => l.route?.path === "/services" && l.route.methods.get)?.route.stack.at(-1).handle;
});

after(() => {
  for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + ext); } catch {} }
});

async function servicios(empleadoId, query = {}) {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } };
  await handler({ query, user: { id: empleadoId, empresaId: 1 } }, res);
  return res.body.map((s) => Number(s.id));
}

test("un servicio Maralim sale sólo en su sección y puede repetir pedidos", async () => {
  if (!handler) return;
  const { db } = M;
  const emp = Number(db.prepare(`INSERT INTO Empleados (Nombre, Apellido, Email, username, is_active, empresa_id) VALUES ('Ariel','Prueba',?,?,1,1)`)
    .run(`a${Date.now()}@x.com`, `ariel.${Date.now()}`).lastInsertRowid);
  const nuevo = (n) => Number(db.prepare(`INSERT INTO Servicios (ServicioNombre, empresa_id) VALUES (?, 1)`).run(`${n} ${Date.now()}`).lastInsertRowid);
  const comun = nuevo("SERVICIO COMUN"), maralim = nuevo("SERVICIO MARALIM");
  for (const s of [comun, maralim]) db.prepare(`INSERT INTO supervisor_services (EmpleadoID, ServicioID) VALUES (?, ?)`).run(emp, s);
  db.prepare(`INSERT INTO servicios_maralim (service_id) VALUES (?)`).run(maralim);

  assert.deepEqual(await servicios(emp), [comun], "la sección Supervisor no muestra el de Maralim");
  assert.deepEqual(await servicios(emp, { seccion: "maralim" }), [maralim], "la de Maralim muestra sólo ese");
  assert.ok(M.idsServiciosConRepetir(1).has(maralim), "puede repetir pedidos");
  assert.ok(!M.idsServiciosConRepetir(1).has(comun));
});
