import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import path from "path";
import cors from "cors"; // Agregado para arreglar el error de consola
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable("x-powered-by");

if (env.TRUST_PROXY) {
  app.set("trust proxy", env.TRUST_PROXY === "1" ? 1 : env.TRUST_PROXY);
}

// --- SOLUCIÓN AL ERROR DE CONSOLA (CORS) ---
app.use(cors({
  origin: ["http://insumos.kazaro.com.ar", "http://18.207.207.60"],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-csrf-token"]
}));

app.use(express.json());
app.use(cookieParser());

console.log("[db] PATH:", DB_RESOLVED_PATH);

// --- RUTAS (Agregamos /api para que coincida con el Frontend) ---
app.use("/api/auth", authRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/catalog", catalogRoutes);
app.use("/api/services", servicesRoutes);
app.use("/api/supervisor", supervisorRoutes);
app.use("/api/service-products", serviceProductsRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/deposito", depositoRoutes);

// Endpoint para CSRF Token
app.get("/api/csrf-token", (req, res) => {
  let token = req.cookies?.csrf_token;
  if (!token) token = crypto.randomBytes(16).toString("hex");
  res.cookie("csrf_token", token, {
    httpOnly: false,
    sameSite: "lax",
    secure: false, // Cambiar a true si usas HTTPS (SSL)
    maxAge: 12 * 60 * 60 * 1000,
    path: "/",
  });
  return res.json({ csrfToken: token });
});

app.get("/_health", (_req, res) => res.json({ ok: true }));

// Inicialización de DB
ensureStockColumn();
ensureStockSyncTriggers();

// Arranque del servidor
const PORT = env.PORT || 4000;
app.listen(PORT, "0.0.0.0", async () => {
  console.log(`✅ [server] Running on http://localhost:${PORT}`);
  try { 
    await verifyMailerTransport();
    console.log("📧 Mailer verificado correctamente");
  } catch (e) {
    console.warn("⚠️ Mailer warning:", e.message);
  }
});