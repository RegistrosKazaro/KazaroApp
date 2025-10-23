// server/src/routes/services.js
import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { db, tinfo, getBudgetByServiceId } from "../db.js";

const router = Router();

/** Descubre columnas PK/Nombre de Servicios de forma robusta */
function getServiceCols() {
  const info = tinfo("Servicios");
  if (!info.length) throw new Error("No existe tabla Servicios");
  const pk = info.find((c) => c.pk === 1)?.name || "ServiciosID";
  const name =
    info.find((c) => /servicio.*nombre|^nombre$|^descripcion$/i.test(c.name))?.name ||
    info.find((c) => /TEXT|CHAR/i.test(String(c.type)))?.name ||
    pk;
  return { SRV_ID: pk, SRV_NAME: name };
}

/** Lista servicios asignados a un empleado usando el pivote supervisor_services */
function listAssignedServicesFor(empleadoId) {
  const { SRV_ID, SRV_NAME } = getServiceCols();

  const pivotInfo = tinfo("supervisor_services");
  if (!pivotInfo.length) return [];

  const PIV_EMP = pivotInfo.find((c) => /empleado.*id/i.test(c.name))?.name || "EmpleadoID";
  const PIV_SRV = pivotInfo.find((c) => /servicio.*id/i.test(c.name))?.name || "ServicioID";

  const rows = db
    .prepare(
      `
    SELECT s.${SRV_ID} AS id, s.${SRV_NAME} AS name
    FROM supervisor_services a
    JOIN Servicios s
      ON CAST(s.${SRV_ID} AS TEXT) = CAST(a.${PIV_SRV} AS TEXT)
    WHERE CAST(a.${PIV_EMP} AS TEXT) = CAST(? AS TEXT)
    ORDER BY ${SRV_NAME} COLLATE NOCASE
  `
    )
    .all(String(empleadoId));

  return rows;
}

/** Opcional: listado de servicios del supervisor (si tu cliente lo usa bajo /services) */
router.get("/", [requireAuth, requireRole("supervisor")], (req, res) => {
  try {
    const userId = req.user?.id ?? null;
    if (!userId) return res.status(401).json({ error: "No autenticado" });
    const rows = listAssignedServicesFor(userId);
    return res.json(rows || []);
  } catch (err) {
    console.error("[services] / error:", err);
    return res.status(500).json({ error: "Error interno" });
  }
});

/** Presupuesto por servicio (usado por el cliente) */
router.get("/:id/budget", requireAuth, (req, res) => {
  try {
    const id = req.params.id;
    const budget = getBudgetByServiceId(id);
    return res.json({ servicioId: id, budget });
  } catch (e) {
    console.error("[services/:id/budget] error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
});

export default router;
