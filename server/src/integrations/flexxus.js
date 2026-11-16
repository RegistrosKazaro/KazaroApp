// flexxus.js — Integración con Flexxus (API de consulta) para sincronizar stock.
//
// ESTADO: lee la API real (traerStockDeFlexxus). Sin cron: el stock se pisa sólo
// cuando un admin aprieta Aplicar en la pantalla de stock (POST /admin/flexxus/stock/api).
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
import { crearClienteFlexxus, configDesdeEnv } from "./flexxusClient.js";
import { DEPOSITO_CENTRAL } from "./flexxusDepositos.js";

const KAZARO_EMPRESA_ID = 1;

/** Enteros hacia abajo (los kilos de laboratorio vienen con decimales) y nunca
 *  negativo: decidido por el usuario el 16/11/2026. El 1e-6 absorbe 2.9999999. */
export const stockEntero = (n) => Math.max(0, Math.floor(Number(n ?? 0) + 1e-6) || 0);

export function isFlexxusConfigured() {
  return Boolean(configDesdeEnv());
}

/**
 * Stock real del depósito central, como filas { code, stock } para buildSyncReport.
 * El código de la app es el CODIGOPARTICULAR de Flexxus (408 de 409 coinciden,
 * 16/11/2026); el CODIGOARTICULO es interno. `offset` es el número de página.
 */
export async function traerStockDeFlexxus(cliente = crearClienteFlexxus(configDesdeEnv() ?? {})) {
  const filas = [];
  for (let pagina = 0; pagina < 100; pagina += 1) {
    const r = await cliente.llamar(`/stock?codigosdepositos=${DEPOSITO_CENTRAL}&limit=1000&offset=${pagina}`);
    const data = Array.isArray(r?.data) ? r.data : [];
    filas.push(...data);
    if (data.length < 1000 || filas.length >= Number(r?.count ?? 0)) break;
  }
  return filas
    .map((x) => ({ code: String(x.CODIGOPARTICULAR ?? "").trim(), stock: stockEntero(x.STOCKREAL) }))
    .filter((f) => f.code);
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
  const flexxusRows = await traerStockDeFlexxus();
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
      JSON.stringify({
        ...report.resumen,
        antes: cambios.map((m) =>({
          productId: m.productId, code: m.code, antes: m.stockApp, despues: m.stockFlexxus,
        })),
      })
    );
  } catch (e) {
    console.warn("[flexxus] no se pudo loguear el sync:", e?.message || e);
  }

  return { ...report, aplicados: dryRun ? 0 : cambios.length, dryRun };
}

/** Orquestador: trae de Flexxus, compara y (si dryRun=false) aplica. */
export async function runFlexxusSync({ dryRun = true } = {}) {
  const flexxusRows = await traerStockDeFlexxus();
  const appRows = readAppProducts();
  const report = buildSyncReport(appRows, flexxusRows);
  return applyStockSync(report, { dryRun });
}

export { normalizeCode, buildSyncReport };
