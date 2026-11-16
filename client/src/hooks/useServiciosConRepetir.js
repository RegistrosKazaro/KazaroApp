// Servicios que pueden "Repetir este pedido" y agregar insumos desde el carrito.
// Hoy: los de Río Cuarto (y los de Ariel que se sumen en el servidor).
// Si la consulta falla devuelve vacío: ante la duda, no se ofrece.
import { useEffect, useState } from "react";
import { api } from "../api/client";

export function useServiciosConRepetir() {
  const [ids, setIds] = useState(() => new Set());
  useEffect(() => {
    let vivo = true;
    api.get("/orders/repetir-servicios")
      .then(({ data }) => { if (vivo) setIds(new Set((Array.isArray(data) ? data : []).map(Number))); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);
  return ids;
}
