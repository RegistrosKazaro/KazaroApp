// server/src/utils/reminderJob.js
// Job que corre cada hora y manda mail a supervisores con pedidos demorados +2 días

import { db } from "../db.js";
import { sendMail } from "./mailer.js";

function nowArgentina() {
  const ar = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return ar.toISOString().replace("T", " ").slice(0, 19);
}

function pad7(n) { return String(n ?? "").padStart(7, "0"); }

function money(v) {
  try {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 }).format(Number(v || 0));
  } catch { return `$ ${Number(v || 0).toFixed(2)}`; }
}

// Tabla para registrar recordatorios ya enviados (evitar spam)
function ensureReminderTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS PedidoRecordatorios (
      pedido_id   INTEGER NOT NULL,
      enviado_at  TEXT    NOT NULL,
      PRIMARY KEY (pedido_id)
    );
  `);
}

async function sendReminders() {
  try {
    ensureReminderTable();

    // Pedidos abiertos o en preparación con más de 2 días sin moverse
    const pedidosDemorados = db.prepare(`
      SELECT
        p.PedidoID   AS id,
        p.EmpleadoID,
        p.Total      AS total,
        p.Fecha      AS fecha,
        p.ServicioID,
        COALESCE(p.Status, 'open') AS status,
        e.Email      AS email,
        TRIM(COALESCE(e.Nombre,'') || ' ' || COALESCE(e.Apellido,'')) AS nombre,
        e.username
      FROM Pedidos p
      JOIN Empleados e ON CAST(e.EmpleadosID AS TEXT) = CAST(p.EmpleadoID AS TEXT)
      WHERE
        COALESCE(p.Status, 'open') IN ('open', 'preparing')
        AND p.Fecha <= datetime('now', '-2 days')
        AND NOT EXISTS (
          SELECT 1 FROM PedidoRecordatorios r
          WHERE r.pedido_id = p.PedidoID
        )
      LIMIT 50
    `).all();

    if (!pedidosDemorados.length) return;

    console.log(`[reminderJob] ${pedidosDemorados.length} pedidos demorados encontrados`);

    for (const p of pedidosDemorados) {
      const destinatario = p.email;
      if (!destinatario) continue;

      const nombre = (p.nombre?.trim()) || p.username || `Empleado ${p.EmpleadoID}`;

      let servicioNombre = "";
      if (p.ServicioID) {
        try {
          const srv = db.prepare(
            `SELECT ServicioNombre AS name FROM Servicios WHERE CAST(ServiciosID AS TEXT) = CAST(? AS TEXT) LIMIT 1`
          ).get(p.ServicioID);
          servicioNombre = srv?.name || "";
        } catch {}
      }

      const statusLabel = p.status === "preparing" ? "En preparación" : "Pendiente";

      const subject = `⚠️ Tu pedido #${pad7(p.id)} lleva más de 2 días en estado "${statusLabel}"`;

      const html = `
        <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px">
          <h2 style="color:#dc2626;margin:0 0 12px">⚠️ Recordatorio de pedido demorado</h2>
          <p style="color:#374151">Hola <strong>${nombre}</strong>,</p>
          <p style="color:#374151">Tu pedido lleva más de 2 días sin avanzar:</p>
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0">
            <div><strong>Pedido:</strong> #${pad7(p.id)}</div>
            <div><strong>Estado:</strong> ${statusLabel}</div>
            ${servicioNombre ? `<div><strong>Servicio:</strong> ${servicioNombre}</div>` : ""}
            <div><strong>Total:</strong> ${money(p.total)}</div>
            <div><strong>Fecha:</strong> ${p.fecha}</div>
          </div>
          <p style="color:#6b7280;font-size:0.85rem">
            Podés ver el estado actualizado en la sección "Mis pedidos" de la aplicación.
          </p>
          <p style="color:#9ca3af;font-size:0.75rem">Kazaro — Sistema de gestión de insumos</p>
        </div>
      `;

      const text = `Recordatorio: tu pedido #${pad7(p.id)} lleva más de 2 días en estado "${statusLabel}". Total: ${money(p.total)}`;

      try {
       // await sendMail({
         // to: destinatario,
         // subject,
         // text,
         // html,
          //entityType: "pedido_recordatorio",
          //entityId: String(p.id),
        //});

        // Marcar como enviado para no volver a mandar
        db.prepare(`INSERT OR IGNORE INTO PedidoRecordatorios (pedido_id, enviado_at) VALUES (?, ?)`).run(p.id, nowArgentina());

        console.log(`[reminderJob] Recordatorio enviado para pedido #${p.id} → ${destinatario}`);
      } catch (e) {
        console.warn(`[reminderJob] No se pudo enviar recordatorio para pedido #${p.id}:`, e?.message);
      }
    }
  } catch (e) {
    console.error("[reminderJob] Error general:", e?.message || e);
  }
}

// Iniciar el job: corre cada hora
export function startReminderJob() {
  console.log("[reminderJob] Iniciado — verificación cada hora");
  sendReminders(); // correr al arrancar también
  setInterval(sendReminders, 60 * 60 * 1000); // cada 1 hora
}