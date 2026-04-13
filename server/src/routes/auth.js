// server/src/routes/auth.js  ← REEMPLAZA el archivo actual
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import argon2 from "argon2";
import { env } from "../utils/env.js";
import { getUserById, getUserRoles, listServicesByUser, updateUserPasswordHash } from "../db.js";
import { getUserForLoginWithEmpresa, getEmpresaIdForUser } from "../db_multiempresa_patch.js";
import { getEmpresaBySlug, listEmpresas } from "../utils/empresa.js";
import { signToken } from "../middleware/auth.js";

const router = express.Router();

function normalizeBool(v) {
  const s = String(v ?? "1").trim().toLowerCase();
  return !["0","false","no","inactivo","deshabilitado","disabled"].includes(s);
}

const IS_HTTPS = /^https:\/\//i.test(String(env.APP_BASE_URL || ""));

async function verifyPassword(inputPassword, userRow) {
  const pass = String(inputPassword ?? "");
  if (!pass) return { ok: false, reason: "empty" };

  const hash  = typeof userRow?.password_hash === "string" ? userRow.password_hash.trim() : "";
  const plain = typeof userRow?.password_plain === "string" ? userRow.password_plain : "";

  if (hash) {
    const lower = hash.toLowerCase();

    if (lower.startsWith("$argon2")) {
      try {
        if (await argon2.verify(hash, pass)) return { ok: true, algorithm: "argon2" };
      } catch (e) { console.warn("[auth] argon2:", e?.message); }
      return { ok: false, algorithm: "argon2" };
    }

    if (lower.startsWith("$2a$") || lower.startsWith("$2b$") || lower.startsWith("$2y$")) {
      try {
        if (await bcrypt.compare(pass, hash)) return { ok: true, algorithm: "bcrypt" };
      } catch (e) { console.warn("[auth] bcrypt:", e?.message); }
      return { ok: false, algorithm: "bcrypt" };
    }

    try {
      const { createHash } = await import("crypto");
      if (/^[a-f0-9]{32}$/i.test(hash)) {
        const d = createHash("md5").update(pass).digest("hex");
        if (d.toLowerCase() === lower) return { ok: true, algorithm: "md5", needsUpgrade: true };
      }
      if (/^[a-f0-9]{40}$/i.test(hash)) {
        const d = createHash("sha1").update(pass).digest("hex");
        if (d.toLowerCase() === lower) return { ok: true, algorithm: "sha1", needsUpgrade: true };
      }
    } catch (e) { console.warn("[auth] legacy hash:", e?.message); }

    return { ok: false, reason: "unknown-hash" };
  }

  if (plain) {
    return plain === pass
      ? { ok: true, algorithm: "plain", needsUpgrade: true }
      : { ok: false, algorithm: "plain" };
  }

  return { ok: false };
}

function setSessionCookies(res, token) {
  const opts = {
    httpOnly: true,
    sameSite: IS_HTTPS ? "none" : "lax",
    secure: IS_HTTPS,
    maxAge: 12 * 60 * 60 * 1000,
    path: "/",
  };
  res.cookie("token", token, opts);
  res.cookie("sid",   token, opts);
}

function readSession(req) {
  if (!env.JWT_SECRET) return null;
  const raw =
    req.cookies?.sid ||
    req.cookies?.token ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "") ||
    null;
  if (!raw) return null;
  try { return jwt.verify(raw, env.JWT_SECRET); }
  catch { return null; }
}

async function migrateLegacyPassword(userId, password) {
  try {
    const newHash = await argon2.hash(password, { type: argon2.argon2id });
    updateUserPasswordHash(userId, newHash);
    console.log(`[auth] hash migrado a Argon2 para usuario ${userId}`);
  } catch (e) {
    console.error("[auth] No se pudo migrar hash:", e?.message);
  }
}

