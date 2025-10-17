import { Router } from "express";
import { loginHandler, requireAuth } from "../middleware/auth.js";
import { getUserForLogin } from "../db.js";

const router = Router();

router.post("/login", loginHandler);

router.post("/logout", (req, res) => {
  try {
    if (req.session) req.session.destroy?.(() => {});
    res.clearCookie("token");
  } catch {}
  return res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  return res.json({ ok: true, user: req.user });
});

// Utilidad para debug (opcional)
router.get("/lookup/:user", (req, res) => {
  const u = getUserForLogin(req.params.user);
  return res.json({ found: !!u, user: u && { id: u.id, username: u.username, is_active: u.is_active, has_hash: !!u.password_hash, has_plain: !!u.password_plain } });
});

export default router;
