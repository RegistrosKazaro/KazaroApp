// server/src/routes/admin.js
import { Router } from "express";
import {
  db,
  discoverCatalogSchema,
  adminListCategoriesForSelect,
  adminGetProductById,
  listServiceBudgets,
  setBudgetForService,
  ensureSupervisorPivotExclusive,
  assignServiceToSupervisorExclusive,
  reassignServiceToSupervisor,
  unassignService,
  getServiceNameById,
  ensureServiceProductsPivot,     // <— NUEVO
} from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { sendMail } from "../utils/mailer.js";

const router = Router();
const mustBeAdmin = [requireAuth, requireRole(["admin", "Admin"])];

function prodSchemaOrThrow() {
  const sch = discoverCatalogSchema();
  if (!sch?.ok) throw new Error(sch?.reason || "No hay esquema de productos");
  return sch;
}

/* =========================
   Productos (catálogo admin)
   ========================= */

router.get("/products/_schema", mustBeAdmin, (_req, res) => {
  try {
    const sch = prodSchemaOrThrow();
    res.json({
      ok: true,
      table: sch.tables.products,
      categoriesTable: sch.tables.categories || null,
      cols: sch.cols,
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || "No se pudo detectar el esquema" });
  }
});

router.get("/product-categories", mustBeAdmin, (_req, res) => {
  try { res.json(adminListCategoriesForSelect()); }
  catch { res.status(500).json({ error: "No se pudieron cargar las categorías" }); }
});

router.get("/products", mustBeAdmin, (req, res) => {
  try {
    const sch = prodSchemaOrThrow();
    const { products } = sch.tables;
    const { prodId, prodName, prodPrice, prodStock, prodCode } = sch.cols;

    const q = String(req.query.q ?? "").trim();
    const like = `%${q}%`;

    const where = q
      ? `WHERE ${prodName} LIKE @like
             ${prodCode ? `OR IFNULL(${prodCode},'') LIKE @like` : ""}
             OR CAST(${prodId} AS TEXT) LIKE @like`
      : "";

    const sql = `
      SELECT ${prodId} AS id,
             ${prodName} AS name
             ${prodCode  ? `, ${prodCode}  AS code`  : ""}
             ${prodPrice ? `, ${prodPrice} AS price` : ""}
             ${prodStock ? `, ${prodStock} AS stock` : ""}
      FROM ${products}
      ${where}
      ORDER BY ${prodName} COLLATE NOCASE
      LIMIT 500
    `;
    res.json(db.prepare(sql).all({ like }));
  } catch {
    res.status(500).json({ error: "Error al listar productos" });
  }
});

router.get("/products/:id", mustBeAdmin, (req, res) => {
  const id = req.params.id;
  try {
    const row = adminGetProductById(id);
    if (!row) return res.status(404).json({ error: "Producto no encontrado" });
    res.json(row);
  } catch {
    res.status(500).json({ error: "Error al obtener el producto" });
  }
});

router.post("/products", mustBeAdmin, (req, res) => {
  try {
    const sch = prodSchemaOrThrow();
    const { products } = sch.tables;
    const { prodName, prodPrice, prodStock, prodCode, prodCat, prodCatName } = sch.cols;

    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "name es requerido" });

    const cols = [prodName];
    const vals = [name];

    if (prodPrice && req.body?.price !== undefined) {
      const v = (req.body.price === "" || req.body.price === null) ? null : Number(req.body.price);
      cols.push(prodPrice); vals.push(v);
    }
    if (prodStock && req.body?.stock !== undefined) {
      const v = (req.body.stock === "" || req.body.stock === null) ? null : Number(req.body.stock);
      cols.push(prodStock); vals.push(v);
    }
    if (prodCode && req.body?.code !== undefined) {
      const v = (req.body.code === "" || req.body.code === null) ? null : String(req.body.code);
      cols.push(prodCode); vals.push(v);
    }

    if (prodCat) {
      const catId = (req.body?.catId !== undefined) ? req.body.catId : req.body?.categoryId;
      if (catId !== undefined) { cols.push(prodCat); vals.push((catId === "" || catId === null) ? null : catId); }
    } else if (prodCatName && req.body?.categoryName !== undefined) {
      cols.push(prodCatName); vals.push(String(req.body.categoryName ?? "").trim() || null);
    }

    const placeholders = cols.map(() => "?").join(",");
    const info = db.prepare(`INSERT INTO ${products} (${cols.join(",")}) VALUES (${placeholders})`).run(vals);
    res.status(201).json({ ok: true, id: info.lastInsertRowid });
  } catch {
    res.status(500).json({ error: "No se pudo crear el producto" });
  }
});

