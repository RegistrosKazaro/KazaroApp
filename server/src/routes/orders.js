// server/src/routes/orders.js
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  createOrder, getFullOrder, getEmployeeDisplayName,
  getServiceById, getServiceEmails, getServiceNameById,
  getBudgetSettingsByServiceId, DEFAULT_SERVICE_PCT,
  getUserRoles, listServicesByUser, getUserById, db,
} from "../db.js";
import { getWarehouseForChildService } from "../warehouses.js";
import { generateRemitoPDFBuffer } from "../utils/remitoPdf.js";
import { sendMail } from "../utils/mailer.js";
import { listEmpresas, getMailConfigValue } from "../utils/empresa.js";

// Mail que recibe copia de TODOS los pedidos de servicios hijos de un depósito.
const DEPOSITO_CC_FALLBACK = "gustavo.bacur@kazaro.com.ar";

const router = Router();
const pad7 = (n) => String(n ?? "").padStart(7, "0");

function sqlLocalToISO(sqlTs) {
  if (!sqlTs) return new Date().toISOString();
  try {
    const base = String(sqlTs).replace(" ", "T");
    const d = new Date(base + "-03:00");
    if (Number.isNaN(d.getTime())) return new Date().toISOString();
    return d.toISOString();
  } catch { return new Date().toISOString(); }
}

function primaryRole(userId) {
  const roles = (getUserRoles(userId) || []).map((r) => String(r).toLowerCase());
  if (roles.includes("supervisor")) return "supervisor";
  if (roles.includes("administrativo") || roles.includes("admin")) return "administrativo";
  return roles[0] || "administrativo";
}

function normalizeRoleName(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "supervisor") return "supervisor";
  if (s === "administrativo" || s === "admin") return "administrativo";
  return null;
}

function resolveServiceName(servicioId, hintedName) {
  if (hintedName && String(hintedName).trim()) return String(hintedName).trim();
  const sid = String(servicioId ?? "").trim();
  if (!sid) return "—";
  return getServiceNameById(sid) || getServiceById(sid)?.name || "—";
}

function resolveEmpresaNombre(empresaId) {
  if (!empresaId) return "Kazaro";
  try {
    return listEmpresas().find((e) => e.id === empresaId)?.nombre ?? "Kazaro";
  } catch { return "Kazaro"; }
}

