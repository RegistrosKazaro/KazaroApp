// server/src/middleware/auth.js
import jwt from "jsonwebtoken";
import { env } from "../utils/env.js";
import { getUserForLogin, getUserRoles } from "../db.js";

async function comparePassword(input, userRow) {
  const hash = userRow?.password_hash || "";

  if (typeof hash === "string" && /^\$2[aby]\$/.test(hash)) {
    try {
      let bcrypt;
      try { bcrypt = await import("bcrypt"); }
      catch { bcrypt = await import("bcryptjs"); }
      return await bcrypt.compare(input, hash);
    } catch (e) {
      if (env.DEBUG_AUTH) console.error("[auth] bcrypt compare:", e?.message || e);
    }
  }

  if (typeof hash === "string" && hash.startsWith("$argon2")) {
    try {
      const argon2 = await import("argon2");
      return await argon2.verify(hash, input);
    } catch (e) {
      console.error("[auth] Argon2 no disponible o fallo:", e?.message || e);
    }
  }

  if (userRow?.password_plain != null) {
    return String(userRow.password_plain) === String(input);
  }

  return false;
}

export async function loginHandler(req, res) {
  try {
    const { user, username, email, password } = req.body || {};
    const ident = user ?? username ?? email;
    if (!ident || !password) {
      return res.status(400).json({ error: "Faltan credenciales" });
    }

    const u = getUserForLogin(ident);
    if (!u) return res.status(401).json({ error: "Usuario o contraseña inválidos" });

    if (String(u.is_active ?? "1") === "0") {
      return res.status(403).json({ error: "Usuario inactivo" });
    }

    const ok = await comparePassword(password, u);
    if (!ok) return res.status(401).json({ error: "Usuario o contraseña inválidos" });

    const roles = getUserRoles(u.id) || [];

    const token = jwt.sign({ id: Number(u.id), username: u.username }, env.JWT_SECRET, { expiresIn: "12h" });
    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      maxAge: 12 * 60 * 60 * 1000,
      path: "/",
    });

    return res.json({ id: Number(u.id), username: u.username, roles });
  } catch (e) {
    console.error("[auth] login error:", e?.message || e);
    return res.status(500).json({ error: "Error interno" });
  }
}

export function requireAuth(req, res, next) {
  try {
    if (req.session?.user?.id) {
      req.user = {
        id: Number(req.session.user.id),
        username: req.session.user.username,
        email: req.session.user.email,
      };
      return next();
    }

    const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    let token = bearer;
    if (!token && req.headers.cookie) {
      const m = req.headers.cookie.match(/(?:^|;\s*)token=([^;]+)/i);
      if (m) token = decodeURIComponent(m[1]);
    }
    if (token) {
      try {
        const p = jwt.verify(token, env.JWT_SECRET);
        req.user = { id: Number(p.id), username: p.username };
        return next();
      } catch {/* token inválido */}
    }

    if (env.NODE_ENV !== "production" && req.headers["x-user-id"]) {
      req.user = { id: Number(req.headers["x-user-id"]) };
      return next();
    }

    return res.status(401).json({ error: "No autenticado" });
  } catch (e) {
    console.error("[auth] requireAuth error:", e?.message || e);
    return res.status(401).json({ error: "No autenticado" });
  }
}

export function requireRole(allowed) {
  const allow = (Array.isArray(allowed) ? allowed : [allowed])
    .map((r) => String(r).toLowerCase());
  const mapSyn = (r) => (r === "admin" ? "administrativo" : r);

  return (req, res, next) => {
    try {
      if (!req.user?.id) return res.status(401).json({ error: "No autenticado" });
      const roles = (getUserRoles(req.user.id) || []).map((r) => String(r).toLowerCase());
      const rolesNorm = roles.map(mapSyn);
      const allowedNorm = allow.map(mapSyn);
      const ok = rolesNorm.some((r) => allowedNorm.includes(r));
      if (!ok) return res.status(403).json({ error: "Sin permiso" });
      return next();
    } catch (e) {
      console.error("[auth] requireRole error:", e?.message || e);
      return res.status(403).json({ error: "Sin permiso" });
    }
  };
}