router.put("/products/:id", mustBeAdmin, (req, res) => {
  try {
    const sch = prodSchemaOrThrow();
    const { products } = sch.tables;
    const { prodId, prodName, prodPrice, prodStock, prodCode, prodCat, prodCatName } = sch.cols;

    const id = req.params.id;

    const sets = [];
    const vals = [];

    if (prodName && req.body?.name !== undefined) {
      sets.push(`${prodName} = ?`);
      vals.push(String(req.body.name ?? ""));
    }

    if (prodPrice && req.body?.price !== undefined) {
      let v = req.body.price;
      if (v === "") v = 0;
      v = (v === null) ? null : Number(v);
      sets.push(`${prodPrice} = ?`);
      vals.push(v);
    }

    if (prodStock && req.body?.stock !== undefined) {
      let v = req.body.stock;
      if (v === "") v = 0;
      v = (v === null) ? null : Number(v);
      sets.push(`${prodStock} = ?`);
      vals.push(v);
    }

    if (prodCode && req.body?.code !== undefined) {
      const v = (req.body.code === null) ? null : String(req.body.code ?? "");
      sets.push(`${prodCode} = ?`);
      vals.push(v);
    }

    if (prodCat && (req.body?.catId !== undefined || req.body?.categoryId !== undefined)) {
      const v = (req.body.catId !== undefined) ? req.body.catId : req.body.categoryId;
      sets.push(`${prodCat} = ?`);
      vals.push((v === "" || v === null) ? null : v);
    } else if (!prodCat && prodCatName && req.body?.categoryName !== undefined) {
      sets.push(`${prodCatName} = ?`);
      vals.push(String(req.body.categoryName ?? "").trim() || null);
    }

    if (!sets.length) return res.status(400).json({ error: "Nada para actualizar" });

    const info = db.prepare(
      `UPDATE ${products} SET ${sets.join(", ")} WHERE ${prodId} = ? OR rowid = ?`
    ).run(...vals, id, id);

    if (!info.changes) return res.status(404).json({ error: "Producto no encontrado" });

    const updated = db.prepare(`
      SELECT ${prodId} AS id,
             ${prodName} AS name
             ${prodCode  ? `, ${prodCode}  AS code`  : ""}
             ${prodPrice ? `, ${prodPrice} AS price` : ""}
             ${prodStock ? `, ${prodStock} AS stock` : ""}
      FROM ${products}
      WHERE ${prodId} = ? OR rowid = ?
      LIMIT 1
    `).get(id, id);

    res.json({ ok: true, product: updated });
  } catch (e) {
    res.status(500).json({ error: "No se pudo actualizar" });
  }
});

router.delete("/products/:id", mustBeAdmin, (req, res) => {
  try {
    const sch = prodSchemaOrThrow();
    const { products } = sch.tables;
    const { prodId } = sch.cols;
    const id = req.params.id;

    const info = db.prepare(
      `DELETE FROM ${products} WHERE ${prodId} = ? OR rowid = ?`
    ).run(id, id);

    if (!info.changes) return res.status(404).json({ error: "Producto no encontrado" });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "No se pudo eliminar" });
  }
});

