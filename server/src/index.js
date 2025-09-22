// server/src/index.js
import express from "express";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";

import { env } from "./utils/env.js";
import { cookies } from "./middleware/auth.js";

// Rutas de la app
import authRoutes from "./routes/auth.js";
import catalogRoutes from "./routes/catalog.js";
import ordersRoutes from "./routes/orders.js";
import supervisorRoutes from "./routes/supervisor.js";
import servicesRoutes from "./routes/services.js";
import meRoutes from "./routes/me.js";
import devRoutes from "./routes/dev.js";

// DB info para debugging
import { DB_RESOLVED_PATH, db } from "./db.js";

// Mail utils (para verificar SMTP y test opcional)
import { verifyMailTransport, sendMail } from "./utils/mailer.js";

const app = express();

// __dirname / __filename para ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ============================= CORS ============================= */
const ALLOWED = new Set([
  env.APP_URL || "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

app.use(cors({
  origin(origin, cb) {
    // permitir llamadas server->server (sin Origin) y orígenes whitelisted
    if (!origin) return cb(null, true);
    return cb(null, ALLOWED.has(origin));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cache-Control", "Pragma", "Expires"],
}));

// Respuesta rápida a preflight
app.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/* ==================== Estáticos (PDFs en /public) ==================== */
// Sirve /public en raíz. Ej: /remitos/archivo.pdf -> public/remitos/archivo.pdf
app.use(express.static(path.resolve(process.cwd(), "public")));

/* ======================= Middlewares base ======================= */
app.use(cookieParser());
app.use(express.json());
app.use(morgan("dev"));

// Cookies (sesión) ANTES de rutas que usan requireAuth
app.use(cookies);

/* ============================ Rutas ============================ */
app.use("/auth", authRoutes);
app.use("/me", meRoutes);
app.use("/catalog", catalogRoutes);
app.use("/orders", ordersRoutes);
app.use("/supervisor", supervisorRoutes);
app.use("/services", servicesRoutes);

// Alias /auth/my-services -> reutiliza router de /services en subruta /my
app.get("/auth/my-services", (req, res, next) => {
  // redirigimos internamente a /services/my
  req.url = "/my";
  return servicesRoutes(req, res, next);
});

// Rutas “dev” (diagnóstico)
app.use("/dev", devRoutes);

/* ============= (OPCIONAL) ENDPOINT DE PRUEBA DE MAIL ============= */
/* Dejalo mientras probás. Luego lo podés borrar. */
app.get("/mail-test", async (_req, res) => {
  try {
    const ok = await verifyMailTransport();
    if (!ok) return res.status(500).json({ ok: false, error: "SMTP verify failed" });

    const to = env.MAIL_TO || "nicolas.barcena@kazaro.com.ar";
    const info = await sendMail({
      to,
      subject: "TEST SMTP Kazaro",
      html: `<p>Prueba de SMTP OK.</p><p>Remitente: ${env.MAIL_FROM || env.SMTP_USER}</p>`,
    });
    return res.json({ ok: true, messageId: info.messageId });
  } catch (e) {
    console.error("[/mail-test] error:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});
/* ================================================================ */

app.get("/health", (_req, res) => res.json({ ok: true }));

// 404
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

/* ============================ Start ============================ */
const PORT = Number(env.PORT || process.env.PORT || 4000);

app.listen(PORT, async () => {
  console.log(`[server] http://localhost:${PORT} (${env.NODE_ENV || "development"})`);

  // Log de DB para confirmar que lees la base correcta
  console.log("[db] usando:", DB_RESOLVED_PATH);
  try {
    const cnt = db.prepare("SELECT COUNT(*) AS c FROM Empleados").get()?.c ?? 0;
    const cols = db.prepare("PRAGMA table_info(Empleados)").all().map(c => c.name);
    console.log("[db] Empleados filas:", cnt);
    console.log("[db] Empleados columnas:", cols);
  } catch (e) {
    console.log("[db] No pude leer Empleados:", e?.message || e);
  }

  // Verificamos SMTP al arrancar (no corta el server si falla, pero loguea)
  try {
    const ok = await verifyMailTransport();
    console.log(ok ? "[mail] SMTP verify OK" : "[mail] SMTP verify FAILED");
  } catch (e) {
    console.error("[mail] SMTP verify ERROR:", e);
  }
});
