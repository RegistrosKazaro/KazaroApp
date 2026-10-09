// Reintento de mails ante fallos pasajeros.
//
// Los casos vienen del historial real de produccion: la racha de 421 del
// 11/08/2026 (25 avisos perdidos en 31 segundos), los tres 451 sueltos entre
// agosto y octubre, y los 535 del 21/09 cuando Google anulo la clave.
import { test } from "node:test";
import assert from "node:assert/strict";
import { esErrorTemporal, conReintentos } from "../src/utils/mailer.js";

const smtp = (codigo, mensaje) => Object.assign(new Error(mensaje), { responseCode: codigo });

test("un 421 es pasajero: el servidor pide que probemos mas tarde", () => {
  assert.equal(esErrorTemporal(smtp(421, "Data command failed: 421-4.3.0 Temporary System Problem")), true);
});

test("un 451 es pasajero", () => {
  assert.equal(esErrorTemporal(smtp(451, "Message failed: 451-4.3.0 Mail server temporarily rejected message")), true);
});

test("un 535 NO es pasajero: la clave esta mal y no va a cambiar sola", () => {
  assert.equal(esErrorTemporal(smtp(535, "Invalid login: 535-5.7.8 Username and Password not accepted")), false);
});

test("un 550 NO es pasajero: la casilla no existe", () => {
  assert.equal(esErrorTemporal(smtp(550, "No such user")), false);
});

test("los cortes de red son pasajeros", () => {
  for (const code of ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "ECONNRESET", "EAI_AGAIN"]) {
    assert.equal(esErrorTemporal(Object.assign(new Error("red"), { code })), true, code);
  }
});

test("sin codigo, se mira el texto del mensaje", () => {
  assert.equal(esErrorTemporal(new Error("Data command failed: 421-4.3.0 Temporary System Problem")), true);
  assert.equal(esErrorTemporal(new Error("Invalid login: 535-5.7.8 not accepted")), false);
  assert.equal(esErrorTemporal(new Error("cualquier otra cosa")), false);
});

test("si sale a la primera, no reintenta", async () => {
  let veces = 0;
  const r = await conReintentos(() => { veces += 1; return "ok"; }, { esperar: async () => {} });
  assert.equal(r, "ok");
  assert.equal(veces, 1);
});

test("reintenta un fallo pasajero hasta que sale", async () => {
  let veces = 0;
  const r = await conReintentos(() => {
    veces += 1;
    if (veces < 3) throw smtp(421, "Temporary System Problem");
    return "ok";
  }, { esperar: async () => {} });
  assert.equal(r, "ok");
  assert.equal(veces, 3);
});

test("un fallo permanente no se reintenta ni una vez", async () => {
  let veces = 0;
  await assert.rejects(
    () => conReintentos(() => { veces += 1; throw smtp(535, "Invalid login"); }, { esperar: async () => {} }),
    /Invalid login/,
  );
  assert.equal(veces, 1);
});

test("si nunca sale, tira el ultimo error y no insiste de mas", async () => {
  let veces = 0;
  await assert.rejects(
    () => conReintentos(() => { veces += 1; throw smtp(421, "sigue caido"); }, { esperar: async () => {} }),
    /sigue caido/,
  );
  assert.equal(veces, 4);   // el primero + los tres reintentos
});

test("las esperas crecen y cubren mas de un minuto", async () => {
  const esperadas = [];
  await assert.rejects(() => conReintentos(
    () => { throw smtp(451, "temporal"); },
    { esperar: async (ms) => { esperadas.push(ms); } },
  ));
  assert.deepEqual(esperadas, [5000, 15000, 45000]);
  // La racha del 11/08 duro 31 segundos: con esto se habria cubierto.
  assert.ok(esperadas.reduce((a, b) => a + b, 0) >= 60000);
});

test("avisa por consola en cada reintento, con el numero y la espera", async () => {
  const avisos = [];
  await assert.rejects(() => conReintentos(
    () => { throw smtp(421, "caido"); },
    { esperar: async () => {}, alReintentar: (e, intento, espera) => avisos.push([intento, espera]) },
  ));
  assert.deepEqual(avisos, [[1, 5000], [2, 15000], [3, 45000]]);
});

test("se le pasa a la funcion en que intento va", async () => {
  const vistos = [];
  await assert.rejects(() => conReintentos(
    (intento) => { vistos.push(intento); throw smtp(421, "caido"); },
    { esperar: async () => {} },
  ));
  assert.deepEqual(vistos, [1, 2, 3, 4]);
});
