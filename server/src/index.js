import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "./utils/env.js";
import { ensureStockColumn, DB_RESOLVED_PATH, db } from "./db.js";

import authRoutes from "./routes/auth.js";
import ordersRoutes from "./routes/orders.js";
import adminRoutes from "./routes/admin.js";
import catalogRoutes from "./routes/catalog.js";
import servicesRoutes from "./routes/services.js";
import supervisorRoutes from "./routes/supervisor.js";
import serviceProductsRoutes from "./routes/serviceProducts.js";
import reportsRoutes from "./routes/reports.js";
// import meRoutes from "./routes/me.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors({
  origin: (origin, cb) => cb(null, true),
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Logs de diagnóstico
console.log("[db] Usando base:", DB_RESOLVED_PATH);
try {
  const c = db.prepare("SELECT COUNT(*) AS c FROM Empleados").get()?.c ?? 0;
  console.log("[db] Empleados en la base:", c);
} catch {
  console.log("[db] Empleados: tabla no encontrada");
}

/* CSRF para el frontend */
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

/* Rutas */
app.use("/auth", authRoutes);
app.use("/orders", ordersRoutes);
app.use("/admin", adminRoutes);
app.use("/catalog", catalogRoutes);
app.use("/services", servicesRoutes);
app.use("/supervisor", supervisorRoutes);
app.use("/service-products", serviceProductsRoutes);
app.use("/reports", reportsRoutes);
// app.use("/me", meRoutes);

app.get("/_health", (_req, res) => res.json({ ok: true }));

ensureStockColumn();

app.listen(env.PORT, () => {
  console.log(`[server] ${env.APP_BASE_URL} (${env.NODE_ENV})`);
});
