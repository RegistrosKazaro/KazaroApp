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
  applyOrderStockDiscount,
} from "../db.js";
import { sendMail } from "../utils/mailer.js";
import { getMailConfigValue } from "../utils/empresa.js";

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
// DEPRECADA / SIN USO: el aviso de "listo para retirar" ya NO manda mail; el
// supervisor se entera por la notificación in-app (campana). Se conserva por si
// se necesita volver a habilitar, pero no se llama desde ningún lado.
// eslint-disable-next-line no-unused-vars
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

    // Copia fija a nicolas.barcena (configurable con MAIL_ALWAYS por empresa).
    // El aviso de "listo para retirar" va sólo al supervisor y a esta copia.
    const copiaFija = getMailConfigValue(empresaId, "MAIL_ALWAYS", "nicolas.barcena@kazaro.com.ar");
    const cc = copiaFija && copiaFija.trim().toLowerCase() !== supervisorEmail.trim().toLowerCase()
      ? copiaFija.trim()
      : undefined;

    await sendMail({
      to: supervisorEmail,
      cc,
      subject,
      text,
      html,
      entityType: "pedido_listo",
      entityId: String(orderId),
      empresaId,
    });

    console.log(`[deposito] Notificación enviada a ${supervisorEmail}${cc ? ` (cc ${cc})` : ""} — pedido #${nro}`);
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
                   ProductoID AS productoId,
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
              productId: Number(item.productoId) || null,
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
      const isRevision  = status === "revision_deposito";
      if (isRevision) finalStatus = "revision_deposito";
      else if (isClosed) finalStatus = "closed";
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
      if (statusParam === "revision_deposito") return o.status === "revision_deposito";
      if (statusParam === "preparing") return o.status === "preparing";
      if (statusParam === "closed")    return o.status === "closed" && !o.retiroAt;
      if (statusParam === "retirado")  return o.status === "closed" && !!o.retiroAt;
      // "open" (Pendientes) NO debe incluir los que están en revisión.
      return o.status === "open";
    });

    res.json(filtered);
  } catch (e) {
    console.error("[deposito] Error listing orders:", e);
    res.json([]);
  }
});

// BUSCAR PRODUCTOS del catálogo (para agregar insumos en revisión). A diferencia
// de /catalog/products, NO filtra por visibilidad de rol: el depósito maneja el
// stock, así que ve todo el catálogo de su empresa.
router.get("/productos", mustWarehouse, (req, res) => {
  try {
    const empresaId = req.user?.empresaId ?? 1;
    const q = String(req.query.q || "").trim();
    if (q.length < 2) return res.json([]);

    const sch = discoverCatalogSchema();
    if (!sch.ok) return res.json([]);
    const { products } = sch.tables;
    const { prodId, prodName, prodPrice, prodCode, prodStock } = sch.cols;

    const cols = db.prepare(`PRAGMA table_info(${products})`).all().map(c => c.name.toLowerCase());
    const where = ["COALESCE(is_active,1) = 1"];
    const params = [];
    if (cols.includes("empresa_id")) { where.push("empresa_id = ?"); params.push(Number(empresaId)); }
    const like = `%${q}%`;
    if (prodCode) { where.push(`(${prodName} LIKE ? OR ${prodCode} LIKE ?)`); params.push(like, like); }
    else { where.push(`${prodName} LIKE ?`); params.push(like); }

    const rows = db.prepare(`
      SELECT ${prodId} AS id, ${prodName} AS name,
             ${prodCode ? `${prodCode}` : "''"} AS code,
             ${prodPrice ? `${prodPrice}` : "0"} AS price,
             ${prodStock ? `COALESCE(${prodStock},0)` : "0"} AS stock
      FROM ${products}
      WHERE ${where.join(" AND ")}
      ORDER BY ${prodName} COLLATE NOCASE
      LIMIT 15
    `).all(...params);
    res.json(rows);
  } catch (e) {
    console.error("[deposito/productos]", e?.message || e);
    res.json([]);
  }
});

/* ===== Revisión del depósito: editar ítems y confirmar ===== */
// Van antes de /:id/:action para que Express no los tome como action.

// Verifica que el pedido exista, sea de la empresa y todavía sea editable. Un
// pedido de supervisor es editable mientras NO esté retirado (retiro_at nulo).
// Los administrativos descuentan stock al crearse, así que no se editan por acá
// (editarlos desincronizaría su stock).
function pedidoEditable(id, empresaId) {
  const p = db.prepare(`SELECT PedidoID, empresa_id, Status, Rol, retiro_at FROM Pedidos WHERE PedidoID = ?`).get(id);
  if (!p) return { error: 404 };
  if (p.empresa_id != null && Number(p.empresa_id) !== Number(empresaId)) return { error: 404 };
  if (p.retiro_at != null && String(p.retiro_at).trim() !== "") return { error: 409 };
  if (String(p.Rol || "").toLowerCase() !== "supervisor") return { error: 403 };
  return { ok: true, pedido: p };
}

