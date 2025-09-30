import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { db, discoverCatalogSchema } from "../db.js";

const router = Router();
const mustBeAdmin = [requireAuth, requireRole(["admin","Admin"])];

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

  if (!names.has("service_id")) db.exec(`ALTER TABLE service_products ADD COLUMN service_id TEXT`);
  if (!names.has("product_id")) db.exec(`ALTER TABLE service_products ADD COLUMN product_id TEXT`);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sp_srv ON service_products(service_id);
    CREATE INDEX IF NOT EXISTS idx_sp_prod ON service_products(product_id);
  `);
  return { srv: "service_id", prod: "product_id" };
}

const PIVOT = getPivotCols();

function prodSchemaOrThrow() {
  const sch = discoverCatalogSchema();
  if (!sch.ok) throw new Error(sch.reason || "Catálogo no detectado");
  return sch;
}

// Lista productos con flag `assigned` para un servicio
router.get("/products", mustBeAdmin, (req, res) => {
  try {
    const serviceId = String(req.query.serviceId ?? "").trim();
    if (!serviceId) return res.status(400).json({ error: "serviceId requerido" });

    const catId = req.query.catId ?? "__all__";
    const q = String(req.query.q ?? "").trim();
    const like = `%${q}%`;

    const { tables, cols } = prodSchemaOrThrow();
    const { products } = tables;
    const { prodId, prodName, prodCat, prodCode, prodPrice, prodStock } = cols;

    const whereParts = [];
    const params = {};

    if (q) {
      whereParts.push(`(${prodName} LIKE @like
                        ${prodCode ? `OR IFNULL(${prodCode},'') LIKE @like` : ""}
                        OR CAST(${prodId} AS TEXT) LIKE @like)`);
      params.like = like;
    }
    if (catId && catId !== "__all__") {
      whereParts.push(`CAST(${(prodCat ?? prodId)} AS TEXT) = CAST(@catId AS TEXT)`);
      params.catId = catId;
    }
    const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    const rows = db.prepare(`
      SELECT
        p.${prodId}   AS id,
        p.${prodName} AS name,
        ${prodCode ? `p.${prodCode}` : `''`} AS code,
        ${prodPrice ? `p.${prodPrice}` : `NULL`} AS price,
        ${prodStock ? `p.${prodStock}` : `NULL`} AS stock,
        CASE WHEN EXISTS (
          SELECT 1 FROM service_products sp
          WHERE CAST(sp.${PIVOT.srv} AS TEXT) = CAST(@serviceId AS TEXT)
            AND CAST(sp.${PIVOT.prod} AS TEXT) = CAST(p.${prodId} AS TEXT)
        ) THEN 1 ELSE 0 END AS assigned
      FROM ${products} p
      ${whereSql}
      ORDER BY assigned DESC, name COLLATE NOCASE
      LIMIT @limit OFFSET @offset
    `).all({
      ...params,
      serviceId,
      limit: Number(req.query.limit || 500),
      offset: Number(req.query.offset || 0),
    });

    res.json(rows);
  } catch (e) {
    console.error("[admin sp] GET /products error", e);
    res.status(500).json({ error: "No se pudieron listar los productos" });
  }
});

// IDs asignados
router.get("/assignments/:serviceId", mustBeAdmin, (req, res) => {
  try {
    const serviceId = req.params.serviceId;
    const ids = db.prepare(`
      SELECT ${PIVOT.prod} AS id
      FROM service_products
      WHERE CAST(${PIVOT.srv} AS TEXT) = CAST(? AS TEXT)
      ORDER BY CAST(${PIVOT.prod} AS TEXT)
    `).all(serviceId).map(r => r.id);
    res.json({ productIds: ids });
  } catch (e) {
    console.error("[admin sp] GET /assignments error", e);
    res.status(500).json({ error: "No se pudieron cargar las asignaciones" });
  }
});

// Reemplazo completo
router.put("/assignments/:serviceId", mustBeAdmin, (req, res) => {
  const serviceId = req.params.serviceId;
  const productIds = Array.isArray(req.body?.productIds) ? req.body.productIds : [];
  const tx = db.transaction(() => {
    db.prepare(
      `DELETE FROM service_products WHERE CAST(${PIVOT.srv} AS TEXT) = CAST(? AS TEXT)`
    ).run(serviceId);
    const ins = db.prepare(
      `INSERT OR IGNORE INTO service_products (${PIVOT.srv}, ${PIVOT.prod}) VALUES (?,?)`
    );
    for (const pid of productIds) ins.run(serviceId, String(pid));
  });
  try {
    tx();
    res.json({ ok: true, count: productIds.length });
  } catch (e) {
    console.error("[admin sp] PUT /assignments error", e);
    res.status(500).json({ error: "No se pudieron guardar las asignaciones" });
  }
});

// Toggle individual
router.patch("/assignments/:serviceId/toggle", mustBeAdmin, (req, res) => {
  try {
    const serviceId = req.params.serviceId;
    const productId = String(req.body?.productId ?? "");
    const assigned = !!req.body?.assigned;
    if (!productId) return res.status(400).json({ error: "productId requerido" });

    const del = db.prepare(
      `DELETE FROM service_products WHERE CAST(${PIVOT.srv} AS TEXT)=CAST(? AS TEXT) AND CAST(${PIVOT.prod} AS TEXT)=CAST(? AS TEXT)`
    );
    const ins = db.prepare(
      `INSERT OR IGNORE INTO service_products(${PIVOT.srv}, ${PIVOT.prod}) VALUES (?,?)`
    );
    if (assigned) ins.run(serviceId, productId); else del.run(serviceId, productId);
    return res.json({ ok: true });
  } catch (e) {
    console.error("[admin sp] PATCH /assignments/toggle error", e);
    res.status(500).json({ error: "No se pudo actualizar" });
  }
});

export default router;
