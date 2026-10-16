// Preparación de pedidos con pistola lectora.
//
// La pistola es un teclado: escanea, escribe el código y manda Enter. Lo que se
// prueba acá es que cada disparo caiga en la línea correcta, que no se pueda
// preparar de más, y que "terminé" NO cierre el pedido (cerrar dispara el mail
// al supervisor y el descuento de stock, y eso lo sigue decidiendo el jefe).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = path.join(os.tmpdir(), `kz_picking_${Date.now()}.db`);
const origen = path.resolve(import.meta.dirname, "../Kazaro.db");
const hayBase = fs.existsSync(origen);
if (hayBase) { fs.copyFileSync(origen, tmp); process.env.DB_PATH = tmp; }

const picking = await import("../src/picking.js");
const { db } = await import("../src/db.js");

after(() => {
  for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + ext); } catch {} }
});

const AHORA = "2026-10-14 12:00:00";
const EMPRESA = 1;
let seq = 0;
const unico = () => `${Date.now()}${(seq += 1).toString().padStart(3, "0")}`;

/** Un insumo del catálogo, con o sin código de barras. */
function insumo(nombre, codigoBarra = null) {
  const id = db.prepare(
    `INSERT INTO Productos (ProductName, Precio, Stock, empresa_id, codigo_barra, is_active)
     VALUES (?, 100, 999, ?, ?, 1)`
  ).run(nombre, EMPRESA, codigoBarra).lastInsertRowid;
  return Number(id);
}

/** Un pedido con sus líneas: [[productoId, cantidad], …] */
function pedido(lineas) {
  const id = Number(db.prepare(
    `INSERT INTO Pedidos (EmpleadoID, Rol, Total, Status, empresa_id)
     VALUES (1, 'supervisor', 0, 'open', ?)`
  ).run(EMPRESA).lastInsertRowid);
  for (const [productoId, cantidad] of lineas) {
    const p = db.prepare(`SELECT ProductName FROM Productos WHERE ProductID = ?`).get(productoId);
    db.prepare(
      `INSERT INTO PedidoItems (PedidoID, ProductoID, Nombre, Precio, Cantidad, Subtotal)
       VALUES (?, ?, ?, 100, ?, 0)`
    ).run(id, productoId, p.ProductName, cantidad);
  }
  return id;
}

const rolId = (nombre) =>
  db.prepare(`SELECT RolID FROM Roles WHERE Nombre = ? COLLATE NOCASE`).get(nombre)?.RolID;

