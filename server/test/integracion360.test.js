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

// ── Supervisor por legajo (réplica de db.js / integracion360.js) ──
function normalizarLegajo(v) {
  const s = String(v ?? "").replace(/\s+/g, "").toUpperCase();
  if (!s) return "";
  return /^\d+$/.test(s) ? (s.replace(/^0+/, "") || "0") : s;
}
function normalizarDni(v) {
  return String(v ?? "").replace(/\D/g, "");
}
function elegirPorLegajo(legajo, empleados) {
  const buscado = normalizarLegajo(legajo);
  if (!buscado) return { tipo: "ninguno", coincidencias: [] };
  const coincidencias = empleados.filter((e) => normalizarLegajo(e.legajo) === buscado);
  if (coincidencias.length === 1) return { tipo: "unico", coincidencias };
  return { tipo: coincidencias.length ? "varios" : "ninguno", coincidencias };
}
const EMPS = [
  { id: 33, legajo: "0123" },
  { id: 31, legajo: "456" },
  { id: 50, legajo: "K-77" },
];
const idDe = (l) => {
  const r = elegirPorLegajo(l, EMPS);
  return r.tipo === "unico" ? r.coincidencias[0].id : r.tipo;
};

test("el legajo se compara sin ceros a la izquierda ni espacios", () => {
  assert.equal(normalizarLegajo("00123"), "123");
  assert.equal(normalizarLegajo(" 12 3 "), "123");
  assert.equal(normalizarLegajo("k-77"), "K-77");
  assert.equal(normalizarLegajo("000"), "0");
  assert.equal(normalizarLegajo(""), "");
});

test("el DNI queda solo con números", () => {
  assert.equal(normalizarDni("30.111.222"), "30111222");
  assert.equal(normalizarDni(" 30 111 222 "), "30111222");
  assert.equal(normalizarDni(null), "");
});

test("encuentra al supervisor por legajo", () => {
  assert.equal(idDe("123"), 33);      // cargado como "0123"
  assert.equal(idDe("0123"), 33);
  assert.equal(idDe(456), 31);
  assert.equal(idDe("k-77"), 50);
});

test("legajo vacío, inexistente o repetido no asigna", () => {
  assert.equal(idDe(""), "ninguno");
  assert.equal(idDe("999"), "ninguno");
  assert.equal(elegirPorLegajo("1", [{ legajo: "1" }, { legajo: "01" }]).tipo, "varios");
});

test("una empresa desactivada no se acepta", () => {
  const conInactiva = [...EMPRESAS, { EmpresaID: 3, slug: "vieja", nombre: "Vieja", is_active: 0 }];
  assert.equal(resolverEmpresa("vieja", conInactiva), null);
});
