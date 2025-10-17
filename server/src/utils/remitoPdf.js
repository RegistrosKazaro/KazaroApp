import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs";

function money(v) {
  const n = Number(v || 0);
  try { return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n); }
  catch { return `$ ${n.toFixed(2)}`; }
}
function safe(s) { return String(s || "").replace(/[^a-z0-9._-]+/gi, "-"); }

export async function generateRemitoPDF({ pedido, outDir = path.resolve(process.cwd(), "tmp") }) {
  fs.mkdirSync(outDir, { recursive: true });
  const filename = `remito-pedido-${pedido.id}.pdf`;
  const full = path.join(outDir, filename);

  const doc = new PDFDocument({ size: "A4", margin: 36 });
  const stream = fs.createWriteStream(full);
  doc.pipe(stream);

  doc.fontSize(18).text("Remito / Pedido", { align: "left" });
  doc.moveDown(0.5);
  doc.fontSize(11).text(`Pedido #${pedido.id}  •  Fecha: ${pedido.Fecha || ""}`);
  if (pedido.servicio?.name) doc.text(`Servicio: ${pedido.servicio.name}`);
  if (pedido.user) doc.text(`Solicitado por: ${[pedido.user?.Nombre, pedido.user?.Apellido].filter(Boolean).join(" ") || pedido.user?.username}`);
  doc.moveDown();

  doc.fontSize(12).text("Items", { underline: true });
  doc.moveDown(0.3);
  const headers = ["Código", "Producto", "Cantidad", "Precio", "Subtotal"];
  const widths = [80, 220, 80, 80, 80];
  const x0 = doc.x, y0 = doc.y;
  headers.forEach((h, i) => doc.text(h, x0 + widths.slice(0,i).reduce((a,b)=>a+b,0), y0, { width: widths[i] }));
  doc.moveDown(0.2);

  pedido.items.forEach(it => {
    doc.text(String(it.code || "-"), { continued: true, width: widths[0] });
    doc.text(String(it.name || ""), { continued: true, width: widths[1] });
    doc.text(String(it.qty || 0), { continued: true, width: widths[2] });
    doc.text(money(it.price || 0), { continued: true, width: widths[3] });
    doc.text(money(it.subtotal || (it.price*it.qty) || 0), { width: widths[4] });
  });

  doc.moveDown(0.5);
  doc.fontSize(13).text(`Total: ${money(pedido.Total)}`, { align: "right" });

  if (pedido.Nota) {
    doc.moveDown();
    doc.fontSize(11).text("Notas:", { underline: true });
    doc.fontSize(10).text(String(pedido.Nota || ""));
  }

  doc.end();
  await new Promise((resolve) => stream.on("finish", resolve));
  return full;
}
