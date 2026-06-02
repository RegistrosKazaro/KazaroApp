// server/src/utils/mailer.js  ← REEMPLAZA el archivo actual
// Si empresaId no se pasa (o es null), usa el .env global exactamente igual que antes.
// Kazaro no nota ninguna diferencia.
import nodemailer from "nodemailer";
import { env } from "./env.js";
import { logEmail } from "../db.js";
import { getMailConfigForEmpresa } from "./empresa.js";

const _transporters = new Map();

const EMAIL_RE = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/i;
function isValidEmail(s) { return EMAIL_RE.test(String(s || "").trim()); }

function parseAddress(input) {
  const s = String(input || "").trim();
  if (!s) return { name: "", email: "" };
  const m = s.match(/^(.*)<([^>]+)>$/);
  if (m) return { name: m[1].trim().replace(/^"|"$/g, ""), email: m[2].trim() };
  if (isValidEmail(s)) return { name: "", email: s };
  return { name: s, email: "" };
}

function pickFirstEmail(val) {
  const s = String(val || "").trim();
  if (!s) return "";
  return s.split(/[;,]+/).map((t) => t.trim()).filter(Boolean)[0] || "";
}

function parseList(listOrArray) {
  if (Array.isArray(listOrArray))
    return listOrArray.map((x) => String(x || "").trim()).filter(Boolean);
  return String(listOrArray || "").split(/[;,]+/).map((s) => s.trim()).filter(Boolean);
}

