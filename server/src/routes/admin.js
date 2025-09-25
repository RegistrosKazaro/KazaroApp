// server/src/routes/admin.js
import { Router } from "express";
import { db, ensureSupervisorPivot } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const mustBeAdmin = [requireAuth, requireRole(["admin", "Admin"])];

// ---------------- helpers de introspección (columnas reales) ----------------
function ti(table) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all(); } catch { return []; }
}
function pick(info, candidates, fallback) {
  const names = info.map(c => c.name);
  for (const raw of candidates) {
    const idx = names.findIndex(n => n.toLowerCase() === String(raw).toLowerCase());
    if (idx >= 0) return names[idx];
  }
  return fallback;
}

// Empleados
const empInfo  = ti("Empleados");
const EMP_ID   = pick(empInfo, ["EmpleadosID","EmpleadoID","IdEmpleado","empleado_id","user_id","id","ID"], "EmpleadoID");
const EMP_NAME = pick(empInfo, ["username","usuario","user","Nombre","name","Email","email"], null);

// Servicios
const srvInfo  = ti("Servicios");
const SRV_ID   = pick(srvInfo, ["ServiciosID","ServicioID","IdServicio","servicio_id","id","ID"], "ServiciosID");
const SRV_NAME = pick(srvInfo, ["ServicioNombre","Nombre","Descripcion","Detalle","Titulo","name"], "ServicioNombre");

// utilidad para logs
function logErr(where, e, extra = {}) {
  console.error(`[admin] ${where} ERROR:`, e?.message || e);
  if (e?.stack) console.error(e.stack);
  if (Object.keys(extra).length) console.error("[ctx]", extra);
}

// ---------------- PEDIDOS (sin cambios funcionales) ----------------
router.get("/orders", mustBeAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT p.PedidoID   AS id,
           p.EmpleadoID AS empleadoId,
           p.Rol        AS rol,
           p.Nota       AS nota,
           p.Total      AS total,
           p.Fecha      AS fecha,
           p.ServicioID AS servicioId
    FROM Pedidos p
    ORDER BY p.PedidoID DESC
    LIMIT 500
  `).all();
  res.json(rows);
});

router.delete("/orders/:id", mustBeAdmin, (req, res) => {
  const id = Number(req.params.id);
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM PedidoItems WHERE PedidoID = ?`).run(id);
    const { changes } = db.prepare(`DELETE FROM Pedidos WHERE PedidoID = ?`).run(id);
    return changes;
  });
  res.json({ ok: true, deleted: tx() > 0 });
});

router.put("/orders/:id/price", mustBeAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { newPrice } = req.body || {};
  if (newPrice == null || Number.isNaN(Number(newPrice))) {
    return res.status(400).json({ error: "newPrice requerido (número)" });
  }
  const { changes } = db.prepare(`UPDATE Pedidos SET Total = ? WHERE PedidoID = ?`)
    .run(Number(newPrice), id);
  res.json({ ok: true, changes });
});

