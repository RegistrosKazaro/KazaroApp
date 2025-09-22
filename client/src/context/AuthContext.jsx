/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../api/client";

export const AuthContext = createContext(null);
export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Cargar sesión al montar
  useEffect(() => {
    let alive = true;
    api.get("/auth/me")
      .then((res) => { if (alive) setUser(res.data); })
      .catch(() => { if (alive) setUser(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  async function login(username, password) {
    const res = await api.post("/auth/login", { username, password });
    setUser(res.data); // { id, username, roles: [...] }
    return res.data;
  }

  async function logout() {
    try {
      await api.post("/auth/logout");
    } catch {
      /* no-op: evitamos la regla no-empty y no usamos 'e' */
    }
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
