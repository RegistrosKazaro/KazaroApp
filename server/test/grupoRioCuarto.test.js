// Río Cuarto: mails propios por servicio y presupuesto compartido por grupo.
//
// Dos cosas distintas que se pidieron juntas (20/10/2026):
//
//   1. Los pedidos de esos servicios avisan a 3 direcciones y a nadie más. La
//      regla va pegada al SERVICIO, no al supervisor: si mañana otra persona
//      pide para ese servicio, el mail sale igual.
//
//   2. Las escuelas comparten el presupuesto de MIN. EDUC - ZONA RIO IV, y lo
//      que se controla es la SUMA DEL MES de todas, no cada pedido suelto.
//      Mismo esquema para EPEC. Al 100% del presupuesto del padre.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = path.join(os.tmpdir(), `kz_rio4_${Date.now()}.db`);
const origen = path.resolve(import.meta.dirname, "../Kazaro.db");
let db = null, M = null;

before(async () => {
  if (!fs.existsSync(origen)) return;
  fs.copyFileSync(origen, tmp);
  process.env.DB_PATH = tmp;
  M = await import("../src/db.js");
  ({ db } = M);
});

after(() => {
  for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + ext); } catch {} }
});

const sinBase = () => !db;
let seq = 0;
const unico = () => `${Date.now()}${(seq += 1).toString().padStart(3, "0")}`;

const servicio = (nombre) => Number(db.prepare(
  `INSERT INTO Servicios (ServicioNombre, empresa_id) VALUES (?, 1)`
).run(`${nombre} ${unico()}`).lastInsertRowid);

/** Un pedido de ese servicio con su importe, en la fecha que se diga. */
function pedidoDe(servicioId, total, fecha = null) {
  const cuando = fecha || new Date().toISOString().slice(0, 19).replace("T", " ");
  const id = Number(db.prepare(
    `INSERT INTO Pedidos (EmpleadoID, Rol, Total, empresa_id, Status, ServicioID, Fecha)
     VALUES (1, 'supervisor', ?, 1, 'closed', ?, ?)`
  ).run(total, servicioId, cuando).lastInsertRowid);
  const prod = Number(db.prepare(
    `INSERT INTO Productos (ProductName, Precio, Stock, empresa_id, is_active, Code)
     VALUES (?, ?, 99, 1, 1, ?)`
  ).run(`RIO4 ${unico()}`, total, `R4${unico()}`.slice(-14)).lastInsertRowid);
  db.prepare(
    `INSERT INTO PedidoItems (PedidoID, ProductoID, Nombre, Cantidad, Precio, Subtotal, cantidad_pendiente)
     VALUES (?, ?, 'RIO4', 1, ?, ?, 0)`
  ).run(id, prod, total, total);
  return id;
}

/* ===================== Mails propios por servicio ===================== */

const TRES = "nicolas.barcena@kazaro.com.ar,alejandro.diaz@kazaro.com.ar,gerencia.afason@gmail.com";

test("un servicio sin regla no cambia a quién se le avisa", () => {
  if (sinBase()) return;
  assert.equal(M.destinoMailDeServicio(servicio("SIN REGLA")), null);
});

test("un servicio con regla devuelve sus destinatarios", () => {
  if (sinBase()) return;
  const id = servicio("CON REGLA");
  db.prepare(`INSERT INTO servicio_mail_destino (ServicioID, Destinatarios) VALUES (?, ?)`).run(id, TRES);
  assert.equal(M.destinoMailDeServicio(id), TRES);
});

test("una regla vacia es como no tener regla, no manda a nadie", () => {
  if (sinBase()) return;
  const id = servicio("REGLA VACIA");
  db.prepare(`INSERT INTO servicio_mail_destino (ServicioID, Destinatarios) VALUES (?, ?)`).run(id, "   ");
  assert.equal(M.destinoMailDeServicio(id), null);
});

/* ===================== Presupuesto de la bolsa ===================== */

