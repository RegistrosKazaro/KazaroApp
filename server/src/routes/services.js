// server/src/routes/supervisor.js
import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { db, ensureSupervisorPivot } from "../db.js";

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

// GET /supervisor/services  → servicios asignados al usuario logueado
router.get("/services", [requireAuth, requireRole("supervisor")], (req, res) => {
  try {
    const userId = req.user?.id ?? null;
    if (!userId) return res.status(401).json({ error: "No autenticado" });

    ensureSupervisorPivot(); // crea supervisor_services si falta

    // Traemos los servicios asignados por EmpleadoID
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
    console.error("[supervisor] /services error:", err);
    return res.status(500).json({ error: "Error interno" });
  }
});

export default router;

