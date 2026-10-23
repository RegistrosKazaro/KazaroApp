// El adaptador del Excel de Flexxus.
//
// Lo que importa acá no es leer un archivo lindo: es que NO invente datos
// cuando el export viene distinto. Que avise, en vez de devolver ceros.
import { test } from "node:test";
import assert from "node:assert/strict";
import XLSX from "xlsx";
import { leerExcelFlexxus } from "../src/integrations/flexxusExcel.js";

/** Arma un Excel en memoria a partir de filas sueltas. */
function excel(filas) {
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filas), "Hoja1");
  return XLSX.write(libro, { type: "buffer", bookType: "xlsx" });
}

test("lee el export y devuelve las filas que espera el motor", () => {
  const buf = excel([
    ["codigoarticulo", "descripcion", "stock", "codigodeposito"],
    ["004", "BOLSA NEGRA 80*100", 120, "001"],
    ["100000741", "DES RASTOP X 20 GR", 500, "001"],
  ]);
  const { filas, avisos } = leerExcelFlexxus(buf);
  assert.deepEqual(avisos, []);
  assert.equal(filas.length, 2);
  assert.deepEqual(filas[0], { code: "004", name: "BOLSA NEGRA 80*100", stock: 120, subdeposito: "001" });
});

test("encuentra el encabezado aunque haya titulos arriba", () => {
  const buf = excel([
    ["Listado de stock al 22/10/2026"],
    ["Codigo Articulo", "Descripcion", "Stock Real", "Deposito"],
    ["7", "LAVANDINA X 5 LTS", 10, "001"],
  ]);
  const { filas, avisos } = leerExcelFlexxus(buf);
  assert.deepEqual(avisos, []);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].code, "7");
});

test("los acentos y las mayusculas del encabezado no importan", () => {
  const buf = excel([
    ["CÓDIGO", "Descripción", "Stock"],
    ["12", "TRAPO DE PISO", 3],
  ]);
  const { filas, avisos } = leerExcelFlexxus(buf);
  assert.deepEqual(avisos, []);
  assert.equal(filas[0].name, "TRAPO DE PISO");
});

test("entiende los numeros en formato argentino", () => {
  const buf = excel([
    ["codigo", "descripcion", "stock"],
    ["1", "MIL DOSCIENTOS", "1.234"],
    ["2", "CON DECIMALES", "1.234,50"],
    ["3", "VACIO", ""],
  ]);
  const { filas } = leerExcelFlexxus(buf);
  assert.equal(filas[0].stock, 1234);
  assert.equal(filas[1].stock, 1234.5);
  assert.equal(filas[2].stock, 0);
});

test("si falta una columna avisa, en vez de devolver cualquier cosa", () => {
  // Un export sin stock no sirve para sincronizar: hay que enterarse.
  const buf = excel([
    ["codigoarticulo", "descripcion"],
    ["004", "BOLSA NEGRA"],
  ]);
  const { avisos } = leerExcelFlexxus(buf);
  assert.ok(avisos.some((a) => /stock/i.test(a)), "tendria que avisar que falta el stock");
});

test("las filas sin codigo se ignoran: son totales o cortes", () => {
  const buf = excel([
    ["codigo", "descripcion", "stock"],
    ["1", "ALGO", 5],
    ["", "TOTAL GENERAL", 999],
  ]);
  const { filas } = leerExcelFlexxus(buf);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].stock, 5);
});

test("un encabezado que no se reconoce no rompe: lo dice", () => {
  const buf = excel([["patente", "color"], ["AAA111", "rojo"]]);
  const { filas, avisos } = leerExcelFlexxus(buf);
  assert.equal(filas.length, 0);
  assert.equal(avisos.length, 1);
});