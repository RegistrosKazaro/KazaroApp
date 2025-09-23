// server/src/index.js
import express from "express";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import path from "path";
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
import { DB_RESOLVED_PATH, db } from "./db.js";
import { verifyMailTransport, sendMail } from "./utils/mailer.js";

const PUBLIC_DIR = process.env.PUBLIC_DIR || path.resolve(process.cwd(), "public");
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ALLOWED = new Set([
  env.APP_URL || "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    return cb(null, ALLOWED.has(origin));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cache-Control", "Pragma", "Expires"],
}));

app.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.static(PUBLIC_DIR));
app.use(cookieParser());
app.use(express.json());
app.use(morgan("dev"));
app.use(cookies);
app.use("/auth", authRoutes);
app.use("/me", meRoutes);
app.use("/catalog", catalogRoutes);
app.use("/orders", ordersRoutes);
app.use("/supervisor", supervisorRoutes);
app.use("/services", servicesRoutes);
app.get("/auth/my-services", (req, res, next) => {
  req.url = "/my";
  return servicesRoutes(req, res, next);
});
app.use("/dev", devRoutes);

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

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

const PORT = Number(env.PORT || process.env.PORT || 4000);

app.listen(PORT, async () => {
  console.log(`[server] http://localhost:${PORT} (${env.NODE_ENV || "development"})`);

  console.log("[db] usando:", DB_RESOLVED_PATH);
  try {
    const cnt = db.prepare("SELECT COUNT(*) AS c FROM Empleados").get()?.c ?? 0;
    const cols = db.prepare("PRAGMA table_info(Empleados)").all().map(c => c.name);
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
