import jwt from "jsonwebtoken";

const COOKIE_NAME = "session";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";

export function issueSession(res, payload) {
  const isProd = process.env.NODE_ENV === "production";
res.cookie(COOKIE_NAME, token, {
  httpOnly: true,
  sameSite: isProd ? "none" : "lax",
  secure: isProd ? true : false,
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000,
});
}

export function clearSession(res) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function cookies(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  req.user = null;
  if (!token) return next();
  try {
    const p = jwt.verify(token, SESSION_SECRET);
    req.user = { id: p?.id, username: p?.username, roles: p?.roles || [] };
  } catch { req.user = null; }
  next();
}

export function requireAuth(req, res, next) {
  if (req.user?.id) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

export function requireRole(roleName) {
  const wanted = Array.isArray(roleName)
    ? roleName.map(r => String(r).toLowerCase())
    : [String(roleName).toLowerCase()];
  return (req, res, next) => {
    const roles = (req.user?.roles || []).map(r => String(r).toLowerCase());
    if (wanted.some(w => roles.includes(w))) return next();
    return res.status(403).json({ error: "Forbidden" });
  };
}
