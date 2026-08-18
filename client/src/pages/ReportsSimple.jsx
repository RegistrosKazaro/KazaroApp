// client/src/pages/ReportsSimple.jsx
// Pantalla de informes simplificada: 4 solapas en vez de 9 + 6 sub-solapas, sin
// gráficos ni tablas repetidas. Usa los mismos endpoints ya verificados
// (/reports/monthly, /yearly, /service/:id), así que los números son los mismos.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { formatMoney, formatNumber, csvNumber } from "../utils/format";
import "../styles/reports-simple.css";

const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const HOY = new Date();

/* ── Piezas visuales ───────────────────────────────────────────── */

function Kpi({ label, value, prev, formato = formatNumber, ayuda }) {
  const actual = Number(value || 0);
  const anterior = Number(prev ?? NaN);
  let variacion = null;
  if (Number.isFinite(anterior) && anterior > 0) {
    const pct = ((actual - anterior) / anterior) * 100;
    variacion = { pct, sube: pct > 0.5, baja: pct < -0.5 };
  }
  return (
    <div className="rs-kpi">
      <div className="rs-kpi-label" title={ayuda}>{label}</div>
      <div className="rs-kpi-value">{formato(actual)}</div>
      {variacion ? (
        <div className={`rs-kpi-delta ${variacion.sube ? "is-up" : variacion.baja ? "is-down" : "is-flat"}`}>
          {variacion.sube ? "▲" : variacion.baja ? "▼" : "="} {Math.abs(variacion.pct).toFixed(0)}% vs mes anterior
        </div>
      ) : (
        <div className="rs-kpi-delta is-flat">sin dato del mes anterior</div>
      )}
    </div>
  );
}

