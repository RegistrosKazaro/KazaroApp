// server/src/utils/mailer.js
import nodemailer from "nodemailer";
import { env } from "./env.js";
import { logEmail } from "../db.js";

let transporter;

/* ================= Helpers ================= */
function parseAddress(input) {
  const s = String(input || "").trim();
  if (!s) return { name: "", email: "" };
  // "Nombre" <mail@dom.com>  |  mail@dom.com
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

// si SMTP_USER viniera "a@b.com, c@d.com" toma el primero
function pickFirstEmail(val) {
  const s = String(val || "").trim();
  if (!s) return "";
  return s.split(/[;,]+/).map(t => t.trim()).filter(Boolean)[0] || "";
}

// "a@b, c@d ; e@f" -> ["a@b","c@d","e@f"]
function parseList(list) {
  if (!list) return [];
  return String(list)
    .split(/[,;]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

// une listas y quita duplicados (case-insensitive)
function unionEmails(...lists) {
  const out = [];
  const seen = new Set();
  for (const l of lists) {
    for (const e of parseList(l)) {
      const key = e.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(e);
      }
    }
  }
  return out;
}

// filtra usando blocklist (case-insensitive)
function minusEmails(list, blockList) {
  if (!blockList || !blockList.length) return list;
  const blocked = new Set(blockList.map(e => e.toLowerCase()));
  return list.filter(e => !blocked.has(e.toLowerCase()));
}

// Log seguro: nunca rompe el envío
function safeLog(payload) {
  try { logEmail(payload); } catch (e) {
    console.warn("[email_log] log failed:", e?.message || e);
  }
}

function getTransporter() {
  if (String(env.MAIL_DISABLE || "").trim() === "1") return null;
  if (transporter) return transporter;

  const secure =
    env.SMTP_SECURE === true ||
    String(env.SMTP_SECURE || "").trim().toLowerCase() === "true";

  const port = Number(env.SMTP_PORT || 0) || (secure ? 465 : 587);
  const user = pickFirstEmail(env.SMTP_USER);
  const pass = env.SMTP_PASS;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure,
    auth: (user && pass) ? { user, pass } : undefined,
  });

  return transporter;
}

/* ================= Core ================= */
/**
 * Envío con múltiples destinatarios:
 * - ALWAYS incluye todo `MAIL_TO` (puede ser 1 o varios separados por coma/;).
 * - Acepta `to`, `cc`, `bcc` por parámetro y también `MAIL_CC`, `MAIL_BCC` por .env.
 * - Deduplica y aplica `MAIL_BLOCKLIST` si está configurado.
 * - Inyecta “— Solicitante: {userName}” en el asunto si viene userName (una sola vez).
 * - Usa Reply-To del usuario si viene userEmail.
 * - Si MAIL_ALLOW_USER_FROM=1 y displayAsUser=true, intenta From del usuario y si falla, reintenta con From del sistema.
 * - **Nuevo:** cuando MAIL_ALLOW_USER_FROM=0, el *display name* del From será el `userName`
 *   (pero el email sigue siendo el del sistema), así en Gmail se ve el nombre del solicitante.
 */