router.post("/", requireAuth, async (req, res) => {
  try {
    const empleadoId    = req.user.id;
    const empresaId     = req.user.empresaId ?? null;
    const empresaNombre = resolveEmpresaNombre(empresaId);

    const asRoleClient = normalizeRoleName(req.body?.asRole ?? req.body?.rol);
    const rolEfectivo  = asRoleClient || primaryRole(empleadoId);

    let { servicioId = null, nota = "", items } = req.body || {};

    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: "Faltan items" });

    // No se puede mezclar productos de categoría "Uniformes" con otras categorías
    try {
      const productIds = items.map(it => Number(it.productId)).filter(Boolean);
      if (productIds.length > 0) {
        const placeholders = productIds.map(() => "?").join(",");
        const rows = db.prepare(`
          SELECT c.CategoriaNombre AS catName
          FROM Productos p
          LEFT JOIN Categorias c ON CAST(c.CategoriaID AS TEXT) = CAST(p.CategoriaID AS TEXT)
          WHERE p.ProductID IN (${placeholders})
        `).all(...productIds);
        const norm = s => String(s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
        const hasUni   = rows.some(r => norm(r.catName) === "uniformes");
        const hasOther = rows.some(r => norm(r.catName) !== "uniformes");
        if (hasUni && hasOther) {
          return res.status(400).json({
            error: "No se puede mezclar productos de la categoría \"Uniformes\" con otras categorías. Los uniformes deben pedirse por separado."
          });
        }
      }
    } catch (e) {
      console.warn("[orders] valid uniformes mix skipped:", e?.message || e);
    }

    if (rolEfectivo === "supervisor") {
      if (!servicioId) {
        const mios = listServicesByUser(empleadoId);
        if (Array.isArray(mios) && mios.length === 1) servicioId = mios[0].id;
      }
      if (!servicioId) {
        return res.status(400).json({ error: "servicioId es requerido para pedidos de supervisor" });
      }
    } else {
      servicioId = null;
    }

    let budgetSettings = { budget: null, maxPct: DEFAULT_SERVICE_PCT };
    let maxTotalAllowed = null;

    if (rolEfectivo === "supervisor" && servicioId) {
      budgetSettings = getBudgetSettingsByServiceId(servicioId) || budgetSettings;
      if (budgetSettings?.budget > 0) {
        const pct = Number(budgetSettings.maxPct ?? DEFAULT_SERVICE_PCT);
        if (Number.isFinite(pct) && pct > 0)
          maxTotalAllowed = (budgetSettings.budget * pct) / 100;
      }
    }

    const createRes = createOrder({ empleadoId, servicioId, nota, items, asRole: rolEfectivo, maxTotalAllowed });
    const pedidoId = createRes.pedidoId;
    const excedePresupuesto = createRes.excedePresupuesto;
    // Guardar rol y empresa en el pedido
    const hasEmpresaCol = db.prepare("PRAGMA table_info(Pedidos)").all().some((c) => c.name === "empresa_id");
    if (hasEmpresaCol && empresaId) {
      db.prepare("UPDATE Pedidos SET Rol = ?, empresa_id = ? WHERE PedidoID = ?").run(rolEfectivo, empresaId, Number(pedidoId));
    } else {
      db.prepare("UPDATE Pedidos SET Rol = ? WHERE PedidoID = ?").run(rolEfectivo, Number(pedidoId));
    }
    if (excedePresupuesto) {
      return res.json({ ok: true, pedidoId, pendienteAprobacion: true, message: "Pedido enviado. Excede el presupuesto y quedó pendiente de aprobación del depósito." });
    }

    const pedido = getFullOrder(pedidoId);
    if (!pedido) return res.status(500).json({ error: "No se pudo recuperar el pedido" });

    const nro            = pad7(pedidoId);
    const empleadoNombre = getEmployeeDisplayName(empleadoId) || `Empleado ${empleadoId}`;
    const usuario        = pedido.user || getUserById(empleadoId);
    const rol            = rolEfectivo;
    const sid            = rol === "supervisor" ? String(pedido.ServicioID ?? servicioId ?? "").trim() : "";
    const serviceName    = rol === "supervisor" ? resolveServiceName(sid, pedido?.servicio?.name) : "";
    const total          = Number(pedido.Total || 0);
    const notaFinal      = String(nota || pedido.Nota || "—");

    /* PDF */
    const pedidoParaPdf = {
      ...pedido, rol, empresaNombre,
      servicio: rol === "supervisor" ? { id: sid || null, name: serviceName } : null,
    };

    let buffer = null, filename = `remito_${nro}.pdf`;
    try {
      const out = await generateRemitoPDFBuffer({ pedido: pedidoParaPdf });
      buffer = out.buffer; filename = out.filename || filename;
    } catch (e) { console.warn("[orders] No se pudo generar PDF:", e?.message); }

/* MAIL */
    let mailStatus = { sent: false, skipped: true };
    try {
      const toArr = rol === "supervisor" && sid ? getServiceEmails(sid) || [] : [];

      // CC al depósito si el servicio es hijo de un warehouse (Kazaro).
      let ccArr = [];
      try {
        if (rol === "supervisor" && sid) {
          const warehouse = getWarehouseForChildService(sid);
          if (warehouse) ccArr = [getMailConfigValue(empresaId, "DEPOSITO_CC", DEPOSITO_CC_FALLBACK)];
        }
      } catch (e) {
        console.warn("[orders] warehouse CC check skipped:", e?.message || e);
      }

      // ¿El pedido tiene productos de categoría "Uniformes"? (solo Kazaro)
      let tieneUniformes = false;
      try {
        if (empresaId === 1) {
          const row = db.prepare(`
            SELECT 1
            FROM PedidoItems i
            JOIN Productos p ON CAST(p.ProductID AS TEXT) = CAST(i.ProductoID AS TEXT)
            JOIN Categorias c ON CAST(c.CategoriaID AS TEXT) = CAST(p.CategoriaID AS TEXT)
            WHERE i.PedidoID = ?
              AND lower(trim(c.CategoriaNombre)) = 'uniformes'
            LIMIT 1
          `).get(Number(pedidoId));
          tieneUniformes = !!row;
        }
      } catch (e) {
        console.warn("[orders] check uniformes skipped:", e?.message || e);
      }

      // Mail que siempre recibe los pedidos de Kazaro (con y sin uniformes)
      const NICOLAS = getMailConfigValue(empresaId, "MAIL_ALWAYS", "nicolas.barcena@kazaro.com.ar");
      const UNIFORMES_TO = getMailConfigValue(empresaId, "MAIL_UNIFORMES_TO", `eugenia.alvarez@kazaro.com.ar,${NICOLAS}`);

      const mailOpts = {
        cc: ccArr.length ? ccArr.join(",") : undefined,
        subject: tieneUniformes
          ? `NUEVO PEDIDO DE UNIFORMES #${nro}${serviceName ? ` — ${serviceName}` : ""}`
          : `NUEVO PEDIDO DE INSUMOS #${nro}${serviceName ? ` — ${serviceName}` : ""}`,
        text: `Pedido #${nro} generado.`,
        attachments: buffer ? [{ filename, content: buffer, contentType: "application/pdf" }] : undefined,
        displayAsUser: true,
        userName: empleadoNombre,
        userEmail: usuario?.email || null,
        empresaId,
        empresaNombre,
      };

      if (tieneUniformes) {
        // Canal exclusivo uniformes: solo eugenia + nicolas.barcena (no van los 4 normales).
        mailOpts.to = UNIFORMES_TO;
        mailOpts.overrideTo = true;
      } else if (empresaId === 1) {
        // Kazaro sin uniformes: los 4 del .env + nicolas.barcena.
        const baseTo = toArr.length ? [...toArr, NICOLAS] : [NICOLAS];
        mailOpts.to = baseTo.join(",");
      } else {
        // Pazar (u otras): igual que hoy.
        mailOpts.to = toArr.length ? toArr.join(",") : undefined;
      }

      const info = await sendMail(mailOpts);
      mailStatus = { sent: true, messageId: info?.messageId, uniformes: tieneUniformes };
    } catch (e) { mailStatus = { sent: false, error: e?.message }; }

    const pdfUrl = `/orders/pdf/${pedidoId}`;
    const remito = {
      numero: nro, fecha: sqlLocalToISO(pedido.Fecha),
      empleado: empleadoNombre, total, nota: notaFinal, pdfUrl,
      servicio: rol === "supervisor" ? { id: sid || null, name: serviceName } : null,
    };

    return res.status(201).json({ ok: true, pedidoId, remito, rol: rolEfectivo, mail: mailStatus });
  } catch (e) {
    console.error("[orders] POST / error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
});

router.get("/pdf/:id", requireAuth, async (req, res) => {
  const id     = Number(req.params.id);
  const pedido = getFullOrder(id);
  if (!pedido) return res.status(404).end();

  try {
    const rol  = String(pedido.Rol || "").toLowerCase();
    const sid  = rol === "supervisor" ? String(pedido.ServicioID ?? "").trim() : "";
    const serviceName = rol === "supervisor" ? resolveServiceName(sid, pedido?.servicio?.name) : "";

    let empresaNombre = "Kazaro";
    try {
      const row = db.prepare("SELECT empresa_id FROM Pedidos WHERE PedidoID = ? LIMIT 1").get(id);
      if (row?.empresa_id) empresaNombre = resolveEmpresaNombre(row.empresa_id);
    } catch {}

    const pedidoParaPdf = {
      ...pedido, rol, empresaNombre,
      servicio: rol === "supervisor" ? { id: sid || null, name: serviceName } : null,
    };

    const { filename, buffer } = await generateRemitoPDFBuffer({ pedido: pedidoParaPdf });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    return res.send(buffer);
  } catch (e) {
    console.error("[orders] GET /pdf/:id error:", e);
    return res.status(500).json({ error: "No se pudo generar el PDF" });
  }
});

// ─── Mis pedidos (supervisor) ────────────────────────────────────────────────
router.get("/mis-pedidos", requireAuth, async (req, res) => {
  try {
    const empleadoId = req.user.id;

    const pedidos = db.prepare(`
      SELECT
        p.PedidoID   AS id,
        p.EmpleadoID,
        p.Rol        AS rol,
        p.Nota       AS nota,
        p.Total      AS total,
        p.Fecha      AS fecha,
        p.ServicioID,
        COALESCE(p.Status, 'open') AS status
      FROM Pedidos p
      WHERE CAST(p.EmpleadoID AS TEXT) = CAST(? AS TEXT)
      ORDER BY p.PedidoID DESC
      LIMIT 100
    `).all(String(empleadoId));

    const result = pedidos.map(p => {
      const items = db.prepare(`
        SELECT
          ProductoID AS productId,
          Nombre     AS name,
          Precio     AS price,
          Cantidad   AS qty,
          Subtotal   AS subtotal,
          Codigo     AS code
        FROM PedidoItems
        WHERE PedidoID = ?
        ORDER BY PedidoItemID
      `).all(p.id);

      let servicioNombre = null;
      if (p.ServicioID) {
        try {
          const srv = db.prepare(
            `SELECT ServicioNombre AS name FROM Servicios WHERE CAST(ServiciosID AS TEXT) = CAST(? AS TEXT) LIMIT 1`
          ).get(p.ServicioID);
          servicioNombre = srv?.name || null;
        } catch {}
      }

      return { ...p, items, servicioNombre };
    });

    return res.json(result);
  } catch (e) {
    console.error("[orders] GET /mis-pedidos error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
});
router.get("/templates", requireAuth, (req, res) => {
  const rows = db.prepare(
    "SELECT id, nombre, items_json, created_at FROM order_templates WHERE empleado_id = ? AND (empresa_id = ? OR empresa_id IS NULL) ORDER BY id DESC"
  ).all(req.user.id, req.user.empresaId ?? null);
  res.json(rows.map(r => ({ id: r.id, nombre: r.nombre, items: JSON.parse(r.items_json), created_at: r.created_at })));
});

// Crear plantilla
router.post("/templates", requireAuth, (req, res) => {
  const { nombre, items } = req.body || {};
  if (!nombre || !Array.isArray(items) || !items.length)
    return res.status(400).json({ error: "Faltan nombre o items" });
  const info = db.prepare(
    "INSERT INTO order_templates (empresa_id, empleado_id, nombre, items_json) VALUES (?, ?, ?, ?)"
  ).run(req.user.empresaId ?? null, req.user.id, String(nombre).trim(), JSON.stringify(items));
  res.json({ ok: true, id: info.lastInsertRowid });
});

// Borrar plantilla
router.delete("/templates/:id", requireAuth, (req, res) => {
  db.prepare("DELETE FROM order_templates WHERE id = ? AND empleado_id = ?").run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});
router.get("/notifications", requireAuth, (req, res) => {
  const rows = db.prepare(
    "SELECT id, tipo, titulo, cuerpo, leida, link, created_at FROM notifications WHERE empleado_id = ? ORDER BY id DESC LIMIT 50"
  ).all(req.user.id);
  const unread = rows.filter(r => !r.leida).length;
  res.json({ rows, unread });
});

router.put("/notifications/:id/read", requireAuth, (req, res) => {
  db.prepare("UPDATE notifications SET leida = 1 WHERE id = ? AND empleado_id = ?").run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

router.put("/notifications/read-all", requireAuth, (req, res) => {
  db.prepare("UPDATE notifications SET leida = 1 WHERE empleado_id = ?").run(req.user.id);
  res.json({ ok: true });
});
router.get("/:id/returnable", requireAuth, (req, res) => {
  try {
    const pedidoId = Number(req.params.id);
    const items = db.prepare(`SELECT ProductoID AS productId, Nombre AS name, Codigo AS code, SUM(Cantidad) AS pedido FROM PedidoItems WHERE PedidoID = ? GROUP BY ProductoID, Nombre, Codigo`).all(pedidoId);
    const dev = db.prepare(`SELECT producto_id, SUM(cantidad) AS devuelto FROM devoluciones WHERE pedido_id = ? AND estado IN ('pendiente','aprobada') GROUP BY producto_id`).all(pedidoId);
    const devMap = new Map(dev.map((d) => [String(d.producto_id), d.devuelto]));
    const rows = items.map((it) => {
      const devuelto = Number(devMap.get(String(it.productId)) || 0);
      return { ...it, pedido: Number(it.pedido), devuelto, disponible: Math.max(0, Number(it.pedido) - devuelto) };
    });
    res.json({ ok: true, items: rows });
  } catch (e) {
    console.error("[returnable]", e?.message || e);
    res.status(500).json({ error: "No se pudo cargar el pedido" });
  }
});

// Crear solicitud de devolución (supervisor) — NO toca stock
router.post("/returns", requireAuth, (req, res) => {
  try {
    const { pedidoId, productoId, cantidad, motivo } = req.body || {};
    const pid = Number(pedidoId), prod = Number(productoId), cant = Math.trunc(Number(cantidad));
    if (!pid || !prod || !Number.isFinite(cant) || cant <= 0) return res.status(400).json({ error: "Datos inválidos" });
    if (!String(motivo || "").trim()) return res.status(400).json({ error: "El motivo es obligatorio" });

    const pedItem = db.prepare(`SELECT SUM(Cantidad) AS pedido FROM PedidoItems WHERE PedidoID = ? AND ProductoID = ?`).get(pid, prod);
    const yaDev = db.prepare(`SELECT SUM(cantidad) AS d FROM devoluciones WHERE pedido_id = ? AND producto_id = ? AND estado IN ('pendiente','aprobada')`).get(pid, prod);
    const disponible = Number(pedItem?.pedido || 0) - Number(yaDev?.d || 0);
    if (cant > disponible) return res.status(400).json({ error: `Solo se pueden devolver ${disponible} unidades` });

    const empresaId = req.user?.empresaId ?? null;
    db.prepare(`INSERT INTO devoluciones (pedido_id, producto_id, cantidad, motivo, empresa_id, solicitante_id, estado) VALUES (?, ?, ?, ?, ?, ?, 'pendiente')`)
      .run(pid, prod, cant, String(motivo).trim(), empresaId, req.user.id);
    res.json({ ok: true });
  } catch (e) {
    console.error("[returns POST]", e?.message || e);
    res.status(500).json({ error: "No se pudo registrar la devolución" });
  }
});

// Listar devoluciones (depósito) — filtro por estado
router.get("/returns", requireAuth, (req, res) => {
  try {
    const estado = String(req.query.estado || "").trim();
    const empresaId = req.user?.empresaId ?? null;
    let sql = `SELECT d.*, p.ProductName AS producto_nombre FROM devoluciones d LEFT JOIN Productos p ON p.ProductID = d.producto_id WHERE (d.empresa_id = ? OR d.empresa_id IS NULL)`;
    const params = [empresaId];
    if (estado) { sql += ` AND d.estado = ?`; params.push(estado); }
    sql += ` ORDER BY d.id DESC LIMIT 500`;
    res.json({ ok: true, rows: db.prepare(sql).all(...params) });
  } catch (e) {
    console.error("[returns GET]", e?.message || e);
    res.status(500).json({ error: "No se pudieron cargar las devoluciones" });
  }
});

// Aprobar devolución (depósito) — suma stock
router.put("/returns/:id/approve", requireAuth, (req, res) => {
  try {
    const id = Number(req.params.id);
    const d = db.prepare(`SELECT * FROM devoluciones WHERE id = ?`).get(id);
    if (!d) return res.status(404).json({ error: "Devolución no encontrada" });
    if (d.estado !== "pendiente") return res.status(400).json({ error: "Ya fue resuelta" });

    const prod = db.prepare(`SELECT Stock FROM Productos WHERE ProductID = ?`).get(d.producto_id);
    const nuevo = Number(prod?.Stock || 0) + Number(d.cantidad);
    db.prepare(`UPDATE Productos SET Stock = ? WHERE ProductID = ?`).run(nuevo, d.producto_id);
    db.prepare(`UPDATE devoluciones SET estado = 'aprobada', aprobador_id = ?, fecha_resolucion = datetime('now') WHERE id = ?`).run(req.user.id, id);
    res.json({ ok: true, nuevoStock: nuevo });
  } catch (e) {
    console.error("[returns approve]", e?.message || e);
    res.status(500).json({ error: "No se pudo aprobar" });
  }
});

// Rechazar devolución (depósito)
router.put("/returns/:id/reject", requireAuth, (req, res) => {
  try {
    const id = Number(req.params.id);
    const d = db.prepare(`SELECT estado FROM devoluciones WHERE id = ?`).get(id);
    if (!d) return res.status(404).json({ error: "No encontrada" });
    if (d.estado !== "pendiente") return res.status(400).json({ error: "Ya fue resuelta" });
    db.prepare(`UPDATE devoluciones SET estado = 'rechazada', aprobador_id = ?, fecha_resolucion = datetime('now') WHERE id = ?`).run(req.user.id, id);
    res.json({ ok: true });
  } catch (e) {
    console.error("[returns reject]", e?.message || e);
    res.status(500).json({ error: "No se pudo rechazar" });
  }
});
export default router;



