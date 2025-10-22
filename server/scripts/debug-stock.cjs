const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

function resolveDbPath() {
  const inEnv = process.env.DB_PATH && (path.isAbsolute(process.env.DB_PATH) ? process.env.DB_PATH : path.resolve(process.cwd(), process.env.DB_PATH));
  const candidates = [
    inEnv,
    path.resolve(process.cwd(), "Kazaro.db"),
    path.resolve(process.cwd(), "data", "Kazaro.db"),
    path.resolve(process.cwd(), "server", "Kazaro.db"),
    path.resolve(process.cwd(), "server", "data", "Kazaro.db"),
    path.resolve(process.cwd(), "..", "Kazaro.db"),
    path.resolve(process.cwd(), "..", "data", "Kazaro.db"),
  ].filter(Boolean);
  for (const p of candidates) { try { if (fs.existsSync(p)) return p; } catch {} }
  return inEnv || path.resolve(process.cwd(), "Kazaro.db");
}

const dbPath = resolveDbPath();
console.log("[debug] DB path:", dbPath, "exists?", fs.existsSync(dbPath));
if (!fs.existsSync(dbPath)) {
  console.error("[debug] No existe la DB en ese path. Ajustá DB_PATH a la ruta ABSOLUTA correcta y probá de nuevo.");
  process.exit(1);
}

const db = new Database(dbPath);
try { db.pragma("foreign_keys = ON"); } catch {}
try { db.pragma("busy_timeout = 5000"); } catch {}

console.log("\n[debug] PRAGMA database_list:");
console.table(db.prepare("PRAGMA database_list").all());

console.log("\n[debug] Tablas relevantes:");
console.table(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('Productos','Stock')").all());

console.log("\n[debug] Triggers presentes:");
console.table(db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_%' ORDER BY name").all());

console.log("\n[debug] Muestra Productos vs Stock (5 filas):");
try {
  const sample = db.prepare(`
    SELECT p.ProductID, p.ProductName, p.Stock AS stock_prod,
           s.CantidadActual AS stock_tbl
    FROM Productos p
    LEFT JOIN Stock s ON s.ProductoID = p.ProductID
    ORDER BY p.ProductID
    LIMIT 5;
  `).all();
  console.table(sample);
} catch (e) {
  console.error("[debug] Error leyendo tablas esperadas:", e.message);
}

db.close();
console.log("\n[debug] Listo.");
