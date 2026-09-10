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

test("presupuesto y mails no se toman: se informan como ignorados", () => {
  const alta = ["externoId", "empresa", "nombre", "direccion", "ciudad", "supervisor"];
  assert.deepEqual(
    camposIgnorados({ externoId: "A", empresa: 1, nombre: "X", supervisor: "Y", presupuesto: 10, emails: [] }, alta),
    ["presupuesto", "emails"]);
  assert.deepEqual(camposIgnorados({ externoId: "A", empresa: 1, nombre: "X", ciudad: "Cba" }, alta), []);
  assert.deepEqual(camposIgnorados({ nombre: "Y", presupuesto: 1 }, ["nombre", "empresa"]), ["presupuesto"]);
});

// ── Coincidencia del supervisor por nombre ──
function palabrasNombre(s) {
  return String(s ?? "")
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/).filter(Boolean);
}
function buscarSupervisor(nombre360, supervisores) {
  const del360 = new Set(palabrasNombre(nombre360));
  if (!del360.size) return { tipo: "ninguno", coincidencias: [] };
  const coincidencias = supervisores.filter((s) => {
    const apellido = palabrasNombre(s.Apellido);
    const nombres = palabrasNombre(s.Nombre);
    return apellido.length > 0 && nombres.length > 0
      && apellido.every((p) => del360.has(p))
      && nombres.some((p) => del360.has(p));
  });
  if (coincidencias.length === 1) return { tipo: "unico", coincidencias };
  return { tipo: coincidencias.length ? "varios" : "ninguno", coincidencias };
}
const SUPS = [
  { id: 33, Nombre: "Eugenia", Apellido: "Alvarez" },
  { id: 31, Nombre: "Nicolas", Apellido: "Barcena" },
  { id: 19, Nombre: "Nicolas", Apellido: "Bustos" },
  { id: 59, Nombre: "Juan Domingo", Apellido: "Murua" },
];
const idDe = (n) => {
  const r = buscarSupervisor(n, SUPS);
  return r.tipo === "unico" ? r.coincidencias[0].id : r.tipo;
};

test("encuentra al supervisor aunque 360 lo mande como en el DNI", () => {
  assert.equal(idDe("ALVAREZ, MARIA EUGENIA"), 33);   // con segundo nombre y coma
  assert.equal(idDe("Barcena Nicolas"), 31);          // al revés
  assert.equal(idDe("Juan Murua"), 59);               // sin el segundo nombre
  assert.equal(idDe("MURUA JUAN DOMINGO"), 59);
  assert.equal(idDe("Nicolás Bárcena"), 31);          // con acentos
});

test("sin apellido, sin coincidencia o con dos coincidencias no asigna", () => {
  assert.equal(idDe("Nicolas"), "ninguno");                 // falta el apellido
  assert.equal(idDe("Juan Perez"), "ninguno");
  assert.equal(idDe("Alvarez"), "ninguno");                 // falta el nombre
  assert.equal(idDe("Nicolas Barcena Bustos"), "varios");   // coincide con dos
  assert.equal(idDe(""), "ninguno");
});

test("una empresa desactivada no se acepta", () => {
  const conInactiva = [...EMPRESAS, { EmpresaID: 3, slug: "vieja", nombre: "Vieja", is_active: 0 }];
  assert.equal(resolverEmpresa("vieja", conInactiva), null);
});
