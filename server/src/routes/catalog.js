import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { listCategories, listProductsByCategory, db } from "../db.js";

const router = express.Router();

/** Detecta/crea la tabla pivote y devuelve los nombres de columna a usar */
function getPivotCols() {
  const exists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='service_products'`)
    .get();

  if (!exists) {
    db.exec(`
      CREATE TABLE service_products (
        service_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        PRIMARY KEY (service_id, product_id)
      );
      CREATE INDEX IF NOT EXISTS idx_sp_srv ON service_products(service_id);
      CREATE INDEX IF NOT EXISTS idx_sp_prod ON service_products(product_id);
    `);
    return { srv: "service_id", prod: "product_id" };
  }

  const cols = db.prepare(`PRAGMA table_info('service_products')`).all();
  const names = new Set(cols.map(c => c.name.toLowerCase()));

  if (names.has("servicioid") && names.has("productoid")) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sp_srv ON service_products(ServicioID);
      CREATE INDEX IF NOT EXISTS idx_sp_prod ON service_products(ProductoID);
    `);
    return { srv: "ServicioID", prod: "ProductoID" };
  }
  if (names.has("service_id") && names.has("product_id")) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sp_srv ON service_products(service_id);
      CREATE INDEX IF NOT EXISTS idx_sp_prod ON service_products(product_id);
    `);
    return { srv: "service_id", prod: "product_id" };
  }

  // Normalizo si vinieran otros nombres
  if (!names.has("service_id")) db.exec(`ALTER TABLE service_products ADD COLUMN service_id TEXT`);
  if (!names.has("product_id")) db.exec(`ALTER TABLE service_products ADD COLUMN product_id TEXT`);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sp_srv ON service_products(service_id);
    CREATE INDEX IF NOT EXISTS idx_sp_prod ON service_products(product_id);
  `);
  return { srv: "service_id", prod: "product_id" };
}

const PIVOT = getPivotCols();

router.get("/categories", requireAuth, (_req, res) => {
  try {
    res.json(listCategories());
  } catch (e) {
    console.error("[/catalog/categories]", e);
    res.status(500).json({ error: "No se pudieron cargar las categorías" });
  }
});

// Filtra por serviceId (si viene) y mantiene categorías/búsqueda
router.get("/products", (req, res) => {
  const catId = req.query.catId ?? "__all__";
  const q = req.query.q ?? "";
  const serviceId = req.query.serviceId ? String(req.query.serviceId) : null;

  try {
    let rows = listProductsByCategory(catId, { q }) || [];
    if (serviceId) {
      const ids = new Set(
        db.prepare(
          `SELECT ${PIVOT.prod} AS id
           FROM service_products
           WHERE CAST(${PIVOT.srv} AS TEXT) = CAST(? AS TEXT)`
        ).all(serviceId).map(r => String(r.id))
      );
      rows = rows.filter(r => ids.has(String(r.id)));
    }
    res.json(rows);
  } catch (e) {
    console.error("[/catalog/products]", e);
    res.status(500).json({ error: "No se pudieron cargar los productos" });
  }
});

export default router;
