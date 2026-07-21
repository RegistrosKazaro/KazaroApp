// server/src/utils/fechas.js
//
// Punto único para interpretar las fechas que vienen de la base.
//
// La base guarda SIEMPRE en UTC, en dos formatos según quién escriba:
//   - datetime('now')          -> "YYYY-MM-DD HH:MM:SS"        (plano, sin zona)
//   - new Date().toISOString() -> "YYYY-MM-DDTHH:MM:SS.sssZ"   (con Z)
//
// El string plano NO trae zona, así que hay que decidir cómo leerlo. Antes se
// asumía que era hora argentina y se le sumaban 3 horas (remitoPdf.js y
// orders.js lo hacían por separado); como en realidad ya venía en UTC, los
// remitos mostraban la hora adelantada 3 horas. Acá se lee como UTC, que es
// lo que efectivamente guarda SQLite.
//
// Argentina es UTC-3 fijo: no aplica horario de verano desde 2009.

const AR_TZ = "America/Argentina/Buenos_Aires";

const CON_ZONA = /([Zz]|[+-]\d{2}:?\d{2})$/;
const PLANA = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/;

/** Convierte un valor de la base a Date. Devuelve null si no se puede. */
export function parseDbDate(valor) {
  if (!valor) return null;
  const s = String(valor).trim();
  if (!s) return null;

  // Trae zona explícita: el parser nativo ya sabe qué hacer.
  if (CON_ZONA.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const m = s.match(PLANA);
  if (!m) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const [, Y, M, D, h, mi, sec] = m;
  const d = new Date(Date.UTC(+Y, +M - 1, +D, +(h || 0), +(mi || 0), +(sec || 0)));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ISO-8601 en UTC. Es el formato que conviene exponer en las APIs. */
export function toISO(valor) {
  const d = parseDbDate(valor);
  return d ? d.toISOString() : null;
}

/** "dd/mm/aaaa hh:mm" en hora argentina, para mostrarle a una persona. */
export function fmtAr(valor, { conSegundos = false } = {}) {
  const d = parseDbDate(valor);
  if (!d) return "";
  return d.toLocaleString("es-AR", {
    timeZone: AR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(conSegundos ? { second: "2-digit" } : {}),
    hour12: false,
  });
}

/** "dd/mm/aaaa" en hora argentina, sin hora. */
export function fmtArFecha(valor) {
  const d = parseDbDate(valor);
  if (!d) return "";
  return d.toLocaleDateString("es-AR", {
    timeZone: AR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** "aaaa-mm-dd" del día argentino. Sirve para agrupar y filtrar por fecha. */
export function diaAr(valor) {
  const d = parseDbDate(valor);
  if (!d) return null;
  // en-CA da directamente aaaa-mm-dd
  return d.toLocaleDateString("en-CA", { timeZone: AR_TZ });
}

/** Momento actual listo para guardar con la convención de la base (UTC plano). */
export function ahoraParaDb() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export { AR_TZ };
