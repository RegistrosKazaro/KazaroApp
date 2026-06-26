// client/src/pages/ResetPassword.jsx
import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import "../styles/login.css";

export default function ResetPassword() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setP] = useState("");
  const [password2, setP2] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) setErr("Enlace inválido o incompleto.");
  }, [token]);

  async function onSubmit(e) {
    e.preventDefault();
    if (loading) return;
    if (!token) { setErr("Enlace inválido."); return; }
    if (password.length < 6) { setErr("La contraseña debe tener al menos 6 caracteres."); return; }
    if (password !== password2) { setErr("Las contraseñas no coinciden."); return; }
    setErr("");
    setMsg("");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/reset-password", { token, password });
      setMsg(data?.message || "Contraseña actualizada. Ya podés iniciar sesión.");
      setDone(true);
    } catch (error) {
      setErr(error?.response?.data?.error || "No se pudo restablecer la contraseña.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-bg">
      <div className="login-container">
        <form onSubmit={onSubmit} className="login-card">
          <div className="login-header-text">
            <h1 className="login-title">Nueva contraseña</h1>
            <p className="login-subtitle">Elegí una contraseña nueva para tu cuenta.</p>
          </div>

          {!done && (
            <div className="login-fields">
              <div className="field-group">
                <label htmlFor="rPass">Nueva contraseña</label>
                <div className="input-with-btn">
                  <input
                    id="rPass"
                    type={show ? "text" : "password"}
                    className="input"
                    value={password}
                    onChange={(e) => setP(e.target.value)}
                    disabled={loading}
                    placeholder="Mínimo 6 caracteres"
                  />
                  <button
                    type="button"
                    className="toggle-btn"
                    onClick={() => setShow((s) => !s)}
                    tabIndex={-1}
                  >
                    {show ? "Ocultar" : "Mostrar"}
                  </button>
                </div>
              </div>

              <div className="field-group">
                <label htmlFor="rPass2">Repetir contraseña</label>
                <input
                  id="rPass2"
                  type={show ? "text" : "password"}
                  className="input"
                  value={password2}
                  onChange={(e) => setP2(e.target.value)}
                  disabled={loading}
                  placeholder="Repetí la contraseña"
                />
              </div>
            </div>
          )}

          {err && <div className="login-error">{err}</div>}
          {msg && <div className="login-success" style={{ color: "#16a34a", fontSize: "0.9rem", margin: "8px 0" }}>{msg}</div>}

          {!done ? (
            <button className="btn-primary" type="submit" disabled={loading || !token}>
              {loading ? "Guardando..." : "Cambiar contraseña"}
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={() => nav("/")}>
              Ir al inicio
            </button>
          )}

          {!done && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => nav("/login")}
              disabled={loading}
            >
              ← Volver al login
            </button>
          )}
        </form>
      </div>
    </div>
  );
}