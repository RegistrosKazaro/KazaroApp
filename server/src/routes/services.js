// server/src/routes/services.js  ← REEMPLAZA el archivo actual
import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { db, tinfo, getBudgetSettingsByServiceId } from "../db.js";

const router = Router();

function getEmpresaId(req) {
  return req.user?.empresaId ?? 1;
}

function getServiceCols() {
  const info = tinfo("Servicios");
  if (!info.length) throw new Error("No existe tabla Servicios");
  const pk   = info.find((c) => c.pk === 1)?.name || "ServiciosID";
  const name = info.find((c) => /servicio.*nombre|^nombre$|^descripcion$/i.test(c.name))?.name ||
               info.find((c) => /TEXT|CHAR/i.test(String(c.type)))?.name || pk;
  const hasEmpresa = info.some((c) => c.name === "empresa_id");
  return { SRV_ID: pk, SRV_NAME: name, hasEmpresa };
}

function listAssignedServicesFor(empleadoId, empresaId) {
  const { SRV_ID, SRV_NAME, hasEmpresa } = getServiceCols();

  const pivotInfo = tinfo("supervisor_services");
  if (!pivotInfo.length) return [];

  const PIV_EMP = pivotInfo.find((c) => /empleado.*id/i.test(c.name))?.name || "EmpleadoID";
  const PIV_SRV = pivotInfo.find((c) => /servicio.*id/i.test(c.name))?.name || "ServicioID";

  // Filtrar por empresa si la columna existe
  const empresaFilter = hasEmpresa ? `AND s.empresa_id = ${Number(empresaId)}` : "";

  const rows = db.prepare(`
    SELECT s.${SRV_ID} AS id, s.${SRV_NAME} AS name
    FROM supervisor_services a
    JOIN Servicios s ON CAST(s.${SRV_ID} AS TEXT) = CAST(a.${PIV_SRV} AS TEXT)
    WHERE CAST(a.${PIV_EMP} AS TEXT) = CAST(? AS TEXT)
    ${empresaFilter}
    ORDER BY ${SRV_NAME} COLLATE NOCASE
  `).all(String(empleadoId));

  return rows;
}

router.get("/", [requireAuth, requireRole("supervisor")], (req, res) => {
  try {
    const userId    = req.user?.id ?? null;
    const empresaId = getEmpresaId(req);
    if (!userId) return res.status(401).json({ error: "No autenticado" });
    return res.json(listAssignedServicesFor(userId, empresaId) || []);
  } catch (err) {
    console.error("[services] / error:", err);
    return res.status(500).json({ error: "Error interno" });
  }
});

router.get("/:id/budget", requireAuth, (req, res) => {
  try {
    const id = req.params.id;
    const { budget, maxPct } = getBudgetSettingsByServiceId(id);
    return res.json({ servicioId: id, budget, maxPct });
  } catch (e) {
    console.error("[services/:id/budget] error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
});

export default router;