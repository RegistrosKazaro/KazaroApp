import { useEffect, useState } from "react";

/**
 * Debounce simple: devuelve `value` recién después de `delay` ms sin cambios.
 * Sirve para no disparar búsquedas/filtros en cada tecla.
 */
export default function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
