// ¿Alcanza con escribir la URL del panel de admin para entrar?
//
// No, y esto lo demuestra. El permiso NO sale de la dirección del navegador:
// sale del rol del usuario, leído de la base en cada pedido. Un supervisor que
// escriba /app/administrativo/admin ve la pantalla vacía y cada llamada que
// haga esa pantalla contesta 403.
//
// El segundo test es la red de seguridad real: barre TODAS las rutas y falla
// si alguien agrega una sin guardia. Es el único error que haría que esconder
// la URL importara.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = path.join(os.tmpdir(), `kz_perm_${Date.now()}.db`);
const origen = path.resolve(import.meta.dirname, "../Kazaro.db");
let db = null, routers = {};

before(async () => {
  if (!fs.existsSync(origen)) return;
  fs.copyFileSync(origen, tmp);
  process.env.DB_PATH = tmp;
  routers = {
    admin:    (await import("../src/routes/admin.js")).default,
    deposito: (await import("../src/routes/deposito.js")).default,
    reports:  (await import("../src/routes/reports.js")).default,
  };
  ({ db } = await import("../src/db.js"));
});

after(() => {
  for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + ext); } catch {} }
});

const sinBase = () => !db;

/** Un empleado real con los roles que se le pidan. */
function usuarioCon(roles) {
  const id = Number(db.prepare(
    `INSERT INTO Empleados (Nombre, Apellido, Email, username, is_active, empresa_id)
     VALUES ('Prueba','Permisos', ?, ?, 1, 1)`
  ).run(`p${Date.now()}${Math.random()}@x.com`, `perm.${Math.random().toString(36).slice(2, 9)}`)
   .lastInsertRowid);
  for (const r of roles) {
    const rid = db.prepare(`SELECT RolID FROM Roles WHERE Nombre = ? COLLATE NOCASE`).get(r)?.RolID;
    if (rid) db.prepare(`INSERT INTO Roles_Empleados (EmpleadoID, RolID) VALUES (?, ?)`).run(id, rid);
  }
  return id;
}

/**
 * Corre la cadena de guardias de la ruta y devuelve el status final.
 *
 * `desde = 1` saltea requireAuth, que sin cookie corta con 401 y taparía lo
 * que queremos ver: que a un usuario YA logueado, con sesión válida, el rol
 * igual lo frena. Con `desde = 0` se corre la cadena entera, que es lo que
 * pasa cuando alguien pega la URL sin estar logueado.
 */
function pedir(router, metodo, ruta, user, desde = 1) {
  const capa = router.stack.find((l) => l.route?.path === ruta && l.route.methods[metodo]);
  if (!capa) throw new Error(`no existe ${metodo} ${ruta}`);

  return new Promise((resolve) => {
    const req = { params: {}, query: {}, body: {}, headers: {}, user, method: metodo.toUpperCase() };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json() { resolve(this.statusCode); },
      send() { resolve(this.statusCode); },
      setHeader() { return this; },
    };
    let i = desde;
    const siguiente = () => {
      if (i >= capa.route.stack.length) return resolve(res.statusCode);
      const fn = capa.route.stack[i++].handle;
      try {
        const r = fn(req, res, siguiente);
        if (r && typeof r.catch === "function") r.catch(() => resolve(500));
      } catch { resolve(500); }
    };
    siguiente();
  });
}

const RUTAS_ADMIN = [
  ["get", "/products"], ["post", "/products"], ["get", "/employees"],
  ["get", "/roles"], ["get", "/products/export"],
];

test("un supervisor NO entra al panel de admin, aunque escriba la URL", async () => {
  if (sinBase()) return;
  const id = usuarioCon(["Supervisor"]);
  const user = { id, empresaId: 1, roles: ["supervisor"] };

  for (const [metodo, ruta] of RUTAS_ADMIN) {
    const status = await pedir(routers.admin, metodo, ruta, user);
    assert.equal(status, 403, `${metodo.toUpperCase()} /admin${ruta} tendria que dar 403`);
  }
});

test("el del deposito tampoco, ni el operario de picking", async () => {
  if (sinBase()) return;
  for (const roles of [["Deposito"], ["Picking"], ["Administrativo"]]) {
    const id = usuarioCon(roles);
    const user = { id, empresaId: 1, roles: roles.map((r) => r.toLowerCase()) };
    const status = await pedir(routers.admin, "get", "/employees", user);
    assert.equal(status, 403, `${roles} no tendria que entrar a /admin/employees`);
  }
});

test("sin sesion no se entra a ningun lado", async () => {
  if (sinBase()) return;
  for (const [nombre, metodo, ruta] of [
    ["admin", "get", "/products"],
    ["deposito", "get", "/orders"],
    ["deposito", "get", "/remanentes"],
    ["reports", "get", "/panel"],
  ]) {
    const status = await pedir(routers[nombre], metodo, ruta, undefined, 0);
    assert.ok(status === 401 || status === 403, `${nombre}${ruta} dio ${status}`);
  }
});

test("el admin si entra: el guardia no esta de adorno", async () => {
  if (sinBase()) return;
  // Si esto diera 403, los tests de arriba pasarian por el motivo equivocado.
  const id = usuarioCon(["Admin"]);
  const status = await pedir(routers.admin, "get", "/roles", { id, empresaId: 1, roles: ["admin"] });
  assert.equal(status, 200);
});

test("ninguna ruta quedo sin guardia", () => {
  if (sinBase()) return;
  // El día que alguien agregue una ruta y se olvide el guardia, esto falla.
  // Es el único escenario en el que esconder la URL cambiaría algo.
  const sueltas = [];
  for (const [nombre, router] of Object.entries(routers)) {
    for (const capa of router.stack) {
      if (!capa.route) continue;
      if (capa.route.stack.length < 2) {
        sueltas.push(`${nombre}: ${Object.keys(capa.route.methods)[0].toUpperCase()} ${capa.route.path}`);
      }
    }
  }
  assert.deepEqual(sueltas, [], "estas rutas no piden sesion ni rol");
});
