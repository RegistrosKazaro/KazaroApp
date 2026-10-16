// Traer de Flexxus los códigos de barra de los insumos.
//
// Lo que se prueba acá es sobre todo lo que NO tiene que pasar: pisar un
// código cargado a mano, dejar el mismo código en dos insumos, o escribir algo
// por fuera de la empresa. Es una carga masiva sobre el catálogo entero, así
// que un error se multiplica por 429.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = path.join(os.tmpdir(), `kz_cb_${Date.now()}.db`);
const origen = path.resolve(import.meta.dirname, "../Kazaro.db");
let db = null, cb = null;

before(async () => {
  cb = await import("../src/integrations/flexxusCodigosBarra.js");
  if (!fs.existsSync(origen)) return;
  fs.copyFileSync(origen, tmp);
  process.env.DB_PATH = tmp;
  ({ db } = await import("../src/db.js"));
});

after(() => {
  for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + ext); } catch {} }
});

const sinBase = () => !db;
const R = () => cb.RESULTADOS;
const mapa = (o) => new Map(Object.entries(o));
const resultadoDe = (plan, productId) => plan.filas.find((f) => f.productId === productId)?.resultado;

/* ============ Leer lo que contesta Flexxus ============ */

test("entiende las formas en que Flexxus puede devolver los codigos", () => {
  assert.deepEqual(cb.leerCodigos(["7790001234567"]), ["7790001234567"]);
  assert.deepEqual(cb.leerCodigos({ data: [{ codigobarra: "7790001234567" }] }), ["7790001234567"]);
  assert.deepEqual(cb.leerCodigos({ codigosbarra: [{ codigoBarra: "7790001234567" }] }), ["7790001234567"]);
  assert.deepEqual(cb.leerCodigos({ items: [{ ean: "7790001234567" }] }), ["7790001234567"]);
});

test("descarta la basura que suelen tener esos campos", () => {
  // Pasa de verdad: campos con guiones sueltos, espacios o un '0' de relleno.
  assert.deepEqual(cb.leerCodigos(["", "  ", "---", "0", "ab", null, undefined]), []);
  assert.deepEqual(cb.leerCodigos(["  7790001234567  "]), ["7790001234567"]);
  assert.deepEqual(cb.leerCodigos(["779000123", "779000123"]), ["779000123"], "sin repetidos");
});

test("sin respuesta util no se rompe", () => {
  for (const x of [null, undefined, {}, "", 0, { data: null }]) {
    assert.deepEqual(cb.leerCodigos(x), []);
  }
});

/* ============ El plan ============ */

const INSUMOS = [
  { productId: 1, code: "004",  nombre: "BOLSA NEGRA",     codigoBarra: null },
  { productId: 2, code: "1788", nombre: "DES RASTOP",      codigoBarra: null },
  { productId: 3, code: "036",  nombre: "GUANTE ALGODON",  codigoBarra: "7790000000001" },
  { productId: 4, code: null,   nombre: "SIN CODIGO",      codigoBarra: null },
  { productId: 5, code: "999",  nombre: "NO ESTA EN FLEX", codigoBarra: null },
];

test("carga el codigo del insumo que no tiene, cruzando 004 con 4", () => {
  // Flexxus manda los codigos sin los ceros de adelante.
  const plan = cb.planificar(INSUMOS, mapa({ "4": ["7790001111111"], "1788": ["7790002222222"] }));
  assert.equal(resultadoDe(plan, 1), R().SE_CARGA);
  assert.equal(plan.filas.find((f) => f.productId === 1).codigoBarraNuevo, "7790001111111");
  assert.equal(plan.resumen.seCargan, 2);
});

test("NO pisa el que ya estaba cargado a mano", () => {
  // El que escaneó el envase real sabe mas que el ERP.
  const plan = cb.planificar(INSUMOS, mapa({ "36": ["7790009999999"] }));
  assert.equal(resultadoDe(plan, 3), R().YA_TENIA);
  assert.equal(plan.filas.find((f) => f.productId === 3).codigoBarraNuevo, null);
});

test("el insumo sin codigo interno no tiene por donde cruzarse", () => {
  const plan = cb.planificar(INSUMOS, mapa({ "4": ["7790001111111"] }));
  assert.equal(resultadoDe(plan, 4), R().SIN_CODIGO);
});

