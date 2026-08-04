import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCode, buildSyncReport } from "../src/integrations/flexxusCore.js";

test("normalizeCode: saca ceros a la izquierda en numéricos", () => {
  assert.equal(normalizeCode("004"), "4");
  assert.equal(normalizeCode("4"), "4");
  assert.equal(normalizeCode("100000231"), "100000231");
  assert.equal(normalizeCode("000"), "0");
  assert.equal(normalizeCode(4), "4");
});

test("normalizeCode: no numéricos y vacíos", () => {
  assert.equal(normalizeCode("  ab-12 "), "AB-12");
  assert.equal(normalizeCode(""), "");
  assert.equal(normalizeCode(null), "");
});

test("buildSyncReport: matchea 004(flexxus) con 4(app) y calcula diff", () => {
  const app = [{ productId: 10, code: "4", name: "Bolsa", stock: 100, categoriaId: 3 }];
  const flexxus = [{ code: "004", name: "Bolsa negra", stock: 120, subdeposito: "Limpieza" }];
  const r = buildSyncReport(app, flexxus);
  assert.equal(r.matched.length, 1);
  assert.equal(r.matched[0].productId, 10);
  assert.equal(r.matched[0].diff, 20);
  assert.equal(r.resumen.conCambioStock, 1);
  assert.equal(r.soloEnApp.length, 0);
  assert.equal(r.soloEnFlexxus.length, 0);
});

test("buildSyncReport: clasifica solo-en-app y solo-en-flexxus", () => {
  const app = [{ productId: 1, code: "10", name: "A", stock: 5 }];
  const flexxus = [{ code: "20", name: "B", stock: 8, subdeposito: "X" }];
  const r = buildSyncReport(app, flexxus);
  assert.equal(r.matched.length, 0);
  assert.equal(r.soloEnApp.length, 1);
  assert.equal(r.soloEnFlexxus.length, 1);
});

test("buildSyncReport: detecta colisiones en la app tras normalizar", () => {
  const app = [
    { productId: 1, code: "4", name: "A", stock: 1 },
    { productId: 2, code: "004", name: "B", stock: 2 },
  ];
  const r = buildSyncReport(app, []);
  assert.equal(r.colisionesApp.length, 1);
});
