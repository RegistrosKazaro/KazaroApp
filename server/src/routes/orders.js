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

const pad7 = (n) => String(n ?? "").padStart(7, "0");
const money = (v) => {
  const n = Number(v || 0);
  try {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);
  } catch {
    return `$ ${n.toFixed(2)}`;
  }
};

// Parseo de timestamp tipo "YYYY-MM-DD HH:mm:ss" (SQLite) como UTC -> local
function fmtDateTime(sql) {
  if (!sql) return "";
  try {
    const d = new Date(sql.replace(" ", "T") + "Z");
    return d.toLocaleString("es-AR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return String(sql);
  }
}

router.post("/", requireAuth, async (req, res) => {
  try {
    const empleadoId = req.user.id;
    const { servicioId = null, nota = "", items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Faltan items" });
    }

    // 1) Crear pedido
    const pedidoId = createOrder({ empleadoId, servicioId, nota, items });
    const pedido = getFullOrder(pedidoId);
    if (!pedido) return res.status(500).json({ error: "No se pudo recuperar el pedido" });

    // 2) Datos para mail/PDF
    const nro = pad7(pedidoId);
    const empleadoNombre = getEmployeeDisplayName(empleadoId) || `Empleado ${empleadoId}`;
    const rol = String(pedido.Rol || "").toLowerCase() || "administrativo";
    const total = Number(pedido.Total || 0);
    const fechaLocal = fmtDateTime(pedido.Fecha);

    // NOMBRE del servicio (no ID)
    const sid = pedido.ServicioID ?? servicioId ?? null;
    let serviceName =
      pedido?.servicio?.name ||
      (sid != null ? getServiceNameById(sid) : null) ||
      (sid != null ? (getServiceById(sid)?.name || null) : null) ||
      "—";

    // 3) PDF (si falla, no detiene el flujo)
    let pdfPath = null;
    try {
      // inyectamos nombre de servicio para el PDF si no venía
      const pedidoConServicio = { ...pedido, servicio: pedido.servicio || (serviceName ? { id: sid, name: serviceName } : null) };
      pdfPath = await generateRemitoPDF({ pedido: pedidoConServicio, outDir: path.resolve(process.cwd(), "tmp") });
    } catch (e) {
      console.warn("[orders] No se pudo generar PDF:", e?.message || e);
    }

    // 4) Mail con formato solicitado
    try {
      // % presupuesto (solo si supervisor y el servicio tiene presupuesto)
      let presupuestoLinea = "";
      if (rol === "supervisor" && sid != null) {
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
Nota: ${nota || (pedido.Nota || "—")}${presupuestoLinea}

Se adjunta PDF del remito.`;

      const html = `
<p>Se generó el pedido <strong>#${nro}</strong>.</p>

<p><strong>Empleado:</strong> ${empleadoNombre}<br/>
<strong>Rol:</strong> ${rol}<br/>
<strong>Servicio:</strong> ${serviceName}<br/>
<strong>Fecha:</strong> ${fechaLocal}<br/>
<strong>Total:</strong> ${money(total)}<br/>
<strong>Nota:</strong> ${nota || (pedido.Nota || "—")}</p>
${presupuestoLinea ? `<p><strong>${presupuestoLinea.replace("\n", "")}</strong></p>` : ""}
<p>Se adjunta PDF del remito.</p>
`.trim();

      const toArr = getServiceEmails(sid) || [];
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

    // 5) Respuesta
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
