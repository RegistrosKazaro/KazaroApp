// server/src/index.js
import express from "express";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
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
import meRoutes from "./routes/me.js";
import devRoutes from "./routes/dev.js";
import adminRoutes from "./routes/admin.js";
import serviceProductsRoutes from "./routes/serviceProducts.js";

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

/* ===== Middlewares base (orden IMPORTA) ===== */
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
    if (!origin) return cb(null, true);           // Postman/curl sin Origin
    if (allowed.has(origin)) return cb(null, true);
    return cb(new Error(`Origen no permitido por CORS: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cache-Control", "Pragma", "Expires", "X-Requested-With"],
};
app.use(cors(corsOptions)); // <-- esto ya maneja el preflight; NO usar app.options("*", ...)

/* ===== Cookie -> req.user ===== */
app.use(cookies);

/* ===== Archivos estáticos ===== */
app.use(express.static(PUBLIC_DIR));
app.use("/remitos", express.static(path.join(PUBLIC_DIR, "remitos")));

/* ===== API ===== */
app.use("/auth", authRoutes);
app.use("/me", meRoutes);
app.use("/catalog", catalogRoutes);
app.use("/orders", ordersRoutes);
app.use("/supervisor", supervisorRoutes);
app.use("/services", servicesRoutes);
app.use("/admin", adminRoutes);

// MUY IMPORTANTE: /admin/sp DESPUÉS de cors() y cookies
app.use("/admin/sp", serviceProductsRoutes);

app.get("/health", (_req, res) => res.json({ ok: true }));

/* ===== SPA fallback ===== */
app.get(
  /^\/((?!auth|me|catalog|orders|supervisor|services|dev|health|remitos|assets|favicon\.ico|robots\.txt|manifest\.json).)*$/i,
  (req, res) => {
    const file = path.join(PUBLIC_DIR, "index.html");
    if (fs.existsSync(file)) {
      console.log("[spa] -> index.html para", req.path);
      return res.sendFile(file);
    }
    return res.status(404).json({ error: "Not found" });
  }
);

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