// REEMPLAZAR ÍTEMS de un pedido en revisión (agregar/quitar/cambiar cantidad/producto).
router.put("/orders/:id/items", mustWarehouse, (req, res) => {
  try {
    const id = Number(req.params.id);
    const empresaId = req.user?.empresaId ?? 1;
    const chk = pedidoEditable(id, empresaId);
    if (chk.error === 404) return res.status(404).json({ error: "Pedido no encontrado" });
    if (chk.error === 409) return res.status(409).json({ error: "El pedido ya fue retirado y no se puede editar" });
    if (chk.error === 403) return res.status(403).json({ error: "Solo se pueden editar pedidos de supervisor" });

    const nuevos = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!nuevos || !nuevos.length) return res.status(400).json({ error: "Enviá al menos un insumo" });

    const sch = discoverCatalogSchema();
    if (!sch.ok) return res.status(500).json({ error: sch.reason });
    const { products } = sch.tables;
    const { prodId, prodName, prodPrice, prodCode } = sch.cols;

    const lookup = db.prepare(`
      SELECT ${prodName} AS name, ${prodPrice ? prodPrice : "0"} AS price${prodCode ? `, ${prodCode} AS code` : ", '' AS code"}
      FROM ${products} WHERE ${prodId} = ? LIMIT 1
    `);

    // Validar y normalizar los ítems entrantes.
    const filas = [];
    let total = 0;
    for (const it of nuevos) {
      const pid = Number(it.productId ?? it.ProductoID ?? it.pid);
      const cantidad = Math.trunc(Number(it.cantidad ?? it.qty ?? 0));
      if (!Number.isFinite(pid) || pid <= 0) return res.status(400).json({ error: "Producto inválido" });
      if (!Number.isFinite(cantidad) || cantidad <= 0) return res.status(400).json({ error: "Cantidad inválida" });
      const row = lookup.get(pid);
      if (!row) return res.status(400).json({ error: `Producto inexistente (id ${pid})` });
      const precio = Number(row.price || 0);
      const subtotal = precio * cantidad;
      total += subtotal;
      filas.push({ pid, name: row.name, precio, cantidad, subtotal, code: row.code || "" });
    }

    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM PedidoItems WHERE PedidoID = ?`).run(id);
      const ins = db.prepare(`INSERT INTO PedidoItems (PedidoID, ProductoID, Nombre, Precio, Cantidad, Subtotal, Codigo) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const f of filas) ins.run(id, f.pid, f.name, f.precio, f.cantidad, f.subtotal, f.code);
      db.prepare(`UPDATE Pedidos SET Total = ? WHERE PedidoID = ?`).run(total, id);
    });
    tx();

    res.json({ ok: true, total, items: filas.length });
  } catch (e) {
    console.error("[deposito/items]", e?.message || e);
    res.status(500).json({ error: "No se pudieron guardar los cambios" });
  }
});

