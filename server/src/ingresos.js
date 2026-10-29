// Ingreso de mercaderia
//Hasta antes de esto el stock se asignaba mediante un ajuste ya sea cuando se creaba un insumo o cuando se ajustaba sin ningun registro
//ademas que por devoluciones donde se volvian a ingresar al stock pero si habia un registro
//El circuito real: Llega remito del proveedor, el deposito CONTROLA lo que llego, y recien alli carga el remito al sistema
// El encargado de compras compara el remito que llego con la factura que le enviaron para que conincidan con cantidad y  producto,
//y se asocia al remito, El stock se ve modificado una vez que la factura se asocio correctamente 


import { db } from "./db.js";

export function ensureIngresosTablas(){
    db.exec(`
    CREATE TABLE IF NOT EXISTS ingresos_mercaderia (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id     INTEGER NOT NULL,
      proveedor      TEXT NOT NULL,
      numero         TEXT NOT NULL,
      fecha          TEXT NOT NULL,
      estado         TEXT NOT NULL DEFAULT 'cargado',
      observaciones  TEXT,
      usuario        TEXT,
      created_at     TEXT DEFAULT (datetime('now')),
      factura_numero TEXT,
      factura_fecha  TEXT,
      facturado_at   TEXT,
      facturado_por  TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_ingreso_comprobante
      ON ingresos_mercaderia (empresa_id, proveedor COLLATE NOCASE, numero COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS ingreso_items (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      ingreso_id      INTEGER NOT NULL,
      producto_id     INTEGER NOT NULL,
      cantidad        REAL NOT NULL,
      precio_unitario REAL
    );
    CREATE INDEX IF NOT EXISTS ix_ingreso_items ON ingreso_items (ingreso_id);
  `
    );
}

//Si esto fallara la app tiene que arrancar igual; sin ingresos
try { ensureIngresosTablas ();} catch (e){
    console.warn("[ingresos] no se pudieron crear las tablas:", e?.message || e);
}

const limpio = (v) => String(v ?? "").trim().replace(/\s+/g, " ");

// Cargar el remito Ya controlado
export function crearRemito({ empresaId, proveedor, numero, fecha, observaciones = "", usuario = null, items = []}){    const prov = limpio(proveedor);
    const num = limpio(numero);
    if (!prov) throw new Error ("Falta el proveedor");
    if (!num) throw new Error("Falta el numero del remito");
    if (!Array.isArray(items) || items.length === 0) throw new Error("El remito no tiene insumos");

    // Se valida todo antes de escribir
    const lineas = items.map((it) =>{
        const productoId = Number(it.productoId);
        const cantidad = Number(it.cantidad);
        if (!Number.isFinite(cantidad) || cantidad <= 0) throw new Error("Cantidad invalida");
        const p = db.prepare(`SELECT ProductID id FROM Productos WHERE ProductID = ? AND empresa_id = ?`            
        ).get(productoId, empresaId);
        if(!p) throw new Error(`El insumo ${productoId} no existe en esta empresa`);
        return { productoId, cantidad}
    });
    
    const cuando = limpio(fecha) || new Date().toISOString().slice(0, 10);

    try {
        return db.transaction(() => {
            const id = Number(db.prepare(
               `INSERT INTO ingresos_mercaderia (empresa_id, proveedor, numero, fecha, observaciones, usuario)
         VALUES (?, ?, ?, ?, ?, ?)` 
            ).run(empresaId, prov, num, cuando, limpio(observaciones),usuario).lastInsertRowid);
            
            const ins = db.prepare(
                `INSERT INTO ingreso_items (ingreso_id, producto_id, cantidad) VALUES (?, ?, ?)`
            );
            for (const l of lineas) ins.run(id, l.productoId, l.cantidad);
            return id;
        })();
    } catch (e){
        if (String(e?.message || "").includes("UNIQUE")){
            throw new Error(`Ya esta cargado el remito ${num} de ${prov}`);
        }
        throw e;
    }
}

/*
 * Compras concilia la factura del proveedor contra los remitos que cubre.
 *
 * Una factura suele cubrir VARIOS remitos, así que se pasan todos juntos: o
 * entran todos o no entra ninguno. La factura no tiene tabla propia porque la
 * identifican el proveedor y su número, y eso ya vive en cada remito.
 *
 * @param ingresoIds los remitos que cubre esa factura (uno o varios).
 * @param lineas [{ itemId, cantidad, precioUnitario }] — lo que dice la FACTURA.
 *   Si alguna cantidad no coincide con el remito, no se asocia nada: esa
 *   diferencia la tiene que resolver una persona, no taparla el sistema.
 */

