// Tests del armador de remitos entre depósitos. Puro: no toca base ni red.
// El caso de referencia es el remito #0001053 (MIN. EDUC - ZONA SANTA MARIA),
// que en Flexxus quedó como el movimiento MD 0001-00037590.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  construirRemito,
  referenciaPedido,
  externalId,
  TIPO_COMPROBANTE,
} from "../src/integrations/flexxusRemito.js";

const BASE = {
  pedidoId: 1053,
  fecha: "2026-09-18 19:05:20",
  depositoCentral: "1",
  depositoServicio: "412",
  usuario: "GGONZALEZ",
  items: [
    { codigo: "004", cantidad: 400, nombre: "BOLSA NEGRA 80*100*35 COMPACTADORA" },
    { codigo: "008", cantidad: 4000, nombre: "BOLSA NEGRA 50*60*25 RESIDUO" },
    { codigo: "100000292", cantidad: 3, nombre: "ALCOHOL AL 70% AXON X 5 LTS" },
  ],
};

test("la salida va del depósito central al del servicio", () => {
  const r = construirRemito({ ...BASE, tipo: "salida" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.errores, []);
  assert.equal(r.body.tipocomprobante, TIPO_COMPROBANTE);
  assert.equal(r.body.codigodepositoorigen, "1");
  assert.equal(r.body.codigodepositodestino, "412");
  assert.equal(r.body.fechacomprobante, "2026-09-18 19:05:20");
  assert.equal(r.body.codigousuario, "GGONZALEZ");
  assert.equal(r.body.productos.length, 3);
  assert.deepEqual(r.body.productos[0], { codigoarticulo: "004", cantidad: 400 });
});

test("la devolución invierte los depósitos", () => {
  const r = construirRemito({ ...BASE, tipo: "entrada" });
  assert.equal(r.ok, true);
  assert.equal(r.body.codigodepositoorigen, "412");
  assert.equal(r.body.codigodepositodestino, "1");
});

test("en Observaciones va la referencia al remito de la app", () => {
  const r = construirRemito({ ...BASE });
  assert.equal(r.body.comentarios, "OP-0001053");
  assert.equal(referenciaPedido(1053), "OP-0001053");
  assert.equal(referenciaPedido(9), "OP-0000009");
});

test("se puede pisar el comentario", () => {
  const r = construirRemito({ ...BASE, comentario: "DEVOLUCION OP-0001053" });
  assert.equal(r.body.comentarios, "DEVOLUCION OP-0001053");
});

test("el mismo insumo repetido se suma en una sola línea", () => {
  const r = construirRemito({
    ...BASE,
    items: [
      { codigo: "004", cantidad: 300, nombre: "BOLSA" },
      { codigo: "004", cantidad: 100, nombre: "BOLSA" },
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.body.productos.length, 1);
  assert.deepEqual(r.body.productos[0], { codigoarticulo: "004", cantidad: 400 });
});

test("las líneas en cero no viajan, pero avisan", () => {
  const r = construirRemito({
    ...BASE,
    items: [
      { codigo: "004", cantidad: 400, nombre: "BOLSA" },
      { codigo: "008", cantidad: 0, nombre: "BOLSA CHICA" },
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.body.productos.length, 1);
  assert.match(r.avisos.join(" "), /BOLSA CHICA/);
});

test("el lote viaja sólo si lo hay", () => {
  const r = construirRemito({
    ...BASE,
    items: [
      { codigo: "004", cantidad: 1, nombre: "A" },
      { codigo: "008", cantidad: 1, nombre: "B", lote: "L-22" },
    ],
  });
  assert.equal(r.body.productos[0].lote, undefined);
  assert.equal(r.body.productos[1].lote, "L-22");
});

test("sin depósito del servicio no se manda nada", () => {
  const r = construirRemito({ ...BASE, depositoServicio: "" });
  assert.equal(r.ok, false);
  assert.equal(r.body, null);
  assert.match(r.errores.join(" "), /no tiene depósito de Flexxus asignado/);
});

test("un código más largo de 15 caracteres es un error", () => {
  const r = construirRemito({
    ...BASE,
    items: [{ codigo: "1234567890123456", cantidad: 1, nombre: "LARGO" }],
  });
  assert.equal(r.ok, false);
  assert.match(r.errores.join(" "), /acepta hasta 15/);
});

test("una cantidad negativa es un error", () => {
  const r = construirRemito({ ...BASE, items: [{ codigo: "004", cantidad: -5, nombre: "BOLSA" }] });
  assert.equal(r.ok, false);
  assert.match(r.errores.join(" "), /cantidad negativa/);
});

test("un movimiento sin líneas es un error", () => {
  const r = construirRemito({ ...BASE, items: [] });
  assert.equal(r.ok, false);
  assert.match(r.errores.join(" "), /ninguna línea con cantidad/);
});

test("la fecha en ISO se normaliza al formato de Flexxus", () => {
  const r = construirRemito({ ...BASE, fecha: "2026-09-18T19:05:20.928Z" });
  assert.equal(r.ok, true);
  assert.equal(r.body.fechacomprobante, "2026-09-18 19:05:20");
});

test("una fecha ilegible no se adivina: es un error", () => {
  const r = construirRemito({ ...BASE, fecha: "ayer" });
  assert.equal(r.ok, false);
  assert.match(r.errores.join(" "), /Fecha inválida/);
});

test("el identificador de envío distingue salida, entrada e intento", () => {
  assert.equal(externalId(1053, "salida"), "OUT-0001053-1");
  assert.equal(externalId(1053, "entrada"), "IN-0001053-1");
  assert.equal(externalId(1053, "salida", 2), "OUT-0001053-2");
  // Mismo pedido y mismo intento -> mismo id. De eso depende no duplicar.
  assert.equal(externalId(1053, "salida"), externalId(1053, "salida"));
});

test("el identificador viene incluso cuando el remito no se puede armar", () => {
  const r = construirRemito({ ...BASE, depositoServicio: "" });
  assert.equal(r.externalId, "OUT-0001053-1");
});
