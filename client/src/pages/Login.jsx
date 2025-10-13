import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import "../styles/login.css";
import logo from "../assets/LogoVertFull.png";
import isoBadges from "../assets/normasiso.png";

export default function Login() {
  const nav = useNavigate();
  const { login } = useAuth();

  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    try {
      const { roles = [] } = await login(username, password);
      const rolesLower = roles.map((r) => String(r).toLowerCase());

      // Si el usuario tiene más de un rol -> pantalla de selección
      if (rolesLower.length > 1) return nav("/roles", { replace: true });

      // Si tiene un solo rol, lo mandamos a su landing directa
      if (rolesLower.some((r) => r.includes("super"))) {
        nav("/app/supervisor/services", { replace: true });
      } else {
        nav("/app/administrativo/products", { replace: true });
      }
    } catch (error) {
      console.error(error);
      setErr("Usuario o contraseña inválidos");
    }
  }

  return (
    <div className="login-bg">
      <div className="login-container">
        <form onSubmit={onSubmit} className="srv-card login-card">
          <header className="login-header">
            <span className="logo-panel">
              <img src={logo} className="brand-logo" alt="Kazaró" />
            </span>
            <h1 className="login-title">Ingresar</h1>
          </header>

          <label>Usuario</label>
          <input
            className="input"
            value={username}
            onChange={(e) => setU(e.target.value)}
            autoFocus
          />

          <label>Contraseña</label>
          <div className="input-with-btn">
            <input
              type={show ? "text" : "password"}
              className="input"
              value={password}
              onChange={(e) => setP(e.target.value)}
            />
            <button
              type="button"
              className="link-btn"
              onClick={() => setShow((s) => !s)}
              aria-pressed={show}
            >
              {show ? "Ocultar" : "Mostrar"}
            </button>
          </div>

          {err && <div className="state error">{err}</div>}

          <button className="btn" type="submit">
            Entrar
          </button>
        </form>
      </div>

      {/* Badges ISO abajo-izquierda */}
      <img
        src={isoBadges}
        className="iso-badges"
        alt="Certificaciones ISO y Empresa B"
      />
    </div>
  );
}
