import { useEffect, useState } from "react";
import { api, ensureCsrf } from "../api/client";
import { AuthContext } from "./auth-context";

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api
      .get("/auth/me")
      .then((res) => {
        const payload = res?.data?.user ?? res?.data ?? null;
        if (alive) setUser(payload);
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

  async function login(username, password) {
    await ensureCsrf();
    const res = await api.post("/auth/login", { username, password });
    const payload = res.data?.user || res.data || null;
    setUser(payload);
    return payload;
  }

  async function logout() {
    try {
      await api.post("/auth/logout");
    } catch (e) {
      if (typeof console !== "undefined") console.warn("[logout] fallo en servidor:", e);
    }
    try {
      localStorage.removeItem("cart");
      localStorage.removeItem("selectedService");
      window.dispatchEvent(new Event("app:logout"));
    } catch (e) {
      if (typeof console !== "undefined") console.warn("[logout] no se pudo limpiar storage:", e);
    }
    setUser(null);
    window.location.replace("/login");
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