// ─── GET /auth/empresas ───────────────────────────────────────
// Devuelve la lista de empresas activas para el selector del frontend
router.get("/empresas", (_req, res) => {
  try {
    return res.json({ ok: true, empresas: listEmpresas() });
  } catch {
    return res.status(500).json({ ok: false, error: "No se pudieron cargar las empresas" });
  }
});

// ─── GET /auth/me ─────────────────────────────────────────────
router.get("/me", (req, res) => {
  const sess = readSession(req);
  if (!sess?.uid) return res.status(401).json({ ok: false });

  const user = getUserById(sess.uid);
  if (!user) return res.status(401).json({ ok: false });

  const roles    = getUserRoles(user.id);
  const services = listServicesByUser(user.id);
  const empresaId   = sess.eid ?? getEmpresaIdForUser(user.id) ?? null;
  const empresaSlug = empresaId
    ? (listEmpresas().find((e) => e.id === empresaId)?.slug ?? null)
    : null;
  const empresaNombre = empresaId
    ? (listEmpresas().find((e) => e.id === empresaId)?.nombre ?? null)
    : null;

  return res.json({
    ok: true,
    user: {
      id: user.id,
      username: user.username ?? null,
      email: user.email ?? null,
      roles,
      services,
      empresaId,
      empresaSlug,
      empresaNombre,
    },
  });
});

// ─── POST /auth/login ─────────────────────────────────────────
// Body: { username, password, empresaSlug }
// empresaSlug es opcional; si no se envía usa "kazaro" (retrocompatible)
router.post("/login", async (req, res) => {
  try {
    const username = String(
      req.body?.username ?? req.body?.user ?? req.body?.email ?? ""
    ).trim();
    const password    = String(req.body?.password ?? "");
    const empresaSlug = String(req.body?.empresaSlug ?? "kazaro").toLowerCase().trim() || "kazaro";

    if (!username || !password) {
      return res.status(400).json({ ok: false, error: "Faltan credenciales" });
    }

    const empresa = getEmpresaBySlug(empresaSlug);
    if (!empresa) {
      return res.status(400).json({ ok: false, error: "Empresa no válida" });
    }

    console.log(`[auth/login] intento: ${username} | empresa: ${empresa.slug}`);

    const row = getUserForLoginWithEmpresa(username, empresa.id);
    if (!row) {
      console.log(`[auth/login] usuario no encontrado en ${empresa.slug}:`, username);
      return res.status(401).json({ ok: false, error: "Usuario o contraseña inválidos" });
    }

    if (!normalizeBool(row.is_active)) {
      return res.status(401).json({ ok: false, error: "Usuario inactivo" });
    }

    const verification = await verifyPassword(password, row);
    if (!verification?.ok) {
      return res.status(401).json({ ok: false, error: "Usuario o contraseña inválidos" });
    }
    if (verification.needsUpgrade) {
      await migrateLegacyPassword(row.id, password);
    }

    const token = signToken(row.id, empresa.id);
    setSessionCookies(res, token);

    const roles    = getUserRoles(row.id);
    const services = listServicesByUser(row.id);

    console.log(`[auth/login] OK: ${row.username} | empresa: ${empresa.slug}`);

    return res.json({
      ok: true,
      user: {
        id: row.id,
        username: row.username ?? null,
        email: row.email ?? null,
        roles,
        services,
        empresaId:     empresa.id,
        empresaSlug:   empresa.slug,
        empresaNombre: empresa.nombre,
      },
      devToken: env.NODE_ENV === "development" ? token : undefined,
    });
  } catch (e) {
    console.error("[auth/login] error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "Login error" });
  }
});

// ─── POST /auth/logout ────────────────────────────────────────
router.post("/logout", (req, res) => {
  try {
    res.clearCookie("sid",   { path: "/" });
    res.clearCookie("token", { path: "/" });
  } catch {}
  return res.json({ ok: true });
});

export { verifyPassword };
export default router;