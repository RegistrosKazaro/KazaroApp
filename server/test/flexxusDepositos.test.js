// Tests del mapeo servicio -> depósito de Flexxus. Corre contra una base
// SQLite en memoria, así se prueba el SQL de verdad sin tocar nada real.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  ensureTablas, asignar, depositoDe, importarConfirmados,
  listarSinMapear, resumen, compartidos, DEPOSITO_CENTRAL,
} from "../src/integrations/flexxusDepositos.js";

function baseNueva() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE Servicios (
      ServiciosID INTEGER PRIMARY KEY, ServicioNombre TEXT,
      empresa_id INTEGER, deleted_at TEXT);
    CREATE TABLE Pedidos (
      PedidoID INTEGER PRIMARY KEY, ServicioID INTEGER, deleted_at TEXT);
  `);
  const s = db.prepare(`INSERT INTO Servicios VALUES (?,?,?,?)`);
  s.run(43, "BELGRANO - PREDIO VILLA ESQUIU", 1, null);
  s.run(53, "CLUB ATLETICO BELGRANO - PREDIO SOCIAL Y FAMILIAR", 1, null);
  s.run(485, "UEPC - Sede Administrativa", 1, null);
  s.run(412, "MIN. EDUC - ZONA SANTA MARIA", 1, null);
  s.run(999, "SERVICIO BORRADO", 1, "2026-01-01");
  s.run(1000, "UN SERVICIO DE PAZAR", 2, null);
  const p = db.prepare(`INSERT INTO Pedidos VALUES (?,?,?)`);
  p.run(1, 43, null); p.run(2, 43, null); p.run(3, 412, null);
  p.run(4, 412, null); p.run(5, 412, "2026-01-01"); // borrado: no cuenta
  ensureTablas(db);
  return db;
}

test("el depósito central es el 001", () => {
  assert.equal(DEPOSITO_CENTRAL, "001");
});

test("asigna y lee el depósito de un servicio", () => {
  const db = baseNueva();
  const r = asignar(db, { servicioId: 43, codigoDeposito: "660",
    nombreDeposito: "CLUB ATLETICO BELGRANO- PREDIO VILLA ESQUIU", origen: "confirmado" });
  assert.equal(r.ok, true);
  const d = depositoDe(db, 43);
  assert.equal(d.codigo, "660");
  assert.equal(d.origen, "confirmado");
});

test("un servicio que nunca se miró devuelve null", () => {
  const db = baseNueva();
  assert.equal(depositoDe(db, 43), null);
});

test("distingue 'no lo miré' de 'no existe en Flexxus'", () => {
  const db = baseNueva();
  asignar(db, { servicioId: 485, codigoDeposito: null, motivo: "No existe en Flexxus." });
  const d = depositoDe(db, 485);
  assert.notEqual(d, null);          // sí lo miramos
  assert.equal(d.codigo, null);      // y no está
  assert.match(d.motivo, /No existe/);
});

test("reasignar pisa el valor anterior, no duplica", () => {
  const db = baseNueva();
  asignar(db, { servicioId: 53, codigoDeposito: "660" });
  asignar(db, { servicioId: 53, codigoDeposito: "652", motivo: "Es el de Saldán." });
  assert.equal(depositoDe(db, 53).codigo, "652");
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM flexxus_depositos`).get().n, 1);
});

test("rechaza un origen desconocido", () => {
  const db = baseNueva();
  const r = asignar(db, { servicioId: 43, codigoDeposito: "660", origen: "inventado" });
  assert.equal(r.ok, false);
  assert.match(r.error, /Origen desconocido/);
});

test("importa el archivo de confirmados", () => {
  const db = baseNueva();
  const r = importarConfirmados(db, {
    mapeos: [
      { servicio_id: 43, codigo_deposito: "660", deposito: "VILLA ESQUIU", motivo: "ok" },
      { servicio_id: 53, codigo_deposito: "652", deposito: "PREDIO SALDAN" },
    ],
    sin_deposito: [{ servicio_id: 485, motivo: "No existe en Flexxus." }],
  });
  assert.equal(r.asignados, 2);
  assert.equal(r.sinDeposito, 1);
  assert.deepEqual(r.errores, []);
  assert.equal(depositoDe(db, 43).codigo, "660");
  assert.equal(depositoDe(db, 485).codigo, null);
});

test("una decisión confirmada no la pisa una importación distinta", () => {
  const db = baseNueva();
  asignar(db, { servicioId: 53, codigoDeposito: "652", origen: "confirmado" });
  const r = importarConfirmados(db, {
    mapeos: [{ servicio_id: 53, codigo_deposito: "669", deposito: "OTRO" }],
  });
  assert.equal(r.respetados, 1);
  assert.equal(r.asignados, 0);
  assert.equal(depositoDe(db, 53).codigo, "652");
});

test("lista los que faltan mapear, los que más piden primero", () => {
  const db = baseNueva();
  asignar(db, { servicioId: 43, codigoDeposito: "660" });
  const faltan = listarSinMapear(db);
  const ids = faltan.map((f) => f.servicioId);
  assert.ok(!ids.includes(43));      // ya mapeado
  assert.ok(!ids.includes(999));     // borrado
  assert.ok(!ids.includes(1000));    // Pazar no usa Flexxus
  assert.equal(faltan[0].servicioId, 412);
  assert.equal(faltan[0].pedidos, 2); // el pedido borrado no cuenta
});

test("puede listar sólo los que tienen pedidos", () => {
  const db = baseNueva();
  const conPedidos = listarSinMapear(db, { soloConPedidos: true }).map((f) => f.servicioId);
  assert.deepEqual(conPedidos.sort((a, b) => a - b), [43, 412]);
  // Los que nunca pidieron (53 y 485) no aparecen.
  assert.ok(!conPedidos.includes(53));
});

test("el resumen cuenta mapeados, sin depósito y sin mirar", () => {
  const db = baseNueva();
  asignar(db, { servicioId: 43, codigoDeposito: "660", origen: "confirmado" });
  asignar(db, { servicioId: 485, codigoDeposito: null });
  const r = resumen(db);
  assert.equal(r.total, 2);
  assert.equal(r.conDeposito, 1);
  assert.equal(r.sinDeposito, 1);
  assert.equal(r.confirmados, 1);
  assert.equal(r.sinMapear, 2);      // 53 y 412
});

test("muestra los depósitos compartidos por varios servicios", () => {
  const db = baseNueva();
  asignar(db, { servicioId: 43, codigoDeposito: "697" });
  asignar(db, { servicioId: 53, codigoDeposito: "697" });
  asignar(db, { servicioId: 412, codigoDeposito: "412" });
  const c = compartidos(db);
  assert.equal(c.length, 1);
  assert.equal(c[0].codigo, "697");
  assert.equal(c[0].cuantos, 2);
});

test("el resumen no revienta si no se puede leer Servicios", () => {
  const db = new Database(":memory:");          // sin tabla Servicios
  ensureTablas(db);
  asignar(db, { servicioId: 43, codigoDeposito: "660" });
  const r = resumen(db);
  assert.equal(r.conDeposito, 1);
  assert.equal(r.sinMapear, null);              // no se pudo contar, pero no rompe
});
