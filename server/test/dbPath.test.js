// DB_PATH: si alguien dice explicitamente que base usar, se usa ESA.
//
// Antes, si el archivo no existia, db.js seguia buscando Kazaro.db por todo el
// proyecto y abria la primera que encontrara. Un error de tipeo en el .env
// levantaba el servidor contra una base equivocada y sin un solo aviso.
//
// Se prueba arrancando db.js en otro proceso, que es como pasa de verdad.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const dbJs = path.resolve(aqui, "../src/db.js").replace(/\\/g, "/");

/** Arranca db.js con ese DB_PATH y devuelve { ok, salida, rutaUsada }. */
function arrancar(dbPath) {
  const codigo = `import("file:///${dbJs}").then(m => console.log("RUTA_USADA=" + m.DB_RESOLVED_PATH))`;
  try {
    const salida = execFileSync(process.execPath, ["-e", codigo], {
      env: { ...process.env, DB_PATH: dbPath, NODE_ENV: "test" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    });
    return { ok: true, salida, rutaUsada: (salida.match(/RUTA_USADA=(.+)/) || [])[1]?.trim() };
  } catch (e) {
    return { ok: false, salida: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

test("con un DB_PATH que no existe, NO abre otra base: corta con un error claro", () => {
  const inexistente = path.join(os.tmpdir(), `kz_no_existe_${Date.now()}.db`);
  const r = arrancar(inexistente);
  assert.equal(r.ok, false, "tendria que haber fallado");
  assert.match(r.salida, /DB_PATH está puesto/);
  assert.match(r.salida, /NO se va a usar otra base/);
  assert.match(r.salida, /Base de datos ausente/);
  // Lo importante: que no haya abierto la base del proyecto.
  assert.doesNotMatch(r.salida, /RUTA_USADA=/);
});

test("con un DB_PATH que existe, usa exactamente ese archivo", () => {
  const tmp = path.join(os.tmpdir(), `kz_ok_${Date.now()}.db`);
  fs.writeFileSync(tmp, "");          // SQLite abre un archivo vacio sin drama
  try {
    const r = arrancar(tmp);
    assert.equal(r.ok, true, `no tendria que haber fallado:\n${r.salida}`);
    assert.equal(path.resolve(r.rutaUsada), path.resolve(tmp));
  } finally {
    for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + ext); } catch {} }
  }
});

test("el mensaje de error dice que ruta se pidio, para poder corregirla", () => {
  const inexistente = path.join(os.tmpdir(), `kz_tipeo_${Date.now()}.db`);
  const r = arrancar(inexistente);
  assert.equal(r.ok, false);
  assert.match(r.salida, new RegExp(path.basename(inexistente)));
});
