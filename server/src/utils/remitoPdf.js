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
 * Estructura esperada:
 *  remito: { numero, fecha, total, empleado, rol, servicio?:{id,name} }
 *  items:  [{ nombre, codigo?, cantidad, precio, subtotal }, ...]
 *
 * Retorna: { filePath, fileName }
 */
export async function generateRemitoPDF({ remito, items = [] }) {
  // --- Archivo de salida ---
  const ts = new Date(remito?.fecha || Date.now()).toISOString().slice(0,19).replace(/[:T]/g,"-");
  const fileName = `remito-${safeFileName(remito?.numero || "00000000")}-${ts}.pdf`;
  const outDir = path.resolve(process.cwd(), "tmp");
  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, fileName);

  // --- Documento ---
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 36, right: 36, bottom: 48, left: 36 },
    info: {
      Title: `Remito ${remito?.numero || ""}`,
      Author: "Kazaro",
      Subject: "Remito de pedido",
    }
  });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // Paleta y tamaños
  const C = {
    text:   "#0b1220",
    muted:  "#596175",
    border: "#d9dfeb",
    head:   "#eff2ff",
    accent: "#2563eb",
    white:  "#ffffff",
  };
  const S = {
    h1: 20,
    h2: 12.5,
    text: 11,
    small: 9.5,
    rowH: 22,
  };

  // Helpers de layout
  const pageW = doc.page.width, pageH = doc.page.height;
  const margin = doc.page.margins.left;
  const W = pageW - margin * 2;
  const BOTTOM = pageH - doc.page.margins.bottom;

  let y = margin;

  function line(yPos, color=C.border) {
    doc
      .moveTo(margin, yPos)
      .lineTo(margin + W, yPos)
      .lineWidth(0.7)
      .strokeColor(color)
      .stroke();
  }
  function addPageIfNeeded(extra = 0) {
    if (y + extra > BOTTOM) {
      doc.addPage();
      y = doc.page.margins.top;
    }
  }

  /** ====== Encabezado ====== */
  doc
    .fillColor(C.accent)
    .fontSize(S.h1)
    .text("KAZARO", margin, y, { width: W, align: "left" });
  doc
    .fillColor(C.text)
    .fontSize(S.h1)
    .text("REMITO", margin, y, { width: W, align: "right" });
  y += 28;
  line(y); y += 10;

  // Datos del remito
  doc.fontSize(S.text).fillColor(C.text);
  const leftColX = margin;
  const rightColX = margin + W/2 + 8;

  const fecha = new Date(remito?.fecha || Date.now());
  const fechaStr = fecha.toLocaleString("es-AR");

  // Columna izquierda
  doc.text(`Remito Nº: ${remito?.numero || "-"}`, leftColX, y);
  y += 16;
  doc.text(`Fecha: ${fechaStr}`, leftColX, y);
  y += 16;
  if (remito?.empleado) {
    doc.text(`Empleado: ${remito.empleado}`, leftColX, y);
    y += 16;
  }
  if (remito?.rol) {
    doc.text(`Rol: ${remito.rol}`, leftColX, y);
    y += 16;
  }

  // Columna derecha
  let yRight = y - (remito?.rol ? 16 : 0) - 16; // alinear aprox con arriba
  doc.text(`Total estimado: ${money(remito?.total)}`, rightColX, yRight);
  yRight += 16;
  if (remito?.servicio?.name) {
    doc.text(`Servicio: ${remito.servicio.name}`, rightColX, yRight);
    yRight += 16;
  }
  y = Math.max(y, yRight) + 10;
  line(y); y += 12;

  /** ====== Tabla de items ====== */

  // Cabecera de tabla
  const col = {
    codigo: { x: margin + 0,   w: 90,  label: "Código" },
    nombre: { x: margin + 95,  w: 220, label: "Descripción" },
    cant:   { x: margin + 320, w: 60,  label: "Cant." },
    precio: { x: margin + 385, w: 80,  label: "Precio" },
    sub:    { x: margin + 470, w: 80,  label: "Subtotal" },
  };

  // Band de cabecera
  addPageIfNeeded(40);
  doc
    .rect(margin, y, W, 24)
    .fillAndStroke(C.head, C.border);
  doc.fillColor(C.text).fontSize(S.text).font("Helvetica-Bold");
  doc.text(col.codigo.label, col.codigo.x + 6, y + 6, { width: col.codigo.w - 12 });
  doc.text(col.nombre.label, col.nombre.x + 6, y + 6, { width: col.nombre.w - 12 });
  doc.text(col.cant.label,   col.cant.x   + 6, y + 6, { width: col.cant.w   - 12, align: "right" });
  doc.text(col.precio.label, col.precio.x + 6, y + 6, { width: col.precio.w - 12, align: "right" });
  doc.text(col.sub.label,    col.sub.x    + 6, y + 6, { width: col.sub.w    - 12, align: "right" });
  y += 26;

  // Filas
  doc.font("Helvetica").fontSize(S.text).fillColor(C.text);
  const rowGap = 2;
  const maxNombreLineas = 2; // corta nombre en 2 líneas máx

  // Normalizar items
  const rows = (Array.isArray(items) ? items : []).map((it) => ({
    codigo: (it.codigo ?? it.code ?? it.sku ?? "") + "",
    nombre: (it.nombre ?? it.name ?? it.descripcion ?? "") + "",
    cantidad: toNum(it.cantidad ?? it.qty, 0),
    precio: toNum(it.precio ?? it.price, 0),
    subtotal: toNum(it.subtotal ?? (toNum(it.cantidad,0)*toNum(it.precio,0)), 0),
  }));

  if (rows.length === 0) {
    addPageIfNeeded(20);
    doc.fillColor(C.muted).text("No hay items en este pedido.", margin, y);
    y += 20;
  } else {
    for (const r of rows) {
      // Alto dinámico por posible salto de nombre
      const nombreOpts = { width: col.nombre.w - 12, continued: false };
      const nombreLines = doc.heightOfString(r.nombre, nombreOpts);
      const linesCount = Math.min(Math.ceil(nombreLines / doc.currentLineHeight()), maxNombreLineas);
      const h = Math.max(S.rowH, linesCount * (doc.currentLineHeight() - 1) + 10);

      addPageIfNeeded(h + rowGap + 40);

      // Separador de fila
      doc.save()
        .moveTo(margin, y + h)
        .lineTo(margin + W, y + h)
        .lineWidth(0.4)
        .strokeColor(C.border)
        .stroke()
        .restore();

      // Código
      doc.fillColor(C.text).text(r.codigo || "-", col.codigo.x + 6, y + 6, { width: col.codigo.w - 12 });

      // Descripción (con tope de líneas)
      const nombreY = y + 6;
      let printed = r.nombre;
      // pdfkit no tiene “maxLines”, así que recortamos a mano si hace falta
      if (linesCount > maxNombreLineas) {
        // naive cut si alguien pasa bloques enormes (raro)
        printed = printed.slice(0, 180) + "…";
      }
      doc.text(printed, col.nombre.x + 6, nombreY, { width: col.nombre.w - 12 });

      // Cantidad / Precio / Subtotal
      doc.text(String(r.cantidad), col.cant.x + 6, y + 6, { width: col.cant.w - 12, align: "right" });
      doc.text(money(r.precio),    col.precio.x + 6, y + 6, { width: col.precio.w - 12, align: "right" });
      doc.text(money(r.subtotal),  col.sub.x + 6, y + 6, { width: col.sub.w - 12, align: "right" });

      y += h + rowGap;
    }
  }

  // Total
  addPageIfNeeded(40);
  y += 8;
  line(y); y += 10;
  doc.font("Helvetica-Bold").fontSize(S.text);
  doc.text("TOTAL", col.precio.x + 6, y, { width: col.precio.w - 12, align: "right" });
  doc.text(money(remito?.total), col.sub.x + 6, y, { width: col.sub.w - 12, align: "right" });

  // Footer
  y = BOTTOM - 24;
  line(y - 8, C.border);
  doc.font("Helvetica").fontSize(S.small).fillColor(C.muted)
     .text("Generado por Kazaro", margin, y, { width: W, align: "left" })
     .text(new Date().toLocaleString("es-AR"), margin, y, { width: W, align: "right" });

  // Cerrar
  doc.end();
  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return { filePath, fileName };
}
