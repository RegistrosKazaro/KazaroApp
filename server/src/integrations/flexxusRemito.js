// flexxusRemito.js — Arma los remitos de transferencia entre depósitos que
// espera Flexxus. PURO: sin base de datos y sin red, para poder testearlo solo.
// La parte que lee la base y la que llama a la API viven en otros archivos.
//
// Es el equivalente, hecho por la app, del movimiento "MD" que hoy el depósito
// carga a mano en Flexxus: DEPOSITO CENTRAL -> depósito del servicio cuando se
// entrega, y el inverso cuando el servicio devuelve.
//
// Endpoints a los que alimenta (los dos piden el mismo cuerpo):
//   POST /stock/transferenciasentredepositos/remitodesalida   (la entrega)
//   POST /stock/transferenciasentredepositos/remitodeentrada  (la devolución)

/** Tipo de comprobante de los movimientos entre depósitos. */
export const TIPO_COMPROBANTE = "MD";

/** Flexxus corta el código de artículo en 15 caracteres. */
export const MAX_CODIGO = 15;

const pad7 = (v) => String(v ?? "").padStart(7, "0");

/**
 * La referencia que va en Observaciones, igual a la que hoy se escribe a mano:
 * "OP-0001053". Es el hilo que permite volver del movimiento al remito.
 */
export function referenciaPedido(pedidoId) {
  return `OP-${pad7(pedidoId)}`;
}

/**
 * Identificador del envío. Se genera acá, ANTES de mandar nada, y se guarda.
 * Si la red se corta y no sabemos si el movimiento entró, se consulta por este
 * id en vez de mandarlo de nuevo: es lo que evita el movimiento duplicado.
 */
export function externalId(pedidoId, tipo, intento = 1) {
  const prefijo = tipo === "entrada" ? "IN" : "OUT";
  return `${prefijo}-${pad7(pedidoId)}-${intento}`;
}

/** "2026-09-18T19:05:20.000Z" o "2026-09-18 19:05:20" -> "2026-09-18 19:05:20" */
function normalizarFecha(valor) {
  const s = String(valor ?? "").trim();
  if (!s) return null;
  const limpio = s.slice(0, 19).replace("T", " ");
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(limpio) ? limpio : null;
}

/**
 * Junta las líneas por código y suma las cantidades. Un pedido puede traer el
 * mismo insumo en dos filas (por ejemplo una entrega parcial y el pendiente);
 * en el movimiento tiene que ir una sola línea.
 */
function agruparPorCodigo(items) {
  const porCodigo = new Map();
  for (const it of items) {
    const codigo = String(it?.codigo ?? "").trim();
    const cantidad = Number(it?.cantidad ?? 0);
    const lote = String(it?.lote ?? "").trim();
    const clave = `${codigo}|${lote}`;
    if (porCodigo.has(clave)) {
      porCodigo.get(clave).cantidad += cantidad;
    } else {
      porCodigo.set(clave, { codigo, lote, cantidad, nombre: it?.nombre ?? null });
    }
  }
  return [...porCodigo.values()];
}

/**
 * Arma el cuerpo del remito. NO envía nada: devuelve el JSON listo y la lista
 * de problemas. Si hay un solo error, `ok` es false y no hay que mandarlo.
 *
 * @param {object} p
 * @param {"salida"|"entrada"} p.tipo        salida = entrega, entrada = devolución
 * @param {number} p.pedidoId                el remito de la app
 * @param {string} p.fecha                   cuándo salió (fecha del despacho)
 * @param {string} p.depositoCentral         código del DEPOSITO CENTRAL en Flexxus
 * @param {string} p.depositoServicio        código del depósito del servicio
 * @param {string} p.usuario                 código de usuario de Flexxus
 * @param {Array}  p.items                   [{ codigo, cantidad, nombre?, lote? }]
 * @param {string} [p.comentario]            por defecto, "OP-0001053"
 * @param {number} [p.intento]               para el externalId
 * @returns {{ ok: boolean, body: object|null, externalId: string, errores: string[], avisos: string[] }}
 */
export function construirRemito({
  tipo = "salida",
  pedidoId,
  fecha,
  depositoCentral,
  depositoServicio,
  usuario,
  items = [],
  comentario = null,
  intento = 1,
} = {}) {
  const errores = [];
  const avisos = [];

  if (tipo !== "salida" && tipo !== "entrada") {
    errores.push(`Tipo de movimiento desconocido: "${tipo}". Tiene que ser "salida" o "entrada".`);
  }
  if (!Number.isFinite(Number(pedidoId)) || Number(pedidoId) <= 0) {
    errores.push("Falta el número de pedido.");
  }

  const central = String(depositoCentral ?? "").trim();
  const servicio = String(depositoServicio ?? "").trim();
  if (!central) errores.push("Falta el código del depósito central en Flexxus.");
  if (!servicio) errores.push("El servicio no tiene depósito de Flexxus asignado.");

  const codigoUsuario = String(usuario ?? "").trim();
  if (!codigoUsuario) errores.push("Falta el código de usuario de Flexxus.");

  const fechaComprobante = normalizarFecha(fecha);
  if (!fechaComprobante) errores.push(`Fecha inválida: "${fecha}".`);

  // Las líneas: se agrupan, se descarta lo que no suma y se valida el resto.
  const agrupados = agruparPorCodigo(Array.isArray(items) ? items : []);
  const productos = [];
  for (const it of agrupados) {
    const etiqueta = it.nombre || it.codigo || "(sin nombre)";
    if (!it.codigo) {
      errores.push(`"${etiqueta}" no tiene código de artículo.`);
      continue;
    }
    if (it.codigo.length > MAX_CODIGO) {
      errores.push(`El código "${it.codigo}" tiene ${it.codigo.length} caracteres y Flexxus acepta hasta ${MAX_CODIGO}.`);
      continue;
    }
    if (!Number.isFinite(it.cantidad)) {
      errores.push(`La cantidad de "${etiqueta}" no es un número.`);
      continue;
    }
    if (it.cantidad < 0) {
      errores.push(`"${etiqueta}" tiene cantidad negativa (${it.cantidad}).`);
      continue;
    }
    if (it.cantidad === 0) {
      // No es un error: un pedido puede tener una línea en cero porque se
      // corrigió. Simplemente no viaja.
      avisos.push(`"${etiqueta}" quedó en 0 y no se incluye en el movimiento.`);
      continue;
    }
    const linea = { codigoarticulo: it.codigo, cantidad: it.cantidad };
    if (it.lote) linea.lote = it.lote;
    productos.push(linea);
  }

  if (!productos.length && !errores.length) {
    errores.push("El movimiento no tiene ninguna línea con cantidad.");
  }

  const id = externalId(pedidoId, tipo, intento);
  if (errores.length) return { ok: false, body: null, externalId: id, errores, avisos };

  // En la salida el material va del central al servicio; en la devolución, al revés.
  const origen = tipo === "salida" ? central : servicio;
  const destino = tipo === "salida" ? servicio : central;

  return {
    ok: true,
    externalId: id,
    errores: [],
    avisos,
    body: {
      tipocomprobante: TIPO_COMPROBANTE,
      fechacomprobante: fechaComprobante,
      codigodepositoorigen: origen,
      codigodepositodestino: destino,
      comentarios: comentario ?? referenciaPedido(pedidoId),
      codigousuario: codigoUsuario,
      productos,
    },
  };
}