test("distingue 'no esta en Flexxus' de 'esta pero sin codigo de barras'", () => {
  // Son dos problemas distintos: uno se arregla en Flexxus dando de alta el
  // articulo, el otro cargandole el codigo de barras.
  const plan = cb.planificar(INSUMOS, mapa({ "4": [] }));
  assert.equal(resultadoDe(plan, 1), R().FLEXXUS_VACIO);
  assert.equal(resultadoDe(plan, 5), R().NO_ESTA);
});

test("si un articulo trae varios codigos, toma uno e informa el resto", () => {
  const plan = cb.planificar(INSUMOS, mapa({ "4": ["7790001111111", "7790003333333"] }));
  const f = plan.filas.find((x) => x.productId === 1);
  assert.equal(f.codigoBarraNuevo, "7790001111111");
  assert.deepEqual(f.otros, ["7790003333333"], "el de la caja tiene que quedar a la vista");
});

test("no le pone a un insumo el codigo que ya tiene otro", () => {
  // Chocaria contra el indice unico y cortaria la carga a la mitad.
  const plan = cb.planificar(INSUMOS, mapa({ "4": ["7790000000001"] }));
  const f = plan.filas.find((x) => x.productId === 1);
  assert.equal(f.resultado, R().REPETIDO);
  assert.equal(f.duenio.nombre, "GUANTE ALGODON", "tiene que decir quien lo tiene");
});

test("tampoco se lo pone a dos insumos en la misma corrida", () => {
  const plan = cb.planificar(INSUMOS, mapa({ "4": ["7790005555555"], "1788": ["7790005555555"] }));
  const cargados = plan.filas.filter((f) => f.resultado === R().SE_CARGA);
  assert.equal(cargados.length, 1, "solo uno se lo puede llevar");
  assert.equal(plan.resumen.repetidos, 1);
});

test("si el articulo trae un repetido y uno libre, usa el libre", () => {
  const plan = cb.planificar(INSUMOS, mapa({ "4": ["7790000000001", "7790007777777"] }));
  const f = plan.filas.find((x) => x.productId === 1);
  assert.equal(f.resultado, R().SE_CARGA);
  assert.equal(f.codigoBarraNuevo, "7790007777777");
});

test("el resumen cierra con las filas", () => {
  const plan = cb.planificar(INSUMOS, mapa({ "4": ["7790001111111"] }));
  const r = plan.resumen;
  assert.equal(r.total, INSUMOS.length);
  assert.equal(r.seCargan + r.yaTenian + r.sinCodigo + r.noEstan + r.flexxusVacio + r.repetidos, r.total);
});

test("sin nada de Flexxus, el plan no carga nada y no se rompe", () => {
  const plan = cb.planificar(INSUMOS, new Map());
  assert.equal(plan.resumen.seCargan, 0);
  // De los 5: uno ya tenía código, otro no tiene código interno con que cruzar,
  // y los otros tres quedan como "no están en Flexxus".
  assert.equal(plan.resumen.noEstan, 3);
  assert.equal(plan.resumen.yaTenian, 1);
  assert.equal(plan.resumen.sinCodigo, 1);
});

/* ============ Escribir ============ */

function insumo(nombre, code, codigoBarra = null, empresaId = 1) {
  return Number(db.prepare(
    `INSERT INTO Productos (ProductName, Precio, Stock, empresa_id, is_active, Code, codigo_barra)
     VALUES (?, 100, 10, ?, 1, ?, ?)`
  ).run(nombre, empresaId, code, codigoBarra).lastInsertRowid);
}
const barraDe = (id) =>
  db.prepare(`SELECT codigo_barra b FROM Productos WHERE ProductID = ?`).get(id).b;

test("aplicar escribe solo lo que el plan marco para cargar", () => {
  if (sinBase()) return;
  const a = insumo(`CB A ${Date.now()}`, `CBA${Date.now()}`.slice(0, 14));
  const b = insumo(`CB B ${Date.now()}`, `CBB${Date.now()}`.slice(0, 14), "7790008888888");

  const plan = {
    filas: [
      { productId: a, nombre: "CB A", resultado: cb.RESULTADOS.SE_CARGA, codigoBarraNuevo: "7790001010101" },
      { productId: b, nombre: "CB B", resultado: cb.RESULTADOS.YA_TENIA, codigoBarraNuevo: null },
    ],
  };
  const r = cb.aplicar(db, plan, { empresaId: 1 });
  assert.equal(r.escritos, 1);
  assert.equal(barraDe(a), "7790001010101");
  assert.equal(barraDe(b), "7790008888888", "el que ya tenia no se toco");
});

