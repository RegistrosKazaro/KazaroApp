// Ingreso de mercaderia
// Hasta aqui el stock solo bajaba, lo que se vigila en estos tests es donde se mueve
// la factura y lo mueve UNA sola vez. Si alguno de estos falla, el stock de la empresa queda 
// inflado sin que nadie se entere
 
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { th } from "zod/v4/locales";
import { registry } from "zod/v4";

const tmp = path.join(os.tmpdir(),
`kz_ingresos_${Date.now()}.db`);
const origen = path.resolve(import.meta.dirname,
    "../kazaro.db");
let ing = null;
let db = null;

before(async () =>{
    if (!fs.existsSync(origen)) return;
    fs.copyFileSync(origen, tmp);
    process.env.DB_PATH = tmp;
    ing = await import("../src/ingresos.js");
    ({ db } = await import("../src/db.js"));
});

after(() =>{
    for (const ext of ["", "-wal", "-shm"]) { try {
        fs.unlinkSync(tmp + ext);
    } catch{} }
});

const sinBase = () => !ing || !db;

let seq = 0;
const unico = () => `ING${Date.now()}${(seq += 1)}`;

/** Un insumo con el stock que se le diga. Por defecto de Kazaro. */
function insumo(stock, empresaId = 1) {
  const code = unico().slice(-14);
  return Number(db.prepare(
    `INSERT INTO Productos (ProductName, Precio, Stock, empresa_id, is_active, Code)
     VALUES (?, 1, ?, ?, 1, ?)`
  ).run(`ING ${code}`, stock, empresaId, code).lastInsertRowid);
}

const stockDe = (id) => Number(db.prepare(`SELECT Stock FROM Productos WHERE ProductID = ?`).get(id).Stock);

/** Carga un remito de una linea y devuelve {id, itemId} */

function remito(productoId, cantidad, extra = {}){
    const id = ing.crearRemito({
        empresaId: 1,
        proveedor: "PROVEEDOR TEST",
        numero: unico(),
        fecha: "2026-10-26",
        items: [{ productoId, cantidad }],
        ...extra,
    });
    const itemId = db.prepare(`SELECT id FROM ingreso_items WHERE ingreso_id = ?`).get(id).id;
    return { id, itemId };
}

test("cargar el remito No toca el stock", async () => {
    if (sinBase()) return;
    const p = insumo(100);

    remito(p, 50);

    assert.equal(stockDe(p), 100);
});

test("asociar la factura sube el stock", async () =>{
    if (sinBase()) return;
    const p = insumo(100);
    const { id, itemId } = remito(p, 50);
    
    const r = ing.asociarFactura({
        empresaId: 1, ingresoId: id, numeroFactura: "A-0001-00001234", fechaFactura: "2026-10-27",
        lineas: [{ itemId, cantidad: 50, precioUnitario: 1200}],
    });

    assert.equal(stockDe(p), 150);
    assert.equal(r.unidades, 50);
    assert.equal(r.lineas, 1);
});

test("la factura deja el precio unitario en la linea", async () =>{
    if (sinBase()) return;

    const p = insumo(0);
    const { id, itemId } = remito(p, 10);

    ing.asociarFactura({
        empresaId: 1, ingresoId: id, numeroFactura: unico(),
        lineas: [{ itemId, cantidad: 10, precioUnitario: 3450.5}],
    });
    const linea = db.prepare(`SELECT precio_unitario p FROM ingreso_items WHERE id = ?`).get(itemId);
    assert.equal(Number(linea.p), 3450.5);
});

test("si la cantidad de la factura no coincide, no se asocia ni se toca el stock", async () =>{
    if (sinBase()) return;

    const p = insumo(100);
    const { id, itemId } = remito(p, 50);

    assert.throws(
        () => ing.asociarFactura({
            empresaId: 1, ingresoId: id, numeroFactura: unico(),
            lineas: [{ itemId, cantidad: 48, precioUnitario: 10}],
        }),
        (e) =>{
            assert.match(e.message, /no coincide/i);
            assert.equal(e.diferencias[0].remito, 50);
            assert.equal(e.diferencias[0].factura, 48);
            return true;
        }
    );
    assert.equal(stockDe(p),100);
    assert.equal(
        db.prepare(`SELECT estado FROM ingresos_mercaderia WHERE id = ?`).get(id).estado,
        "cargado"
    );
});

test("una factura que no cubre todas las lineas no se asocia", async() =>{
    if (sinBase()) return;
    const a = insumo(100);
    const b = insumo(100);
    const id = ing.crearRemito({
        empresaId: 1, proveedor: "PROVEEDOR TEST", numero: unico(),
                items: [{ productoId: a, cantidad: 5}, { productoId: b, cantidad: 7}],
    });
    const items = db.prepare(`SELECT id FROM ingreso_items WHERE ingreso_id = ?`).all(id);

    assert.throws(() => ing.asociarFactura({
        empresaId: 1, ingresoId: id, numeroFactura: unico(),
        lineas: [{ itemId: items[0].id, cantidad: 5,
            precioUnitario: 1
        }],
    }),/todas las líneas/i);
    assert.equal(stockDe(a), 100, "la primera linea tampoco se tenia que aplicar");
    assert.equal(stockDe(b), 100);
});

