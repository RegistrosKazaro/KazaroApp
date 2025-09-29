// client/src/pages/Reports.jsx
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import "../styles/catalog.css";
import "../styles/reports.css";

function yRange() {
  const y = new Date().getFullYear();
  const arr = [];
  for (let k = y; k >= y - 5; k--) arr.push(k);
  return arr;
}
const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

export default function Reports() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1..12

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);

  async function load() {
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

  useEffect(() => {
    load(); // auto-carga del mes actual
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = useMemo(() => `${MONTHS_ES[month-1]} ${year}`, [month, year]);

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
      </div>

      {err && <div className="state error" role="alert">{err}</div>}

      {data && data.ok && (
        <>
          <section className="state reports-summary">
            <strong>Período:</strong> {title} &nbsp;•&nbsp; 
            <strong>Pedidos:</strong> {data.totals?.ordersCount ?? 0} &nbsp;•&nbsp; 
            <strong>Unidades:</strong> {data.totals?.itemsCount ?? 0} &nbsp;•&nbsp;
            <strong>Monto:</strong> {new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS"}).format(data.totals?.amount ?? 0)}
          </section>

          <div className="reports-grid">
            {/* Top Servicios */}
            <div>
              <h3>Top 10 servicios por unidades</h3>
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
                        <td className="mono">
                          {new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS"}).format(r.amount || 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Top Productos */}
            <div>
              <h3>Top 10 artículos por unidades</h3>
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
                        <td className="mono">
                          {new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS"}).format(r.amount || 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