export function asociarFactura({ empresaId, ingresoIds, ingresoId, numeroFactura, fechaFactura, usuario = null, lineas = [] }) {
  const num = limpio(numeroFactura);
  if (!num) throw new Error("Falta el número de factura");

  const pedidos = Array.isArray(ingresoIds) ? ingresoIds : [ingresoIds ?? ingresoId];
  const ids = [...new Set(pedidos.map(Number))].filter(Number.isFinite);
  if (!ids.length) throw new Error("No hay remitos para conciliar");

  const remitos = ids.map((id) => {
    const r = db.prepare(
      `SELECT id, estado, proveedor, numero FROM ingresos_mercaderia WHERE id = ? AND empresa_id = ?`
    ).get(id, empresaId);
    if (!r) throw new Error("Ese remito no existe");
    if (r.estado === "facturado") throw new Error(`El remito ${r.numero} ya tiene factura: el stock ya subió`);
    return r;
  });

  // Una factura la emite un proveedor. Mezclar dos es un error de carga, y
  // taparlo dejaría mercadería cargada contra quien no corresponde.
  if (new Set(remitos.map((r) => r.proveedor.toUpperCase())).size > 1) {
    throw new Error("Esos remitos son de proveedores distintos: una factura es de un solo proveedor");
  }

  const huecos = ids.map(() => "?").join(",");
  const delRemito = db.prepare(
    `SELECT t.id, t.producto_id, t.cantidad, i.numero AS remito
       FROM ingreso_items t
       JOIN ingresos_mercaderia i ON i.id = t.ingreso_id
      WHERE t.ingreso_id IN (${huecos})`
  ).all(...ids);

  const porId = new Map(lineas.map((l) => [Number(l.itemId), l]));
  const difs = [];
  const aplicar = delRemito.map((r) => {
    const f = porId.get(r.id);
    if (!f) throw new Error("La factura no cubre todas las líneas de los remitos");
    const cant = Number(f.cantidad);
    const precio = f.precioUnitario == null || f.precioUnitario === "" ? null : Number(f.precioUnitario);
    if (!Number.isFinite(cant) || cant <= 0) throw new Error("Cantidad de la factura inválida");
    if (precio != null && (!Number.isFinite(precio) || precio < 0)) throw new Error("Precio unitario inválido");
    if (cant !== Number(r.cantidad)) difs.push({ itemId: r.id, remito: r.cantidad, factura: cant, remitoNumero: r.remito });
    return { ...r, precio };
  });

  if (difs.length) {
    const e = new Error(`La factura no coincide con ${difs.length === 1 ? "el remito" : "los remitos"} en ${difs.length} línea(s)`);
    e.diferencias = difs;
    throw e;
  }

  return db.transaction(() => {
    const upItem = db.prepare(`UPDATE ingreso_items SET precio_unitario = ? WHERE id = ?`);
    const upStock = db.prepare(
      `UPDATE Productos SET Stock = COALESCE(Stock,0) + ? WHERE ProductID = ? AND empresa_id = ?`
    );
    for (const l of aplicar) {
      upItem.run(l.precio, l.id);
      upStock.run(l.cantidad, l.producto_id, empresaId);
    }
    db.prepare(
      `UPDATE ingresos_mercaderia
          SET estado = 'facturado', factura_numero = ?, factura_fecha = ?,
              facturado_at = datetime('now'), facturado_por = ?
        WHERE id IN (${huecos})`
    ).run(num, limpio(fechaFactura) || null, usuario, ...ids);

    return {
      ingresoIds: ids,
      remitos: ids.length,
      lineas: aplicar.length,
      unidades: aplicar.reduce((a, l) => a + Number(l.cantidad), 0),
    };
  })();
}

export function listarIngresos({ empresaId, estado = null, limite = 100}){
    const where = estado ? `AND i.estado = @estado` : "";
  return db.prepare(`
    SELECT i.id, i.proveedor, i.numero, i.fecha, i.estado, i.observaciones,
           i.factura_numero AS facturaNumero, i.facturado_at AS facturadoAt,
           COUNT(t.id) AS lineas, SUM(t.cantidad) AS unidades
      FROM ingresos_mercaderia i
      LEFT JOIN ingreso_items t ON t.ingreso_id = i.id
     WHERE i.empresa_id = @empresaId ${where}
     GROUP BY i.id
     ORDER BY i.fecha DESC, i.id DESC
     LIMIT @limite
  `). all({empresaId, estado, limite: Number(limite) || 100 });
}

export function detalleIngreso({ empresaId, ingresoId}){
    const ing = db.prepare(
        `SELECT * FROM ingresos_mercaderia WHERE id = ? AND empresa_id = ?`
  ).get(Number(ingresoId), empresaId);
  if (!ing) return null;
  ing.items = db.prepare(`
    SELECT t.id, t.producto_id AS productoId, p.ProductName AS nombre, p.Code AS codigo,
           t.cantidad, t.precio_unitario AS precioUnitario
      FROM ingreso_items t
      JOIN Productos p ON p.ProductID = t.producto_id
     WHERE t.ingreso_id = ?
     ORDER BY p.ProductName COLLATE NOCASE
  `).all(ing.id);
  return ing;
}

