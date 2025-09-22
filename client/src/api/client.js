// client/src/api/client.js
import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:4000",
  withCredentials: true, // 👈 MUY IMPORTANTE
});

// (Opcional) interceptores para debug rápido
api.interceptors.response.use(
  (r) => r,
  (err) => {
    console.debug("[api] error", err?.response?.status, err?.response?.data);
    throw err;
  }
);
