// server/src/utils/mailer.js
import nodemailer from "nodemailer";
import { env } from "./env.js";
import { logEmail } from "../db.js";

let transporter;

/* ================= Helpers ================= */
const EMAIL_RE =
  // intentionally simple; we only need to filter clearly invalid tokens
  /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/i;

function isValidEmail(s) {
  return EMAIL_RE.test(String(s || "").trim());
}

function parseAddress(input) {
  const s = String(input || "").trim();
  if (!s) return { name: "", email: "" };

  const m = s.match(/^(.*)<([^>]+)>$/);
  if (m) {
    const name = m[1].trim().replace(/^"|"$/g, "");
    const email = m[2].trim();
    return { name, email };
  }
  // If it's only an email
  if (isValidEmail(s)) return { name: "", email: s };
  // Otherwise, return as name (no email)
  return { name: s, email: "" };
}

function pickFirstEmail(val) {
  const s = String(val || "").trim();
  if (!s) return "";
  return (
    s.split(/[;,]+/)
      .map((t) => t.trim())
      .filter(Boolean)[0] || ""
  );
}

function parseList(listOrArray) {
  if (Array.isArray(listOrArray)) {
    return listOrArray
      .map((x) => String(x || "").trim())
      .filter(Boolean);
  }
  return String(listOrArray || "")
    .split(/[;,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// formats "Name <email>" safely; returns just email if no name.
// IMPORTANT: If email is missing, returns empty string (caller must handle).
const fmt = (name, email) => {
  const e = String(email || "").trim();
  if (!e) return "";
  const n = String(name || "")
    .trim()
    .replace(/"/g, "'");

  return n ? `"${n}" <${e}>` : e;
};

// union + dedupe (case-insensitive) + email validation
function unionEmails(...lists) {
  const out = [];
  const seen = new Set();

  for (const l of lists) {
    for (const raw of parseList(l)) {
      const e = raw.trim();
      const key = e.toLowerCase();
      if (!key) continue;
      if (!isValidEmail(e)) continue;

      if (!seen.has(key)) {
        seen.add(key);
        out.push(e);
      }
    }
  }
  return out;
}

// filter using blocklist (case-insensitive)
function minusEmails(list, blockList) {
  if (!blockList || !blockList.length) return list;
  const blocked = new Set(blockList.map((e) => e.toLowerCase()));
  return list.filter((e) => !blocked.has(e.toLowerCase()));
}

function safeLog(payload) {
  try {
    logEmail(payload);
  } catch {
    // avoid breaking business flow due to logging
  }
}

/* ================= Transporter ================= */
function getTransporter() {
  if (String(env.MAIL_DISABLE || "").trim() === "1") return null;
  if (transporter) return transporter;

  const host = String(env.SMTP_HOST || "").trim();
  const secure =
    env.SMTP_SECURE === true ||
    String(env.SMTP_SECURE || "").trim().toLowerCase() === "true";

  const port = Number(env.SMTP_PORT || 0) || (secure ? 465 : 587);
  const user = pickFirstEmail(env.SMTP_USER);
  const pass = String(env.SMTP_PASS || "");

  if (!host) return null;

  // For Gmail/most providers you need auth; keep optional for internal relays.
  const auth = user && pass ? { user, pass } : undefined;

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth,
  });

  return transporter;
}

/* ================= Public API ================= */
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
    const error =
      "MAIL_DISABLED_OR_NOT_CONFIGURED: configure SMTP_* (or set MAIL_DISABLE=1 to disable email)";
    safeLog({
      entityType,
      entityId,
      to: String(to || ""),
      subject,
      status: "error",
      providerId: null,
      error,
    });
    throw new Error(error);
  }

  // System sender
  const parsed = parseAddress(env.MAIL_FROM);
  const systemEmail = (
    parsed.email ||
    pickFirstEmail(env.SMTP_USER) ||
    "no-reply@example.com"
  ).trim();

  const systemName = (parsed.name || systemTag || "Kazaro").trim();

  // Recipients
  const alwaysInclude = unionEmails(env.MAIL_TO);
  const toList = unionEmails(to, alwaysInclude);
  const ccList = unionEmails(cc, env.MAIL_CC);
  const bccList = unionEmails(bcc, env.MAIL_BCC);

  const block = parseList(env.MAIL_BLOCKLIST).filter(isValidEmail);
  const toFinal = minusEmails(toList, block);
  const ccFinal = minusEmails(ccList, block);
  const bccFinal = minusEmails(bccList, block);

  if (toFinal.length + ccFinal.length + bccFinal.length === 0) {
    const error =
      "NO_RECIPIENTS: no hay destinatarios válidos (revisar MAIL_TO / to / cc / bcc / MAIL_BLOCKLIST)";
    safeLog({
      entityType,
      entityId,
      to: "",
      subject,
      status: "error",
      providerId: null,
      error,
    });
    throw new Error(error);
  }

  // Subject
  let subjectFinal = String(subject || "").trim();
  const requester = String(userName || "").trim();
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
    cc: ccFinal.length ? ccFinal.join(", ") : undefined,
    bcc: bccFinal.length ? bccFinal.join(", ") : undefined,
    subject: subjectFinal,
    text,
    html,
    attachments,
    headers,
  };

  // From (safe): always from system account (best deliverability)
  const fromDisplayName = requester || systemName;
  const safeFrom = fmt(fromDisplayName, systemEmail) || systemEmail;

  // Reply-to: if we have a valid user email, let receiver respond to them
  const replyTo = isValidEmail(userEmail) ? fmt(requester || userEmail, userEmail) : undefined;

  const safeOpts = {
    ...base,
    from: safeFrom,
    sender: fmt(systemName, systemEmail) || systemEmail,
    ...(replyTo ? { replyTo } : {}),
  };

  const allowUserFrom = Boolean(env.MAIL_ALLOW_USER_FROM);

  try {
    // Optional "display as user": only if explicitly enabled AND a valid userEmail exists.
    if (displayAsUser && allowUserFrom && isValidEmail(userEmail)) {
      const riskyFrom = fmt(requester || userEmail, userEmail);
      const risky = {
        ...base,
        from: riskyFrom,
        sender: fmt(systemName, systemEmail) || systemEmail,
        ...(replyTo ? { replyTo } : {}),
      };

      try {
        const info = await t.sendMail(risky);
        safeLog({
          entityType,
          entityId,
          to: [base.to, base.cc, base.bcc].filter(Boolean).join(" | "),
          subject: subjectFinal,
          status: "sent",
          providerId: info.messageId || info.response,
          error: null,
        });
        return info;
      } catch {
        // fallback to safe sender
      }
    }

    const info = await t.sendMail(safeOpts);
    safeLog({
      entityType,
      entityId,
      to: [base.to, base.cc, base.bcc].filter(Boolean).join(" | "),
      subject: subjectFinal,
      status: "sent",
      providerId: info.messageId || info.response,
      error: null,
    });
    return info;
  } catch (e) {
    safeLog({
      entityType,
      entityId,
      to: [base.to, base.cc, base.bcc].filter(Boolean).join(" | "),
      subject: subjectFinal,
      status: "error",
      providerId: null,
      error: e?.message || String(e),
    });
    throw e;
  }
}

/* ================= Diagnostics ================= */
export async function verifyTransport({ force = false } = {}) {
  const t = getTransporter();
  if (!t) {
    console.log("[mailer] disabled (MAIL_DISABLE=1 o sin config SMTP)");
    return { ok: false, skipped: true, reason: "disabled_or_missing_config" };
  }

  const envName = env.NODE_ENV || process.env.NODE_ENV || "development";
  if (!force && envName === "development") {
    console.log("[mailer] verify skipped en modo desarrollo (set MAIL_VERIFY_ON_BOOT=1 para forzar)");
    return { ok: false, skipped: true, reason: "dev_skipped" };
  }

  try {
    await t.verify();
    console.log("[mailer] SMTP ok:", t.options.host, t.options.port, t.options.secure ? "secure" : "starttls");
    return { ok: true, skipped: false };
  } catch (e) {
    console.warn("[mailer] verify failed:", e?.message || e);
    return { ok: false, skipped: false, reason: e?.message || String(e) };
  }
}
