// server/src/routes/deposito.js
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  db,
  discoverCatalogSchema,
  getEmployeeDisplayName,
  getFutureIncomingForProduct,
  getUserRoles,
  getServiceNameById,
  getUserById,
  getFullOrder,
} from "../db.js";
import { sendMail } from "../utils/mailer.js";

const router = Router();
console.log("[deposito] Router cargado: Modo Seguro (JS JOIN)");

/* ========================= Empresa ========================= */
function getEmpresaId(req) {
  return req.user?.empresaId ?? 1;
}

/* ========================= Auth ========================= */
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

/* ========================= Helpers de DB ========================= */
const hasTable = (name) =>
  !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);

function ensureStatusColumn() {
  try {
    const cols = db.prepare("PRAGMA table_info(Pedidos)").all().map(c => c.name.toLowerCase());
    if (!cols.includes("status") && !cols.includes("estado")) {
      db.prepare("ALTER TABLE Pedidos ADD COLUMN Status TEXT DEFAULT 'open'").run();
    }
  } catch (e) { console.warn("[deposito] ensureStatusColumn:", e.message); }
}

function ensureTimestampColumns() {
  try {
    const cols = db.prepare("PRAGMA table_info(Pedidos)").all().map(c => c.name.toLowerCase());
    if (!cols.includes("closedat") && !cols.includes("closed_at")) {
      db.prepare("ALTER TABLE Pedidos ADD COLUMN closedat TEXT DEFAULT NULL").run();
    }
    if (!cols.includes("retiro_at")) {
      db.prepare("ALTER TABLE Pedidos ADD COLUMN retiro_at TEXT DEFAULT NULL").run();
    }
  } catch (e) { console.warn("[deposito] ensureTimestampColumns:", e.message); }
}

// Normaliza keys de columna sin importar mayúsculas
const getVal = (obj, keys) => {
  if (!obj) return null;
  const foundKey = Object.keys(obj).find(k => keys.includes(k.toLowerCase()));
  return foundKey ? obj[foundKey] : null;
};

const pad7 = (v) => String(v ?? "").padStart(7, "0");