test("el mismo remito no se puede facturar dos veces", async() => {
    if (sinBase()) return;

    const p = insumo(0);
    const { id, itemId } = remito(p,20);
    const lineas = [{ itemId, cantidad: 20, precioUnitario: 100}];

    ing.asociarFactura({ empresaId: 1, ingresoId: id, 
        numeroFactura: unico(), lineas
    });
    assert.equal(stockDe(p), 20);
    assert.throws(
        () => ing.asociarFactura({ empresaId:1, ingresoId: id, numeroFactura: unico(), lineas}),
        /ya tiene factura/i
    );
    assert.equal(stockDe(p),20, "no tenia que volver a subir")
});

test("el mismo remito del mismo proveedor no entra dos veces", async() =>{
    if (sinBase()) return;
    const p = insumo(0);
    const numero = unico();
    const args = {
        empresaId: 1, proveedor: "Proveedor Repetido",
        numero,
        items: [{ productoId: p, cantidad: 1 }],
    };
    ing.crearRemito(args);

    assert.throws(
        () => ing.crearRemito({ ...args, proveedor: "PROVEEDOR REPETIDO" }),
        /ya esta cargado el remito/i
    );
});

test("in remito con una linea invalida no se puede guardar a medias", async() =>{
    if (sinBase()) return;
    const bueno = insumo(100);
    const numero = unico();

    assert.throws(() => ing.crearRemito({
        empresaId: 1, proveedor: "PROVEEDOR TEST", numero, 
        items: [{ productoId: bueno, cantidad: 10}, {
            productoId: bueno, cantidad: 0
        }],
    }), /cantidad invalida/i);
    
    const quedo = db.prepare(`
                SELECT COUNT(*) n FROM ingresos_mercaderia WHERE numero = ?`).get(numero).n;
        assert.equal(quedo, 0, "no tenia que quedar el remito cargado");
});

test("no se puede ingresar un insumo de otra empresa", async() =>{
    if (sinBase()) return;

    const dePazar = insumo(50, 2);

    assert.throws(() => ing.crearRemito({
        empresaId: 1, proveedor: "PROVEEDOR TEST", numero: unico(),
        items: [{ productoId: dePazar, cantidad: 5}],
    }), /no existe en esta empresa/i);

    assert.equal(stockDe(dePazar), 50);
});

test("un remito sin insumos no entra", async() =>{
    if(sinBase()) return;
    assert.throws(() => ing.crearRemito({
        empresaId:1, proveedor: "PROVEEDOR TEST", numero: unico(), items: [],
    }),/no tiene insumo/i);
});

test("falta el proveedor o el numero y lo dice", async() =>{
    if (sinBase()) return;
    const p = insumo(0);
    const items = [{ productoId: p, cantidad: 1 }];

    assert.throws(() => ing.crearRemito({ empresaId:1, proveedor: " ", numero: unico(), items }),/proveedor/i);
    assert.throws(() => ing.crearRemito({ empresaId:1, proveedor: "x", numero: " ", items}),/numero del remito/i);
    assert.throws(() => ing.asociarFactura({ empresaId:1, ingresoId: 1, numeroFactura: ""}),/factura/i);
});

test("sin fecha toma la de hoy", async() =>{
    if(sinBase()) return;
    const p = insumo(0);
    const { id } = remito(p, 1, { fecha: null});

    const f = db. prepare(`SELECT fecha FROM
        ingresos_mercaderia WHERE id = ?`).get(id).fecha;
        assert.match(f, /^\d{4}-\d{2}-\d{2}$/);
});

test("el detalle trae el insumo con nombre y codigo", async()=>{
    if (sinBase()) return;
    const p = insumo(0);
    const { id } = remito(p, 13, { observaciones: "llego golpeado"});

    const d = ing.detalleIngreso({ empresaId:1, ingresoId: id });

    assert.equal(d.estado, "cargado");
    assert.equal(d.observaciones, "llego golpeado");
    assert.equal(d.items.length, 1);
    assert.equal(d.items[0].productoId, p);
    assert.equal(Number(d.items[0].cantidad), 13);
    assert.ok(d.items[0].nombre, "tendria que traer el nombre del insumo");
});

test("el remito de otra empresa no se pude abrir ni facturar", async() =>{
    if (sinBase()) return;
    const p = insumo(0);
    const { id, itemId } = remito(p, 5);

    assert.equal(ing.detalleIngreso({ empresaId: 2,
        ingresoId: id
    }), null);
    assert.throws(() => ing.asociarFactura({
        empresaId: 2, ingresoId: id, numeroFactura: unico(),
        lineas: [{ itemId, cantidad: 5, precioUnitario: 1 }],
    }),/no existe/i);
    assert.equal(stockDe(p), 0);
});

