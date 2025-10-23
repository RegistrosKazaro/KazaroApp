// server/src/middleware/auth.js
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { env } from "../utils/env.js";
import { getUserForLogin, getUserById, getUserRoles, listServicesByUser } from "../db.js";

/* ================== Password compare (argon2 / bcrypt / md5 / sha1 / plano) ================== */
async function comparePassword(input, userRow) {
  const pass = String(input ?? "");
  const hash = String(userRow?.password_hash || "").trim();
  const plain = String(userRow?.password_plain ?? "");

  // argon2
  if (hash.toLowerCase().startsWith("$argon2")) {
    try {
      const { default: argon2 } = await import("argon2");
      if (await argon2.verify(hash, pass)) return true;
    } catch (e) {
      if (env.DEBUG_AUTH) console.error("[auth] argon2:", e?.message || e);
    }
  }

  // bcrypt / bcryptjs ($2a$ / $2b$ / $2y$)
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

  // MD5 heredado
  if (/^[a-f0-9]{32}$/i.test(hash)) {
    const md5 = crypto.createHash("md5").update(pass).digest("hex");
    if (md5.toLowerCase() === hash.toLowerCase()) return true;
  }

  // SHA1 heredado
  if (/^[a-f0-9]{40}$/i.test(hash)) {
    const sha1 = crypto.createHash("sha1").update(pass).digest("hex");
    if (sha1.toLowerCase() === hash.toLowerCase()) return true;
  }

  // plano
  if (plain) return plain === pass;

  return false;
}

/* ================== JWT helpers ================== */
function signToken(userId) {
  return jwt.sign({ uid: Number(userId) }, env.JWT_SECRET || "dev-secret", { expiresIn: "12h" });
}
function readTokenFromReq(req) {
  // Authorization: Bearer <token>
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (bearer) return bearer;

  // Cookie "token" (principal) o "sid" (compat)
  const rawCookie = req.headers.cookie || "";
  const mToken = rawCookie.match(/(?:^|;\s*)token=([^;]+)/i);
  const mSid   = rawCookie.match(/(?:^|;\s*)sid=([^;]+)/i);
  if (mToken) return decodeURIComponent(mToken[1]);
  if (mSid)   return decodeURIComponent(mSid[1]);
  return null;
}

/* ================== Login handler (opcional si lo usás desde routes) ================== */
export async function loginHandler(req, res) {
  try {
    const { user, username, email, password } = req.body || {};
    const ident = String(user ?? username ?? email ?? "").trim();
    const pass  = String(password ?? "");

    if (!ident || !pass) return res.status(400).json({ ok: false, error: "Faltan credenciales" });

    const u = getUserForLogin(ident);
    if (!u) return res.status(401).json({ ok: false, error: "Usuario o contraseña inválidos" });

    // inactivo?
    const active = String(u.is_active ?? "1").trim();
    if (["0", "false", "no", "inactivo", "disabled"].includes(active.toLowerCase())) {
      return res.status(403).json({ ok: false, error: "Usuario inactivo" });
    }

    const ok = await comparePassword(pass, u);
    if (!ok) return res.status(401).json({ ok: false, error: "Usuario o contraseña inválidos" });

    const token = signToken(u.id);
    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      maxAge: 12 * 60 * 60 * 1000, // 12h
      path: "/",
    });
    // Compat
    res.cookie("sid", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      maxAge: 12 * 60 * 60 * 1000,
      path: "/",
    });

    const roles = getUserRoles(u.id) || [];
    const services = listServicesByUser(u.id) || [];

    return res.json({
      ok: true,
      user: {
        id: Number(u.id),
        username: u.username ?? null,
        email: u.email ?? null,
        roles,
        services,
      },
    });
  } catch (e) {
    console.error("[auth] login error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "Error interno" });
  }
}

/* ================== requireAuth ================== */
export function requireAuth(req, res, next) {
  try {
    const raw = readTokenFromReq(req);
    if (!raw) return res.status(401).json({ ok: false });

    const payload = jwt.verify(raw, env.JWT_SECRET || "dev-secret");
    const user = getUserById(payload?.uid);
    if (!user?.id) return res.status(401).json({ ok: false });

    const roles = getUserRoles(user.id) || [];
    const services = listServicesByUser(user.id) || [];

    req.user = {
      id: Number(user.id),
      username: user.username ?? null,
      email: user.email ?? null,
      roles,
      services,
    };
    return next();
  } catch (e) {
    if (env.DEBUG_AUTH) console.error("[auth] requireAuth:", e?.message || e);
    return res.status(401).json({ ok: false });
  }
}

/* ================== requireRole (sinónimos sin mezclar perfiles) ================== */
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
