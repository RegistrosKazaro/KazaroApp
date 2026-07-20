// client/src/pages/Login.jsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useEmpresa } from "../hooks/useEmpresa";
import WavesBackground from "../components/WavesBackground";
import "../styles/login.css";
import logoSideKazaro from "../assets/LogoHorizWhite.png";
import logoSmallKazaro from "../assets/LogoReducFull (1).png";
import logoPazar from "../assets/LogoPazar.png";
import isoBadges from "../assets/normasiso.png";

const DocIcon = () => (
  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 2h9l5 5v15H6V2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <path d="M14 2v5h5M9 13h6M9 17h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const ChartIcon = () => (
  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 20V10M11 20V4M18 20v-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);
const StockIcon = () => (
  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3 10.5 12 3l9 7.5M5 9v11h14V9" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
  </svg>
);
const ShieldIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 2 4 5v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V5l-8-3Z" stroke="#94a3b8" strokeWidth="1.8" strokeLinejoin="round" />
  </svg>
);

export default function Login() {
  const nav         = useNavigate();
  const { login }   = useAuth();
  const { empresa } = useEmpresa();

  const [username, setU]      = useState("");
  const [password, setP]      = useState("");
  const [show,     setShow]   = useState(false);
  const [err,      setErr]    = useState("");
  const [loading,  setLoading]= useState(false);
  const [totp,     setTotp]   = useState("");
  const [need2fa,  setNeed2fa]= useState(false);

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
      const { roles = [] } = await login(u, p, empresa?.slug ?? "kazaro", totp.trim());
      const rolesLower = roles.map((r) => String(r).toLowerCase());
      if (rolesLower.length > 1) { nav("/roles", { replace: true }); return; }
      if (rolesLower.some((r) => r.includes("super"))) {
        nav("/app/supervisor/services", { replace: true });
      } else {
        nav("/app/administrativo/products", { replace: true });
      }
    } catch (error) {
      if (error?.response?.data?.twofaRequired) {
        setNeed2fa(true);
        setErr(error?.response?.data?.error || "Ingresá el código de verificación");
        setLoading(false);
        return;
      }
      const message = error?.response?.data?.error || error?.message || "Usuario o contraseña inválidos";
      setErr(message);
    } finally {
      setLoading(false);
    }
  }

  if (!empresa) return null;

  const isPazar = empresa?.slug === "pazar";

  return (
    <div className="login-bg">
      <WavesBackground />
      <div className="login-container-split">
        <div className="login-split">

          {/* Panel lateral (marca + features) */}
          <div className="login-side-panel">
            <div>
              <h1 className="login-side-title">
                Insumos y servicios<br />
                grupo <span className="login-side-accent">{empresa.nombre}</span>
              </h1>
              <p className="login-side-subtitle">Acceso a la solicitud de insumos y servicios.</p>

              <div className="login-features">
                <div className="login-feature">
                  <div className="login-feature-icon"><DocIcon /></div>
                  <div className="login-feature-text">Creá y hacé seguimiento de tus pedidos.</div>
                </div>
                <div className="login-feature">
                  <div className="login-feature-icon"><ChartIcon /></div>
                  <div className="login-feature-text">Métricas de consumo por servicio y supervisor.</div>
                </div>
                <div className="login-feature">
                  <div className="login-feature-icon"><StockIcon /></div>
                  <div className="login-feature-text">Control de stock y devoluciones.</div>
                </div>
              </div>
            </div>

            <div className={isPazar ? "login-side-logo login-side-logo-pazar" : "login-side-logo"}>
              <img src={isPazar ? logoPazar : logoSideKazaro} alt={empresa.nombre} />
            </div>
          </div>

          {/* Formulario */}
          <form onSubmit={onSubmit} className="login-card login-card-split">

            {/* Logo */}
            <div className="login-logo-wrap">
              <img
                src={isPazar ? logoPazar : logoSmallKazaro}
                className={isPazar ? "brand-logo-small brand-logo-small-pazar" : "brand-logo-small"}
                alt={empresa.nombre}
              />
            </div>

            {/* Título */}
            <div className="login-header-text">
              <h2 className="login-title">Iniciar sesión</h2>
              <p className="login-subtitle">Ingresando a <strong>{empresa.nombre}</strong></p>
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

            {need2fa && (
              <div className="field-group">
                <label htmlFor="lTotp">Código de verificación</label>
                <input
                  id="lTotp"
                  className="input"
                  type="text"
                  inputMode="numeric"
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  disabled={loading}
                  placeholder="123456"
                  autoFocus
                  style={{ letterSpacing: "0.3em", textAlign: "center" }}
                />
              </div>
            )}
          </div>

          {err && <div className="login-error">{err}</div>}

          <div style={{ textAlign: "right", marginTop: -4, marginBottom: 4 }}>
            <button
              type="button"
              className="btn-ghost"
              style={{ fontSize: "0.85rem", padding: "2px 6px" }}
              onClick={() => nav("/forgot-password")}
              disabled={loading}
            >
              ¿Olvidaste tu contraseña?
            </button>
          </div>

          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? "Ingresando..." : (need2fa ? "Verificar" : "Ingresar")}
          </button>

          <button
            type="button"
            className="btn-ghost"
            onClick={() => nav("/", { replace: true })}
            disabled={loading}
          >
            ← Cambiar empresa
          </button>

            <div className="login-secure-footer">
              <ShieldIcon />
              <span>Acceso seguro al sistema de gestión</span>
            </div>

          </form>
        </div>
      </div>

      <img src={isoBadges} className="iso-badges" alt="Certificaciones ISO y Empresa B" />
    </div>
  );
}