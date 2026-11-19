// La sección elegida al entrar ("maralim" o nada). Vive acá y no en Services.jsx:
// importarla desde esa página arrastraba services.css a la elección de rol.
export function leerSeccion() {
  try { return sessionStorage.getItem("seccion"); } catch { return null; }
}
export function guardarSeccion(seccion) {
  try { seccion ? sessionStorage.setItem("seccion", seccion) : sessionStorage.removeItem("seccion"); } catch { /* sin storage */ }
}
