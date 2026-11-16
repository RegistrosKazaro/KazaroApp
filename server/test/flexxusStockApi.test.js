// Leer el stock del depósito central desde la API de Flexxus (16/11/2026).
// Lo que se vigila: que recorra todas las páginas (`offset` es el número de
// página, no la posición) y que tome el código y el stock correctos.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = path.join(os.tmpdir(), `kz_stockapi_${Date.now()}.db`);
const origen = path.resolve(import.meta.dirname, "../Kazaro.db");
let traer = null;

before(async () => {
  if (!fs.existsSync(origen)) return;
  fs.copyFileSync(origen, tmp);
  process.env.DB_PATH = tmp;
  ({ traerStockDeFlexxus: traer } = await import("../src/integrations/flexxus.js"));
});

after(() => {
  for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + ext); } catch {} }
});

const fila = (i) => ({ CODIGOARTICULO: `9${i}`, CODIGOPARTICULAR: ` ${i} `, STOCKREAL: i, STOCKDISPONIBLE: 999 });

test("recorre las páginas y usa CODIGOPARTICULAR y STOCKREAL", async () => {
  if (!traer) return;
  const total = 2500;
  const rutas = [];
  const cliente = {
    llamar: async (ruta) => {
      rutas.push(ruta);
      const pagina = Number(new URLSearchParams(ruta.split("?")[1]).get("offset"));
      const data = Array.from({ length: total }, (_, i) => fila(i + 1)).slice(pagina * 1000, pagina * 1000 + 1000);
      return { data, count: total };
    },
  };
  const filas = await traer(cliente);

  assert.equal(filas.length, total);
  assert.deepEqual(filas[0], { code: "1", stock: 1 }, "código visible recortado y stock real, no el disponible");
  assert.equal(rutas.length, 3);
  assert.ok(rutas.every((r) => r.includes("codigosdepositos=001")), "sólo el depósito central");
});

test("sin código particular no entra, y una respuesta vacía corta", async () => {
  if (!traer) return;
  const cliente = { llamar: async () => ({ data: [{ CODIGOPARTICULAR: "", STOCKREAL: 5 }, fila(7)], count: 2 }) };
  assert.deepEqual(await traer(cliente), [{ code: "7", stock: 7 }]);
  assert.deepEqual(await traer({ llamar: async () => ({ data: [], count: 0 }) }), []);
});
