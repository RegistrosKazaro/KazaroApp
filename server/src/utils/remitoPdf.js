// server/src/utils/remitoPdf.js
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

/** ====== Utilidades ====== */
function money(n) {
  const v = Number(n || 0);
  try {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(v);
  } catch {
    return `$ ${v.toFixed(2)}`;
  }
}
function safeFileName(s) {
  return String(s || "").replace(/[^a-z0-9_-]/gi, "-");
}
function toNum(n, def = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : def;
}

/**
 * remito: { numero, fecha, total, empleado, rol, servicio?:{id,name}, nota?: string }
 * items : [{ nombre, codigo?, cantidad, precio, subtotal }, ...]
 */
export async function generateRemitoPDF({ remito, items = [] }) {
  // --- Archivo de salida ---
  const ts = new Date(remito?.fecha || Date.now())
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-");
  const fileName = `remito-${safeFileName(remito?.numero || "00000000")}-${ts}.pdf`;
  const outDir = path.resolve(process.cwd(), "tmp", "remitos");
  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, fileName);

  // --- Documento ---
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 40, right: 36, bottom: 56, left: 36 },
    info: {
      Title: `Remito ${remito?.numero || ""}`,
      Author: "Kazaro",
      Subject: "Remito de pedido",
    },
  });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  /** ====== Design Tokens ====== */
  const C = {
    ink: "#0f172a",
    mute: "#64748b",
    line: "#e2e8f0",
    soft: "#f8fafc",
    brand1: "#4f46e5", // indigo-600
    brand2: "#06b6d4", // cyan-500
    chip: "#eef2ff",
    zebra: "#fbfdff",
    note: "#f1f5f9",
    total: "#eef2ff",
    white: "#ffffff",
  };
  const S = {
    h1: 22,
    text: 11,
    small: 10,
    rowH: 24,
    rads: 10,
  };

  // Helpers de layout
  const pageW = doc.page.width,
    pageH = doc.page.height;
  const marginL = doc.page.margins.left,
    marginT = doc.page.margins.top,
    marginB = doc.page.margins.bottom;
  const W = pageW - marginL * 2;
  const BOTTOM = pageH - marginB;
  let y = marginT;

  const nfMoney = (n) => money(n);

  function line(yPos, color = C.line) {
    doc
      .moveTo(marginL, yPos)
      .lineTo(marginL + W, yPos)
      .lineWidth(0.7)
      .strokeColor(color)
      .stroke();
  }
  function addPageIfNeeded(extra = 0) {
    if (y + extra > BOTTOM) {
      doc.addPage();
      y = marginT;
      if (tableState.inTable) renderTableHeader();
    }
  }
  function chip(text, x, y_, w, h = 26) {
    doc.roundedRect(x, y_, w, h, h / 2).fillAndStroke(C.chip, C.line);
    doc
      .fillColor(C.ink)
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(String(text), x + 10, y_ + 6, { width: w - 20, align: "center" });
  }
  function labelValue(label, value, x, y_, w, opts = {}) {
    const lcol = opts.lcolor || C.mute;
    const vcol = opts.vcolor || C.ink;
    const bold = !!opts.bold;
    doc.fontSize(S.small).fillColor(lcol).font("Helvetica").text(label, x, y_, { width: w });
    doc
      .fontSize(S.text)
      .fillColor(vcol)
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .text(value, x, y_ + 12, { width: w });
    return Math.max(y_ + 12 + doc.currentLineHeight(), y_ + 24);
  }

  /** ====== Header Moderno ====== */
  (function renderHeader() {
    const bandH = 72;
    const grad = doc.linearGradient(marginL, y, marginL, y + bandH);
    grad.stop(0, C.brand1).stop(1, C.brand2);
    doc.roundedRect(marginL, y, W, bandH, S.rads).fill(grad);

    // Marca
    doc.font("Helvetica-Bold").fontSize(18).fillColor(C.white).text("KAZARO", marginL + 18, y + 18);

    // Número de remito destacado
    const rightBoxW = Math.min(280, W / 2);
    const rightBoxH = 44;
    const rx = marginL + W - rightBoxW - 18;
    const ry = y + 14;
    doc.roundedRect(rx, ry, rightBoxW, rightBoxH, 12).fill(C.white);
    doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(12).text("REMITO", rx + 14, ry + 8);
    doc.font("Helvetica").fontSize(11).text(`#${String(remito?.numero || "-")}`, rx + 14, ry + 24);

    y += bandH + 12;
  })();

  /** ====== Bloques de datos ====== */
  (function renderMeta() {
    const gap = 18;
    const colW = (W - gap) / 2;

    // Columna izquierda
    let yL = y;
    yL = labelValue("Empleado", remito?.empleado || "-", marginL, yL, colW, { bold: true });
    yL = labelValue("Rol", remito?.rol || "-", marginL, yL + 6, colW);

    // Columna derecha
    let yR = y;
    const fechaStr = new Date(remito?.fecha || Date.now()).toLocaleString("es-AR");
    yR = labelValue("Fecha", fechaStr, marginL + colW + gap, yR, colW);
    if (remito?.servicio?.name) {
      // servicio puede ocupar varias líneas sin chocar con nada
      yR = labelValue("Servicio", remito.servicio.name, marginL + colW + gap, yR + 6, colW);
    }

    y = Math.max(yL, yR) + 10;
    line(y);
    y += 12;

    // TOTAL en fila PROPIA (nunca se superpone)
    const chipW = 260,
      chipH = 28;
    addPageIfNeeded(chipH + 8);
    chip(`TOTAL: ${nfMoney(remito?.total)}`, marginL + W - chipW, y, chipW, chipH);
    y += chipH + 12;
  })();

  /** ====== Nota (opcional) ====== */
  (function renderNote() {
    const notaTxt = String(remito?.nota || "").trim();
    if (!notaTxt) return;

    const boxW = W,
      boxX = marginL,
      boxPad = 12;
    const textW = boxW - boxPad * 2;
    const textH = doc.heightOfString(notaTxt, { width: textW, align: "left" });
    const boxH = Math.max(46, textH + boxPad * 2 + 8);

    addPageIfNeeded(boxH + 14);
    doc.roundedRect(boxX, y, boxW, boxH, S.rads).fill(C.note);

    doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(S.text).text("Nota del pedido", boxX + boxPad, y + boxPad);
    doc
      .font("Helvetica")
      .fillColor(C.mute)
      .fontSize(S.small)
      .text(notaTxt, boxX + boxPad, y + boxPad + 16, { width: textW });

    y += boxH + 14;
  })();

  /** ====== Tabla de items ====== */
  const tableState = { inTable: false };

  // Cálculo de anchos que SIEMPRE encajan en W
  const wCodigo = Math.max(70, Math.min(100, Math.round(W * 0.16)));
  const wCant = Math.max(56, Math.min(70, Math.round(W * 0.11)));
  const wPrecio = Math.max(70, Math.min(90, Math.round(W * 0.13)));
  const wSub = Math.max(74, Math.min(96, Math.round(W * 0.14)));
  const wNombre = W - (wCodigo + wCant + wPrecio + wSub); // el resto para descripción

  const colX = {
    codigo: marginL + 0,
    nombre: marginL + wCodigo,
    cant: marginL + wCodigo + wNombre,
    precio: marginL + wCodigo + wNombre + wCant,
    sub: marginL + wCodigo + wNombre + wCant + wPrecio,
  };

  const headerH = 28;

  function renderTableHeader() {
    tableState.inTable = true;
    addPageIfNeeded(headerH + 8);

    doc.roundedRect(marginL, y, W, headerH, 8).fill(C.soft).strokeColor(C.line).lineWidth(0.8).stroke();
    doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(S.text);
    doc.text("Código", colX.codigo + 10, y + 8, { width: wCodigo - 14 });
    doc.text("Descripción", colX.nombre + 10, y + 8, { width: wNombre - 14 });
    doc.text("Cant.", colX.cant, y + 8, { width: wCant - 10, align: "right" });
    doc.text("Precio", colX.precio, y + 8, { width: wPrecio - 10, align: "right" });
    doc.text("Subtotal", colX.sub, y + 8, { width: wSub - 10, align: "right" });

    y += headerH + 4;
  }

  // Normalizar items
  const rows = (Array.isArray(items) ? items : []).map((it) => ({
    codigo: (it.codigo ?? it.code ?? it.sku ?? "") + "",
    nombre: (it.nombre ?? it.name ?? it.descripcion ?? "") + "",
    cantidad: toNum(it.cantidad ?? it.qty, 0),
    precio: toNum(it.precio ?? it.price, 0),
    subtotal: toNum(it.subtotal ?? toNum(it.cantidad, 0) * toNum(it.precio, 0), 0),
  }));

  renderTableHeader();

  if (rows.length === 0) {
    addPageIfNeeded(30);
    doc.fillColor(C.mute).font("Helvetica").fontSize(S.text).text("No hay items en este pedido.", marginL, y + 6);
    y += 30;
  } else {
    doc.font("Helvetica").fontSize(S.text).fillColor(C.ink);

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];

      // Alto dinámico por descripción
      const nombreWidth = wNombre - 14;
      const nombreHeight = Math.max(doc.heightOfString(r.nombre || "-", { width: nombreWidth }), 14);
      const rowH = Math.max(S.rowH, nombreHeight + 12);

      addPageIfNeeded(rowH + 10);

      // Zebra
      if (i % 2 === 1) {
        doc.rect(marginL, y, W, rowH).fillOpacity(1).fill(C.zebra).fillOpacity(1);
      }

      // Separador inferior
      doc
        .moveTo(marginL, y + rowH)
        .lineTo(marginL + W, y + rowH)
        .lineWidth(0.4)
        .strokeColor(C.line)
        .stroke();

      // Contenido
      doc.fillColor(C.ink);
      doc.text(r.codigo || "-", colX.codigo + 10, y + 6, { width: wCodigo - 14 });
      doc.text(r.nombre || "-", colX.nombre + 10, y + 6, { width: nombreWidth });
      doc.text(String(r.cantidad ?? "-"), colX.cant, y + 6, { width: wCant - 10, align: "right" });
      doc.text(nfMoney(r.precio || 0), colX.precio, y + 6, { width: wPrecio - 10, align: "right" });
      doc.text(nfMoney(r.subtotal || 0), colX.sub, y + 6, { width: wSub - 10, align: "right" });

      y += rowH;
    }
  }

  /** ====== Panel de Total ====== */
  (function renderTotals() {
    const panelW = 260,
      panelH = 56;
    addPageIfNeeded(panelH + 12);

    const px = marginL + W - panelW;
    const py = y + 14;

    doc.roundedRect(px, py, panelW, panelH, 12).fill(C.total).strokeColor(C.line).lineWidth(0.8).stroke();
    doc.fillColor(C.mute).font("Helvetica").fontSize(10).text("Total", px + 14, py + 10);
    doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(16).text(nfMoney(remito?.total), px + 14, py + 24);

    y = py + panelH + 8;
  })();

  /** ====== Footer ====== */
  (function renderFooter() {
    const fy = BOTTOM - 10;
    doc.strokeColor(C.line).moveTo(marginL, fy - 12).lineTo(marginL + W, fy - 12).stroke();
    doc
      .fillColor(C.mute)
      .font("Helvetica")
      .fontSize(S.small)
      .text("Generado por Kazaro", marginL, fy - 2, { width: W / 2, align: "left" })
      .text(new Date().toLocaleString("es-AR"), marginL + W / 2, fy - 2, { width: W / 2, align: "right" });
  })();

  // Cerrar
  doc.end();
  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return { filePath, fileName };
}
