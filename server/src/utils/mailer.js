// server/src/utils/mailer.js
import nodemailer from "nodemailer";
import { env } from "./env.js";

const MAIL_DISABLED = String(process.env.MAIL_DISABLE || "").toLowerCase() === "true";

function parseBool(v) {
  return String(v).toLowerCase() === "true";
}

function getTransport() {
  if (MAIL_DISABLED) return null; 

  const secure = parseBool(env.SMTP_SECURE ?? "false");
  const port = Number(env.SMTP_PORT ?? (secure ? 465 : 587));

  
  console.log("[mail] Using SMTP config:", {
    host: env.SMTP_HOST,
    port,
    secure,
    user: env.SMTP_USER ? "<set>" : undefined,
    from: env.MAIL_FROM || env.SMTP_USER || undefined,
  });

  
  if (!env.SMTP_HOST) {
    throw new Error("[mail] SMTP_HOST no configurado. Seteá variables SMTP o MAIL_DISABLE=true.");
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure,
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
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

export async function sendMail({ to, subject, html, attachments = [] }) {
  if (MAIL_DISABLED) {
    console.log("[mail] MAIL_DISABLE=true → no se envía mail (noop)");
    return { messageId: "mail-disabled", accepted: [], rejected: [], response: "disabled" };
  }

  const transporter = getTransport();
  const info = await transporter.sendMail({
    from: env.MAIL_FROM || env.SMTP_USER,
    to,
    subject,
    html,
    attachments, 
  });

  console.log("[mail] sent", {
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
    response: info.response,
  });

  return info;
}
