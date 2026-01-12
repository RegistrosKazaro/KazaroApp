import crypto from "crypto";

/**
 * CSRF basado en cookie + header
 * Cookie: csrf_token
 * Header: X-CSRF-Token
 */
export function requireCsrf(req, res, next) {
  const method = (req?.method || "GET").toUpperCase();

  // Permitir métodos seguros y preflight
  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    return next();
  }

  const cookieToken = req.cookies?.csrf_token;
  const headerToken = req.get("X-CSRF-Token");

  if (!cookieToken || !headerToken) {
    return res.status(403).json({ error: "CSRF token missing" });
  }

  try {
    const ok = crypto.timingSafeEqual(
      Buffer.from(cookieToken),
      Buffer.from(headerToken)
    );
    if (!ok) return res.status(403).json({ error: "Invalid CSRF token" });
  } catch {
    return res.status(403).json({ error: "Invalid CSRF token" });
  }

  return next();
}
