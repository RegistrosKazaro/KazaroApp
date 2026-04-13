// client/src/App.jsx  ← REEMPLAZA el archivo actual
import {
  Routes, Route, Navigate, NavLink, Link,
  Outlet, useLocation, useParams, useNavigate,
} from "react-router-dom";
import { useAuth }    from "./hooks/useAuth";
import { useCart }    from "./hooks/useCart";
import { useEmpresa } from "./hooks/useEmpresa";

import CompanySelect  from "./pages/CompanySelect";
import Login          from "./pages/Login";
import RoleSelect     from "./pages/RoleSelect";
import Products       from "./pages/Products";
import Cart           from "./pages/Cart";
import Services       from "./pages/Services";
import AdminPanel     from "./pages/AdminPanel";
import Reports        from "./pages/Reports";
import Deposito       from "./pages/Deposito";
import ServiceBudgets from "./pages/ServiceBudgets";
import "./styles/app.css";

function Guarded() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="state">Cargando…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

function AdminOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="state">Cargando…</div>;
  const isAdmin = (user?.roles || [])
    .map((r) => String(r).toLowerCase())
    .includes("admin");
  return isAdmin ? children : <Navigate to="/roles" replace />;
}

function RoleIndexRedirect() {
  const { role } = useParams();
  let target = "admin";
  if (role === "administrativo") target = "products";
  else if (role === "supervisor") target = "services";
  else if (role === "deposito")   target = "deposito";
  return <Navigate to={target} replace />;
}

function Layout() {
  const { role }    = useParams();
  const base        = `/app/${role}`;
  const auth        = useAuth();
  const navigate    = useNavigate();
  const { count }   = useCart();
  const { empresa } = useEmpresa();

  const roles = (auth?.user?.roles || []).map((r) => String(r).toLowerCase());
  const isAdmin        = roles.includes("admin");
  const hasDeposito    = roles.includes("deposito");
  const isDepositoSolo = hasDeposito && roles.length === 1;

  const userLabel =
    auth?.user?.username ||
    [auth?.user?.nombre, auth?.user?.apellido].filter(Boolean).join(" ") ||
    "Usuario";

  // Nombre de empresa: del contexto (seteado en CompanySelect) o del objeto user
  const empresaNombre =
    empresa?.nombre ||
    auth?.user?.empresaNombre ||
    (auth?.user?.empresaSlug
      ? auth.user.empresaSlug.charAt(0).toUpperCase() + auth.user.empresaSlug.slice(1)
      : "Kazaro");

  const handleLogout = async () => {
    try { await Promise.resolve(auth?.logout?.()); }
    finally { navigate("/", { replace: true }); }
  };

  const navClass = ({ isActive }) => `pill${isActive ? " active" : ""}`;

  return (
    <div className="app">
      <nav className="appbar" role="navigation" aria-label="Navegación principal">
        {/* Brand muestra el nombre de la empresa activa */}
        <Link to={isAdmin ? `${base}/admin` : `${base}/cart`} className="brand">
          {empresaNombre}
        </Link>

        <div className="appbar-right">
          {isAdmin ? (
            <>
              <NavLink to={`${base}/admin`}         className={navClass}>Admin</NavLink>
              <NavLink to={`${base}/admin/budgets`} className={navClass}>Presupuestos</NavLink>
              <NavLink to={`${base}/reports`}       className={navClass}>Informes</NavLink>
              <NavLink to={`${base}/cart`}          className={navClass}>
                Carrito <span className="count">{count}</span>
              </NavLink>
              <button type="button" className="pill danger" onClick={handleLogout}>Salir</button>
            </>
          ) : (
            <>
              <span className="user">{userLabel}</span>
              {isDepositoSolo && (
                <NavLink to={`${base}/deposito`} className={navClass}>Depósito</NavLink>
              )}
              <NavLink to={`${base}/cart`} className={navClass}>
                Carrito <span className="count">{count}</span>
              </NavLink>
              <button type="button" className="pill danger" onClick={handleLogout}>Salir</button>
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
      {/* PASO 1: Selector de empresa */}
      <Route path="/"      element={<CompanySelect />} />

      {/* PASO 2: Login (empresa ya elegida) */}
      <Route path="/login" element={<Login />} />

      <Route path="/roles"       element={<RoleSelect />} />
      <Route path="/role-select" element={<Navigate to="/roles" replace />} />
      <Route path="/app"         element={<Navigate to="/roles" replace />} />

      <Route path="/app/:role" element={<Guarded />}>
        <Route element={<Layout />}>
          <Route path="admin"         element={<AdminOnly><AdminPanel /></AdminOnly>} />
          <Route path="admin/budgets" element={<AdminOnly><ServiceBudgets /></AdminOnly>} />
          <Route path="reports"       element={<AdminOnly><Reports /></AdminOnly>} />
          <Route path="products"      element={<Products />} />
          <Route path="services"      element={<Services />} />
          <Route path="deposito"      element={<Deposito />} />
          <Route path="cart"          element={<Cart />} />
          <Route index               element={<RoleIndexRedirect />} />
          <Route path="*"            element={<RoleIndexRedirect />} />
        </Route>
      </Route>

      <Route
        path="*"
        element={<div className="state error" style={{ padding: 20 }}>Ruta no encontrada</div>}
      />
    </Routes>
  );
}