import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { getEmployeeDisplayName, getServiceNameById } from "../db.js";

/* ===== Helpers ===== */
const pad7 = (n) => String(n ?? "").padStart(7, "0");
const money = (n) => {
  const v = Number(n || 0);
  try { return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(v); }
  catch { return `$ ${v.toFixed(2)}`; }
};
const parseSQLToLocal = (s) => {
  if (!s) return "";
  try {
    const d = new Date(s.replace(" ", "T") + "Z"); // tratar como UTC -> local
    return d.toLocaleString("es-AR", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
  } catch { return String(s); }
};
const nowLocal = () =>
  new Date().toLocaleString("es-AR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  });

function fitText(doc, text, width) {
  const ell = "…";
  let t = String(text ?? "");
  if (doc.widthOfString(t) <= width) return t;
  while (t.length && doc.widthOfString(t + ell) > width) t = t.slice(0, -1);
  return t + ell;
}

/* ===== Layout ===== */
function header(doc, nro, fecha, total) {
  const m = 36;
  doc.moveTo(m, m).lineTo(doc.page.width - m, m).strokeColor("#DADCE0").lineWidth(1).stroke();

  // Marca
  doc.font("Helvetica-Bold").fontSize(24).fill("#1F1F1F").text("KAZARO", m, m + 6);

  // Caja derecha
  const boxW = 240, x = doc.page.width - m - boxW;
  doc.font("Helvetica-Bold").fontSize(16).fill("#1F1F1F").text("REMITO", x, m + 4, { width: boxW, align: "right" });
  doc.font("Helvetica").fontSize(12).fill("#333").text(`#${nro}`, x, m + 24, { width: boxW, align: "right" });
  doc.font("Helvetica").fontSize(10).fill("#666").text(fecha || "", x, m + 40, { width: boxW, align: "right" });

  // Línea de separación
  const y = m + 66;
  doc.moveTo(m, y).lineTo(doc.page.width - m, y).strokeColor("#ECEFF1").lineWidth(1).stroke();
  return y + 10;
}

function meta(doc, y, { empleado, rol, fecha, servicio }) {
  const m = 36;
  const colW = 260, gap = 24; // dos columnas
  const xL = m, xR = m + colW + gap;

  const row = (label, value, x, y0) => {
    doc.font("Helvetica").fontSize(9).fill("#666").text(label, x, y0);
    return doc.font("Helvetica").fontSize(12).fill("#111").text(String(value || "—"), x, y0 + 12, { width: colW }).y + 4;
  };

  let yl = y;
  yl = row("Empleado", empleado, xL, yl);
  yl = row("Rol", rol || "—", xL, yl);

  let yr = y;
  yr = row("Fecha", fecha || "—", xR, yr);
  yr = row("Servicio", servicio || "—", xR, yr);

  const yOut = Math.max(yl, yr) + 6;
  doc.moveTo(m, yOut).lineTo(doc.page.width - m, yOut).strokeColor("#F0F0F0").lineWidth(1).stroke();
  return yOut + 12;
}

function itemsTable(doc, y, rows, total) {
  const m = 36;
  const widths = [90, 305, 56, 70, 70]; // total ~ 591 usable -> 36*2 margins => 523 aprox visible; reducimos
  // Ajustamos a 523 exactos:
  const W = [90, 270, 55, 60, 48]; // 523
  const aligns = ["left", "left", "right", "right", "right"];
  const headerH = 22, rowH = 20;

  // Encabezado
  doc.save().rect(m, y - 2, 523, headerH).fill("#F7F8F9").restore();
  const labels = ["Código", "Descripción", "Cant.", "Precio", "Subtotal"];
  let x = m;
  doc.font("Helvetica-Bold").fontSize(10).fill("#111");
  for (let i = 0; i < labels.length; i++) {
    doc.text(labels[i], x + 6, y + 3, { width: W[i] - 12, align: aligns[i] });
    x += W[i];
  }
  y += headerH;

  // Capacidad a 1 hoja
  const bottomReserve = 120;
  const maxY = doc.page.height - bottomReserve;
  const maxRows = Math.max(0, Math.floor((maxY - y - rowH) / rowH));

  const data = rows.slice(0, maxRows);
  const leftover = rows.length - data.length;

  for (let r = 0; r < data.length; r++) {
    if (r % 2 === 1) doc.save().rect(m, y - 1, 523, rowH).fill("#FBFBFC").restore();
    const it = data[r];
    const cols = [
      String(it.code || "—"),
      String(it.name || ""),
      String(it.qty ?? 0),
      money(it.price),
      money(it.subtotal ?? ((+it.price || 0) * (+it.qty || 0))),
    ];
    let xx = m;
    doc.font("Helvetica").fontSize(10).fill("#111");
    for (let i = 0; i < cols.length; i++) {
      const w = W[i] - 12;
      const txt = i === 1 ? fitText(doc, cols[i], w) : cols[i];
      doc.text(txt, xx + 6, y + 3, { width: w, align: aligns[i], lineBreak: false });
      xx += W[i];
    }
    doc.moveTo(m, y + rowH - 2).lineTo(m + 523, y + rowH - 2).strokeColor("#EEEEEE").lineWidth(0.5).stroke();
    y += rowH;
  }

  if (leftover > 0) {
    doc.font("Helvetica").fontSize(9).fill("#666").text(`(${leftover} ítems no mostrados)`, m, y + 2);
    y += 16;
  }

  // Total al pie (alineado a la tabla)
  const labelW = W[0] + W[1] + W[2] + W[3];
  doc.save().rect(m, y + 2, 523, 26).fill("#F1F2F4").restore();
  doc.font("Helvetica-Bold").fontSize(11).fill("#111")
     .text("TOTAL", m + labelW - 60, y + 7, { width: 60, align: "right" });
  doc.font("Helvetica-Bold").fontSize(12).fill("#000")
     .text(money(total), m + labelW + 6, y + 6, { width: W[4] - 12, align: "right" });

  return y + 26 + 6;
}

function note(doc, y, nota) {
  if (!nota) return y;
  const m = 36;
  doc.font("Helvetica-Bold").fontSize(10).fill("#111").text("Nota", m, y);
  doc.font("Helvetica").fontSize(10).fill("#333").text(String(nota || ""), m, y + 12, { width: 523 });
  return y + 36;
}

function footer(doc) {
  const m = 36, y = doc.page.height - m + 6;
  doc.font("Helvetica").fontSize(9).fill("#777").text(`Generado por Kazaro ${nowLocal()}`, m, y, { width: 523, align: "left" });
}

/* ===== Generador ===== */
export async function generateRemitoPDF({ pedido, outDir = path.resolve(process.cwd(), "tmp") }) {
  const cab = pedido?.cab ? pedido.cab : pedido;
  const itemsRaw = pedido?.items || [];
  const pedidoId = cab?.PedidoID ?? cab?.id ?? 0;
  const nro = pad7(pedidoId);

  const empleado = getEmployeeDisplayName(cab?.EmpleadoID);
  const rol = cab?.Rol || "—";

  // NOMBRE del servicio (preferir el que venga embebido; si no, consultar helper)
  let servicioNombre =
    pedido?.servicio?.name ||
    cab?.servicio?.name ||
    (cab?.ServicioID != null ? getServiceNameById(cab.ServicioID) : null) ||
    "—";

  const fecha = parseSQLToLocal(cab?.Fecha);

  const items = itemsRaw.map((it) => ({
    code: it.codigo ?? it.code ?? "",
    name: it.nombre ?? it.name ?? "",
    qty: Number(it.cantidad ?? it.qty ?? 0),
    price: Number(it.precio ?? it.price ?? 0),
    subtotal: Number(it.subtotal ?? (Number(it.precio ?? it.price ?? 0) * Number(it.cantidad ?? it.qty ?? 0))),
  }));
  const total = Number(cab?.Total ?? items.reduce((s, r) => s + (r.subtotal || 0), 0));

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `Remito-${nro}.pdf`);

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 36, right: 36, bottom: 36, left: 36 },
    info: { Title: `Remito #${nro}`, Author: "Kazaro" },
  });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  let y = header(doc, nro, fecha, total);
  y = meta(doc, y, { empleado, rol, fecha, servicio: servicioNombre });
  y = itemsTable(doc, y, items, total);
  y = note(doc, y + 4, cab?.Nota);
  footer(doc);

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  return outPath;
}
