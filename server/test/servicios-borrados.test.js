// server/test/servicios-borrados.test.js
//
// Al eliminar un servicio hay que sacarlo del supervisor que lo tenía asignado.
// Se arma una base chica en memoria con las mismas consultas de db.js /
// routes/admin.js, incluyendo el caso de los ServiciosID guardados como REAL
// (904.0), que es donde fallaba el CAST(... AS TEXT).
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import Database from "better-sqlite3";

let db;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE Servicios (
      ServiciosID     NUMERIC PRIMARY KEY,
      ServicioNombre  TEXT,
      empresa_id      INTEGER,
      deleted_at      TEXT
    );
    CREATE TABLE supervisor_services (
      EmpleadoID INTEGER NOT NULL,
      ServicioID NUMERIC NOT NULL
    );
  `);
  db.prepare(`INSERT INTO Servicios VALUES (?,?,?,?)`).run(36, "SERVICIO DE PRUEBA", 1, null);
  db.prepare(`INSERT INTO Servicios VALUES (?,?,?,?)`).run(904.0, "SERVICIO DE PAZAR", 2, null);
  db.prepare(`INSERT INTO supervisor_services VALUES (?,?)`).run(31, 36);
  db.prepare(`INSERT INTO supervisor_services VALUES (?,?)`).run(31, 904.0);
});

// Espejo de desasignarServicio() en db.js
function desasignarServicio(servicioId) {
  const num = Number(servicioId);
  const r = Number.isFinite(num)
    ? db.prepare(`DELETE FROM supervisor_services WHERE CAST(ServicioID AS INTEGER) = ?`).run(Math.trunc(num))
    : db.prepare(`DELETE FROM supervisor_services WHERE CAST(ServicioID AS TEXT) = CAST(? AS TEXT)`).run(String(servicioId));
  return r.changes || 0;
}

// Espejo de limpiarAsignacionesDeServiciosBorrados() en db.js
function limpiarAsignacionesDeServiciosBorrados() {
  return db.prepare(`
    DELETE FROM supervisor_services
    WHERE EXISTS (
      SELECT 1 FROM Servicios s
      WHERE CAST(s.ServiciosID AS INTEGER) = CAST(supervisor_services.ServicioID AS INTEGER)
        AND s.deleted_at IS NOT NULL
    )
  `).run().changes || 0;
}

// Espejo de listAssignedServicesFor() (rama con asignación) en supervisor.js
function serviciosDelSupervisor(empleadoId) {
  return db.prepare(`
    SELECT s.ServiciosID AS id, s.ServicioNombre AS name
    FROM supervisor_services a
    JOIN Servicios s ON CAST(s.ServiciosID AS TEXT) = CAST(a.ServicioID AS TEXT)
    WHERE CAST(a.EmpleadoID AS TEXT) = CAST(? AS TEXT)
    AND s.deleted_at IS NULL
  `).all(String(empleadoId)).map((r) => r.name);
}

// El id llega como texto desde la ruta (req.params): si se pasara como número,
// better-sqlite3 lo ata como REAL y CAST(? AS TEXT) daría "36.0".
const borrar = (id) => db.prepare(`UPDATE Servicios SET deleted_at = datetime('now') WHERE CAST(ServiciosID AS TEXT) = CAST(? AS TEXT)`).run(String(id));

test("eliminar un servicio lo saca del supervisor que lo tenía", () => {
  assert.equal(desasignarServicio(36), 1);
  assert.deepEqual(db.prepare(`SELECT ServicioID FROM supervisor_services`).all().map((r) => Number(r.ServicioID)), [904]);
});

test("también desasigna los ServiciosID guardados como 904.0", () => {
  assert.equal(desasignarServicio(904), 1);
  assert.deepEqual(db.prepare(`SELECT ServicioID FROM supervisor_services`).all().map((r) => Number(r.ServicioID)), [36]);
});

test("desasignar un servicio que no está asignado no rompe ni borra de más", () => {
  assert.equal(desasignarServicio(9999), 0);
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM supervisor_services`).get().c, 2);
});

test("un servicio eliminado deja de aparecerle al supervisor aunque quede la asignación vieja", () => {
  borrar(36);
  assert.deepEqual(serviciosDelSupervisor(31), ["SERVICIO DE PAZAR"]);
});

test("la limpieza borra las asignaciones de servicios ya eliminados y deja las vivas", () => {
  borrar(36);
  assert.equal(limpiarAsignacionesDeServiciosBorrados(), 1);
  assert.deepEqual(db.prepare(`SELECT ServicioID FROM supervisor_services`).all().map((r) => Number(r.ServicioID)), [904]);
  assert.equal(limpiarAsignacionesDeServiciosBorrados(), 0);   // idempotente
});