export async function sendMail({
  to,                 // string: "a@b,c@d"
  cc,                 // opcional
  bcc,                // opcional
  subject,
  text,
  html,
  attachments,
  entityType,         // 'order' | 'remito' (para log)
  entityId,           // id entidad (para log)
  displayAsUser = false,
  userName = null,    // solicitante (para asunto, reply-to y display name)
  userEmail = null,   // email solicitante (reply-to y opc. From)
  systemTag = "Kazaro Pedidos",
}) {
  const t = getTransporter();
  if (!t) {
    safeLog({ entityType, entityId, to: "", subject, status: "disabled", providerId: null, error: "MAIL_DISABLE=1" });
    return { disabled: true };
  }

  // Remitente del sistema
  const parsed = parseAddress(env.MAIL_FROM);
  const systemEmail = (parsed.email || pickFirstEmail(env.SMTP_USER) || "no-reply@example.com").trim();
  const systemName  = (parsed.name  || systemTag || "Kazaro").trim();

  // ===== Construcción de destinatarios =====
  const alwaysInclude = unionEmails(env.MAIL_TO);          // obligatorio(s) del .env
  const toList  = unionEmails(to, alwaysInclude);
  const ccList  = unionEmails(cc, env.MAIL_CC);
  const bccList = unionEmails(bcc, env.MAIL_BCC);

  // Blocklist opcional (ej: para excluir algún correo)
  const block = parseList(env.MAIL_BLOCKLIST);
  const toFinal  = minusEmails(toList,  block);
  const ccFinal  = minusEmails(ccList,  block);
  const bccFinal = minusEmails(bccList, block);

  if (toFinal.length + ccFinal.length + bccFinal.length === 0) {
    const error = "NO_RECIPIENTS: no hay destinatarios luego de aplicar blocklist; configure MAIL_TO / to / cc / bcc";
    safeLog({ entityType, entityId, to: "", subject, status: "error", providerId: null, error });
    throw new Error(error);
  }

  // ===== Asunto con solicitante =====
  let subjectFinal = String(subject || "").trim();
  const requester = String(userName || "").trim();
  if (requester) {
    const esc = requester.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(esc, "i").test(subjectFinal)) {
      subjectFinal = subjectFinal ? `${subjectFinal} — Solicitante: ${requester}` : `Solicitante: ${requester}`;
    }
  }

  // ===== Opciones base de envío =====
  const base = {
    to: toFinal.join(", "),
    cc: ccFinal.length ? ccFinal.join(", ") : undefined,
    bcc: bccFinal.length ? bccFinal.join(", ") : undefined,
    subject: subjectFinal,
    text,
    html,
    attachments,
    headers: {
      "X-Kazaro-Entity": (entityType && entityId) ? `${entityType}#${entityId}` : undefined,
    },
  };

  // Display name dinámico: si hay userName, usamos ese como nombre visible del From
  const fromDisplayName = requester || systemName;

  const safeOpts = {
    ...base,
    from: fmt(fromDisplayName, systemEmail),   // <— aquí cambiamos el nombre visible
    sender: fmt(systemName, systemEmail),      // mantiene el sender del sistema
    ...(userEmail ? { replyTo: fmt(requester || userEmail, userEmail) } : {}),
  };

  const riskyUserFrom = !!(
    displayAsUser &&
    String(env.MAIL_ALLOW_USER_FROM || "").trim() === "1" &&
    userEmail
  );

  try {
    if (riskyUserFrom) {
      // En este modo (opt-in), el From usa el correo del usuario
      const risky = {
        ...base,
        from: fmt(requester || userEmail, userEmail),
        sender: fmt(systemName, systemEmail),
        ...(userEmail ? { replyTo: fmt(requester || userEmail, userEmail) } : {}),
      };
      try {
        const info = await t.sendMail(risky);
        safeLog({
          entityType, entityId,
          to: [base.to, base.cc, base.bcc].filter(Boolean).join(" | "),
          subject: subjectFinal, status: "sent",
          providerId: info.messageId || info.response, error: null
        });
        return info;
      } catch (_e) {
        // fallback seguro
        const info2 = await t.sendMail(safeOpts);
        safeLog({
          entityType, entityId,
          to: [base.to, base.cc, base.bcc].filter(Boolean).join(" | "),
          subject: subjectFinal, status: "sent",
          providerId: info2.messageId || info2.response, error: null
        });
        return info2;
      }
    }

    const info = await t.sendMail(safeOpts);
    safeLog({
      entityType, entityId,
      to: [base.to, base.cc, base.bcc].filter(Boolean).join(" | "),
      subject: subjectFinal, status: "sent",
      providerId: info.messageId || info.response, error: null
    });
    return info;

  } catch (e) {
    safeLog({
      entityType, entityId,
      to: [base.to, base.cc, base.bcc].filter(Boolean).join(" | "),
      subject: subjectFinal, status: "error",
      providerId: null, error: e?.message || String(e)
    });
    throw e;
  }
}

/* Verificación SMTP opcional al iniciar (útil para debug) */
export async function verifyTransport() {
  const t = getTransporter();
  if (!t) { console.log("[mailer] disabled"); return false; }
  try {
    await t.verify();
    console.log("[mailer] SMTP ok:", t.options.host, t.options.port, t.options.secure ? "secure" : "starttls");
    return true;
  } catch (e) {
    console.error("[mailer] verify failed:", e?.message || e);
    return false;
  }
}
