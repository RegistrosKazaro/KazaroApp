import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  createOrder,
  getFullOrder,
  getEmployeeDisplayName,
  getServiceById,
  getServiceEmails,
  getServiceNameById,
  getBudgetByServiceId,
  getUserRoles,
  listServicesByUser,
  getUserById,
  db,
} from "../db.js";
import { generateRemitoPDF } from "../utils/remitoPdf.js";
import { sendMail } from "../utils/mailer.js";
import path from "path";
import fs from "fs";

const router = Router();

/* ===== Helpers ===== */
const pad7 = (n) => String(n ?? "").padStart(7, "0");
const money = (v) => {
  const n = Number(v || 0);
  try { return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n); }
  catch { return `$ ${n.toFixed(2)}`; }
};
function fmtLocal(sqlTs) {
  if (!sqlTs) return "";
  try {
    const d = new Date(String(sqlTs).replace(" ", "T") + "Z"); // DB→UTC, muestro local
    return d.toLocaleString("es-AR", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return String(sqlTs); }
}
function primaryRole(userId) {
  const roles = (getUserRoles(userId) || []).map(r => String(r).toLowerCase());
  if (roles.includes("supervisor")) return "supervisor";
  if (roles.includes("administrativo") || roles.includes("admin")) return "administrativo";
  return roles[0] || "administrativo";
}
function resolveServiceName(servicioId, hintedName) {
  if (hintedName && String(hintedName).trim()) return String(hintedName).trim();
  const sid = String(servicioId ?? "").trim();
  if (!sid) return "—";
  return getServiceNameById(sid) || getServiceById(sid)?.name || "—";
}

/* ===== Rutas ===== */
router.post("/", requireAuth, async (req, res) => {
  try {
    const empleadoId = req.user.id;
    let { servicioId = null, nota = "", items, rol: rolFromClient } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Faltan items" });
    }

    // Si no vino servicioId y el usuario tiene exactamente 1 servicio, usarlo
    if (servicioId == null || String(servicioId).trim() === "") {
      const mios = listServicesByUser(empleadoId);
      if (Array.isArray(mios) && mios.length === 1) servicioId = mios[0].id;
    }

    // Crear pedido
    const pedidoId = createOrder({ empleadoId, servicioId, nota, items });

    // Si el front indicó rol explícito, lo fuerzo
    if (rolFromClient && String(rolFromClient).trim()) {
      db.prepare(`UPDATE Pedidos SET Rol = ? WHERE PedidoID = ?`)
        .run(String(rolFromClient).trim(), Number(pedidoId));
    }

    // Leer el pedido persistido
    const pedido = getFullOrder(pedidoId);
    if (!pedido) return res.status(500).json({ error: "No se pudo recuperar el pedido" });

    // Datos base
    const nro = pad7(pedidoId);
    const empleadoNombre = getEmployeeDisplayName(empleadoId) || `Empleado ${empleadoId}`;
    const usuario = pedido.user || getUserById(empleadoId); // incluye email si existe
    const rolGuardado = String(pedido.Rol || "").trim().toLowerCase();
    const rol = rolGuardado || (rolFromClient ? String(rolFromClient).trim().toLowerCase() : primaryRole(empleadoId));

    // Servicio
    let sid = String(pedido.ServicioID ?? servicioId ?? "").trim();
    if (!sid) {
      const mios = listServicesByUser(empleadoId);
      if (Array.isArray(mios) && mios.length === 1) sid = String(mios[0].id);
    }
    const serviceName = resolveServiceName(sid, pedido?.servicio?.name);

    const total      = Number(pedido.Total || 0);
    const fechaLocal = fmtLocal(pedido.Fecha);
    const notaFinal  = String(nota || pedido.Nota || "—");

    // Generar PDF con servicio/rol correctos
    let pdfPath = null;
    try {
      const pedidoParaPdf = {
        ...pedido,
        rol,
        servicio: { id: sid || null, name: serviceName },
      };
      pdfPath = await generateRemitoPDF({ pedido: pedidoParaPdf, outDir: path.resolve(process.cwd(), "tmp") });
    } catch (e) {
      console.warn("[orders] No se pudo generar PDF:", e?.message || e);
    }

    // Email
    try {
      let presupuestoLinea = "";
      if (rol === "supervisor" && sid) {
        const presupuesto = getBudgetByServiceId(sid);
        if (presupuesto && presupuesto > 0) {
          const pct = Math.min(100, (total / presupuesto) * 100);
          presupuestoLinea = `\nPresupuesto usado: ${pct.toFixed(1)}%`;
        }
      }

      const subject = `NUEVO PEDIDO DE INSUMOS - "${serviceName}"`;

      const text = `Se generó el pedido #${nro}.

Empleado: ${empleadoNombre}
Rol: ${rol}
Servicio: ${serviceName}
Fecha: ${fechaLocal}
Total: ${money(total)}
Nota: ${notaFinal}${presupuestoLinea}

Se adjunta PDF del remito.`;

      const html = `
<p>Se generó el pedido <strong>#${nro}</strong>.</p>

<p><strong>Empleado:</strong> ${empleadoNombre}<br/>
<strong>Rol:</strong> ${rol}<br/>
<strong>Servicio:</strong> ${serviceName}<br/>
<strong>Fecha:</strong> ${fechaLocal}<br/>
<strong>Total:</strong> ${money(total)}<br/>
<strong>Nota:</strong> ${notaFinal}</p>
${presupuestoLinea ? `<p><strong>${presupuestoLinea.replace("\n", "")}</strong></p>` : ""}
<p>Se adjunta PDF del remito.</p>
`.trim();

      const toArr = getServiceEmails(sid) || [];
      const to = toArr.length ? toArr.join(",") : undefined;

      const attachments =
        pdfPath && fs.existsSync(pdfPath)
          ? [{ filename: path.basename(pdfPath), path: pdfPath, contentType: "application/pdf" }]
          : undefined;

      // Mostrar usuario como remitente (nombre). Si su e-mail no está, va Reply-To si existe.
      await sendMail({
        to,
        subject,
        text,
        html,
        attachments,
        entityType: "pedido",
        entityId: pedidoId,
        displayAsUser: true,               // muestra nombre del usuario
        userName: empleadoNombre,
        userEmail: usuario?.email || null, // si hay mail del usuario
        systemTag: "Kazaro Pedidos",       // etiqueta si no hay mail del user
      });
    } catch (e) {
      console.warn("[orders] sendMail falló:", e?.message || e);
    }

    const pdfUrl = `/orders/pdf/${pedidoId}`;
    return res.status(201).json({ ok: true, pedidoId, remito: { pdfUrl } });
  } catch (e) {
    console.error("[orders] POST / error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
});

router.get("/pdf/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const pedido = getFullOrder(id);
  if (!pedido) return res.status(404).end();
  try {
    const sid = String(pedido.ServicioID ?? "").trim();
    const serviceName = resolveServiceName(sid, pedido?.servicio?.name);
    const pedidoParaPdf = {
      ...pedido,
      servicio: { id: sid || null, name: serviceName },
      rol: String(pedido.Rol || "").trim().toLowerCase(),
    };

    const pdfPath = await generateRemitoPDF({ pedido: pedidoParaPdf, outDir: path.resolve(process.cwd(), "tmp") });
    res.setHeader("Content-Type", "application/pdf");
    return res.send(fs.readFileSync(pdfPath));
  } catch (e) {
    return res.status(500).json({ error: "No se pudo generar el PDF" });
  }
});

export default router;
