import express from "express";
import cors from "cors";
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
import { verifyTransport } from "./utils/mailer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable("x-powered-by");

app.use(
  cors({
    origin: (origin, cb) => cb(null, true),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  })
);

app.use(express.json());
app.use(cookieParser());

console.log("[db] PATH:", DB_RESOLVED_PATH);

app.use("/auth", authRoutes);
app.use("/orders", ordersRoutes);
app.use("/admin", adminRoutes);
app.use("/catalog", catalogRoutes);
app.use("/services", servicesRoutes);
app.use("/supervisor", supervisorRoutes);
app.use("/service-products", serviceProductsRoutes);
app.use("/reports", reportsRoutes);
app.use("/deposito", depositoRoutes);

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

app.get("/_health", (_req, res) => res.json({ ok: true }));

ensureStockColumn();
ensureStockSyncTriggers();

app.listen(env.PORT, async () => {
  console.log(`[server] Running on ${env.APP_BASE_URL}`);
  try {
    await verifyTransport();
  } catch (e) {
    console.warn(e.message);
  }
});