// client/src/pages/Login.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import "../styles/auth.css";

export default function Login() {
  const nav = useNavigate();
  const { login } = useAuth();

  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [show, setShow]   = useState(false);
  const [err, setErr]     = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");

    try {
      // Evitamos variable “u” sin uso con destructuring
      const { roles = [] } = await login(username, password);
      const rolesLower = roles.map(r => String(r).toLowerCase());

      if (rolesLower.length > 1) {
        nav("/role-select", { replace: true });
        return;
      }

      if (rolesLower.some(r => r.includes("super"))) {
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
    <div className="catalog" style={{ maxWidth: 460, margin: "60px auto" }}>
      <h1>Ingresar</h1>

      <form onSubmit={onSubmit} className="srv-card" style={{ padding: 16, color: "black" }}>
        <label>Usuario</label>
        <input
          className="input"
          value={username}
          onChange={e => setU(e.target.value)}
          autoFocus
        />

        <label style={{ marginTop: 10 }}>Contraseña</label>
        <div className="input-with-btn">
          <input
            type={show ? "text" : "password"}
            className="input"
            value={password}
            onChange={e => setP(e.target.value)}
          />
          <button
            type="button"
            className="link-btn"
            onClick={() => setShow(s => !s)}
          >
            {show ? "Ocultar" : "Mostrar"}
          </button>
        </div>

        {err && <div className="state error" style={{ marginTop: 8 }}>{err}</div>}

        <div style={{ marginTop: 12 }}>
          <button className="btn" type="submit">Entrar</button>
        </div>
      </form>
    </div>
  );
}