// CONFIRMAR un pedido en revisión: lo saca de "Por confirmar" y lo pasa a la
// cola de trabajo del depósito (Pendientes). NO descuenta stock: el stock recién
// se descuenta al marcar el pedido como retirado. El pedido sigue editable.
router.post("/orders/:id/confirm", mustWarehouse, (req, res) => {
  try {
    const id = Number(req.params.id);
    const empresaId = req.user?.empresaId ?? 1;
    const p = db.prepare(`SELECT PedidoID, empresa_id, Status FROM Pedidos WHERE PedidoID = ?`).get(id);
    if (!p || (p.empresa_id != null && Number(p.empresa_id) !== Number(empresaId))) {
      return res.status(404).json({ error: "Pedido no encontrado" });
    }
    if (String(p.Status || "").toLowerCase() !== "revision_deposito") {
      return res.status(409).json({ error: "El pedido ya no está en revisión" });
    }

    ensureStatusColumn();
    db.prepare(`UPDATE Pedidos SET Status = 'open' WHERE PedidoID = ?`).run(id);
    res.json({ ok: true, id });
  } catch (e) {
    console.error("[deposito/confirm]", e?.message || e);
    res.status(500).json({ error: "No se pudo confirmar el pedido" });
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

    if (cols.includes("empresa_id")) {
      const empresaId = req.user?.empresaId ?? 1;
      const owner = db.prepare(`SELECT empresa_id FROM Pedidos WHERE ${idCol} = ?`).get(id);
      if (!owner || Number(owner.empresa_id) !== Number(empresaId)) return res.status(404).json({ error: "Pedido no encontrado" });
    }

    // Si ya estaba retirado, no repetir nada.
    const yaRetirado = db.prepare(`SELECT retiro_at FROM Pedidos WHERE ${idCol} = ?`).get(id);
    if (!yaRetirado) return res.status(404).json({ error: "Pedido no encontrado" });
    if (yaRetirado.retiro_at != null && String(yaRetirado.retiro_at).trim() !== "") {
      return res.json({ ok: true, alreadyPickedUp: true, retiroAt: yaRetirado.retiro_at });
    }

    // El stock recién se descuenta acá, con el detalle final del remito. Si el
    // pedido todavía no fue contabilizado (supervisor), se valida y descuenta;
    // si falta stock, se bloquea el retiro y se avisa qué insumos no alcanzan.
    const contabilizado = cols.includes("contabilizado_at")
      ? db.prepare(`SELECT contabilizado_at FROM Pedidos WHERE ${idCol} = ?`).get(id)?.contabilizado_at
      : "ya"; // sin columna: asumimos contabilizado (comportamiento viejo)

    const retiroAt = new Date().toISOString();

    if (contabilizado == null) {
      const disc = applyOrderStockDiscount(Number(id));
      if (!disc.ok) {
        if (disc.faltantes) {
          return res.status(400).json({ error: "Stock insuficiente para retirar", faltantes: disc.faltantes });
        }
        return res.status(400).json({ error: disc.error || "No se pudo registrar el retiro" });
      }
      db.prepare(
        `UPDATE Pedidos SET retiro_at = ?, contabilizado_at = ? WHERE ${idCol} = ?`
      ).run(retiroAt, retiroAt, id);
    } else {
      db.prepare(
        `UPDATE Pedidos SET retiro_at = ? WHERE ${idCol} = ?`
      ).run(retiroAt, id);
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

    if (cols.includes("empresa_id")) {
      const empresaId = req.user?.empresaId ?? 1;
      const owner = db.prepare(`SELECT empresa_id FROM Pedidos WHERE ${idCol} = ?`).get(id);
      if (!owner || Number(owner.empresa_id) !== Number(empresaId)) return res.status(404).json({ error: "Pedido no encontrado" });
    }

    params.push(id);
    const r = db.prepare(`UPDATE Pedidos SET ${sets.join(", ")} WHERE ${idCol} = ?`).run(...params);
    if (r.changes === 0) return res.status(404).json({ error: "Pedido no encontrado" });
    if (action === "close") {
      try {
        const ped = db.prepare(`SELECT EmpleadoID, empresa_id FROM Pedidos WHERE ${idCol} = ?`).get(id);
        if (ped?.EmpleadoID) {
          db.prepare(
            "INSERT INTO notifications (empresa_id, empleado_id, tipo, titulo, cuerpo, link) VALUES (?, ?, 'pedido_listo', ?, ?, ?)"
          ).run(ped.empresa_id ?? null, ped.EmpleadoID, `Pedido #${String(id).padStart(7,"0")} listo para retiro`, "Tu pedido fue preparado y está listo para retirar.", "/app/supervisor/mis-pedidos");
        }
      } catch (e) { console.warn("[notif] close:", e?.message); }
    }
    res.json({ ok: true, id });

    // "Listo para retirar" NO manda mail: el supervisor se entera por la
    // notificación in-app (campana) creada arriba. Los únicos mails son los de
    // los pedidos (al crearse). Evita llenar la casilla de correos.
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

    const empresaId = getEmpresaId(req);
    const prodCols = db.prepare(`PRAGMA table_info(${products})`).all().map(c => c.name.toLowerCase());
    const empresaFilter = prodCols.includes("empresa_id") ? `AND empresa_id = @empresaId` : "";

    const sql = `
      SELECT ${prodId}   AS productId,
             ${prodName} AS name,
             ${prodCode ? prodCode : "NULL"} AS code,
             ${prodStock} AS stock
        FROM ${products}
       WHERE ${prodStock} IS NOT NULL
         AND CAST(${prodStock} AS REAL) <= CAST(@threshold AS REAL)
         ${empresaFilter}
       ORDER BY CAST(${prodStock} AS REAL) ASC,
                ${prodName} COLLATE NOCASE
       LIMIT 500
    `;

    const low = db
      .prepare(sql)
      .all({ threshold, empresaId })
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