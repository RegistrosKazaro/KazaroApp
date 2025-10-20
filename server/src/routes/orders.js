import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { db, createOrder, getFullOrder, getEmployeeDisplayName, getServiceById, getServiceEmails } from "../db.js";
import { generateRemitoPDF } from "../utils/remitoPdf.js";
import { sendMail } from "../utils/mailer.js";
import path from "path";
import fs from "fs";

const router = Router();

router.post("/", requireAuth, async (req, res) => {
  try {
    const empleadoId = req.user.id;
    const { servicioId, nota, items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Faltan items" });
    }

    const pedidoId = createOrder({ empleadoId, servicioId, nota, items });
    const pedido = getFullOrder(pedidoId);

    let pdfPath = null;
    try {
      pdfPath = await generateRemitoPDF({ pedido, outDir: path.resolve(process.cwd(), "tmp") });
    } catch (e) {
      console.warn("[orders] No se pudo generar PDF:", e?.message || e);
    }

    try {
      const service = pedido.servicio || (servicioId ? getServiceById(servicioId) : null);
      const toArr = getServiceEmails(servicioId) || [];
      const to = (toArr.length ? toArr.join(",") : undefined);
      const subject = `Pedido #${pedidoId}${service?.name ? " - " + service.name : ""}`;
      const html = `
        <p>Se ha generado un nuevo pedido.</p>
        <p><b>Pedido:</b> #${pedidoId}<br/>
           <b>Servicio:</b> ${service?.name || "-"}<br/>
           <b>Solicitante:</b> ${getEmployeeDisplayName(empleadoId) || empleadoId}</p>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">
          <thead><tr><th>Código</th><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
          <tbody>
            ${pedido.items.map(i => `
              <tr>
                <td>${i.code || "-"}</td>
                <td>${i.name || ""}</td>
                <td style="text-align:right">${i.qty}</td>
                <td style="text-align:right">${i.price}</td>
                <td style="text-align:right">${i.subtotal}</td>
              </tr>
            `).join("")}
            <tr><td colspan="4" style="text-align:right"><b>Total</b></td><td style="text-align:right"><b>${pedido.Total}</b></td></tr>
          </tbody>
        </table>
        ${pedido.Nota ? `<p><b>Notas:</b> ${pedido.Nota}</p>` : ""}
      `;

      const attachments = pdfPath && fs.existsSync(pdfPath) ? [{
        filename: path.basename(pdfPath),
        path: pdfPath,
        contentType: "application/pdf",
      }] : undefined;

      await sendMail({
        to,
        subject,
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