router.put("/order-items/:itemId", mustBeAdmin, (req, res) => {
  const itemId = Number(req.params.itemId);
  const { precio, cantidad } = req.body || {};
  if (precio == null && cantidad == null) {
    return res.status(400).json({ error: "precio o cantidad requeridos" });
  }

  const item = db.prepare(`
    SELECT PedidoID, Cantidad, Precio
    FROM PedidoItems
    WHERE PedidoItemID = ?
  `).get(itemId);
  if (!item) return res.status(404).json({ error: "Item no encontrado" });

  const newCantidad = cantidad != null ? Number(cantidad) : Number(item.Cantidad);
  const newPrecio   = precio   != null ? Number(precio)   : Number(item.Precio);
  const newSubtotal = newCantidad * newPrecio;

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE PedidoItems
      SET Precio = ?, Cantidad = ?, Subtotal = ?
      WHERE PedidoItemID = ?
    `).run(newPrecio, newCantidad, newSubtotal, itemId);

    const totalRow = db.prepare(`
      SELECT COALESCE(SUM(Subtotal), 0) AS total
      FROM PedidoItems
      WHERE PedidoID = ?
    `).get(item.PedidoID);

    db.prepare(`UPDATE Pedidos SET Total = ? WHERE PedidoID = ?`).run(totalRow.total, item.PedidoID);
    return { pedidoId: item.PedidoID, total: totalRow.total };
  });

  res.json({ ok: true, ...tx() });
});

router.post("/orders", mustBeAdmin, (req, res) => {
  const { empleadoId, rol = "administrativo", nota = "", servicioId = null, items = [] } = req.body || {};
  if (!empleadoId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "empleadoId y items[] requeridos" });
  }

  const tx = db.transaction(() => {
    const pedidoId = db.prepare(`
      INSERT INTO Pedidos (EmpleadoID, Rol, Nota, ServicioID, Total, Fecha)
      VALUES (?, ?, ?, ?, 0, datetime('now'))
    `).run(empleadoId, String(rol || ""), String(nota || ""), servicioId).lastInsertRowid;

    let total = 0;
    const insItem = db.prepare(`
      INSERT INTO PedidoItems (PedidoID, ProductoID, Nombre, Precio, Cantidad, Subtotal, Codigo)
      VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, ''))
    `);

    for (const it of items) {
      const cantidad = Number(it.cantidad ?? it.qty ?? 1);
      const precio   = Number(it.precio   ?? it.price ?? 0);
      const subtotal = cantidad * precio;
      total += subtotal;
      insItem.run(
        pedidoId,
        it.productoId ?? it.productId ?? null,
        String(it.nombre || ""),
        precio,
        cantidad,
        subtotal,
        it.codigo ?? it.code ?? null
      );
    }

    db.prepare(`UPDATE Pedidos SET Total = ? WHERE PedidoID = ?`).run(total, pedidoId);
    return pedidoId;
  });

  res.json({ ok: true, pedidoId: tx() });
});

// ---------------------- ASIGNACIONES (pivote) ----------------------

// Lista (opcional ?EmpleadoID=)
router.get("/assignments", mustBeAdmin, (req, res) => {
  try {
    ensureSupervisorPivot();
    const EmpleadoID = req.query.EmpleadoID ? Number(req.query.EmpleadoID) : null;

    const base = `
      SELECT
        COALESCE(a.id, a.rowid) AS id,
        a.EmpleadoID,
        a.ServicioID,
        ${EMP_NAME ? `e.${EMP_NAME}` : `CAST(e.${EMP_ID} AS TEXT)`} AS supervisor_username,
        ${SRV_NAME ? `s.${SRV_NAME}` : `CAST(s.${SRV_ID} AS TEXT)`} AS service_name
      FROM supervisor_services a
      LEFT JOIN Empleados e ON e.${EMP_ID} = a.EmpleadoID
      LEFT JOIN Servicios s ON s.${SRV_ID} = a.ServicioID
    `;

    const rows = EmpleadoID
      ? db.prepare(base + ` WHERE a.EmpleadoID = ? ORDER BY service_name COLLATE NOCASE`).all(EmpleadoID)
      : db.prepare(base + ` ORDER BY supervisor_username COLLATE NOCASE, service_name COLLATE NOCASE`).all();

    res.json(rows);
  } catch (e) {
    logErr("GET /admin/assignments", e);
    res.status(500).json({ error: "Error al listar asignaciones", detail: e?.message });
  }
});

// Crear asignación (evita duplicados)
router.post("/assignments", mustBeAdmin, (req, res) => {
  try {
    ensureSupervisorPivot();
    const { EmpleadoID, ServicioID } = req.body || {};
    const emp = Number(EmpleadoID), srv = Number(ServicioID);

    if (!Number.isFinite(emp) || !Number.isFinite(srv)) {
      return res.status(400).json({ error: "EmpleadoID y ServicioID deben ser numéricos" });
    }

    const hitEmp = db.prepare(`SELECT 1 FROM Empleados WHERE ${EMP_ID} = ? LIMIT 1`).get(emp);
    if (!hitEmp) return res.status(400).json({ error: `EmpleadoID ${emp} inexistente` });

    const hitSrv = db.prepare(`SELECT 1 FROM Servicios WHERE ${SRV_ID} = ? LIMIT 1`).get(srv);
    if (!hitSrv) return res.status(400).json({ error: `ServicioID ${srv} inexistente` });

    const out = db.prepare(`
      INSERT OR IGNORE INTO supervisor_services (EmpleadoID, ServicioID)
      VALUES (?, ?)
    `).run(emp, srv);

    res.json({ ok: true, inserted: out.changes > 0 });
  } catch (e) {
    logErr("POST /admin/assignments", e, { body: req.body });
    res.status(500).json({ error: "Error al asignar", detail: e?.message });
  }
});

// Eliminar asignación por id/rowid
router.delete("/assignments/:id", mustBeAdmin, (req, res) => {
  try {
    ensureSupervisorPivot();
    const pid = Number(req.params.id);
    const out = db.prepare(`DELETE FROM supervisor_services WHERE id = ? OR rowid = ?`).run(pid, pid);
    res.json({ ok: true, deleted: out.changes > 0 });
  } catch (e) {
    logErr("DELETE /admin/assignments/:id", e, { id: req.params.id });
    res.status(500).json({ error: "Error al borrar", detail: e?.message });
  }
});

// Reasignar (exclusivo)
router.patch("/assignments/reassign", mustBeAdmin, (req, res) => {
  try {
    ensureSupervisorPivot();
    const { ServicioID, toEmpleadoID } = req.body || {};
    const srv = Number(ServicioID), toEmp = Number(toEmpleadoID);
    if (!Number.isFinite(srv) || !Number.isFinite(toEmp)) {
      return res.status(400).json({ error: "ServicioID y toEmpleadoID deben ser numéricos" });
    }

    const hitEmp = db.prepare(`SELECT 1 FROM Empleados WHERE ${EMP_ID} = ? LIMIT 1`).get(toEmp);
    if (!hitEmp) return res.status(400).json({ error: `toEmpleadoID ${toEmp} inexistente` });

    const hitSrv = db.prepare(`SELECT 1 FROM Servicios WHERE ${SRV_ID} = ? LIMIT 1`).get(srv);
    if (!hitSrv) return res.status(400).json({ error: `ServicioID ${srv} inexistente` });

    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM supervisor_services WHERE ServicioID = ?`).run(srv);
      const ins = db.prepare(`INSERT INTO supervisor_services (EmpleadoID, ServicioID) VALUES (?, ?)`).run(toEmp, srv);
      return { newId: ins.lastInsertRowid };
    });

    res.json({ ok: true, ...tx() });
  } catch (e) {
    logErr("PATCH /admin/assignments/reassign", e, { body: req.body });
    res.status(500).json({ error: "Error al reasignar", detail: e?.message });
  }
});

