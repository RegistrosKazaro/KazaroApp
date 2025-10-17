import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "./utils/env.js";
import { ensureStockColumn } from "./db.js";
import authRoutes from "./routes/auth.js";
import ordersRoutes from "./routes/orders.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors({
  origin: [
    "http://localhost:4000",
    "http://localhost:5173",
    "http://127.0.0.1:5173"
  ],
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Static (si tenés public)
const PUBLIC_DIR = path.join(__dirname, "public");
console.log("[static] PUBLIC_DIR:", PUBLIC_DIR);
app.use(express.static(PUBLIC_DIR));

// Rutas
app.use("/auth", authRoutes);
app.use("/orders", ordersRoutes);

// Health
app.get("/_health", (req, res) => res.json({ ok: true }));

// Arranque
ensureStockColumn();

app.listen(env.PORT, () => {
  console.log(`[server] ${env.APP_BASE_URL} (${env.NODE_ENV})`);
});
