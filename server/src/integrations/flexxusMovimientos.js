// La planilla de movimientos entre depósitos, igual a la de Flexxus.
//
// Cada servicio es un depósito del otro lado, así que todo lo que sale del
// depósito central hacia un servicio es un movimiento entre depósitos, y todo
// lo que vuelve es el movimiento inverso:
//
//   SALIDA   DEPOSITO CENTRAL  →  depósito del servicio   (el despacho)
//   ENTRADA  depósito del servicio  →  DEPOSITO CENTRAL   (la devolución)
//
// Los datos NO salen de la cola de Flexxus: salen de lo que ya pasó en el
// depósito (`pedido_despacho` y `devoluciones`). Por eso la planilla sirve
// desde hoy, con 1007 despachos y 155 devoluciones reales, aunque Flexxus
// todavía no esté enganchado.
//
// Cuando se enganche, `flexxus_outbox` le agrega a cada fila el número de
// comprobante y el estado del envío. Mientras tanto van en null, que es lo
// honesto: el movimiento ocurrió, pero todavía no se informó.
//
// El remito viaja en Observaciones como OP-0001053, que es como el depósito
// cruza la planilla de Flexxus contra el pedido de la app.

export const DEPOSITO_CENTRAL = "001";
export const NOMBRE_CENTRAL = "DEPOSITO CENTRAL";
export const TIPOS = ["salida", "entrada"];

const pad7 = (n) => String(n).padStart(7, "0");
export const referenciaPedido = (pedidoId) => `OP-${pad7(pedidoId)}`;

/** Sólo las devoluciones ya aprobadas movieron mercadería de verdad. */
const DEV_APROBADA = `LOWER(COALESCE(d.estado,'')) = 'aprobada'`;

/**
 * Las dos mitades de la planilla, en una sola consulta.
 *
 * Se arma como UNION porque son dos orígenes distintos con la misma forma.
 * `clave` identifica la fila para pedir su detalle después.
 */
function sqlBase() {
  return `
    SELECT 'salida' AS tipo,
           'd' || p.pedido_id              AS clave,
           p.pedido_id                     AS pedidoId,
           p.fecha_despacho                AS fecha,
           p.servicio_id                   AS servicioId,
           p.empleado_id                   AS empleadoId,
           (SELECT COALESCE(SUM(i.cantidad),0) FROM pedido_despacho_items i
             WHERE i.pedido_id = p.pedido_id) AS unidades,
           (SELECT COUNT(*) FROM pedido_despacho_items i
             WHERE i.pedido_id = p.pedido_id) AS lineas
      FROM pedido_despacho p
     WHERE p.empresa_id = @empresaId

    UNION ALL

    SELECT 'entrada' AS tipo,
           'v' || d.pedido_id              AS clave,
           d.pedido_id                     AS pedidoId,
           COALESCE(d.fecha_resolucion, d.fecha_solicitud) AS fecha,
           (SELECT ped.ServicioID FROM Pedidos ped WHERE ped.PedidoID = d.pedido_id) AS servicioId,
           d.aprobador_id                  AS empleadoId,
           SUM(d.cantidad)                 AS unidades,
           COUNT(*)                        AS lineas
      FROM devoluciones d
     WHERE d.empresa_id = @empresaId AND ${DEV_APROBADA}
     GROUP BY d.pedido_id
  `;
}

/**
 * Las filas de la planilla, ya con los nombres de servicio y depósito.
 *
 * @returns {{ rows, total, unidades }}
 */
export function listar(db, {
  empresaId = 1, tipo = null, desde = null, hasta = null,
  deposito = null, busqueda = "", limite = 100, offset = 0,
} = {}) {
  const where = [];
  const params = {
    empresaId: Number(empresaId),
    tipo: tipo && TIPOS.includes(tipo) ? tipo : null,
    desde: desde || null,
    hasta: hasta || null,
    deposito: deposito ? String(deposito).trim() : null,
    like: `%${String(busqueda || "").trim().toLowerCase()}%`,
    limite: Math.min(500, Math.max(1, Number(limite) || 100)),
    offset: Math.max(0, Number(offset) || 0),
  };

  if (params.tipo) where.push(`m.tipo = @tipo`);
  // La fecha se guarda como texto; comparar por prefijo alcanza y usa el índice.
  if (params.desde) where.push(`substr(m.fecha, 1, 10) >= @desde`);
  if (params.hasta) where.push(`substr(m.fecha, 1, 10) <= @hasta`);
  if (params.deposito) where.push(`fd.codigo_deposito = @deposito`);
  if (params.like !== "%%") {
    where.push(`(LOWER(COALESCE(s.ServicioNombre,'')) LIKE @like
              OR LOWER(COALESCE(fd.codigo_deposito,'')) LIKE @like
              OR CAST(m.pedidoId AS TEXT) LIKE @like
              OR LOWER('op-' || printf('%07d', m.pedidoId)) LIKE @like)`);
  }

  const desdeSql = `
    FROM (${sqlBase()}) m
    LEFT JOIN Servicios s ON s.ServiciosID = m.servicioId
    LEFT JOIN flexxus_depositos fd ON fd.servicio_id = m.servicioId
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
  `;

  const resumen = db.prepare(
    `SELECT COUNT(*) AS total, COALESCE(SUM(m.unidades),0) AS unidades ${desdeSql}`
  ).get(params);

  const rows = db.prepare(`
    SELECT m.tipo, m.clave, m.pedidoId, m.fecha, m.servicioId, m.empleadoId,
           m.unidades, m.lineas,
           s.ServicioNombre AS servicio,
           fd.codigo_deposito AS codigoDeposito,
           fd.nombre_deposito AS nombreDeposito
    ${desdeSql}
    ORDER BY m.fecha DESC, m.pedidoId DESC
    LIMIT @limite OFFSET @offset
  `).all(params);

  return {
    rows: rows.map((r) => darleForma(db, r)),
    total: Number(resumen?.total || 0),
    unidades: Number(resumen?.unidades || 0),
  };
}

