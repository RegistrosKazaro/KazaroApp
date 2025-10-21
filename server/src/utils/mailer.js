import nodemailer from "nodemailer";
import { env } from "./env.js";
import { logEmail } from "../db.js";

let transporter;

/* ---- helpers ---- */
function parseAddress(input) {
  const s = String(input || "").trim();
  const m = s.match(/^(.*)<([^>]+)>$/);
  if (m) {
    const name = m[1].trim().replace(/^"|"$/g, "");
    const email = m[2].trim();
    return { name, email };
  }
  return { name: "", email: s };
}
const fmt = (name, email) => {
  const n = (name || "").toString().trim().replace(/"/g, "'");
  const e = (email || "").toString().trim();
  return n ? `"${n}" <${e}>` : e;
};

function getTransporter() {
  if (env.MAIL_DISABLE) return null;
  if (transporter) return transporter;

  const secure =
    env.SMTP_SECURE === true ||
    String(env.SMTP_SECURE || "").trim().toLowerCase() === "true";

  const port = Number(env.SMTP_PORT || 0) || undefined;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure,
    auth: (env.SMTP_USER && env.SMTP_PASS)
      ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
      : undefined,
  });

  return transporter;
}

/**
 * Envío robusto con fallback:
 * - Si MAIL_ALLOW_USER_FROM=1 y hay userEmail, intenta From=userEmail.
 * - Si falla, reintenta con From del sistema y Reply-To del usuario.
 * - Si MAIL_ALLOW_USER_FROM!=1, usa siempre From del sistema y Reply-To del usuario.
 *
 * displayAsUser: si true, el display name incluye el nombre del usuario.
 * userName / userEmail: datos del usuario logueado.
 * systemTag: agregado en display name cuando usamos From del sistema.
 */
export async function sendMail({
  to,
  subject,
  text,
  html,
  attachments,
  entityType,
  entityId,
  displayAsUser = false,
  userName = null,
  userEmail = null,
  systemTag = "Kazaro Pedidos",
}) {
  const t = getTransporter();
  if (!t) {
    logEmail({ entityType, entityId, to, subject, status: "disabled", providerId: null, error: "MAIL_DISABLE=1" });
    return { disabled: true };
  }

  // --- parseo MAIL_FROM (puede venir "Nombre <email>" o sólo email) ---
  const mf = (env.MAIL_FROM || "").trim();
  const parsed = parseAddress(mf);
  // nombre del sistema: si hay MAIL_FROM_NAME uso ese, si no, uso el "name" de MAIL_FROM, y si no, "Kazaro"
  const systemName = (env.MAIL_FROM_NAME || parsed.name || "Kazaro").trim();
  // email del sistema: si MAIL_FROM no tenía email, caigo a SMTP_USER o no-reply
  const systemEmail = (parsed.email || env.SMTP_USER || "no-reply@example.com").trim();

  // destinatarios: si no viene "to", uso MAIL_TO o SMTP_USER
  const toFinal = (to || env.MAIL_TO || env.SMTP_USER || "").toString();

  const allowUserFrom = String(env.MAIL_ALLOW_USER_FROM || "").trim() === "1";

  const base = {
    to: toFinal,
    subject,
    text,
    html,
    attachments,
  };

  // Opción segura por defecto (siempre funciona y es estándar para DMARC):
  // From: "NombreUsuario — Kazaro Pedidos" <systemEmail>
  // Reply-To: "NombreUsuario" <userEmail>  (si existe userEmail)
  const safeDisplay = (displayAsUser && userName)
    ? `${userName} — ${systemTag || systemName}`
    : systemName;

  const safeOpts = {
    ...base,
    from: fmt(safeDisplay, systemEmail),
    ...(userEmail ? { replyTo: fmt(userName || userEmail, userEmail) } : {}),
  };

  // Opción “From = userEmail” (sólo si lo habilitás y tenés mail del user)
  const riskyUserFrom =
    displayAsUser && userEmail && allowUserFrom
      ? {
          ...base,
          from: fmt(userName || userEmail, userEmail),
          replyTo: fmt(userName || userEmail, userEmail),
        }
      : null;

  try {
    const info = await t.sendMail(riskyUserFrom || safeOpts);
    logEmail({ entityType, entityId, to: toFinal, subject, status: "sent", providerId: info.messageId || info.response, error: null });
    return info;
  } catch (e) {
    // Si falló el From=userEmail, hago fallback automático
    if (riskyUserFrom) {
      try {
        const info2 = await t.sendMail(safeOpts);
        logEmail({ entityType, entityId, to: toFinal, subject, status: "sent", providerId: info2.messageId || info2.response, error: null });
        return info2;
      } catch (e2) {
        logEmail({ entityType, entityId, to: toFinal, subject, status: "error", providerId: null, error: e2?.message || String(e2) });
        throw e2;
      }
    }
    logEmail({ entityType, entityId, to: toFinal, subject, status: "error", providerId: null, error: e?.message || String(e) });
    throw e;
  }
}
