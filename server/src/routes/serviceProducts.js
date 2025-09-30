// server/src/routes/serviceProducts.js
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { db } from "../db.js";

const router = Router();

/* ===================== PIVOTE: detectar/crear ===================== */
function detectOrCreatePivot() {
  const t = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='service_products'")
    .get();

  if (!t) {
    db.exec(`
      CREATE TABLE service_products (
        service_id  TEXT NOT NULL,
        product_id  TEXT NOT NULL,
        PRIMARY KEY (service_id, product_id)
      );
      CREATE INDEX IF NOT EXISTS idx_sp_srv  ON service_products(service_id);
      CREATE INDEX IF NOT EXISTS idx_sp_prod ON service_products(product_id);
    `);
    return { srv: "service_id", prod: "product_id" };
  }

  const cols = db.prepare(`PRAGMA table_info('service_products')`).all();
  const names = new Set(cols.map(c => c.name.toLowerCase()));

  if (names.has("servicioid") && names.has("productoid")) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sp_srv  ON service_products(ServicioID);
      CREATE INDEX IF NOT EXISTS idx_sp_prod ON service_products(ProductoID);
    `);
    return { srv: "ServicioID", prod: "ProductoID" };
  }
  if (names.has("service_id") && names.has("product_id")) {
    return { srv: "service_id", prod: "product_id" };
  }
  if (names.has("servicio_id") && names.has("producto_id")) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sp_srv  ON service_products(servicio_id);
      CREATE INDEX IF NOT EXISTS idx_sp_prod ON service_products(producto_id);
    `);
    return { srv: "servicio_id", prod: "producto_id" };
  }

  // Caso raro: agrego columnas estándar y uso esas
  if (!names.has("service_id")) db.exec(`ALTER TABLE service_products ADD COLUMN service_id TEXT`);
  if (!names.has("product_id")) db.exec(`ALTER TABLE service_products ADD COLUMN product_id TEXT`);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sp_srv  ON service_products(service_id);
    CREATE INDEX IF NOT EXISTS idx_sp_prod ON service_products(product_id);
  `);
  return { srv: "service_id", prod: "product_id" };
}

const PIVOT = detectOrCreatePivot();

/* ===================== helpers ===================== */
function getAssignedIds(serviceId) {
  const rows = db
    .prepare(
      `SELECT ${PIVOT.prod} AS id
         FROM service_products
        WHERE CAST(${PIVOT.srv} AS TEXT) = CAST(? AS TEXT)`
    )
    .all(String(serviceId));
  return new Set(rows.map(r => String(r.id)));
}

/* ===================== rutas (usadas por Admin) ===================== */

/** IDs ya asignados */
router.get("/assignments/:serviceId", requireAuth, (req, res) => {
  try {
    const set = getAssignedIds(req.params.serviceId);
    res.json({ productIds: Array.from(set) });
  } catch (e) {
    console.error("[GET /admin/sp/assignments]", e);
    res.status(500).json({ error: "Error leyendo asignaciones: " + e.message });
  }
});

/** Guardado masivo (reemplaza todo el set) */
router.put("/assignments/:serviceId", requireAuth, (req, res) => {
  try {
    const sid = String(req.params.serviceId ?? "").trim();
    if (!sid) return res.status(400).json({ error: "serviceId requerido" });

    const raw = req.body?.productIds;
    if (!Array.isArray(raw)) return res.status(400).json({ error: "productIds debe ser un array" });

    const ids = Array.from(new Set(raw.map(x => String(x)))); // normalizo + dedup

    const tx = db.transaction(() => {
      db.prepare(
        `DELETE FROM service_products WHERE CAST(${PIVOT.srv} AS TEXT) = CAST(? AS TEXT)`
      ).run(sid);

      if (ids.length) {
        const ins = db.prepare(
          `INSERT OR IGNORE INTO service_products (${PIVOT.srv}, ${PIVOT.prod}) VALUES (?, ?)`
        );
        for (const pid of ids) ins.run(sid, pid);
      }
    });

    tx();
    res.json({
      ok: true,
      message: "Asignaciones guardadas",
      serviceId: sid,
      count: ids.length,
      productIds: ids
    });
  } catch (e) {
    console.error("[PUT /admin/sp/assignments] error:", e);
    res.status(500).json({ error: "Error guardando asignaciones: " + e.message });
  }
});

export default router;
