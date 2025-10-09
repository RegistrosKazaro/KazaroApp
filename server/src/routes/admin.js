// server/src/routes/admin.js
import { Router } from "express";
import {
  db,
  ensureSupervisorPivot,
  discoverCatalogSchema,
  adminListCategoriesForSelect,
  adminGetProductById,
  listServiceBudgets,
  setBudgetForService,
} from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const mustBeAdmin = [requireAuth, requireRole(["admin", "Admin"])];

// ---------- util: esquema dinámico de productos ----------
function prodSchemaOrThrow() {
  const sch = discoverCatalogSchema();
  if (!sch?.ok) throw new Error(sch?.reason || "No hay esquema de productos");
  return sch;
}

/* =================== PRODUCTOS =================== */

// Esquema para el front
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

// Lista para <select> de categorías
router.get("/product-categories", mustBeAdmin, (_req, res) => {
  try { res.json(adminListCategoriesForSelect()); }
  catch { res.status(500).json({ error: "No se pudieron cargar las categorías" }); }
});

// Listado / búsqueda
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

// Obtener un producto por id
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

// Crear producto
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

// Editar producto
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

// Eliminar producto
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

// Sumar/restar stock
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

/* =================== PEDIDOS =================== */
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

/* ========== SERVICIOS / SUPERVISORES / ASIGNACIONES (Admin) ========== */
const EMP_ID = "EmpleadosID";
const EMP_NAME_EXPR = `
  TRIM(COALESCE(e.Nombre,'') || ' ' || COALESCE(e.Apellido,'')) ||
  CASE WHEN IFNULL(TRIM(e.username),'') <> '' THEN ' ('||e.username||')' ELSE '' END
`;
const SRV_ID = "ServiciosID";
const SRV_NAME = "ServicioNombre";

// Buscar servicios
router.get("/services", mustBeAdmin, (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit ?? "25", 10) || 25, 1), 100);
    if (!q) return res.json([]);
    const like = `%${q}%`;
    const rows = db.prepare(`
      SELECT ${SRV_ID} AS id, ${SRV_NAME} AS name
      FROM Servicios s
      WHERE (${SRV_NAME} LIKE @like OR CAST(${SRV_ID} AS TEXT) LIKE @like)
      ORDER BY ${SRV_NAME} COLLATE NOCASE
      LIMIT ${limit}
    `).all({ like });
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Error al listar servicios" });
  }
});

// Supervisores
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

// Asignaciones
router.get("/assignments", mustBeAdmin, (req, res) => {
  try {
    ensureSupervisorPivot();
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
    ensureSupervisorPivot();
    const EmpleadoID = Number(req.body?.EmpleadoID);
    const ServicioID = Number(req.body?.ServicioID);
    if (!EmpleadoID || !ServicioID) return res.status(400).json({ error: "EmpleadoID y ServicioID son requeridos" });
    const r = db.prepare(`INSERT OR IGNORE INTO supervisor_services (EmpleadoID, ServicioID) VALUES (?, ?)`)
      .run(EmpleadoID, ServicioID);
    res.status(201).json({ ok: true, id: r.lastInsertRowid || null });
  } catch (e) {
    console.error("POST /admin/assignments error:", e);
    res.status(500).json({ error: "Error al crear asignación" });
  }
});

router.delete("/assignments/:id", mustBeAdmin, (req, res) => {
  try {
    ensureSupervisorPivot();
    const id = Number(req.params.id);
    let r = db.prepare(`DELETE FROM supervisor_services WHERE rowid = ?`).run(id);
    if (!r.changes && (req.query.EmpleadoID && req.query.ServicioID)) {
      r = db.prepare(`DELETE FROM supervisor_services WHERE EmpleadoID = ? AND ServicioID = ?`)
        .run(Number(req.query.EmpleadoID), Number(req.query.ServicioID));
    }
    if (!r.changes) return res.status(404).json({ error: "Asignación no encontrada" });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error al eliminar asignación" });
  }
});

/* =================== PRESUPUESTOS POR SERVICIO (ADMIN) =================== */
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

export default router;
