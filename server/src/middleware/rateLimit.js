// server/src/middleware/rateLimit.js
import rateLimit from "express-rate-limit";

const isProd = process.env.NODE_ENV === "production";

// Para /auth/login (protege contra brute-force)
// En dev lo subimos mucho para que no moleste.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,         // 15 minutos
  max: isProd ? 20 : 1000,          // en prod 20, en dev 1000
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too Many Requests" },
});

// Para /auth/me: en prod limitamos suave; en dev lo deshabilitamos (max enorme)
export const meLimiter = rateLimit({
  windowMs: 60 * 1000,              // 1 minuto
  max: isProd ? 120 : 10000,        // en dev muy alto
  standardHeaders: true,
  legacyHeaders: false,
});
