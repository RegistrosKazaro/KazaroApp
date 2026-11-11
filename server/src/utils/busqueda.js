// server/src/utils/busqueda.js
// Helpers de búsqueda para que todas las pantallas busquen igual: sin importar
// mayúsculas ni acentos. SQLite no trae una función para sacar acentos, así que
// se arma con REPLACE anidados y se normaliza el término del mismo modo.

// Pares acento -> letra simple, en minúscula y en mayúscula. Hacen falta las
// dos: el LOWER() de SQLite sólo baja las letras ASCII, así que "PAÑO" queda
// "paÑo" y, sin el par de la Ñ mayúscula, buscar "paño" no lo encontraba.
// Los nombres de los insumos están cargados en mayúscula.
const ACENTOS = [
  ["á", "a"], ["à", "a"], ["ä", "a"], ["â", "a"],
  ["é", "e"], ["è", "e"], ["ë", "e"], ["ê", "e"],
  ["í", "i"], ["ì", "i"], ["ï", "i"], ["î", "i"],
  ["ó", "o"], ["ò", "o"], ["ö", "o"], ["ô", "o"],
  ["ú", "u"], ["ù", "u"], ["ü", "u"], ["û", "u"],
  ["ñ", "n"],
  ["Á", "a"], ["À", "a"], ["Ä", "a"], ["Â", "a"],
  ["É", "e"], ["È", "e"], ["Ë", "e"], ["Ê", "e"],
  ["Í", "i"], ["Ì", "i"], ["Ï", "i"], ["Î", "i"],
  ["Ó", "o"], ["Ò", "o"], ["Ö", "o"], ["Ô", "o"],
  ["Ú", "u"], ["Ù", "u"], ["Ü", "u"], ["Û", "u"],
  ["Ñ", "n"],
];

/**
 * Expresión SQL que devuelve la columna en minúsculas y sin acentos.
 * Usar junto con normalizarBusqueda() para que ambos lados coincidan.
 */
export function sinAcentosSql(expr) {
  let out = `LOWER(COALESCE(${expr},''))`;
  for (const [de, a] of ACENTOS) out = `REPLACE(${out},'${de}','${a}')`;
  return out;
}

/** Normaliza el término buscado igual que sinAcentosSql: minúsculas y sin acentos. */
export function normalizarBusqueda(texto) {
  let s = String(texto ?? "").toLowerCase().trim();
  for (const [de, a] of ACENTOS) s = s.split(de).join(a);
  return s;
}
