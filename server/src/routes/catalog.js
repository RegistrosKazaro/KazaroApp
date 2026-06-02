// server/src/routes/catalog.js  ← REEMPLAZA el archivo actual
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { listCategories, listProductsByCategory, db } from "../db.js";
import {
  getWarehouseForChildService,
  getWarehouseStockMap,
} from "../warehouses.js";

const router = express.Router();

// Helper: devuelve empresa_id del usuario logueado (1 = Kazaro por defecto)
function getEmpresaId(req) {
  return req.user?.empresaId ?? 1;
}

router.get("/categories", requireAuth, (req, res) => {
  try {
    res.json(listCategories(req.user?.empresaId ?? 1));
  } catch (e) {
    console.error("[/catalog/categories]", e);
    res.status(500).json({ error: "No se pudieron cargar las categorías" });
  }
});

router.get("/products", requireAuth, (req, res) => {
  try {
    const catId     = req.query.catId ?? "__all__";
    const q         = req.query.q ?? "";
    const serviceId = req.query.serviceId ? String(req.query.serviceId) : null;
    const empresaId = getEmpresaId(req);

    const userRoles = (req.user?.roles || []).map(r => String(r).toLowerCase());

    const rows = listProductsByCategory(catId, {
      q,
      serviceId,
      roles: userRoles,
      empresaId,   // ← pasamos empresa para filtrar
    });

    // Si el serviceId corresponde a un servicio HIJO de un depósito,
    // reemplazamos el campo "stock" de cada producto por el stock del depósito.
    // Así la tarjeta en Products.jsx se desactiva automáticamente
    // cuando el depósito no tiene (muestra "Sin stock" igual que siempre).
    if (serviceId) {
      try {
        const warehouse = getWarehouseForChildService(serviceId);
        if (warehouse) {
          const stockMap = getWarehouseStockMap(warehouse.id);
          for (const r of rows) {
            const pid = String(r.id);
            const whStock = stockMap.has(pid) ? stockMap.get(pid) : 0;
            r.stock = whStock;
            // Ocultamos los ingresos futuros porque son del stock general,
            // no del depósito.
            r.incoming = 0;
            r.nextEta = null;
          }
        }
      } catch (e) {
        // Si warehouses no está inicializado, seguimos con el stock general.
        console.warn("[/catalog/products] warehouse check skipped:", e?.message || e);
      }
    }

    res.json(rows);
  } catch (e) {
    console.error("[/catalog/products]", e);
    res.status(500).json({ error: "No se pudieron cargar los productos" });
  }
});

router.get("/incoming-summary/:productId", requireAuth, (req, res) => {
  try {
    const pid = String(req.params.productId || "").trim();
    if (!pid) return res.status(400).json({ error: "productId requerido" });

    const row = db.prepare(`
      SELECT SUM(qty) AS total, MIN(eta) AS eta
      FROM IncomingStock
      WHERE CAST(product_id AS TEXT) = CAST(? AS TEXT)
    `).get(pid) || {};

    res.json({
      productId: pid,
      total: Number(row.total || 0),
      eta: row.eta || null,
    });
  } catch (e) {
    console.error("[/catalog/incoming-summary/:productId]", e);
    res.status(500).json({ error: "No se pudo obtener el resumen de ingresos futuros" });
  }
});

export default router;