// ---------------- combos ----------------
router.get("/supervisors", mustBeAdmin, (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT e.${EMP_ID} AS id,
             ${EMP_NAME ? `e.${EMP_NAME}` : `CAST(e.${EMP_ID} AS TEXT)`} AS username,
             e.Email
      FROM Empleados e
      WHERE EXISTS (
        SELECT 1
        FROM Roles_Empleados re
        JOIN Roles r ON r.RolID = re.RolID
        WHERE re.EmpleadoID = e.${EMP_ID}
          AND lower(r.Nombre) = 'supervisor'
      )
      ORDER BY username COLLATE NOCASE
    `).all();
    res.json(rows);
  } catch (e) {
    logErr("GET /admin/supervisors", e);
    res.status(500).json({ error: "Error al listar supervisores", detail: e?.message });
  }
});

router.get("/services", mustBeAdmin, (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT ${SRV_ID} AS id, ${SRV_NAME} AS name
      FROM Servicios
      ORDER BY name COLLATE NOCASE
    `).all();
    res.json(rows);
  } catch (e) {
    logErr("GET /admin/services", e);
    res.status(500).json({ error: "Error al listar servicios", detail: e?.message });
  }
});

// ---------------- autodiagnóstico: columnas y join de prueba ----------------
router.get("/assignments/_selfcheck", mustBeAdmin, (_req, res) => {
  try {
    ensureSupervisorPivot();
    const empColNames = ti("Empleados").map(c => c.name);
    const srvColNames = ti("Servicios").map(c => c.name);
    const pivInfo = ti("supervisor_services").map(c => c.name);

    // prueba de join
    let joinOK = true, joinErr = null, sample = [];
    try {
      sample = db.prepare(`
        SELECT a.EmpleadoID, a.ServicioID
        FROM supervisor_services a
        LEFT JOIN Empleados e ON e.${EMP_ID} = a.EmpleadoID
        LEFT JOIN Servicios s ON s.${SRV_ID} = a.ServicioID
        LIMIT 5
      `).all();
    } catch (e) {
      joinOK = false; joinErr = e?.message || String(e);
    }

    res.json({
      EMP_ID, EMP_NAME, SRV_ID, SRV_NAME,
      empleados_cols: empColNames,
      servicios_cols: srvColNames,
      pivot_cols: pivInfo,
      joinOK, joinErr, sample
    });
  } catch (e) {
    logErr("GET /admin/assignments/_selfcheck", e);
    res.status(500).json({ error: "selfcheck error", detail: e?.message });
  }
});

export default router;