const fmt = (name, email) => {
  const e = String(email || "").trim();
  if (!e) return "";
  const n = String(name || "").trim().replace(/"/g, "'");
  return n ? `"${n}" <${e}>` : e;
};

function unionEmails(...lists) {
  const out = [], seen = new Set();
  for (const l of lists) {
    for (const raw of parseList(l)) {
      const e = raw.trim(), key = e.toLowerCase();
      if (!key || !isValidEmail(e) || seen.has(key)) continue;
      seen.add(key); out.push(e);
    }
  }
  return out;
}

function minusEmails(list, blockList) {
  if (!blockList?.length) return list;
  const blocked = new Set(blockList.map((e) => e.toLowerCase()));
  return list.filter((e) => !blocked.has(e.toLowerCase()));
}

function safeLog(payload) {
  try { logEmail(payload); } catch {}
}

function resolveMailConfig(empresaId) {
  const globalEnv = {
    SMTP_HOST: env.SMTP_HOST, SMTP_PORT: env.SMTP_PORT,
    SMTP_SECURE: env.SMTP_SECURE, SMTP_USER: env.SMTP_USER, SMTP_PASS: env.SMTP_PASS,
    MAIL_FROM: env.MAIL_FROM, MAIL_TO: env.MAIL_TO,
    MAIL_CC: env.MAIL_CC, MAIL_BCC: env.MAIL_BCC,
    MAIL_DISABLE: env.MAIL_DISABLE, MAIL_BLOCKLIST: env.MAIL_BLOCKLIST,
  };
  if (empresaId == null) return globalEnv;
  return getMailConfigForEmpresa(empresaId, globalEnv);
}

function getTransporter(cfg, cacheKey) {
  if (String(cfg.MAIL_DISABLE || "").trim() === "1") return null;
  if (_transporters.has(cacheKey)) return _transporters.get(cacheKey);
  const host = String(cfg.SMTP_HOST || "").trim();
  if (!host) return null;
  const secure = cfg.SMTP_SECURE === true || String(cfg.SMTP_SECURE || "").trim().toLowerCase() === "true";
  const port   = Number(cfg.SMTP_PORT || 0) || (secure ? 465 : 587);
  const user   = pickFirstEmail(cfg.SMTP_USER);
  const pass   = String(cfg.SMTP_PASS || "");
  const auth   = user && pass ? { user, pass } : undefined;
  const t = nodemailer.createTransport({ host, port, secure, auth });
  _transporters.set(cacheKey, t);
  return t;
}

export async function sendMail({
  to, cc, bcc, subject, text, html, attachments,
  entityType, entityId,
  displayAsUser = false,
  userName = null,
  userEmail = null,
  systemTag = null,
  empresaId = null,       // ← NUEVO (opcional)
  empresaNombre = null,   // ← NUEVO (opcional, para branding)
}) {
  const cfg      = resolveMailConfig(empresaId);
  const cacheKey = empresaId ?? "global";
  const t        = getTransporter(cfg, cacheKey);
  const brandName = empresaNombre || systemTag || "Kazaro Pedidos";

  if (!t) {
    const error = "MAIL_DISABLED_OR_NOT_CONFIGURED";
    safeLog({ entityType, entityId, to: String(to || ""), subject, status: "error", providerId: null, error });
    throw new Error(error);
  }

  const parsed      = parseAddress(cfg.MAIL_FROM);
  const systemEmail = (parsed.email || pickFirstEmail(cfg.SMTP_USER) || "no-reply@example.com").trim();
  const systemName  = (parsed.name || brandName).trim();

  const alwaysInclude = unionEmails(cfg.MAIL_TO);
  const toList  = unionEmails(to, alwaysInclude);
  const ccList  = unionEmails(cc, cfg.MAIL_CC);
  const bccList = unionEmails(bcc, cfg.MAIL_BCC);

  const block   = parseList(cfg.MAIL_BLOCKLIST).filter(isValidEmail);
  const toFinal = minusEmails(toList, block);
  const ccFinal = minusEmails(ccList, block);
  const bccFinal= minusEmails(bccList, block);

  if (toFinal.length + ccFinal.length + bccFinal.length === 0) {
    const error = "NO_RECIPIENTS";
    safeLog({ entityType, entityId, to: "", subject, status: "error", providerId: null, error });
    throw new Error(error);
  }

  let subjectFinal = String(subject || "").trim();
  const requester  = String(userName || "").trim();
  if (requester) {
    const esc = requester.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(esc, "i").test(subjectFinal)) {
      subjectFinal = subjectFinal
        ? `${subjectFinal} — Solicitante: ${requester}`
        : `Solicitante: ${requester}`;
    }
  }

  const headers = {};
  if (entityType && entityId) headers["X-Kazaro-Entity"] = `${entityType}#${entityId}`;

  const base = {
    to: toFinal.join(", "),
    cc: ccFinal.length  ? ccFinal.join(", ")  : undefined,
    bcc: bccFinal.length ? bccFinal.join(", ") : undefined,
    subject: subjectFinal, text, html, attachments, headers,
  };

  const fromDisplayName = requester || systemName;
  const safeFrom = fmt(fromDisplayName, systemEmail) || systemEmail;
  const replyTo  = isValidEmail(userEmail) ? fmt(requester || userEmail, userEmail) : undefined;
  const safeOpts = { ...base, from: safeFrom, sender: fmt(systemName, systemEmail) || systemEmail, ...(replyTo ? { replyTo } : {}) };
  const allowUserFrom = Boolean(env.MAIL_ALLOW_USER_FROM);
  const logTo = [base.to, base.cc, base.bcc].filter(Boolean).join(" | ");

  try {
    if (displayAsUser && allowUserFrom && isValidEmail(userEmail)) {
      try {
        const info = await t.sendMail({ ...base, from: fmt(requester || userEmail, userEmail), sender: fmt(systemName, systemEmail) || systemEmail, ...(replyTo ? { replyTo } : {}) });
        safeLog({ entityType, entityId, to: logTo, subject: subjectFinal, status: "sent", providerId: info.messageId || info.response, error: null });
        return info;
      } catch {}
    }
    const info = await t.sendMail(safeOpts);
    safeLog({ entityType, entityId, to: logTo, subject: subjectFinal, status: "sent", providerId: info.messageId || info.response, error: null });
    return info;
  } catch (e) {
    safeLog({ entityType, entityId, to: logTo, subject: subjectFinal, status: "error", providerId: null, error: e?.message || String(e) });
    throw e;
  }
}

export async function verifyTransport({ force = false, empresaId = null } = {}) {
  const cfg = resolveMailConfig(empresaId);
  const t   = getTransporter(cfg, empresaId ?? "global");
  if (!t) { console.log("[mailer] disabled o sin config"); return { ok: false, skipped: true, reason: "disabled_or_missing_config" }; }
  const envName = env.NODE_ENV || "development";
  if (!force && envName === "development") { console.log("[mailer] verify skipped en dev"); return { ok: false, skipped: true, reason: "dev_skipped" }; }
  try {
    await t.verify();
    console.log("[mailer] SMTP ok:", t.options.host, t.options.port);
    return { ok: true, skipped: false };
  } catch (e) {
    console.warn("[mailer] verify failed:", e?.message || e);
    return { ok: false, skipped: false, reason: e?.message || String(e) };
  }
}