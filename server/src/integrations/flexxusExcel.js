// flexxusExcel.js — Lee el Excel que hoy se exporta a mano desde Flexxus y lo
// convierte en las MISMAS filas que ya espera buildSyncReport.
//
// Es un ADAPTADOR: el motor (flexxusCore) no sabe de dónde salen las filas. El
// día que el ERP cambie se escribe otro adaptador y el resto queda igual.
//
// No adivina columnas en silencio: si no encuentra alguna, lo dice en `avisos`.
import XLSX from "xlsx";

/** Para comparar encabezados sin que molesten acentos, mayúsculas ni espacios. */
const llano = (v) =>
  String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ").trim().toLowerCase();

/** Cómo puede venir llamada cada columna. Se compara el nombre completo, no por
 *  partes: si no, "codigo" se comería a "codigo deposito". */
const NOMBRES = {
  code:        ["codigo articulo", "codigoarticulo", "codigo", "cod articulo"],
  name:        ["descripcion", "descripcion articulo", "articulo", "nombre", "detalle"],
  stock:       ["stock real", "stock", "existencia", "cantidad"],
  subdeposito: ["codigo subdeposito", "subdeposito", "codigo deposito", "codigodeposito", "deposito", "sucursal"],
};

/** En qué columna cayó cada campo, mirando una fila de encabezados. */
function ubicarColumnas(fila = []) {
  const encontradas = {};
  fila.forEach((celda, i) => {
    const h = llano(celda);
    if (!h) return;
    for (const [campo, nombres] of Object.entries(NOMBRES)) {
      if (encontradas[campo] === undefined && nombres.includes(h)) encontradas[campo] = i;
    }
  });
  return encontradas;
}

/** Los números pueden venir como 1.234,50 (formato argentino) o como 1.234. */
function aNumero(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v ?? "").trim();
  if (s === "") return 0;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Lee el Excel y devuelve las filas para buildSyncReport.
 *
 * @param buffer  el archivo .xlsx leído con fs.readFileSync
 * @returns {{ filas: Array, columnas: object, hoja: string, avisos: string[] }}
 */
export function leerExcelFlexxus(buffer, { hoja } = {}) {
  const libro = XLSX.read(buffer, { type: "buffer" });
  const nombreHoja = hoja || libro.SheetNames[0];
  const datos = libro.Sheets[nombreHoja];
  if (!datos) {
    return { filas: [], columnas: {}, hoja: nombreHoja, avisos: [`No existe la hoja "${nombreHoja}"`] };
  }

  // header:1 devuelve las filas crudas: el export suele traer títulos arriba
  // del encabezado de verdad, así que hay que buscarlo.
  const crudo = XLSX.utils.sheet_to_json(datos, { header: 1, blankrows: false, defval: "" });

  let fila = -1;
  let columnas = {};
  for (let i = 0; i < crudo.length; i += 1) {
    const encontradas = ubicarColumnas(crudo[i]);
    if (Object.keys(encontradas).length >= 2) { fila = i; columnas = encontradas; break; }
  }
  if (fila === -1) {
    return { filas: [], columnas: {}, hoja: nombreHoja,
      avisos: ["No encontré el encabezado. Esperaba alguna de: " + Object.keys(NOMBRES).join(", ")] };
  }

    const avisos = [];
  if (columnas.code === undefined) avisos.push("Falta la columna de código");
  if (columnas.stock === undefined) avisos.push("Falta la columna de stock");
  if (columnas.name === undefined) avisos.push("Falta la columna de nombre");

  const filas = [];
  for (let i = fila + 1; i < crudo.length; i += 1) {
    const f = crudo[i];
    const code = String(f[columnas.code] ?? "").trim();
    if (!code) continue;                     // filas de corte, totales o vacías
    filas.push({
      code,
      name: String(f[columnas.name] ?? "").trim(),
      stock: aNumero(f[columnas.stock]),
      subdeposito: String(f[columnas.subdeposito] ?? "").trim(),
    });
  }
  return { filas, columnas, hoja: nombreHoja, avisos };
}