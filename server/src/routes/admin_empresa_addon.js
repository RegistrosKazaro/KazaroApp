// server/src/routes/admin_empresa_addon.js  ← ARCHIVO NUEVO
// Montarlo en admin.js así:
//   import empresaRouter from "./admin_empresa_addon.js";
//   router.use("/empresa", empresaRouter);   // antes del export default
import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { db } from "../db.js";
import { listEmpresas, getMailConfigForEmpresa, setMailConfigValue } from "../utils/empresa.js";

const router = Router();
const mustBeAdmin = [requireAuth, requireRole(["admin", "Admin"])];

// GET /admin/empresa/list
router.get("/list", mustBeAdmin, (_req, res) => {
  try {
    return res.json({ ok: true, empresas: listEmpresas() });
  } catch {
    return res.status(500).json({ ok: false, error: "Error al listar empresas" });
  }
});

// GET /admin/empresa/:id/mail-config
router.get("/:id/mail-config", mustBeAdmin, (req, res) => {
  const empresaId = Number(req.params.id);
  if (!Number.isFinite(empresaId)) return res.status(400).json({ ok: false, error: "ID inválido" });
  try {
    const config = getMailConfigForEmpresa(empresaId);
    const safe = { ...config };
    if (safe.SMTP_PASS) safe.SMTP_PASS = "••••••••";
    return res.json({ ok: true, config: safe });
  } catch {
    return res.status(500).json({ ok: false, error: "Error al leer config" });
  }
});

// PUT /admin/empresa/:id/mail-config
// Body: { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, MAIL_TO, ... }
router.put("/:id/mail-config", mustBeAdmin, (req, res) => {
  const empresaId = Number(req.params.id);
  if (!Number.isFinite(empresaId)) return res.status(400).json({ ok: false, error: "ID inválido" });

  const ALLOWED_KEYS = [
    "SMTP_HOST","SMTP_PORT","SMTP_SECURE","SMTP_USER","SMTP_PASS",
    "MAIL_FROM","MAIL_TO","MAIL_CC","MAIL_BCC","MAIL_DISABLE","MAIL_BLOCKLIST",
  ];
  try {
    const body = req.body ?? {};
    const updated = [];
    for (const key of ALLOWED_KEYS) {
      if (key in body) {
        if (body[key] === "" || body[key] === null) {
          db.prepare("DELETE FROM EmpresaMailConfig WHERE empresa_id = ? AND key = ?").run(empresaId, key);
        } else {
          setMailConfigValue(empresaId, key, String(body[key]));
          updated.push(key);
        }
      }
    }
    return res.json({ ok: true, updated });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Error al guardar config" });
  }
});

export default router;