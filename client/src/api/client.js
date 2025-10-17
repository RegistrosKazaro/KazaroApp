// client/src/api/client.js
import axios from "axios";

/**
 * Base URL del backend:
 * - Usa VITE_API_URL si está definida (recomendado).
 * - Si no, por defecto http://localhost:4000 (server Express).
 */
const BASE_URL =
  (import.meta?.env && import.meta.env.VITE_API_URL) ||
  "http://localhost:4000";

export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true, // cookies (token / csrf_token)
  headers: { "Content-Type": "application/json" },
});

let _csrf = null;
let _pending = null;

/** Pide/renueva el token CSRF (el server setea cookie csrf_token) */
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

/** Forzar obtención/renovación del token (útil al iniciar app o antes de un POST) */
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

/* ===== Interceptor de respuesta: si 403 CSRF, renueva y reintenta 1 vez ===== */
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
      } catch (e) {
        // Evita eslint(no-empty) y eslint(no-unused-vars)
        void e;
      }
    }
    return Promise.reject(error);
  }
);
