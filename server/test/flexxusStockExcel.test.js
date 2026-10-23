// Cargar el stock desde el Excel que se exporta a mano de Flexxus.
//
// Lo que se vigila acá no es que lea bien —de eso se ocupa flexxusExcel.test.js—
// sino lo peligroso: esta ruta pisa el stock de cientos de insumos. Tiene que
// ser imposible que escriba sin que se lo pidan explícitamente, y cuando
// escriba tiene que quedar registrado de dónde venía cada número.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";

const tmp = path.join(os.tmpdir(), `kz_stockxls_${Date.now()}.db`);
const origen = path.resolve(import.meta.dirname, "../Kazaro.db");
let handler = null;
let db = null;

before(async () => {
  if (!fs.existsSync(origen)) return;
  fs.copyFileSync(origen, tmp);
  process.env.DB_PATH = tmp;
  const { default: admin } = await import("../src/routes/admin.js");
  const capa = admin.stack.find(
    (l) => l.route?.path === "/flexxus/stock/excel" && l.route.methods.post
  );
  handler = capa?.route.stack.at(-1).handle ?? null;
  ({ db } = await import("../src/db.js"));
});

after(() => {
  for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + ext); } catch {} }
});

const sinBase = () => !handler || !db;

/** Un Excel con el formato del export real: Código / Artículo / Stock. */
function excel(filas) {
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    libro,
    XLSX.utils.aoa_to_sheet([["Código", "Artículo", "Stock"], ...filas]),
    "Hoja1"
  );
  return XLSX.write(libro, { type: "buffer", bookType: "xlsx" });
}

/** Un insumo de Kazaro con el stock que se le diga. */
function insumo(code, stock) {
  const id = Number(db.prepare(
    `INSERT INTO Productos (ProductName, Precio, Stock, empresa_id, is_active, Code)
     VALUES (?, 1, ?, 1, 1, ?)`
  ).run(`XLS ${code}`, stock, code).lastInsertRowid);
  return id;
}

const stockDe = (id) => Number(db.prepare(`SELECT Stock FROM Productos WHERE ProductID = ?`).get(id).Stock);

async function llamar(buffer, query = {}) {
  const res = {
    statusCode: 200,
    status(c) { this.statusCode = c; return this; },
    json(d) { this.body = d; return this; },
  };
  await handler({ file: { buffer }, query, user: { empresaId: 1 } }, res);
  return res;
}

let seq = 0;
const codigoNuevo = () => `XLS${Date.now()}${(seq += 1)}`.slice(-14);

test("sin pedirlo, NO escribe: es solo la vista previa", async () => {
  if (sinBase()) return;
  const code = codigoNuevo();
  const id = insumo(code, 100);

  const res = await llamar(excel([[code, "ALGO", 7]]));

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.aplicado, false);
  assert.equal(res.body.aplicados, 0);
  assert.equal(stockDe(id), 100, "el stock NO se tenia que tocar");
});

test("la vista previa igual informa qué cambiaría", async () => {
  if (sinBase()) return;
  const code = codigoNuevo();
  insumo(code, 100);

  const { body } = await llamar(excel([[code, "ALGO", 7]]));
  const c = body.cambios.find((x) => x.code === code);

  assert.ok(c, "tendria que aparecer en los cambios");
  assert.equal(c.app, 100);
  assert.equal(c.flexxus, 7);
  assert.equal(c.diff, -93);
});

test("con aplicar=1 pisa el stock con el del Excel", async () => {
  if (sinBase()) return;
  const code = codigoNuevo();
  const id = insumo(code, 100);

  const { body } = await llamar(excel([[code, "ALGO", 7]]), { aplicar: "1" });

  assert.equal(body.aplicado, true);
  assert.equal(stockDe(id), 7);
});

test("al escribir guarda de dónde venía cada número", async () => {
  if (sinBase()) return;
  // Sin esto, aplicar es un camino de ida: 400 insumos pisados sin vuelta atrás.
  const code = codigoNuevo();
  insumo(code, 100);

  await llamar(excel([[code, "ALGO", 7]]), { aplicar: "1" });

  const fila = db.prepare(
    `SELECT detalle FROM flexxus_sync_log WHERE dry_run = 0 ORDER BY id DESC LIMIT 1`
  ).get();
  const anterior = JSON.parse(fila.detalle).antes.find((a) => a.code === code);

  assert.equal(anterior.antes, 100);
  assert.equal(anterior.despues, 7);
});

test("lo que el Excel no menciona no se toca", async () => {
  if (sinBase()) return;
  // Los uniformes no están en Flexxus: tienen que quedar como estaban.
  const code = codigoNuevo();
  const id = insumo(code, 55);

  await llamar(excel([[codigoNuevo(), "OTRA COSA", 1]]), { aplicar: "1" });

  assert.equal(stockDe(id), 55);
});

test("un Excel que no se entiende no escribe nada y lo explica", async () => {
  if (sinBase()) return;
  const code = codigoNuevo();
  const id = insumo(code, 100);

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([["patente", "color"], ["AAA111", "rojo"]]), "Hoja1");
  const res = await llamar(XLSX.write(libro, { type: "buffer", bookType: "xlsx" }), { aplicar: "1" });

  assert.equal(res.statusCode, 400);
  assert.ok(res.body.avisos.length > 0, "tendria que decir qué no entendió");
  assert.equal(stockDe(id), 100);
});

test("sin archivo contesta 400, no revienta", async () => {
  if (sinBase()) return;
  const res = {
    statusCode: 200,
    status(c) { this.statusCode = c; return this; },
    json(d) { this.body = d; return this; },
  };
  await handler({ query: {}, user: { empresaId: 1 } }, res);
  assert.equal(res.statusCode, 400);
});

test("la ruta está montada y pasa por el guardia de admin", async () => {
  if (sinBase()) return;
  const { default: admin } = await import("../src/routes/admin.js");
  const capa = admin.stack.find(
    (l) => l.route?.path === "/flexxus/stock/excel" && l.route.methods.post
  );
  assert.ok(capa, "la ruta tiene que existir");
  // guardia + multer + handler: si quedara sólo el handler, estaría sin proteger.
  assert.ok(capa.route.stack.length >= 3, "le falta el guardia o multer");
});
