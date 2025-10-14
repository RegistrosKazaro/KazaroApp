// server/src/index.js
import express from "express";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import csurf from "csurf";

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import { env } from "./utils/env.js";
import { cookies } from "./middleware/auth.js";
import authRoutes from "./routes/auth.js";
import catalogRoutes from "./routes/catalog.js";
import ordersRoutes from "./routes/orders.js";
import supervisorRoutes from "./routes/supervisor.js";
import servicesRoutes from "./routes/services.js";
import devRoutes from "./routes/dev.js";
import adminRoutes from "./routes/admin.js";
import serviceProductsRoutes from "./routes/serviceProducts.js";
import reportsRoutes from "./routes/reports.js"; // ⬅️ NUEVO

import { DB_RESOLVED_PATH, db, ensureStockColumn } from "./db.js";
import { verifyMailTransport } from "./utils/mailer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = process.env.PUBLIC_DIR
  ? path.resolve(process.cwd(), process.env.PUBLIC_DIR)
  : path.join(__dirname, "..", "public");

// ===== Diagnóstico DB al iniciar =====
const dbFile = process.env.DB_PATH || "./Kazaro.db";
try {
  const st = fs.statSync(dbFile);
  console.log("[db] archivo existe:", dbFile, "size:", st.size, "bytes");
} catch (e) {
  console.log("[db] archivo NO existe:", dbFile, e?.message);
}
try {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log("[db] tablas:", rows.map((r) => r.name));
} catch (e) {
  console.log("[db] error listando tablas:", e?.message);
}

const app = express();

// Seguridad básica
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

/* ===== Middlewares base ===== */
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* ===== CORS con credenciales ===== */
const allowed = new Set(
  [
    env.APP_URL,
    env.APP_BASE_URL,
    process.env.APP_URL,
    process.env.APP_BASE_URL,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ].filter(Boolean)
);

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // Postman/curl sin Origin
    if (allowed.has(origin)) return cb(null, true);
    return cb(new Error(`Origen no permitido por CORS: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Cache-Control",
    "Pragma",
    "Expires",
    "X-Requested-With",
    "X-CSRF-Token",
  ],
};
app.use(cors(corsOptions));

/* ===== Sesión desde cookie → req.user ===== */
app.use(cookies);

/* ===== Rate limiters ===== */
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 });
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 200 });

/* ===== Rutas SIN CSRF (auth) ===== */
app.use("/auth", loginLimiter, authRoutes);

/* ===== CSRF desde acá en adelante (todo lo demás protegido) ===== */
const isProd = process.env.NODE_ENV === "production";
const csrfProtection = csurf({
  cookie: {
    key: "csrf",
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    path: "/",
  },
});
app.use(csrfProtection);

// Endpoint para obtener token (DEBE estar luego de csurf)
app.get("/csrf-token", (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

/* ===== Rutas API protegidas por CSRF ===== */
app.use("/catalog", catalogRoutes);
app.use("/orders", ordersRoutes);
app.use("/supervisor", supervisorRoutes);
app.use("/services", servicesRoutes);
if (process.env.NODE_ENV !== "production") {
  app.use("/dev", devRoutes);
}
app.use("/admin", adminLimiter, adminRoutes);
app.use("/admin/sp", adminLimiter, serviceProductsRoutes);
app.use("/admin/reports", adminLimiter, reportsRoutes); // ⬅️ NUEVO

// Salud
app.get("/health", (_req, res) => res.json({ ok: true }));

/* ===== SPA fallback ===== */
app.get(
  /^\/(?!auth|me|catalog|orders|supervisor|services|dev|health|remitos|assets|favicon\.ico|robots\.txt|manifest\.json|admin).*/i,
  (req, res) => {
    const file = path.join(PUBLIC_DIR, "index.html");
    if (fs.existsSync(file)) {
      console.log("[spa] -> index.html para", req.path);
      return res.sendFile(file);
    }
    return res.status(404).json({ error: "Not found" });
  }
);

// Errores de CSRF
app.use((err, _req, res, next) => {
  if (err && err.code === "EBADCSRFTOKEN") {
    return res.status(403).json({ error: "CSRF token inválido o ausente" });
  }
  return next(err);
});

// 404
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

const PORT = Number(env.PORT || process.env.PORT || 10000);
app.listen(PORT, async () => {
  console.log(`[server] http://localhost:${PORT} (${env.NODE_ENV || "development"})`);
  console.log("[static] PUBLIC_DIR:", PUBLIC_DIR);
  console.log("[db] usando:", DB_RESOLVED_PATH);
  console.log("[cors] allowed origins:", Array.from(allowed));

  try { ensureStockColumn(); } catch (e) { console.error("[db] ensureStockColumn:", e); }

  try {
    const cnt = db.prepare("SELECT COUNT(*) AS c FROM Empleados").get()?.c ?? 0;
    const cols = db.prepare("PRAGMA table_info(Empleados)").all().map((c) => c.name);
    console.log("[db] Empleados filas:", cnt);
    console.log("[db] Empleados columnas:", cols);
  } catch (e) {
    console.log("[db] No pude leer Empleados:", e?.message || e);
  }

  try {
    const ok = await verifyMailTransport();
    console.log(ok ? "[mail] SMTP verify OK" : "[mail] SMTP verify FAILED");
  } catch (e) {
    console.error("[mail] SMTP verify ERROR:", e);
  }
});
