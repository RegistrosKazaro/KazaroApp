// client/src/context/EmpresaThemeSync.jsx
// La empresa elegida se guarda en sessionStorage, que es POR PESTAÑA. Si un
// usuario de Pazar abría la app en otra pestaña (o la PWA se reabría), no había
// empresa guardada y el tema caía al azul de Kazaro aunque la sesión fuera de
// Pazar. Este componente la rehidrata desde el usuario logueado, que ya trae
// empresaId/empresaSlug/empresaNombre en /me.
import { useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import { useEmpresa } from "../hooks/useEmpresa";

export default function EmpresaThemeSync() {
  const { user } = useAuth();
  const { empresa, setEmpresa } = useEmpresa();

  useEffect(() => {
    const slugUsuario = user?.empresaSlug;
    if (!slugUsuario) return;
    // Sólo actúa si falta la empresa o quedó una distinta a la de la sesión.
    if (empresa?.slug === slugUsuario) return;
    setEmpresa({
      id: user.empresaId ?? null,
      slug: slugUsuario,
      nombre: user.empresaNombre ?? slugUsuario,
    });
  }, [user, empresa, setEmpresa]);

  return null;
}
