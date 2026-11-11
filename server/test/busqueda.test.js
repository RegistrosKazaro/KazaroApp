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

test("sinAcentosSql: encuentra nombres en mayúscula con Ñ y tilde, corriéndolo en SQLite", async () => {
  // El test de arriba sólo miraba el texto del SQL y no lo ejecutaba. El LOWER
  // de SQLite no baja la Ñ ni las vocales con tilde: "PAÑO" quedaba "paÑo" y
  // buscar "paño" no lo encontraba. Los insumos están cargados en mayúscula.
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(":memory:");
  const encuentra = (nombre, busco) =>
    db.prepare(`SELECT ${sinAcentosSql("?")} LIKE ? AS ok`).get(nombre, `%${normalizarBusqueda(busco)}%`).ok === 1;

  assert.ok(encuentra("PAÑO ELITE MAXWIPE", "paño"));
  assert.ok(encuentra("PAÑO ELITE MAXWIPE", "pano"));
  assert.ok(encuentra("BALDE ALBAÑIL", "albañil"));
  assert.ok(encuentra("GUANTE ALGODÓN MOTEADO", "algodon"));
  assert.ok(encuentra("CARTEL SEÑAL PISO HUMEDO", "SEÑAL"));
  assert.ok(!encuentra("BALDE ALBAÑIL", "escoba"), "y lo que no está, no aparece");
  db.close();
});