/** Un operario: un empleado de verdad con rol Picking. */
function prepararA(nombre, { empresaId = EMPRESA, rol = picking.ROL_PICKING, activo = 1 } = {}) {
  const [n, a] = String(nombre).split(" ");
  const id = Number(db.prepare(
    `INSERT INTO Empleados (Nombre, Apellido, Email, username, is_active, empresa_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(n, a || "Picking", `p${unico()}@x.com`, `op.${unico()}`, activo, empresaId).lastInsertRowid);
  if (rol) db.prepare(`INSERT INTO Roles_Empleados (EmpleadoID, RolID) VALUES (?, ?)`).run(id, rolId(rol));
  return id;
}

const preparadaDe = (pedidoId, productoId) => db.prepare(
  `SELECT cantidad_preparada n FROM PedidoItems WHERE PedidoID = ? AND ProductoID = ?`
).get(pedidoId, productoId).n;

/* ========================= Preparadores ========================= */

test("el rol Picking se crea solo al arrancar", () => {
  if (!hayBase) return;
  assert.ok(rolId(picking.ROL_PICKING), "deberia existir el rol Picking");
});

test("preparador es un empleado con rol Picking, no cualquiera", () => {
  if (!hayBase) return;
  const conRol = prepararA(`Juan ${unico()}`);
  const sinRol = prepararA(`Pedro ${unico()}`, { rol: null });
  const deDeposito = prepararA(`Jefe ${unico()}`, { rol: "Deposito" });

  const ids = picking.listarPreparadores(db, EMPRESA).map((p) => p.id);
  assert.ok(ids.includes(conRol));
  assert.ok(!ids.includes(sinRol), "un empleado sin rol no prepara");
  assert.ok(!ids.includes(deDeposito), "el jefe de deposito no es preparador");
});

test("el empleado inactivo sale de la lista", () => {
  if (!hayBase) return;
  const id = prepararA(`Baja ${unico()}`, { activo: 0 });
  assert.ok(!picking.listarPreparadores(db, EMPRESA).some((p) => p.id === id));
});

test("esPreparador contesta lo mismo que la lista", () => {
  if (!hayBase) return;
  const si = prepararA(`Si ${unico()}`);
  const no = prepararA(`No ${unico()}`, { rol: null });
  assert.equal(picking.esPreparador(db, { empleadoId: si, empresaId: EMPRESA }), true);
  assert.equal(picking.esPreparador(db, { empleadoId: no, empresaId: EMPRESA }), false);
  // Y el de la otra empresa no entra por la ventana.
  assert.equal(picking.esPreparador(db, { empleadoId: si, empresaId: 2 }), false);
});

test("la lista es de cada empresa", () => {
  if (!hayBase) return;
  const mio = prepararA(`Comun ${unico()}`);
  const ajeno = prepararA(`Ajeno ${unico()}`, { empresaId: 2 });
  const ids = picking.listarPreparadores(db, EMPRESA).map((p) => p.id);
  assert.ok(ids.includes(mio));
  assert.ok(!ids.includes(ajeno));
});

/* ========================= Asignación ========================= */

test("asignar deja el pedido en preparacion y con dueño", () => {
  if (!hayBase) return;
  const id = pedido([[insumo(`A ${unico()}`), 5]]);
  const prep = prepararA(`Jefe asigna ${unico()}`);

  const r = picking.asignar(db, { pedidoId: id, preparadorId: prep, empresaId: EMPRESA, ahora: AHORA });
  assert.equal(r.ok, true);

  const p = db.prepare(`SELECT Status, preparador_id, preparacion_asignada_at FROM Pedidos WHERE PedidoID = ?`).get(id);
  assert.equal(p.Status, "preparing");
  assert.equal(p.preparador_id, prep);
  assert.equal(p.preparacion_asignada_at, AHORA);
});

test("no se le roba un pedido a otro preparador sin desasignar", () => {
  if (!hayBase) return;
  const id = pedido([[insumo(`B ${unico()}`), 2]]);
  const uno = prepararA(`Primero ${unico()}`);
  const dos = prepararA(`Segundo ${unico()}`);

  picking.asignar(db, { pedidoId: id, preparadorId: uno, empresaId: EMPRESA, ahora: AHORA });
  const r = picking.asignar(db, { pedidoId: id, preparadorId: dos, empresaId: EMPRESA, ahora: AHORA });
  assert.equal(r.ok, false);
  assert.match(r.error, /Primero/, "tendria que decir quien lo tiene");

  // Pero desasignando sí.
  picking.desasignar(db, { pedidoId: id, empresaId: EMPRESA });
  assert.equal(picking.asignar(db, { pedidoId: id, preparadorId: dos, empresaId: EMPRESA, ahora: AHORA }).ok, true);
});

test("lo que ya se separo no se pierde al reasignar", () => {
  if (!hayBase) return;
  const art = insumo(`C ${unico()}`, `779${unico()}`);
  const id = pedido([[art, 10]]);
  const uno = prepararA(`Arranca ${unico()}`);
  picking.asignar(db, { pedidoId: id, preparadorId: uno, empresaId: EMPRESA, ahora: AHORA });
  picking.cargarManual(db, { pedidoId: id, items: [{ productoId: art, cantidadPreparada: 4 }] });

  picking.desasignar(db, { pedidoId: id, empresaId: EMPRESA });
  assert.equal(preparadaDe(id, art), 4, "el que sigue no arranca de cero");
});

test("un pedido cerrado no se asigna", () => {
  if (!hayBase) return;
  const id = pedido([[insumo(`D ${unico()}`), 1]]);
  db.prepare(`UPDATE Pedidos SET Status = 'closed' WHERE PedidoID = ?`).run(id);
  const r = picking.asignar(db, { pedidoId: id, preparadorId: prepararA(`X ${unico()}`), empresaId: EMPRESA, ahora: AHORA });
  assert.equal(r.ok, false);
});

test("no se le asigna un pedido a alguien sin rol Picking", () => {
  if (!hayBase) return;
  const id = pedido([[insumo(`E ${unico()}`), 1]]);
  const sinRol = prepararA(`Se fue ${unico()}`, { rol: null });
  const r = picking.asignar(db, { pedidoId: id, preparadorId: sinRol, empresaId: EMPRESA, ahora: AHORA });
  assert.equal(r.ok, false);
  assert.match(r.error, /permiso/i);
});

test("el preparador ve solo lo suyo", () => {
  if (!hayBase) return;
  const mio  = pedido([[insumo(`F ${unico()}`), 1]]);
  const otro = pedido([[insumo(`G ${unico()}`), 1]]);
  const yo   = prepararA(`Yo ${unico()}`);
  const vos  = prepararA(`Vos ${unico()}`);
  picking.asignar(db, { pedidoId: mio,  preparadorId: yo,  empresaId: EMPRESA, ahora: AHORA });
  picking.asignar(db, { pedidoId: otro, preparadorId: vos, empresaId: EMPRESA, ahora: AHORA });

  const mios = picking.pedidosAsignados(db, { empresaId: EMPRESA, preparadorId: yo }).map((p) => p.id);
  assert.ok(mios.includes(mio));
  assert.ok(!mios.includes(otro), "no tendria que ver el pedido del otro");

  // El jefe, sin filtro, ve los dos.
  const todos = picking.pedidosAsignados(db, { empresaId: EMPRESA }).map((p) => p.id);
  assert.ok(todos.includes(mio) && todos.includes(otro));
});

/* ========================= El escaneo ========================= */

test("un disparo de la pistola suma uno", () => {
  if (!hayBase) return;
  const barra = `779${unico()}`;
  const art = insumo(`Detergente ${unico()}`, barra);
  const id = pedido([[art, 5]]);

  const r = picking.escanear(db, { pedidoId: id, codigoBarra: barra, empresaId: EMPRESA });
  assert.equal(r.ok, true);
  assert.equal(r.linea.preparada, 1);
  picking.escanear(db, { pedidoId: id, codigoBarra: barra, empresaId: EMPRESA });
  assert.equal(preparadaDe(id, art), 2);
});

test("la pistola manda espacios de mas y hay que aguantarlos", () => {
  if (!hayBase) return;
  const barra = `779${unico()}`;
  const art = insumo(`Espacios ${unico()}`, barra);
  const id = pedido([[art, 3]]);
  assert.equal(picking.escanear(db, { pedidoId: id, codigoBarra: ` ${barra} `, empresaId: EMPRESA }).ok, true);
  assert.equal(preparadaDe(id, art), 1);
});

test("un codigo que no es de ningun insumo avisa y no suma", () => {
  if (!hayBase) return;
  const art = insumo(`Solo ${unico()}`, `779${unico()}`);
  const id = pedido([[art, 5]]);
  const r = picking.escanear(db, { pedidoId: id, codigoBarra: "0000000000000", empresaId: EMPRESA });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, picking.MOTIVOS.NO_EXISTE);
  assert.equal(preparadaDe(id, art), 0);
});

test("un insumo que no esta en el pedido avisa con nombre y apellido", () => {
  if (!hayBase) return;
  // El error mas comun del deposito: agarrar del estante de al lado.
  const pedido1 = insumo(`Pedido ${unico()}`, `779${unico()}`);
  const vecino  = `779${unico()}`;
  insumo(`EL DE AL LADO ${unico()}`, vecino);
  const id = pedido([[pedido1, 5]]);

  const r = picking.escanear(db, { pedidoId: id, codigoBarra: vecino, empresaId: EMPRESA });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, picking.MOTIVOS.NO_ESTA_EN_PEDIDO);
  assert.match(r.error, /EL DE AL LADO/);
  assert.equal(preparadaDe(id, pedido1), 0);
});

test("no se puede preparar mas de lo que se pidio", () => {
  if (!hayBase) return;
  const barra = `779${unico()}`;
  const art = insumo(`Tope ${unico()}`, barra);
  const id = pedido([[art, 2]]);

  picking.escanear(db, { pedidoId: id, codigoBarra: barra, empresaId: EMPRESA });
  picking.escanear(db, { pedidoId: id, codigoBarra: barra, empresaId: EMPRESA });
  const r = picking.escanear(db, { pedidoId: id, codigoBarra: barra, empresaId: EMPRESA });

  assert.equal(r.ok, false);
  assert.equal(r.motivo, picking.MOTIVOS.YA_COMPLETO);
  assert.equal(preparadaDe(id, art), 2, "no tendria que haber pasado de 2");
});

/* ===== Escanear por codigo de articulo =====
   Las etiquetas que se imprimen acá llevan el código del artículo, no un EAN
   del fabricante. Si la pistola sólo mirara codigo_barra, habría que dar de
   alta 405 códigos a mano para algo que ya está cargado. */

test("la etiqueta con el codigo del articulo tambien suma", () => {
  if (!hayBase) return;
  const codigo = `AR${unico()}`.slice(0, 14);
  const art = Number(db.prepare(
    `INSERT INTO Productos (ProductName, Precio, Stock, empresa_id, is_active, Code)
     VALUES (?, 100, 99, 1, 1, ?)`
  ).run(`POR CODIGO ${unico()}`, codigo).lastInsertRowid);
  const id = pedido([[art, 5]]);

  const r = picking.escanear(db, { pedidoId: id, codigoBarra: codigo, empresaId: EMPRESA });
  assert.equal(r.ok, true, r.error);
  assert.equal(preparadaDe(id, art), 1);
});

test("los ceros de adelante no importan: 004 y 4 son el mismo articulo", () => {
  if (!hayBase) return;
  const n = String(900000 + (seq += 1));
  const art = Number(db.prepare(
    `INSERT INTO Productos (ProductName, Precio, Stock, empresa_id, is_active, Code)
     VALUES (?, 100, 99, 1, 1, ?)`
  ).run(`CEROS ${unico()}`, n).lastInsertRowid);
  const id = pedido([[art, 5]]);

  assert.equal(picking.escanear(db, { pedidoId: id, codigoBarra: `00${n}`, empresaId: EMPRESA }).ok, true);
  assert.equal(preparadaDe(id, art), 1);
});

test("el codigo de barras le gana al codigo de articulo", () => {
  if (!hayBase) return;
  // Un numero que es el EAN de uno y el codigo interno de otro: manda el EAN,
  // que es el que alguien asigno a proposito.
  const compartido = `77${unico()}`.slice(0, 13);
  const conBarra = Number(db.prepare(
    `INSERT INTO Productos (ProductName, Precio, Stock, empresa_id, is_active, Code, codigo_barra)
     VALUES (?, 100, 99, 1, 1, ?, ?)`
  ).run(`DUENIO DEL EAN ${unico()}`, `Z${unico()}`.slice(0, 14), compartido).lastInsertRowid);
  const conCodigo = Number(db.prepare(
    `INSERT INTO Productos (ProductName, Precio, Stock, empresa_id, is_active, Code)
     VALUES (?, 100, 99, 1, 1, ?)`
  ).run(`LO TIENE DE CODIGO ${unico()}`, compartido).lastInsertRowid);

  const id = pedido([[conBarra, 5], [conCodigo, 5]]);
  picking.escanear(db, { pedidoId: id, codigoBarra: compartido, empresaId: EMPRESA });
  assert.equal(preparadaDe(id, conBarra), 1, "tenia que ganar el del codigo de barras");
  assert.equal(preparadaDe(id, conCodigo), 0);
});

test("un insumo dado de baja no se encuentra por su codigo", () => {
  if (!hayBase) return;
  const codigo = `BA${unico()}`.slice(0, 14);
  const art = Number(db.prepare(
    `INSERT INTO Productos (ProductName, Precio, Stock, empresa_id, is_active, Code)
     VALUES (?, 100, 99, 1, 0, ?)`
  ).run(`DADO DE BAJA ${unico()}`, codigo).lastInsertRowid);
  const id = pedido([[art, 5]]);

  const r = picking.escanear(db, { pedidoId: id, codigoBarra: codigo, empresaId: EMPRESA });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, picking.MOTIVOS.NO_EXISTE);
});

test("el codigo de articulo de otra empresa tampoco sirve", () => {
  if (!hayBase) return;
  const codigo = `OE${unico()}`.slice(0, 14);
  db.prepare(
    `INSERT INTO Productos (ProductName, Precio, Stock, empresa_id, is_active, Code)
     VALUES (?, 100, 99, 2, 1, ?)`
  ).run(`DE PAZAR ${unico()}`, codigo);
  const id = pedido([[insumo(`Propio ${unico()}`), 5]]);

  assert.equal(picking.escanear(db, { pedidoId: id, codigoBarra: codigo, empresaId: EMPRESA }).motivo,
    picking.MOTIVOS.NO_EXISTE);
});

test("buscarPorEscaneo con basura devuelve null, no revienta", () => {
  if (!hayBase) return;
  for (const x of ["", "   ", null, undefined, "'; DROP TABLE Productos;--"]) {
    assert.equal(picking.buscarPorEscaneo(db, x, EMPRESA), null, `con ${JSON.stringify(x)}`);
  }
  assert.ok(db.prepare(`SELECT COUNT(*) n FROM Productos`).get().n > 0, "la tabla sigue viva");
});

test("el codigo de barras de otra empresa no sirve aca", () => {
  if (!hayBase) return;
  const barra = `779${unico()}`;
  const ajeno = Number(db.prepare(
    `INSERT INTO Productos (ProductName, Precio, Stock, empresa_id, codigo_barra, is_active)
     VALUES (?, 100, 10, 2, ?, 1)`
  ).run(`Ajeno ${unico()}`, barra).lastInsertRowid);
  const id = pedido([[insumo(`Propio ${unico()}`), 5]]);

  const r = picking.escanear(db, { pedidoId: id, codigoBarra: barra, empresaId: EMPRESA });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, picking.MOTIVOS.NO_EXISTE);
  assert.ok(ajeno > 0);
});

/* ========================= Carga a mano ========================= */

test("los bultos se cargan a mano de una", () => {
  if (!hayBase) return;
  const art = insumo(`Bulto ${unico()}`);  // sin codigo de barras
  const id = pedido([[art, 12]]);
  const r = picking.cargarManual(db, { pedidoId: id, items: [{ productoId: art, cantidadPreparada: 12 }] });
  assert.equal(r.ok, true);
  assert.equal(preparadaDe(id, art), 12);
});

test("a mano tampoco se puede pasar de lo pedido", () => {
  if (!hayBase) return;
  const art = insumo(`Pasado ${unico()}`);
  const id = pedido([[art, 3]]);
  const r = picking.cargarManual(db, { pedidoId: id, items: [{ productoId: art, cantidadPreparada: 99 }] });
  assert.equal(r.ok, false);
  assert.equal(preparadaDe(id, art), 0);
});

test("se puede corregir a la baja, incluso a cero", () => {
  if (!hayBase) return;
  const art = insumo(`Corrige ${unico()}`);
  const id = pedido([[art, 10]]);
  picking.cargarManual(db, { pedidoId: id, items: [{ productoId: art, cantidadPreparada: 7 }] });
  picking.cargarManual(db, { pedidoId: id, items: [{ productoId: art, cantidadPreparada: 0 }] });
  assert.equal(preparadaDe(id, art), 0);
});

test("una linea mala no arruina las buenas del mismo envio", () => {
  if (!hayBase) return;
  const bueno = insumo(`Bueno ${unico()}`);
  const malo  = insumo(`Malo ${unico()}`);
  const id = pedido([[bueno, 5], [malo, 5]]);
  const r = picking.cargarManual(db, {
    pedidoId: id,
    items: [{ productoId: bueno, cantidadPreparada: 5 }, { productoId: malo, cantidadPreparada: 50 }],
  });
  assert.equal(r.ok, false);
  assert.equal(r.errores.length, 1);
  assert.equal(preparadaDe(id, bueno), 5, "lo que estaba bien tenia que quedar");
  assert.equal(preparadaDe(id, malo), 0);
});

/* ========================= Las líneas y el avance ========================= */

test("las lineas dicen cual no tiene codigo de barras", () => {
  if (!hayBase) return;
  const conBarra = insumo(`Con ${unico()}`, `779${unico()}`);
  const sinBarra = insumo(`Sin ${unico()}`);
  const id = pedido([[conBarra, 2], [sinBarra, 3]]);

  const lineas = picking.lineasDePicking(db, id);
  assert.equal(lineas.length, 2);
  assert.ok(lineas.find((l) => l.productoId === conBarra).codigoBarra);
  assert.equal(lineas.find((l) => l.productoId === sinBarra).codigoBarra, null);
});

test("el contador de arriba dice cuanto falta", () => {
  if (!hayBase) return;
  const uno = insumo(`U1 ${unico()}`);
  const dos = insumo(`U2 ${unico()}`);
  const id = pedido([[uno, 4], [dos, 6]]);

  let a = picking.avance(db, id);
  assert.deepEqual(
    [a.lineas, a.lineasCompletas, a.unidadesPedidas, a.unidadesPreparadas, a.completo],
    [2, 0, 10, 0, false]
  );

  picking.cargarManual(db, { pedidoId: id, items: [
    { productoId: uno, cantidadPreparada: 4 }, { productoId: dos, cantidadPreparada: 6 },
  ]});
  a = picking.avance(db, id);
  assert.equal(a.lineasCompletas, 2);
  assert.equal(a.unidadesPreparadas, 10);
  assert.equal(a.completo, true);
});

/* ========================= Terminar ========================= */

test("terminar NO cierra el pedido: eso lo hace el jefe", () => {
  if (!hayBase) return;
  // Cerrar dispara el mail al supervisor y el descuento de stock.
  const art = insumo(`Fin ${unico()}`);
  const id = pedido([[art, 2]]);
  const prep = prepararA(`Termina ${unico()}`);
  picking.asignar(db, { pedidoId: id, preparadorId: prep, empresaId: EMPRESA, ahora: AHORA });
  picking.cargarManual(db, { pedidoId: id, items: [{ productoId: art, cantidadPreparada: 2 }] });

  const r = picking.terminar(db, { pedidoId: id, empresaId: EMPRESA, ahora: AHORA });
  assert.equal(r.ok, true);

  const p = db.prepare(`SELECT Status, cerrado, closedat, preparacion_terminada_at FROM Pedidos WHERE PedidoID = ?`).get(id);
  assert.equal(p.Status, "preparing", "tiene que seguir en preparacion");
  assert.ok(!p.closedat, "no se tenia que cerrar");
  assert.equal(p.preparacion_terminada_at, AHORA);
});

/* ===== Lo que no se preparo tiene que quedar PENDIENTE =====
   Sin esto, preparar 3 de 10 y cerrar le cobraba al servicio las 10: el cierre
   mira cantidad_pendiente, y la foto del despacho calcula Cantidad menos
   pendiente, asi que informaba que salieron 10 a todos lados. */

const pendienteDe = (pedidoId, productoId) => db.prepare(
  `SELECT COALESCE(cantidad_pendiente,0) n FROM PedidoItems WHERE PedidoID = ? AND ProductoID = ?`
).get(pedidoId, productoId).n;

test("terminar incompleto deja pendiente lo que falto", () => {
  if (!hayBase) return;
  const art = insumo(`Pend ${unico()}`);
  const id = pedido([[art, 10]]);
  const prep = prepararA(`Deja pend ${unico()}`);
  picking.asignar(db, { pedidoId: id, preparadorId: prep, empresaId: EMPRESA, ahora: AHORA });
  picking.cargarManual(db, { pedidoId: id, items: [{ productoId: art, cantidadPreparada: 3 }] });

  const r = picking.terminar(db, { pedidoId: id, empresaId: EMPRESA, ahora: AHORA });
  assert.equal(r.ok, true);
  assert.equal(r.pendiente, 7);
  assert.equal(pendienteDe(id, art), 7, "las 7 que no se juntaron quedan pendientes");
});

test("el consumo baja a lo que realmente salio", () => {
  if (!hayBase) return;
  // Es el punto de todo: no cobrarle al servicio lo que nunca recibio.
  const art = insumo(`Consumo ${unico()}`);
  const id = pedido([[art, 10]]);
  const prep = prepararA(`Consumo ${unico()}`);
  picking.asignar(db, { pedidoId: id, preparadorId: prep, empresaId: EMPRESA, ahora: AHORA });
  picking.cargarManual(db, { pedidoId: id, items: [{ productoId: art, cantidadPreparada: 3 }] });
  picking.terminar(db, { pedidoId: id, empresaId: EMPRESA, ahora: AHORA });

  const n = db.prepare(`SELECT Cantidad c FROM v_pedido_items_neto WHERE PedidoID = ?`).get(id);
  assert.equal(n.c, 3, "tiene que contar 3, no 10");
});

test("si se preparo todo, no queda ningun pendiente", () => {
  if (!hayBase) return;
  const art = insumo(`Completo ${unico()}`);
  const id = pedido([[art, 4]]);
  const prep = prepararA(`Completo ${unico()}`);
  picking.asignar(db, { pedidoId: id, preparadorId: prep, empresaId: EMPRESA, ahora: AHORA });
  picking.cargarManual(db, { pedidoId: id, items: [{ productoId: art, cantidadPreparada: 4 }] });

  const r = picking.terminar(db, { pedidoId: id, empresaId: EMPRESA, ahora: AHORA });
  assert.equal(r.pendiente, 0);
  assert.equal(pendienteDe(id, art), 0);
});

test("lo preparado manda sobre lo que el deposito habia cargado a mano", () => {
  if (!hayBase) return;
  const art = insumo(`Pisa ${unico()}`);
  const id = pedido([[art, 10]]);
  db.prepare(`UPDATE PedidoItems SET cantidad_pendiente = 2 WHERE PedidoID = ?`).run(id);
  const prep = prepararA(`Pisa ${unico()}`);
  picking.asignar(db, { pedidoId: id, preparadorId: prep, empresaId: EMPRESA, ahora: AHORA });
  picking.cargarManual(db, { pedidoId: id, items: [{ productoId: art, cantidadPreparada: 6 }] });
  picking.terminar(db, { pedidoId: id, empresaId: EMPRESA, ahora: AHORA });

  assert.equal(pendienteDe(id, art), 4, "lo que se junto de verdad son 6, faltan 4");
});

test("con varios insumos, cada uno lleva su propio pendiente", () => {
  if (!hayBase) return;
  const a = insumo(`Multi A ${unico()}`), b = insumo(`Multi B ${unico()}`);
  const id = pedido([[a, 10], [b, 5]]);
  const prep = prepararA(`Multi ${unico()}`);
  picking.asignar(db, { pedidoId: id, preparadorId: prep, empresaId: EMPRESA, ahora: AHORA });
  picking.cargarManual(db, { pedidoId: id, items: [
    { productoId: a, cantidadPreparada: 10 }, { productoId: b, cantidadPreparada: 1 },
  ]});
  picking.terminar(db, { pedidoId: id, empresaId: EMPRESA, ahora: AHORA });

  assert.equal(pendienteDe(id, a), 0, "ese se junto entero");
  assert.equal(pendienteDe(id, b), 4);
});

test("terminar sin preparar nada deja todo pendiente", () => {
  if (!hayBase) return;
  const art = insumo(`Nada ${unico()}`);
  const id = pedido([[art, 8]]);
  const prep = prepararA(`Nada ${unico()}`);
  picking.asignar(db, { pedidoId: id, preparadorId: prep, empresaId: EMPRESA, ahora: AHORA });

  const r = picking.terminar(db, { pedidoId: id, empresaId: EMPRESA, ahora: AHORA });
  assert.equal(r.pendiente, 8);
  assert.equal(pendienteDe(id, art), 8);
});

test("un pedido que no paso por el picking no se toca", () => {
  if (!hayBase) return;
  // El circuito manual del deposito sigue funcionando igual.
  const art = insumo(`Manual ${unico()}`);
  const id = pedido([[art, 10]]);
  db.prepare(`UPDATE PedidoItems SET cantidad_pendiente = 2 WHERE PedidoID = ?`).run(id);
  assert.equal(picking.terminar(db, { pedidoId: id, empresaId: EMPRESA, ahora: AHORA }).ok, false);
  assert.equal(pendienteDe(id, art), 2, "el pendiente cargado a mano sigue intacto");
});

test("se puede terminar incompleto: puede no haber stock", () => {
  if (!hayBase) return;
  const art = insumo(`Falta ${unico()}`);
  const id = pedido([[art, 10]]);
  const prep = prepararA(`Incompleto ${unico()}`);
  picking.asignar(db, { pedidoId: id, preparadorId: prep, empresaId: EMPRESA, ahora: AHORA });
  picking.cargarManual(db, { pedidoId: id, items: [{ productoId: art, cantidadPreparada: 3 }] });

  const r = picking.terminar(db, { pedidoId: id, empresaId: EMPRESA, ahora: AHORA });
  assert.equal(r.ok, true);
  assert.equal(r.avance.completo, false);
  assert.equal(r.avance.unidadesPreparadas, 3);
});

test("un pedido sin asignar no se puede terminar", () => {
  if (!hayBase) return;
  const id = pedido([[insumo(`Huerfano ${unico()}`), 1]]);
  assert.equal(picking.terminar(db, { pedidoId: id, empresaId: EMPRESA, ahora: AHORA }).ok, false);
});

test("el jefe puede devolverselo al preparador", () => {
  if (!hayBase) return;
  const id = pedido([[insumo(`Devuelto ${unico()}`), 1]]);
  const prep = prepararA(`Devuelve ${unico()}`);
  picking.asignar(db, { pedidoId: id, preparadorId: prep, empresaId: EMPRESA, ahora: AHORA });
  picking.terminar(db, { pedidoId: id, empresaId: EMPRESA, ahora: AHORA });

  assert.equal(picking.reabrir(db, { pedidoId: id, empresaId: EMPRESA }).ok, true);
  const p = db.prepare(`SELECT preparacion_terminada_at t, preparador_id FROM Pedidos WHERE PedidoID = ?`).get(id);
  assert.equal(p.t, null);
  assert.equal(p.preparador_id, prep, "sigue siendo del mismo");
});

test("volver a asignar limpia el terminado", () => {
  if (!hayBase) return;
  const id = pedido([[insumo(`Reasigna ${unico()}`), 1]]);
  const prep = prepararA(`Reasigna ${unico()}`);
  picking.asignar(db, { pedidoId: id, preparadorId: prep, empresaId: EMPRESA, ahora: AHORA });
  picking.terminar(db, { pedidoId: id, empresaId: EMPRESA, ahora: AHORA });
  picking.asignar(db, { pedidoId: id, preparadorId: prep, empresaId: EMPRESA, ahora: AHORA });

  const p = db.prepare(`SELECT preparacion_terminada_at t FROM Pedidos WHERE PedidoID = ?`).get(id);
  assert.equal(p.t, null);
});

/* ========================= Multiempresa ========================= */

/* ========================= El reparto ========================= */

test("para asignar se ofrecen los pendientes sin dueño", () => {
  if (!hayBase) return;
  const libre = pedido([[insumo(`Libre ${unico()}`), 2]]);
  const tomado = pedido([[insumo(`Tomado ${unico()}`), 2]]);
  picking.asignar(db, { pedidoId: tomado, preparadorId: prepararA(`Toma ${unico()}`),
                        empresaId: EMPRESA, ahora: AHORA });

  const ids = picking.pendientesParaAsignar(db, EMPRESA).map((p) => p.id);
  assert.ok(ids.includes(libre));
  assert.ok(!ids.includes(tomado), "el que ya tiene dueño no se vuelve a ofrecer");
});

test("los pedidos viejos no se ofrecen: nunca se van a preparar", () => {
  if (!hayBase) return;
  // Antes del 01/08/2026 los pedidos se contabilizaban al crearse y quedaron
  // "abiertos" para siempre. En produccion son 352, el mas viejo de octubre
  // de 2025, y hacian ilegible la lista de asignar.
  const viejo = pedido([[insumo(`Viejo ${unico()}`), 2]]);
  db.prepare(`UPDATE Pedidos SET Fecha = '2025-10-23 10:00:00' WHERE PedidoID = ?`).run(viejo);
  const nuevo = pedido([[insumo(`Nuevo ${unico()}`), 2]]);
  db.prepare(`UPDATE Pedidos SET Fecha = '2026-09-15 10:00:00' WHERE PedidoID = ?`).run(nuevo);

  const ids = picking.pendientesParaAsignar(db, EMPRESA).map((p) => p.id);
  assert.ok(!ids.includes(viejo), "el de 2025 no tendria que aparecer");
  assert.ok(ids.includes(nuevo));
});

test("el primer dia del corte entra", () => {
  if (!hayBase) return;
  const justo = pedido([[insumo(`Justo ${unico()}`), 1]]);
  db.prepare(`UPDATE Pedidos SET Fecha = ? WHERE PedidoID = ?`)
    .run(`${picking.DESDE_PARA_PREPARAR} 00:00:00`, justo);
  assert.ok(picking.pendientesParaAsignar(db, EMPRESA).map((p) => p.id).includes(justo));
});

test("el dia anterior al corte no entra", () => {
  if (!hayBase) return;
  const antes = pedido([[insumo(`Antes ${unico()}`), 1]]);
  db.prepare(`UPDATE Pedidos SET Fecha = '2026-08-31 23:59:00' WHERE PedidoID = ?`).run(antes);
  assert.ok(!picking.pendientesParaAsignar(db, EMPRESA).map((p) => p.id).includes(antes));
});

test("se puede correr el corte si alguna vez hace falta", () => {
  if (!hayBase) return;
  const viejo = pedido([[insumo(`Corrido ${unico()}`), 1]]);
  db.prepare(`UPDATE Pedidos SET Fecha = '2025-10-23 10:00:00' WHERE PedidoID = ?`).run(viejo);
  const ids = picking.pendientesParaAsignar(db, EMPRESA, { desde: "2025-01-01" }).map((p) => p.id);
  assert.ok(ids.includes(viejo));
});

test("lo que no esta en Pendientes no se ofrece", () => {
  if (!hayBase) return;
  const cerrado = pedido([[insumo(`Cerrado ${unico()}`), 1]]);
  db.prepare(`UPDATE Pedidos SET Status = 'closed' WHERE PedidoID = ?`).run(cerrado);
  const borrado = pedido([[insumo(`Borrado ${unico()}`), 1]]);
  db.prepare(`UPDATE Pedidos SET deleted_at = ? WHERE PedidoID = ?`).run(AHORA, borrado);

  const ids = picking.pendientesParaAsignar(db, EMPRESA).map((p) => p.id);
  assert.ok(!ids.includes(cerrado));
  assert.ok(!ids.includes(borrado));
});

test("el reparto trae lo de la empresa y nada mas", () => {
  if (!hayBase) return;
  const ajeno = Number(db.prepare(
    `INSERT INTO Pedidos (EmpleadoID, Rol, Total, Status, empresa_id) VALUES (1,'supervisor',0,'open',2)`
  ).run().lastInsertRowid);
  assert.ok(!picking.pendientesParaAsignar(db, EMPRESA).map((p) => p.id).includes(ajeno));
});

/* ========================= El operario y lo ajeno ========================= */

// Lo más importante de todo el picking: el operario entra con su usuario y
// SOLO puede tocar lo que le asignaron. Si no, con cambiar el número en la URL
// prepararía el pedido de cualquiera.
test("el operario no puede abrir ni tocar un pedido que no es suyo", async () => {
  if (!hayBase) return;
  const router = (await import("../src/routes/deposito.js")).default;
  const handler = (metodo, ruta) => router.stack
    .find((l) => l.route?.path === ruta && l.route.methods[metodo]).route.stack.at(-1).handle;

  const yo   = prepararA(`Yo op ${unico()}`);
  const otro = prepararA(`Otro op ${unico()}`);
  const art  = insumo(`Ajeno ${unico()}`, `779${unico()}`);
  const suyo = pedido([[art, 5]]);
  picking.asignar(db, { pedidoId: suyo, preparadorId: otro, empresaId: EMPRESA, ahora: AHORA });

  const llamar = (metodo, ruta, body = {}, esOperario = true) => new Promise((resolve) => {
    const req = { params: { id: String(suyo) }, body, query: {},
                  esOperario, user: { id: yo, empresaId: EMPRESA, roles: ["picking"] } };
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; },
                  json(d) { resolve({ status: this.statusCode, body: d }); } };
    Promise.resolve(handler(metodo, ruta)(req, res)).catch((e) => resolve({ status: 500, body: { error: e.message } }));
  });

  assert.equal((await llamar("get", "/orders/:id/picking")).status, 404, "pudo espiarlo");
  assert.equal((await llamar("post", "/orders/:id/picking/escanear",
                             { codigoBarra: `779${unico()}` })).status, 404, "pudo escanearlo");
  assert.equal((await llamar("put", "/orders/:id/picking",
                             { items: [{ productoId: art, cantidadPreparada: 5 }] })).status, 404, "pudo cargarlo");
  assert.equal((await llamar("put", "/orders/:id/picking/terminar")).status, 404, "pudo terminarlo");

  assert.equal(preparadaDe(suyo, art), 0, "no se tenia que mover nada");

  // Control: el 404 de arriba tiene que venir de que el pedido es ajeno, no de
  // que el handler esté roto. El jefe, sobre el mismo pedido, entra.
  assert.equal((await llamar("get", "/orders/:id/picking", {}, false)).status, 200);
});

/* ========================= Las rutas ========================= */

// deposito.js termina con router.put("/orders/:id/:action"), que es un comodín
// y se come cualquier PUT de dos segmentos. Si una ruta del picking queda
// DEBAJO, deja de existir sin que nadie se entere: contesta 500 "Sin columnas
// de estado". Esto es lo único que lo detecta.
test("las rutas del picking ganan contra el comodin de estados", async () => {
  if (!hayBase) return;
  const router = (await import("../src/routes/deposito.js")).default;

  const primera = (metodo, ruta) => router.stack
    .findIndex((l) => l.route?.path === ruta && l.route.methods[metodo]);
  const comodin = primera("put", "/orders/:id/:action");
  assert.ok(comodin > 0, "no se encontro el comodin: cambio de nombre?");

  for (const ruta of ["/orders/:id/asignar", "/orders/:id/desasignar",
                      "/orders/:id/picking"]) {
    const i = primera("put", ruta);
    assert.ok(i >= 0, `falta la ruta ${ruta}`);
    assert.ok(i < comodin, `${ruta} quedo DEBAJO del comodin y nunca se va a ejecutar`);
  }
});

test("estan todas las rutas que usa la pantalla", async () => {
  if (!hayBase) return;
  const router = (await import("../src/routes/deposito.js")).default;
  const hay = (metodo, ruta) => router.stack
    .some((l) => l.route?.path === ruta && l.route.methods[metodo]);

  for (const [m, r] of [
    ["get", "/preparadores"], ["get", "/preparacion/asignables"],
    ["get", "/preparacion"], ["get", "/orders/:id/picking"],
    ["post", "/orders/:id/picking/escanear"], ["put", "/orders/:id/picking"],
    ["put", "/orders/:id/picking/terminar"], ["put", "/orders/:id/picking/reabrir"],
    ["put", "/orders/:id/asignar"], ["put", "/orders/:id/desasignar"],
  ]) {
    assert.ok(hay(m, r), `falta ${m.toUpperCase()} ${r}`);
  }
});

test("no se toca un pedido de otra empresa", () => {
  if (!hayBase) return;
  const id = Number(db.prepare(
    `INSERT INTO Pedidos (EmpleadoID, Rol, Total, Status, empresa_id) VALUES (1,'supervisor',0,'open',2)`
  ).run().lastInsertRowid);
  const prep = prepararA(`Curioso ${unico()}`);

  assert.equal(picking.asignar(db, { pedidoId: id, preparadorId: prep, empresaId: EMPRESA, ahora: AHORA }).ok, false);
  assert.equal(picking.desasignar(db, { pedidoId: id, empresaId: EMPRESA }).ok, false);
  assert.equal(picking.terminar(db, { pedidoId: id, empresaId: EMPRESA, ahora: AHORA }).ok, false);
});
