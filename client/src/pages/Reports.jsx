// client/src/pages/Reports.jsx
import { useEffect, useMemo, useRef, useState } from "react";
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
const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

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

  async function load() {
    if (demo) {
      setErr("");
      setData(demoData);
      return;
    }
    setLoading(true); setErr(""); setData(null);
    try {
      const { data } = await api.get("/admin/reports/monthly", { params: { year, month } });
      setData(data);
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudo cargar el informe");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* auto-carga */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  const title = useMemo(() => `${MONTHS_ES[month-1]} ${year}`, [month, year]);

  // ======= Helpers =======
  const fmtMoney = (v) => new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS"}).format(v || 0);
  const short = (s) => (String(s ?? "")).length > 18 ? String(s).slice(0, 16)+"…" : String(s ?? "");

  const chartServices = useMemo(() => {
    if (!data?.top_services) return [];
    return data.top_services.map((r, i) => ({
      idx: i + 1,
      name: short(r.serviceName || `Servicio ${r.serviceId ?? "-"}`),
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
        idx+1, r.serviceId ?? "", r.serviceName ?? "", r.pedidos ?? 0, r.qty ?? 0, r.amount ?? 0
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

  // Captura un nodo DOM a imagen PNG usando html2canvas
  async function captureNode(node, { width = 760, height = 360 } = {}) {
    if (!node) return null;
    const canvas = await html2canvas(node, { backgroundColor: "#ffffff", scale: 2, useCORS: true });
    const img = canvas.toDataURL("image/png");
    // devolvemos tamaño sugerido en puntos (jsPDF usa pt)
    return { img, width, height };
  }

  // Exportar PDF con portada + gráficos + tablas
  async function exportPDF() {
    if (!data?.ok) {
      alert("No hay datos para exportar. Generá un informe primero.");
      return;
    }

    const tag = `${String(year)}-${String(month).padStart(2,"0")}`;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" }); // 842x595 pt aprox

    // Portada
    doc.setFillColor(255,255,255);
    doc.rect(0, 0, doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight(), "F");

    doc.setTextColor("#0b1a78");
    doc.setFontSize(26);
    doc.setFont(undefined, "bold");
    doc.text("Informe Mensual – Kazaro", 60, 80);

    doc.setTextColor("#124f7e");
    doc.setFontSize(16);
    doc.setFont(undefined, "normal");
    doc.text(`${MONTHS_ES[month-1]} ${year}`, 60, 110);

    // Tarjetas simples
    doc.setTextColor("#6b7280");
    doc.setFontSize(11);
    doc.text("Pedidos", 60, 160);
    doc.text("Unidades", 260, 160);
    doc.text("Monto", 460, 160);

    doc.setTextColor("#111827");
    doc.setFont(undefined, "bold");
    doc.setFontSize(24);
    doc.text(String(data.totals?.ordersCount ?? 0), 60, 190);
    doc.text(String(data.totals?.itemsCount ?? 0), 260, 190);
    doc.text(new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS"}).format(data.totals?.amount ?? 0), 460, 190);

    doc.setTextColor("#0b1a78");
    doc.setFontSize(13);
    doc.setFont(undefined, "bold");
    doc.text("Detalle del período", 60, 240);
    doc.setFontSize(11);
    doc.setFont(undefined, "normal");
    doc.text("• Top 10 servicios por unidades y monto", 60, 264);
    doc.text("• Top 10 artículos por unidades y monto", 60, 284);

    // Página: Unidades por servicio (gráfico)
    const servUnitsCap = await captureNode(refServUnits.current);
    if (servUnitsCap) {
      doc.addPage();
      doc.setFontSize(16);
      doc.setTextColor("#0b1a78");
      doc.setFont(undefined, "bold");
      doc.text("Top 10 servicios por unidades", 60, 60);
      doc.addImage(servUnitsCap.img, "PNG", 60, 80, 720, 320);
    }

    // Página: Monto por servicio (gráfico)
    const servAmountCap = await captureNode(refServAmount.current);
    if (servAmountCap) {
      doc.addPage();
      doc.setFontSize(16);
      doc.setTextColor("#0b1a78");
      doc.setFont(undefined, "bold");
      doc.text("Top 10 servicios por monto", 60, 60);
      doc.addImage(servAmountCap.img, "PNG", 60, 80, 720, 320);
    }

    // Página: Unidades por artículo (gráfico)
    const prodUnitsCap = await captureNode(refProdUnits.current);
    if (prodUnitsCap) {
      doc.addPage();
      doc.setFontSize(16);
      doc.setTextColor("#0b1a78");
      doc.setFont(undefined, "bold");
      doc.text("Top 10 artículos por unidades", 60, 60);
      doc.addImage(prodUnitsCap.img, "PNG", 60, 80, 720, 320);
    }

    // Página: Monto por artículo (gráfico)
    const prodAmountCap = await captureNode(refProdAmount.current);
    if (prodAmountCap) {
      doc.addPage();
      doc.setFontSize(16);
      doc.setTextColor("#0b1a78");
      doc.setFont(undefined, "bold");
      doc.text("Top 10 artículos por monto", 60, 60);
      doc.addImage(prodAmountCap.img, "PNG", 60, 80, 720, 320);
    }

    // Tablas (servicios)
    if (data.top_services?.length) {
      doc.addPage();
      autoTable(doc, {
        head: [["#", "Servicio", "Pedidos", "Unidades", "Monto"]],
        body: data.top_services.map((r, idx) => [
          idx + 1,
          r.serviceName || `Servicio ${r.serviceId ?? "-"}`,
          r.pedidos ?? 0,
          r.qty ?? 0,
          new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS"}).format(r.amount || 0),
        ]),
        startY: 60,
        styles: { fontSize: 10, cellPadding: 6 },
        headStyles: { fillColor: [238,244,255], textColor: [11,26,120], fontStyle: "bold" },
        theme: "grid",
        margin: { left: 60, right: 60 },
      });
    }

    // Tablas (artículos)
    if (data.top_products?.length) {
      doc.addPage();
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
        startY: 60,
        styles: { fontSize: 10, cellPadding: 6 },
        headStyles: { fillColor: [238,244,255], textColor: [11,26,120], fontStyle: "bold" },
        theme: "grid",
        margin: { left: 60, right: 60 },
      });
    }

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
                        <td>{r.serviceName || `Servicio ${r.serviceId ?? "-"}`}</td>
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