/* ========================= Email de pedido listo ========================= */
async function notifyOrderReady(orderId, closedAt) {
  try {
    const pedido = getFullOrder(Number(orderId));
    if (!pedido) return;

    const empleadoId = pedido.EmpleadoID;
    const empleado = getUserById(empleadoId);
    const supervisorEmail = empleado?.email?.trim();
    if (!supervisorEmail) {
      console.warn(`[deposito] Supervisor ${empleadoId} no tiene email — notificación omitida`);
      return;
    }

    // empresa del pedido (para que el mail salga con la config correcta)
    let empresaId = null;
    try {
      const row = db.prepare("SELECT empresa_id FROM Pedidos WHERE PedidoID = ? LIMIT 1").get(Number(orderId));
      empresaId = row?.empresa_id ?? null;
    } catch {}

    const servicioNombre = pedido.ServicioID
      ? getServiceNameById(String(pedido.ServicioID)) || `Servicio ${pedido.ServicioID}`
      : null;
    const empleadoNombre =
      getEmployeeDisplayName(empleadoId) || empleado?.username || `Empleado ${empleadoId}`;
    const nro = pad7(pedido.id);

    const fmtDate = (raw) => {
      if (!raw) return "—";
      try {
        return new Date(String(raw).replace(" ", "T") + (String(raw).includes("+") ? "" : "-03:00"))
          .toLocaleString("es-AR", {
            timeZone: "America/Argentina/Cordoba",
            day: "2-digit", month: "2-digit", year: "numeric",
            hour: "2-digit", minute: "2-digit",
          });
      } catch { return String(raw); }
    };
    const fechaPedido = fmtDate(pedido.Fecha);
    const fechaCierre = fmtDate(closedAt);

    const totalStr = pedido.Total != null
      ? new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 }).format(Number(pedido.Total))
      : "—";

    const items = pedido.items || [];

    const itemsText = items.length
      ? items.map(it => `  [${it.code || "—"}] ${it.name}  ×  ${it.qty}`).join("\n")
      : "  (sin detalle disponible)";

    const text = [
      `Hola ${empleadoNombre},`,
      ``,
      `Tu pedido de insumos #${nro}${servicioNombre ? ` para el servicio "${servicioNombre}"` : ""} ya está preparado y listo para retirar en el depósito.`,
      ``,
      `Detalle del pedido:`,
      `${"─".repeat(45)}`,
      itemsText,
      `${"─".repeat(45)}`,
      `Total: ${totalStr}`,
      ``,
      `Fecha del pedido:   ${fechaPedido}`,
      `Listo para retiro:  ${fechaCierre}`,
      ``,
      `Por favor, acercate al depósito a retirar tus materiales.`,
    ].join("\n");

    const itemsHtml = items.length
      ? items.map(it => `
          <tr>
            <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:13px;">${it.code || "—"}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${it.name}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-variant-numeric:tabular-nums;">${it.qty}</td>
          </tr>`).join("")
      : `<tr><td colspan="3" style="padding:8px 10px;color:#6b7280;">Sin detalle disponible</td></tr>`;

    const html = `
<!DOCTYPE html>
<html lang="es">
<body style="margin:0;padding:24px;background:#f8fafc;font-family:sans-serif;color:#111827;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#1d4ed8;padding:20px 28px;">
      <h1 style="margin:0;font-size:20px;color:#ffffff;font-weight:700;">
        Pedido #${nro} — Listo para retirar
      </h1>
      ${servicioNombre ? `<p style="margin:4px 0 0;color:#bfdbfe;font-size:14px;">Servicio: ${servicioNombre}</p>` : ""}
    </div>
    <div style="padding:24px 28px;">
      <p style="margin:0 0 16px;">Hola <strong>${empleadoNombre}</strong>,</p>
      <p style="margin:0 0 20px;background:#eff6ff;border-left:4px solid #2563eb;padding:12px 16px;border-radius:4px;">
        Tu pedido de insumos ya está <strong>preparado y listo para retirar</strong> en el depósito.
      </p>
      <h3 style="font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:0 0 8px;">
        Detalle del pedido
      </h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e5e7eb;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;">Código</th>
            <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e5e7eb;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;">Insumo</th>
            <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #e5e7eb;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;">Cantidad</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <p style="font-size:16px;font-weight:700;margin:0 0 20px;">Total: ${totalStr}</p>
      <table style="font-size:13px;color:#6b7280;border-spacing:0;margin-bottom:24px;">
        <tr><td style="padding:2px 0;">Fecha del pedido:</td><td style="padding:2px 0 2px 16px;color:#374151;">${fechaPedido}</td></tr>
        <tr><td style="padding:2px 0;">Listo para retiro:</td><td style="padding:2px 0 2px 16px;color:#374151;">${fechaCierre}</td></tr>
      </table>
    </div>
  </div>
</body>
</html>`;

    const subject = servicioNombre
      ? `PEDIDO #${nro} LISTO PARA RETIRAR — ${servicioNombre}`
      : `PEDIDO #${nro} LISTO PARA RETIRAR`;

    await sendMail({
      to: supervisorEmail,
      subject,
      text,
      html,
      entityType: "pedido_listo",
      entityId: String(orderId),
      empresaId,
    });

    console.log(`[deposito] Notificación enviada a ${supervisorEmail} — pedido #${nro}`);
  } catch (e) {
    console.warn("[deposito] notifyOrderReady error:", e?.message || e);
  }
}

/* ========================= Rutas ========================= */