router.patch("/products/:id/stock", mustBeAdmin, (req, res) => {
  try {
    const sch = prodSchemaOrThrow();
    const { products } = sch.tables;
    const { prodId, prodStock } = sch.cols;

    if (!prodStock) return res.status(400).json({ error: "La tabla de productos no tiene columna de stock" });

    const id = req.params.id;
    const delta = Number(req.body?.delta ?? NaN);
    if (!Number.isFinite(delta)) return res.status(400).json({ error: "delta inválido" });

    const r = db.prepare(
      `UPDATE ${products} SET ${prodStock} = COALESCE(${prodStock},0) + ? WHERE ${prodId} = ? OR rowid = ?`
    ).run(delta, id, id);

    if (!r.changes) return res.status(404).json({ error: "Producto no encontrado" });

    const row = db.prepare(
      `SELECT ${prodId} AS id, ${prodStock} AS stock FROM ${products} WHERE ${prodId} = ? OR rowid = ? LIMIT 1`
    ).get(id, id);

    res.json({ ok: true, product: row });
  } catch {
    res.status(500).json({ error: "No se pudo actualizar el stock" });
  }
});

/* =========================
   Pedidos (admin)
   ========================= */

router.get("/orders", mustBeAdmin, (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT PedidoID AS id, EmpleadoID AS empleadoId, Rol AS rol, Total AS total, Fecha AS fecha
      FROM Pedidos
      ORDER BY PedidoID DESC
      LIMIT 200
    `).all();
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Error al listar pedidos" });
  }
});

router.delete("/orders/:id", mustBeAdmin, (req, res) => {
  try {
    const r = db.prepare(`DELETE FROM Pedidos WHERE PedidoID = ?`).run(Number(req.params.id));
    if (!r.changes) return res.status(404).json({ error: "Pedido no encontrado" });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error al eliminar pedido" });
  }
});

router.put("/orders/:id/price", mustBeAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    const newPrice = Number(req.body?.newPrice ?? NaN);
    if (!Number.isFinite(newPrice)) return res.status(400).json({ error: "newPrice inválido" });
    const r = db.prepare(`UPDATE Pedidos SET Total = ? WHERE PedidoID = ?`).run(newPrice, id);
    if (!r.changes) return res.status(404).json({ error: "Pedido no encontrado" });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error al actualizar total" });
  }
});

/* =========================
   Supervisores y servicios
   ========================= */

const EMP_ID = "EmpleadosID";
const EMP_NAME_EXPR = `
  TRIM(COALESCE(e.Nombre,'') || ' ' || COALESCE(e.Apellido,'')) ||
  CASE WHEN IFNULL(TRIM(e.username),'') <> '' THEN ' ('||e.username||')' ELSE '' END
`;
const SRV_ID = "ServiciosID";
const SRV_NAME = "ServicioNombre";

router.get("/services", mustBeAdmin, (req, res) => {
  try {
    ensureSupervisorPivotExclusive(); 
    const q = String(req.query.q ?? "").trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit ?? "25", 10) || 25, 1), 100);
    if (!q) return res.json([]);
    const like = `%${q}%`;

    const rows = db.prepare(`
      SELECT 
        s.${SRV_ID} AS id, 
        s.${SRV_NAME} AS name,
        EXISTS (
          SELECT 1 FROM supervisor_services a
          WHERE CAST(a.ServicioID AS TEXT) = CAST(s.${SRV_ID} AS TEXT)
        ) AS is_assigned,
        (
          SELECT a.EmpleadoID
          FROM supervisor_services a
          WHERE CAST(a.ServicioID AS TEXT) = CAST(s.${SRV_ID} AS TEXT)
          LIMIT 1
        ) AS assigned_to_id,
        (
          SELECT ${EMP_NAME_EXPR}
          FROM supervisor_services a
          JOIN Empleados e ON e.${EMP_ID} = a.EmpleadoID
          WHERE CAST(a.ServicioID AS TEXT) = CAST(s.${SRV_ID} AS TEXT)
          LIMIT 1
        ) AS assigned_to
      FROM Servicios s
      WHERE (s.${SRV_NAME} LIKE @like OR CAST(s.${SRV_ID} AS TEXT) LIKE @like)
      ORDER BY s.${SRV_NAME} COLLATE NOCASE
      LIMIT ${limit}
    `).all({ like });

    const normalized = rows.map(r => ({
      ...r,
      is_assigned: Number(r.is_assigned) === 1 ? 1 : 0
    }));

    res.json(normalized);
  } catch (e) {
    console.error("GET /admin/services error:", e);
    res.status(500).json({ error: "Error al listar servicios" });
  }
});

router.get("/supervisors", mustBeAdmin, (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT e.${EMP_ID} AS id, ${EMP_NAME_EXPR} AS username
      FROM Empleados e
      WHERE EXISTS (
        SELECT 1
        FROM Roles_Empleados re
        JOIN Roles r ON r.RolID = re.RolID
        WHERE re.EmpleadoID = e.${EMP_ID} AND lower(r.Nombre) = 'supervisor'
      )
      ORDER BY username COLLATE NOCASE
    `).all();
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Error al listar supervisores" });
  }
});

