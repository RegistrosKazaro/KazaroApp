import { Router } from "express";
import { loginHandler, requireAuth } from "../middleware/auth.js";
import { getUserForLogin, getUserById } from "../db.js";

const router = Router();

router.post("/login", loginHandler);
router.post("/logout", (req, res) => {
  try { res.clearCookie("token", { path: "/" }); } catch {}
  return res.json({ ok: true });
});
router.get("/me", requireAuth, (req, res) => res.json(req.user));

// Diagnóstico rápido del login
router.get("/lookup/:ident", (req, res) => {
  const u = getUserForLogin(req.params.ident);
  if (!u) return res.json({ found: false });
  const me = getUserById(u.id);
  return res.json({
    found: true,
    user: me,
    has_hash: !!u.password_hash,
    has_plain: !!u.password_plain,
    hash_len: u.password_hash ? String(u.password_hash).length : 0
  });
});

export default router;
