import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import cors from "cors"; // Faltaba este import

import authRoutes from "./routes/auth.js";
import ordersRoutes from "./routes/orders.js";
import adminRoutes from "./routes/admin.js";
import catalogRoutes from "./routes/catalog.js";
import servicesRoutes from "./routes/services.js";
import supervisorRoutes from "./routes/supervisor.js";
import serviceProductsRoutes from "./routes/serviceProducts.js";
import reportsRoutes from "./routes/reports.js";
import depositoRoutes from "./routes/deposito.js";
import { env } from "./utils/env.js";

export const createApp = () => { // Corregido el nombre a createApp
  const app = express();

  // Configuración de CORS Directa y Robusta
  app.use(cors({
    origin: [
      "http://insumos.kazaro.com.ar", 
      "http://18.207.207.60",
      "http://localhost:5173" // Para que puedas probar local también
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-csrf-token"]
  }));

  app.disable("x-powered-by");
  app.use(express.json());
  app.use(cookieParser());

  // Rutas - Asegúrate de que los prefijos coincidan con tu frontend
  app.use("/api/auth", authRoutes);
  app.use("/api/orders", ordersRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/catalog", catalogRoutes);
  app.use("/api/services", servicesRoutes);
  app.use("/api/supervisor", supervisorRoutes);
  app.use("/api/service-products", serviceProductsRoutes);
  app.use("/api/reports", reportsRoutes);
  app.use("/api/deposito", depositoRoutes);

  // Endpoint para CSRF (Importante para tu login)
  app.get("/api/csrf-token", (req, res) => {
    let token = req.cookies?.csrf_token;
    if (!token) token = crypto.randomBytes(16).toString("hex");
    
    res.cookie("csrf_token", token, {
      httpOnly: false, // Debe ser false para que el front pueda leerlo si es necesario
      sameSite: "lax",
      secure: false, // Cambia a true solo si usas HTTPS (SSL)
      maxAge: 12 * 60 * 60 * 1000,
      path: "/",
    });
    return res.json({ csrfToken: token });
  });

  app.get("/_health", (_req, res) => res.json({ ok: true }));

  return app;
};