test("aplicar no pisa aunque el plan diga que esta vacio", () => {
  if (sinBase()) return;
  // Entre que se vio el plan y se apreto el boton alguien pudo cargarlo.
  const id = insumo(`CB C ${Date.now()}`, `CBC${Date.now()}`.slice(0, 14), "7790004040404");
  const plan = { filas: [{ productId: id, nombre: "CB C", resultado: cb.RESULTADOS.SE_CARGA, codigoBarraNuevo: "7790005050505" }] };

  const r = cb.aplicar(db, plan, { empresaId: 1 });
  assert.equal(r.escritos, 0);
  assert.equal(barraDe(id), "7790004040404", "el de a mano gana");
  assert.equal(r.ok, false, "y se informa");
});

test("no escribe sobre un insumo de otra empresa", () => {
  if (sinBase()) return;
  const id = insumo(`CB D ${Date.now()}`, `CBD${Date.now()}`.slice(0, 14), null, 2);
  const plan = { filas: [{ productId: id, nombre: "CB D", resultado: cb.RESULTADOS.SE_CARGA, codigoBarraNuevo: "7790006060606" }] };

  cb.aplicar(db, plan, { empresaId: 1 });
  assert.equal(barraDe(id), null);
});

test("un plan vacio no hace nada", () => {
  if (sinBase()) return;
  assert.deepEqual(cb.aplicar(db, { filas: [] }, { empresaId: 1 }), { ok: true, escritos: 0, errores: [] });
  assert.deepEqual(cb.aplicar(db, null, { empresaId: 1 }), { ok: true, escritos: 0, errores: [] });
});

/* ============ Hablar con Flexxus ============ */

test("pide una sola vez por codigo, aunque se repita entre insumos", async () => {
  const pedidos = [];
  const cliente = { codigosBarra: async (k) => { pedidos.push(k); return ["779000" + k]; } };
  const insumos = [
    { productId: 1, code: "004" }, { productId: 2, code: "4" }, { productId: 3, code: "1788" },
  ];
  const { porCodigo } = await cb.traerDeFlexxus(cliente, insumos, { pausaMs: 0 });
  assert.deepEqual(pedidos, ["4", "1788"], "004 y 4 son el mismo articulo");
  assert.equal(porCodigo.size, 2);
});

test("un articulo que no esta en Flexxus no es un fallo", async () => {
  const cliente = {
    codigosBarra: async (k) => {
      if (k === "999") { const e = new Error("no existe"); e.status = 404; throw e; }
      return ["7790001234567"];
    },
  };
  const { porCodigo, fallados } = await cb.traerDeFlexxus(
    cliente, [{ code: "004" }, { code: "999" }], { pausaMs: 0 });
  assert.equal(fallados.length, 0, "un 404 es informacion, no un error");
  assert.equal(porCodigo.has("999"), false);
  assert.equal(porCodigo.get("4").length, 1);
});

test("un articulo que falla no voltea la corrida entera", async () => {
  const cliente = {
    codigosBarra: async (k) => {
      if (k === "4") throw new Error("se cayo el ERP");
      return ["7790001234567"];
    },
  };
  const { porCodigo, fallados } = await cb.traerDeFlexxus(
    cliente, [{ code: "004" }, { code: "1788" }], { pausaMs: 0 });
  assert.equal(fallados.length, 1);
  assert.equal(fallados[0].codigo, "4");
  assert.equal(porCodigo.get("1788").length, 1, "el otro se trajo igual");
});

test("los insumos sin codigo no generan llamadas al ERP", async () => {
  let llamadas = 0;
  const cliente = { codigosBarra: async () => { llamadas += 1; return []; } };
  await cb.traerDeFlexxus(cliente, [{ code: null }, { code: "" }, { code: "   " }], { pausaMs: 0 });
  assert.equal(llamadas, 0);
});
