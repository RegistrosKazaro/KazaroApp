// Las vistas se recrean con DROP + CREATE en cada arranque. Si una vista nueva
// no está en la lista de DROP, el SEGUNDO arranque falla con "view ... already
// exists", la excepción corta el bloque y las vistas que venían DESPUÉS quedan
// sin crear.
//
// Paso el 13/10/2026: se agregó v_equipamiento_prestado sin sumarla a la lista,
// y producción se quedó sin v_pedido_items_neto ni v_pedidos_neto, que son las
// que usan los informes y los totales de los pedidos. Nadie se dio cuenta
// porque el catch sólo deja un console.warn.
//
// Por eso este test arranca db.js DOS veces sobre la misma base.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const dbJs = path.resolve(aqui, "../src/db.js").replace(/\\/g, "/");
const origen = path.resolve(aqui, "../Kazaro.db");

const VISTAS = ["v_devoluciones_aprobadas", "v_equipamiento_prestado",
                "v_pedido_items_neto", "v_pedidos_neto"];

/** Arranca db.js contra esa base y devuelve las vistas que quedaron. */
function arrancarYListar(dbPath) {
  const codigo = `
    import("file:///${dbJs}").then((m) => {
      const v = m.db.prepare("SELECT name FROM sqlite_master WHERE type='view'").all();
      console.log("VISTAS=" + v.map((x) => x.name).sort().join(","));
    });`;
  const salida = execFileSync(process.execPath, ["-e", codigo], {
    env: { ...process.env, DB_PATH: dbPath, NODE_ENV: "test" },
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000,
  });
  return { salida, vistas: (salida.match(/VISTAS=(.*)/) || [])[1]?.split(",") || [] };
}

test("arrancar dos veces deja todas las vistas en pie", () => {
  if (!fs.existsSync(origen)) return;   // sin base de desarrollo, no aplica
  const tmp = path.join(os.tmpdir(), `kz_vistas_${Date.now()}.db`);
  fs.copyFileSync(origen, tmp);
  try {
    const primero = arrancarYListar(tmp);
    for (const v of VISTAS) {
      assert.ok(primero.vistas.includes(v), `falta ${v} en el primer arranque`);
    }

    const segundo = arrancarYListar(tmp);
    for (const v of VISTAS) {
      assert.ok(segundo.vistas.includes(v), `falta ${v} en el SEGUNDO arranque`);
    }
    // Y que no haya quedado el aviso que delata el problema.
    assert.doesNotMatch(segundo.salida, /already exists/i);
    assert.doesNotMatch(segundo.salida, /ensureDevolucionesViews/);
  } finally {
    for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + ext); } catch {} }
  }
});

test("y a la tercera tambien, por las dudas", () => {
  if (!fs.existsSync(origen)) return;
  const tmp = path.join(os.tmpdir(), `kz_vistas3_${Date.now()}.db`);
  fs.copyFileSync(origen, tmp);
  try {
    arrancarYListar(tmp);
    arrancarYListar(tmp);
    const tercero = arrancarYListar(tmp);
    for (const v of VISTAS) assert.ok(tercero.vistas.includes(v), `falta ${v}`);
  } finally {
    for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + ext); } catch {} }
  }
});
