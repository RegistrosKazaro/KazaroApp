// server/src/routes/orders.js
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { db, getFullOrder, createOrder, getProductForOrder, getEmployeeDisplayName } from "../db.js";

const router = Router();

/**
 * GET /orders/:id
 * Devuelve el pedido completo (cabecera + items).
 */
router.get("/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "id inválido" });
  }
  try {
    const data = getFullOrder(id);
    if (!data?.cab) return res.status(404).json({ error: "Pedido no encontrado" });

    const displayName = getEmployeeDisplayName(data.cab.EmpleadoID);
    return res.json({ ...data, empleadoNombre: displayName });
  } catch (e) {
    console.error("[orders] GET /:id error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
});

/**
 * POST /orders
 * Crea un pedido nuevo.
 * body: { empleadoId, rol, nota, items:[{productId, qty}], servicioId? }
 */
router.post("/", requireAuth, (req, res) => {
  try {
    const { empleadoId, rol, nota, items, servicioId } = req.body || {};
    if (!empleadoId || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "empleadoId e items[] son requeridos" });
    }
    const out = createOrder({ empleadoId, rol, nota, items, servicioId });
    return res.json({ ok: true, ...out });
  } catch (e) {
    console.error("[orders] POST / error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
});

/**
 * GET /orders/product/:id
 * Devuelve datos mínimos del producto para armar items.
 */
router.get("/product/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "id inválido" });
  }
  try {
    const p = getProductForOrder(id);
    if (!p) return res.status(404).json({ error: "Producto no encontrado" });
    return res.json(p);
  } catch (e) {
    console.error("[orders] GET /product/:id error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
});

export default router;
