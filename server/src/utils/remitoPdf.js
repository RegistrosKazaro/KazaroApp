// server/src/utils/remitoPdf.js
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { getEmployeeDisplayName, getServiceNameById, db } from "../db.js";
import { PassThrough } from "stream";

/* ================= Helpers ================= */
const pad7 = (n) => String(n ?? "").padStart(7, "0");
const money = (n) => {
  const v = Number(n || 0);
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
    }).format(v);
  } catch {
    return `$ ${v.toFixed(2)}`;
  }
};
const baseDateOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false, // 24 hs
};

const fmtDateTime = (s) => {
  if (!s) return nowLocal(); 

  try {
    
    const [datePart, timePart = "00:00:00"] = String(s).trim().split(" ");
    const [Y, M, D] = datePart.split("-").map(Number);
    const [h = 0, m = 0, sec = 0] = timePart.split(":").map(Number);
    const utcMs = Date.UTC(Y, M - 1, D, h, m, sec);
    const dLocal = new Date(utcMs);
    return dLocal.toLocaleString("es-AR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(s || "");
  }
};

const nowLocal = () =>
  new Date().toLocaleString("es-AR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

function fitText(doc, text, width) {
  const ell = "…";
  let t = String(text ?? "");
  if (doc.widthOfString(t) <= width) return t;
  while (t.length && doc.widthOfString(t + ell) > width) t = t.slice(0, -1);
  return t + ell;
}

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
        cands.find((n) =>
          info.some((c) => String(c.name).toLowerCase() === n.toLowerCase())
        );
      const idCol =
        info.find((c) => c.pk === 1)?.name ||
        pick([
          "ServiciosID",
          "ServicioID",
          "IdServicio",
          "service_id",
          "servicio_id",
          "ID",
          "id",
        ]);
      const nameCol =
        pick([
          "ServicioNombre",
          "Nombre",
          "Descripcion",
          "Detalle",
          "NombreServicio",
          "Servicio",
        ]) || idCol;
      if (idCol && nameCol && serviceId != null) {
        const r = db
          .prepare(
            `SELECT ${nameCol} AS n FROM Servicios WHERE CAST(${idCol} AS TEXT)=CAST(? AS TEXT) LIMIT 1`
          )
          .get(serviceId);
        if (r?.n) return String(r.n);
      }
    }
  } catch {
  }
  return serviceId != null ? String(serviceId) : "—";
}

/* ================= Layout ================= */
const M = 36; 
const BRAND_COLOR = "#2563EB"; 
const LIGHT_GRAY = "#F3F4F6";
const BORDER_GRAY = "#E5E7EB";
const TEXT_MUTED = "#6B7280";

/* ====== HEADER: más corporativo ====== */
function drawHeader(doc, nro, fecha, total) {
  const contentW = doc.page.width - M * 2;
  doc
    .save()
    .rect(0, 0, doc.page.width, 70)
    .fill("#F9FAFB")
    .restore();

  doc
    .fillColor(BRAND_COLOR)
    .font("Helvetica-Bold")
    .fontSize(26)
    .text("KAZARO", M, M - 4);

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#374151")
    .text("Kazaro SRL", M, M + 24)
    .text("Depósito y Distribución", M, M + 36)
    .text("Email: info@kazaro.com.ar", M, M + 48);
  const RIGHT_W = 260;
  const xR = doc.page.width - M - RIGHT_W;

  doc
    .save()
    .roundedRect(xR, M - 8, RIGHT_W, 64, 8)
    .lineWidth(1)
    .strokeColor(BRAND_COLOR)
    .stroke()
    .restore();

  doc
    .font("Helvetica-Bold")
    .fontSize(16)
    .fillColor(BRAND_COLOR)
    .text("REMITO", xR + 12, M, {
      width: RIGHT_W - 24,
      align: "left",
      lineBreak: false,
    });

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#111827")
    .text(`N.º ${nro}`, xR + 12, M + 22, {
      width: RIGHT_W - 24,
      align: "left",
      lineBreak: false,
    });

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(TEXT_MUTED)
    .text(fecha || "", xR + 12, M + 38, {
      width: RIGHT_W - 24,
      align: "left",
      lineBreak: false,
    });

  const totalBadgeW = 130;
  const totalBadgeX = xR + RIGHT_W - totalBadgeW - 10;
  const totalBadgeY = M + 10;

  doc
    .save()
    .roundedRect(totalBadgeX, totalBadgeY, totalBadgeW, 32, 6)
    .fill(BRAND_COLOR)
    .restore();

  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor("#E5E7EB")
    .text("TOTAL", totalBadgeX + 10, totalBadgeY + 6, {
      width: totalBadgeW - 20,
      align: "left",
      lineBreak: false,
    });

  doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .fillColor("#FFFFFF")
    .text(money(total), totalBadgeX + 10, totalBadgeY + 16, {
      width: totalBadgeW - 20,
      align: "right",
      lineBreak: false,
    });

  const y = M + 60;
  doc
    .moveTo(M, y)
    .lineTo(M + contentW, y)
    .strokeColor(BORDER_GRAY)
    .lineWidth(1)
    .stroke();

  return y + 12;
}

