/**
 * Normaliza texto para búsquedas/comparaciones: minúsculas, sin acentos,
 * sin espacios de más. Pensado para filtros donde "José " y "jose" deben
 * matchear. Es un superset seguro de las versiones que había duplicadas.
 */
export function normalizeText(v) {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}
