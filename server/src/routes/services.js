// server/src/routes/services.js
import { Router } from "express";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "../utils/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Podés setear DB_PATH en .env; si no, toma Kazaro.db en la raíz del repo
const DB_PATH = env.DB_PATH || path.resolve(__dirname, "../../Kazaro.db");
const db = new Database(DB_PATH, { fileMustExist: true });

const router = Router();

// Si ya tenés un middleware de auth que setea req.user, lo usás antes en index.js (app.use(cookies))
function requireAuth(req, res, next) {
  if (req.user && (req.user.id || req.user.username)) return next();
  return res.status(401).json({ error: "No autenticado" });
}

function resolveEmpleadoId(user) {
  const n = Number(user?.id);
  if (Number.isFinite(n)) return n; // si el token ya guarda EmpleadosID
  if (user?.username) {
    const row = db.prepare("SELECT EmpleadosID FROM Empleados WHERE username = ?").get(user.username);
    return row?.EmpleadosID;
  }
  return undefined;
}

// GET /services/my  (autenticado)
router.get("/my", requireAuth, (req, res) => {
  try {
    const empleadoId = resolveEmpleadoId(req.user);
    if (!empleadoId) return res.status(400).json({ error: "Empleado no encontrado" });

    const rows = db.prepare(`
      SELECT s.ServiciosID AS id, s.ServicioNombre AS name
      FROM supervisor_services ss
      JOIN Servicios s ON s.ServiciosID = ss.ServicioID
      WHERE ss.EmpleadoID = ?
      ORDER BY s.ServicioNombre
    `).all(empleadoId);

    return res.json(rows);
  } catch (e) {
    console.error("[/services/my] error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
});

// Debug: GET /services/dev/services-by-id?userId=44
router.get("/dev/services-by-id", (req, res) => {
  try {
    const empleadoId = Number(req.query.userId);
    if (!Number.isFinite(empleadoId)) return res.status(400).json({ error: "userId inválido" });

    const rows = db.prepare(`
      SELECT s.ServiciosID AS id, s.ServicioNombre AS name
      FROM supervisor_services ss
      JOIN Servicios s ON s.ServiciosID = ss.ServicioID
      WHERE ss.EmpleadoID = ?
      ORDER BY s.ServicioNombre
    `).all(empleadoId);

    return res.json({ rows });
  } catch (e) {
    console.error("[/dev/services-by-id] error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
});

// Debug: GET /services/dev/services-by-username?username=felipe.courel
router.get("/dev/services-by-username", (req, res) => {
  try {
    const username = String(req.query.username || "");
    if (!username) return res.status(400).json({ error: "username requerido" });

    const emp = db.prepare("SELECT EmpleadosID FROM Empleados WHERE username = ?").get(username);
    if (!emp?.EmpleadosID) return res.status(404).json({ error: "Empleado no encontrado" });

    const rows = db.prepare(`
      SELECT s.ServiciosID AS id, s.ServicioNombre AS name
      FROM supervisor_services ss
      JOIN Servicios s ON s.ServiciosID = ss.ServicioID
      WHERE ss.EmpleadoID = ?
      ORDER BY s.ServicioNombre
    `).all(emp.EmpleadosID);

    return res.json({ rows });
  } catch (e) {
    console.error("[/dev/services-by-username] error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
});

export default router;
