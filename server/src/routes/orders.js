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
} from "../db.js";
import { generateRemitoPDF } from "../utils/remitoPdf.js";
import path from "path";
import fs from "fs";
import { sendMail } from "../utils/mailer.js";

const router = Router();

/* ===== helpers locales ===== */
const pad7 = (n) => String(n ?? "").padStart(7, "0");
const money = (v) => {
  const n = Number(v || 0);
  try {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);
  } catch {
    return `$ ${n.toFixed(2)}`;
  }
};
const parseDbDate = (s) => {
  if (!s) return null;
  // SQLite datetime('now') -> "YYYY-MM-DD HH:MM:SS" (UTC)
  // Lo parseamos como UTC y lo mostramos en local.
  const d = new Date((String(s).replace(" ", "T")) + "Z");
  return isNaN(d.getTime()) ? new Date(s) : d;
};
const fmtDateTime = (s) => {
  const d = parseDbDate(s);
  if (!d) return "";
  return new Intl.DateTimeFormat("es-AR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  }).format(d);
};

router.post("/", requireAuth, async (req, res) => {
  try {
    const empleadoId = req.user.id;
    const { servicioId = null, nota = "", items } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Faltan items" });
    }

    // 1) crear pedido
    const pedidoId = createOrder({ empleadoId, servicioId, nota, items });

    // 2) recuperar cabecera + items
    const pedido = getFullOrder(pedidoId);
    if (!pedido) return res.status(500).json({ error: "No se pudo recuperar el pedido" });

    const cab = pedido.cab || pedido;
    const nro = pad7(pedidoId);
    const empleadoNombre = getEmployeeDisplayName(empleadoId) || `Empleado ${empleadoId}`;
    const rol = String(cab.Rol || "").toLowerCase() || "administrativo";
    const total = Number(cab.Total || 0);
    const fechaLocal = fmtDateTime(cab.Fecha);

    // 3) resolver servicio (id + nombre) para mail y PDF
    const serviceIdEff = cab.ServicioID ?? servicioId ?? null;
    let serviceName = "—";
    if (serviceIdEff != null) {
      // intenta por helper general; si falla, intenta getServiceById; si falla, muestra el id como último recurso
      serviceName =
        getServiceNameById(serviceIdEff) ||
        (getServiceById(serviceIdEff)?.name ?? null) ||
        String(serviceIdEff);
    }

    // 4) generar PDF (pasamos hint con el servicio resuelto)
    let pdfPath = null;
    try {
      const pedidoParaPdf = {
        ...pedido,
        servicio: { id: serviceIdEff, name: serviceName },
      };
      pdfPath = await generateRemitoPDF({
        pedido: pedidoParaPdf,
        outDir: path.resolve(process.cwd(), "tmp"),
      });
    } catch (e) {
      console.warn("[orders] No se pudo generar PDF:", e?.message || e);
    }

    // 5) enviar correo
    try {
      // % presupuesto (sólo si supervisor y hay presupuesto configurado)
      let presupuestoLinea = "";
      if (rol === "supervisor" && serviceIdEff != null) {
        const presupuesto = getBudgetByServiceId(serviceIdEff);
        if (presupuesto && presupuesto > 0) {
          const pct = Math.min(100, (total / presupuesto) * 100);
          presupuestoLinea = `Presupuesto usado: ${pct.toFixed(1)}%`;
        }
      }

      const subject = `NUEVO PEDIDO DE INSUMOS - "${serviceName}"`;

      const text = `Se generó el pedido #${nro}.

Empleado: ${empleadoNombre}
Rol: ${rol}
Servicio: ${serviceName}
Fecha: ${fechaLocal}
Total: ${money(total)}
Nota: ${nota || (cab.Nota || "—")}
${presupuestoLinea ? `\n${presupuestoLinea}` : ""}

Se adjunta PDF del remito.`;

      const html = `
<p>Se generó el pedido <strong>#${nro}</strong>.</p>

<p><strong>Empleado:</strong> ${empleadoNombre}<br/>
<strong>Rol:</strong> ${rol}<br/>
<strong>Servicio:</strong> ${serviceName}<br/>
<strong>Fecha:</strong> ${fechaLocal}<br/>
<strong>Total:</strong> ${money(total)}<br/>
<strong>Nota:</strong> ${nota || (cab.Nota || "—")}</p>
${presupuestoLinea ? `<p><strong>${presupuestoLinea}</strong></p>` : ""}
<p>Se adjunta PDF del remito.</p>
`.trim();

      const toArr = getServiceEmails(serviceIdEff) || [];
      const to = toArr.length ? toArr.join(",") : undefined;

      const attachments =
        pdfPath && fs.existsSync(pdfPath)
          ? [{ filename: path.basename(pdfPath), path: pdfPath, contentType: "application/pdf" }]
          : undefined;

      await sendMail({
        to,
        subject,
        text,
        html,
        attachments,
        entityType: "pedido",
        entityId: pedidoId,
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
    // si el pedido ya trae servicio resuelto, el PDF lo mostrará
    const pdfPath = await generateRemitoPDF({ pedido, outDir: path.resolve(process.cwd(), "tmp") });
    res.setHeader("Content-Type", "application/pdf");
    return res.send(fs.readFileSync(pdfPath));
  } catch (e) {
    return res.status(500).json({ error: "No se pudo generar el PDF" });
  }
});

export default router;