/* ====== BLOQUE DE METADATOS (empleado, rol, etc.) ====== */
function labeledValueBlock(doc, label, value, x, y, width) {
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(TEXT_MUTED)
    .text(label.toUpperCase(), x, y, {
      width,
      lineBreak: false,
    });

  const y2 = y + 10;

  doc.font("Helvetica").fontSize(11).fillColor("#111827");
  const h = doc.heightOfString(String(value ?? "—"), {
    width,
    align: "left",
  });

  doc.text(String(value ?? "—"), x, y2, { width, align: "left" });
  doc
    .moveTo(x, y2 + h + 2)
    .lineTo(x + width, y2 + h + 2)
    .strokeColor("#E5E7EB")
    .lineWidth(0.5)
    .stroke();

  return y2 + h + 8;
}

function drawMeta(doc, y, { empleado, rol, fecha, servicio }) {
  const contentW = doc.page.width - M * 2;
  const GAP = 30;
  const COL_W = Math.floor((contentW - GAP) / 2);
  const leftX = M;
  const rightX = M + COL_W + GAP;

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#111827")
    .text("Datos del pedido", M, y - 4);

  y += 14;

  const yL1 = labeledValueBlock(doc, "Empleado", empleado, leftX, y, COL_W);
  const yL2 = labeledValueBlock(doc, "Rol", rol || "—", leftX, yL1, COL_W);
  const yR1 = labeledValueBlock(doc, "Fecha de generación", fecha || "—", rightX, y, COL_W);
  const yR2 = servicio
    ? labeledValueBlock(doc, "Servicio asociado", servicio, rightX, yR1, COL_W)
    : yR1;
  const yOut = Math.max(yL2, yR2) + 4;

  doc
    .moveTo(M, yOut)
    .lineTo(M + contentW, yOut)
    .strokeColor(BORDER_GRAY)
    .lineWidth(1)
    .stroke();

  return yOut + 10;
}

