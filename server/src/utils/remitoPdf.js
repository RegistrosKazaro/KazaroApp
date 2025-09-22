// server/src/utils/remitoPdf.js
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

function money(n) {
  try {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" })
      .format(Number(n || 0));
  } catch {
    const v = Number(n || 0);
    return `$ ${v.toFixed(2)}`;
  }
}
function safeFileName(s) {
  return String(s).replace(/[^a-z0-9_-]/gi, "-");
}

/**
 * @param {{ remito: {numero, fecha, total, empleado, rol, servicio?:{id,name}}, items: Array<{nombre, cantidad, precio, subtotal, codigo?:string}> }}
 */
export async function generateRemitoPDF({ remito, items = [] }) {

  const page = { width: 595.28, height: 841.89 };
  const margin = 44;
  const W = page.width - margin * 2;

  const C = {
    text:   "#0b1220",
    muted:  "#596175",
    border: "#d9dfeb",
    card:   "#f6f8ff",
    head:   "#eff2ff",
    accent: "#2563eb",
    accentDark: "#1d4ed8",
    white:  "#ffffff"
  };

  const S = {
    h1: 22,
    h2: 12.5,
    text: 11.5,
    small: 9.5,
    tableHead: 11.5,
    table: 11,
    rowH: 30,          // <<<<< un poco más alto para alojar la línea del código
    bandH: 56,
    gap: 16,
    chipH: 26,
  };

  const ts = new Date(remito?.fecha || Date.now()).toISOString().slice(0,19).replace(/[:T]/g,"-");
  const fileName = `remito-${safeFileName(remito?.numero || "00000000")}-${ts}.pdf`;
  const outDir = path.resolve(process.cwd(), "tmp");
  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, fileName);

  const doc = new PDFDocument({
    size: [page.width, page.height],
    margins: { top: margin, right: margin, bottom: margin, left: margin },
    info: {
      Title: `Remito ${remito?.numero || ""}`,
      Author: "Kazaro",
      Subject: "Remito de pedido",
    }
  });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  let y = margin;

  // banda superior
  doc.save().roundedRect(margin, y, W, S.bandH, 12).fill(C.head).restore();
  doc.font("Helvetica-Bold").fontSize(S.h1).fillColor(C.text)
    .text("REMITO", margin, y + 12, { width: W, align: "center" });
  y += S.bandH + 8;

  // badge
  const badgePadX = 14;
  const badgePadY = 6;
  const badgeText = `Nº ${remito?.numero || ""} · ${new Date(remito?.fecha || Date.now()).toLocaleString("es-AR")}`;
  doc.font("Helvetica-Bold").fontSize(S.h2);
  const badgeTextW = doc.widthOfString(badgeText);
  const badgeW = Math.min(W, badgeTextW + badgePadX * 2);
  const badgeH = S.chipH;
  const badgeX = margin + (W - badgeW) / 2;
  doc.save().roundedRect(badgeX, y, badgeW, badgeH, 999).fill(C.accent).restore();
  doc.fillColor(C.white)
    .text(badgeText, badgeX + badgePadX, y + (badgeH - S.h2) / 2 - 1, { width: badgeW - badgePadX * 2, align: "center" });
  y += badgeH + S.gap;

  // ficha Empleado / Rol / Servicio
  const cardPad = 14;
  const colGap = 12;
  const cols = 3;
  const colW = Math.floor((W - cardPad*2 - colGap*(cols-1)) / cols);

  const blocks = [
    { label: "Empleado", value: remito?.empleado || "-" },
    { label: "Rol",      value: remito?.rol || "-" },
    { label: "Servicio", value: remito?.servicio ? `${remito.servicio.name} (ID: ${remito.servicio.id})` : "-" },
  ];

  doc.fontSize(S.small).font("Helvetica");
  const labelH = doc.heightOfString("Xg", { width: colW });
  doc.fontSize(S.text);
  const valueHeights = blocks.map(b => doc.heightOfString(String(b.value), { width: colW }));
  const innerH = Math.max(...valueHeights) + labelH + 8 + 6;
  const cardH = innerH + cardPad*2;

  doc.save()
    .roundedRect(margin, y, W, cardH, 12)
    .fill(C.white)
    .lineWidth(0.8)
    .strokeColor(C.border)
    .stroke()
    .restore();

  let x = margin + cardPad;
  const labelStyle = () => doc.font("Helvetica").fontSize(S.small).fillColor(C.muted);
  const valueStyle = () => doc.font("Helvetica-Bold").fontSize(S.text).fillColor(C.text);

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    labelStyle(); doc.text(b.label, x, y + cardPad, { width: colW });
    valueStyle(); doc.text(String(b.value), x, y + cardPad + labelH + 6, { width: colW, align: "left", ellipsis: true });
    x += colW + colGap;
  }

  y += cardH + S.gap;

  // columnas
  const col = {
    nombre: { x: margin + 12,                 w: Math.floor(W * 0.50) - 12 },
    cant:   { x: margin + Math.floor(W*0.50), w: Math.floor(W * 0.16) },
    precio: { x: margin + Math.floor(W*0.66), w: Math.floor(W * 0.17) },
    sub:    { x: margin + Math.floor(W*0.83), w: Math.floor(W * 0.17) - 12 },
  };

  // encabezado tabla
  const headH = S.tableHead + 12;
  doc.save().roundedRect(margin, y, W, headH, 10).fill(C.card).restore();
  doc.font("Helvetica-Bold").fontSize(S.tableHead).fillColor(C.text);
  const hy = y + (headH - S.tableHead)/2 - 1;
  doc.text("Producto", col.nombre.x, hy, { width: col.nombre.w });
  doc.text("Cantidad", col.cant.x,   hy, { width: col.cant.w,   align: "right" });
  doc.text("Precio",   col.precio.x, hy, { width: col.precio.w, align: "right" });
  doc.text("Subtotal", col.sub.x,    hy, { width: col.sub.w,    align: "right" });
  y += headH;

  // filas
  doc.font("Helvetica").fontSize(S.table);
  let zebra = false;
  const tableY0 = y;

  for (const it of items) {
    if (zebra) {
      doc.save().rect(margin, y, W, S.rowH).fillOpacity(0.05).fill(C.accent).fillOpacity(1).restore();
    }
    zebra = !zebra;

    const ty = y + 5; // más aire
    // Nombre
    doc.fillColor(C.text).text(String(it.nombre || "-"), col.nombre.x, ty, {
      width: col.nombre.w,
      ellipsis: true
    });

    // Código (si hay): debajo del nombre, chico y gris
    if (it.codigo) {
      doc.fontSize(S.small).fillColor(C.muted)
        .text(`Código: ${String(it.codigo)}`, col.nombre.x, ty + 12, {
          width: col.nombre.w,
          ellipsis: true
        })
        .fontSize(S.table) // volver a tamaño normal
        .fillColor(C.text);
    }

    // numéricos
    const rightY = y + (S.rowH - S.table)/2 - 1;
    doc.text(String(it.cantidad ?? 0), col.cant.x, rightY, { width: col.cant.w, align: "right" });
    doc.text(money(it.precio ?? 0),    col.precio.x, rightY, { width: col.precio.w, align: "right" });
    doc.text(money(it.subtotal ?? 0),  col.sub.x, rightY, { width: col.sub.w, align: "right" });

    y += S.rowH;
  }

  // borde de la tabla
  doc.save().roundedRect(margin, tableY0 - headH, W, (y - tableY0) + headH, 10)
    .lineWidth(0.7).strokeColor(C.border).stroke().restore();

  y += S.gap;

  // tarjeta total
  const cardW2 = Math.min(300, Math.floor(W * 0.52));
  const cardX = margin + W - cardW2;
  const totalsH = 54;

  doc.save().roundedRect(cardX, y, cardW2, totalsH, 12)
    .fill(C.white).lineWidth(0.8).strokeColor(C.border).stroke().restore();

  doc.font("Helvetica").fontSize(S.text).fillColor(C.text)
    .text("Total", cardX + 14, y + 10, { width: cardW2 - 28 });
  doc.font("Helvetica-Bold").fontSize(S.h2).fillColor(C.accentDark)
    .text(money(remito?.total || 0), cardX + 14, y + 10, { width: cardW2 - 28, align: "right" });
  doc.font("Helvetica").fontSize(S.small).fillColor(C.muted)
    .text(`Generado: ${new Date().toLocaleString("es-AR")}`, cardX + 14, y + 32, { width: cardW2 - 28, align: "right" });

  // pie
  doc.font("Helvetica").fontSize(S.small).fillColor(C.muted)
    .text("Documento interno de pedido. Para cualquier consulta, contacte al área administrativa.",
      margin, page.height - margin - S.small, { width: W, align: "center" });

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return { filePath, fileName };
}
