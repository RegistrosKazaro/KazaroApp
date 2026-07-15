// server/test/business-logic.test.js
import assert from "node:assert/strict";
import { test } from "node:test";

// ── Réplica de la lógica de detección de uniformes (orders.js) ──
// Si estas reglas cambian en orders.js, actualizar acá también.
const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

function tieneMezclaUniformes(categorias) {
  const hasUni = categorias.some((c) => norm(c) === "uniformes");
  const hasOther = categorias.some((c) => norm(c) !== "uniformes");
  return hasUni && hasOther;
}

test("norm normaliza acentos y mayúsculas", () => {
  assert.equal(norm("Uniformes"), "uniformes");
  assert.equal(norm("UNIFORMES"), "uniformes");
  assert.equal(norm("  Úniförmes  "), "uniformes");
});

test("detecta mezcla de uniformes con otra categoría", () => {
  assert.equal(tieneMezclaUniformes(["Uniformes", "Limpieza"]), true);
  assert.equal(tieneMezclaUniformes(["Limpieza", "UNIFORMES"]), true);
});

test("NO marca mezcla si son todos uniformes", () => {
  assert.equal(tieneMezclaUniformes(["Uniformes", "Uniformes"]), false);
});

test("NO marca mezcla si no hay uniformes", () => {
  assert.equal(tieneMezclaUniformes(["Limpieza", "Bazar"]), false);
});

test("un solo producto nunca es mezcla", () => {
  assert.equal(tieneMezclaUniformes(["Uniformes"]), false);
  assert.equal(tieneMezclaUniformes(["Limpieza"]), false);
});

// ── Cálculo de límite de presupuesto (orders.js) ──
function maxTotalPermitido(budget, pct) {
  if (!(budget > 0)) return null;
  if (!Number.isFinite(pct) || pct <= 0) return null;
  return (budget * pct) / 100;
}

test("calcula el límite del presupuesto correctamente", () => {
  assert.equal(maxTotalPermitido(10000, 80), 8000);
  assert.equal(maxTotalPermitido(5000, 100), 5000);
});

test("sin presupuesto o pct inválido devuelve null", () => {
  assert.equal(maxTotalPermitido(0, 80), null);
  assert.equal(maxTotalPermitido(10000, 0), null);
  assert.equal(maxTotalPermitido(10000, NaN), null);
});

// ── Validación de devoluciones (returns) ──
function puedeDevolver(pedido, yaDevuelto, cantidad) {
  const disponible = Number(pedido) - Number(yaDevuelto);
  return cantidad > 0 && cantidad <= disponible;
}

test("permite devolver hasta lo disponible", () => {
  assert.equal(puedeDevolver(10, 0, 10), true);
  assert.equal(puedeDevolver(10, 3, 7), true);
});

test("rechaza devolver más de lo disponible", () => {
  assert.equal(puedeDevolver(10, 5, 6), false);
  assert.equal(puedeDevolver(10, 10, 1), false);
});

test("rechaza cantidad cero o negativa", () => {
  assert.equal(puedeDevolver(10, 0, 0), false);
  assert.equal(puedeDevolver(10, 0, -2), false);
});