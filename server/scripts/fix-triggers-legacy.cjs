const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

function dbPath() {
  const p = process.env.DB_PATH;
  if (!p) throw new Error("DB_PATH no seteado");
  if (!fs.existsSync(p)) throw new Error("No existe DB en " + p);
  return p;
}

const db = new Database(dbPath());
try { db.pragma("foreign_keys=ON"); } catch {}
try { db.pragma("busy_timeout=5000"); } catch {}

const sql = `

-- 1) Asegurar tabla Stock e índice
CREATE TABLE IF NOT EXISTS Stock (
  ProductoID     INTEGER PRIMARY KEY,
  CantidadActual INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_Stock_ProductoID ON Stock (ProductoID);

-- 2) Borrar triggers viejos (si quedaron con sintaxis incompatible)
DROP TRIGGER IF EXISTS trg_Productos_ins_stock;
DROP TRIGGER IF EXISTS trg_Productos_upd_stock;
DROP TRIGGER IF EXISTS trg_Stock_ins_prod;
DROP TRIGGER IF EXISTS trg_Stock_upd_prod;

-- 3) Crear triggers SIN 'ON CONFLICT DO UPDATE' (compatibles con SQLite viejo)

-- Productos -> Stock (INSERT)
CREATE TRIGGER trg_Productos_ins_stock
AFTER INSERT ON Productos
BEGIN
  UPDATE Stock
    SET CantidadActual = COALESCE(NEW.Stock,0)
    WHERE ProductoID = NEW.ProductID;
  INSERT OR IGNORE INTO Stock(ProductoID, CantidadActual)
    VALUES (NEW.ProductID, COALESCE(NEW.Stock,0));
END;

-- Productos -> Stock (UPDATE de columna Stock)
CREATE TRIGGER trg_Productos_upd_stock
AFTER UPDATE OF Stock ON Productos
BEGIN
  UPDATE Stock
    SET CantidadActual = COALESCE(NEW.Stock,0)
    WHERE ProductoID = NEW.ProductID;
  INSERT OR IGNORE INTO Stock(ProductoID, CantidadActual)
    VALUES (NEW.ProductID, COALESCE(NEW.Stock,0));
END;

-- Stock -> Productos (INSERT)
CREATE TRIGGER trg_Stock_ins_prod
AFTER INSERT ON Stock
BEGIN
  UPDATE Productos
    SET Stock = COALESCE(NEW.CantidadActual,0)
    WHERE CAST(ProductID AS TEXT) = CAST(NEW.ProductoID AS TEXT);
END;

-- Stock -> Productos (UPDATE de CantidadActual)
CREATE TRIGGER trg_Stock_upd_prod
AFTER UPDATE OF CantidadActual ON Stock
BEGIN
  UPDATE Productos
    SET Stock = COALESCE(NEW.CantidadActual,0)
    WHERE CAST(ProductID AS TEXT) = CAST(NEW.ProductoID AS TEXT);
END;

`;
db.exec(sql);

//
// 4) Seed LEGACY: Productos.Stock -> Stock.CantidadActual
//
db.exec(`
  INSERT OR IGNORE INTO Stock(ProductoID, CantidadActual)
  SELECT ProductID, COALESCE(Stock,0)
  FROM Productos;

  UPDATE Stock
  SET CantidadActual = (
    SELECT COALESCE(p.Stock,0)
    FROM Productos p
    WHERE p.ProductID = Stock.ProductoID
  )
  WHERE EXISTS (
    SELECT 1 FROM Productos p
    WHERE p.ProductID = Stock.ProductoID
  );
`);

console.log("[fix-triggers-legacy] OK en:", process.env.DB_PATH);

// Mostrar triggers y primeras filas comparativas
const trg = db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
console.table(trg);
const sample = db.prepare(`
  SELECT p.ProductID, p.ProductName, p.Stock AS stock_prod,
         s.CantidadActual AS stock_tbl
  FROM Productos p
  LEFT JOIN Stock s ON s.ProductoID = p.ProductID
  ORDER BY p.ProductID
  LIMIT 5;
`).all();
console.table(sample);

db.close();
