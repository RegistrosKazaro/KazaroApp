// La planilla de movimientos entre depósitos, igual a la de Flexxus.
//
// Lo que se prueba acá es que la planilla salga de lo que YA pasó en el
// depósito —despachos y devoluciones— y no de la cola de Flexxus, que todavía
// está vacía. Si dependiera de la cola, la pantalla estaría en blanco hasta el
// día del enganche.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = path.join(os.tmpdir(), `kz_movs_${Date.now()}.db`);
const origen = path.resolve(import.meta.dirname, "../Kazaro.db");
let db = null, mov = null, router = null;

before(async () => {
  if (!fs.existsSync(origen)) return;
  fs.copyFileSync(origen, tmp);
  process.env.DB_PATH = tmp;
  mov = await import("../src/integrations/flexxusMovimientos.js");
  router = (await import("../src/routes/deposito.js")).default;
  ({ db } = await import("../src/db.js"));
});

after(() => {
  for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + ext); } catch {} }
});

const sinBase = () => !db;
let seq = 0;
const unico = () => `${Date.now()}${(seq += 1).toString().padStart(3, "0")}`;

/** Un servicio con su depósito de Flexxus, para que la fila tenga destino. */
function servicioConDeposito(codigo) {
  const sid = Number(db.prepare(
    `INSERT INTO Servicios (ServicioNombre, empresa_id) VALUES (?, 1)`
  ).run(`SERVICIO MOV ${unico()}`).lastInsertRowid);
  if (codigo) {
    db.prepare(
      `INSERT OR REPLACE INTO flexxus_depositos (servicio_id, codigo_deposito, nombre_deposito, origen, actualizado_at)
       VALUES (?, ?, ?, 'manual', datetime('now'))`
    ).run(sid, codigo, `DEPOSITO ${codigo}`);
  }
  return sid;
}

/** Un despacho: lo que salió del central hacia el servicio. */
function despacho(servicioId, { fecha = "2026-10-10 10:00:00", lineas = [["X1", 5], ["X2", 3]] } = {}) {
  const pedidoId = Number(db.prepare(
    `INSERT INTO Pedidos (EmpleadoID, Rol, Total, empresa_id, Status, ServicioID, Fecha)
     VALUES (1, 'supervisor', 0, 1, 'closed', ?, ?)`
  ).run(servicioId, fecha).lastInsertRowid);

  db.prepare(
    `INSERT INTO pedido_despacho (pedido_id, fecha_despacho, servicio_id, empleado_id, empresa_id, total)
     VALUES (?, ?, ?, 1, 1, 0)`
  ).run(pedidoId, fecha, servicioId);

  for (const [codigo, cant] of lineas) {
    db.prepare(
      `INSERT INTO pedido_despacho_items (pedido_id, numero, producto_id, codigo, nombre, precio, cantidad, subtotal, fecha_despacho)
       VALUES (?, 1, ?, ?, ?, 100, ?, ?, ?)`
    ).run(pedidoId, Math.abs(hash(codigo)), codigo, `INSUMO ${codigo}`, cant, cant * 100, fecha);
  }
  return pedidoId;
}

const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);

/** Una devolución aprobada: lo que volvió del servicio al central. */
function devolucion(pedidoId, cantidad = 2, fecha = "2026-10-11 09:00:00") {
  const prod = Number(db.prepare(
    `INSERT INTO Productos (ProductName, Precio, Stock, empresa_id, is_active, Code)
     VALUES (?, 250, 10, 1, 1, ?)`
  ).run(`DEVUELTO ${unico()}`, `DV${unico()}`.slice(0, 14)).lastInsertRowid);

  db.prepare(
    `INSERT INTO devoluciones (pedido_id, producto_id, cantidad, empresa_id, estado, tipo, fecha_resolucion, aprobador_id)
     VALUES (?, ?, ?, 1, 'aprobada', 'no_usado', ?, 1)`
  ).run(pedidoId, prod, cantidad, fecha);
  return prod;
}

const buscar = (filtros) => mov.listar(db, { empresaId: 1, limite: 500, ...filtros });
const filaDe = (pedidoId, tipo, filtros = {}) =>
  buscar(filtros).rows.find((r) => r.pedidoId === pedidoId && r.tipo === tipo);

/* ===================== La planilla ===================== */

