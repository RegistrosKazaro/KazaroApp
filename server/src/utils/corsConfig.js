import cors from "cors";
import { env } from "./env.js";

const normalizeOrigin = (origin) =>
  typeof origin === "string" ? origin.replace(/\/$/, "").trim() : origin;

// CORRECCIÓN AQUÍ: 
// Usamos el operador '??' (Nullish Coalescing) para que si es undefined use []
const parseAdditionalOrigins = () => {
  const origins = env.CORS_ALLOWED_ORIGINS ?? []; 
  return Array.isArray(origins) 
    ? origins.map((value) => normalizeOrigin(value)).filter(Boolean)
    : [];
};

export const getAllowedOrigins = () => {
  // Aseguramos que APP_BASE_URL exista antes de normalizar
  const baseOrigin = env.APP_BASE_URL ? normalizeOrigin(env.APP_BASE_URL) : null;
  const additionalOrigins = parseAdditionalOrigins();
  
  const origins = [baseOrigin, ...additionalOrigins].filter(Boolean);
  return Array.from(new Set(origins));
};

const createCorsOptionsDelegate = () => {
  const allowedOrigins = getAllowedOrigins();
  const methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"];

  return (req, callback) => {
    const requestOrigin = normalizeOrigin(req.header("Origin"));

    // Si no hay origen (peticiones server-to-server o herramientas locales), permitimos
    if (!requestOrigin) {
      callback(null, { origin: true, credentials: false, methods });
      return;
    }

    const allowAll = allowedOrigins.length === 0;
    const isAllowed = allowAll || allowedOrigins.includes(requestOrigin);

    if (!isAllowed) {
      // Es mejor pasar un error controlado o simplemente origin: false
      callback(new Error("Not allowed by CORS"), { origin: false });
      return;
    }

    callback(null, { origin: true, credentials: true, methods });
  };
};

export const createCorsMiddleware = () => {
  const delegate = createCorsOptionsDelegate();
  const handler = cors(delegate);

  return (req, res, next) => {
    handler(req, res, (err) => {
      if (err) {
        // Capturamos el error del callback anterior
        res.status(403).json({ error: "Not allowed by CORS" });
        return;
      }
      next();
    });
  };
};