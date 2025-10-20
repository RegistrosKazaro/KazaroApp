// server/src/routes/serviceProducts.js
import { Router } from "express";
import { db } from "../db.js";

const router = Router();

const uniq = (arr) =>
  Array.from(new Set((arr || []).map((x) => Number(x)).filter((n) => Number.isInteger(n))));
const ph = (n) => Array(n).fill("?").join(",");

function getServicesAssignInfo(ids) {
  if (!ids.length) return [];
  const q = `
    SELECT s.id,
           COALESCE(s.nombre, s.name, 'Servicio '||s.id) AS name,
           s.supervisorId AS assignedTo,
           COALESCE(e.apellido||' '||e.nombre, e.username, e.email, '') AS supervisorName
    FROM Services s
    LEFT JOIN Empleados e ON e.id = s.supervisorId
    WHERE s.id IN (${ph(ids.length)})
  `;
  return db.prepare(q).all(...ids);
}

function searchServicesRaw(q) {
  const term = (q || "").trim();
  const like = `%${term.replace(/\s+/g, "%")}%`;
  const sql = `
    SELECT s.id,
           COALESCE(s.nombre, s.name, 'Servicio '||s.id) AS name,
           s.supervisorId AS assignedTo,
           COALESCE(e.apellido||' '||e.nombre, e.username, e.email, '') AS supervisorName
    FROM Services s
    LEFT JOIN Empleados e ON e.id = s.supervisorId
    WHERE ? = '' OR
          LOWER(COALESCE(s.nombre, s.name)) LIKE LOWER(?)
    ORDER BY name ASC
    LIMIT 300
  `;
  return db.prepare(sql).all(term, like);
}

router.get(["/list", "/search"], (req, res) => {
  const q = String(req.query.q ?? "");
  const items = searchServicesRaw(q).map((s) => ({
    id: s.id,
    name: s.name,
    assignedTo: s.assignedTo,           
    supervisorName: s.supervisorName,
  }));
  res.json({ ok: true, items });
});


router.post("/assign", (req, res) => {
  const supervisorId = Number(req.body?.supervisorId);
  const serviceIds = uniq(req.body?.serviceIds);
  if (!Number.isInteger(supervisorId) || !serviceIds.length) {
    return res.status(400).json({ error: "Parámetros inválidos (supervisorId, serviceIds)" });
  }

  const info = getServicesAssignInfo(serviceIds);
  const conflicts = info.filter((r) => r.assignedTo && r.assignedTo !== supervisorId);

  if (conflicts.length) {
    return res.status(409).json({
      error: "Uno o más servicios ya están asignados a otro supervisor.",
      conflicts, 
    });
  }

  const upd = db.prepare(
    `UPDATE Services
       SET supervisorId = ?
     WHERE id = ?
       AND (supervisorId IS NULL OR supervisorId = ?)`
  );

  const tx = db.transaction((ids) => {
    let changes = 0;
    for (const id of ids) changes += upd.run(supervisorId, id, supervisorId).changes;
    return changes;
  });

  const updated = tx(serviceIds);
  res.json({ ok: true, updated, total: serviceIds.length, skipped: serviceIds.length - updated });
});

router.post("/reassign-bulk", (req, res) => {
  const fromId = Number(req.body?.fromSupervisorId);
  const toId = Number(req.body?.toSupervisorId);
  const serviceIds = uniq(req.body?.serviceIds);

  if (!Number.isInteger(fromId) || !Number.isInteger(toId) || !serviceIds.length) {
    return res.status(400).json({ error: "Parámetros inválidos (fromSupervisorId, toSupervisorId, serviceIds)" });
  }
  if (fromId === toId) {
    return res.status(400).json({ error: "El supervisor de origen y destino no pueden ser el mismo." });
  }

  const info = getServicesAssignInfo(serviceIds);
  const conflicts = info.filter((r) => r.assignedTo != null && r.assignedTo !== fromId);

  if (conflicts.length) {
    return res.status(409).json({
      error: "Hay servicios asignados a otro supervisor. No se realizó la reasignación.",
      conflicts,
    });
  }

  const upd = db.prepare(
    `UPDATE Services
       SET supervisorId = ?
     WHERE id = ?
       AND (supervisorId IS NULL OR supervisorId = ?)`
  );

  const tx = db.transaction((ids) => {
    let changes = 0;
    for (const id of ids) changes += upd.run(toId, id, fromId).changes;
    return changes;
  });

  const updated = tx(serviceIds);
  res.json({ ok: true, updated, total: serviceIds.length, skipped: serviceIds.length - updated });
});

export default router;
