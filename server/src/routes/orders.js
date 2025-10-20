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
import { sendMail } from "../utils/mailer.js";
import path from "path";
import fs from "fs";

const router = Router();

function pad7(n) {
  return String(n ?? "").padStart(7, "0");
}

router.post("/", requireAuth, async (req, res) => {
  try {
    const empleadoId = req.user.id;
    const { servicioId = null, nota = "", items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Faltan items" });
    }

    // crea el pedido
    const pedidoId = createOrder({ empleadoId, servicioId, nota, items });
    const pedido = getFullOrder(pedidoId);
    if (!pedido) return res.status(500).json({ error: "No se pudo recuperar el pedido" });

    // genera PDF (si falla, sigue sin romper el flujo)
    let pdfPath = null;
    try {
      pdfPath = await generateRemitoPDF({ pedido, outDir: path.resolve(process.cwd(), "tmp") });
    } catch (e) {
      console.warn("[orders] No se pudo generar PDF:", e?.message || e);
    }

    // envía mail con el formato solicitado
    try {
      const service = pedido.servicio || (pedido.ServicioID ? getServiceById(pedido.ServicioID) : null);
      const serviceName = service?.name || getServiceNameById(pedido.ServicioID) || "-";
      const empleadoNombre = getEmployeeDisplayName(empleadoId) || `Empleado ${empleadoId}`;
      const rol = String(pedido.Rol || "").toLowerCase() || "administrativo";
      const total = Number(pedido.Total || 0);
      const nro = pad7(pedidoId);

      // % presupuesto (solo si supervisor y hay presupuesto configurado)
      let presupuestoLinea = "";
      if (rol === "supervisor" && pedido.ServicioID != null) {
        const presupuesto = getBudgetByServiceId(pedido.ServicioID);
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
Total: ${total}
Nota: ${nota || (pedido.Nota || "—")}${presupuestoLinea}

Se adjunta PDF del remito.`;

      const html = `
<p>Se generó el pedido <strong>#${nro}</strong>.</p>

<p><strong>Empleado:</strong> ${empleadoNombre}<br/>
<strong>Rol:</strong> ${rol}<br/>
<strong>Servicio:</strong> ${serviceName}<br/>
<strong>Total:</strong> ${total}<br/>
<strong>Nota:</strong> ${nota || (pedido.Nota || "—")}</p>
${presupuestoLinea ? `<p><strong>${presupuestoLinea.replace("\n", "")}</strong></p>` : ""}
<p>Se adjunta PDF del remito.</p>
`.trim();

      const toArr = getServiceEmails(pedido.ServicioID || servicioId) || [];
      const to = toArr.length ? toArr.join(",") : undefined;

      const attachments =
        pdfPath && fs.existsSync(pdfPath)
          ? [
              {
                filename: path.basename(pdfPath),
                path: pdfPath,
                contentType: "application/pdf",
              },
            ]
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
    const pdfPath = await generateRemitoPDF({ pedido, outDir: path.resolve(process.cwd(), "tmp") });
    res.setHeader("Content-Type", "application/pdf");
    return res.send(fs.readFileSync(pdfPath));
  } catch (e) {
    return res.status(500).json({ error: "No se pudo generar el PDF" });
  }
});

export default router;
