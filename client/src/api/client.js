import axios from "axios";

const BASE_URL =
  (import.meta?.env && import.meta.env.VITE_API_URL) ||
  "http://localhost:4000";

export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true, // envía cookies (token/sid/csrf) en CORS
  headers: { "Content-Type": "application/json" },
});

let _csrf = null;
let _pending = null;

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

export async function ensureCsrf() {
  _csrf = null;
  return fetchCsrf();
}

// Inyecta CSRF sólo en métodos inseguros
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

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const status = error?.response?.status;
    const method = error?.config?.method?.toUpperCase?.() || "";
    const unsafe = /^(POST|PUT|PATCH|DELETE)$/i.test(method);
    const notRetried = !error?.config?._csrfRetried;

    // Si el server pidió CSRF y el token caducó, lo re-pedimos una vez y reintentamos
    if (status === 403 && unsafe && notRetried) {
      try {
        await ensureCsrf();
        const cfg = { ...error.config, _csrfRetried: true };
        cfg.headers = { ...(cfg.headers || {}), "X-CSRF-Token": _csrf };
        return api(cfg);
      } catch {
        // noop
      }
    }
    return Promise.reject(error);
  }
);
