// server/src/middleware/rateLimit.js
import rateLimit from "express-rate-limit";

const isProd = process.env.NODE_ENV === "production";

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,         
  max: isProd ? 20 : 1000,          
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too Many Requests" },
});

export const meLimiter = rateLimit({
  windowMs: 60 * 1000,              
  max: isProd ? 120 : 10000,        
  standardHeaders: true,
  legacyHeaders: false,
});