/** Barras verticales por día. Una sola implementación para todo el informe. */
function BarrasPorDia({ datos, campo = "pedidos", formato = formatNumber }) {
  if (!datos?.length) return <p className="rs-vacio">Sin movimientos en el período.</p>;
  const max = Math.max(...datos.map((d) => Number(d[campo] || 0)), 1);
  return (
    <div className="rs-bars" role="img" aria-label={`Gráfico por día: ${campo}`}>
      {datos.map((d) => {
        const v = Number(d[campo] || 0);
        const dia = String(d.day || "").slice(8, 10);
        return (
          <div key={d.day} className="rs-bar-col" title={`${d.day}: ${formato(v)}`}>
            <div className="rs-bar" style={{ height: `${Math.max(3, (v / max) * 100)}%` }} />
            <span className="rs-bar-lbl">{dia}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Ranking horizontal reutilizable (insumos, servicios). */
function Ranking({ filas, etiqueta, valor, formato = formatNumber, vacio = "Sin datos." }) {
  if (!filas?.length) return <p className="rs-vacio">{vacio}</p>;
  const max = Math.max(...filas.map((f) => Number(valor(f) || 0)), 1);
  const total = filas.reduce((a, f) => a + Number(valor(f) || 0), 0) || 1;
  return (
    <div className="rs-rank">
      {filas.map((f, i) => {
        const v = Number(valor(f) || 0);
        return (
          <div key={i} className="rs-rank-row">
            <span className="rs-rank-name" title={etiqueta(f)}>{etiqueta(f)}</span>
            <span className="rs-rank-track"><span className="rs-rank-fill" style={{ width: `${(v / max) * 100}%` }} /></span>
            <span className="rs-rank-val">{formato(v)}</span>
            <span className="rs-rank-pct">{((v / total) * 100).toFixed(0)}%</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Pantalla ──────────────────────────────────────────────────── */

export default function ReportsSimple() {
  const [year, setYear] = useState(HOY.getFullYear());
  const [month, setMonth] = useState(HOY.getMonth() + 1);
  const [tab, setTab] = useState("resumen");
  // Insumos y Uniformes son informes separados: nunca se mezclan sus números.
  const [modo, setModo] = useState("insumos");

  const [data, setData] = useState(null);
  const [anual, setAnual] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const [q, setQ] = useState("");
  const [servicioAbierto, setServicioAbierto] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [detalleCargando, setDetalleCargando] = useState(false);

  const mesAnterior = useCallback(() => {
    let m = month - 1, y = year;
    if (m <= 0) { m = 12; y -= 1; }
    return { year: y, month: m };
  }, [year, month]);

  const cargar = useCallback(async () => {
    setCargando(true); setError("");
    try {
      if (modo === "insumos") {
        const { data: m } = await api.get("/reports/monthly", { params: { year, month } });
        setData(m);
      } else {
        // Uniformes: informe propio por categoría. Se pide también el mes
        // anterior para poder mostrar la variación en los KPIs.
        const prevQ = mesAnterior();
        const [act, ant] = await Promise.all([
          api.get("/reports/category/by-name/Uniformes", { params: { year, month } }),
          api.get("/reports/category/by-name/Uniformes", { params: prevQ }).catch(() => null),
        ]);
        setData({
          ...act.data,
          top_services: act.data?.by_service || [],
          prev_totals: ant?.data?.totals || null,
        });
      }
    } catch (e) {
      const msg = e?.response?.status === 404 && modo === "uniformes"
        ? "No hay una categoría “Uniformes” cargada en esta empresa."
        : (e?.response?.data?.error || "No se pudieron cargar los informes");
      setError(msg);
      setData(null);
    } finally { setCargando(false); }
  }, [year, month, modo, mesAnterior]);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    if (tab !== "evolucion") return;
    let vivo = true;
    api.get("/reports/yearly", { params: { year } })
      .then(({ data: y }) => { if (vivo) setAnual(y); })
      .catch(() => { if (vivo) setAnual(null); });
    return () => { vivo = false; };
  }, [tab, year]);

  const abrirServicio = async (sid) => {
    if (servicioAbierto === sid) { setServicioAbierto(null); setDetalle(null); return; }
    setServicioAbierto(sid); setDetalle(null); setDetalleCargando(true);
    try {
      const { data: d } = await api.get(`/reports/service/${sid}`, { params: { year, month } });
      setDetalle(d);
    } catch { setDetalle(null); }
    finally { setDetalleCargando(false); }
  };

  const totals = data?.totals || {};
  const prev = data?.prev_totals || {};
  // useMemo para que las listas no cambien de identidad en cada render.
  const productos = useMemo(() => data?.top_products || [], [data]);
  const servicios = useMemo(() => data?.top_services || [], [data]);
  const porDia = useMemo(() => data?.by_day || [], [data]);

  const productosFiltrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return productos;
    return productos.filter((p) =>
      String(p.name || "").toLowerCase().includes(t) || String(p.code || "").toLowerCase().includes(t));
  }, [productos, q]);

  const nombreServicio = (s) =>
    s.serviceId == null ? "Sin servicio (pedidos administrativos)" : (s.serviceName || `Servicio ${s.serviceId}`);

  const exportar = () => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const filas = [["Seccion","Detalle","Pedidos","Unidades","Monto"].map(esc).join(";")];
    filas.push([esc("Total"), esc(`${MESES[month-1]} ${year}`), csvNumber(totals.ordersCount), csvNumber(totals.itemsCount), csvNumber(totals.amount)].join(";"));
    const etiqueta = modo === "uniformes" ? "Uniforme" : "Insumo";
    for (const p of productos) filas.push([esc(etiqueta), esc(p.name), csvNumber(p.pedidos), csvNumber(p.qty), csvNumber(p.amount)].join(";"));
    for (const s of servicios) filas.push([esc("Servicio"), esc(nombreServicio(s)), csvNumber(s.pedidos), csvNumber(s.qty), csvNumber(s.amount)].join(";"));
    const blob = new Blob(["﻿" + filas.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `informe_${modo}_${year}-${String(month).padStart(2,"0")}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  // El anual sólo existe para el informe general; Uniformes no tiene endpoint anual.
  const TABS = [
    ["resumen", "Resumen"],
    ["insumos", modo === "uniformes" ? "Artículos" : "Insumos"],
    ["servicios", "Servicios"],
    ...(modo === "insumos" ? [["evolucion", "Evolución"]] : []),
  ];

  return (
    <div className="reports-page rs-page">
      {/* Encabezado */}
      <header className="rs-header">
        <div>
          <h1 className="rs-title">Informes</h1>
          <p className="rs-sub">
            {modo === "insumos" ? "Insumos" : "Uniformes"} · {MESES[month - 1]} de {year}
          </p>
          {/* Insumos y Uniformes son informes separados: sus números nunca se suman. */}
          <div className="rs-modos" role="tablist" aria-label="Tipo de informe">
            {[["insumos", "Insumos"], ["uniformes", "Uniformes"]].map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={modo === k}
                className={`rs-modo${modo === k ? " is-active" : ""}`}
                onClick={() => { setModo(k); setTab("resumen"); }}>{l}</button>
            ))}
          </div>
        </div>
        <div className="rs-controls">
          <label className="rs-field">
            <span>Mes</span>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </label>
          <label className="rs-field">
            <span>Año</span>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {Array.from({ length: 5 }, (_, i) => HOY.getFullYear() - i).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <button type="button" className="rs-btn" onClick={exportar} disabled={!data}>Exportar CSV</button>
        </div>
      </header>

      {error && <div className="state error">{error}</div>}
      {cargando && <div className="rs-vacio">Cargando informe…</div>}

      {!cargando && data && (
        <>
          {/* KPIs */}
          <section className="rs-kpis" aria-label="Totales del mes">
            <Kpi label="Pedidos" value={totals.ordersCount} prev={prev.ordersCount} />
            <Kpi label="Unidades entregadas" value={totals.itemsCount} prev={prev.itemsCount}
              ayuda="Cantidad de insumos, ya descontadas las devoluciones aprobadas" />
            <Kpi label="Monto" value={totals.amount} prev={prev.amount} formato={formatMoney}
              ayuda="Neto de devoluciones aprobadas" />
          </section>

          {/* Solapas */}
          <nav className="rs-tabs" aria-label="Secciones del informe">
            {TABS.map(([k, l]) => (
              <button key={k} type="button" className={`rs-tab${tab === k ? " is-active" : ""}`}
                onClick={() => setTab(k)} aria-current={tab === k}>{l}</button>
            ))}
          </nav>

          {tab === "resumen" && (
            <section className="rs-grid">
              <div className="rs-card rs-card--wide">
                <h2 className="rs-card-title">Pedidos por día</h2>
                <BarrasPorDia datos={porDia} campo="pedidos" />
              </div>
              <div className="rs-card">
                <h2 className="rs-card-title">{modo === "uniformes" ? "Artículos más pedidos" : "Insumos más pedidos"}</h2>
                <Ranking filas={productos.slice(0, 5)} etiqueta={(p) => p.name} valor={(p) => p.qty}
                  vacio="Sin insumos en el período." />
              </div>
              <div className="rs-card">
                <h2 className="rs-card-title">Servicios que más piden</h2>
                <Ranking filas={servicios.slice(0, 5)} etiqueta={nombreServicio} valor={(s) => s.amount}
                  formato={formatMoney} vacio="Sin servicios en el período." />
              </div>
            </section>
          )}

          {tab === "insumos" && (
            <section className="rs-card">
              <div className="rs-card-head">
                <h2 className="rs-card-title">{modo === "uniformes" ? "Artículos de uniformes" : "Insumos del mes"}</h2>
                <input type="search" className="rs-search" placeholder="Buscar por nombre o código…"
                  value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              {productosFiltrados.length === 0 ? (
                <p className="rs-vacio">No hay insumos que coincidan.</p>
              ) : (
                <div className="rs-table-wrap">
                  <table className="rs-table">
                    <thead>
                      <tr>
                        <th>Código</th><th>Insumo</th>
                        <th className="num">Pedidos</th><th className="num">Unidades</th><th className="num">Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productosFiltrados.map((p) => (
                        <tr key={p.productId}>
                          <td className="mono">{p.code || "—"}</td>
                          <td>{p.name}</td>
                          <td className="num">{formatNumber(p.pedidos)}</td>
                          <td className="num">{formatNumber(p.qty)}</td>
                          <td className="num">{formatMoney(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {tab === "servicios" && (
            <section className="rs-card">
              <h2 className="rs-card-title">Servicios del mes</h2>
              <p className="rs-nota">
                Los pedidos administrativos no tienen servicio asignado: aparecen agrupados como
                “Sin servicio”. Tocá un servicio para ver su detalle.
              </p>
              {servicios.length === 0 ? <p className="rs-vacio">Sin datos en el período.</p> : (
                <div className="rs-table-wrap">
                  <table className="rs-table">
                    <thead>
                      <tr><th>Servicio</th><th className="num">Pedidos</th><th className="num">Unidades</th><th className="num">Monto</th></tr>
                    </thead>
                    <tbody>
                      {servicios.map((s) => (
                        <tr key={String(s.serviceId)}
                          className={s.serviceId != null ? "rs-row-click" : ""}
                          onClick={() => s.serviceId != null && abrirServicio(s.serviceId)}>
                          <td>
                            {nombreServicio(s)}
                            {servicioAbierto === s.serviceId && (
                              <div className="rs-detalle">
                                {detalleCargando && <span className="rs-vacio">Cargando detalle…</span>}
                                {detalle && (
                                  <>
                                    <strong>Insumos de este servicio</strong>
                                    <Ranking filas={(detalle.top_products || []).slice(0, 6)}
                                      etiqueta={(p) => p.name} valor={(p) => p.qty}
                                      vacio="Sin insumos." />
                                  </>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="num">{formatNumber(s.pedidos)}</td>
                          <td className="num">{formatNumber(s.qty)}</td>
                          <td className="num">{formatMoney(s.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {tab === "evolucion" && (
            <section className="rs-card">
              <h2 className="rs-card-title">Evolución de {year}</h2>
              {!anual ? <p className="rs-vacio">Cargando…</p> : (
                <>
                  <div className="rs-months">
                    {(anual.months || []).map((m) => {
                      const max = Math.max(...(anual.months || []).map((x) => Number(x.amount || 0)), 1);
                      return (
                        <div key={m.month} className="rs-month" title={`${MESES[m.month-1]}: ${formatMoney(m.amount)} — ${m.ordersCount} pedidos`}>
                          <div className="rs-month-bar" style={{ height: `${Math.max(2, (Number(m.amount || 0) / max) * 100)}%` }} />
                          <span className="rs-month-lbl">{MESES[m.month - 1].slice(0, 3)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="rs-table-wrap" style={{ marginTop: 14 }}>
                    <table className="rs-table">
                      <thead><tr><th>Mes</th><th className="num">Pedidos</th><th className="num">Unidades</th><th className="num">Monto</th></tr></thead>
                      <tbody>
                        {(anual.months || []).map((m) => (
                          <tr key={m.month}>
                            <td>{MESES[m.month - 1]}</td>
                            <td className="num">{formatNumber(m.ordersCount)}</td>
                            <td className="num">{formatNumber(m.itemsCount)}</td>
                            <td className="num">{formatMoney(m.amount)}</td>
                          </tr>
                        ))}
                        <tr className="rs-total-row">
                          <td>Total {year}</td>
                          <td className="num">{formatNumber(anual.totals?.ordersCount)}</td>
                          <td className="num">{formatNumber(anual.totals?.itemsCount)}</td>
                          <td className="num">{formatMoney(anual.totals?.amount)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          )}

          <p className="rs-pie">
            {modo === "insumos"
              ? "Este informe cuenta sólo insumos: los artículos de Uniformes se informan aparte, en su propia solapa. Si un pedido tiene de los dos, cada parte va a su informe."
              : "Este informe cuenta sólo los artículos de la categoría Uniformes. El resto de los insumos se informa en la solapa Insumos."}
            {" "}Los montos y cantidades son netos de devoluciones aprobadas, y se cuentan los pedidos
            confirmados (los administrativos al crearse; los de supervisor al marcarse retirados).
            {" "}<Link to="completo" className="rs-link">Ver el informe completo</Link>
          </p>
        </>
      )}
    </div>
  );
}
