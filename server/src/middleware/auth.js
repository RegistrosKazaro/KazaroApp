import jwt from "jsonwebtoken";
import crypto from "crypto";
import { env } from "../utils/env.js";
import { getUserForLogin, getUserById } from "../db.js";

/* =================== Helpers de hash =================== */

function norm(s) {
  return String(s ?? "").trim();
}
function isHex(str) {
  return /^[0-9a-f]+$/i.test(str);
}
function hashHex(alg, data) {
  return crypto.createHash(alg).update(data).digest("hex");
}

/**
 * Verifica contraseñas contra múltiples formatos:
 * - Argon2id  -> $argon2...
 * - Bcrypt    -> $2a$ / $2b$ / $2y$
 * - MD5/SHA1/SHA256/SHA512 -> hex (32/40/64/128)
 * - Con sal tipo "salt:hash" o "hash:salt" (proba salt+pass y pass+salt)
 * - Pepper opcional en env.PASSWORD_PEPPER
 */
async function verifyHashMulti(inputRaw, storedRaw) {
  const input = norm(inputRaw);
  const stored = norm(storedRaw);
  if (!stored) return false;

  // Argon2
  if (stored.startsWith("$argon2")) {
    try {
      const argon2 = await import("argon2");
      return await argon2.verify(stored, input);
    } catch (e) {
      console.error("[auth] faltante 'argon2' para verificar hashes Argon2id.");
      // devolvemos un objeto especial para que el handler responda 500 explícito
      return { missingArgon2: true };
    }
  }

  // Bcrypt
  if (/^\$2[aby]\$/.test(stored)) {
    const bcryptjs = await import("bcryptjs");
    return bcryptjs.compare(input, stored);
  }

  const pepper = env.PASSWORD_PEPPER ? String(env.PASSWORD_PEPPER) : "";

  // Hex puro (sin sal)
  if (isHex(stored)) {
    const len = stored.length;
    const cand = [];
    if (len === 32)  cand.push(hashHex("md5", input), hashHex("md5", input + pepper));
    if (len === 40)  cand.push(hashHex("sha1", input), hashHex("sha1", input + pepper));
    if (len === 64)  cand.push(hashHex("sha256", input), hashHex("sha256", input + pepper));
    if (len === 128) cand.push(hashHex("sha512", input), hashHex("sha512", input + pepper));
    return cand.some((h) => h.toLowerCase() === stored.toLowerCase());
  }

  // Formatos con sal (salt:hash o hash:salt)
  if (stored.includes(":") || stored.includes("$")) {
    const sep = stored.includes(":") ? ":" : "$";
    const [a, b] = stored.split(sep);
    // Intento 1: salt:hash
    if (isHex(b)) {
      const len = b.length;
      const salt = a;
      const combos = [
        ["md5", 32],
        ["sha1", 40],
        ["sha256", 64],
        ["sha512", 128],
      ];
      for (const [alg, hexLen] of combos) {
        if (len === hexLen) {
          const h1 = hashHex(alg, salt + input);
          const h2 = hashHex(alg, input + salt);
          const h3 = pepper ? hashHex(alg, salt + input + pepper) : null;
          const h4 = pepper ? hashHex(alg, input + salt + pepper) : null;
          if ([h1, h2, h3, h4].filter(Boolean).some((h) => h.toLowerCase() === b.toLowerCase())) return true;
        }
      }
    }
    // Intento 2: hash:salt (hash primero)
    if (isHex(a)) {
      const len = a.length;
      const salt = b;
      const combos = [
        ["md5", 32],
        ["sha1", 40],
        ["sha256", 64],
        ["sha512", 128],
      ];
      for (const [alg, hexLen] of combos) {
        if (len === hexLen) {
          const h1 = hashHex(alg, salt + input);
          const h2 = hashHex(alg, input + salt);
          const h3 = pepper ? hashHex(alg, salt + input + pepper) : null;
          const h4 = pepper ? hashHex(alg, input + salt + pepper) : null;
          if ([h1, h2, h3, h4].filter(Boolean).some((h) => h.toLowerCase() === a.toLowerCase())) return true;
        }
      }
    }
  }

  // Último intento: igual plano (por si la columna guarda texto plano con espacios)
  return stored === input;
}

/* =================== Handlers =================== */

export async function loginHandler(req, res) {
  try {
    const { user, username, email, password } = req.body || {};
    const ident = user ?? username ?? email;
    if (!ident || !password) {
      return res.status(400).json({ error: "Faltan credenciales" });
    }

    const u = getUserForLogin(ident);
    if (!u) return res.status(401).json({ error: "Usuario o contraseña inválidos" });

    // Si existe hash, probá todas las variantes
    let ok = false;
    if (u.password_hash) {
      const r = await verifyHashMulti(password, u.password_hash);
      if (typeof r === "object" && r?.missingArgon2) {
        return res.status(500).json({ error: "Servidor sin soporte Argon2: ejecutar `npm i argon2` en /server" });
      }
      ok = !!r;
    }

    // Fallback a password_plain si existe y no pasó el hash
    if (!ok && u.password_plain) {
      ok = String(password) === String(u.password_plain);
    }

    if (!ok) return res.status(401).json({ error: "Usuario o contraseña inválidos" });

    const token = jwt.sign({ uid: u.id }, env.JWT_SECRET, { expiresIn: "7d" });
    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.protocol === "https",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    const me = getUserById(u.id);
    return res.json(me);
  } catch (e) {
    console.error("[auth] login error:", e?.message || e);
    return res.status(500).json({ error: "Error interno" });
  }
}

export function requireAuth(req, res, next) {
  try {
    const hdr = req.get("Authorization");
    let token = req.cookies?.token || null;
    if (!token && hdr && /^Bearer\s+/i.test(hdr)) token = hdr.replace(/^Bearer\s+/i, "").trim();

    if (!token) return res.status(401).json({ error: "No autenticado" });
    const payload = jwt.verify(token, env.JWT_SECRET);
    const me = getUserById(payload?.uid);
    if (!me) return res.status(401).json({ error: "No autenticado" });
    req.user = me;
    return next();
  } catch (e) {
    return res.status(401).json({ error: "No autenticado" });
  }
}