/** Un padre con presupuesto y dos hijos colgando. */
function bolsa(presupuesto) {
  const padre = servicio("PADRE BOLSA");
  db.prepare(`INSERT OR REPLACE INTO service_budget (ServicioID, Presupuesto, MaxPct) VALUES (?, ?, 100)`)
    .run(padre, presupuesto);
  const hijos = [servicio("HIJO A"), servicio("HIJO B")];
  for (const h of hijos) {
    db.prepare(`INSERT OR REPLACE INTO service_budget_grupo (ServicioID, PadreID) VALUES (?, ?)`).run(h, padre);
  }
  return { padre, hijos };
}

test("un servicio suelto no pertenece a ninguna bolsa", () => {
  if (sinBase()) return;
  assert.equal(M.grupoDeServicio(servicio("SUELTO")), null);
});

test("el hijo sabe de que bolsa come y cuanto hay", () => {
  if (sinBase()) return;
  const { padre, hijos } = bolsa(1000000);
  const g = M.grupoDeServicio(hijos[0]);
  assert.equal(g.padreId, padre);
  assert.equal(g.presupuesto, 1000000);
});

test("el gasto del mes SUMA el de todos los hermanos", () => {
  if (sinBase()) return;
  // Es el punto: la bolsa es comun, no un tope por servicio.
  const { padre, hijos } = bolsa(1000000);
  pedidoDe(hijos[0], 30000);
  pedidoDe(hijos[1], 20000);
  assert.equal(M.gastoDelMesDelGrupo(padre), 50000);
});

test("lo de otra bolsa no se mezcla", () => {
  if (sinBase()) return;
  const a = bolsa(1000000), b = bolsa(1000000);
  pedidoDe(a.hijos[0], 30000);
  pedidoDe(b.hijos[0], 70000);
  assert.equal(M.gastoDelMesDelGrupo(a.padre), 30000);
  assert.equal(M.gastoDelMesDelGrupo(b.padre), 70000);
});

test("los pedidos de meses anteriores no gastan la bolsa de este mes", () => {
  if (sinBase()) return;
  const { padre, hijos } = bolsa(1000000);
  pedidoDe(hijos[0], 80000, "2026-01-15 10:00:00");
  pedidoDe(hijos[0], 5000);
  assert.equal(M.gastoDelMesDelGrupo(padre), 5000);
});

test("un pedido borrado deja de gastar la bolsa", () => {
  if (sinBase()) return;
  const { padre, hijos } = bolsa(1000000);
  const id = pedidoDe(hijos[0], 40000);
  assert.equal(M.gastoDelMesDelGrupo(padre), 40000);
  db.prepare(`UPDATE Pedidos SET deleted_at = datetime('now') WHERE PedidoID = ?`).run(id);
  assert.equal(M.gastoDelMesDelGrupo(padre), 0);
});

test("lo devuelto vuelve a la bolsa", () => {
  if (sinBase()) return;
  // Se mide por el neto: si el servicio devolvio, no lo consumio.
  const { padre, hijos } = bolsa(1000000);
  const id = pedidoDe(hijos[0], 60000);
  const prod = db.prepare(`SELECT ProductoID p FROM PedidoItems WHERE PedidoID = ?`).get(id).p;
  db.prepare(
    `INSERT INTO devoluciones (pedido_id, producto_id, cantidad, empresa_id, estado, tipo, fecha_resolucion)
     VALUES (?, ?, 1, 1, 'aprobada', 'no_usado', datetime('now'))`
  ).run(id, prod);
  assert.equal(M.gastoDelMesDelGrupo(padre), 0, "se devolvio entero: no gasto nada");
});

test("los hijos de la bolsa se pueden listar", () => {
  if (sinBase()) return;
  const { padre, hijos } = bolsa(1000000);
  const ids = M.hijosDelGrupo(padre).map((h) => h.id);
  assert.equal(ids.length, 2);
  for (const h of hijos) assert.ok(ids.includes(h));
});

test("una bolsa sin presupuesto cargado no frena nada", () => {
  if (sinBase()) return;
  // EPEC - ZONA F RIO IV todavia no tiene presupuesto: no debe bloquear.
  const padre = servicio("PADRE SIN PRESUPUESTO");
  const hijo = servicio("HIJO SIN PRESUPUESTO");
  db.prepare(`INSERT OR REPLACE INTO service_budget_grupo (ServicioID, PadreID) VALUES (?, ?)`).run(hijo, padre);
  assert.equal(Number(M.grupoDeServicio(hijo).presupuesto), 0);
});
