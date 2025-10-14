// client/src/api/client.js
import axios from "axios";

/**
 * Base URL:
 * - Usa VITE_API_URL si está definida.
 * - Si no, usa el mismo origen donde se sirve la app.
 */
const BASE_URL =
  (import.meta?.env && import.meta.env.VITE_API_URL) ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:10000");

export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true, // 👈 necesario para que viajen cookies (sid + secreto CSRF)
  headers: { "Content-Type": "application/json" },
});

let _csrf = null;
let _pending = null;

/** Pide el token al backend (requiere que el server tenga /csrf-token detrás de csurf) */
async function fetchCsrf() {
  if (_pending) return _pending;
  _pending = api
    .get("/csrf-token", { withCredentials: true })
    .then((r) => {
      _csrf = r?.data?.csrfToken || null;
      return _csrf;
    })
    .finally(() => {
      _pending = null;
    });
  return _pending;
}

/** Forzá la obtención/renovación del token (la llamamos al arrancar la app) */
export async function ensureCsrf() {
  _csrf = null;
  return fetchCsrf();
}

/* ===== Interceptor de request: agrega X-CSRF-Token a métodos no seguros ===== */
api.interceptors.request.use(async (config) => {
  const method = (config.method || "get").toUpperCase();
  const unsafe = /^(POST|PUT|PATCH|DELETE)$/i.test(method);
  if (unsafe) {
    if (!_csrf) await fetchCsrf();
    if (_csrf) {
      config.headers = { ...(config.headers || {}), "X-CSRF-Token": _csrf };
    }
  }
  return config;
});

/* ===== Interceptor de respuesta: si falla por 403 CSRF, renueva y reintenta 1 vez ===== */
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const status = error?.response?.status;
    const method = error?.config?.method?.toUpperCase?.() || "";
    const unsafe = /^(POST|PUT|PATCH|DELETE)$/i.test(method);
    const notRetried = !error?.config?._csrfRetried;

    if (status === 403 && unsafe && notRetried) {
      try {
        await ensureCsrf();
        const cfg = { ...error.config, _csrfRetried: true };
        cfg.headers = { ...(cfg.headers || {}), "X-CSRF-Token": _csrf };
        return api(cfg);
      } catch {
        // sin uso de variable -> no dispara no-unused-vars
      }
    }
    return Promise.reject(error);
  }
);
