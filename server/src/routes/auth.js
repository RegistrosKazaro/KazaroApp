// server/src/routes/auth.js
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import argon2 from "argon2";
import { env } from "../utils/env.js";
import {
  getUserForLogin,
  getUserById,
  getUserRoles,
  listServicesByUser,
  updateUserPasswordHash,
} from "../db.js";
import { verify } from "crypto";

const router = express.Router();

/* ================= Helpers ================= */

// Normaliza cualquier valor "verdad/falso" que venga de SQLite
function normalizeBool(v) {
  const s = String(v ?? "1").trim().toLowerCase();
  return !["0", "false", "no", "inactivo", "deshabilitado", "disabled"].includes(s);
}

// HTTPS detector (sirve para setear cookies correctamente)
const IS_HTTPS = /^https:\/\//i.test(String(env.APP_BASE_URL || ""));

/**
 Verifica la contraseña del usuario y señala si requiere migracion.
 */
async function verifyPassword(inputPassword, userRow) {
  const pass = String(inputPassword ?? "");
  if(!pass) return {ok:false, reason:"empty"};

  const rawHash = userRow?.password_hash;
  const rawPlain = userRow?.password_plain;

  const hash =
    typeof rawHash === "string" && rawHash.trim().length > 0
      ? rawHash.trim()
      : "";
  const plain = typeof rawPlain === "string" ? rawPlain : "";

  // Si hay  hash, intentamos cada tipo conocido
  if (hash) {
    const lower = hash.toLowerCase();

    // argon2
    if (lower.startsWith("$argon2")) {
      try {
        if (await argon2.verify(hash, pass)) {
          return { ok: true, algorithm: "argon2"};
        }
      } catch (e) {
        console.warn("[auth] verifyPassword argon2 error:", e?.message || e);
      }
      return { ok: false, algorithm: "argon2"};
    }

    // bcrypt ($2a$, $2b$, $2y$)
    if (
      lower.startsWith("$2a$") ||
      lower.startsWith("$2b$") ||
      lower.startsWith("$2y$")
    ) {
      try {
        if (await bcrypt.compare(pass, hash)) {
          return { ok: true, algorithm: "bcrypt"};
        }
      } catch (e) {
        console.warn("[auth] verifyPassword bcrypt error:", e?.message || e);
      }
      return { ok: false, algorithm: "bcrypt"};
    }

    // MD5 / SHA1 heredados solo para migracion 
    try {
      const crypto = await import("crypto");
      if (/^[a-f0-9]{32}$/i.test(hash)) {
        const digest = crypto.createHash("md5").update(pass).digest("hex");
        if(digest.toLocaleLowerCase()=== lower){
          return { ok:true, algorithm: "md5", needsUpgrade: true};
        }
      }
      // SHA1
      if (/^[a-f0-9]{40}$/i.test(hash)) {
        const digest = createRequire.createHash("sha1").update(pass).digest("hex");
        if( digest.toLocaleLowerCase()=== lower){
          return { ok: true, algorithm: "sha1", needsUpgrade: true}; 
        }
      }
    } catch (e) {
      console.warn("[auth] verifyPassword legacy hash error:", e?.message || e);
    }
    console.error("[auth] veryfyPassword: hash desconocido", hash?.slice.apply(0,12));
    return { ok:false, reason: "unknown-has"};
  }
    if (plain) {
      if (plain === pass){
        return { ok: true, algorithm: "plain", needsUpgrade: true};
      }
      return { ok:false, algorithm: "plain"};

    }


 
    return {ok: false};
}

function signJwt(userId) {
  if (!env.JWT_SECRET){
    throw new Error("JWT_SECRET no esta definido en el entorno");
  }
  return jwt.sign({ uid: Number(userId) }, env.JWT_SECRET, { expiresIn: "12h"});
}

