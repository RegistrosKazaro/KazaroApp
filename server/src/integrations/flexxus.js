// flexxus.js — Integración con Flexxus (API de consulta) para sincronizar stock.
//
// ESTADO: ANDAMIAJE. No está conectado a ninguna ruta ni cron todavía. Nada se
// ejecuta ni escribe automáticamente. Cuando Flexxus entregue el endpoint y las
// credenciales, se completa fetchProductsFromFlexxus() y se decide la política
// de escritura (ver DECISIONES abajo).
//
// DECISIONES pendientes con el usuario:
//   1) ¿Quién manda el stock? Este esqueleto asume "Flexxus manda": en un sync
//      real pisa Productos.Stock con el de Flexxus (solo Kazaro). Está detrás de
//      dryRun=true por defecto, así que no escribe salvo que se pida explícito.
//   3) ¿El stock viene por producto (un número) o por subdepósito? Hoy se asume
//      un número por producto -> Productos.Stock. Si fuera por subdepósito, habría
//      que mapear a warehouses/warehouse_stock.
//   4) Subdepósito -> Categoría: por ahora el reporte MUESTRA subdeposito vs
//      categoriaId, pero NO reescribe categorías (queda como TODO).
//
// Empresa: Flexxus es SOLO Kazaro (empresa_id = 1). Ver [[multiempresa-isolation]].

import { db } from "../db.js";
import { normalizeCode, buildSyncReport } from "./flexxusCore.js";

const KAZARO_EMPRESA_ID = 1;

export function isFlexxusConfigured() {
  return Boolean(process.env.FLEXXUS_API_URL && process.env.FLEXXUS_TOKEN);
}

/**
 * Trae los productos desde Flexxus, normalizados a { code, name, stock, subdeposito }.
 *
 * STUB: todavía no hay endpoint. Cuando esté, implementar acá la llamada real
 * (por ejemplo con axios) y mapear la respuesta de Flexxus a ese formato:
 *
 *   const { data } = await axios.get(process.env.FLEXXUS_API_URL, {
 *     headers: { Authorization: `Bearer ${process.env.FLEXXUS_TOKEN}` },
 *   });
 *   return data.items.map((it) => ({
 *     code: it.codigo, name: it.descripcion, stock: it.stock, subdeposito: it.subdeposito,
 *   }));
 */
export async function fetchProductsFromFlexxus() {
  if (!isFlexxusConfigured()) {
    throw new Error("FLEXXUS_NO_CONFIGURADO: faltan FLEXXUS_API_URL y/o FLEXXUS_TOKEN en el .env");
  }
  // TODO: implementar la llamada real cuando Flexxus entregue el endpoint.
  throw new Error("FLEXXUS_FETCH_NO_IMPLEMENTADO: completar fetchProductsFromFlexxus() con la API real");
}

/** Lee los productos activos de Kazaro para comparar. */
export function readAppProducts() {
  return db.prepare(
    `SELECT ProductID AS productId, Code AS code, ProductName AS name,
            COALESCE(Stock,0) AS stock, CategoriaID AS categoriaId
     FROM Productos
     WHERE empresa_id = ? AND COALESCE(is_active,1) = 1`
  ).all(KAZARO_EMPRESA_ID);
}

/** Reporte de diferencias sin tocar nada (dry-run puro). */
export async function previewStockSync() {
  const flexxusRows = await fetchProductsFromFlexxus();
  const appRows = readAppProducts();
  return buildSyncReport(appRows, flexxusRows);
}

function ensureFlexxusLogTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS flexxus_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT DEFAULT (datetime('now')),
      empresa_id INTEGER,
      matcheados INTEGER, actualizados INTEGER,
      solo_app INTEGER, solo_flexxus INTEGER,
      colisiones INTEGER, dry_run INTEGER,
      detalle TEXT
    );
  `);
}

/**
 * Aplica la sincronización: pisa Productos.Stock con el de Flexxus para los
 * productos matcheados (solo Kazaro). Con dryRun=true (default) NO escribe:
 * solo devuelve el reporte. Loguea cada corrida en flexxus_sync_log.
 */
export function applyStockSync(report, { dryRun = true } = {}) {
  ensureFlexxusLogTable();
  const cambios = report.matched.filter((m) => m.diff !== 0);

  if (!dryRun) {
    const upd = db.prepare(`UPDATE Productos SET Stock = ? WHERE ProductID = ? AND empresa_id = ?`);
    const tx = db.transaction(() => {
      for (const m of cambios) upd.run(m.stockFlexxus, m.productId, KAZARO_EMPRESA_ID);
    });
    tx();
  }

  try {
    db.prepare(
      `INSERT INTO flexxus_sync_log (empresa_id, matcheados, actualizados, solo_app, solo_flexxus, colisiones, dry_run, detalle)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      KAZARO_EMPRESA_ID,
      report.resumen.matcheados,
      dryRun ? 0 : cambios.length,
      report.resumen.soloEnApp,
      report.resumen.soloEnFlexxus,
      report.resumen.colisionesApp + report.resumen.colisionesFlexxus,
      dryRun ? 1 : 0,
      JSON.stringify(report.resumen)
    );
  } catch (e) {
    console.warn("[flexxus] no se pudo loguear el sync:", e?.message || e);
  }

  return { ...report, aplicados: dryRun ? 0 : cambios.length, dryRun };
}

/** Orquestador: trae de Flexxus, compara y (si dryRun=false) aplica. */
export async function runFlexxusSync({ dryRun = true } = {}) {
  const flexxusRows = await fetchProductsFromFlexxus();
  const appRows = readAppProducts();
  const report = buildSyncReport(appRows, flexxusRows);
  return applyStockSync(report, { dryRun });
}

export { normalizeCode, buildSyncReport };
