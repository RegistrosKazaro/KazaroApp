// server/src/utils/busqueda.js
// Helpers de búsqueda para que todas las pantallas busquen igual: sin importar
// mayúsculas ni acentos. SQLite no trae una función para sacar acentos, así que
// se arma con REPLACE anidados y se normaliza el término del mismo modo.

// Pares acento -> letra simple. Se aplican sobre el texto ya en minúsculas.
const ACENTOS = [
  ["á", "a"], ["à", "a"], ["ä", "a"], ["â", "a"],
  ["é", "e"], ["è", "e"], ["ë", "e"], ["ê", "e"],
  ["í", "i"], ["ì", "i"], ["ï", "i"], ["î", "i"],
  ["ó", "o"], ["ò", "o"], ["ö", "o"], ["ô", "o"],
  ["ú", "u"], ["ù", "u"], ["ü", "u"], ["û", "u"],
  ["ñ", "n"],
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
