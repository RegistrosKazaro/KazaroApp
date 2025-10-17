import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "./utils/env.js";
import authRoutes from "./routes/auth.js";
import ordersRoutes from "./routes/orders.js";
import { requireCsrf, csrfTokenRoute } from "./utils/simpleCsrf.js";
import { db } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// --- CORS ---
app.use(cors({
  origin: (origin, cb) => cb(null, true),
  credentials: true,
}));

app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

// CSRF
app.get("/csrf-token", csrfTokenRoute);
app.use(requireCsrf);

// Rutas
app.use("/auth", authRoutes);
app.use("/orders", ordersRoutes);

// Health
app.get("/_health", (req, res) => res.json({ ok: true }));

// Start
const PORT = env.PORT || 4000;
app.listen(PORT, () => {
  try { db.pragma("journal_mode = WAL"); } catch {}
  console.log(`[server] listening on http://localhost:${PORT} (${env.NODE_ENV})`);
});
