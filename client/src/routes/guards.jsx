// client/src/routes/guards.jsx
import React from "react"
import { Navigate, Outlet, useLocation } from "react-router-dom"
import { useAuth } from "../hooks/useAuth.jsx"

export function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <div className="p-8 text-center">Cargando sesión…</div>
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  return <Outlet />
}

export function RequireRole({ role }) {
  const { user } = useAuth()
  const roles = (user?.roles || []).map((r) => String(r).toLowerCase())

  if (!roles.includes(role)) {
    // fallback: primer rol disponible o "administrativo"
    const first = roles[0] || "administrativo"
    return <Navigate to={`/app/${first}/products`} replace />
  }
  return <Outlet />
}
