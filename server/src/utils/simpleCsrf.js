import crypto from "crypto";

const CSRF_COOKIE = "csrf_token";

export function csrfTokenRoute(req, res) {
  let token = req.cookies?.[CSRF_COOKIE];
  if (!token) {
    token = crypto.randomBytes(16).toString("hex");
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      sameSite: "lax",
      secure: req.protocol === "https",
      maxAge: 1000 * 60 * 60 * 12,
      path: "/",
    });
  }
  return res.json({ csrfToken: token });
}

export function requireCsrf(req, res, next) {
  const method = (req.method || "GET").toUpperCase();
  const unsafe = /^(POST|PUT|PATCH|DELETE)$/i.test(method);

  const p = (req.path || "").toLowerCase();
  if (p.startsWith("/auth/login") || p.startsWith("/auth/logout")) return next();

  if (!unsafe) return next();
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get("X-CSRF-Token");
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: "CSRF token inválido" });
  }
  return next();
}
