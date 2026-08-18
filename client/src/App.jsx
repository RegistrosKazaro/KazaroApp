// client/src/App.jsx
import { lazy, Suspense, useState, useRef, useEffect } from "react";
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
const AdminPanel = lazy(() => import("./pages/AdminPanel"));
const Reports = lazy(() => import("./pages/Reports"));
const Deposito = lazy(() => import("./pages/Deposito"));
const MisPedidos = lazy(() => import("./pages/MisPedidos"));
const ServiceBudgets = lazy(() => import("./pages/ServiceBudgets"));
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import "./styles/app.css";
import NotificationBell from "./components/NotificationBell";
import logoKazaro from "./assets/LogoHorizWhite.png";
import logoPazar from "./assets/LogoPazar.png";

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
  const location    = useLocation();
  const { count }   = useCart();
  const { empresa } = useEmpresa();

  // Menú móvil (hamburguesa). En desktop el CSS lo ignora y muestra todo.
  const [menuOpen, setMenuOpen] = useState(false);
  const navRef = useRef(null);
  // Cerrar al navegar a otra ruta.
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  // Cerrar con Escape o al tocar fuera de la barra.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    const onClickOut = (e) => { if (navRef.current && !navRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClickOut);
    document.addEventListener("touchstart", onClickOut);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClickOut);
      document.removeEventListener("touchstart", onClickOut);
    };
  }, [menuOpen]);

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

  // Marca de la barra. El logo de Kazaro es blanco (va directo sobre la barra
  // oscura); el de Pazar es verde sobre claro, así que va dentro de una pastilla
  // blanca para que se lea sobre el verde.
  const empresaSlug = String(empresa?.slug || auth?.user?.empresaSlug || "kazaro").toLowerCase();
  const esPazar = empresaSlug === "pazar";

  const handleLogout = async () => {
    try { await Promise.resolve(auth?.logout?.()); }
    finally { navigate("/", { replace: true }); }
  };

  const navClass = ({ isActive }) => `pill${isActive ? " active" : ""}`;

  return (
    <div className="app">
      <a href="#main-content" className="skip-link">Saltar al contenido</a>
      <nav className="appbar" role="navigation" aria-label="Navegación principal" ref={navRef}>
        {/* Brand muestra el nombre de la empresa activa */}
        <Link
          to={isAdmin ? `${base}/admin` : `${base}/cart`}
          className={`brand${esPazar ? " brand--pazar" : ""}`}
          aria-label={`${empresaNombre} — ir al inicio`}
        >
          {esPazar ? (
            <>
              <span className="brand-mark">
                <img src={logoPazar} alt="" aria-hidden="true" />
              </span>
              <span className="brand-name">{empresaNombre}</span>
            </>
          ) : (
            <img src={logoKazaro} alt={empresaNombre} className="brand-logo-appbar" />
          )}
        </Link>

        {/* Botón de menú: sólo visible en mobile (lo controla el CSS) */}
        <button
          type="button"
          className="nav-toggle"
          aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={menuOpen}
          aria-controls="appbar-menu"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span className="nav-toggle-icon" aria-hidden="true">{menuOpen ? "✕" : "☰"}</span>
        </button>

        <div
          id="appbar-menu"
          className={`appbar-right${menuOpen ? " is-open" : ""}`}
        >
          {isAdmin ? (
            /* El admin navega desde el lateral del panel: acá quedan sólo Admin y Salir.
               Carrito y notificaciones siguen en la barra del resto de los roles. */
            <>
              <NavLink to={`${base}/admin`} className={navClass}>Admin</NavLink>
              <button type="button" className="pill danger" onClick={handleLogout}>Salir</button>
            </>
          ) : (
            <>
              <span className="user">{userLabel}</span>
              {isDepositoSolo && (
                <NavLink to={`${base}/deposito`} className={navClass}>Depósito</NavLink>
              )}

              {roles.includes("supervisor") && (
                <NavLink to={`${base}/mis-pedidos`} className={navClass}>
                  Mis pedidos
                </NavLink>
              )}

              <NavLink to={`${base}/cart`} className={navClass}>
                Carrito <span className="count">{count}</span>
              </NavLink>
              <NotificationBell />
              <button type="button" className="pill danger" onClick={handleLogout}>Salir</button>
            </>
          )}
        </div>
      </nav>

      <main className="appmain" id="main-content" tabIndex={-1}>
        <Suspense fallback={<div className="state">Cargando…</div>}>
          <Outlet />
        </Suspense>
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
      {/* Recuperar contraseña */}
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password"  element={<ResetPassword />} />

      <Route path="/roles"       element={<RoleSelect />} />
      <Route path="/role-select" element={<Navigate to="/roles" replace />} />
      <Route path="/app"         element={<Navigate to="/roles" replace />} />

      <Route path="/app/:role" element={<Guarded />}>
        <Route element={<Layout />}>
          <Route path="admin"         element={<AdminOnly><Suspense fallback={<div className="state">Cargando…</div>}><AdminPanel /></Suspense></AdminOnly>} />
          <Route path="admin/budgets" element={<AdminOnly><ServiceBudgets /></AdminOnly>} />
          <Route path="reports"       element={<AdminOnly><Suspense fallback={<div className="state">Cargando…</div>}><Reports /></Suspense></AdminOnly>} />
          <Route path="products"      element={<Products />} />
          <Route path="services"      element={<Services />} />
          <Route path="deposito"      element={<Deposito />} />
          <Route path="cart"          element={<Cart />} />
          <Route path="mis-pedidos"   element={<MisPedidos />} />
          <Route index                element={<RoleIndexRedirect />} />
          <Route path="*"             element={<RoleIndexRedirect />} />
        </Route>
      </Route>

      <Route
        path="*"
        element={<div className="state error" style={{ padding: 20 }}>Ruta no encontrada</div>}
      />
    </Routes>
  );
}