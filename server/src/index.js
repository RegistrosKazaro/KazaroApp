import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "./utils/env.js";
import { db, ensureStockColumn, ensureStockSyncTriggers, DB_RESOLVED_PATH } from "./db.js";
import authRoutes from "./routes/auth.js";
import ordersRoutes from "./routes/orders.js";
import adminRoutes from "./routes/admin.js";
import catalogRoutes from "./routes/catalog.js";
import servicesRoutes from "./routes/services.js";
import supervisorRoutes from "./routes/supervisor.js";
import serviceProductsRoutes from "./routes/serviceProducts.js";
import reportsRoutes from "./routes/reports.js";
import depositoRoutes from "./routes/deposito.js"; 
import { verifyTransport as verifyMailerTransport } from "./utils/mailer.js";
import { createCorsMiddleware } from "./utils/corsConfig.js";  // Middleware de CORS dinámico

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
console.log('SMTP_PASS:', process.env.SMTP_PASS);

// Desactiva el header X-Powered-By
app.disable("x-powered-by");

// Configura proxy inverso si corresponde
if (env.TRUST_PROXY) {
  app.set("trust proxy", env.TRUST_PROXY === "1" ? 1 : env.TRUST_PROXY);
}

// Middleware CORS basado en .env (APP_BASE_URL y CORS_ALLOWED_ORIGINS)
// Permite localhost:5173 y dominios definidos en producción.
app.use(createCorsMiddleware());

app.use(express.json());
app.use(cookieParser());

console.log("[db] PATH:", DB_RESOLVED_PATH);

// Rutas sin prefijo /api (corresponden a los endpoints que usa tu frontend)
app.use("/auth", authRoutes);
app.use("/orders", ordersRoutes);
app.use("/admin", adminRoutes);
app.use("/catalog", catalogRoutes);
app.use("/services", servicesRoutes);
app.use("/supervisor", supervisorRoutes);
app.use("/service-products", serviceProductsRoutes);
app.use("/reports", reportsRoutes);
app.use("/deposito", depositoRoutes);

// Endpoint para obtener el token CSRF
app.get("/csrf-token", (req, res) => {
  let token = req.cookies?.csrf_token;
  if (!token) token = crypto.randomBytes(16).toString("hex");
  res.cookie("csrf_token", token, {
    httpOnly: false,
    sameSite: "lax",
    secure: env.NODE_ENV === "production", // usa true si sirves con HTTPS
    maxAge: 12 * 60 * 60 * 1000,
    path: "/",
  });
  return res.json({ csrfToken: token });
});

// Endpoint de salud
app.get("/_health", (_req, res) => res.json({ ok: true }));

// Inicializa columnas y triggers en la base de datos
ensureStockColumn();
ensureStockSyncTriggers();

// Arranque del servidor
const PORT = env.PORT || 4000;
app.listen(PORT, "0.0.0.0", async () => {
  // Usa APP_BASE_URL si existe, o fallback a localhost:PORT
  const host = env.APP_BASE_URL || `http://localhost:${PORT}`;
  console.log(`✅ [server] Running on ${host}`);
  try {
    await verifyMailerTransport();
    console.log("📧 Mailer verificado correctamente");
  } catch (e) {
    console.warn("⚠️ Mailer warning:", e.message);
  }
});
