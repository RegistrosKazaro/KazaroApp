// client/src/components/Navbar.jsx
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import "../styles/nav.css";

export default function Navbar() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();

  const onLoginPage = pathname === "/login";
  const isSupervisor = (user?.roles || []).some(r => String(r).toLowerCase() === "supervisor");

  async function handleLogout() {
    try {
      await logout();
    } finally {
      nav("/login");
      // Antes: catch {} → daba "Empty block statement"
      try {
        window.dispatchEvent(new Event("app:logout"));
      } catch (err) {
        // Evita el warning de bloque vacío y de var sin usar
        void err; // noop
      }
    }
  }

  return (
    <header className="appbar">
      <Link to="/" className="brand">
        <strong>Kazaro</strong>
      </Link>

      <nav className="right">
        {isSupervisor && (
          <Link to="/app/supervisor/services" className="ghost">
            Mis servicios
          </Link>
        )}

        {user ? (
          <>
            <Link to="/app/administrativo/cart" className="ghost">
              Carrito
            </Link>
            <span className="user">
              {user.username}
              {user.roles?.length ? ` (${user.roles.join(", ")})` : ""}
            </span>
            <button className="btn-out" onClick={handleLogout}>Salir</button>
          </>
        ) : (
          !onLoginPage && <Link to="/login" className="ghost">Login</Link>
        )}
      </nav>
    </header>
  );
}
