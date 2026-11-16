// Río Cuarto no pasa por el depósito central (decidido el 16/11/2026).
//
// Sus pedidos no aparecen en el panel del depósito y cuentan apenas se crean
// (Informes, API), sin descontar stock: no salen de ahí. Antes quedaban "Por
// confirmar" para siempre: 53 de 56 nunca se confirmaron y no figuraban en
// ningún informe.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = path.join(os.tmpdir(), `kz_r4dep_${Date.now()}.db`);
const origen = path.resolve(import.meta.dirname, "../Kazaro.db");
let db = null, M = null, deposito = null;

before(async () => {
  if (!fs.existsSync(origen)) return;
  fs.copyFileSync(origen, tmp);
  process.env.DB_PATH = tmp;
  M = await import("../src/db.js");
  ({ db } = M);
  deposito = (await import("../src/routes/deposito.js")).default;
});

after(() => {
  for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + ext); } catch {} }
});

const sinBase = () => !db;
let seq = 0;
const unico = () => `${Date.now()}${(seq += 1).toString().padStart(3, "0")}`;

const servicio = (nombre, zona = null) => Number(db.prepare(
  `INSERT INTO Servicios (ServicioNombre, empresa_id, zona) VALUES (?, 1, ?)`
).run(`${nombre} ${unico()}`, zona).lastInsertRowid);

const insumo = (stock = 100) => Number(db.prepare(
  `INSERT INTO Productos (ProductName, Precio, Stock, empresa_id, is_active, Code) VALUES (?, 10, ?, 1, 1, ?)`
).run(`R4 INSUMO ${unico()}`, stock, `R4${unico()}`.slice(-12)).lastInsertRowid);

function supervisor() {
  const id = Number(db.prepare(
    `INSERT INTO Empleados (Nombre, Apellido, Email, username, is_active, empresa_id) VALUES ('Sup', 'R4', ?, ?, 1, 1)`
  ).run(`s${unico()}@x.com`, `sup.${unico()}`).lastInsertRowid);
  const rol = db.prepare(`SELECT RolID FROM Roles WHERE Nombre = 'Supervisor' COLLATE NOCASE`).get().RolID;
  db.prepare(`INSERT INTO Roles_Empleados (EmpleadoID, RolID) VALUES (?, ?)`).run(id, rol);
  return id;
}

const pedido = (id) => db.prepare(
  `SELECT Status, contabilizado_at, retiro_at, closedat, Fecha FROM Pedidos WHERE PedidoID = ?`
).get(id);
const stockDe = (id) => Number(db.prepare(`SELECT Stock FROM Productos WHERE ProductID = ?`).get(id).Stock);

test("qué servicio es de Río Cuarto: por el nombre o por la zona", () => {
  if (sinBase()) return;
  for (const n of ["ME-ESC INTERIOR - J.DE INF. SARMIENTO R4", "MERCADO ABASTO RIO IV", "EPEC ZONA F RIO CUARTO",
                   "SE - GOMERA ALTAMIRANO RO IV", "Delegación Río Cuarto"]) {
    assert.equal(M.esRioCuarto(n, null), true, n);
  }
  assert.equal(M.esRioCuarto("GOMERIA ALTAMIRANO S.A RIO V", "RIO IV"), true, "por la zona");
  for (const n of ["ME-ESC. INTERIOR - MIGUEL CANE-RIO SECO", "HOSPITAL EVA PERON", "CLUB R40"]) {
    assert.equal(M.esRioCuarto(n, null), false, n);
  }
});

test("un pedido de Río Cuarto cuenta apenas se crea y no descuenta stock", () => {
  if (sinBase()) return;
  const srv = servicio("ESCUELA PRUEBA R4");
  const art = insumo(100);
  const id = M.createOrder({ empleadoId: supervisor(), servicioId: srv, asRole: "supervisor",
                             items: [{ productId: art, qty: 7 }] });
  const p = pedido(id);

  assert.equal(p.Status, "closed", "no queda esperando al depósito");
  assert.ok(p.contabilizado_at, "cuenta para Informes y la API");
  assert.equal(p.contabilizado_at, p.Fecha, "con la fecha en que se pidió");
  assert.ok(p.retiro_at);
  assert.equal(stockDe(art), 100, "no sale del depósito central");
});

test("un pedido de otro servicio sigue pasando por el depósito", () => {
  if (sinBase()) return;
  const srv = servicio("HOSPITAL CUALQUIERA");
  const id = M.createOrder({ empleadoId: supervisor(), servicioId: srv, asRole: "supervisor",
                             items: [{ productId: insumo(100), qty: 1 }] });
  const p = pedido(id);
  assert.equal(p.Status, "revision_deposito");
  assert.equal(p.contabilizado_at, null);
});

test("los que esperaban al depósito quedan contados con su fecha, y los demás no se tocan", () => {
  if (sinBase()) return;
  const r4 = servicio("ESC VIEJA", "RIO IV");
  const otro = servicio("CLUB OTRO");
  const viejo = (s) => Number(db.prepare(
    `INSERT INTO Pedidos (EmpleadoID, Rol, Total, Status, empresa_id, ServicioID, Fecha)
     VALUES (1, 'supervisor', 10, 'revision_deposito', 1, ?, '2026-09-21 14:08:07')`
  ).run(s).lastInsertRowid);
  const a = viejo(r4), b = viejo(otro);

  assert.ok(M.contarPedidosRioCuartoPendientes() >= 1);

  assert.equal(pedido(a).Status, "closed");
  assert.equal(pedido(a).contabilizado_at, "2026-09-21 14:08:07", "cae en el mes en que se pidió");
  assert.equal(pedido(b).Status, "revision_deposito", "el que no es de Río Cuarto no se toca");
  assert.equal(M.contarPedidosRioCuartoPendientes(), 0, "la segunda vez no hay nada que hacer");
});

test("el panel del depósito no muestra los pedidos de Río Cuarto", async () => {
  if (sinBase()) return;
  const r4 = M.createOrder({ empleadoId: supervisor(), servicioId: servicio("ESC PANEL R4"), asRole: "supervisor",
                             items: [{ productId: insumo(100), qty: 1 }] });
  const otro = M.createOrder({ empleadoId: supervisor(), servicioId: servicio("CLUB PANEL"), asRole: "supervisor",
                               items: [{ productId: insumo(100), qty: 1 }] });
  db.prepare(`UPDATE Pedidos SET empresa_id = 1 WHERE PedidoID IN (?, ?)`).run(r4, otro);

  const handler = deposito.stack.find((l) => l.route?.path === "/orders" && l.route.methods.get).route.stack.at(-1).handle;
  /** Los ids que muestra una solapa del panel. */
  const solapa = async (status) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } };
    await handler({ query: { status }, user: { empresaId: 1, id: 1, roles: ["deposito"] } }, res);
    return res.body.map((o) => Number(o.id));
  };

  assert.ok((await solapa("revision_deposito")).includes(otro), "el pedido común espera en Por confirmar");
  // El de Río Cuarto queda contado como retirado: tampoco ahí tiene que verse.
  for (const s of ["revision_deposito", "open", "preparing", "closed", "retirado"]) {
    assert.ok(!(await solapa(s)).includes(r4), `el de Río Cuarto no aparece en "${s}"`);
  }
});
