import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "./utils/env.js";
import {
  db, // ← NECESARIO para el conteo de empleados
  ensureStockColumn,
  ensureStockSyncTriggers,
  DB_RESOLVED_PATH,
} from "./db.js";

// Rutas
import authRoutes from "./routes/auth.js";
import ordersRoutes from "./routes/orders.js";
import adminRoutes from "./routes/admin.js";
import catalogRoutes from "./routes/catalog.js";
import servicesRoutes from "./routes/services.js";
import supervisorRoutes from "./routes/supervisor.js";
import serviceProductsRoutes from "./routes/serviceProducts.js";
import reportsRoutes from "./routes/reports.js";

// ✔ verificación SMTP
import { verifyTransport } from "./utils/mailer.js";

// 🔒 para /auth/me
import { requireAuth } from "./middleware/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable("x-powered-by");

app.use(
  cors({
    origin: (origin, cb) => cb(null, true),
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

console.log("[db] Usando base:", DB_RESOLVED_PATH);
try {
  const c = db.prepare("SELECT COUNT(*) AS c FROM Empleados").get()?.c ?? 0;
  console.log("[db] Empleados en la base:", c);
} catch {
  console.log("[db] Empleados: tabla no encontrada");
}

/* ========= Endpoint requerido por el cliente para CSRF ========= */
app.get("/csrf-token", (req, res) => {
  let token = req.cookies?.csrf_token;
  if (!token) token = crypto.randomBytes(16).toString("hex");
  res.cookie("csrf_token", token, {
    httpOnly: false,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    maxAge: 12 * 60 * 60 * 1000,
    path: "/",
  });
  return res.json({ csrfToken: token });
});

/* ========= Rutas de la app ========= */
app.use("/auth", authRoutes);
app.use("/orders", ordersRoutes);
app.use("/admin", adminRoutes);
app.use("/catalog", catalogRoutes);
app.use("/services", servicesRoutes);
app.use("/supervisor", supervisorRoutes);
app.use("/service-products", serviceProductsRoutes);
app.use("/reports", reportsRoutes);

/* ========= NUEVO: restaurar sesión en recarga =========
   El front debe llamar GET /auth/me con credentials: 'include'
   Apenas monta la app (por ejemplo en App.jsx useEffect).
======================================================== */
app.get("/auth/me", requireAuth, (req, res) => {
  // req.user viene desde requireAuth usando el token de la cookie
  return res.json({ ok: true, user: req.user });
});

// Healthcheck
app.get("/_health", (_req, res) => res.json({ ok: true }));

// 🔧 Inicializaciones de DB
ensureStockColumn();
ensureStockSyncTriggers();
console.log(`[db] usando DB en: ${DB_RESOLVED_PATH}`);

app.listen(env.PORT, async () => {
  console.log(`[server] ${env.APP_BASE_URL} (${env.NODE_ENV})`);
  // ✔ verifica SMTP al arrancar (ayuda a detectar 535, puertos, etc.)
  try {
    await verifyTransport();
  } catch (e) {
    console.warn("[mailer] verificación fallida:", e?.message || e);
  }
});

// Guardas de proceso útiles en dev/prod
process.on("unhandledRejection", (e) => {
  console.error("[unhandledRejection]", e?.message || e);
});
process.on("uncaughtException", (e) => {
  console.error("[uncaughtException]", e?.message || e);
});
