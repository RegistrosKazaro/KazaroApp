// middleware/auth.js
import jwt from "jsonwebtoken";
import { env } from "../utils/env.js";
import { getUserForLogin } from "../db.js";

async function comparePassword(input, userRow) {
  // 1) bcrypt/bcryptjs si hay hash tipo $2a/$2b
  const hash = userRow?.password_hash;
  if (hash && typeof hash === "string" && hash.startsWith("$2")) {
    try {
      let bcrypt;
      try { bcrypt = await import("bcrypt"); }
      catch { bcrypt = await import("bcryptjs"); }
      const ok = await bcrypt.compare(input, hash);
      return ok;
    } catch (e) {
      if (env.DEBUG_AUTH) console.log("[auth] bcrypt compare error:", e?.message || e);
      // si falla por módulo, no tiramos error: caemos al plano si existiera
    }
  }

  // 2) Plano si tu tabla tiene 'password' (getUserForLogin ya lo lee como password_plain)
  const plain = userRow?.password_plain;
  if (typeof plain === "string" && plain.length > 0) {
    return String(plain) === String(input);
  }

  return false;
}

export async function loginHandler(req, res) {
  try {
    const b = req.body || {};
    const userInput = b.username || b.user || b.email || "";
    const password  = b.password || "";

    if (!userInput || !password) {
      return res.status(400).json({ error: "Faltan credenciales" });
    }

    const u = getUserForLogin(userInput);
    if (env.DEBUG_AUTH) console.log("[auth] lookup:", { input: userInput, found: !!u });

    if (!u) return res.status(401).json({ error: "Usuario o contraseña inválidos" });
    if (String(u.is_active ?? "1") === "0") {
      return res.status(403).json({ error: "Usuario inactivo" });
    }

    const ok = await comparePassword(password, u);
    if (!ok) {
      if (env.DEBUG_AUTH) console.log("[auth] password mismatch");
      return res.status(401).json({ error: "Usuario o contraseña inválidos" });
    }

    // Session (si tu app ya la usa) + cookie JWT para compatibility
    if (req.session) {
      req.session.user = { id: Number(u.id), username: u.username, email: u.email };
    }

    const payload = { id: Number(u.id), username: u.username };
    const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: "12h" });

    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      maxAge: 12 * 60 * 60 * 1000,
    });

    return res.json({ ok: true, user: payload, token });
  } catch (e) {
    console.error("[auth] login error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
}

export function requireAuth(req, res, next) {
  try {
    // 1) Sesión clásica
    if (req.session?.user?.id) {
      req.user = { id: Number(req.session.user.id), username: req.session.user.username, email: req.session.user.email };
      return next();
    }

    // 2) JWT en Authorization o cookie
    const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    let token = bearer;
    if (!token && req.headers.cookie) {
      const m = req.headers.cookie.match(/(?:^|;\s*)token=([^;]+)/);
      if (m) token = decodeURIComponent(m[1]);
    }
    if (token) {
      try {
        const p = jwt.verify(token, env.JWT_SECRET);
        req.user = { id: Number(p.id), username: p.username };
        return next();
      } catch { /* sigue */ }
    }

    // 3) Dev fallback
    if (env.NODE_ENV !== "production" && req.headers["x-user-id"]) {
      req.user = { id: Number(req.headers["x-user-id"]) };
      return next();
    }

    return res.status(401).json({ error: "No autenticado" });
  } catch (e) {
    console.error("[auth] requireAuth error:", e);
    return res.status(401).json({ error: "No autenticado" });
  }
}
