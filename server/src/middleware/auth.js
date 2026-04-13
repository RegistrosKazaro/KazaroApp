// server/src/middleware/auth.js  ← REEMPLAZA el archivo actual
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { env } from "../utils/env.js";
import { getUserForLogin, getUserById, getUserRoles, listServicesByUser } from "../db.js";
import { getEmpresaIdForUser } from "../db_multiempresa_patch.js";

async function comparePassword(input, userRow) {
  const pass = String(input ?? "");
  const hash = String(userRow?.password_hash || "").trim();
  const plain = String(userRow?.password_plain ?? "");

  if (hash.toLowerCase().startsWith("$argon2")) {
    try {
      const { default: argon2 } = await import("argon2");
      if (await argon2.verify(hash, pass)) return true;
    } catch (e) {
      if (env.DEBUG_AUTH) console.error("[auth] argon2:", e?.message || e);
    }
  }

  if (/^\$2[aby]\$/.test(hash)) {
    try {
      let bcrypt;
      try { ({ default: bcrypt } = await import("bcrypt")); }
      catch { ({ default: bcrypt } = await import("bcryptjs")); }
      if (await bcrypt.compare(pass, hash)) return true;
    } catch (e) {
      if (env.DEBUG_AUTH) console.error("[auth] bcrypt:", e?.message || e);
    }
  }

  if (/^[a-f0-9]{32}$/i.test(hash)) {
    const md5 = crypto.createHash("md5").update(pass).digest("hex");
    if (md5.toLowerCase() === hash.toLowerCase()) return true;
  }

  if (/^[a-f0-9]{40}$/i.test(hash)) {
    const sha1 = crypto.createHash("sha1").update(pass).digest("hex");
    if (sha1.toLowerCase() === hash.toLowerCase()) return true;
  }

  if (plain) return plain === pass;
  return false;
}

// empresaId es opcional; si se pasa queda en el token como claim "eid"
export function signToken(userId, empresaId = null) {
  const payload = { uid: Number(userId) };
  if (empresaId != null) payload.eid = Number(empresaId);
  return jwt.sign(payload, env.JWT_SECRET || "dev-secret", { expiresIn: "12h" });
}

function readTokenFromReq(req) {
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (bearer) return bearer;
  const rawCookie = req.headers.cookie || "";
  const mToken = rawCookie.match(/(?:^|;\s*)token=([^;]+)/i);
  const mSid   = rawCookie.match(/(?:^|;\s*)sid=([^;]+)/i);
  if (mToken) return decodeURIComponent(mToken[1]);
  if (mSid)   return decodeURIComponent(mSid[1]);
  return null;
}

export function requireAuth(req, res, next) {
  try {
    const raw = readTokenFromReq(req);
    if (!raw) return res.status(401).json({ ok: false });

    const payload = jwt.verify(raw, env.JWT_SECRET || "dev-secret");
    const user = getUserById(payload?.uid);
    if (!user?.id) return res.status(401).json({ ok: false });

    const roles    = getUserRoles(user.id) || [];
    const services = listServicesByUser(user.id) || [];
    const empresaId = payload?.eid ?? getEmpresaIdForUser(user.id) ?? null;

    req.user = {
      id: Number(user.id),
      username: user.username ?? null,
      email: user.email ?? null,
      roles,
      services,
      empresaId,
    };
    return next();
  } catch (e) {
    if (env.DEBUG_AUTH) console.error("[auth] requireAuth:", e?.message || e);
    return res.status(401).json({ ok: false });
  }
}

function expandAllowed(allowed) {
  const arr = Array.isArray(allowed) ? allowed : [allowed];
  const set = new Set();
  for (const r of arr) {
    const s = String(r || "").trim().toLowerCase();
    if (s === "admin" || s === "administrador") { set.add("admin"); set.add("administrador"); }
    else set.add(s);
  }
  return Array.from(set);
}

export function requireRole(allowed) {
  const allow = expandAllowed(allowed);
  return (req, res, next) => {
    try {
      if (!req.user?.id) return res.status(401).json({ ok: false });
      const roles = (req.user.roles?.length ? req.user.roles : getUserRoles(req.user.id) || [])
        .map((r) => String(r).toLowerCase());
      const ok = roles.some((r) => allow.includes(r));
      if (!ok) return res.status(403).json({ ok: false, error: "Sin permiso" });
      next();
    } catch (e) {
      if (env.DEBUG_AUTH) console.error("[auth] requireRole:", e?.message || e);
      return res.status(403).json({ ok: false, error: "Sin permiso" });
    }
  };
}