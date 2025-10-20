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
function normalizeBool(v) {
  const s = String(v ?? "1").trim().toLowerCase();
  return !["0", "false", "no", "inactivo", "deshabilitado", "disabled"].includes(s);
}

async function verifyPassword(inputPassword, userRow) {
  const pass = String(inputPassword ?? "");
  const hash = String(userRow?.password_hash || "").trim();
  const plain = String(userRow?.password_plain || "").trim();

  if (hash) {
    const lower = hash.toLowerCase();

    // argon2
    if (lower.startsWith("$argon2")) {
      try { if (await argon2.verify(hash, pass)) return true; } catch {}
    }
    // bcrypt ($2a$, $2b$, $2y$)
    if (lower.startsWith("$2a$") || lower.startsWith("$2b$") || lower.startsWith("$2y$")) {
      try { if (await bcrypt.compare(pass, hash)) return true; } catch {}
    }
    // MD5 / SHA1 heredados
    try {
      if (/^[a-f0-9]{32}$/i.test(hash)) {
        const md5 = crypto.createHash("md5").update(pass).digest("hex");
        if (md5.toLowerCase() === hash.toLowerCase()) return true;
      }
      if (/^[a-f0-9]{40}$/i.test(hash)) {
        const sha1 = crypto.createHash("sha1").update(pass).digest("hex");
        if (sha1.toLowerCase() === hash.toLowerCase()) return true;
      }
    } catch {}
  }

  // texto plano (fallback)
  if (plain) return plain === pass;

  return false;
}

function signJwt(userId) {
  return jwt.sign({ uid: Number(userId) }, env.JWT_SECRET || "dev-secret", { expiresIn: "12h" });
}

function setSessionCookies(res, token) {
  const cookieOpts = {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    maxAge: 12 * 60 * 60 * 1000,
    path: "/",
  };
  // Compat: dejamos ambas cookies
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
  try { return jwt.verify(raw, env.JWT_SECRET || "dev-secret"); }
  catch { return null; }
}

/* ================= Rutas ================= */

// Estado de sesión
router.get("/me", (_req, res) => {
  const sess = readSession(_req);
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
    const username = (req.body?.username ?? req.body?.user ?? req.body?.email ?? "").trim();
    const password = String(req.body?.password ?? "");

    if (!username || !password) {
      return res.status(400).json({ ok: false, error: "Faltan credenciales" });
    }

    const row = getUserForLogin(username);
    if (!row) return res.status(401).json({ ok: false, error: "Usuario o contraseña inválidos" });

    if (!normalizeBool(row.is_active)) {
      return res.status(401).json({ ok: false, error: "Usuario inactivo" });
    }

    const ok = await verifyPassword(password, row);
    if (!ok) return res.status(401).json({ ok: false, error: "Usuario o contraseña inválidos" });

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
