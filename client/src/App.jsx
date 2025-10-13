// client/src/App.jsx
import {
  Routes,
  Route,
  Navigate,
  NavLink,
  Link,
  Outlet,
  useLocation,
  useParams,
  useNavigate,
} from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import { useCart } from "./hooks/useCart";

import Login from "./pages/Login";
import RoleSelect from "./pages/RoleSelect";
import Products from "./pages/Products";
import Cart from "./pages/Cart";
import Services from "./pages/Services";
import AdminPanel from "./pages/AdminPanel";
import Reports from "./pages/Reports";
import ServiceBudgets from "./pages/ServiceBudgets"; // página nueva (presupuestos en ruta propia)
import "./styles/app.css";

/** Protege todo lo que cuelga de /app/:role */
function Guarded() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="state">Cargando…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

/** Layout con navbar, preservando el role en los links */
function Layout() {
  const { count } = useCart();
  const { role } = useParams(); // administrativo / supervisor / etc
  const base = `/app/${role}`;

  const auth = useAuth();
  const navigate = useNavigate();

  // compatibilidad con distintos nombres del método de logout
  const doLogout = auth?.logout || auth?.signOut || auth?.logOut;

  const handleLogout = async () => {
    try {
      await Promise.resolve(doLogout?.());
    } finally {
      navigate("/login", { replace: true });
    }
  };

  const navClass = ({ isActive }) => `pill${isActive ? " active" : ""}`;
  const userLabel =
    auth?.user?.username ||
    [auth?.user?.nombre, auth?.user?.apellido].filter(Boolean).join(" ") ||
    "Usuario";

  return (
    <div className="app">
      <nav className="appbar" role="navigation" aria-label="Navegación principal">
        <Link to={`${base}/products`} className="brand">
          Kazaro
        </Link>

        <div className="appbar-right">
          <NavLink to={`${base}/products`} className={navClass}>
            Productos
          </NavLink>
          <NavLink to={`${base}/services`} className={navClass}>
            Servicios
          </NavLink>
          <NavLink to={`${base}/admin`} className={navClass}>
            Admin
          </NavLink>
          <NavLink to={`${base}/admin/budgets`} className={navClass}>
            Presupuestos
          </NavLink>
          <NavLink to={`${base}/cart`} className={navClass}>
            Carrito <span className="count">{count}</span>
          </NavLink>

          <span className="user">{userLabel}</span>
          <Link to="/roles" className="pill ghost" aria-label="Cambiar rol o usuario">
            Cambiar rol
          </Link>
          <button
            type="button"
            className="pill danger"
            onClick={handleLogout}
            aria-label="Cerrar sesión"
          >
            Salir
          </button>
        </div>
      </nav>

      <main className="appmain">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      {/* Login accesible por ambas rutas */}
      <Route path="/" element={<Login />} />
      <Route path="/login" element={<Login />} />
      <Route path="/roles" element={<RoleSelect />} />

      {/* TODAS las rutas de app con :role */}
      <Route path="/app/:role" element={<Guarded />}>
        <Route element={<Layout />}>
          <Route path="products" element={<Products />} />
          <Route path="services" element={<Services />} />
          <Route path="admin" element={<AdminPanel />} />
          <Route path="admin/budgets" element={<ServiceBudgets />} />
          <Route path="reports" element={<Reports />} />
          <Route path="cart" element={<Cart />} />
          <Route index element={<Navigate to="products" replace />} />
        </Route>
      </Route>

      <Route
        path="*"
        element={<div className="state error" style={{ padding: 20 }}>Ruta no encontrada</div>}
      />
    </Routes>
  );
}
