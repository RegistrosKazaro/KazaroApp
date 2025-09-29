// client/src/pages/Reports.jsx
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import "../styles/catalog.css";
import "../styles/reports.css";

// Recharts (asegurate de tenerlo instalado: npm i recharts)
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

  // Modo demo
  const [demo, setDemo] = useState(false);

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

  useEffect(() => { load(); /* auto-carga del mes actual */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  const title = useMemo(() => `${MONTHS_ES[month-1]} ${year}`, [month, year]);

  // ======= Helpers =======
  const fmtMoney = (v) => new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS"}).format(v || 0);
  const short = (s) => (String(s ?? "")).length > 18 ? String(s).slice(0, 16)+"…" : String(s ?? "");

  // Datos para gráficos
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

    // Descargas
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

  // Imprimir / Guardar en PDF
  function printReport() {
    window.print();
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
          <button className="pill pill--primary" onClick={printReport} disabled={!data?.ok}>
            Imprimir / PDF
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

              {/* Gráfico */}
              {chartServices.length > 0 && (
                <div className="chart-card">
                  <div className="chart-title">Unidades por servicio</div>
                  <div className="chart-box">
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={chartServices} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip formatter={(v, name) => name === "monto" ? fmtMoney(v) : v} />
                        <Legend />
                        <Bar dataKey="unidades" name="Unidades" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {chartServices.length > 0 && (
                <div className="chart-card">
                  <div className="chart-title">Monto por servicio</div>
                  <div className="chart-box">
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={chartServices} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip formatter={(v) => fmtMoney(v)} />
                        <Legend />
                        <Bar dataKey="monto" name="Monto" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
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

              {/* Gráficos */}
              {chartProducts.length > 0 && (
                <div className="chart-card">
                  <div className="chart-title">Unidades por artículo</div>
                  <div className="chart-box">
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={chartProducts} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip formatter={(v, name) => name === "monto" ? fmtMoney(v) : v} />
                        <Legend />
                        <Bar dataKey="unidades" name="Unidades" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {chartProducts.length > 0 && (
                <div className="chart-card">
                  <div className="chart-title">Monto por artículo</div>
                  <div className="chart-box">
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={chartProducts} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip formatter={(v) => fmtMoney(v)} />
                        <Legend />
                        <Bar dataKey="monto" name="Monto" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