// LISTAR PEDIDOS — filtrados por empresa, con empleado, servicio, items, timestamps
router.get("/orders", mustWarehouse, (req, res) => {
  try {
    ensureStatusColumn();
    ensureTimestampColumns();
    if (!hasTable("Pedidos")) return res.json([]);

    const empresaId = getEmpresaId(req);

    const cols = db.prepare("PRAGMA table_info(Pedidos)").all();
    const colNames = cols.map(c => c.name.toLowerCase());

    const hasEmpresaCol = colNames.includes("empresa_id");
    const hasDeletedCol = colNames.includes("deleted_at");
    let empresaWhere = hasEmpresaCol ? `WHERE empresa_id = ${Number(empresaId)}` : "";
    if (hasDeletedCol) empresaWhere += `${empresaWhere ? " AND" : "WHERE"} deleted_at IS NULL`;

    const rawOrders = db
      .prepare(`SELECT rowid AS __rowid, * FROM Pedidos ${empresaWhere} ORDER BY Fecha DESC LIMIT 100`)
      .all();

    let employees = [];
    if (hasTable("Empleados")) {
      const empCols = db.prepare("PRAGMA table_info(Empleados)").all().map(c => c.name.toLowerCase());
      const empEmpresaFilter = empCols.includes("empresa_id")
        ? `WHERE empresa_id = ${Number(empresaId)}`
        : "";
      employees = db.prepare(`SELECT * FROM Empleados ${empEmpresaFilter}`).all();
    }

    // Items de todos los pedidos en una sola query
    let itemsMap = {};
    if (hasTable("PedidoItems") && rawOrders.length > 0) {
      try {
        const rowIds = rawOrders.map(r => r.__rowid).filter(Boolean);
        if (rowIds.length > 0) {
          const itemCols = db.prepare("PRAGMA table_info(PedidoItems)").all().map(c => c.name.toLowerCase());
          const hasCodigo = itemCols.includes("codigo");
          const placeholders = rowIds.map(() => "?").join(",");
          const itemSql = `
            SELECT PedidoID,
                   Nombre    AS nombre,
                   ${hasCodigo ? "Codigo AS codigo," : "NULL AS codigo,"}
                   Cantidad  AS cantidad,
                   Precio    AS precio,
                   Subtotal  AS subtotal
            FROM PedidoItems
            WHERE PedidoID IN (${placeholders})
            ORDER BY PedidoID, PedidoItemID
          `;
          const allItems = db.prepare(itemSql).all(...rowIds);
          for (const item of allItems) {
            const pid = String(item.PedidoID);
            if (!itemsMap[pid]) itemsMap[pid] = [];
            itemsMap[pid].push({
              nombre: item.nombre || "—",
              codigo: item.codigo || "",
              cantidad: Number(item.cantidad || 0),
              precio: Number(item.precio || 0),
              subtotal: Number(item.subtotal || 0),
            });
          }
        }
      } catch (e) {
        console.warn("[deposito] items fetch error:", e.message);
      }
    }

    const cleanRows = rawOrders.map(row => {
      const id =
        getVal(row, ["pedidoid", "id", "idpedido", "pedido_id"]) ??
        row.__rowid ??
        null;

      const empId = getVal(row, ["empleadoid", "empleado", "empleado_id"]);
      let empNombre = "";
      try { if (empId != null) empNombre = getEmployeeDisplayName(empId) || ""; } catch { }
      if (!empNombre) empNombre = empId ? `Empleado ${empId}` : "Desconocido";

      const servicioId = getVal(row, ["servicioid", "servicio_id"]);
      let servicioNombre = "";
      try { if (servicioId != null) servicioNombre = getServiceNameById(String(servicioId)) || ""; } catch { }

      const status  = String(getVal(row, ["status"]) || "").toLowerCase();
      const estado  = String(getVal(row, ["estado"]) || "").toLowerCase();
      const isClosedVal = getVal(row, ["isclosed", "cerrado", "is_closed"]);
      let finalStatus = "open";
      const isClosed    = isClosedVal == 1 || status === "closed" || estado === "cerrado";
      const isPreparing = status.includes("prepar") || estado.includes("prepar");
      if (isClosed) finalStatus = "closed";
      else if (isPreparing) finalStatus = "preparing";

      let remitoNumero = null;
      for (const c of colNames.filter(c => c.includes("remito"))) {
        const v = row[c];
        if (v != null && String(v).trim() !== "") { remitoNumero = v; break; }
      }

      return {
        id,
        displayId: pad7(id ?? ""),
        empleadoId: empId,
        empleadoNombre: empNombre,
        rol: getVal(row, ["rol", "role"]),
        servicioId,
        servicioNombre,
        fecha: getVal(row, ["fecha", "created_at"]),
        closedAt: getVal(row, ["closedat", "closed_at"]),
        retiroAt: getVal(row, ["retiro_at"]),
        total: getVal(row, ["total", "amount"]),
        status: finalStatus,
        isClosed,
        remito: remitoNumero,
        remitoDisplay: remitoNumero ? String(remitoNumero) : "-",
        items: itemsMap[String(id)] || [],
      };
    });

    const statusParam = String(req.query.status || "open").toLowerCase();
    const filtered = cleanRows.filter(o => {
      if (statusParam === "preparing") return o.status === "preparing";
      if (statusParam === "closed")    return o.status === "closed" && !o.retiroAt;
      if (statusParam === "retirado")  return o.status === "closed" && !!o.retiroAt;
      return o.status === "open";
    });

    res.json(filtered);
  } catch (e) {
    console.error("[deposito] Error listing orders:", e);
    res.json([]);
  }
});

