// server/src/utils/mailer.js
import nodemailer from "nodemailer";
import { env } from "./env.js";
import { logEmail } from "../db.js";

let transporter;

/* ================= Helpers ================= */
function parseAddress(input) {
  const s = String(input || "").trim();
  if (!s) return { name: "", email: "" };

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


function pickFirstEmail(val) {
  const s = String(val || "").trim();
  if (!s) return "";
  return s.split(/[;,]+/).map(t => t.trim()).filter(Boolean)[0] || "";
}


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

export async function sendMail({
  to,                 
  cc,                 
  bcc,            
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
    safeLog({ entityType, entityId, to: "", subject, status: "disabled", providerId: null, error: "MAIL_DISABLE=1" });
    return { disabled: true };
  }

  // Remitente del sistema
  const parsed = parseAddress(env.MAIL_FROM);
  const systemEmail = (parsed.email || pickFirstEmail(env.SMTP_USER) || "no-reply@example.com").trim();
  const systemName  = (parsed.name  || systemTag || "Kazaro").trim();

  // ===== Construcción de destinatarios =====
  const alwaysInclude = unionEmails(env.MAIL_TO);          
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
    from: fmt(fromDisplayName, systemEmail),   
    sender: fmt(systemName, systemEmail),      
    ...(userEmail ? { replyTo: fmt(requester || userEmail, userEmail) } : {}),
  };

  const riskyUserFrom = !!(
    displayAsUser &&
    String(env.MAIL_ALLOW_USER_FROM || "").trim() === "1" &&
    userEmail
  );

  try {
    if (riskyUserFrom) {
      
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
export async function verifyTransport (){
  const t = getTransporter();
  if (!t){
    console.log("[mailer] disabled (MAIL_DISABLE=1 o sin config SMTP)");
    return false;
  }

  const envName = env.NODE_ENV || process.env.NODE_ENV || "development";
  if (envName === "development"){
    console.log("[mailer] verify skipped en modo desarrollo");
    return false;
  }
  try{
    await t.verify();
    console.log(
      "[mailer] SMTP ok:",
      t.options.host,
      t.options.port,
      t.options.secure ? "secure" : "strattls"
    );
    return true;
  } catch(e){
    console.warn("[mailer] verify failed (se continua igual):",     
      e?.message || e

    );
    return false;
  }
}