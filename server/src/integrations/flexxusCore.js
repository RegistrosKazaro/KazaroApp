// flexxusCore.js — Lógica PURA de la integración con Flexxus (sin DB ni HTTP).
// Se separa para poder testearla sola. La parte con base/red vive en flexxus.js.
//
// Contexto: Flexxus expone una API de solo consulta. Nosotros comparamos por
// CÓDIGO de producto (mismo código, pero Flexxus puede traer ceros a la izquierda:
// "004" == "4"). Con eso alimentamos nuestro stock. Solo aplica a Kazaro.

/**
 * Normaliza un código para comparar. Numéricos: saca ceros a la izquierda
 * ("004" -> "4", "000" -> "0"). No numéricos: trim + mayúsculas.
 */
export function normalizeCode(code) {
  const s = String(code == null ? "" : code).trim();
  if (s === "") return "";
  if (/^\d+$/.test(s)) return s.replace(/^0+/, "") || "0";
  return s.toUpperCase();
}

/**
 * Construye un reporte de sincronización comparando lo que hay en la app con lo
 * que trae Flexxus. NO toca nada: es solo el diagnóstico (dry-run).
 *
 * @param appRows     [{ productId, code, name, stock, categoriaId }]
 * @param flexxusRows [{ code, name, stock, subdeposito }]
 * @returns {{
 *   matched: Array, soloEnApp: Array, soloEnFlexxus: Array,
 *   colisionesApp: Array, colisionesFlexxus: Array, resumen: object
 * }}
 */
export function buildSyncReport(appRows = [], flexxusRows = []) {
  // Índice de la app por código normalizado; detecta colisiones (dos productos
  // distintos que caen en el mismo código normalizado).
  const appByCode = new Map();
  const colisionesApp = [];
  for (const p of appRows) {
    const k = normalizeCode(p.code);
    if (!k) continue;
    if (appByCode.has(k)) {
      colisionesApp.push({ code: k, productos: [appByCode.get(k), p] });
      continue;
    }
    appByCode.set(k, p);
  }

  const flexByCode = new Map();
  const colisionesFlexxus = [];
  for (const f of flexxusRows) {
    const k = normalizeCode(f.code);
    if (!k) continue;
    if (flexByCode.has(k)) { colisionesFlexxus.push({ code: k }); continue; }
    flexByCode.set(k, f);
  }

  const matched = [];
  const soloEnFlexxus = [];
  for (const [k, f] of flexByCode) {
    const p = appByCode.get(k);
    if (!p) { soloEnFlexxus.push({ code: k, name: f.name, stock: f.stock, subdeposito: f.subdeposito }); continue; }
    const stockApp = Number(p.stock ?? 0);
    const stockFlexxus = Number(f.stock ?? 0);
    matched.push({
      productId: p.productId,
      code: k,
      nombreApp: p.name,
      nombreFlexxus: f.name,
      stockApp,
      stockFlexxus,
      diff: stockFlexxus - stockApp,
      subdeposito: f.subdeposito ?? null,
      categoriaId: p.categoriaId ?? null,
    });
  }

  const soloEnApp = [];
  for (const [k, p] of appByCode) {
    if (!flexByCode.has(k)) soloEnApp.push({ productId: p.productId, code: k, name: p.name, stock: Number(p.stock ?? 0) });
  }

  return {
    matched,
    soloEnApp,
    soloEnFlexxus,
    colisionesApp,
    colisionesFlexxus,
    resumen: {
      appTotal: appRows.length,
      flexxusTotal: flexxusRows.length,
      matcheados: matched.length,
      conCambioStock: matched.filter((m) => m.diff !== 0).length,
      soloEnApp: soloEnApp.length,
      soloEnFlexxus: soloEnFlexxus.length,
      colisionesApp: colisionesApp.length,
      colisionesFlexxus: colisionesFlexxus.length,
    },
  };
}