/* ====== TABLA DE ÍTEMS ====== */
function drawItemsTable(doc, y, rows, total) {
  const contentW = doc.page.width - M * 2;
  const W_CODE = 90;
  const W_QTY = 60;
  const W_PRICE = 80;
  const W_SUB = 90;
  const W_DESC = contentW - (W_CODE + W_QTY + W_PRICE + W_SUB);
  const headerH = 24;
  const rowH = 22;

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#111827")
    .text("Detalle de ítems", M, y);
  y += 14;

  doc
    .save()
    .roundedRect(M, y - 2, contentW, headerH, 4)
    .fill("#EFF6FF")
    .restore();

  const labels = [
    { text: "Código", w: W_CODE, a: "left" },
    { text: "Descripción", w: W_DESC, a: "left" },
    { text: "Cant.", w: W_QTY, a: "right" },
    { text: "Precio", w: W_PRICE, a: "right" },
    { text: "Subtotal", w: W_SUB, a: "right" },
  ];

  let x = M;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#1F2933");

  for (const col of labels) {
    doc.text(col.text, x + 6, y + 5, {
      width: col.w - 12,
      align: col.a,
      lineBreak: false,
    });
    x += col.w;
  }
  y += headerH;

  const bottomReserve = 120;
  const maxY = doc.page.height - bottomReserve;
  const maxRows = Math.max(0, Math.floor((maxY - y - rowH) / rowH));

  const data = rows.slice(0, maxRows);
  const leftover = rows.length - data.length;

  for (let i = 0; i < data.length; i++) {
    const it = data[i];
    const isStriped = i % 2 === 1;

    if (isStriped) {
      doc
        .save()
        .rect(M, y - 1, contentW, rowH)
        .fill(LIGHT_GRAY)
        .restore();
    }

    let xx = M;

    const cols = [
      { v: String(it.code || "—"), w: W_CODE, a: "left" },
      { v: String(it.name || ""), w: W_DESC, a: "left", clip: true },
      { v: String(it.qty ?? 0), w: W_QTY, a: "right" },
      { v: money(it.price), w: W_PRICE, a: "right" },
      {
        v: money(it.subtotal ?? (+it.price || 0) * (+it.qty || 0)),
        w: W_SUB,
        a: "right",
      },
    ];

    doc.font("Helvetica").fontSize(9).fillColor("#111827");
    for (const c of cols) {
      const w = c.w - 12;
      const text = c.clip ? fitText(doc, c.v, w) : c.v;
      doc.text(text, xx + 6, y + 4, {
        width: w,
        align: c.a,
        lineBreak: false,
      });
      xx += c.w;
    }

    doc
      .moveTo(M, y + rowH - 2)
      .lineTo(M + contentW, y + rowH - 2)
      .strokeColor("#E5E7EB")
      .lineWidth(0.4)
      .stroke();

    y += rowH;
  }

  if (leftover > 0) {
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(TEXT_MUTED)
      .text(`(${leftover} ítems no mostrados en este remito)`, M, y + 2);
    y += 16;
  }

  doc
    .save()
    .roundedRect(M, y + 4, contentW, rowH, 4)
    .fill("#F9FAFB")
    .restore();

  const xTotalLabel = M + W_CODE + W_DESC + W_QTY - 6;
  const wTotalLabel = W_PRICE + 6;
  const xTotalAmt = xTotalLabel + wTotalLabel;
  const wTotalAmt = W_SUB;

  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor("#111827")
    .text("TOTAL", xTotalLabel, y + 8, {
      width: wTotalLabel,
      align: "right",
      lineBreak: false,
    });

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(BRAND_COLOR)
    .text(money(total), xTotalAmt, y + 7, {
      width: wTotalAmt,
      align: "right",
      lineBreak: false,
    });

  return y + rowH + 14;
}

/* ====== NOTA ====== */
function drawNote(doc, y, nota) {
  if (!nota) return y;

  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor("#111827")
    .text("Observaciones", M, y);

  y += 12;

  doc
    .save()
    .roundedRect(
      M,
      y - 4,
      doc.page.width - M * 2,
      60,
      6
    )
    .strokeColor("#E5E7EB")
    .lineWidth(0.8)
    .stroke()
    .restore();

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#374151")
    .text(String(nota || ""), M + 8, y, {
      width: doc.page.width - (M + 8) * 2,
    });

  return y + 68;
}

/* ====== FOOTER ====== */
function drawFooter(doc) {
  const y = doc.page.height - M + 2;

  doc
    .moveTo(M, y)
    .lineTo(doc.page.width - M, y)
    .strokeColor(BORDER_GRAY)
    .lineWidth(0.5)
    .stroke();

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(TEXT_MUTED)
    .text(
      `Generado por Kazaro — ${nowLocal()}  |  Este documento es válido sin firma ni sello.`,
      M,
      y + 6,
      {
        width: doc.page.width - M * 2,
        align: "center",
      }
    );
}

