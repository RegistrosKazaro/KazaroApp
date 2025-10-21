// client/src/pages/Reports.jsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { api } from "../api/client";
import "../styles/catalog.css";
import "../styles/reports.css";

// Recharts
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

// PDF + capturas
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import autoTable from "jspdf-autotable";

function yRange() {
  const y = new Date().getFullYear();
  const arr = [];
  for (let k = y; k >= y - 5; k--) arr.push(k);
  return arr;
}
const MONTHS_ES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
];

// ======= Datos ficticios para “Demo” =======
const demoData = {
  ok: true,
  period: { year: 2025, month: 9, start: "2025-09-01 00:00:00", end: "2025-10-01 00:00:00" },
  totals: { ordersCount: 42, itemsCount: 187, amount: 1532000 },
  top_services: [
    { serviceId: 1, serviceName: "Centro Norte", pedidos: 12, qty: 58, amount: 480000 },
    { serviceId: 2, serviceName: "Clínica Sur", pedidos: 8, qty: 40, amount: 320000 },
    { serviceId: 3, serviceName: "Oncología", pedidos: 5, qty: 24, amount: 215000 },
    { serviceId: 4, serviceName: "UTI Adultos", pedidos: 4, qty: 20, amount: 180000 },
    { serviceId: 5, serviceName: "Pediatría", pedidos: 3, qty: 14, amount: 120000 },
    { serviceId: 6, serviceName: "Gastroenterología", pedidos: 3, qty: 12, amount: 95000 },
    { serviceId: 7, serviceName: "Trauma", pedidos: 2, qty: 10, amount: 80000 },
    { serviceId: 8, serviceName: "Emergencias", pedidos: 2, qty: 6, amount: 60000 },
    { serviceId: 9, serviceName: "Diagnóstico por Imagen", pedidos: 2, qty: 2, amount: 35000 },
    { serviceId: 10, serviceName: "Hemodinamia", pedidos: 1, qty: 1, amount: 15000 },
  ],
  top_products: [
    { productId: 101, name: "Guantes Nitrilo Talle M", code: "GN-M", pedidos: 20, qty: 60, amount: 240000 },
    { productId: 102, name: "Alcohol en Gel 500ml", code: "AG-500", pedidos: 14, qty: 40, amount: 160000 },
    { productId: 103, name: "Barbijo Triple Capa", code: "B-TC", pedidos: 8, qty: 26, amount: 78000 },
    { productId: 104, name: "Jeringa 5ml", code: "J-5", pedidos: 7, qty: 20, amount: 50000 },
    { productId: 105, name: "Gasas Estériles 10x10", code: "GE-10", pedidos: 6, qty: 15, amount: 45000 },
    { productId: 106, name: "Solución Fisiológica 500ml", code: "SF-500", pedidos: 5, qty: 12, amount: 54000 },
    { productId: 107, name: "Papel Camilla", code: "PC", pedidos: 4, qty: 8, amount: 24000 },
    { productId: 108, name: "Aguja 21G", code: "A-21", pedidos: 3, qty: 4, amount: 10000 },
    { productId: 109, name: "Bata descartable", code: "BD", pedidos: 3, qty: 2, amount: 14000 },
    { productId: 110, name: "Termómetro digital", code: "TD", pedidos: 2, qty: 0, amount: 0 },
  ],
};

