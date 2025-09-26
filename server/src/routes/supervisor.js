// server/src/routes/supervisor.js
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { db, tinfo } from "../db.js";

const router = Router();

/** Obtiene el ID del empleado logueado de forma robusta (distintos middlewares) */
function getLoggedEmployeeId(req) {
  // soportamos varias formas que he visto en tu código
  return (
    req.user?.empleadoId ??
    req.user?.EmpleadosID ??
    req.user?.EmpleadoID ??
    req.user?.id ??
    req.user?.userId ??
    null
  );
}

/** Columnas reales de Servicios (de tu BD) */
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

/** Lee los servicios asignados al empleado desde la pivote real (supervisor_services) */
function listAssignedServicesFor(empleadoId) {
  const { SRV_ID, SRV_NAME } = getServiceCols();

  // Verificamos pivote; en tu BD REAL se llama supervisor_services (EmpleadoID, ServicioID) SIN id
  const pivotInfo = tinfo("supervisor_services");
  if (!pivotInfo.length) return [];

  const PIV_EMP = pivotInfo.find(c => /empleado.*id/i.test(c.name))?.name || "EmpleadoID";
  const PIV_SRV = pivotInfo.find(c => /servicio.*id/i.test(c.name))?.name || "ServicioID";

  // Cast para evitar problemas Integer vs Text
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

/** ----------- Rutas compatibles (elige la que ya usaba tu front) ----------- **/

// 1) Ruta moderna
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

// 2) Alias muy común en implementaciones previas
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

// 3) Otro alias que he visto (por si tu front usaba esto)
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

/** ----------- Self-check para depurar rápidamente ----------- **/
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
