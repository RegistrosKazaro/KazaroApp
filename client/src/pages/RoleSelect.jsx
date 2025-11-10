import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import "../styles/role-select.css";

export default function RoleSelect() {
  const { user, loading } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    if (loading) return;

    // Si no hay usuario logueado, mandamos a login
    if (!user) {
      nav("/login", { replace: true });
      return;
    }

    const roles = (user.roles || []).map((r) => String(r).toLowerCase());

    // Si solo tiene 1 rol, lo mandamos directo sin mostrar la pantalla
    if (roles.length === 1) {
      const r = roles[0];

      if (r.includes("super")) {
        // Supervisor
        nav("/app/supervisor/services", { replace: true });
      } else if (r.includes("deposito")) {
        // Depósito
        nav("/app/deposito", { replace: true });
      } else {
        // Cualquier otro (administrativo, etc.)
        nav("/app/administrativo/products", { replace: true });
      }
    }
  }, [user, loading, nav]);

  if (loading) return <div className="state">Cargando…</div>;
  if (!user) return null;

  return (
    <div
      className="catalog role-select"
      style={{ maxWidth: 640, marginInline: "auto" }}
    >
      <h2>Elegí cómo querés entrar</h2>

      <div className="services-grid">
        <button
          type="button"
          className="service-card"
          onClick={() => nav("/app/administrativo/products")}
        >
          <div>Administrativo</div>
          <small>Ir al catálogo</small>
        </button>

        <button
          type="button"
          className="service-card"
          onClick={() => nav("/app/supervisor/services")}
        >
          <div>Supervisor</div>
          <small>Seleccionar servicio</small>
        </button>

        <button
          type="button"
          className="service-card"
          onClick={() => nav("/app/deposito")}
        >
          <div>Depósito</div>
          <small>Ver panel de depósito</small>
        </button>
      </div>
    </div>
  );
}
