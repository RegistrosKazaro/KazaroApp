// server/src/routes/supervisor.js
import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getAssignedServices } from "../db.js";

const router = Router();

// El supervisor ve sus servicios tal cual están en la BD (pivot)
router.get("/services", [requireAuth, requireRole("supervisor")], (req, res) => {
  try {
    const userId = req.user?.id ?? req.auth?.id ?? req.userId ?? null;
    if (!userId) return res.status(401).json({ error: "No autenticado" });
    const services = getAssignedServices(userId);
    return res.json(services || []);
  } catch (err) {
    console.error("[supervisor] /services error:", err);
    return res.status(500).json({ error: "Error interno" });
  }
});

export default router;
