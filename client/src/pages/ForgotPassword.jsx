// client/src/pages/ForgotPassword.jsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useEmpresa } from "../hooks/useEmpresa";
import "../styles/login.css";

export default function ForgotPassword() {
  const nav = useNavigate();
  const { empresa } = useEmpresa();

  const [username, setU] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!empresa) nav("/", { replace: true });
  }, [empresa, nav]);

  async function onSubmit(e) {
    e.preventDefault();
    if (loading) return;
    const u = username.trim();
    if (!u) { setErr("Ingresá tu usuario o email"); return; }
    setErr("");
    setMsg("");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/forgot-password", {
        username: u,
        empresaSlug: empresa?.slug ?? "kazaro",
      });
      setMsg(data?.message || "Si el usuario existe, te enviamos un email con instrucciones.");
    } catch {
      setMsg("Si el usuario existe, te enviamos un email con instrucciones.");
    } finally {
      setLoading(false);
    }
  }

  if (!empresa) return null;

  return (
    <div className="login-bg">
      <div className="login-container">
        <form onSubmit={onSubmit} className="login-card">
          <div className="login-header-text">
            <h1 className="login-title">Restablecer contraseña</h1>
            <p className="login-subtitle">
              Ingresá tu usuario o email de <strong>{empresa.nombre}</strong> y te enviaremos un enlace.
            </p>
          </div>

          <div className="login-fields">
            <div className="field-group">
              <label htmlFor="fUser">Usuario o email</label>
              <input
                id="fUser"
                className="input"
                type="text"
                value={username}
                onChange={(e) => setU(e.target.value)}
                autoFocus
                disabled={loading}
                placeholder="Tu usuario o email"
              />
            </div>
          </div>

          {err && <div className="login-error">{err}</div>}
          {msg && <div className="login-success" style={{ color: "#16a34a", fontSize: "0.9rem", margin: "8px 0" }}>{msg}</div>}

          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? "Enviando..." : "Enviar enlace"}
          </button>

          <button
            type="button"
            className="btn-ghost"
            onClick={() => nav("/login")}
            disabled={loading}
          >
            ← Volver al login
          </button>
        </form>
      </div>
    </div>
  );
}