test("un despacho aparece como SALIDA del central al deposito del servicio", () => {
  if (sinBase()) return;
  const sid = servicioConDeposito("626");
  const pedidoId = despacho(sid, { lineas: [["A", 5], ["B", 3]] });

  const fila = filaDe(pedidoId, "salida");
  assert.ok(fila, "tendria que estar en la planilla");
  assert.equal(fila.comprobante, "MD");
  assert.equal(fila.origen.codigo, "001");
  assert.equal(fila.origen.nombre, "DEPOSITO CENTRAL");
  assert.equal(fila.destino.codigo, "626");
  assert.equal(fila.unidades, 8);
  assert.equal(fila.lineas, 2);
});

test("una devolucion aparece como ENTRADA, al reves", () => {
  if (sinBase()) return;
  const sid = servicioConDeposito("343");
  const pedidoId = despacho(sid);
  devolucion(pedidoId, 4);

  const fila = filaDe(pedidoId, "entrada");
  assert.ok(fila, "la devolucion tendria que figurar");
  assert.equal(fila.origen.codigo, "343", "sale del deposito del servicio");
  assert.equal(fila.destino.codigo, "001", "y entra al central");
  assert.equal(fila.unidades, 4);
});

test("el remito viaja como OP-0000000, que es como se cruza con Flexxus", () => {
  if (sinBase()) return;
  const sid = servicioConDeposito("283");
  const pedidoId = despacho(sid);
  assert.equal(filaDe(pedidoId, "salida").referencia, `OP-${String(pedidoId).padStart(7, "0")}`);
});

test("sin Flexxus enganchado, el numero de comprobante va en null y no se inventa", () => {
  if (sinBase()) return;
  const sid = servicioConDeposito("642");
  const pedidoId = despacho(sid);
  const fila = filaDe(pedidoId, "salida");
  assert.equal(fila.numeroMovimiento, null);
  assert.equal(fila.estadoEnvio, null);
});

test("cuando el movimiento se encola, la planilla muestra su numero y estado", () => {
  if (sinBase()) return;
  const sid = servicioConDeposito("710");
  const pedidoId = despacho(sid);
  db.prepare(
    `INSERT INTO flexxus_outbox (external_id, pedido_id, servicio_id, tipo, estado, numero_mov, creado_at, actualizado_at)
     VALUES (?, ?, ?, 'salida', 'enviado', '0001-00037813', datetime('now'), datetime('now'))`
  ).run(`OUT-${pedidoId}-1`, pedidoId, sid);

  const fila = filaDe(pedidoId, "salida");
  assert.equal(fila.numeroMovimiento, "0001-00037813");
  assert.equal(fila.estadoEnvio, "enviado");
});

test("un servicio sin deposito mapeado se marca, no se esconde", () => {
  if (sinBase()) return;
  const sid = servicioConDeposito(null);
  const pedidoId = despacho(sid);
  const fila = filaDe(pedidoId, "salida");
  assert.equal(fila.sinDeposito, true);
  assert.equal(fila.destino.codigo, null);
});

/* ===================== Los filtros ===================== */

test("se filtra por tipo", () => {
  if (sinBase()) return;
  const sid = servicioConDeposito("711");
  const pedidoId = despacho(sid);
  devolucion(pedidoId);

  const salidas = buscar({ tipo: "salida" }).rows;
  assert.ok(salidas.every((r) => r.tipo === "salida"));
  assert.ok(salidas.some((r) => r.pedidoId === pedidoId));
  assert.ok(!buscar({ tipo: "entrada" }).rows.some((r) => r.tipo === "salida"));
});

test("se filtra por rango de fechas, con los dos extremos adentro", () => {
  if (sinBase()) return;
  const sid = servicioConDeposito("715");
  const viejo = despacho(sid, { fecha: "2026-01-05 10:00:00" });
  const medio = despacho(sid, { fecha: "2026-01-10 10:00:00" });
  const nuevo = despacho(sid, { fecha: "2026-01-20 10:00:00" });

  const ids = buscar({ desde: "2026-01-05", hasta: "2026-01-10" }).rows.map((r) => r.pedidoId);
  assert.ok(ids.includes(viejo), "el primer dia entra");
  assert.ok(ids.includes(medio), "el ultimo dia entra");
  assert.ok(!ids.includes(nuevo));
});

