// server/src/utils/mailer.js
import nodemailer from "nodemailer";
import { env } from "./env.js"; // ajustá la ruta si tu env.js está en otro lado
import { string } from "zod";

function getTransport() {
  const secure = String(env.SMTP_SECURE ?? "false") === "true";
  const port = Number(env.SMTP_PORT || (secure ? 465 : 587));

  // 👈 LOG AQUÍ (antes de createTransport)
  console.log("[mail] Using SMTP config:", {
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || (String(env.SMTP_SECURE ?? false)===true ? 465 : 587)),
    secure: String (env.SMTP_PORT || (string(env.SMTP_SECURE ?? false)===true ? 465 : 587 )),
    user: env.SMTP_USER,
    from: env.MAIL_FROM || env.SMTP_USER
  });

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure,
    auth: env.SMTP_USER && env.SMTP_PASS ? {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    } : undefined,
    logger: true, // logs detallados
    debug: true,  // más verboso en consola
  });

  return transporter;
}

export async function verifyMailTransport() {
  const transporter = getTransport();
  try {
    await transporter.verify();
    return true;
  } catch (e) {
    console.error("[mail] transporter.verify ERROR:", e);
    return false;
  }
}

export async function sendMail({ to, subject, html, attachments = [] }) {
  const transporter = getTransport();

  const info = await transporter.sendMail({
    from: env.MAIL_FROM || env.SMTP_USER,
    to,
    subject,
    html,
    attachments, // [{ filename, path, contentType }]
  });

  // Log útil para depurar
  console.log("[mail] sent", {
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
    response: info.response,
  });

  return info;
}
function parseBool(v){ return String(v).toLowerCase()==="true"; }
const secure = parseBool(env.SMTP_SECURE);
const port   = Number(env.SMTP_PORT || (secure ? 465 : 587));

console.log("[mail] Using SMTP config:", {
  host: env.SMTP_HOST,
  port,
  secure,
  user: env.SMTP_USER,
  from: env.MAIL_FROM || env.SMTP_USER
});