router.get("/assignments", mustBeAdmin, (req, res) => {
  try {
    ensureSupervisorPivotExclusive(); 
    const EmpleadoID = req.query.EmpleadoID ? Number(req.query.EmpleadoID) : null;
    const base = `
      SELECT a.rowid AS id, a.EmpleadoID, a.ServicioID,
             (${EMP_NAME_EXPR}) AS supervisor_username,
             s.${SRV_NAME} AS service_name
      FROM supervisor_services a
      LEFT JOIN Empleados e ON e.${EMP_ID} = a.EmpleadoID
      LEFT JOIN Servicios s ON s.${SRV_ID} = a.ServicioID
    `;
    const rows = EmpleadoID
      ? db.prepare(base + ` WHERE a.EmpleadoID = ? ORDER BY s.${SRV_NAME} COLLATE NOCASE`).all(EmpleadoID)
      : db.prepare(base + ` ORDER BY supervisor_username COLLATE NOCASE, s.${SRV_NAME} COLLATE NOCASE`).all();
    res.json(rows);
  } catch (e) {
    console.error("GET /admin/assignments error:", e);
    res.status(500).json({ error: "Error al listar asignaciones" });
  }
});

router.post("/assignments", mustBeAdmin, (req, res) => {
  try {
    const EmpleadoID = Number(req.body?.EmpleadoID);
    const ServicioID = Number(req.body?.ServicioID);
    if (!Number.isFinite(EmpleadoID) || !Number.isFinite(ServicioID)) {
      return res.status(400).json({ error: "EmpleadoID y ServicioID son requeridos" });
    }

    assignServiceToSupervisorExclusive(EmpleadoID, ServicioID);

    const assigned = db.prepare(`
      SELECT a.rowid AS id, a.EmpleadoID, a.ServicioID,
             (${EMP_NAME_EXPR}) AS supervisor_username,
             s.${SRV_NAME}      AS service_name
      FROM supervisor_services a
      LEFT JOIN Empleados e ON e.${EMP_ID} = a.EmpleadoID
      LEFT JOIN Servicios s ON s.${SRV_ID} = a.ServicioID
      WHERE CAST(a.ServicioID AS TEXT) = CAST(? AS TEXT)
      LIMIT 1
    `).get(ServicioID);

    return res.status(201).json({
      ok: true,
      assignment: assigned || { EmpleadoID, ServicioID }
    });
  } catch (e) {
    if (e?.status === 409 || e?.code === "SERVICE_TAKEN") {
      return res.status(409).json({ error: e.message });
    }
    const isUnique = /UNIQUE constraint failed: supervisor_services\.ServicioID/i.test(String(e?.message || ""));
    if (isUnique) {
      return res.status(409).json({ error: "El servicio ya está asignado a otro supervisor" });
    }
    console.error("POST /admin/assignments error:", e);
    res.status(500).json({ error: "Error al crear asignación" });
  }
});

