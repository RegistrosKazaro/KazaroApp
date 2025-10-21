import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { getEmployeeDisplayName, getServiceNameById, db } from "../db.js";

/* ================= Helpers ================= */
const pad7 = (n) => String(n ?? "").padStart(7, "0");
const money = (n) => {
  const v = Number(n || 0);
  try { return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(v); }
  catch { return `$ ${v.toFixed(2)}`; }
};
const parseDbDate = (s) => {
  if (!s) return null;
  const d = new Date((String(s).replace(" ", "T")) + "Z"); // interpretar como UTC
  return isNaN(d.getTime()) ? new Date(s) : d;
};
const fmtDateTime = (s) => {
  const d = parseDbDate(s);
  if (!d) return "";
  return new Intl.DateTimeFormat("es-AR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  }).format(d);
};
const nowLocal = () =>
  new Intl.DateTimeFormat("es-AR", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  }).format(new Date());

function fitText(doc, text, width) {
  const ell = "…";
  let t = String(text ?? "");
  if (doc.widthOfString(t) <= width) return t;
  while (t.length && doc.widthOfString(t + ell) > width) t = t.slice(0, -1);
  return t + ell;
}

/* === Nombre de servicio robusto (DB → hinted → ID) === */
function resolveServiceName(serviceId, hintedName) {
  if (hintedName) return hintedName;

  if (serviceId != null) {
    const byDb = getServiceNameById(serviceId);
    if (byDb) return byDb;
  }

  try {
    const info = db.prepare(`PRAGMA table_info('Servicios')`).all();
    if (info.length) {
      const pick = (cands) =>
        cands.find(n => info.some(c => String(c.name).toLowerCase() === n.toLowerCase()));
      const idCol = (info.find(c => c.pk === 1)?.name) ||
        pick(["ServiciosID","ServicioID","IdServicio","service_id","servicio_id","ID","id"]);
      const nameCol = pick(["ServicioNombre","Nombre","Descripcion","Detalle","NombreServicio","Servicio"]) || idCol;
      if (idCol && nameCol && serviceId != null) {
        const r = db.prepare(
          `SELECT ${nameCol} AS n FROM Servicios WHERE CAST(${idCol} AS TEXT)=CAST(? AS TEXT) LIMIT 1`
        ).get(serviceId);
        if (r?.n) return String(r.n);
      }
    }
  } catch {}

  return serviceId != null ? String(serviceId) : "—";
}

/* ================= Secciones de layout ================= */
function drawHeader(doc, nro, fecha, total) {
  const m = 36;
  doc.moveTo(m, m).lineTo(doc.page.width - m, m).strokeColor("#D9D9D9").lineWidth(1).stroke();

  doc.font("Helvetica-Bold").fontSize(20).fill("#111").text("KAZARO", m, m + 8);

  const boxW = 240, x = doc.page.width - m - boxW;
  doc.font("Helvetica-Bold").fontSize(14).text("REMITO", x, m + 6, { width: boxW, align: "right" });
  doc.font("Helvetica").fontSize(12).fill("#222").text(`#${nro}`, x, m + 24, { width: boxW, align: "right" });
  doc.font("Helvetica").fontSize(9).fill("#555").text(fecha || "", x, m + 40, { width: boxW, align: "right" });

  doc.font("Helvetica-Bold").fontSize(10).fill("#111").text("TOTAL", x, m + 58, { width: boxW - 110, align: "right" });
  doc.font("Helvetica-Bold").fontSize(18).fill("#000").text(money(total), x + boxW - 110, m + 52, { width: 110, align: "right" });

  const y = m + 78;
  doc.moveTo(m, y).lineTo(doc.page.width - m, y).strokeColor("#E6E6E6").lineWidth(1).stroke();
  return y + 12;
}

function drawMeta(doc, y, { empleado, rol, fecha, servicio }) {
  const m = 36;
  const colW = 260, gap = 20;
  const leftX = m, rightX = m + colW + gap;

  const line = (label, value, x, y0) => {
    doc.font("Helvetica").fontSize(9).fill("#666").text(label, x, y0);
    return doc.font("Helvetica").fontSize(11).fill("#111").text(String(value || "—"), x, y0 + 12, { width: colW }).y + 6;
  };

  const yStart = y;
  let yl = yStart;
  yl = line("Empleado", empleado, leftX, yl);
  yl = line("Rol", rol || "—", leftX, yl);

  let yr = yStart;
  yr = line("Fecha", fecha || "—", rightX, yr);
  yr = line("Servicio", servicio || "—", rightX, yr);

  const yOut = Math.max(yl, yr) + 4;
  doc.moveTo(m, yOut).lineTo(doc.page.width - m, yOut).strokeColor("#EDEDED").lineWidth(1).stroke();
  return yOut + 10;
}

