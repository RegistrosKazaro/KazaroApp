// server/src/routes/catalog.js
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { listCategories, listProductsByCategory, db } from "../db.js";

const router = express.Router();

router.get("/categories", requireAuth, (_req, res) => {
  try {
    res.json(listCategories());
  } catch (e) {
    console.error("[/catalog/categories]", e);
    res.status(500).json({ error: "No se pudieron cargar las categorías" });
  }
});

router.get("/products", (req, res) => {
  try {
    const catId = req.query.catId ?? "__all__";
    const q = req.query.q ?? "";
    const serviceId = req.query.serviceId ? String(req.query.serviceId) : null;

    const rows = listProductsByCategory(catId, { q, serviceId });
    res.json(rows);
  } catch (e) {
    console.error("[/catalog/products]", e);
    res.status(500).json({ error: "No se pudieron cargar los productos" });
  }
});

/**
 * Resumen público de ingresos futuros para un producto.
 * GET /catalog/incoming-summary/:productId
 * Responde: { productId, total, eta }
 *  - total: suma de qty
 *  - eta: fecha mínima de ingreso (string o null)
 */
router.get("/incoming-summary/:productId", (req, res) => {
  try {
    const pid = String(req.params.productId || "").trim();
    if (!pid) return res.status(400).json({ error: "productId requerido" });

    const row =
      db
        .prepare(
          `
          SELECT SUM(qty) AS total, MIN(eta) AS eta
          FROM IncomingStock
          WHERE CAST(product_id AS TEXT) = CAST(? AS TEXT)
        `
        )
        .get(pid) || {};

    res.json({
      productId: pid,
      total: Number(row.total || 0),
      eta: row.eta || null,
    });
  } catch (e) {
    console.error("[/catalog/incoming-summary/:productId]", e);
    res
      .status(500)
      .json({ error: "No se pudo obtener el resumen de ingresos futuros" });
  }
});

export default router;
