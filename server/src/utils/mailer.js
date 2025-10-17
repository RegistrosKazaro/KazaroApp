// utils/mailer.js
import nodemailer from "nodemailer";
import { env } from "./env.js";

let transporter;

function getTransporter() {
  if (env.MAIL_DISABLE) return null;
  if (transporter) return transporter;

  const t = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE, // false => STARTTLS
    auth: (env.SMTP_USER && env.SMTP_PASS) ? {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    } : undefined,
    tls: { servername: env.SMTP_HOST },
  });

  transporter = t;
  return transporter;
}

export async function sendMail({ to, subject, html, attachments = [], fromName, replyTo }) {
  if (env.MAIL_DISABLE) {
    console.log("[mail] MAIL_DISABLE=true → no se envía");
    return { accepted: [], response: "MAIL_DISABLED" };
  }

  const t = getTransporter();
  if (!t) throw new Error("Mailer inhabilitado (MAIL_DISABLE=true)");

  const from =
    fromName && env.MAIL_FROM
      ? `"${fromName.replace(/"/g, "'")}" <${env.MAIL_FROM}>`
      : (env.MAIL_FROM || env.SMTP_USER);

  const info = await t.sendMail({
    from,
    to: to || env.MAIL_TO || env.SMTP_USER,
    subject,
    html,
    attachments,
    ...(replyTo ? { replyTo } : {}),
  });

  console.log("[mail] sent:", { accepted: info.accepted, response: info.response });
  return info;
}
