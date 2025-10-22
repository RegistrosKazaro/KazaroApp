const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

function resolveDbPath() {
  const inEnv = process.env.DB_PATH && (path.isAbsolute(process.env.DB_PATH) ? process.env.DB_PATH : path.resolve(process.cwd(), process.env.DB_PATH));
  const candidates = [inEnv, path.resolve(process.cwd(), "Kazaro.db"), path.resolve(process.cwd(), "server", "Kazaro.db")].filter(Boolean);
  for (const p of candidates) { try { if (fs.existsSync(p)) return p; } catch {} }
  return inEnv || path.resolve(process.cwd(), "Kazaro.db");
}

const dbPath = resolveDbPath();
if (!fs.existsSync(dbPath)) {
  console.error("[install] No existe la DB:", dbPath);
  process.exit(1);
}
const db = new Database(dbPath);
try { db.pragma("foreign_keys = ON"); } catch {}
try { db.pragma("busy_timeout = 5000"); } catch {}

const sql = `
CREATE TABLE IF NOT EXISTS Stock (
  ProductoID     INTEGER PRIMARY KEY,
  CantidadActual INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_Stock_ProductoID ON Stock (ProductoID);

CREATE TRIGGER IF NOT EXISTS trg_Productos_ins_stock
AFTER INSERT ON Productos
BEGIN
  INSERT INTO Stock(ProductoID, CantidadActual)
  VALUES (NEW.ProductID, COALESCE(NEW.Stock,0))
  ON CONFLICT(ProductoID) DO UPDATE SET CantidadActual = excluded.CantidadActual;
END;

CREATE TRIGGER IF NOT EXISTS trg_Productos_upd_stock
AFTER UPDATE OF Stock ON Productos
BEGIN
  INSERT INTO Stock(ProductoID, CantidadActual)
  VALUES (NEW.ProductID, COALESCE(NEW.Stock,0))
  ON CONFLICT(ProductoID) DO UPDATE SET CantidadActual = excluded.CantidadActual;
END;

CREATE TRIGGER IF NOT EXISTS trg_Stock_ins_prod
AFTER INSERT ON Stock
BEGIN
  UPDATE Productos
  SET Stock = COALESCE(NEW.CantidadActual,0)
  WHERE CAST(ProductID AS TEXT) = CAST(NEW.ProductoID AS TEXT);
END;

CREATE TRIGGER IF NOT EXISTS trg_Stock_upd_prod
AFTER UPDATE OF CantidadActual ON Stock
BEGIN
  UPDATE Productos
  SET Stock = COALESCE(NEW.CantidadActual,0)
  WHERE CAST(ProductID AS TEXT) = CAST(NEW.ProductoID AS TEXT);
END;

-- Seed inicial: copia Productos.Stock -> Stock.CantidadActual
INSERT INTO Stock(ProductoID, CantidadActual)
SELECT ProductID, COALESCE(Stock,0) FROM Productos
ON CONFLICT(ProductoID) DO UPDATE SET CantidadActual = excluded.CantidadActual;
`;

db.exec(sql);
console.log("[install] Triggers instalados y seed ejecutado en:", dbPath);

// Mostrar triggers para confirmar
const trg = db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_%' ORDER BY name").all();
console.table(trg);
db.close();