test("se filtra por deposito", () => {
  if (sinBase()) return;
  const a = servicioConDeposito("716");
  const b = servicioConDeposito("717");
  const pa = despacho(a), pb = despacho(b);

  const ids = buscar({ deposito: "716" }).rows.map((r) => r.pedidoId);
  assert.ok(ids.includes(pa));
  assert.ok(!ids.includes(pb));
});

test("se busca por numero de remito o por servicio", () => {
  if (sinBase()) return;
  const sid = servicioConDeposito("718");
  const nombre = db.prepare(`SELECT ServicioNombre n FROM Servicios WHERE ServiciosID = ?`).get(sid).n;
  const pedidoId = despacho(sid);

  assert.ok(buscar({ busqueda: `OP-${String(pedidoId).padStart(7, "0")}` })
    .rows.some((r) => r.pedidoId === pedidoId), "no lo encontro por el remito");
  assert.ok(buscar({ busqueda: nombre }).rows.some((r) => r.pedidoId === pedidoId),
    "no lo encontro por el servicio");
});

test("no se ven los movimientos de otra empresa", () => {
  if (sinBase()) return;
  const sid = servicioConDeposito("719");
  const pedidoId = despacho(sid);
  db.prepare(`UPDATE pedido_despacho SET empresa_id = 2 WHERE pedido_id = ?`).run(pedidoId);
  assert.ok(!buscar({}).rows.some((r) => r.pedidoId === pedidoId));
});

test("el resumen cuenta lo filtrado, no todo", () => {
  if (sinBase()) return;
  const sid = servicioConDeposito("720");
  despacho(sid, { fecha: "2025-03-03 10:00:00", lineas: [["Z", 7]] });
  const r = buscar({ desde: "2025-03-03", hasta: "2025-03-03" });
  assert.equal(r.total, 1);
  assert.equal(r.unidades, 7);
});

/* ===================== El detalle ===================== */

test("el detalle de una salida trae los insumos que se despacharon", () => {
  if (sinBase()) return;
  const sid = servicioConDeposito("721");
  const pedidoId = despacho(sid, { lineas: [["AA", 5], ["BB", 2]] });

  const d = mov.detalle(db, `d${pedidoId}`, 1);
  assert.equal(d.ok, true);
  assert.equal(d.tipo, "salida");
  assert.equal(d.items.length, 2);
  assert.equal(d.unidades, 7);
  assert.ok(d.items.every((i) => i.nombre && i.cantidad > 0));
});

test("el detalle de una entrada trae lo que volvio", () => {
  if (sinBase()) return;
  const sid = servicioConDeposito("722");
  const pedidoId = despacho(sid);
  devolucion(pedidoId, 3);

  const d = mov.detalle(db, `v${pedidoId}`, 1);
  assert.equal(d.ok, true);
  assert.equal(d.tipo, "entrada");
  assert.equal(d.unidades, 3);
});

test("una clave inventada no rompe ni filtra nada", () => {
  if (sinBase()) return;
  for (const clave of ["", "x1", "d", "d99999999", "'; DROP TABLE Pedidos;--"]) {
    const d = mov.detalle(db, clave, 1);
    assert.equal(d.ok, false, `clave ${clave}`);
  }
  assert.ok(db.prepare(`SELECT COUNT(*) n FROM Pedidos`).get().n > 0, "la tabla sigue viva");
});

test("el detalle de otra empresa no se abre", () => {
  if (sinBase()) return;
  const sid = servicioConDeposito("723");
  const pedidoId = despacho(sid);
  assert.equal(mov.detalle(db, `d${pedidoId}`, 2).ok, false);
});

/* ===================== Las rutas ===================== */

test("estan las rutas que usa la pantalla", () => {
  if (sinBase()) return;
  const hay = (metodo, ruta) => router.stack
    .some((l) => l.route?.path === ruta && l.route.methods[metodo]);
  for (const r of ["/movimientos", "/movimientos/depositos", "/movimientos/:clave"]) {
    assert.ok(hay("get", r), `falta GET ${r}`);
  }
});

test("la lista de depositos del filtro sale de los que tienen movimientos", () => {
  if (sinBase()) return;
  const sid = servicioConDeposito("724");
  despacho(sid);
  const deps = mov.depositosConMovimientos(db, 1);
  const uno = deps.find((d) => d.codigo === "724");
  assert.ok(uno, "el deposito con movimientos tiene que estar en el filtro");
  assert.ok(uno.movimientos > 0);
});
