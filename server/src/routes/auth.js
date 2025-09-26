// server/src/routes/auth.js
import express from "express";
import { z } from "zod";
// Nota: import argon2 arriba no es necesario si lo cargamos dinámico en verifyPassword
import { getUserForLogin, getUserRoles, listServicesByUser } from "../db.js";
import { issueSession, clearSession, requireAuth } from "../middleware/auth.js";
import { env } from "../utils/env.js";

const router = express.Router();

// Aceptamos identifier | username | email y password
const LoginSchema = z.object({
  identifier: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
  password: z.string().min(1),
});

async function verifyPassword({ password, password_hash, password_plain }) {
  const pwd = String(password ?? "");
  const hash = password_hash ? String(password_hash) : null;
  const plain = password_plain != null ? String(password_plain) : null;

  // bcrypt ($2a/$2b/$2y)
  if (hash && /^\$2[aby]\$/.test(hash)) {
    try {
      const bcrypt = await import("bcryptjs");
      if (await bcrypt.compare(pwd, hash)) return true;
    } catch {}
  }

  // argon2
  if (hash && /^\$argon2/i.test(hash)) {
    try {
      const ok = await import("argon2").then(m => m.default.verify(hash, pwd));
      if (ok) return true;
    } catch {}
  }

  // Si hay hash pero NO es bcrypt/argon2, tratamos como legacy texto plano
  if (hash && !/^\$2[aby]\$/.test(hash) && !/^\$argon2/i.test(hash)) {
    if (hash === pwd) return true;
  }

  // Columna de texto plano (legacy)
  if (plain !== null && plain === pwd) return true;

  return false;
}

/**
 * POST /auth/login
 * body: { identifier | username | email, password }
 * response: { id, username, roles[] } + cookie de sesión httpOnly
 */
router.post("/login", async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    if (process.env.NODE_ENV !== "production") {
      console.log("[auth] body inválido:", req.body);
    }
    return res.status(400).json({ error: "Datos inválidos" });
  }

  const body = parsed.data;
  const usernameInput = String(
    body.identifier ?? body.username ?? body.email ?? ""
  ).trim();
  const passwordInput = String(body.password);

  if (!usernameInput || !passwordInput) {
    return res.status(400).json({ error: "Faltan credenciales" });
  }

  const u = getUserForLogin(usernameInput);

  if (env.DEBUG_AUTH === "true") {
    console.log("[auth] intento login ->", { usernameInput, found: !!u });
  }

  if (!u) {
    return res.status(401).json({ error: "Usuario o contraseña inválidos" });
  }

  if (u.is_active != null && Number(u.is_active) === 0) {
    if (env.DEBUG_AUTH === "true") console.log("[auth] usuario inactivo:", u.username);
    return res.status(401).json({ error: "Usuario o contraseña inválidos" });
  }

  let ok = false;
  try {
    ok = await verifyPassword({
      password: passwordInput,
      password_hash: u.password_hash,
      password_plain: u.password_plain,
    });
  } catch (e) {
    if (env.DEBUG_AUTH === "true") console.log("[auth] verify error:", e?.message || e);
  }

  if (!ok) {
    return res.status(401).json({ error: "Usuario o contraseña inválidos" });
  }

  const roles = (getUserRoles(u.id) || []).map(String);
  issueSession(res, { id: u.id, username: u.username, roles });

  return res.json({ id: u.id, username: u.username, roles });
});

/**
 * GET /auth/me
 * Devuelve el usuario de la sesión (si existe)
 */
router.get("/me", requireAuth, (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.username,
    roles: req.user.roles || [],
  });
});

/**
 * GET /auth/my-services
 * Lista servicios asignados al usuario autenticado
 */
router.get("/my-services", requireAuth, (req, res) => {
  const rows = listServicesByUser(req.user.id) || [];
  res.json(rows.map(r => ({ id: Number(r.id), name: String(r.name) })));
});

/**
 * POST /auth/logout
 * Limpia la cookie de sesión
 */
router.post("/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

export default router;
