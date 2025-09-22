import { useAuth } from "../hooks/useAuth";

export default function Home() {
  const { user } = useAuth();
  return (
    <div style={{ padding: 16 }}>
      <h2>Bienvenido</h2>
      <p>Usuario: <b>{user?.username}</b></p>
      <p>Roles: <b>{user?.roles?.join(", ") || "-"}</b></p>
      <p>Probá el login, y en el próximo paso listamos Servicios y Productos.</p>
    </div>
  );
}
