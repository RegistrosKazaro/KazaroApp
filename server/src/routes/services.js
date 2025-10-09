// server/src/routes/services.js
import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { db, ensureSupervisorPivot, getBudgetByServiceId } from "../db.js";

const router = Router();

function tableInfo(name) {
  try { return db.prepare(`PRAGMA table_info(${name})`).all(); } catch { return []; }
}
function pick(info, re) {
  return info.find(c => re.test(String(c.name)))?.name || null;
}

const empInfo = tableInfo("Empleados");
const srvInfo = tableInfo("Servicios");

const EMP_ID   = (empInfo.find(c => c.pk === 1)?.name) || "EmpleadosID";
const EMP_NAME = pick(empInfo, /username|nombre|email/i) || "Email";
const SRV_ID   = (srvInfo.find(c => c.pk === 1)?.name) || "ServiciosID";
const SRV_NAME = pick(srvInfo, /nombre|name/i) || "ServicioNombre";

// GET /services (supervisor): servicios asignados al usuario logueado
router.get("/", [requireAuth, requireRole("supervisor")], (req, res) => {
  try {
    const userId = req.user?.id ?? null;
    if (!userId) return res.status(401).json({ error: "No autenticado" });

    ensureSupervisorPivot();

    const rows = db.prepare(`
      SELECT s.${SRV_ID}   AS id,
             s.${SRV_NAME} AS name
      FROM supervisor_services a
      JOIN Servicios s ON s.${SRV_ID} = a.ServicioID
      WHERE a.EmpleadoID = ?
      ORDER BY name COLLATE NOCASE
    `).all(userId);

    return res.json(rows || []);
  } catch (err) {
    console.error("[services] / error:", err);
    return res.status(500).json({ error: "Error interno" });
  }
});

// GET /services/:id/budget → presupuesto (autenticado)
router.get("/:id/budget", requireAuth, (req, res) => {
  const id = req.params.id;
  const budget = getBudgetByServiceId(id);
  return res.json({ servicioId: id, budget });
});

export default router;