/** Una fila como la muestra Flexxus: origen, destino y la referencia. */
function darleForma(db, r) {
  const esSalida = r.tipo === "salida";
  const delServicio = {
    codigo: r.codigoDeposito || null,
    nombre: r.nombreDeposito || r.servicio || null,
  };
  const central = { codigo: DEPOSITO_CENTRAL, nombre: NOMBRE_CENTRAL };

  const envio = leerEnvio(db, r.pedidoId, r.tipo);

  return {
    clave: r.clave,
    tipo: r.tipo,
    comprobante: "MD",
    pedidoId: r.pedidoId,
    referencia: referenciaPedido(r.pedidoId),
    fecha: r.fecha,
    origen:  esSalida ? central : delServicio,
    destino: esSalida ? delServicio : central,
    servicio: r.servicio || null,
    servicioId: r.servicioId ?? null,
    lineas: Number(r.lineas || 0),
    unidades: Number(r.unidades || 0),
    // Null mientras Flexxus no esté enganchado: el movimiento pasó, pero
    // todavía no se informó. No se inventa un número que no existe.
    numeroMovimiento: envio?.numero_mov || null,
    estadoEnvio: envio?.estado || null,
    sinDeposito: !delServicio.codigo,
  };
}

/** Lo que diga la cola de Flexxus de ese movimiento, si ya se encoló. */
function leerEnvio(db, pedidoId, tipo) {
  try {
    return db.prepare(
      `SELECT estado, numero_mov FROM flexxus_outbox
        WHERE pedido_id = ? AND tipo = ? ORDER BY id DESC LIMIT 1`
    ).get(Number(pedidoId), tipo) || null;
  } catch {
    return null;   // todavía no existe la tabla: la planilla igual sirve
  }
}

/**
 * El detalle de un movimiento, que es lo que Flexxus muestra al abrirlo.
 * `clave` es la que vino en la fila: 'd123' despacho, 'v123' devolución.
 */
export function detalle(db, clave, empresaId = 1) {
  const m = /^([dv])(\d+)$/.exec(String(clave || ""));
  if (!m) return { ok: false, error: "Movimiento no encontrado" };
  const [, letra, id] = m;
  const pedidoId = Number(id);

  const items = letra === "d"
    ? db.prepare(
        `SELECT i.codigo, i.nombre, i.cantidad, i.precio, i.subtotal
           FROM pedido_despacho_items i
           JOIN pedido_despacho p ON p.pedido_id = i.pedido_id
          WHERE i.pedido_id = ? AND p.empresa_id = ?
          ORDER BY i.nombre COLLATE NOCASE`
      ).all(pedidoId, Number(empresaId))
    : db.prepare(
        `SELECT pr.Code AS codigo, COALESCE(pr.ProductName, 'Insumo ' || d.producto_id) AS nombre,
                SUM(d.cantidad) AS cantidad, pr.Precio AS precio,
                SUM(d.cantidad) * COALESCE(pr.Precio,0) AS subtotal,
                GROUP_CONCAT(DISTINCT d.tipo) AS estadoDevolucion
           FROM devoluciones d
           LEFT JOIN Productos pr ON pr.ProductID = d.producto_id
          WHERE d.pedido_id = ? AND d.empresa_id = ? AND ${DEV_APROBADA}
          GROUP BY d.producto_id
          ORDER BY nombre COLLATE NOCASE`
      ).all(pedidoId, Number(empresaId));

  if (!items.length) return { ok: false, error: "Movimiento no encontrado" };

  return {
    ok: true,
    clave: String(clave),
    pedidoId,
    tipo: letra === "d" ? "salida" : "entrada",
    referencia: referenciaPedido(pedidoId),
    items,
    unidades: items.reduce((a, i) => a + Number(i.cantidad || 0), 0),
  };
}

/** Los depósitos que aparecen en la planilla, para el filtro. */
export function depositosConMovimientos(db, empresaId = 1) {
  return db.prepare(`
    SELECT fd.codigo_deposito AS codigo,
           COALESCE(fd.nombre_deposito, s.ServicioNombre) AS nombre,
           COUNT(*) AS movimientos
      FROM (${sqlBase()}) m
      JOIN flexxus_depositos fd ON fd.servicio_id = m.servicioId
      LEFT JOIN Servicios s ON s.ServiciosID = m.servicioId
     WHERE fd.codigo_deposito IS NOT NULL AND fd.codigo_deposito <> ''
     GROUP BY fd.codigo_deposito
     ORDER BY nombre COLLATE NOCASE
  `).all({ empresaId: Number(empresaId) });
}
