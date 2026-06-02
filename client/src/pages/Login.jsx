// client/src/pages/Login.jsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useEmpresa } from "../hooks/useEmpresa";
import "../styles/login.css";
import logo from "../assets/LogoVertFull.png";
import logoPazar from "../assets/LogoPazar.png";
import isoBadges from "../assets/normasiso.png";

export default function Login() {
  const nav         = useNavigate();
  const { login }   = useAuth();
  const { empresa } = useEmpresa();

  const [username, setU]      = useState("");
  const [password, setP]      = useState("");
  const [show,     setShow]   = useState(false);
  const [err,      setErr]    = useState("");
  const [loading,  setLoading]= useState(false);

  useEffect(() => {
    if (!empresa) nav("/", { replace: true });
  }, [empresa, nav]);

  async function onSubmit(e) {
    e.preventDefault();
    if (loading) return;
    const u = username.trim();
    const p = password;
    if (!u || !p) { setErr("Ingresá usuario y contraseña"); return; }
    setErr("");
    setLoading(true);
    try {
      const { roles = [] } = await login(u, p, empresa?.slug ?? "kazaro");
      const rolesLower = roles.map((r) => String(r).toLowerCase());
      if (rolesLower.length > 1) { nav("/roles", { replace: true }); return; }
      if (rolesLower.some((r) => r.includes("super"))) {
        nav("/app/supervisor/services", { replace: true });
      } else {
        nav("/app/administrativo/products", { replace: true });
      }
    } catch (error) {
      const message = error?.response?.data?.error || error?.message || "Usuario o contraseña inválidos";
      setErr(message);
    } finally {
      setLoading(false);
    }
  }

  if (!empresa) return null;

  return (
    <div className="login-bg">
      <div className="login-container">
        <form onSubmit={onSubmit} className="login-card">

          {/* Logo */}
          <div className="login-logo-wrap">
            <img
  src={empresa?.slug === "pazar" ? logoPazar : logo}
  className={empresa?.slug === "pazar" ? "brand-logo brand-logo-pazar" : "brand-logo"}
  alt={empresa.nombre}
/>
          </div>

          {/* Título */}
          <div className="login-header-text">
            <h1 className="login-title">Bienvenido</h1>
            <p className="login-subtitle">Ingresá a <strong>{empresa.nombre}</strong></p>
          </div>

          {/* Campos */}
          <div className="login-fields">
            <div className="field-group">
              <label htmlFor="lUsername">Usuario</label>
              <input
                id="lUsername"
                className="input"
                type="text"
                value={username}
                onChange={(e) => setU(e.target.value)}
                autoFocus
                autoComplete="username"
                disabled={loading}
                placeholder="Tu usuario"
              />
            </div>

            <div className="field-group">
              <label htmlFor="lPassword">Contraseña</label>
              <div className="input-with-btn">
                <input
                  id="lPassword"
                  type={show ? "text" : "password"}
                  className="input"
                  value={password}
                  onChange={(e) => setP(e.target.value)}
                  autoComplete="current-password"
                  disabled={loading}
                  placeholder="Tu contraseña"
                />
                <button
                  type="button"
                  className="toggle-btn"
                  onClick={() => setShow((s) => !s)}
                  aria-pressed={show}
                  tabIndex={-1}
                >
                  {show ? "Ocultar" : "Mostrar"}
                </button>
              </div>
            </div>
          </div>

          {err && <div className="login-error">{err}</div>}

          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? "Ingresando..." : "Ingresar"}
          </button>

          <button
            type="button"
            className="btn-ghost"
            onClick={() => nav("/", { replace: true })}
            disabled={loading}
          >
            ← Cambiar empresa
          </button>

        </form>
      </div>

      <img src={isoBadges} className="iso-badges" alt="Certificaciones ISO y Empresa B" />
    </div>
  );
}