/* ===== Helpers de PDF (encabezado, pie, proporciones) ================== */
function pdfConstants(doc) {
  return {
    w: doc.internal.pageSize.getWidth(),
    h: doc.internal.pageSize.getHeight(),
    marginX: 56,
    gutter: 16,
    rowTop: 96,
    chartH: 230,
    color: {
      primary: "#0b1a78",
      accent:  "#2563eb",
      muted:   "#6b7280",
      line:    "#e5e7eb",
      text:    "#111827",
    }
  };
}
function drawHeader(doc, PDF, titleLeft, titleRight) {
  doc.setFillColor(238,244,255);
  doc.rect(0, 0, PDF.w, 56, "F");
  doc.setTextColor(PDF.color.primary);
  doc.setFont(undefined, "bold"); doc.setFontSize(14);
  doc.text(titleLeft || "Informe mensual – Kazaro", PDF.marginX, 36);
  doc.setFont(undefined, "normal"); doc.setFontSize(11); doc.setTextColor("#374151");
  if (titleRight) doc.text(titleRight, PDF.w - PDF.marginX, 36, { align: "right" });
}
function drawFooter(doc, PDF, tag) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setDrawColor(PDF.color.line); doc.setLineWidth(0.5);
    doc.line(PDF.marginX, PDF.h - 32, PDF.w - PDF.marginX, PDF.h - 32);
    const ts = new Date().toLocaleString("es-AR");
    doc.setTextColor(PDF.color.muted); doc.setFontSize(9);
    doc.text(`Generado: ${ts}`, PDF.marginX, PDF.h - 16);
    doc.text(`${tag} — Página ${i} de ${n}`, PDF.w - PDF.marginX, PDF.h - 16, { align: "right" });
  }
}
// Coloca una imagen dentro de una caja conservando relación de aspecto
function placeImage(doc, imgData, box) {
  const props = doc.getImageProperties(imgData);
  const r = props.width / props.height;
  let w = box.w, h = w / r;
  if (h > box.h) { h = box.h; w = h * r; }
  const x = box.x + (box.w - w) / 2;
  const y = box.y + (box.h - h) / 2;
  doc.addImage(imgData, "PNG", x, y, w, h);
}