test("el listado filtra por estado", async()=>{
    if (sinBase()) return;
    const p = insumo(0);
    const { id, itemId } = remito(p, 2);
    ing.asociarFactura({
        empresaId: 1, ingresoId: id, numeroFactura: unico(),
        lineas: [{ itemId, cantidad: 2, precioUnitario: 1 }],
    });
    const { id: pendiente } = remito(insumo(0),2);

    const facturados = ing.listarIngresos({ empresaId: 1, estado: "facturado" });
    const cargados = ing.listarIngresos({ empresaId: 1, estado:"cargado" });

    assert.ok(facturados.some((r) => r.id === id));
    assert.ok(!facturados.some((r)=> r.id === pendiente));
    assert.ok(cargados.some((r) => r.id === pendiente));
    assert.ok(!cargados.some((r) => r.id === id));
});

test("el listado no mezcla empresas", async() =>{
    if(sinBase()) return;
    const { id } = remito(insumo(0),1);
    assert.ok(!ing.listarIngresos({ empresaId: 2}).some((r) => r.id === id));
});

/** Llama a la ruta de verdad, como la llama Express. Verificar que esté
 *  montada no alcanza: un `empresaID` en vez de `empresaId` compila, monta,
 *  y devuelve 404 para todo. Eso pasó. */
async function llamarRuta(ruta, metodo, req) {
  const { default: deposito } = await import("../src/routes/deposito.js");
  const handler = deposito.stack
    .find((l) => l.route?.path === ruta && l.route.methods[metodo])
    .route.stack.at(-1).handle;
  const res = {
    statusCode: 200,
    status(c) { this.statusCode = c; return this; },
    json(d) { this.body = d; return this; },
  };
  await handler({ params: {}, query: {}, body: {}, user: { empresaId: 1 }, ...req }, res);
  return res;
}

test("la ruta del detalle encuentra el remito", async () => {
  if (sinBase()) return;
  const p = insumo(0);
  const { id } = remito(p, 7);

  const res = await llamarRuta("/ingresos/:id", "get", { params: { id: String(id) } });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items.length, 1);
  assert.equal(Number(res.body.items[0].cantidad), 7);
});

test("la ruta del detalle no cruza empresas", async () => {
  if (sinBase()) return;
  const { id } = remito(insumo(0), 1);

  const res = await llamarRuta("/ingresos/:id", "get",
    { params: { id: String(id) }, user: { empresaId: 2 } });

  assert.equal(res.statusCode, 404);
});

test("la ruta del listado devuelve filas", async () => {
  if (sinBase()) return;
  const { id } = remito(insumo(0), 3);

  const res = await llamarRuta("/ingresos", "get", { query: { estado: "cargado" } });

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.rows.some((r) => r.id === id));
});

test("la ruta de carga crea el remito y no toca el stock", async () => {
  if (sinBase()) return;
  const p = insumo(100);

  const res = await llamarRuta("/ingresos", "post", { body: {
    proveedor: "POR LA RUTA", numero: unico(), fecha: "2026-10-29",
    items: [{ productoId: p, cantidad: 25 }],
  } });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(stockDe(p), 100);
});

test("la ruta de la factura sube el stock, y rechazada no lo toca", async () => {
  if (sinBase()) return;
  const p = insumo(100);
  const { id, itemId } = remito(p, 25);

  const mal = await llamarRuta("/ingresos/:id/factura", "post", {
    params: { id: String(id) },
    body: { numeroFactura: unico(), lineas: [{ itemId, cantidad: 24, precioUnitario: 10 }] },
  });
  assert.equal(mal.statusCode, 400);
  assert.equal(mal.body.diferencias[0].factura, 24);
  assert.equal(stockDe(p), 100, "una factura rechazada no puede mover el stock");

  const bien = await llamarRuta("/ingresos/:id/factura", "post", {
    params: { id: String(id) },
    body: { numeroFactura: unico(), lineas: [{ itemId, cantidad: 25, precioUnitario: 10 }] },
  });
  assert.equal(bien.statusCode, 200);
  assert.equal(stockDe(p), 125);
});

test("las 4 rutas estan montadas y pasan por el guarda del deposito", async () =>{
    if(sinBase()) return;
    const { default: deposito } = await
    import("../src/routes/deposito.js");
    const esperadas =[
        ["/ingresos", "get"],
        ["/ingresos/:id", "get"],
        ["/ingresos","post"],
        ["/ingresos/:id/factura", "post"],
    ];
    for ( const [ruta, metodo] of esperadas){
        const capa = deposito.stack.find((l) => l.route?.path === ruta && l.route.methods[metodo]);
        assert.ok(capa,`falta ${metodo.toUpperCase()}${ruta}` );

        assert.ok(capa.route.stack.length >= 3,`${metodo.toUpperCase()} ${ruta} sin el guardia`);
    }
});
