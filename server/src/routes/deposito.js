// server/src/routes/deposito.js  ← REEMPLAZA el archivo actual
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  db,
  discoverCatalogSchema,
  getEmployeeDisplayName,
  getFutureIncomingForProduct,
  getUserRoles,
} from "../db.js";

const router = Router();
console.log("[deposito] Router cargado: Modo Seguro (JS JOIN)");

function getEmpresaId(req) {
  return req.user?.empresaId ?? 1;
}

function requireDepositoOrAdmin(req, res, next) {
  try {
    if (!req.user?.id) return res.status(401).json({ ok: false, error: "No autenticado" });
    const roles = (req.user.roles || getUserRoles(req.user.id) || []).map(r => String(r).toLowerCase());
    if (!roles.includes("deposito") && !roles.includes("admin")) {
      return res.status(403).json({ ok: false, error: "Sin permiso" });
    }
    return next();
  } catch { return res.status(403).json({ ok: false, error: "Error permisos" }); }
}

const mustWarehouse = [requireAuth, requireDepositoOrAdmin];
const hasTable = (name) => !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);

function ensureStatusColumn() {
  try {
    const cols = db.prepare("PRAGMA table_info(Pedidos)").all().map(c => c.name.toLowerCase());
    if (!cols.includes("status") && !cols.includes("estado")) {
      db.prepare("ALTER TABLE Pedidos ADD COLUMN Status TEXT DEFAULT 'open'").run();
    }
  } catch (e) { console.warn("Error checking status col:", e.message); }
}

const getVal = (obj, keys) => {
  if (!obj) return null;
  const foundKey = Object.keys(obj).find((k) => keys.includes(k.toLowerCase()));
  return foundKey ? obj[foundKey] : null;
};

const pad7 = (v) => String(v ?? "").padStart(7, "0");

// LISTAR PEDIDOS — filtrados por empresa del usuario
router.get("/orders", mustWarehouse, (req, res) => {
  try {
    ensureStatusColumn();
    if (!hasTable("Pedidos")) return res.json([]);

    const empresaId = getEmpresaId(req);

    const cols     = db.prepare("PRAGMA table_info(Pedidos)").all();
    const colNames = cols.map((c) => c.name.toLowerCase());

    // Filtrar por empresa si la columna existe
    const hasEmpresaCol = colNames.includes("empresa_id");
    const empresaWhere  = hasEmpresaCol ? `WHERE empresa_id = ${Number(empresaId)}` : "";

    const rawOrders = db
      .prepare(`SELECT rowid AS __rowid, * FROM Pedidos ${empresaWhere} ORDER BY Fecha DESC LIMIT 100`)
      .all();

    let employees = [];
    if (hasTable("Empleados")) {
      // Solo empleados de la misma empresa
      const empCols = db.prepare("PRAGMA table_info(Empleados)").all().map(c => c.name.toLowerCase());
      const empEmpresaFilter = empCols.includes("empresa_id")
        ? `WHERE empresa_id = ${Number(empresaId)}`
        : "";
      employees = db.prepare(`SELECT * FROM Empleados ${empEmpresaFilter}`).all();
    }

    const cleanRows = rawOrders.map(row => {
      const id    = getVal(row, ["pedidoid","id","idpedido","pedido_id"]) ?? row.__rowid ?? null;
      const empId = getVal(row, ["empleadoid","empleado","empleado_id"]);

      let empNombre = "";
      try {
        if (empId != null) empNombre = getEmployeeDisplayName(empId) || "";
      } catch { empNombre = ""; }
      if (!empNombre) empNombre = empId ? `ID: ${empId}` : "Desconocido";

      const status      = String(getVal(row, ["status"]) || "").toLowerCase();
      const estado      = String(getVal(row, ["estado"]) || "").toLowerCase();
      const isClosedVal = getVal(row, ["isclosed","cerrado","is_closed"]);

      let finalStatus = "open";
      const isClosed    = isClosedVal == 1 || status === "closed" || estado === "cerrado";
      const isPreparing = status.includes("prepar") || estado.includes("prepar");
      if (isClosed)    finalStatus = "closed";
      else if (isPreparing) finalStatus = "preparing";

      let remitoNumero = null;
      const remitoCols = colNames.filter((c) => c.includes("remito"));
      for (const c of remitoCols) {
        const v = row[c];
        if (v != null && String(v).trim() !== "") { remitoNumero = v; break; }
      }

      return {
        id,
        displayId: pad7(id ?? ""),
        empleadoId: empId,
        empleadoNombre: empNombre,
        rol: getVal(row, ["rol","role"]),
        fecha: getVal(row, ["fecha","created_at"]),
        total: getVal(row, ["total","amount"]),
        status: finalStatus,
        isClosed,
        remito: remitoNumero,
        remitoDisplay: remitoNumero ? String(remitoNumero) : "-",
      };
    });

    const statusParam = String(req.query.status || "open").toLowerCase();
    const filtered = cleanRows.filter(o => {
      if (statusParam === "closed")    return o.status === "closed";
      if (statusParam === "preparing") return o.status === "preparing";
      return o.status === "open";
    });

    res.json(filtered);
  } catch (e) {
    console.error("[deposito] Error listing orders:", e);
    res.json([]);
  }
});