router.post("/assignments/reassign", mustBeAdmin, (req, res) => {
  try {
    const EmpleadoID = Number(req.body?.EmpleadoID);
    const ServicioID = Number(req.body?.ServicioID);
    if (!Number.isFinite(EmpleadoID) || !Number.isFinite(ServicioID)) {
      return res.status(400).json({ error: "EmpleadoID y ServicioID son requeridos" });
    }
    reassignServiceToSupervisor(EmpleadoID, ServicioID);

    const assigned = db.prepare(`
      SELECT a.rowid AS id, a.EmpleadoID, a.ServicioID,
             (${EMP_NAME_EXPR}) AS supervisor_username,
             s.${SRV_NAME}      AS service_name
      FROM supervisor_services a
      LEFT JOIN Empleados e ON e.${EMP_ID} = a.EmpleadoID
      LEFT JOIN Servicios s ON s.${SRV_ID} = a.ServicioID
      WHERE CAST(a.ServicioID AS TEXT) = CAST(? AS TEXT)
      LIMIT 1
    `).get(ServicioID);

    res.json({ ok: true, assignment: assigned || { EmpleadoID, ServicioID } });
  } catch (e) {
    console.error("POST /admin/assignments/reassign error:", e);
    res.status(500).json({ error: e?.message || "No se pudo reasignar" });
  }
});

router.delete("/assignments/:id", mustBeAdmin, (req, res) => {
  try {
    const ok = unassignService({ id: Number(req.params.id) });
    if (!ok) return res.status(404).json({ error: "Asignación no encontrada" });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error al eliminar asignación" });
  }
});

/* =========================
   Presupuestos por servicio
   ========================= */

router.get("/service-budgets", mustBeAdmin, (_req, res) => {
  try { res.json(listServiceBudgets()); }
  catch (e) { res.status(500).json({ error: "Error al listar presupuestos" }); }
});

router.put("/service-budgets/:id", mustBeAdmin, (req, res) => {
  const id = req.params.id;
  const presupuesto = Number(req.body?.presupuesto ?? req.body?.budget ?? NaN);
  if (!Number.isFinite(presupuesto) || presupuesto < 0) return res.status(400).json({ error: "Presupuesto inválido" });
  try {
    const newVal = setBudgetForService(id, presupuesto);
    return res.json({ servicioId: id, presupuesto: newVal });
  } catch (e) {
    console.error("[admin] PUT /service-budgets/:id", e);
    return res.status(500).json({ error: "Error interno" });
  }
});

/* =========================
   Emails por servicio
   ========================= */

router.get("/service-emails", mustBeAdmin, (_req, res) => {
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS service_emails (service_id TEXT NOT NULL, email TEXT NOT NULL);`);
    const rows = db.prepare(`
      SELECT service_id AS serviceId, email
      FROM service_emails
      ORDER BY CAST(service_id AS TEXT), email
    `).all();

    const map = new Map();
    for (const r of rows) {
      const k = String(r.serviceId);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r.email);
    }
    const out = Array.from(map.entries()).map(([serviceId, emails]) => ({
      serviceId,
      serviceName: getServiceNameById(serviceId) || serviceId,
      emails,
    }));
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ error: "Error al listar emails por servicio" });
  }
});

router.put("/service-emails/:serviceId", mustBeAdmin, (req, res) => {
  const serviceId = String(req.params.serviceId || "").trim();
  const raw = String(req.body.emails || "").trim();
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS service_emails (service_id TEXT NOT NULL, email TEXT NOT NULL);`);
    const list = raw
      .split(/[,;]+/)
      .map(s => s.trim())
      .filter(Boolean);

    const del = db.prepare(`DELETE FROM service_emails WHERE CAST(service_id AS TEXT) = CAST(? AS TEXT)`);
    del.run(serviceId);

    const ins = db.prepare(`INSERT INTO service_emails (service_id, email) VALUES (?, ?)`);
    for (const e of list) ins.run(serviceId, e);

    return res.json({ ok: true, serviceId, count: list.length });
  } catch (e) {
    return res.status(500).json({ error: "Error al actualizar emails de servicio" });
  }
});

