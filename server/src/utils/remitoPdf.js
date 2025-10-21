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
const fmtDateTime = (s) => {
  if (!s) return "";
  try {
    const d = typeof s === "string" ? new Date(s.replace(" ", "T")) : new Date(s);
    return d.toLocaleString("es-AR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return String(s || ""); }
};
const nowLocal = () =>
  new Date().toLocaleString("es-AR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

function fitText(doc, text, width) {
  // recorta con "…" si no entra en una línea
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
      const pick = (cands) => cands.find((n) => info.some((c) => String(c.name).toLowerCase() === n.toLowerCase()));
      const idCol = (info.find((c) => c.pk === 1)?.name) ||
        pick(["ServiciosID","ServicioID","IdServicio","service_id","servicio_id","ID","id"]);
      const nameCol = pick(["ServicioNombre","Nombre","Descripcion","Detalle","NombreServicio","Servicio"]) || idCol;
      if (idCol && nameCol && serviceId != null) {
        const r = db.prepare(
          `SELECT ${nameCol} AS n FROM Servicios WHERE CAST(${idCol} AS TEXT)=CAST(? AS TEXT) LIMIT 1`
        ).get(serviceId);
        if (r?.n) return String(r.n);
      }
    }
  } catch {/* noop */}
  return serviceId != null ? String(serviceId) : "—";
}

/* ================= Layout ================= */
const M = 36;  // margen
function drawHeader(doc, nro, fecha, total) {
  const contentW = doc.page.width - M * 2;

  // línea superior
  doc.moveTo(M, M).lineTo(doc.page.width - M, M).strokeColor("#D9D9D9").lineWidth(1).stroke();

  // Marca
  doc.font("Helvetica-Bold").fontSize(28).fill("#111").text("KAZARO", M, M + 6);

  // Bloque derecho (ancho fijo amplio, nada se pisa)
  const RIGHT_W = 320;
  const xR = doc.page.width - M - RIGHT_W;

  doc.font("Helvetica-Bold").fontSize(20).fill("#111").text("REMITO", xR, M + 2, {
    width: RIGHT_W, align: "right", lineBreak: false,
  });
  doc.font("Helvetica").fontSize(12).fill("#222").text(`#${nro}`, xR, M + 26, {
    width: RIGHT_W, align: "right", lineBreak: false,
  });
  doc.font("Helvetica").fontSize(10).fill("#555").text(fecha || "", xR, M + 42, {
    width: RIGHT_W, align: "right", lineBreak: false,
  });

  // Caja de TOTAL (siempre dentro del bloque)
  const totalBoxH = 36;
  doc.save()
    .roundedRect(xR, M + 60, RIGHT_W, totalBoxH, 6)
    .fill("#F5F6F8")
    .restore();

  doc.font("Helvetica-Bold").fontSize(10).fill("#666")
     .text("TOTAL", xR + 10, M + 60 + 10, { width: RIGHT_W - 120, align: "left", lineBreak: false });

  doc.font("Helvetica-Bold").fontSize(22).fill("#000")
     .text(money(total), xR + 100, M + 60 + 6, { width: RIGHT_W - 110, align: "right", lineBreak: false });

  // Separador
  const y = M + 60 + totalBoxH + 14;
  doc.moveTo(M, y).lineTo(doc.page.width - M, y).strokeColor("#E6E6E6").lineWidth(1).stroke();
  return y + 12;
}

function labeledValueBlock(doc, label, value, x, y, width) {
  doc.font("Helvetica").fontSize(10).fill("#666").text(label, x, y, { width, lineBreak: false });
  const y2 = y + 14;
  doc.font("Helvetica").fontSize(12).fill("#111");
  // Para valores largos (servicio), permitimos wrap en "width" sin desbordar
  const h = doc.heightOfString(String(value ?? "—"), { width, align: "left" });
  doc.text(String(value ?? "—"), x, y2, { width, align: "left" });
  return y2 + h + 8;
}

function drawMeta(doc, y, { empleado, rol, fecha, servicio }) {
  const contentW = doc.page.width - M * 2;
  const GAP = 30;
  const COL_W = Math.floor((contentW - GAP) / 2);

  const leftX = M;
  const rightX = M + COL_W + GAP;

  const yL1 = labeledValueBlock(doc, "Empleado", empleado, leftX, y, COL_W);
  const yL2 = labeledValueBlock(doc, "Rol", rol || "—", leftX, yL1, COL_W);

  const yR1 = labeledValueBlock(doc, "Fecha", fecha || "—", rightX, y, COL_W);
  const yR2 = labeledValueBlock(doc, "Servicio", servicio || "—", rightX, yR1, COL_W);

  const yOut = Math.max(yL2, yR2);
  doc.moveTo(M, yOut).lineTo(doc.page.width - M, yOut).strokeColor("#EDEDED").lineWidth(1).stroke();
  return yOut + 10;
}

function drawItemsTable(doc, y, rows, total) {
  const contentW = doc.page.width - M * 2;
  // Anchos calculados: descripción, la más flexible
  const W_CODE = 100;
  const W_QTY = 60;
  const W_PRICE = 80;
  const W_SUB = 90;
  const W_DESC = contentW - (W_CODE + W_QTY + W_PRICE + W_SUB);

  const headerH = 24, rowH = 22;

  // Encabezado
  doc.save().rect(M, y - 2, contentW, headerH).fill("#F5F6F7").restore();
  const labels = [
    { text: "Código", w: W_CODE, a: "left" },
    { text: "Descripción", w: W_DESC, a: "left" },
    { text: "Cant.", w: W_QTY, a: "right" },
    { text: "Precio", w: W_PRICE, a: "right" },
    { text: "Subtotal", w: W_SUB, a: "right" },
  ];
  let x = M;
  doc.font("Helvetica-Bold").fontSize(10).fill("#111");
  for (const col of labels) {
    doc.text(col.text, x + 6, y + 4, { width: col.w - 12, align: col.a, lineBreak: false });
    x += col.w;
  }
  y += headerH;

  // Capacidad 1 hoja
  const bottomReserve = 120;
  const maxY = doc.page.height - bottomReserve;
  const maxRows = Math.max(0, Math.floor((maxY - y - rowH) / rowH));

  const data = rows.slice(0, maxRows);
  const leftover = rows.length - data.length;

  for (let i = 0; i < data.length; i++) {
    if (i % 2 === 1) doc.save().rect(M, y - 1, contentW, rowH).fill("#FBFBFC").restore();
    const it = data[i];
    let xx = M;

    const cols = [
      { v: String(it.code || "—"), w: W_CODE, a: "left" },
      { v: String(it.name || ""), w: W_DESC, a: "left", clip: true },
      { v: String(it.qty ?? 0), w: W_QTY, a: "right" },
      { v: money(it.price), w: W_PRICE, a: "right" },
      { v: money(it.subtotal ?? ((+it.price || 0) * (+it.qty || 0))), w: W_SUB, a: "right" },
    ];

    doc.font("Helvetica").fontSize(10).fill("#111");
    for (const c of cols) {
      const w = c.w - 12;
      const text = c.clip ? fitText(doc, c.v, w) : c.v;
      doc.text(text, xx + 6, y + 3, { width: w, align: c.a, lineBreak: false });
      xx += c.w;
    }

    // línea de fila
    doc.moveTo(M, y + rowH - 2).lineTo(M + contentW, y + rowH - 2).strokeColor("#EEEEEE").lineWidth(0.5).stroke();
    y += rowH;
  }

  if (leftover > 0) {
    doc.font("Helvetica").fontSize(9).fill("#666").text(`(${leftover} ítems no mostrados)`, M, y + 2);
    y += 16;
  }

  // Fila TOTAL al pie (no se corta)
  doc.save().rect(M, y + 2, contentW, rowH).fill("#F1F2F4").restore();

  const xTotalLabel = M + W_CODE + W_DESC + W_QTY - 6;      // hasta antes de Precio
  const wTotalLabel = W_PRICE + 6;
  const xTotalAmt = xTotalLabel + wTotalLabel;
  const wTotalAmt = W_SUB;

  doc.font("Helvetica-Bold").fontSize(11).fill("#111")
     .text("TOTAL", xTotalLabel, y + 5, { width: wTotalLabel, align: "right", lineBreak: false });

  doc.font("Helvetica-Bold").fontSize(12).fill("#000")
     .text(money(total), xTotalAmt, y + 4, { width: wTotalAmt, align: "right", lineBreak: false });

  return y + rowH + 8;
}

function drawNote(doc, y, nota) {
  if (!nota) return y;
  doc.font("Helvetica-Bold").fontSize(10).fill("#111").text("Nota", M, y);
  doc.font("Helvetica").fontSize(10).fill("#333").text(String(nota || ""), M, y + 12, {
    width: doc.page.width - M * 2,
  });
  return y + 36;
}

function drawFooter(doc) {
  const y = doc.page.height - M + 6;
  doc.font("Helvetica").fontSize(9).fill("#777")
     .text(`Generado por Kazaro ${nowLocal()}`, M, y, { width: doc.page.width - M * 2, lineBreak: false });
}

/* ================= Generador principal ================= */
export async function generateRemitoPDF({ pedido, outDir = path.resolve(process.cwd(), "tmp") }) {
  const cab = pedido?.cab ? pedido.cab : pedido;
  const itemsRaw = pedido?.items || [];
  const pedidoId = cab?.PedidoID ?? cab?.id ?? 0;
  const nro = pad7(pedidoId);

  const empleado = getEmployeeDisplayName(cab?.EmpleadoID);
  const servicioNombre = resolveServiceName(cab?.ServicioID, pedido?.servicio?.name || cab?.servicio?.name);
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
    margins: { top: M, right: M, bottom: M, left: M },
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
