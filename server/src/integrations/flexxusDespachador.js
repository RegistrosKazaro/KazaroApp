// flexxusDespachador.js — Toma los movimientos pendientes de la cola y los
// manda a Flexxus. Es la última pieza antes del enganche: acá no se decide
// nada, sólo se envía lo que ya quedó armado y guardado.
//
// Recibe el cliente por parámetro, así que se prueba entero con uno falso.
//
// LO QUE MÁS IMPORTA DE ESTE ARCHIVO: no duplicar un movimiento.
//
// Flexxus no acepta una clave de idempotencia en el endpoint sincrónico, así
// que si la conexión se corta DESPUÉS de mandar el pedido no hay forma de
// saber desde acá si el movimiento entró o no. En ese caso NO se reintenta
// solo: queda en 'error' con un aviso para que alguien lo mire en Flexxus. Es
// preferible un movimiento que falta (se carga a mano) a uno duplicado (hay
// que encontrarlo y anularlo, y para los MD ni siquiera sabemos si se puede).

import { pendientes, tomar, marcarEnviado, marcarError } from "./flexxusOutbox.js";

/** El número de comprobante que devuelve Flexxus, se llame como se llame. */
export function numeroDeMovimiento(respuesta) {
  if (!respuesta || typeof respuesta !== "object") return null;
  for (const clave of ["numerocomprobante", "numeroComprobante", "numero_comprobante",
                       "numero", "comprobante", "nrocomprobante"]) {
    const v = respuesta[clave] ?? respuesta?.data?.[clave];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

/**
 * ¿Sabemos con certeza que el movimiento NO entró?
 *
 * Un 4xx es una respuesta del servidor: contestó, lo rechazó, no entró. Un
 * corte de conexión o un timeout es distinto: puede haber entrado igual.
 */
export function sabemosQueNoEntro(e) {
  return Number.isFinite(Number(e?.status)) && Number(e.status) >= 400 && Number(e.status) < 500;
}

const AVISO_DUDOSO =
  "No se pudo confirmar si el movimiento entró en Flexxus (se cortó la conexión). " +
  "REVISAR EN FLEXXUS antes de reintentar: si se reintenta y ya estaba, queda duplicado.";

/**
 * Envía los movimientos que estén en cola.
 *
 * @param db
 * @param cliente   el de flexxusClient (o uno falso en los tests)
 * @param opciones  { limite, log }
 * @returns {{ tomados, enviados, fallidos, dudosos, detalles: [] }}
 */
export async function despacharPendientes(db, cliente, { limite = 20, log = console } = {}) {
  const resultado = { tomados: 0, enviados: 0, fallidos: 0, dudosos: 0, detalles: [] };
  const cola = pendientes(db, limite);

  for (const fila of cola) {
    // Si otro proceso ya se lo llevó, no lo mandamos dos veces.
    if (!tomar(db, fila.id)) continue;
    resultado.tomados += 1;

    if (!fila.body) {
      marcarError(db, fila.id, "La fila no tiene el cuerpo del remito armado.");
      resultado.fallidos += 1;
      resultado.detalles.push({ id: fila.id, estado: "error", motivo: "sin cuerpo" });
      continue;
    }

    try {
      const enviar = fila.tipo === "entrada" ? cliente.remitoDeEntrada : cliente.remitoDeSalida;
      const respuesta = await enviar(fila.body);
      const numero = numeroDeMovimiento(respuesta);
      marcarEnviado(db, fila.id, numero);
      resultado.enviados += 1;
      resultado.detalles.push({ id: fila.id, pedidoId: fila.pedidoId, estado: "enviado", numero });
      if (!numero) {
        log?.warn?.(`[flexxus] el movimiento del remito #${fila.pedidoId} salió, pero Flexxus no devolvió número:`,
          JSON.stringify(respuesta).slice(0, 200));
      }
    } catch (e) {
      const seguro = sabemosQueNoEntro(e);
      const mensaje = seguro ? (e?.message || String(e)) : `${AVISO_DUDOSO} Detalle: ${e?.message || e}`;
      marcarError(db, fila.id, mensaje);
      resultado.fallidos += 1;
      if (!seguro) resultado.dudosos += 1;
      resultado.detalles.push({
        id: fila.id, pedidoId: fila.pedidoId,
        estado: seguro ? "error" : "dudoso",
        motivo: e?.message || String(e),
      });
      log?.warn?.(`[flexxus] falló el movimiento del remito #${fila.pedidoId}: ${e?.message || e}`);
    }
  }

  return resultado;
}

/**
 * Prueba que el acceso ande, sin escribir nada. Es lo primero que hay que
 * correr el día que lleguen las credenciales.
 */
export async function probarConexion(cliente) {
  const pasos = [];
  const paso = async (nombre, fn) => {
    try {
      const r = await fn();
      pasos.push({ paso: nombre, ok: true, detalle: r });
      return r;
    } catch (e) {
      pasos.push({ paso: nombre, ok: false, detalle: e?.message || String(e), status: e?.status ?? null });
      return null;
    }
  };

  await paso("login", async () => {
    await cliente.login();
    return "sesión iniciada";
  });
  const deps = await paso("leer depósitos", async () => {
    const r = await cliente.depositos({ activo: 1 });
    const filas = Array.isArray(r) ? r : (r?.data ?? r?.rows ?? []);
    return `${filas.length} depósitos`;
  });
  await paso("leer stock por depósito", async () => {
    const r = await cliente.stockPorDeposito({ listacodigosdeposito: "001" });
    const filas = Array.isArray(r) ? r : (r?.data ?? r?.rows ?? []);
    return `${filas.length} filas de stock (si da 0, revisar el código del depósito central)`;
  });

  return { ok: pasos.every((p) => p.ok), pasos, depositos: deps };
}
