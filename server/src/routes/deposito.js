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
  applyOrderStockDelta,
  snapshotDespacho,
  registrarEntregaPendientes,
} from "../db.js";
import { sendMail } from "../utils/mailer.js";
import { fmtAr, ahoraUtcSql } from "../utils/fechas.js";
import { sinAcentosSql, normalizarBusqueda } from "../utils/busqueda.js";

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
// Aviso de "listo para retirar": va ÚNICAMENTE al supervisor que hizo el pedido
// (además de la notificación in-app). Sin copias a nadie más.
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

    // Pazar (empresa 2) carga emails de usuario de relleno (no válidos), así que
    // el aviso rebotaría. No mandamos mail: el supervisor de Pazar se entera por
    // la notificación in-app (campana), que se crea aparte al cerrar el pedido.
    if (Number(empresaId) === 2) {
      console.log(`[deposito] Pazar: "listo para retirar" sin mail (solo campana) — pedido #${pad7(pedido.id)}`);
      return;
    }

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

    // El aviso de "listo para retirar" va ÚNICAMENTE al supervisor que hizo el
    // pedido. exclusive ignora los destinatarios globales (MAIL_TO/CC/BCC), que
    // si no le harían llegar el mail a otras casillas igual.
    await sendMail({
      to: supervisorEmail,
      exclusive: true,
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
                   ProductoID AS productoId,
                   Nombre    AS nombre,
                   ${hasCodigo ? "Codigo AS codigo," : "NULL AS codigo,"}
                   Cantidad  AS cantidad,
                   COALESCE(cantidad_pendiente,0) AS pendiente,
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
            const cantidad = Number(item.cantidad || 0);
            const pendiente = Number(item.pendiente || 0);
            itemsMap[pid].push({
              productId: Number(item.productoId) || null,
              nombre: item.nombre || "—",
              codigo: item.codigo || "",
              cantidad,
              // Cuánto de esta línea todavía no salió, y cuánto sí se entrega.
              pendiente,
              entregado: Math.max(0, cantidad - pendiente),
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

      // Si el pedido se despachó incompleto, esta tarjeta muestra SOLO lo que
      // sale: lo pendiente vive en su propia tarjeta y no se repite acá. Un
      // insumo del que no sale nada directamente no aparece.
      const todosLosItems = itemsMap[String(id)] || [];
      const pendienteActivo = !!String(row.pendiente_status || "").trim();
      const itemsEntrega = pendienteActivo
        ? todosLosItems
          .filter((i) => i.entregado > 0)
          .map((i) => ({ ...i, cantidad: i.entregado, subtotal: i.precio * i.entregado }))
        : todosLosItems;

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
        // Con pendientes, el total de la tarjeta es el de lo que se entrega:
        // así las dos tarjetas suman el pedido y no se duplica nada.
        total: pendienteActivo
          ? itemsEntrega.reduce((s, i) => s + i.subtotal, 0)
          : getVal(row, ["total", "amount"]),
        totalPedido: getVal(row, ["total", "amount"]),
        status: finalStatus,
        isClosed,
        remito: remitoNumero,
        remitoDisplay: remitoNumero ? String(remitoNumero) : "-",
        items: itemsEntrega,
        // El editor necesita el pedido completo, aunque en pantalla se muestre
        // sólo la parte que se entrega.
        itemsTodos: todosLosItems,
      };
    });

    // ── Tarjetas de PENDIENTES ──────────────────────────────────────────────
    // Cuando un pedido se despacha incompleto, lo que quedó recorre las solapas
    // por su cuenta, como una tarjeta más. No es un pedido nuevo: conserva el
    // número y el remito del original, y al entregarse se suma a ese mismo
    // pedido. Es interno del depósito: el supervisor no lo ve aparte.
    const pendientesRows = [];
    for (const row of rawOrders) {
      const estadoPend = String(row.pendiente_status || "").toLowerCase();
      if (!estadoPend) continue;
      const id = getVal(row, ["pedidoid", "id", "idpedido", "pedido_id"]) ?? row.__rowid;
      const items = (itemsMap[String(id)] || []).filter((i) => i.pendiente > 0);
      if (!items.length) continue;

      const base = cleanRows.find((c) => String(c.id) === String(id));
      pendientesRows.push({
        ...base,
        // Clave propia: la tarjeta convive con el pedido original en la lista.
        key: `${id}-pendiente`,
        esPendiente: true,
        pedidoOrigenId: id,
        // Se muestran las unidades que faltan entregar, no las originales.
        items: items.map((i) => ({ ...i, cantidad: i.pendiente, subtotal: i.precio * i.pendiente })),
        itemsTodos: items.map((i) => ({ ...i, cantidad: i.pendiente, subtotal: i.precio * i.pendiente })),
        total: items.reduce((s, i) => s + i.precio * i.pendiente, 0),
        status: estadoPend === "closed" ? "closed" : (estadoPend === "preparing" ? "preparing" : "open"),
        closedAt: row.pendiente_closedat || null,
        retiroAt: row.pendiente_retiro_at || null,
        isClosed: estadoPend === "closed",
      });
    }

    const statusParam = String(req.query.status || "open").toLowerCase();
    const todas = [...cleanRows.map((o) => ({ ...o, key: String(o.id) })), ...pendientesRows];
    const filtered = todas.filter(o => {
      // El pedido original, una vez despachado, no vuelve a aparecer por sus
      // pendientes: para eso está la tarjeta aparte.
      if (o.esPendiente) {
        if (statusParam === "revision_deposito") return false;
        if (statusParam === "retirado") return o.status === "closed" && !!o.retiroAt;
        if (statusParam === "closed") return o.status === "closed" && !o.retiroAt;
        return o.status === statusParam;
      }
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

/* ===================== Control de despachos =====================
   Salidas del depósito para cruzar contra Flexxus. Se toman los pedidos desde
   que se marcan LISTOS PARA RETIRAR: ese es el momento en que se genera el
   movimiento en el ERP, así que es la fecha que tiene que coincidir.
   Las cantidades salen de v_pedido_items_neto, o sea netas de devoluciones
   aprobadas. Por ahora la comparación con Flexxus se hace a mano, con el CSV.
================================================================== */
/**
 * Red de seguridad: si algún pedido ya despachado quedó sin foto (por ejemplo
 * porque se cerró con una versión anterior), se le genera al vuelo. Así no puede
 * pasar que un pedido marcado listo para retirar no aparezca en el control.
 */
function repararFotosFaltantes(empresaId) {
  try {
    const faltan = db.prepare(`
      SELECT p.PedidoID AS id,
             COALESCE(NULLIF(TRIM(p.closedat),''), NULLIF(TRIM(p.retiro_at),''), p.Fecha) AS fecha
      FROM Pedidos p
      WHERE p.deleted_at IS NULL AND p.empresa_id = ?
        AND (
          (p.closedat IS NOT NULL AND TRIM(p.closedat) <> '')
          OR (p.retiro_at IS NOT NULL AND TRIM(p.retiro_at) <> '')
          OR LOWER(COALESCE(p.Status,'')) IN ('closed','retirado')
        )
        AND NOT EXISTS (SELECT 1 FROM pedido_despacho d WHERE d.pedido_id = p.PedidoID)
    `).all(Number(empresaId));
    for (const f of faltan) {
      try { snapshotDespacho(f.id, f.fecha); } catch { /* sigue con los demás */ }
    }
    if (faltan.length) console.log(`[deposito] Foto de despacho generada al vuelo para ${faltan.length} pedidos`);
  } catch (e) {
    console.warn("[deposito] repararFotosFaltantes:", e?.message || e);
  }
}

/* ============ Recorrido de la parte pendiente ============
   Lo que quedó pendiente avanza por las mismas etapas que un pedido, pero sin
   ser un pedido nuevo: es el mismo, con el mismo remito. Al marcarlo listo para
   retirar queda el movimiento para la conciliación; al retirarlo se descuenta
   el stock y recién ahí suma en los informes.
=========================================================== */
router.put("/orders/:id/pendiente/:action", mustWarehouse, (req, res) => {
  try {
    const id = Number(req.params.id);
    const action = String(req.params.action || "").toLowerCase();
    const empresaId = getEmpresaId(req);

    const ped = db.prepare(
      `SELECT PedidoID, empresa_id, pendiente_status FROM Pedidos WHERE PedidoID = ?`
    ).get(id);
    if (!ped) return res.status(404).json({ error: "Pedido no encontrado" });
    if (ped.empresa_id != null && Number(ped.empresa_id) !== Number(empresaId)) {
      return res.status(404).json({ error: "Pedido no encontrado" });
    }

    const pendientes = db.prepare(
      `SELECT ProductoID AS pid, MAX(Nombre) AS nombre, COALESCE(SUM(cantidad_pendiente),0) AS pend
       FROM PedidoItems WHERE PedidoID = ? GROUP BY ProductoID HAVING pend > 0`
    ).all(id);
    if (!pendientes.length) return res.status(400).json({ error: "Este pedido no tiene pendientes" });

    const ahora = ahoraUtcSql();

    if (action === "prepare") {
      db.prepare(`UPDATE Pedidos SET pendiente_status='preparing', pendiente_closedat=NULL WHERE PedidoID=?`).run(id);
      return res.json({ ok: true, estado: "preparing" });
    }

    if (action === "reopen") {
      db.prepare(
        `UPDATE Pedidos SET pendiente_status='open', pendiente_closedat=NULL, pendiente_retiro_at=NULL WHERE PedidoID=?`
      ).run(id);
      return res.json({ ok: true, estado: "open" });
    }

    if (action === "close") {
      // Queda el movimiento de esta entrega para el control de despachos.
      const entregados = pendientes.map((p) => ({ productId: Number(p.pid), cantidad: Number(p.pend) }));
      const r = registrarEntregaPendientes(id, entregados, { bajarPendiente: false, fecha: ahora });
      if (!r.ok) return res.status(400).json({ error: r.error || "No se pudo registrar la entrega" });
      db.prepare(`UPDATE Pedidos SET pendiente_status='closed', pendiente_closedat=? WHERE PedidoID=?`).run(ahora, id);
      return res.json({ ok: true, estado: "closed", entrega: r.entrega });
    }

    if (action === "pickup") {
      if (String(ped.pendiente_status || "").toLowerCase() !== "closed") {
        return res.status(400).json({ error: "Primero marcalo como listo para retirar" });
      }
      // Recién al retirarse se descuenta el stock y se limpia el pendiente,
      // que es cuando el material efectivamente salió.
      const deltas = pendientes.map((p) => ({
        productId: Number(p.pid), delta: Number(p.pend), nombre: p.nombre,
      }));
      const st = applyOrderStockDelta(id, deltas, { permitirNegativo: false });
      if (!st.ok) {
        return res.status(400).json({
          error: "No hay stock suficiente para entregar esos pendientes",
          faltantes: st.faltantes || null,
        });
      }
      db.prepare(`UPDATE PedidoItems SET cantidad_pendiente = 0 WHERE PedidoID = ?`).run(id);
      db.prepare(`UPDATE Pedidos SET pendiente_status='closed', pendiente_retiro_at=? WHERE PedidoID=?`).run(ahora, id);
      return res.json({ ok: true, estado: "retirado" });
    }

    return res.status(400).json({ error: "Acción inválida" });
  } catch (e) {
    console.error("[deposito/pendiente]", e.message);
    res.status(500).json({ error: "No se pudo actualizar el pendiente" });
  }
});

router.get("/despachos", mustWarehouse, (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    repararFotosFaltantes(empresaId);

    // Se lee de la FOTO del despacho: el detalle tal como estaba cuando el
    // pedido se marcó listo para retirar. Es lo que quedó en Flexxus, así que
    // no cambia aunque después se edite el pedido.
    const dia = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim()) ? String(v).trim() : null);
    const desde = dia(req.query.desde);
    const hasta = dia(req.query.hasta);
    // Las fechas viejas se guardaron con formato ISO ("...T12:00:00.000Z") y las
    // nuevas con el de la base ("... 12:00:00"). Al comparar como texto la "T"
    // queda DESPUÉS del espacio, así que un pedido cerrado de noche se salía del
    // rango del día. Se normaliza la columna antes de comparar.
    // Se usa la fecha de CADA ÍTEM: un pedido despachado en dos tandas tiene
    // dos fechas distintas, y en Flexxus son dos movimientos separados.
    // Los ítems viejos sin fecha propia caen a la del pedido.
    const FECHA_CMP = `REPLACE(SUBSTR(COALESCE(i.fecha_despacho, d.fecha_despacho),1,19),'T',' ')`;
    // La empresa se toma del PEDIDO, no de la foto: si una foto vieja quedó sin
    // empresa_id, el pedido igual se sigue viendo.
    const cond = ["COALESCE(p.empresa_id, d.empresa_id) = @empresaId", "p.deleted_at IS NULL"];
    const params = { empresaId };
    if (desde) { cond.push(`${FECHA_CMP} >= @desdeUtc`); params.desdeUtc = `${desde} 03:00:00`; }
    if (hasta) {
      const dd = new Date(`${hasta}T00:00:00Z`); dd.setUTCDate(dd.getUTCDate() + 1);
      cond.push(`${FECHA_CMP} < @hastaUtc`); params.hastaUtc = `${dd.toISOString().slice(0, 10)} 03:00:00`;
    }
    const where = `WHERE ${cond.join(" AND ")}`;
    const FROM = `FROM pedido_despacho d
      JOIN pedido_despacho_items i ON i.pedido_id = d.pedido_id
      JOIN Pedidos p ON p.PedidoID = d.pedido_id`;

    // Totales por artículo
    const articulos = db.prepare(`
      SELECT i.producto_id AS productId,
             COALESCE(NULLIF(TRIM(MAX(i.codigo)),''),'') AS codigo,
             COALESCE(NULLIF(TRIM(MAX(i.nombre)),''),'Sin nombre') AS nombre,
             COUNT(DISTINCT d.pedido_id) AS pedidos,
             COALESCE(SUM(i.cantidad),0) AS unidades,
             COALESCE(SUM(i.subtotal),0) AS monto
      ${FROM} ${where}
      GROUP BY i.producto_id
      HAVING unidades > 0
      ORDER BY unidades DESC, nombre COLLATE NOCASE
    `).all(params).map((r) => ({
      productId: Number(r.productId || 0), codigo: r.codigo, nombre: r.nombre,
      pedidos: Number(r.pedidos || 0), unidades: Number(r.unidades || 0), monto: Number(r.monto || 0),
    }));

    // Detalle de un artículo: UNA fila por pedido. Si un servicio pidió dos
    // veces, aparecen las dos, sin sumarse. Se ordena por FECHA (cuándo quedó
    // listo para retirar), no por cantidad.
    let detalle = [];
    const productId = Number(req.query.productId);
    if (Number.isFinite(productId) && productId > 0) {
      const orden = String(req.query.orden || "").toLowerCase() === "fecha_asc"
        ? `${FECHA_CMP} ASC, d.pedido_id ASC`
        : `${FECHA_CMP} DESC, d.pedido_id DESC`;

      detalle = db.prepare(`
        SELECT d.pedido_id AS pedidoId, d.servicio_id AS servicioId, d.rol AS rol,
               d.empleado_id AS empleadoId, i.cantidad AS cantidad,
               COALESCE(i.cantidad_inicial, i.cantidad) AS cantidadInicial,
               i.subtotal AS subtotal,
               COALESCE(i.fecha_despacho, d.fecha_despacho) AS fechaDespacho,
               i.numero AS entrega
        ${FROM} ${where} AND i.producto_id = @productId
        ORDER BY ${orden}
      `).all({ ...params, productId }).map((r) => {
        const cantidad = Number(r.cantidad || 0);
        const inicial = Number(r.cantidadInicial || 0);
        return {
          pedidoId: r.pedidoId,
          numero: pad7(r.pedidoId),
          // Número de entrega: 1 es el despacho original, 2+ son pendientes
          // entregados después sobre el mismo remito.
          entrega: Number(r.entrega || 1),
          servicio: r.servicioId ? (getServiceNameById(r.servicioId) || `Servicio ${r.servicioId}`) : null,
          rol: r.rol || null,
          solicitante: r.empleadoId ? (getEmployeeDisplayName(r.empleadoId) || null) : null,
          cantidad,
          // Lo que se había registrado al despachar, si después se corrigió.
          cantidadInicial: inicial,
          corregido: inicial !== cantidad,
          subtotal: Number(r.subtotal || 0),
          retiradoAr: r.fechaDespacho ? fmtAr(r.fechaDespacho) : null,
        };
      });
    }

    res.json({
      ok: true,
      periodo: { desde: desde || null, hasta: hasta || null },
      totales: {
        articulos: articulos.length,
        unidades: articulos.reduce((a, x) => a + x.unidades, 0),
        pedidos: db.prepare(`SELECT COUNT(DISTINCT d.pedido_id) AS n ${FROM} ${where}`).get(params).n,
      },
      articulos,
      detalle,
    });
  } catch (e) {
    console.error("[deposito/despachos]", e?.message || e);
    res.status(500).json({ error: "No se pudieron cargar los despachos" });
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
    // Sin acentos y sin importar mayúsculas, igual que el resto de la app.
    const like = `%${normalizarBusqueda(q)}%`;
    if (prodCode) {
      where.push(`(${sinAcentosSql(prodName)} LIKE ? OR ${sinAcentosSql(prodCode)} LIKE ?)`);
      params.push(like, like);
    } else {
      where.push(`${sinAcentosSql(prodName)} LIKE ?`);
      params.push(like);
    }

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
  const p = db.prepare(
    `SELECT PedidoID, empresa_id, Status, Rol, retiro_at, contabilizado_at FROM Pedidos WHERE PedidoID = ?`
  ).get(id);
  if (!p) return { error: 404 };
  if (p.empresa_id != null && Number(p.empresa_id) !== Number(empresaId)) return { error: 404 };
  // Editable en cualquier etapa, incluso ya retirado: el depósito necesita poder
  // corregir errores detectados después. Si el pedido ya descontó stock, el
  // endpoint ajusta la diferencia con applyOrderStockDelta. La conciliación NO
  // cambia: usa la foto tomada al marcarlo listo para retirar.
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
      // Cuánto de esa línea NO se despacha ahora y queda esperando stock.
      const pendiente = Math.min(cantidad, Math.max(0, Math.trunc(Number(it.pendiente ?? 0))));
      const precio = Number(row.price || 0);
      const subtotal = precio * cantidad;
      total += subtotal;
      filas.push({ pid, name: row.name, precio, cantidad, pendiente, subtotal, code: row.code || "" });
    }

    // Si el pedido YA descontó stock (administrativos, que descuentan al crearse,
    // o supervisores ya retirados), hay que ajustar la DIFERENCIA: devolver lo
    // que se saca y descontar lo que se agrega. Si no alcanza, no se guarda nada.
    const yaDescontado = chk.pedido?.contabilizado_at != null
      && String(chk.pedido.contabilizado_at).trim() !== "";

    // ¿El pedido ya se despachó (se marcó listo para retirar)? Si es así, esta
    // edición es una CORRECCIÓN de lo que realmente salió: se aplica aunque el
    // stock no alcance (el material ya salió) y se regraba la foto.
    const yaDespachado = !!db.prepare(`SELECT 1 FROM pedido_despacho WHERE pedido_id = ?`).get(id);
    let descubierto = null;

    if (yaDescontado) {
      // El stock sólo refleja lo ENTREGADO: se compara cantidad menos pendiente
      // de los dos lados, así marcar algo como pendiente devuelve ese stock.
      const previos = db.prepare(
        `SELECT ProductoID AS pid,
                COALESCE(SUM(Cantidad),0) - COALESCE(SUM(cantidad_pendiente),0) AS cant,
                MAX(Nombre) AS nombre
         FROM PedidoItems WHERE PedidoID = ? GROUP BY ProductoID`
      ).all(id);
      const antes = new Map(previos.map((r) => [Number(r.pid), { cant: Number(r.cant || 0), nombre: r.nombre }]));
      const ahora = new Map();
      for (const f of filas) ahora.set(f.pid, (ahora.get(f.pid) || 0) + (f.cantidad - f.pendiente));

      const deltas = [];
      for (const [pid, info] of antes) {
        const nueva = ahora.get(pid) || 0;
        if (nueva !== info.cant) deltas.push({ productId: pid, delta: nueva - info.cant, nombre: info.nombre });
      }
      for (const [pid, cant] of ahora) {
        if (!antes.has(pid)) deltas.push({ productId: pid, delta: cant, nombre: filas.find((f) => f.pid === pid)?.name });
      }

      const r = applyOrderStockDelta(id, deltas, { permitirNegativo: yaDespachado });
      if (!r.ok) {
        if (r.faltantes) {
          return res.status(400).json({
            error: "No hay stock suficiente para aumentar esas cantidades",
            faltantes: r.faltantes,
          });
        }
        return res.status(400).json({ error: r.error || "No se pudo ajustar el stock" });
      }
      descubierto = r.descubierto || null;
    }

    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM PedidoItems WHERE PedidoID = ?`).run(id);
      const ins = db.prepare(`INSERT INTO PedidoItems (PedidoID, ProductoID, Nombre, Precio, Cantidad, Subtotal, Codigo, cantidad_pendiente) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const f of filas) ins.run(id, f.pid, f.name, f.precio, f.cantidad, f.subtotal, f.code, f.pendiente);
      db.prepare(`UPDATE Pedidos SET Total = ? WHERE PedidoID = ?`).run(total, id);
    });
    tx();

    // La corrección de un pedido ya despachado es lo que realmente salió:
    // se regraba la foto (conservando la fecha y la cantidad original).
    if (yaDespachado) {
      try { snapshotDespacho(id); }
      catch (e) { console.warn("[deposito] resnapshot:", e?.message || e); }
    }

    res.json({
      ok: true, total, items: filas.length,
      stockAjustado: yaDescontado,
      conciliacionActualizada: yaDespachado,
      descubierto,
    });
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

    const retiroAt = ahoraUtcSql();

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
      closedAt = ahoraUtcSql();
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
      // Foto del despacho: el detalle exacto de este momento, que es el que
      // quedó como movimiento en Flexxus. La conciliación lee de acá.
      try { snapshotDespacho(id); }
      catch (e) { console.warn("[deposito] snapshotDespacho:", e?.message || e); }

      // Si el pedido se despachó incompleto, lo que quedó arranca su propio
      // recorrido en la solapa Pendientes, con el mismo remito.
      try {
        const pend = db.prepare(
          `SELECT COALESCE(SUM(cantidad_pendiente),0) AS n FROM PedidoItems WHERE PedidoID = ?`
        ).get(id).n;
        if (Number(pend) > 0) {
          db.prepare(
            `UPDATE Pedidos SET pendiente_status = 'open'
             WHERE PedidoID = ? AND COALESCE(NULLIF(TRIM(pendiente_status),''), '') = ''`
          ).run(id);
        }
      } catch (e) { console.warn("[deposito] inicio pendiente:", e?.message || e); }

      try {
        const ped = db.prepare(`SELECT EmpleadoID, empresa_id FROM Pedidos WHERE ${idCol} = ?`).get(id);
        if (ped?.EmpleadoID) {
          db.prepare(
            "INSERT INTO notifications (empresa_id, empleado_id, tipo, titulo, cuerpo, link) VALUES (?, ?, 'pedido_listo', ?, ?, ?)"
          ).run(ped.empresa_id ?? null, ped.EmpleadoID, `Pedido #${String(id).padStart(7,"0")} listo para retiro`, "Tu pedido fue preparado y está listo para retirar.", "/app/supervisor/mis-pedidos");
        }
      } catch (e) { console.warn("[notif] close:", e?.message); }

      // Además del aviso in-app, mandar el mail SOLO al supervisor del pedido.
      // No bloquea la respuesta (se envía en segundo plano).
      notifyOrderReady(id, closedAt).catch((e) => console.warn("[deposito] notifyOrderReady:", e?.message || e));
    }
    res.json({ ok: true, id });
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