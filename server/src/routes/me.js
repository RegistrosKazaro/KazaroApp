// server/src/routes/me.js
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { getAssignedServices, getEmployeeDisplayName } from "../db.js";

const router = Router();

router.get("/services", requireAuth, (req, res) => {
  try {
    const userId = req.user?.id;
    res.json(getAssignedServices(userId));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudieron obtener los servicios" });
  }
});

router.get("/display-name", requireAuth, (req, res) => {
  try {
    const userId = req.user?.id;
    res.json({ displayName: getEmployeeDisplayName(userId) });
  } catch {
    res.json({ displayName: `Empleado ${req.user?.id ?? ""}`.trim() });
  }
});

export default router;
