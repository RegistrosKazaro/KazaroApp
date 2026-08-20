// client/src/context/EmpresaThemeSync.jsx
// La empresa elegida se guarda en sessionStorage, que es POR PESTAÑA. Si un
// usuario de Pazar abría la app en otra pestaña (o la PWA se reabría), no había
// empresa guardada y el tema caía al azul de Kazaro aunque la sesión fuera de
// Pazar. Este componente la rehidrata desde el usuario logueado.
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useEmpresa } from "../hooks/useEmpresa";

export default function EmpresaThemeSync() {
  const { user } = useAuth();
  const { empresa, setEmpresa } = useEmpresa();
  const { pathname } = useLocation();

  // En el selector de empresa y en el login el usuario ESTÁ eligiendo: acá no se
  // toca nada. Si no, al tener sesión de una empresa y tocar la otra, se pisaba
  // la elección al instante y era imposible cambiar de empresa.
  const estaEligiendo = !pathname.startsWith("/app");

  useEffect(() => {
    const slugUsuario = user?.empresaSlug;
    if (!slugUsuario) return;
    if (estaEligiendo) return;
    if (empresa?.slug === slugUsuario) return;
    setEmpresa({
      id: user.empresaId ?? null,
      slug: slugUsuario,
      nombre: user.empresaNombre ?? slugUsuario,
    });
  }, [user, empresa, setEmpresa, estaEligiendo]);

  return null;
}
