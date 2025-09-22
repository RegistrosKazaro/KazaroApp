// server/src/routes/dev.js
import express from "express";
import argon2 from "argon2";
import { db, listServicesByUser, getUserForLogin } from "../db.js";

const router = express.Router();

/* --------------------------------- helpers -------------------------------- */
function pickCol(info, candidates) {
  const names = info.map(c => String(c.name));
  for (const cand of candidates) {
    const hit = names.find(n => n.toLowerCase() === String(cand).toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/* ----------------------- /dev/services-by-id (GET) ------------------------ */
router.get("/services-by-id", (req, res) => {
  try {
    const userId = Number(req.query.userId);
    if (!userId) return res.status(400).json({ error: "userId requerido" });

    const withDebug = String(req.query.debug || "") === "1";
    const rows = listServicesByUser(userId, { withDebug }) || [];

    if (withDebug && rows && rows.__debug) {
      console.dir({ DEV_SERVICES_BY_ID_DEBUG: rows.__debug }, { depth: 5 });
      try { delete rows.__debug; } catch {}
    }

    const safe = Array.isArray(rows)
      ? rows
          .filter(r => r && r.id !== undefined && r.name !== undefined)
          .map(r => ({ id: Number(r.id), name: String(r.name) }))
      : [];

    return res.json({ userId, rows: safe });
  } catch (e) {
    console.error("[dev] /services-by-id:", e);
    return res.status(500).json({ error: "No se pudieron obtener los servicios." });
  }
});

/* ------------------ /dev/services-by-username (GET) ----------------------- */
router.get("/services-by-username", (req, res) => {
  try {
    const username = String(req.query.username || "").trim();
    if (!username) return res.status(400).json({ error: "username requerido" });

    const user = getUserForLogin(username);
    if (!user) return res.json({ username, rows: [] });

    const withDebug = String(req.query.debug || "") === "1";
    const rows = listServicesByUser(user.id, { withDebug }) || [];

    if (withDebug && rows && rows.__debug) {
      console.dir({ DEV_SERVICES_BY_USERNAME_DEBUG: rows.__debug }, { depth: 5 });
      try { delete rows.__debug; } catch {}
    }

    const safe = Array.isArray(rows)
      ? rows
          .filter(r => r && r.id !== undefined && r.name !== undefined)
          .map(r => ({ id: Number(r.id), name: String(r.name) }))
      : [];

    return res.json({ username, userId: user.id, rows: safe });
  } catch (e) {
    console.error("[dev] /services-by-username:", e);
    return res.status(500).json({ error: "No se pudieron obtener los servicios." });
  }
});

/* ------------------------- /dev/auth-debug (GET) -------------------------- */
router.get("/auth-debug", (req, res) => {
  try {
    const u = String(req.query.u || "").trim();
    if (!u) return res.status(400).json({ error: "u requerido" });

    const row = getUserForLogin(u);
    if (!row) return res.json({ input: u, found: false });

    const out = {
      input: u,
      found: true,
      id: row.id,
      username: row.username,
      is_active: row.is_active,
      hasHash: !!row.password_hash,
      hashPrefix: row.password_hash ? String(row.password_hash).slice(0, 8) : null,
      hasPlain: row.password_plain != null
    };
    return res.json(out);
  } catch (e) {
    console.error("[dev] /auth-debug:", e);
    return res.status(500).json({ error: "No se pudo diagnosticar." });
  }
});

/* ------------------------ /dev/try-login (POST) --------------------------- */
router.post("/try-login", express.json(), async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "username y password requeridos" });
    }

    const u = getUserForLogin(username);
    if (!u) return res.json({ ok: false, reason: "no-user" });

    const pwd = String(password);
    const hash = u.password_hash ? String(u.password_hash) : "";

    // bcrypt
    if (hash && /^\$2[aby]\$/.test(hash)) {
      try {
        const mod = await import("bcryptjs");
        const ok = await mod.compare(pwd, hash);
        return res.json({ ok, reason: ok ? "ok-bcrypt" : "bcrypt-mismatch" });
      } catch (e) {
        return res.json({ ok: false, reason: "bcrypt-error:" + (e?.message || e) });
      }
    }
    // argon2
    if (hash && /^\$argon2/i.test(hash)) {
      try {
        const ok = await argon2.verify(hash, pwd);
        return res.json({ ok, reason: ok ? "ok-argon2" : "argon2-mismatch" });
      } catch (e) {
        return res.json({ ok: false, reason: "argon2-error:" + (e?.message || e) });
      }
    }
    // texto plano (legacy)
    if (u.password_plain != null) {
      const ok = String(u.password_plain) === pwd;
      return res.json({ ok, reason: ok ? "ok-plain" : "plain-mismatch" });
    }

    return res.json({ ok: false, reason: "sin-credenciales" });
  } catch (e) {
    console.error("[dev] /try-login:", e);
    return res.status(500).json({ ok: false, reason: "exception" });
  }
});

/* ----------------------- /dev/set-password (POST) ------------------------- */
/* Setea la contraseña del usuario (username o email) con argon2id. */
router.post("/set-password", express.json(), async (req, res) => {
  try {
    const { user, password } = req.body || {};
    if (!user || !password) {
      return res.status(400).json({ ok: false, error: "Falta user o password" });
    }

    // Detectar columnas reales de Empleados
    const cols = db.prepare(`PRAGMA table_info(Empleados)`).all();
    const idCol    =
      (cols.find(c => c.pk === 1)?.name) ||
      pickCol(cols, ["EmpleadosID","EmpleadoID","IdEmpleado","id","ID"]) ||
      "EmpleadosID";
    const userCol  = pickCol(cols, ["username","usuario","user","email","correo","Email"]) || "username";
    const emailCol = pickCol(cols, ["Email","email","correo"]) || null;
    const hashCol  = pickCol(cols, ["password_hash","hash","pass_hash"]) || "password_hash";
    const plainCol = pickCol(cols, ["password","contrasena","contraseña","clave","pass"]); // si existe, lo limpiamos

    // Buscar por username/email
    const where = [];
    const params = [];
    if (userCol)  { where.push(`LOWER(TRIM(${userCol})) = LOWER(TRIM(?))`);  params.push(user); }
    if (emailCol) { where.push(`LOWER(TRIM(${emailCol})) = LOWER(TRIM(?))`); params.push(user); }

    const row = db.prepare(`
      SELECT ${idCol} AS id, ${userCol} AS uname
      FROM Empleados
      WHERE ${where.join(" OR ")}
      LIMIT 1
    `).get(...params);

    if (!row) return res.status(404).json({ ok: false, error: "Usuario no encontrado" });

    const newHash = await argon2.hash(String(password), { type: argon2.argon2id });

    // Update seguro
    const sql = `
      UPDATE Empleados
      SET ${hashCol} = ? ${plainCol ? `, ${plainCol} = NULL` : ""}
      WHERE ${idCol} = ?
    `;
    db.prepare(sql).run(newHash, row.id);

    return res.json({ ok: true, id: row.id, user: row.uname });
  } catch (e) {
    console.error("[/dev/set-password] err:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
