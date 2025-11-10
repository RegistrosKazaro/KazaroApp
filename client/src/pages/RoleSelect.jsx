// client/src/pages/RoleSelect.jsx
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

  const rolesLower = (user.roles || []).map((r) => String(r).toLowerCase());
  const hasAdministrativo = rolesLower.some((r) => r.includes("administrativo"));
  const hasSupervisor = rolesLower.some((r) => r.includes("super"));
  const hasDeposito = rolesLower.some((r) => r.includes("deposito"));
  const isDepositoSolo = hasDeposito && rolesLower.length === 1;

  return (
    <div
      className="catalog role-select"
      style={{ maxWidth: 640, marginInline: "auto" }}
    >
      <h2>Elegí cómo querés entrar</h2>

      <div className="services-grid">
        {hasAdministrativo && (
          <button
            type="button"
            className="service-card"
            onClick={() => nav("/app/administrativo/products")}
          >
            <div>Administrativo</div>
            <small>Ir al catálogo</small>
          </button>
        )}

        {hasSupervisor && (
          <button
            type="button"
            className="service-card"
            onClick={() => nav("/app/supervisor/services")}
          >
            <div>Supervisor</div>
            <small>Seleccionar servicio</small>
          </button>
        )}

        {/* Depósito: sólo si ese es su ÚNICO rol */}
        {isDepositoSolo && (
          <button
            type="button"
            className="service-card"
            onClick={() => nav("/app/deposito")}
          >
            <div>Depósito</div>
            <small>Ver panel de depósito</small>
          </button>
        )}
      </div>
    </div>
  );
}
