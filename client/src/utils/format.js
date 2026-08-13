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

/**
 * Número para una celda de CSV que se abre con Excel en español: coma como
 * separador decimal y SIN separador de miles. Se escribe sin comillas para que
 * Excel lo tome como número y no como texto.
 *
 * Con punto decimal ("134.36") Excel es-AR lo lee como miles y lo convierte en
 * un número gigante; por eso se exporta "134,36".
 */
export function csvNumber(v) {
  if (v == null || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return String(n).replace(".", ",");
}
