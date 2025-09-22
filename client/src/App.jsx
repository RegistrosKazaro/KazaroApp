// client/src/App.jsx
import { Routes, Route, Navigate, Link, Outlet, useParams } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import { useCart } from "./hooks/useCart";

import Login from "./pages/Login";
import RoleSelect from "./pages/RoleSelect";
import Products from "./pages/Products";
import Cart from "./pages/Cart";
import Services from "./pages/Services"; // << usamos Services
import "./styles/app.css";

function Guarded() {
  const { user, loading } = useAuth();
  if (loading) return <div className="state">Cargando…</div>;
  if (!user)   return <Navigate to="/login" replace />;
  return <Outlet />;
}

function Layout() {
  const { user, logout } = useAuth();
  const { items } = useCart();
  const { role } = useParams();
  const rolesText = (user?.roles || []).join(", ");
  const cartQty = (items || []).reduce((s, it) => s + Number(it?.qty || 0), 0);

  return (
    <>
      <header className="appbar">
        <Link to={`/app/${role || "administrativo"}/products`} className="brand">Kazaro</Link>
        <nav className="appbar-right">
          <Link className="pill" to={`/app/${role || "administrativo"}/cart`}>
            Carrito {cartQty ? `(${cartQty})` : ""}
          </Link>
          <span className="user">{user?.username} ({rolesText})</span>
          <button className="pill" onClick={logout}>Salir</button>
        </nav>
      </header>
      <main className="appmain"><Outlet /></main>
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />

      {/* Todo lo que requiere sesión va dentro de Guarded */}
      <Route element={<Guarded />}>
        <Route path="/role-select" element={<RoleSelect />} />

        <Route path="/app/:role" element={<Layout />}>
          <Route path="services" element={<Services />} />
          <Route path="products" element={<Products />} />
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