router.put("/orders/:id/:action", mustWarehouse, (req, res) => {
  const id     = req.params.id;
  const action = req.params.action;

  try {
    ensureStatusColumn();
    const cols  = db.prepare("PRAGMA table_info(Pedidos)").all().map(c => c.name.toLowerCase());
    const idInfo = db.prepare("PRAGMA table_info(Pedidos)").all().find(c => ["pedidoid","id","idpedido"].includes(c.name.toLowerCase()));
    const idCol  = idInfo ? idInfo.name : "PedidoID";

    let sets = [], params = [];
    const add = (keys, val) => {
      const real = cols.find(c => keys.includes(c));
      if (real) { sets.push(`${real} = ?`); params.push(val); }
    };

    if (action === "prepare" || action.includes("prepar")) {
      add(["status"], "preparing"); add(["estado"], "preparacion");
      add(["isclosed","cerrado"], 0); add(["closedat"], null);
    } else if (action === "close") {
      add(["status"], "closed"); add(["estado"], "cerrado");
      add(["isclosed","cerrado"], 1); add(["closedat"], new Date().toISOString());
    } else if (action === "reopen") {
      add(["status"], "open"); add(["estado"], "abierto");
      add(["isclosed","cerrado"], 0); add(["closedat"], null);
    }

    if (!sets.length) return res.status(500).json({ error: "Sin columnas de estado" });

    params.push(id);
    const r = db.prepare(`UPDATE Pedidos SET ${sets.join(", ")} WHERE ${idCol} = ?`).run(...params);
    if (r.changes === 0) return res.status(404).json({ error: "Pedido no encontrado" });
    res.json({ ok: true, id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get("/overview", mustWarehouse, (req, res) => {
  try {
    const threshold = Number.isNaN(Number(req.query.threshold)) ? 0 : Number(req.query.threshold);
    const sch = discoverCatalogSchema();
    if (!sch.ok) return res.json({ top: [], low: [] });

    const { products }               = sch.tables;
    const { prodId, prodName, prodStock } = sch.cols;
    if (!prodStock) return res.json({ top: [], low: [] });

    const low = db.prepare(`
      SELECT ${prodId} AS productId, ${prodName} AS name, ${prodStock} AS stock
      FROM ${products}
      WHERE ${prodStock} IS NOT NULL AND CAST(${prodStock} AS REAL) <= CAST(? AS REAL)
      ORDER BY CAST(${prodStock} AS REAL) ASC, ${prodName} COLLATE NOCASE
      LIMIT 500
    `).all(threshold).map(row => ({ ...row, stock: Number(row.stock ?? 0) }));

    return res.json({ top: [], low });
  } catch (e) {
    console.error("[deposito] /overview error", e);
    return res.json({ top: [], low: [] });
  }
});

router.get("/top-consumidos", mustWarehouse, (_req, res) => res.json({ rows: [] }));

router.get("/low-stock", mustWarehouse, (req, res) => {
  req.url = "/overview";
  return router.handle(req, res);
});

router.get("/consumo-desde-ultimo-ingreso/:productId", mustWarehouse, (req, res) => {
  const productId = req.params.productId;
  try {
    const { incoming, nextEta } = getFutureIncomingForProduct(productId);
    res.json({ productId, consumido: null, last_ingreso: null, incoming_total: incoming, next_eta: nextEta });
  } catch (e) {
    console.error("[deposito] consumo-desde-ultimo-ingreso", e);
    res.json({ productId, consumido: null, last_ingreso: null, incoming_total: null, next_eta: null });
  }
});

export default router;