function drawItemsTable(doc, y, rows, total) {
  const m = 36;
  const widths = [78, 270, 55, 60, 60]; // 523 total
  const aligns = ["left", "left", "right", "right", "right"];
  const headerH = 22, rowH = 20;

  doc.save().rect(m, y - 2, 523, headerH).fill("#F5F6F7").restore();
  const labels = ["Código", "Descripción", "Cant.", "Precio", "Subtotal"];
  let x = m;
  doc.font("Helvetica-Bold").fontSize(10).fill("#111");
  for (let i = 0; i < labels.length; i++) {
    doc.text(labels[i], x + 6, y + 3, { width: widths[i] - 12, align: aligns[i] });
    x += widths[i];
  }
  y += headerH;

  const bottomReserve = 120;
  const maxY = doc.page.height - bottomReserve;
  const maxRows = Math.max(0, Math.floor((maxY - y - rowH) / rowH));
  const data = rows.slice(0, maxRows);
  const leftover = rows.length - data.length;

  for (let r = 0; r < data.length; r++) {
    if (r % 2 === 1) doc.save().rect(m, y - 1, 523, rowH).fill("#FBFBFC").restore();
    const it = data[r];
    let xx = m;
    const cols = [
      String(it.code || "—"),
      String(it.name || ""),
      String(it.qty ?? 0),
      money(it.price),
      money(it.subtotal ?? ((+it.price || 0) * (+it.qty || 0))),
    ];
    doc.font("Helvetica").fontSize(10).fill("#111");
    for (let i = 0; i < cols.length; i++) {
      const w = widths[i] - 12;
      const txt = i === 1 ? fitText(doc, cols[i], w) : cols[i];
      doc.text(txt, xx + 6, y + 3, { width: w, align: aligns[i], lineBreak: false });
      xx += widths[i];
    }
    doc.moveTo(m, y + rowH - 2).lineTo(m + 523, y + rowH - 2).strokeColor("#EEEEEE").lineWidth(0.5).stroke();
    y += rowH;
  }

  if (leftover > 0) {
    doc.font("Helvetica").fontSize(9).fill("#666").text(`(${leftover} ítems no mostrados)`, m, y + 2);
    y += 16;
  }

  doc.save().rect(m, y + 2, 523, rowH).fill("#F1F2F4").restore();
  doc.font("Helvetica-Bold").fontSize(10).fill("#111")
     .text("TOTAL", m + widths[0] + widths[1] + 6, y + 6, { width: widths[2] + widths[3] - 12, align: "right" });
  doc.font("Helvetica-Bold").fontSize(12).fill("#000")
     .text(money(total), m + widths[0] + widths[1] + widths[2] + 6, y + 5, { width: widths[3] + widths[4] - 12, align: "right" });

  return y + rowH + 6;
}

function drawNote(doc, y, nota) {
  if (!nota) return y;
  const m = 36;
  doc.font("Helvetica-Bold").fontSize(10).fill("#111").text("Nota", m, y);
  doc.font("Helvetica").fontSize(10).fill("#333").text(String(nota || ""), m, y + 12, { width: 523 });
  return y + 36;
}

function drawFooter(doc) {
  const m = 36, y = doc.page.height - m + 6;
  doc.font("Helvetica").fontSize(9).fill("#777")
     .text(`Generado por Kazaro ${nowLocal()}`, m, y, { width: 523, align: "left" });
}

/* ================= Generador principal ================= */
export async function generateRemitoPDF({ pedido, outDir = path.resolve(process.cwd(), "tmp") }) {
  const cab = pedido?.cab ? pedido.cab : pedido;
  const itemsRaw = pedido?.items || [];
  const pedidoId = cab?.PedidoID ?? cab?.id ?? 0;
  const nro = pad7(pedidoId);

  const empleado = getEmployeeDisplayName(cab?.EmpleadoID);

  // Nombre de servicio priorizando el hint pasado desde la ruta
  const servicioNombre = resolveServiceName(
    cab?.ServicioID ?? pedido?.servicio?.id ?? null,
    pedido?.servicio?.name || cab?.servicio?.name
  );

  const fecha = fmtDateTime(cab?.Fecha);

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

  let y = drawHeader(doc, nro, fecha, total);
  y = drawMeta(doc, y, { empleado, rol: cab?.Rol, fecha, servicio: servicioNombre });
  y = drawItemsTable(doc, y, items, total);
  y = drawNote(doc, y + 4, cab?.Nota);
  drawFooter(doc);

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  return outPath;
}
