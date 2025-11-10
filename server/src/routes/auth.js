// server/src/routes/auth.js
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import argon2 from "argon2";
import crypto from "crypto";
import { env } from "../utils/env.js";
import {
  getUserForLogin,
  getUserById,
  getUserRoles,
  listServicesByUser,
} from "../db.js";

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
 * Verifica la contraseña del usuario.
 *
 * Soporta:
 *  - Argon2 ($argon2...)
 *  - bcrypt ($2a$, $2b$, $2y$)
 *  - MD5 (32 hex)
 *  - SHA1 (40 hex)
 *  - password_plain (texto plano, ideal en dev y usuarios creados a mano)
 */
async function verifyPassword(inputPassword, userRow) {
  const pass = String(inputPassword ?? "");
  if (!pass) return false;

  const rawHash = userRow?.password_hash;
  const rawPlain = userRow?.password_plain;

  const hash =
    typeof rawHash === "string" && rawHash.trim().length > 0
      ? rawHash.trim()
      : "";
  const plain = typeof rawPlain === "string" ? rawPlain : "";

  // 1) Intentar primero texto plano (esto hace que usuarios nuevos con password_plain entren fácil)
  if (plain) {
    if (plain === pass) {
      // console.log("[auth] verifyPassword: match por texto plano");
      return true;
    }
  }

  // 2) Si hay hash, intentamos cada tipo conocido
  if (hash) {
    const lower = hash.toLowerCase();

    // argon2
    if (lower.startsWith("$argon2")) {
      try {
        if (await argon2.verify(hash, pass)) {
          // console.log("[auth] verifyPassword: match por argon2");
          return true;
        }
      } catch (e) {
        console.warn("[auth] verifyPassword argon2 error:", e?.message || e);
      }
    }

    // bcrypt ($2a$, $2b$, $2y$)
    if (
      lower.startsWith("$2a$") ||
      lower.startsWith("$2b$") ||
      lower.startsWith("$2y$")
    ) {
      try {
        if (await bcrypt.compare(pass, hash)) {
          // console.log("[auth] verifyPassword: match por bcrypt");
          return true;
        }
      } catch (e) {
        console.warn("[auth] verifyPassword bcrypt error:", e?.message || e);
      }
    }

    // MD5 / SHA1 heredados
    try {
      // MD5
      if (/^[a-f0-9]{32}$/i.test(hash)) {
        const md5 = crypto.createHash("md5").update(pass).digest("hex");
        if (md5.toLowerCase() === lower) {
          // console.log("[auth] verifyPassword: match por MD5");
          return true;
        }
      }
      // SHA1
      if (/^[a-f0-9]{40}$/i.test(hash)) {
        const sha1 = crypto.createHash("sha1").update(pass).digest("hex");
        if (sha1.toLowerCase() === lower) {
          // console.log("[auth] verifyPassword: match por SHA1");
          return true;
        }
      }
    } catch (e) {
      console.warn("[auth] verifyPassword legacy hash error:", e?.message || e);
    }
  }

  // 3) Si no matcheó nada
  return false;
}

function signJwt(userId) {
  return jwt.sign(
    { uid: Number(userId) },
    env.JWT_SECRET || "dev-secret",
    { expiresIn: "12h" },
  );
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
  const raw =
    req.cookies?.sid ||
    req.cookies?.token ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "") ||
    null;
  if (!raw) return null;
  try {
    return jwt.verify(raw, env.JWT_SECRET || "dev-secret");
  } catch {
    return null;
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

    const ok = await verifyPassword(password, row);
    if (!ok) {
      console.log("[auth/login] contraseña incorrecta para:", row.username);
      return res
        .status(401)
        .json({ ok: false, error: "Usuario o contraseña inválidos" });
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

export default router;
