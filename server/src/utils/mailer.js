import nodemailer from "nodemailer";
import { env } from "./env.js";
import { logEmail } from "../db.js";

let transporter;
function getTransporter() {
  if (env.MAIL_DISABLE) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: (env.SMTP_USER && env.SMTP_PASS) ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transporter;
}

export async function sendMail({ to, subject, html, attachments, entityType, entityId, replyTo }) {
  const t = getTransporter();
  if (!t) {
    logEmail({ entityType, entityId, to, subject, status: "disabled", providerId: null, error: "MAIL_DISABLE=1" });
    return { disabled: true };
  }
  const from = env.MAIL_FROM || env.SMTP_USER || "no-reply@example.com";
  try {
    const info = await t.sendMail({
      from,
      to: to || env.MAIL_TO || env.SMTP_USER,
      subject,
      html,
      attachments,
      ...(replyTo ? { replyTo } : {}),
    });
    logEmail({ entityType, entityId, to, subject, status: "sent", providerId: info.messageId || info.response, error: null });
    return info;
  } catch (e) {
    logEmail({ entityType, entityId, to, subject, status: "error", providerId: null, error: e?.message || String(e) });
    throw e;
  }
}
