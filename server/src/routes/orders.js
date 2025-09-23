// server/src/routes/orders.js
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  createOrder,
  getEmployeeDisplayName,
  getFullOrder,
  getEmployeeEmail,
} from "../db.js";
import { generateRemitoPDF } from "../utils/remitoPdf.js";
import { sendMail } from "../utils/mailer.js";
import { env } from "../utils/env.js";
import path from "path";
import fs from "fs";

const router = Router();

const PUBLIC_DIR = process.env.PUBLIC_DIR || path.resolve(process.cwd(), "public");
const REMITOS_DIR = path.resolve(PUBLIC_DIR, "remitos");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

router.post("/", requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const {
      rol,
      nota = "",
      items = [],
      servicioId = null,
      servicioName = null,
    } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No hay items." });
    }

    // 1) crear pedido
    const { pedidoId, total } = createOrder({
      empleadoId: user.id,
      rol,
      nota,
      items,
      servicioId: servicioId ?? null,
    });

    // 2) datos para el remito
    const { cab, items: orderItems } = getFullOrder(pedidoId);
    const empleado = getEmployeeDisplayName(user.id);
    const fechaIso = cab?.Fecha || new Date().toISOString();
    const numero = String(pedidoId).padStart(8, "0");
    const servicio = servicioId ? { id: servicioId, name: servicioName || "" } : null;

    const remito = { numero, fecha: fechaIso, total, empleado, rol, servicio };

    // 3) PDF + mail (async, no bloquea la respuesta)
    (async () => {
      try {
        // genera en ./tmp
        const pdf = await generateRemitoPDF({ remito, items: orderItems }); // { filePath, fileName }

        // copia a ./public/remitos y arma path público
        ensureDir(REMITOS_DIR);
        const publicPath = path.join(REMITOS_DIR, pdf.fileName);
        fs.copyFileSync(pdf.filePath, publicPath);

        const base = env.APP_BASE_URL || `http://localhost:${env.PORT || 4000}`;
        const pdfUrl = `${base}/remitos/${pdf.fileName}`;

        // destinatarios
        const PRIMARY_TO = env.MAIL_TO?.trim() || "nicolas.barcena@kazaro.com.ar";
        const userEmail = getEmployeeEmail(user.id);
        const BCC_USER = userEmail && /\S+@\S+\.\S+/.test(userEmail) ? userEmail : undefined;

        const serviceName = remito?.servicio?.name && String(remito.servicio.name).trim();
        const who = (empleado && String(empleado).trim()) || (user?.username ?? "Usuario");
        const subject = `NUEVO PEDIDO INSUMO - ${serviceName ? serviceName : `ADMINISTRATIVO - ${who}`}`;

        const currency = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
        const html = `
          <p>Hola,</p>
          <p>Se generó el <strong>Remito Nº ${numero}</strong> correspondiente al pedido de <strong>${empleado}</strong>.</p>
          ${servicio ? `<p><strong>Servicio:</strong> ${servicio.name} (ID: ${servicio.id})</p>` : ""}
          <p><strong>Total:</strong> ${currency.format(total || 0)}</p>
          <p>Descarga del PDF: <a href="${pdfUrl}">${pdfUrl}</a></p>
          <hr/>
          <p><strong>Detalle del pedido:</strong></p>
          <ul>
            ${orderItems.map(it => {
              const cod = it.codigo ? ` (Código: ${String(it.codigo).trim()})` : "";
              return `<li>${it.nombre}${cod} — Cant: ${it.cantidad} — ${currency.format(it.precio || 0)} — Subtotal: ${currency.format(it.subtotal || 0)}</li>`;
            }).join("")}
          </ul>
          <p>— Kazaro</p>
        `;

        await sendMail({
          to: PRIMARY_TO,
          bcc: BCC_USER,
          subject,
          html,
          attachments: [
            { filename: pdf.fileName, path: publicPath, contentType: "application/pdf" },
          ],
        });

        console.log("[orders] Remito generado y mail enviado:", pdf.fileName);
      } catch (err) {
        console.error("[orders] error generando/enviando remito:", err);
      }
    })();

    // 4) respuesta inmediata (coherente con el archivo real)
    const base = env.APP_BASE_URL || `http://localhost:${env.PORT || 4000}`;
    const pdfUrl = `${base}/remitos/remito-${numero}-${new Date(fechaIso).toISOString().slice(0,19).replace(/[:T]/g,"-")}.pdf`;
    // Nota: esta URL intenta coincidir con generateRemitoPDF; igualmente el mail incluye la URL exacta

    return res.json({ ok: true, pedidoId, remito: { ...remito, pdfUrl } });
  } catch (e) {
    console.error("[orders] POST /orders error:", e);
    return res.status(500).json({ error: "No se pudo crear el pedido." });
  }
});

export default router;