/* ======================================================
   Endpoints usados por el front para Servicio⇄Productos
   ====================================================== */

function detectSPCols() {
  ensureServiceProductsPivot(); // <— garantiza que exista con columnas esperadas
  const cols = db.prepare(`PRAGMA table_info('service_products')`).all().map(c => String(c.name).toLowerCase());
  if (cols.includes("servicioid") && cols.includes("productoid")) return { srv: "ServicioID",  prod: "ProductoID"  };
  if (cols.includes("servicio_id") && cols.includes("producto_id")) return { srv: "servicio_id", prod: "producto_id" };
  if (cols.includes("service_id")   && cols.includes("product_id"))  return { srv: "service_id",  prod: "product_id"  };
  // Fallback a los nombres creados por ensureServiceProductsPivot
  return { srv: "ServicioID", prod: "ProductoID" };
}

router.get("/sp/assignments/:serviceId", mustBeAdmin, (req, res) => {
  try {
    const { srv, prod } = detectSPCols();
    const sid = String(req.params.serviceId || "").trim();
    if (!sid) return res.status(400).json({ error: "serviceId requerido" });

    const rows = db.prepare(`
      SELECT ${prod} AS pid
      FROM service_products
      WHERE CAST(${srv} AS TEXT) = CAST(? AS TEXT)
    `).all(sid);

    res.json({ ok: true, serviceId: sid, productIds: rows.map(r => String(r.pid)) });
  } catch (e) {
    console.error("GET /admin/sp/assignments error:", e?.message || e);
    res.status(500).json({ error: "No se pudo leer asignaciones" });
  }
});

router.put("/sp/assignments/:serviceId", mustBeAdmin, (req, res) => {
  try {
    const { srv, prod } = detectSPCols();
    const sid = String(req.params.serviceId || "").trim();
    const desired = new Set(
      Array.isArray(req.body?.productIds) ? req.body.productIds.map(x => String(x)) : []
    );
    if (!sid) return res.status(400).json({ error: "serviceId requerido" });

    const existing = new Set(
      db.prepare(`
        SELECT ${prod} AS pid
        FROM service_products
        WHERE CAST(${srv} AS TEXT) = CAST(? AS TEXT)
      `).all(sid).map(r => String(r.pid))
    );

    const toAdd = [...desired].filter(id => !existing.has(id));
    const toDel = [...existing].filter(id => !desired.has(id));

    const ins = db.prepare(`INSERT INTO service_products (${srv}, ${prod}) VALUES (?, ?)`);
    const del = db.prepare(`
      DELETE FROM service_products
      WHERE CAST(${srv} AS TEXT) = CAST(? AS TEXT)
        AND CAST(${prod} AS TEXT) = CAST(? AS TEXT)
    `);

    const tx = db.transaction(() => {
      let added = 0, removed = 0;
      for (const pid of toAdd)   added  += ins.run(sid, pid).changes;
      for (const pid of toDel)   removed+= del.run(sid, pid).changes;
      return { added, removed };
    });

    const { added, removed } = tx();
    res.json({ ok: true, serviceId: sid, added, removed, productIds: [...desired] });
  } catch (e) {
    console.error("PUT /admin/sp/assignments error:", e?.message || e);
    res.status(500).json({ error: "No se pudieron actualizar las asignaciones" });
  }
});

export default router;
