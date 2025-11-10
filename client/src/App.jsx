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
import Deposito from "./pages/Deposito";
import ServiceBudgets from "./pages/ServiceBudgets";
import "./styles/app.css";

/** Protege todo lo que cuelga de /app/:role */
function Guarded() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="state">Cargando…</div>;
  if (!user)
    return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

/** Solo admins pueden ver las páginas de administración */
function AdminOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="state">Cargando…</div>;
  const isAdmin = (user?.roles || [])
    .map((r) => String(r).toLowerCase())
    .includes("admin");
  return isAdmin ? children : <Navigate to="/roles" replace />;
}

/** Redirección por defecto dentro de /app/:role según el rol */
function RoleIndexRedirect() {
  const { role } = useParams();
  let target = "admin";
  if (role === "administrativo") target = "products";
  else if (role === "supervisor") target = "services";
  else if (role === "deposito") target = "deposito";
  return <Navigate to={target} replace />;
}

/** Navbar condicional por rol */
function Layout() {
  const { role } = useParams();
  const base = `/app/${role}`;

  const auth = useAuth();
  const navigate = useNavigate();
  const { count } = useCart();

  const roles = (auth?.user?.roles || []).map((r) => String(r).toLowerCase());
  const isAdmin = roles.includes("admin");
  const isDeposito = roles.includes("deposito");

  const userLabel =
    auth?.user?.username ||
    [auth?.user?.nombre, auth?.user?.apellido].filter(Boolean).join(" ") ||
    "Usuario";

  const doLogout = auth?.logout || auth?.signOut || auth?.logOut;
  const handleLogout = async () => {
    try {
      await Promise.resolve(doLogout?.());
    } finally {
      navigate("/login", { replace: true });
    }
  };

  const navClass = ({ isActive }) => `pill${isActive ? " active" : ""}`;

  return (
    <div className="app">
      <nav
        className="appbar"
        role="navigation"
        aria-label="Navegación principal"
      >
        {/* Brand: admin → admin; no admin → carrito */}
        <Link
          to={isAdmin ? `${base}/admin` : `${base}/cart`}
          className="brand"
        >
          Kazaro
        </Link>

        <div className="appbar-right">
          {isAdmin ? (
            <>
              <NavLink to={`${base}/admin`} className={navClass}>
                Admin
              </NavLink>
              <NavLink to={`${base}/admin/budgets`} className={navClass}>
                Presupuestos
              </NavLink>
              <NavLink to={`${base}/reports`} className={navClass}>
                Informes
              </NavLink>
              <NavLink to={`${base}/cart`} className={navClass}>
                Carrito <span className="count">{count}</span>
              </NavLink>
              <button
                type="button"
                className="pill danger"
                onClick={handleLogout}
              >
                Salir
              </button>
            </>
          ) : (
            <>
              {/* Nombre del usuario */}
              <span className="user">{userLabel}</span>

              {/* Link al panel de Depósito si tiene ese rol */}
              {isDeposito && (
                <NavLink to={`${base}/deposito`} className={navClass}>
                  Depósito
                </NavLink>
              )}

              {/* Carrito (con contador) */}
              <NavLink to={`${base}/cart`} className={navClass}>
                Carrito <span className="count">{count}</span>
              </NavLink>

              {/* Salir */}
              <button
                type="button"
                className="pill danger"
                onClick={handleLogout}
              >
                Salir
              </button>
            </>
          )}
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

      {/* Pantalla para elegir entre Administrativo / Supervisor / Depósito */}
      <Route path="/roles" element={<RoleSelect />} />
      {/* Alias para compatibilidad con enlaces viejos del botón */}
      <Route path="/role-select" element={<Navigate to="/roles" replace />} />

      {/* Si entran a /app sin rol => mandamos a /roles */}
      <Route path="/app" element={<Navigate to="/roles" replace />} />

      {/* TODAS las rutas de app con :role */}
      <Route path="/app/:role" element={<Guarded />}>
        <Route element={<Layout />}>
          {/* Páginas de Admin (protegidas) */}
          <Route
            path="admin"
            element={
              <AdminOnly>
                <AdminPanel />
              </AdminOnly>
            }
          />
          <Route
            path="admin/budgets"
            element={
              <AdminOnly>
                <ServiceBudgets />
              </AdminOnly>
            }
          />
          <Route
            path="reports"
            element={
              <AdminOnly>
                <Reports />
              </AdminOnly>
            }
          />

          {/* Rutas de uso general */}
          <Route path="products" element={<Products />} />
          <Route path="services" element={<Services />} />
          <Route path="deposito" element={<Deposito />} />
          <Route path="cart" element={<Cart />} />

          {/* Índice por rol */}
          <Route index element={<RoleIndexRedirect />} />

          {/* Cualquier subruta inválida bajo /app/:role vuelve al índice por rol */}
          <Route path="*" element={<RoleIndexRedirect />} />
        </Route>
      </Route>

      {/* 404 global */}
      <Route
        path="*"
        element={
          <div className="state error" style={{ padding: 20 }}>
            Ruta no encontrada
          </div>
        }
      />
    </Routes>
  );
}
