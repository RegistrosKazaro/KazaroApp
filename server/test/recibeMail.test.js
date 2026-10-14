// ¿A quién se le manda el aviso de "listo para retirar"?
//
// En Pazar los mails de los usuarios son ficticios: tienen formato válido pero
// no son casillas reales, así que mandarles rebotaría. Por eso Pazar no recibe.
//
// El problema era que el bloqueo iba por empresa entera, y se comía también a
// los que SÍ tienen casilla: German Marín cerró 19 pedidos en Pazar y no
// recibió un solo aviso. Desde el 11/08/2026, 220 pedidos de Pazar se marcaron
// listos sin avisarle a nadie.
//
// Ahora la excepción es por usuario (Empleados.recibe_mail).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Una COPIA de la base de desarrollo: importar las rutas carga db.js, y no
// queremos que toque la base real.
const tmp = path.join(os.tmpdir(), `kz_mail_${Date.now()}.db`);
const origen = path.resolve(import.meta.dirname, "../Kazaro.db");
if (fs.existsSync(origen)) {
  fs.copyFileSync(origen, tmp);
  process.env.DB_PATH = tmp;
}

const { debeRecibirMail } = await import("../src/routes/deposito.js");
const adminRouter = (await import("../src/routes/admin.js")).default;
const { db } = await import("../src/db.js");

after(() => {
  for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + ext); } catch {} }
});

const sinBase = () => !fs.existsSync(origen);

function handler(metodo, ruta) {
  const capa = adminRouter.stack.find((l) => l.route?.path === ruta && l.route.methods[metodo]);
  return capa.route.stack.at(-1).handle;
}

const llamar = (metodo, ruta, { params = {}, body = {}, empresaId = 1 } = {}) =>
  new Promise((resolve) => {
    const req = { params, body, query: {}, user: { empresaId, role: "admin", id: 1 } };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(d) { resolve({ status: this.statusCode, body: d }); },
    };
    Promise.resolve(handler(metodo, ruta)(req, res)).catch((e) => resolve({ status: 500, body: { error: e.message } }));
  });

const crearEmpleado = (empresaId) => Number(db.prepare(
  `INSERT INTO Empleados (Nombre, Apellido, Email, username, is_active, empresa_id)
   VALUES ('Prueba','Mail',?,?,1,?)`
).run(`p${Date.now()}@x.com`, `prueba.mail.${Math.random().toString(36).slice(2,8)}`, empresaId).lastInsertRowid);

const leer = (id) => db.prepare(`SELECT recibe_mail FROM Empleados WHERE EmpleadosID = ?`).get(id)?.recibe_mail;

test("Kazaro recibe, como siempre", () => {
  assert.equal(debeRecibirMail({ empresaId: 1 }), true);
  assert.equal(debeRecibirMail({ empresaId: 1, recibeMail: null }), true);
});

test("Pazar no recibe por defecto: sus mails son ficticios", () => {
  assert.equal(debeRecibirMail({ empresaId: 2 }), false);
  assert.equal(debeRecibirMail({ empresaId: 2, recibeMail: null }), false);
});

test("un usuario de Pazar con casilla real SÍ recibe", () => {
  // El caso de German Marín.
  assert.equal(debeRecibirMail({ empresaId: 2, recibeMail: 1 }), true);
});

test("y uno de Kazaro se puede apagar", () => {
  assert.equal(debeRecibirMail({ empresaId: 1, recibeMail: 0 }), false);
});

test("acepta booleanos, no sólo 1 y 0", () => {
  assert.equal(debeRecibirMail({ empresaId: 2, recibeMail: true }), true);
  assert.equal(debeRecibirMail({ empresaId: 1, recibeMail: false }), false);
});

test("sin empresa conocida, se manda: es el caso de Kazaro", () => {
  assert.equal(debeRecibirMail({}), true);
  assert.equal(debeRecibirMail({ empresaId: null }), true);
});

test("la empresa viene como texto desde la base y tiene que funcionar igual", () => {
  assert.equal(debeRecibirMail({ empresaId: "2" }), false);
  assert.equal(debeRecibirMail({ empresaId: "1" }), true);
});

/* --- La excepción se puede poner y sacar desde el panel de empleados --- */

test("se puede prender la excepcion para un usuario de Pazar", async () => {
  if (sinBase()) return;
  const id = crearEmpleado(2);
  assert.equal(leer(id), null, "arranca sin excepcion");

  const r = await llamar("put", "/employees/:id", {
    empresaId: 2,
    params: { id: String(id) },
    body: { nombre: "Prueba", apellido: "Mail", email: `u${id}@prueba.local`, username: `u${id}`,
            rolIds: [4], recibeMail: true },
  });
  assert.equal(r.status, 200);
  assert.equal(leer(id), 1);
});

test("y se puede volver atras", async () => {
  if (sinBase()) return;
  const id = crearEmpleado(2);
  const cuerpo = (recibeMail) => ({
    empresaId: 2,
    params: { id: String(id) },
    body: { nombre: "Prueba", apellido: "Mail", email: `u${id}@prueba.local`, username: `u${id}`, rolIds: [4], recibeMail },
  });
  await llamar("put", "/employees/:id", cuerpo(true));
  assert.equal(leer(id), 1);
  await llamar("put", "/employees/:id", cuerpo(null));
  assert.equal(leer(id), null, "vuelve a lo que corresponda a su empresa");
});

test("si el pedido no la menciona, la excepcion NO se pisa", async () => {
  if (sinBase()) return;
  // Es lo que pasa al guardar desde una pantalla que no conoce el campo.
  const id = crearEmpleado(2);
  await llamar("put", "/employees/:id", {
    empresaId: 2,
    params: { id: String(id) },
    body: { nombre: "Prueba", apellido: "Mail", email: `u${id}@prueba.local`, username: `u${id}`, rolIds: [4], recibeMail: true },
  });
  await llamar("put", "/employees/:id", {
    empresaId: 2,
    params: { id: String(id) },
    body: { nombre: "Prueba", apellido: "Mail", email: `u${id}@prueba.local`, username: `u${id}`, rolIds: [4] },
  });
  assert.equal(leer(id), 1, "seguia prendida");
});

test("el listado devuelve la excepcion para poder mostrarla", async () => {
  if (sinBase()) return;
  const id = crearEmpleado(2);
  await llamar("put", "/employees/:id", {
    empresaId: 2,
    params: { id: String(id) },
    body: { nombre: "Prueba", apellido: "Mail", email: `u${id}@prueba.local`, username: `u${id}`, rolIds: [4], recibeMail: true },
  });
  const r = await llamar("get", "/employees", { empresaId: 2 });
  const emp = r.body.employees.find((e) => e.id === id);
  assert.equal(emp.recibeMail, true);
});
