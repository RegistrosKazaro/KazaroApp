import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarBusqueda, sinAcentosSql } from "../src/utils/busqueda.js";

test("normalizarBusqueda: minúsculas y sin acentos", () => {
  assert.equal(normalizarBusqueda("Unión"), "union");
  assert.equal(normalizarBusqueda("ALGODÓN"), "algodon");
  assert.equal(normalizarBusqueda("  Peña  "), "pena");
  assert.equal(normalizarBusqueda("José Pérez"), "jose perez");
});

test("normalizarBusqueda: tolera vacío y nulos", () => {
  assert.equal(normalizarBusqueda(""), "");
  assert.equal(normalizarBusqueda(null), "");
  assert.equal(normalizarBusqueda(undefined), "");
});

test("sinAcentosSql: arma la expresión sobre la columna", () => {
  const sql = sinAcentosSql("p.Nombre");
  assert.ok(sql.includes("LOWER(COALESCE(p.Nombre,''))"));
  assert.ok(sql.includes("REPLACE"));
});
