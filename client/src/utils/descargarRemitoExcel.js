// Baja el remito de un pedido como Excel: los mismos datos que el PDF.
import { api } from "../api/client";

export async function descargarRemitoExcel(id) {
  try {
    const { data } = await api.get(`/orders/xlsx/${id}`, { responseType: "blob" });
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `remito_${String(id).padStart(7, "0")}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    window.alert("No se pudo descargar el Excel del pedido. Probá de nuevo.");
  }
}
