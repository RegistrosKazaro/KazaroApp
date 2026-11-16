// Primera sincronización del stock con Flexxus: una sola vez, a la hora que diga
// FLEXXUS_SYNC_EN ("2026-11-17 14:10", hora Argentina). Sin la variable no hace nada.
// Usa el mismo cruce que el botón "Traer de Flexxus": uniformes afuera.
import { configDesdeEnv } from "../integrations/flexxusClient.js";
import { traerStockDeFlexxus } from "../integrations/flexxus.js";
import { cruceDeStock } from "../routes/admin.js";

const MAX_TIMEOUT = 2 ** 31 - 1; // más que esto, setTimeout dispara en el acto

/** Milisegundos desde `ahora` hasta "AAAA-MM-DD HH:MM" en hora argentina; null si no se entiende. */
export function msHasta(cuando, ahora = Date.now()) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec(String(cuando ?? "").trim());
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2]}:00-03:00`);
  return Number.isNaN(t) ? null : t - ahora;
}

export async function sincronizarStock() {
  const filas = await traerStockDeFlexxus();
  if (!filas.length) throw new Error("Flexxus no devolvió stock del depósito central");
  // Flexxus manda: también se baja a cero lo que allá no hay.
  return cruceDeStock({ query: { aplicar: "1", ceros: "1" } }, filas);
}

export function startFlexxusStockJob(env = process.env) {
  const cuando = env.FLEXXUS_SYNC_EN;
  if (!cuando) return;
  const ms = msHasta(cuando);
  if (ms === null) return console.warn(`[flexxus stock] FLEXXUS_SYNC_EN no se entiende: "${cuando}" (formato 2026-11-17 14:10)`);
  if (!configDesdeEnv(env)) return console.warn("[flexxus stock] faltan las credenciales de Flexxus; no se programa");
  // shortcut: un solo disparo; si el servidor está caído a esa hora no corre. Pasar a un intervalo cuando se defina la frecuencia.
  if (ms <= 0) return console.log(`[flexxus stock] ${cuando} ya pasó; no se sincroniza`);
  if (ms > MAX_TIMEOUT) return console.warn(`[flexxus stock] ${cuando} está a más de 24 días; no se programa`);
  console.log(`[flexxus stock] primera sincronización programada para ${cuando} (hora Arg.)`);
  setTimeout(async () => {
    try {
      const r = await sincronizarStock();
      console.log(`[flexxus stock] listo: ${r.aplicados} insumos actualizados`, JSON.stringify(r.resumen));
    } catch (e) {
      console.error("[flexxus stock] falló:", e?.message || e);
    }
  }, ms);
}
