// server/src/routes/deposito.js
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { db, getFutureIncomingForProduct, getUserRoles } from "../db.js";

const router = Router();
console.log("[deposito] Router cargado: Modo Seguro (JS JOIN)");

/* ------------------------ Auth ------------------------ */
function requireDepositoOrAdmin(req, res, next) {
  try {
    if (!req.user?.id) return res.status(401).json({ ok: false, error: "No autenticado" });
    const roles = (req.user.roles || getUserRoles(req.user.id) || []).map(r => String(r).toLowerCase());
    if (!roles.includes("deposito") && !roles.includes("admin")) {
      return res.status(403).json({ ok: false, error: "Sin permiso" });
    }
    return next();
  } catch (e) { return res.status(403).json({ ok: false, error: "Error permisos" }); }
}
const mustWarehouse = [requireAuth, requireDepositoOrAdmin];

/* ----------------------------- Helpers ----------------------------- */
const hasTable = (name) => !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);

// Auto-reparación de columna Status
function ensureStatusColumn() {
  try {
    const cols = db.prepare("PRAGMA table_info(Pedidos)").all().map(c => c.name.toLowerCase());
    if (!cols.includes("status") && !cols.includes("estado")) {
      db.prepare("ALTER TABLE Pedidos ADD COLUMN Status TEXT DEFAULT 'open'").run();
    }
  } catch (e) { console.warn("Error checking status col:", e.message); }
}

// Normalizador flexible de objetos (busca keys sin importar mayúsculas/minúsculas)
const getVal = (obj, keys) => {
  if (!obj) return null;
  const foundKey = Object.keys(obj).find(k => keys.includes(k.toLowerCase()));
  return foundKey ? obj[foundKey] : null;
};

/* ----------------------------- Rutas ----------------------------- */

// LISTAR PEDIDOS (Con Nombres de Empleados - Método Seguro)
router.get("/orders", mustWarehouse, (req, res) => {
  try {
    ensureStatusColumn();
    if (!hasTable("Pedidos")) return res.json([]);

    // 1. Traemos TODOS los pedidos (Sin JOINS complejos que pueden fallar)
    const rawOrders = db.prepare("SELECT * FROM Pedidos ORDER BY Fecha DESC LIMIT 100").all();
    
    // 2. Traemos TODOS los empleados (para buscar sus nombres aquí)
    let employees = [];
    if (hasTable("Empleados")) {
        employees = db.prepare("SELECT * FROM Empleados").all();
    }

    // 3. Unimos los datos manualmente
    const cleanRows = rawOrders.map(row => {
      const id = getVal(row, ["pedidoid", "id", "idpedido"]);
      const empId = getVal(row, ["empleadoid", "empleado", "empleado_id"]);
      
      // Buscar empleado correspondiente en la lista que trajimos
      const empObj = employees.find(e => {
          const eId = getVal(e, ["empleadoid", "id", "empleado_id", "idempleado"]);
          return String(eId) === String(empId);
      });

      // Extraer nombre del empleado encontrado
      let empNombre = "";
      if (empObj) {
          const nom = getVal(empObj, ["nombre", "name", "firstname"]) || "";
          const ape = getVal(empObj, ["apellido", "lastname", "surname"]) || "";
          empNombre = `${nom} ${ape}`.trim();
          if (!empNombre) empNombre = getVal(empObj, ["username", "usuario", "user"]);
      }
      // Si no encontramos nombre, usamos el ID
      if (!empNombre) empNombre = empId ? `ID: ${empId}` : "Desconocido";

      // Normalizar estado
      const status = String(getVal(row, ["status"]) || "").toLowerCase();
      const estado = String(getVal(row, ["estado"]) || "").toLowerCase();
      const isClosedVal = getVal(row, ["isclosed", "cerrado", "is_closed"]);
      
      let finalStatus = "open";
      const isClosed = isClosedVal == 1 || status === "closed" || estado === "cerrado";
      const isPreparing = status.includes("prepar") || estado.includes("prepar");

      if (isClosed) finalStatus = "closed";
      else if (isPreparing) finalStatus = "preparing";

      return {
        id: id,
        empleadoId: empId,
        empleadoNombre: empNombre, // <--- DATO CLAVE
        rol: getVal(row, ["rol", "role"]),
        fecha: getVal(row, ["fecha", "created_at"]),
        total: getVal(row, ["total", "amount"]),
        status: finalStatus,
        isClosed: isClosed,
        remito: getVal(row, ["remitonumber", "remito", "remito_numero"])
      };
    });

    // 4. Filtrar por pestaña
    const statusParam = String(req.query.status || "open").toLowerCase();
    const filtered = cleanRows.filter(o => {
      if (statusParam === "closed") return o.status === "closed";
      if (statusParam === "preparing") return o.status === "preparing";
      return o.status === "open";
    });

    res.json(filtered);
  } catch (e) {
    console.error("[deposito] Error listing orders:", e);
    res.json([]); // Devuelve array vacío en vez de error para no romper la pantalla
  }
});

// Actualizar Estado (Auto-repara y verifica)
router.put("/orders/:id/:action", mustWarehouse, (req, res) => {
  const id = req.params.id;
  const action = req.params.action; // prepare, close, reopen

  try {
    ensureStatusColumn();
    const cols = db.prepare("PRAGMA table_info(Pedidos)").all().map(c => c.name.toLowerCase());
    
    // Buscar nombre real de columna ID
    const idInfo = db.prepare("PRAGMA table_info(Pedidos)").all().find(c => ["pedidoid","id","idpedido"].includes(c.name.toLowerCase()));
    const idCol = idInfo ? idInfo.name : "PedidoID";

    let sets = []; 
    let params = [];

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

// Compatibilidad de rutas
router.put("/orders/prepare/:id", mustWarehouse, (req, res) => { req.params.action="prepare"; router.handle(req, res); });
router.put("/orders/close/:id", mustWarehouse, (req, res) => { req.params.action="close"; router.handle(req, res); });
router.put("/orders/reopen/:id", mustWarehouse, (req, res) => { req.params.action="reopen"; router.handle(req, res); });

// Analytics Stubs (Para que no rompa)
router.get("/overview", mustWarehouse, (req, res) => res.json({ top: [], low: [] }));
router.get("/top-consumidos", mustWarehouse, (req, res) => res.json({ rows: [] }));
router.get("/low-stock", mustWarehouse, (req, res) => res.json({ rows: [] }));
router.get("/consumo-desde-ultimo-ingreso/:productId", mustWarehouse, (req, res) => res.json({ consumido: 0 }));

export default router;