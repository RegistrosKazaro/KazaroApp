// server/src/routes/supervisor.js
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { db, tinfo } from "../db.js";

const router = Router();

function getLoggedEmployeeId(req) {
  return (
    req.user?.empleadoId ??
    req.user?.EmpleadosID ??
    req.user?.EmpleadoID ??
    req.user?.id ??
    req.user?.userId ??
    null
  );
}

function getServiceCols() {
  const info = tinfo("Servicios");
  if (!info.length) throw new Error("No existe tabla Servicios");
  const pk = info.find(c => c.pk === 1)?.name || "ServiciosID";
  const name =
    info.find(c => /servicio.*nombre|^nombre$|^descripcion$/i.test(c.name))?.name ||
    info.find(c => /TEXT|CHAR/i.test(String(c.type)))?.name ||
    pk;
  return { SRV_ID: pk, SRV_NAME: name };
}

function listAssignedServicesFor(empleadoId) {
  const { SRV_ID, SRV_NAME } = getServiceCols();

  const pivotInfo = tinfo("supervisor_services");
  if (!pivotInfo.length) return [];

  const PIV_EMP = pivotInfo.find(c => /empleado.*id/i.test(c.name))?.name || "EmpleadoID";
  const PIV_SRV = pivotInfo.find(c => /servicio.*id/i.test(c.name))?.name || "ServicioID";

  const rows = db.prepare(`
    SELECT s.${SRV_ID} AS id, s.${SRV_NAME} AS name
    FROM supervisor_services a
    JOIN Servicios s
      ON CAST(s.${SRV_ID} AS TEXT) = CAST(a.${PIV_SRV} AS TEXT)
    WHERE CAST(a.${PIV_EMP} AS TEXT) = CAST(? AS TEXT)
    ORDER BY ${SRV_NAME} COLLATE NOCASE
  `).all(String(empleadoId));

  return rows;
}
router.get("/services", requireAuth, (req, res) => {
  try {
    const empleadoId = getLoggedEmployeeId(req);
    if (!empleadoId) return res.status(401).json({ error: "No autenticado" });
    const svcs = listAssignedServicesFor(empleadoId);
    return res.json(svcs);
  } catch (e) {
    console.error("[/supervisor/services] error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
});

router.get("/me/services", requireAuth, (req, res) => {
  try {
    const empleadoId = getLoggedEmployeeId(req);
    if (!empleadoId) return res.status(401).json({ error: "No autenticado" });
    const svcs = listAssignedServicesFor(empleadoId);
    return res.json(svcs);
  } catch (e) {
    console.error("[/me/services] error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
});

router.get("/services/assigned", requireAuth, (req, res) => {
  try {
    const empleadoId = getLoggedEmployeeId(req);
    if (!empleadoId) return res.status(401).json({ error: "No autenticado" });
    const svcs = listAssignedServicesFor(empleadoId);
    return res.json(svcs);
  } catch (e) {
    console.error("[/services/assigned] error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
});

router.get("/services/_selfcheck", requireAuth, (req, res) => {
  try {
    const empleadoId = getLoggedEmployeeId(req);
    const out = {
      auth_user: req.user || null,
      empleadoId: empleadoId ?? null,
      servicios_cols: tinfo("Servicios").map(c => c.name),
      pivot_cols: tinfo("supervisor_services").map(c => c.name),
      sample_assignments: db.prepare(`SELECT rowid AS rowid, * FROM supervisor_services LIMIT 5`).all(),
      resolved: empleadoId ? listAssignedServicesFor(empleadoId) : [],
    };
    return res.json(out);
  } catch (e) {
    console.error("[_selfcheck] error:", e);
    return res.status(500).json({ error: "selfcheck error", detail: e?.message });
  }
});

export default router;
