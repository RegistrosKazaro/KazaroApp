// El mismo remito que el PDF, como planilla de Excel (pedido del 18/11/2026).
// Usa normalizePedido para que los dos digan exactamente lo mismo.
import XLSX from "xlsx";
import { normalizePedido } from "./remitoPdf.js";

export function generateRemitoXlsxBuffer({ pedido }) {
  const { nro, empleado, rol, fecha, servicioNombre, items, total, nota, marca } = normalizePedido(pedido);
  const filas = [
    [`Remito N° ${nro}`],
    ["Empresa", marca?.razonSocial ?? ""],
    ["Fecha", fecha ?? ""],
    ["Solicitante", empleado ?? ""],
    ["Rol", rol ?? ""],
    ["Servicio", servicioNombre ?? ""],
    [],
    ["Código", "Insumo", "Cantidad", "Precio", "Subtotal"],
    ...items.map((it) => [String(it.code ?? ""), it.name, Number(it.qty), Number(it.price ?? 0), Number(it.subtotal ?? 0)]),
    ["", "", "", "Total", Number(total)],
  ];
  if (nota) filas.push([], ["Nota", nota]);

  const hoja = XLSX.utils.aoa_to_sheet(filas);
  hoja["!cols"] = [{ wch: 12 }, { wch: 50 }, { wch: 10 }, { wch: 14 }, { wch: 16 }];
  // Precio, subtotal y total con formato de moneda; siguen siendo números para sumar.
  const desde = 8, hasta = desde + items.length;
  for (let r = desde; r <= hasta; r += 1) {
    for (const c of r === hasta ? [4] : [3, 4]) {
      const celda = hoja[XLSX.utils.encode_cell({ r, c })];
      if (celda) celda.z = "$ #,##0.00";
    }
  }
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Remito");
  return {
    filename: `remito_${nro}.xlsx`,
    buffer: XLSX.write(libro, { type: "buffer", bookType: "xlsx" }),
  };
}