/* ================= Generador principal ================= */
export async function generateRemitoPDF({
  pedido,
  outDir = path.resolve(process.cwd(), "tmp"),
}) {
  const cab = pedido?.cab ? pedido.cab : pedido;
  const itemsRaw = pedido?.items || [];
  const pedidoId = cab?.PedidoID ?? cab?.id ?? 0;
  const nro = pad7(pedidoId);

  const empleado = getEmployeeDisplayName(cab?.EmpleadoID);
  const rol = String(cab?.Rol || "");
  const isSupervisorOrder = rol.toLowerCase().includes("super");
  const baseServicioNombre =
    cab?.ServicioID != null
      ? resolveServiceName(
          cab.ServicioID,
          pedido?.servicio?.name || cab?.servicio?.name
        )
      : null;
    const servicioNombre =
    isSupervisorOrder && cab?.ServicioID ? baseServicioNombre : null;

  const fecha = fmtDateTime(cab?.Fecha);

  const items = itemsRaw.map((it) => ({
    code: it.codigo ?? it.code ?? "",
    name: it.nombre ?? it.name ?? "",
    qty: Number(it.cantidad ?? it.qty ?? 0),
    price: Number(it.precio ?? it.price ?? 0),
    subtotal: Number(
      it.subtotal ??
        Number(it.precio ?? it.price ?? 0) *
          Number(it.cantidad ?? it.qty ?? 0)
    ),
  }));
  const total = Number(
    cab?.Total ?? items.reduce((s, r) => s + (r.subtotal || 0), 0)
  );

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
  y = drawMeta(doc, y, {
    empleado,
    rol,
    fecha,
    servicio: servicioNombre,
  });
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

export async function generateRemitoPDFBuffer({ pedido }) {
  const cab = pedido?.cab ? pedido.cab : pedido;
  const itemsRaw = pedido?.items || [];
  const pedidoId = cab?.PedidoID ?? cab?.id ?? 0;
  const nro = pad7(pedidoId);

  const empleado = getEmployeeDisplayName(cab?.EmpleadoID);
  const rol = String(cab?.Rol || "");
  const isSupervisorOrder = rol.toLowerCase().includes("super");
  const baseServicioNombre =
    cab?.ServicioID != null
      ? resolveServiceName(
          cab.ServicioID,
          pedido?.servicio?.name || cab?.servicio?.name
        )
      : null;
  const servicioNombre =
    isSupervisorOrder && cab?.ServicioID ? baseServicioNombre : null;

  const fecha = fmtDateTime(cab?.Fecha);

  const items = itemsRaw.map((it) => ({
    code: it.codigo ?? it.code ?? "",
    name: it.nombre ?? it.name ?? "",
    qty: Number(it.cantidad ?? it.qty ?? 0),
    price: Number(it.precio ?? it.price ?? 0),
    subtotal: Number(
      it.subtotal ??
        Number(it.precio ?? it.price ?? 0) *
          Number(it.cantidad ?? it.qty ?? 0)
    ),
  }));
  const total = items.reduce((a, b) => a + Number(b.subtotal || 0), 0);

  const doc = new PDFDocument({ size: "A4", margin: 36 });
  const chunks = [];
  const passthrough = new PassThrough();

  doc.pipe(passthrough);
  passthrough.on("data", (c) => chunks.push(c));

  const done = new Promise((resolve, reject) => {
    passthrough.on("end", () => resolve(Buffer.concat(chunks)));
    passthrough.on("error", reject);
  });

  let y = drawHeader(doc, nro, fecha, total);
  y = drawMeta(doc, y, {
    empleado,
    rol,
    fecha,
    servicio: servicioNombre,
  });
  y = drawItemsTable(doc, y, items, total);
  y = drawNote(doc, y + 4, cab?.Nota);
  drawFooter(doc);

  doc.end();
  const buffer = await done;

  return { filename: `remito_${nro}.pdf`, buffer };
}