// REGISTRAR RETIRO — antes de /:id/:action para que Express no lo capture como action="pickup"
router.put("/orders/:id/pickup", mustWarehouse, (req, res) => {
  const id = req.params.id;
  try {
    ensureTimestampColumns();

    const cols = db.prepare("PRAGMA table_info(Pedidos)").all().map(c => c.name.toLowerCase());
    const idInfo = db.prepare("PRAGMA table_info(Pedidos)").all()
      .find(c => ["pedidoid", "id", "idpedido"].includes(c.name.toLowerCase()));
    const idCol = idInfo ? idInfo.name : "PedidoID";

    if (!cols.includes("retiro_at")) {
      return res.status(500).json({ error: "No se puede registrar el retiro (columna no disponible)" });
    }

    const retiroAt = new Date().toISOString();

    const r = db.prepare(
      `UPDATE Pedidos SET retiro_at = ? WHERE ${idCol} = ? AND (retiro_at IS NULL OR retiro_at = '')`
    ).run(retiroAt, id);

    if (r.changes === 0) {
      const exists = db.prepare(`SELECT retiro_at FROM Pedidos WHERE ${idCol} = ?`).get(id);
      if (!exists) return res.status(404).json({ error: "Pedido no encontrado" });
      return res.json({ ok: true, alreadyPickedUp: true, retiroAt: exists.retiro_at });
    }

    res.json({ ok: true, retiroAt });
  } catch (e) {
    console.error("[deposito] pickup error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ACTUALIZAR ESTADO — cierre dispara email al supervisor
router.put("/orders/:id/:action", mustWarehouse, async (req, res) => {
  const id     = req.params.id;
  const action = req.params.action;

  try {
    ensureStatusColumn();
    ensureTimestampColumns();

    const cols = db.prepare("PRAGMA table_info(Pedidos)").all().map(c => c.name.toLowerCase());
    const idInfo = db.prepare("PRAGMA table_info(Pedidos)").all()
      .find(c => ["pedidoid", "id", "idpedido"].includes(c.name.toLowerCase()));
    const idCol = idInfo ? idInfo.name : "PedidoID";

    let sets = [], params = [];
    const add = (keys, val) => {
      const real = cols.find(c => keys.includes(c));
      if (real) { sets.push(`${real} = ?`); params.push(val); }
    };

    let closedAt = null;

    if (action === "prepare" || action.includes("prepar")) {
      add(["status"], "preparing"); add(["estado"], "preparacion");
      add(["isclosed", "cerrado"], 0); add(["closedat"], null);
    } else if (action === "close") {
      closedAt = new Date().toISOString();
      add(["status"], "closed"); add(["estado"], "cerrado");
      add(["isclosed", "cerrado"], 1); add(["closedat"], closedAt);
    } else if (action === "reopen") {
      add(["status"], "open"); add(["estado"], "abierto");
      add(["isclosed", "cerrado"], 0); add(["closedat"], null);
      add(["retiro_at"], null);
    }

    if (!sets.length) return res.status(500).json({ error: "Sin columnas de estado" });

    params.push(id);
    const r = db.prepare(`UPDATE Pedidos SET ${sets.join(", ")} WHERE ${idCol} = ?`).run(...params);
    if (r.changes === 0) return res.status(404).json({ error: "Pedido no encontrado" });

    res.json({ ok: true, id });

    if (action === "close" && closedAt) {
      setImmediate(async () => { await notifyOrderReady(id, closedAt); });
    }
  } catch (e) {
    console.error("[deposito] action error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Compatibilidad de rutas antiguas
router.put("/orders/prepare/:id", mustWarehouse, (req, res) => { req.params.action = "prepare"; router.handle(req, res); });
router.put("/orders/close/:id",   mustWarehouse, (req, res) => { req.params.action = "close";   router.handle(req, res); });
router.put("/orders/reopen/:id",  mustWarehouse, (req, res) => { req.params.action = "reopen";  router.handle(req, res); });

/* ========================= Analytics ========================= */

router.get("/overview", mustWarehouse, (req, res) => {
  try {
    const threshold = Number.isNaN(Number(req.query.threshold)) ? 0 : Number(req.query.threshold);
    const sch = discoverCatalogSchema();
    if (!sch.ok) return res.json({ top: [], low: [] });

    const { products } = sch.tables;
    const { prodId, prodName, prodStock, prodCode } = sch.cols;

    if (!prodStock) return res.json({ top: [], low: [] });

    const sql = `
      SELECT ${prodId}   AS productId,
             ${prodName} AS name,
             ${prodCode ? prodCode : "NULL"} AS code,
             ${prodStock} AS stock
        FROM ${products}
       WHERE ${prodStock} IS NOT NULL
         AND CAST(${prodStock} AS REAL) <= CAST(? AS REAL)
       ORDER BY CAST(${prodStock} AS REAL) ASC,
                ${prodName} COLLATE NOCASE
       LIMIT 500
    `;

    const low = db
      .prepare(sql)
      .all(threshold)
      .map(row => ({
        ...row,
        stock: Number(row.stock ?? 0),
        code: row.code ? String(row.code).trim() : "",
      }));

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