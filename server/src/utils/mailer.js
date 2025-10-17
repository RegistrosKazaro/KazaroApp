// server/src/utils/mailer.js
import nodemailer from "nodemailer";
import { env } from "./env.js";

const MAIL_DISABLED = String(process.env.MAIL_DISABLE || "").toLowerCase() === "true";
const trim = (s) => String(s ?? "").trim();

function parseBool(v) {
  return String(v).toLowerCase() === "true";
}

function getTransport() {
  if (MAIL_DISABLED) return null;

  const secure = parseBool(env.SMTP_SECURE ?? "false");
  const port = Number(env.SMTP_PORT ?? (secure ? 465 : 587));
  const host = trim(env.SMTP_HOST);
  const user = trim(env.SMTP_USER);
  const pass = trim(env.SMTP_PASS);
  const from = trim(env.MAIL_FROM || env.SMTP_USER);

  // Log de configuración (no expone la pass)
  console.log("[mail] Using SMTP config:", {
    host,
    port,
    secure,
    user: user ? "<set>" : undefined,
    from: from || undefined,
  });

  if (!host) {
    throw new Error("[mail] SMTP_HOST no configurado. Seteá variables SMTP o MAIL_DISABLE=true.");
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure, // true: 465, false: 587/25 (STARTTLS si corresponde)
    auth: user && pass ? { user, pass } : undefined,
    logger: true,
    debug: true,
  });

  return transporter;
}

export async function verifyMailTransport() {
  if (MAIL_DISABLED) {
    console.log("[mail] MAIL_DISABLE=true → skip verify (OK)");
    return true;
  }
  try {
    const transporter = getTransport();
    await transporter.verify();
    console.log("[mail] SMTP verify OK");
    return true;
  } catch (e) {
    console.error("[mail] transporter.verify ERROR:", e);
    return false;
  }
}

/**
 * Envía un correo electrónico.
 * - Mantiene la misma casilla real (MAIL_FROM / SMTP_USER)
 * - Permite personalizar el "display name" (fromName) que verá el destinatario
 *
 * @param {Object} params
 * @param {string|string[]} params.to
 * @param {string} params.subject
 * @param {string} params.html
 * @param {Array}  [params.attachments]
 * @param {string} [params.fromName]  Nombre visible del remitente (p.ej. "Norberto Urbani")
 * @param {string} [params.replyTo]   Dirección para respuestas (opcional, p.ej. el mail del usuario logueado)
 */
export async function sendMail({ to, subject, html, attachments = [], fromName, replyTo }) {
  if (MAIL_DISABLED) {
    console.log("[mail] MAIL_DISABLE=true → no se envía mail (noop)");
    return { messageId: "mail-disabled", accepted: [], rejected: [], response: "disabled" };
  }

  const transporter = getTransport();

  // Dirección real desde la que se envía (cuenta SMTP)
  const fromAddress = trim(env.MAIL_FROM || env.SMTP_USER);

  // Normalizo destinatarios (string o array) sin espacios sobrantes
  const toNormalized = Array.isArray(to) ? to.map(trim) : trim(to);

  // Si se provee fromName, lo usamos como "display name" sin cambiar la cuenta real
  const mailOptions = {
    from: fromName ? { name: fromName, address: fromAddress } : fromAddress,
    to: toNormalized,
    subject,
    html,
    attachments,
    ...(replyTo ? { replyTo: trim(replyTo) } : {}),
  };

  const info = await transporter.sendMail(mailOptions);

  console.log("[mail] sent", {
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
    response: info.response,
  });

  return info;
}
