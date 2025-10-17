import { useEffect, useState } from "react";
import { api, ensureCsrf } from "../api/client";
import { AuthContext } from "./auth-context";

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Cargar sesión al montar
  useEffect(() => {
    let alive = true;
    api
      .get("/auth/me")
      .then((res) => {
        if (alive) setUser(res.data);
      })
      .catch(() => {
        if (alive) setUser(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 🔐 Login con CSRF asegurado
  async function login(username, password) {
    await ensureCsrf(); // cookie csrf_token + header X-CSRF-Token
    const res = await api.post("/auth/login", { username, password });
    const payload = res.data?.user || res.data; // soporta {user} o usuario directo
    setUser(payload);
    return payload;
  }

  async function logout() {
    try {
      await api.post("/auth/logout");
    } catch (e) {
      // Evita eslint(no-empty) y eslint(no-unused-vars)
      void e;
    }
    // limpiar carrito/servicio y notificar al CartProvider
    localStorage.removeItem("cart");
    localStorage.removeItem("selectedService");
    window.dispatchEvent(new Event("app:logout"));

    setUser(null);
    window.location.replace("/login");
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
