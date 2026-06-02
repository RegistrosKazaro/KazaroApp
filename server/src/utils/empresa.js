// server/src/utils/empresa.js  ← ARCHIVO NUEVO
import { db } from "../db.js";

const _cache = new Map();

export function getEmpresaBySlug(slug) {
  const key = String(slug ?? "").toLowerCase().trim();
  if (!key) return null;
  if (_cache.has(key)) return _cache.get(key);
  try {
    const row = db
      .prepare("SELECT EmpresaID AS id, slug, nombre FROM Empresas WHERE LOWER(slug) = LOWER(?) AND is_active = 1 LIMIT 1")
      .get(key);
    if (row) _cache.set(key, row);
    return row ?? null;
  } catch {
    return null;
  }
}

export function listEmpresas() {
  try {
    return db
      .prepare("SELECT EmpresaID AS id, slug, nombre FROM Empresas WHERE is_active = 1 ORDER BY EmpresaID")
      .all();
  } catch {
    return [];
  }
}

export function getMailConfigValue(empresaId, key, envFallback = undefined) {
  try {
    const row = db
      .prepare("SELECT value FROM EmpresaMailConfig WHERE empresa_id = ? AND key = ? LIMIT 1")
      .get(empresaId, key);
    if (row?.value !== undefined && row.value !== null) return row.value;
  } catch {}
  return envFallback;
}

export function getMailConfigForEmpresa(empresaId, envFallbacks = {}) {
  const KEYS = [
    "SMTP_HOST","SMTP_PORT","SMTP_SECURE","SMTP_USER","SMTP_PASS",
    "MAIL_FROM","MAIL_TO","MAIL_CC","MAIL_BCC","MAIL_DISABLE","MAIL_BLOCKLIST",
  ];
  const out = {};
  for (const k of KEYS) {
    const v = getMailConfigValue(empresaId, k, envFallbacks[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function setMailConfigValue(empresaId, key, value) {
  db.prepare(
    "INSERT INTO EmpresaMailConfig (empresa_id, key, value) VALUES (?, ?, ?) ON CONFLICT(empresa_id, key) DO UPDATE SET value = excluded.value"
  ).run(empresaId, key, value);
}