export default function Reports() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1..12

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);
  const [demo, setDemo] = useState(false);

  // Refs a gráficos para exportarlos como imagen al PDF
  const refServUnits = useRef(null);
  const refServAmount = useRef(null);
  const refProdUnits = useRef(null);
  const refProdAmount = useRef(null);

  const load = useCallback(async () => {
    if (demo) {
      setErr("");
      setData(demoData);
      return;
    }
    setLoading(true); setErr(""); setData(null);
    try {
      // catálogo de servicios + informe mensual en paralelo
      const [svcRes, repRes] = await Promise.all([
        api.get("/reports/services"),
        api.get("/reports/monthly", { params: { year, month } }),
      ]);
      const svcMap = new Map(
        Array.isArray(svcRes?.data) ? svcRes.data.map(r => [String(r.id), String(r.name || "").trim()]) : []
      );
      const rep = repRes.data || {};
      const top_services = (rep.top_services || []).map(r => {
        const idStr = String(r?.serviceId ?? "").trim();
        const nameFromApi = String(r?.serviceName ?? "").trim();
        const resolved = nameFromApi || (idStr && svcMap.get(idStr)) || (idStr ? `Servicio ${idStr}` : "—");
        return { ...r, serviceName: resolved };
      });
      setData({ ...rep, top_services });
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudo cargar el informe");
    } finally {
      setLoading(false);
    }
  }, [demo, year, month]);

  useEffect(() => { load(); /* auto-carga */ }, [load]);

  const title = useMemo(() => `${MONTHS_ES[month-1]} ${year}`, [month, year]);

  // ======= Helpers =======
  const fmtMoney = (v) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(v || 0);
  const short = (s) => (String(s ?? "")).length > 18 ? String(s).slice(0, 16) + "…" : String(s ?? "");
  const serviceLabel = (r) => {
    const name = String(r?.serviceName ?? "").trim();
    if (name) return name;
    const sid = r?.serviceId;
    return sid != null && String(sid).trim() !== "" ? `Servicio ${sid}` : "—";
  };

  const chartServices = useMemo(() => {
    if (!data?.top_services) return [];
    return data.top_services.map((r, i) => ({
      idx: i + 1,
      name: short(serviceLabel(r)),
      unidades: Number(r.qty || 0),
      monto: Number(r.amount || 0),
    }));
  }, [data]);

  const chartProducts = useMemo(() => {
    if (!data?.top_products) return [];
    return data.top_products.map((r, i) => ({
      idx: i + 1,
      name: short(r.name || `#${r.productId ?? "-"}`),
      unidades: Number(r.qty || 0),
      monto: Number(r.amount || 0),
    }));
  }, [data]);

  // Exportar CSV (cliente)
  function exportCSV() {
    if (!data?.ok) return;

    const esc = (v) => {
      const s = String(v ?? "");
      if (s.includes(",") || s.includes("\n") || s.includes('"')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    // Servicios
    const sRows = [
      ["rank","serviceId","serviceName","pedidos","unidades","monto"],
      ...(data.top_services || []).map((r, idx) => [
        idx+1, r.serviceId ?? "", serviceLabel(r), r.pedidos ?? 0, r.qty ?? 0, r.amount ?? 0
      ])
    ].map(arr => arr.map(esc).join(",")).join("\n");

    // Productos
    const pRows = [
      ["rank","productId","name","code","pedidos","unidades","monto"],
      ...(data.top_products || []).map((r, idx) => [
        idx+1, r.productId ?? "", r.name ?? "", r.code ?? "", r.pedidos ?? 0, r.qty ?? 0, r.amount ?? 0
      ])
    ].map(arr => arr.map(esc).join(",")).join("\n");

    const download = (filename, content) => {
      const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    };

    const tag = `${String(year)}-${String(month).padStart(2,"0")}`;
    download(`reporte_servicios_${tag}.csv`, sRows);
    download(`reporte_articulos_${tag}.csv`, pRows);
  }

  // Captura un nodo DOM a imagen PNG (alta resolución)
  async function captureNode(node) {
    if (!node) return null;
    const canvas = await html2canvas(node, { backgroundColor: "#ffffff", scale: 2, useCORS: true });
    return { img: canvas.toDataURL("image/png"), w: canvas.width, h: canvas.height };
  }

  // Exportar PDF PRO (encabezado/pie, 2 columnas, tablas cuidadas)
  async function exportPDF() {
    if (!data?.ok) {
      alert("No hay datos para exportar. Generá un informe primero.");
      return;
    }

    const tag = `${String(year)}-${String(month).padStart(2,"0")}`;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const PDF = pdfConstants(doc);

    // -------- Portada / Resumen ejecutivo
    drawHeader(doc, PDF, "Informe Mensual – Kazaro", `${MONTHS_ES[month-1]} ${year}`);

    doc.setTextColor(PDF.color.primary);
    doc.setFont(undefined, "bold"); doc.setFontSize(24);
    doc.text("Resumen ejecutivo", PDF.marginX, PDF.rowTop);

    // Tarjetas KPI
    const cardW = 200, cardH = 72, gap = 18;
    const baseY = PDF.rowTop + 20;
    const cards = [
      { label: "Pedidos",  value: String(data.totals?.ordersCount ?? 0) },
      { label: "Unidades", value: String(data.totals?.itemsCount ?? 0) },
      { label: "Monto",    value: new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS"}).format(data.totals?.amount ?? 0) },
    ];
    cards.forEach((c, i) => {
      const x = PDF.marginX + i * (cardW + gap);
      doc.setFillColor(255,255,255);
      doc.setDrawColor("#dbe7ff");
      doc.roundedRect(x, baseY, cardW, cardH, 8, 8, "FD");
      doc.setTextColor(PDF.color.muted); doc.setFontSize(11);
      doc.text(c.label, x + 12, baseY + 22);
      doc.setTextColor(PDF.color.text); doc.setFont(undefined, "bold"); doc.setFontSize(20);
      doc.text(c.value, x + 12, baseY + 48);
      doc.setFont(undefined, "normal");
    });

    doc.setTextColor("#374151"); doc.setFontSize(11);
    doc.text("Este informe consolida el desempeño del período y el ranking de servicios y artículos.", PDF.marginX, baseY + cardH + 30);

    // -------- Capturas de gráficos
    const [capServU, capServM, capProdU, capProdM] = await Promise.all([
      captureNode(refServUnits.current),
      captureNode(refServAmount.current),
      captureNode(refProdUnits.current),
      captureNode(refProdAmount.current),
    ]);

    // -------- Página: Gráficos de servicios (2 por página)
    doc.addPage();
    drawHeader(doc, PDF, "Servicios — Indicadores", `${MONTHS_ES[month-1]} ${year}`);
    doc.setTextColor(PDF.color.primary); doc.setFont(undefined, "bold"); doc.setFontSize(14);

    const colW = (PDF.w - PDF.marginX*2 - PDF.gutter) / 2;
    const box1 = { x: PDF.marginX,                 y: PDF.rowTop, w: colW, h: PDF.chartH };
    const box2 = { x: PDF.marginX + colW + PDF.gutter, y: PDF.rowTop, w: colW, h: PDF.chartH };
    doc.text("Top 10 servicios por unidades", box1.x, box1.y - 10);
    doc.text("Top 10 servicios por monto",    box2.x, box2.y - 10);
    if (capServU) placeImage(doc, capServU.img, box1);
    if (capServM) placeImage(doc, capServM.img, box2);

    // -------- Página: Gráficos de artículos (2 por página)
    doc.addPage();
    drawHeader(doc, PDF, "Artículos — Indicadores", `${MONTHS_ES[month-1]} ${year}`);
    const box3 = { x: PDF.marginX,                 y: PDF.rowTop, w: colW, h: PDF.chartH };
    const box4 = { x: PDF.marginX + colW + PDF.gutter, y: PDF.rowTop, w: colW, h: PDF.chartH };
    doc.text("Top 10 artículos por unidades", box3.x, box3.y - 10);
    doc.text("Top 10 artículos por monto",    box4.x, box4.y - 10);
    if (capProdU) placeImage(doc, capProdU.img, box3);
    if (capProdM) placeImage(doc, capProdM.img, box4);

    // -------- Tablas (Servicios)
    if (data.top_services?.length) {
      doc.addPage();
      drawHeader(doc, PDF, "Detalle — Servicios", `${MONTHS_ES[month-1]} ${year}`);
      autoTable(doc, {
        head: [["#", "Servicio", "Pedidos", "Unidades", "Monto"]],
        body: data.top_services.map((r, idx) => [
          idx + 1,
          (r.serviceName || `Servicio ${r.serviceId ?? "-"}`),
          r.pedidos ?? 0,
          r.qty ?? 0,
          new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS"}).format(r.amount || 0),
        ]),
        startY: PDF.rowTop,
        margin: { left: PDF.marginX, right: PDF.marginX },
        theme: "grid",
        styles: {
          fontSize: 10,
          cellPadding: 6,
          lineColor: [229,231,235],
          lineWidth: 0.6,
        },
        headStyles: {
          fillColor: [238,244,255],
          textColor: [11,26,120],
          fontStyle: "bold",
          halign: "center",
        },
        columnStyles: {
          0: { cellWidth: 32,  halign: "center" },
          1: { cellWidth: "auto" },
          2: { cellWidth: 80,  halign: "right" },
          3: { cellWidth: 80,  halign: "right" },
          4: { cellWidth: 100, halign: "right" },
        },
        alternateRowStyles: { fillColor: [250,252,255] },
        didParseCell: (c) => {
          if (c.section === "body" && c.column.index === 1) c.cell.styles.fontStyle = "bold";
        },
      });
    }

    // -------- Tablas (Artículos)
    if (data.top_products?.length) {
      doc.addPage();
      drawHeader(doc, PDF, "Detalle — Artículos", `${MONTHS_ES[month-1]} ${year}`);
      autoTable(doc, {
        head: [["#", "Artículo", "Código", "Pedidos", "Unidades", "Monto"]],
        body: data.top_products.map((r, idx) => [
          idx + 1,
          r.name || `#${r.productId ?? "-"}`,
          r.code || "",
          r.pedidos ?? 0,
          r.qty ?? 0,
          new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS"}).format(r.amount || 0),
        ]),
        startY: PDF.rowTop,
        margin: { left: PDF.marginX, right: PDF.marginX },
        theme: "grid",
        styles: {
          fontSize: 10,
          cellPadding: 6,
          lineColor: [229,231,235],
          lineWidth: 0.6,
        },
        headStyles: {
          fillColor: [238,244,255],
          textColor: [11,26,120],
          fontStyle: "bold",
          halign: "center",
        },
        columnStyles: {
          0: { cellWidth: 32,  halign: "center" },
          1: { cellWidth: "auto" },
          2: { cellWidth: 90,  halign: "left" },
          3: { cellWidth: 80,  halign: "right" },
          4: { cellWidth: 80,  halign: "right" },
          5: { cellWidth: 100, halign: "right" },
        },
        alternateRowStyles: { fillColor: [250,252,255] },
      });
    }

    // -------- Pie con numeración/fecha
    drawFooter(doc, PDF, `${MONTHS_ES[month-1]} ${year}`);

    doc.save(`Informe_Mensual_${tag}.pdf`);
  }

  const onToggleDemo = () => setDemo(d => !d);

  return (
    <div className="catalog reports-scope">
      <h2>Informes mensuales</h2>

      <div className="catalog-toolbar reports-toolbar">
        <label>Mes</label>
        <select className="select" value={month} onChange={e => setMonth(Number(e.target.value))}>
          {MONTHS_ES.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
        </select>

        <label>Año</label>
        <select className="select" value={year} onChange={e => setYear(Number(e.target.value))}>
          {yRange().map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        <button className="btn" onClick={load} disabled={loading}>
          {loading ? "Generando…" : "Generar informe"}
        </button>

        <div className="reports-actions">
          <button className="pill pill--primary" onClick={exportCSV} disabled={!data?.ok}>
            Exportar CSV
          </button>
          <button className="pill pill--primary" onClick={exportPDF} disabled={!data?.ok}>
            Exportar PDF (gráficos)
          </button>
          <button
            className={`pill ${demo ? "pill--danger" : "pill--secondary"}`}
            onClick={onToggleDemo}
          >
            {demo ? "Salir de Demo" : "Ver Demo"}
          </button>
        </div>
      </div>

      {err && <div className="state error" role="alert">{err}</div>}

      {data && data.ok && (
        <>
          <section className="state reports-summary">
            <strong>Período:</strong> {title} &nbsp;•&nbsp; 
            <strong>Pedidos:</strong> {data.totals?.ordersCount ?? 0} &nbsp;•&nbsp; 
            <strong>Unidades:</strong> {data.totals?.itemsCount ?? 0} &nbsp;•&nbsp;
            <strong>Monto:</strong> {fmtMoney(data.totals?.amount ?? 0)}
          </section>

          <div className="reports-grid">
            {/* Top Servicios */}
            <div>
              <h3>Top 10 servicios por unidades</h3>

              {/* Tabla */}
              {(!data.top_services || data.top_services.length === 0) ? (
                <div className="state">Sin datos en el período.</div>
              ) : (
                <table className="sup-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Servicio</th>
                      <th style={{ width: 110 }}>Pedidos</th>
                      <th style={{ width: 110 }}>Unidades</th>
                      <th style={{ width: 140 }}>Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_services.map((r, idx) => (
                      <tr key={r.serviceId ?? idx}>
                        <td>{idx+1}</td>
                        <td>
                          <div
                            title={serviceLabel(r)}
                            style={{
                              maxWidth: "min(28vw, 260px)",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              display: "block",
                              fontWeight: 600
                            }}
                          >
                            {serviceLabel(r)}
                          </div>
                        </td>
                        <td className="mono">{r.pedidos}</td>
                        <td className="mono">{r.qty}</td>
                        <td className="mono">{fmtMoney(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Gráfico Unidades */}
              <div className="chart-card" ref={refServUnits}>
                <div className="chart-title">Unidades por servicio</div>
                <div className="chart-box">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={chartServices} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip formatter={(v, name) => name === "monto" ? fmtMoney(v) : v} />
                      <Legend />
                      <Bar dataKey="unidades" name="Unidades" fill="#1971B8" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Gráfico Monto */}
              <div className="chart-card" ref={refServAmount}>
                <div className="chart-title">Monto por servicio</div>
                <div className="chart-box">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={chartServices} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip formatter={(v) => fmtMoney(v)} />
                      <Legend />
                      <Bar dataKey="monto" name="Monto" fill="#69AEE3" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Top Productos */}
            <div>
              <h3>Top 10 artículos por unidades</h3>

              {/* Tabla */}
              {(!data.top_products || data.top_products.length === 0) ? (
                <div className="state">Sin datos en el período.</div>
              ) : (
                <table className="sup-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Artículo</th>
                      <th style={{ width: 110 }}>Pedidos</th>
                      <th style={{ width: 110 }}>Unidades</th>
                      <th style={{ width: 140 }}>Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_products.map((r, idx) => (
                      <tr key={r.productId ?? idx}>
                        <td>{idx+1}</td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{r.name}</div>
                          {r.code ? <div style={{ fontSize: 12, opacity: .7 }}>Código: {r.code}</div> : null}
                        </td>
                        <td className="mono">{r.pedidos}</td>
                        <td className="mono">{r.qty}</td>
                        <td className="mono">{fmtMoney(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Gráfico Unidades */}
              <div className="chart-card" ref={refProdUnits}>
                <div className="chart-title">Unidades por artículo</div>
                <div className="chart-box">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={chartProducts} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip formatter={(v, name) => name === "monto" ? fmtMoney(v) : v} />
                      <Legend />
                      <Bar dataKey="unidades" name="Unidades" fill="#1971B8" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Gráfico Monto */}
              <div className="chart-card" ref={refProdAmount}>
                <div className="chart-title">Monto por artículo</div>
                <div className="chart-box">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={chartProducts} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip formatter={(v) => fmtMoney(v)} />
                      <Legend />
                      <Bar dataKey="monto" name="Monto" fill="#69AEE3" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
