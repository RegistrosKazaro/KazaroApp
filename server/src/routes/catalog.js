import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { listCategories, listProductsByCategory } from "../db.js";

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
  const catId = req.query.catId ?? "__all__";   // <— usar 'catId' porque así lo manda el front
  const q = req.query.q ?? "";
  const serviceId = req.query.serviceId ? Number(req.query.serviceId) : null;

  const rows = listProductsByCategory(catId, { q, serviceId });
  res.json(rows);
});

export default router;
