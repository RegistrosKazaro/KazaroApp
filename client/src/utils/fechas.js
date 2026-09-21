/**
 * Fechas de la base → hora argentina.
 *
 * La base guarda UTC. Un valor plano "2026-09-18 15:00:00" es 15:00 UTC, o
 * sea 12:00 en Argentina. Leerlo agregándole "-03:00" (como hacía Mis
 * pedidos) lo trataba como hora argentina y mostraba 3 horas de más.
 * Los valores que ya traen zona ("...Z" o "+03:00") se respetan tal cual.
 */
const ZONA_AR = "America/Argentina/Cordoba";

/** Milisegundos de una fecha de la base, o NaN si no se puede leer. */
export function msDeFechaDb(raw) {
  if (raw == null) return NaN;
  const s = String(raw).trim();
  if (!s) return NaN;
  const conZona = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(s);
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  return new Date(conZona ? iso : `${iso}Z`).getTime();
}

/** "18/09/2026, 12:00" en hora argentina. Si no se puede leer, devuelve el valor tal cual. */
export function formatoFechaHoraAr(raw) {
  const t = msDeFechaDb(raw);
  if (Number.isNaN(t)) return raw ? String(raw) : "";
  return new Date(t).toLocaleString("es-AR", {
    timeZone: ZONA_AR,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    // 24 horas siempre: si no, según la computadora sale "12:00 p. m.".
    hourCycle: "h23",
  });
}

/** Días (con decimales) desde esa fecha hasta ahora. */
export function diasDesdeFechaDb(raw, ahora = Date.now()) {
  const t = msDeFechaDb(raw);
  if (Number.isNaN(t)) return 0;
  return (ahora - t) / (1000 * 60 * 60 * 24);
}
