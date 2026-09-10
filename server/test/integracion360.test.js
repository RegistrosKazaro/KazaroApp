// server/test/integracion360.test.js
//
// Reglas de validación del alta de servicios desde 360. Se replican acá (igual
// que business-logic.test.js) para no tener que abrir la base en los tests:
// importar integracion360.js arrastra db.js. Si cambian en
// routes/integracion360.js, actualizar acá también.
import assert from "node:assert/strict";
import { test } from "node:test";

const EMPRESAS = [
  { EmpresaID: 1, slug: "kazaro", nombre: "Kazaro", is_active: 1 },
  { EmpresaID: 2, slug: "pazar", nombre: "Pazar", is_active: 1 },
];

function normalizarNombre(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function resolverEmpresa(valor, empresas) {
  if (valor == null) return null;
  const v = String(valor).trim().toLowerCase();
  if (!v) return null;
  const e = empresas.find((x) =>
    String(x.EmpresaID) === v
    || String(x.slug || "").toLowerCase() === v
    || String(x.nombre || "").toLowerCase() === v);
  return e && Number(e.is_active ?? 1) === 1 ? e : null;
}

test("normalizarNombre saca espacios de más", () => {
  assert.equal(normalizarNombre("  SUPER   MAMI  7 "), "SUPER MAMI 7");
  assert.equal(normalizarNombre(null), "");
});

test("la empresa se acepta por id, slug o nombre, sin importar mayúsculas", () => {
  assert.equal(resolverEmpresa(1, EMPRESAS).EmpresaID, 1);
  assert.equal(resolverEmpresa("2", EMPRESAS).EmpresaID, 2);
  assert.equal(resolverEmpresa("KAZARO", EMPRESAS).EmpresaID, 1);
  assert.equal(resolverEmpresa(" Pazar ", EMPRESAS).EmpresaID, 2);
});

test("nunca hay empresa por defecto: vacía o desconocida da null", () => {
  assert.equal(resolverEmpresa(undefined, EMPRESAS), null);
  assert.equal(resolverEmpresa("", EMPRESAS), null);
  assert.equal(resolverEmpresa("ambas", EMPRESAS), null);
  assert.equal(resolverEmpresa(3, EMPRESAS), null);
});

function camposIgnorados(body, permitidos) {
  if (!body || typeof body !== "object") return [];
  return Object.keys(body).filter((k) => !permitidos.includes(k));
}

test("supervisor, presupuesto y mails no se toman: se informan como ignorados", () => {
  const alta = ["externoId", "empresa", "nombre", "direccion", "ciudad"];
  assert.deepEqual(
    camposIgnorados({ externoId: "A", empresa: 1, nombre: "X", supervisor: 5, presupuesto: 10, emails: [] }, alta),
    ["supervisor", "presupuesto", "emails"]);
  assert.deepEqual(camposIgnorados({ externoId: "A", empresa: 1, nombre: "X", ciudad: "Cba" }, alta), []);
  assert.deepEqual(camposIgnorados({ nombre: "Y", presupuesto: 1 }, ["nombre", "empresa"]), ["presupuesto"]);
});

test("una empresa desactivada no se acepta", () => {
  const conInactiva = [...EMPRESAS, { EmpresaID: 3, slug: "vieja", nombre: "Vieja", is_active: 0 }];
  assert.equal(resolverEmpresa("vieja", conInactiva), null);
});
