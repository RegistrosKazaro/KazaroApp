import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import "../styles/role-select.css";

export default function RoleSelect() {
  const { user, loading } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) return nav("/login", { replace: true });
    const roles = (user.roles || []).map(r => String(r).toLowerCase());
    if (roles.length === 1) {
      if (roles[0].includes("super")) nav("/app/supervisor/services", { replace: true });
      else nav("/app/administrativo/products", { replace: true });
    }
  }, [user, loading, nav]);

  if (loading) return <div className="state">Cargando…</div>;
  if (!user) return null;

  return (
    <div className="catalog role-select" style={{ maxWidth: 640, marginInline: "auto" }}>
      <h2>Elegí cómo querés entrar</h2>
      <div className="services-grid">
        <button className="service-card" onClick={() => nav("/app/administrativo/products")}>
          <div>Administrativo</div>
          <small>Ir al catálogo</small>
        </button>
        <button className="service-card" onClick={() => nav("/app/supervisor/services")}>
          <div>Supervisor</div>
          <small>Seleccionar servicio</small>
        </button>
      </div>
    </div>
  );
}
