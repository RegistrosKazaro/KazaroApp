import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export default function ProtectedRoute({ children }) {
  const { user } = useAuth(); // si tu AuthContext expone loading, podés usarlo acá
  const loc = useLocation();

  // Si no hay usuario, mandamos a login
  if (!user) {
    return <Navigate to="/login" replace state={{ from: loc }} />;
  }
  return children;
}
