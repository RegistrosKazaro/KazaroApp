// Formateo de números y moneda (ARS, es-AR) en un solo lugar. Antes esta misma
// config de Intl.NumberFormat estaba copiada en ~7 páginas con variantes
// (minimumFractionDigits vs maximumFractionDigits); para ARS todas dan lo mismo
// (siempre 2 decimales), así que se unifica sin cambiar la salida.
//
// Los formateadores se crean una sola vez (no por llamada) — es un plus de
// performance donde se formatean muchas filas (informes).

let _money = null;
let _num = null;
try {
  _money = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  _num = new Intl.NumberFormat("es-AR");
} catch {
  _money = null;
  _num = null;
}

/** Moneda ARS con 2 decimales. null/undefined/"" se tratan como 0. */
export function formatMoney(v) {
  const n = Number(v || 0);
  if (_money) return _money.format(n);
  return `$ ${n.toFixed(2)}`;
}

/** Número con separador de miles es-AR. null/undefined/"" se tratan como 0. */
export function formatNumber(v) {
  const n = Number(v || 0);
  if (_num) return _num.format(n);
  return String(n);
}