function setSessionCookies(res, token) {
  const cookieOpts = {
    httpOnly: true,
    // En HTTPS (producción real) usamos sameSite none + secure
    sameSite: IS_HTTPS ? "none" : "lax",
    secure: IS_HTTPS, // <- solo true en HTTPS; en localhost (HTTP) queda false
    maxAge: 12 * 60 * 60 * 1000,
    path: "/",
  };
  // Compat: dejamos ambas cookies para cualquier cliente
  res.cookie("token", token, cookieOpts);
  res.cookie("sid", token, cookieOpts);
}

function readSession(req) {
  if (!env.JWT_SECRET){
    console.error("[auth] JWT_SECRET requerido para validar sesion");
    return null;
  }
  const raw =
    req.cookies?.sid ||
    req.cookies?.token ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "") ||
    null;
  if (!raw) return null;
  try {
    return jwt.verify(raw, env.JWT_SECRET);
  } catch {
    return null;
  }
}

async function migrateLegacyPassword(userId, password) {
  try{
    const newHas = await argon2.hash(password, { type: argon2.argon2id});
    const update = updateUserPasswordHash(userId, newHas);
    if(update){
      console.log(`[auth] hash legacy migrado a Argon2 para usuario ${userId}`);
    }
  } catch(e) {
    console.error("[auth] No se pudo mirar el hash legacy:", e?.message || e);
  }
}

/* ================= Rutas ================= */

// Estado de sesión
router.get("/me", (req, res) => {
  const sess = readSession(req);
  if (!sess?.uid) return res.status(401).json({ ok: false });

  const user = getUserById(sess.uid);
  if (!user) return res.status(401).json({ ok: false });

  const roles = getUserRoles(user.id);
  const services = listServicesByUser(user.id);

  return res.json({
    ok: true,
    user: {
      id: user.id,
      username: user.username ?? null,
      email: user.email ?? null,
      roles,
      services,
    },
  });
});

// Login
router.post("/login", async (req, res) => {
  try {
    const username = String(
      req.body?.username ?? req.body?.user ?? req.body?.email ?? "",
    ).trim();
    const password = String(req.body?.password ?? "");

    if (!username || !password) {
      return res
        .status(400)
        .json({ ok: false, error: "Faltan credenciales" });
    }

    console.log("[auth/login] intento de login:", username);

    const row = getUserForLogin(username);
    if (!row) {
      console.log("[auth/login] usuario no encontrado:", username);
      return res
        .status(401)
        .json({ ok: false, error: "Usuario o contraseña inválidos" });
    }

    if (!normalizeBool(row.is_active)) {
      console.log("[auth/login] usuario inactivo:", row.id, row.username);
      return res
        .status(401)
        .json({ ok: false, error: "Usuario inactivo" });
    }

    console.log("[auth/login] fila usuario:", {
      id: row.id,
      username: row.username,
      hasHash: !!row.password_hash,
      hasPlain: !!row.password_plain,
      is_active: row.is_active,
    });

    const verification = await verifyPassword(password, row);
    if(!verification?.ok) {
      console.log("[auth/login] contraseña incorrecta para:", row.username);
      return res
        .status(401)
        .json({ ok: false, error: "Usuario o contraseña inválidos" });
    }
    if (verification.needsUpgrade) {
      await migrateLegacyPassword(row.id, password);
    }

    console.log("[auth/login] login OK para:", row.username);

    const token = signJwt(row.id);
    setSessionCookies(res, token); // <-- setea token y sid (compat)

    const roles = getUserRoles(row.id);
    const services = listServicesByUser(row.id);

    return res.json({
      ok: true,
      user: {
        id: row.id,
        username: row.username ?? null,
        email: row.email ?? null,
        roles,
        services,
      },
      // útil en dev si querés usar Authorization: Bearer
      devToken: env.NODE_ENV === "development" ? token : undefined,
    });
  } catch (e) {
    console.error("[auth/login] error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "Login error" });
  }
});

// Logout
router.post("/logout", (req, res) => {
  try {
    res.clearCookie("sid", { path: "/" });
    res.clearCookie("token", { path: "/" });
  } catch {}
  return res.json({ ok: true });
});

export { verifyPassword, signJwt};
export default router;
