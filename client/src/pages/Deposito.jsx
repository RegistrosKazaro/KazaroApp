// client/src/pages/Deposito.jsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { api } from "../api/client";
import "../styles/deposito.css";

/* ========= Utilidades ========= */
function isoToday() { return new Date().toISOString().slice(0, 10); }
function isoFirstOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function isoNDaysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function isoFirstOfYear() {
  return new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
}
function fmt(n) { return new Intl.NumberFormat("es-AR").format(Number(n || 0)); }

function sortByField(rows, field, dir, getExtraValue) {
  const mul = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const aVal = getExtraValue ? getExtraValue(a, field) : a[field];
    const bVal = getExtraValue ? getExtraValue(b, field) : b[field];
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    if (typeof aVal === "string" && typeof bVal === "string") return aVal.localeCompare(bVal) * mul;
    const na = Number(aVal), nb = Number(bVal);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return (na - nb) * mul;
    return 0;
  });
}

function calcCoverageDays(stockActual, consumosRow) {
  const stock = Number(stockActual || 0);
  const consumido = Number(consumosRow?.consumido || 0);
  const lastIng = consumosRow?.last_ingreso;
  if (!lastIng || !consumido || consumido <= 0 || stock <= 0) return null;
  const lastDate = new Date(lastIng);
  if (Number.isNaN(lastDate.getTime())) return null;
  const diffDays = Math.max(1, (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
  const avgPerDay = consumido / diffDays;
  if (avgPerDay <= 0) return null;
  const coverage = stock / avgPerDay;
  return Number.isFinite(coverage) && coverage > 0 ? coverage : null;
}

/* ========= Mini Charts (sin dependencias) ========= */

/** Gráfico de barras horizontales para top consumidos */
function MiniBarChart({ data, maxItems = 8 }) {
  const items = (data || []).slice(0, maxItems);
  if (!items.length) return <p style={{ color: "#9ca3af", fontSize: "0.8rem" }}>Sin datos</p>;
  const maxVal = Math.max(...items.map(d => Number(d.total || 0)), 1);
  const COLORS = ["#0ea5e9","#38bdf8","#7dd3fc","#bae6fd","#e0f2fe","#f0f9ff","#dbeafe","#bfdbfe"];
  return (
    <div className="dep-minichart">
      {items.map((d, i) => {
        const pct = (Number(d.total || 0) / maxVal) * 100;
        return (
          <div key={d.productId || i} className="dep-minichart-row">
            <span className="dep-minichart-label" title={d.name}>{d.name || "—"}</span>
            <div className="dep-minichart-track">
              <div
                className="dep-minichart-fill"
                style={{ width: `${Math.max(4, pct)}%`, background: COLORS[i % COLORS.length] }}
              />
            </div>
            <span className="dep-minichart-val">{fmt(d.total)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Gráfico de distribución de stock (donut-ish usando SVG) */
function StockDonut({ sinStock, enRiesgo, bajo, normal }) {
  const total = sinStock + enRiesgo + bajo + normal;
  if (total === 0) return null;
  const pctS = (sinStock / total) * 100;
  const pctR = (enRiesgo / total) * 100;
  const pctB = (bajo / total) * 100;
  const size = 80, cx = 40, cy = 40, r = 30, stroke = 12;
  const circ = 2 * Math.PI * r;

  // Build arcs
  const segments = [
    { pct: pctS, color: "#ef4444", label: "Sin stock" },
    { pct: pctR, color: "#f97316", label: "Riesgo" },
    { pct: pctB, color: "#facc15", label: "Bajo" },
    { pct: Math.max(0, 100 - pctS - pctR - pctB), color: "#22c55e", label: "OK" },
  ];
  let offset = 0;
  return (
    <div className="dep-donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        {segments.map((seg, i) => {
          const dash = (seg.pct / 100) * circ;
          const gap = circ - dash;
          const el = (
            <circle
              key={i}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={-offset * circ / 100}
            />
          );
          offset += seg.pct;
          return el;
        })}
      </svg>
      <div className="dep-donut-legend">
        {segments.slice(0,3).map((s,i) => (
          <span key={i} className="dep-donut-dot" style={{ "--c": s.color }}>
            {[sinStock, enRiesgo, bajo][i]}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Sparkline SVG para tendencia por día */
function Sparkline({ data, color = "#0ea5e9", height = 36, width = 120 }) {
  if (!data || data.length < 2) return null;
  const vals = data.map(d => Number(d.pedidos ?? d.monto ?? d.value ?? 0));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Gauge de cobertura (días) */
function CoverageGauge({ days, max = 30 }) {
  if (days == null) return <span style={{ color: "#9ca3af" }}>—</span>;
  const pct = Math.min(days / max, 1);
  const color = pct >= 0.6 ? "#22c55e" : pct >= 0.3 ? "#f59e0b" : "#ef4444";
  return (
    <div className="dep-gauge">
      <div className="dep-gauge-track">
        <div className="dep-gauge-fill" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
      <span style={{ color, fontWeight: 600, fontSize: "0.8rem" }}>{days.toFixed(0)}d</span>
    </div>
  );
}

/* ========= useDebounced ========= */
const useDebounced = (value, delay = 300) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
};

/* ========= Panel de Pedidos ========= */
const API_BASE_URL = (import.meta?.env && import.meta.env.VITE_API_URL) || "http://localhost:4000";

function DepositoOrdersPanel({ pedidosPorDia }) {
  const [tab, setTab] = useState("open");
  const [orders, setOrders] = useState([]);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const qDeb = useDebounced(q, 250);
  const [sort, setSort] = useState("fecha_desc");
  const [selected, setSelected] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState("");

  const money = (v) => {
    try { return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 }).format(Number(v || 0)); }
    catch { return `$ ${Number(v || 0).toFixed(2)}`; }
  };

  const parseDbDateToMs = (raw) => {
    if (!raw) return NaN;
    try { return new Date(String(raw).replace(" ", "T") + "-03:00").getTime(); }
    catch { return NaN; }
  };

  const formatFechaAr = (raw) => {
    const t = parseDbDateToMs(raw);
    if (Number.isNaN(t)) return raw || "";
    return new Date(t).toLocaleString("es-AR", {
      timeZone: "America/Argentina/Cordoba",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  };

  const list = useCallback(async () => {
    setErr("");
    try {
      const { data } = await api.get("/deposito/orders", { params: { status: tab }, withCredentials: true });
      setOrders(Array.isArray(data) ? data : []);
    } catch (e) {
      try {
        const { data } = await api.get("/admin/orders", { withCredentials: true });
        setOrders(Array.isArray(data) ? data : []);
      } catch (e2) {
        setErr(e?.response?.data?.error || e2?.message || "No se pudieron cargar los pedidos");
        setOrders([]);
      }
    }
  }, [tab]);

  useEffect(() => { list(); }, [list]);

  const filtered = useMemo(() => {
    let arr = orders.slice();
    const t = String(qDeb || "").trim().toLowerCase();
    if (t) {
      const tId = t.startsWith("#") ? t.slice(1) : t;
      arr = arr.filter(o => {
        const idStr = String(o.id ?? "").toLowerCase();
        const empleado = String(o.empleadoNombre || o.empleadoId || "").toLowerCase();
        const rol = String(o.rol ?? "").toLowerCase();
        const remito = String(o.remitoDisplay ?? o.remito ?? "").toLowerCase();
        return idStr.includes(tId) || remito.includes(t) || empleado.includes(t) || rol.includes(t);
      });
    }
    arr.sort((a, b) => {
      switch (sort) {
        case "fecha_asc": return parseDbDateToMs(a.fecha) - parseDbDateToMs(b.fecha);
        case "total_desc": return (b.total ?? 0) - (a.total ?? 0);
        case "total_asc": return (a.total ?? 0) - (b.total ?? 0);
        case "id_desc": return (b.id ?? 0) - (a.id ?? 0);
        case "id_asc": return (a.id ?? 0) - (b.id ?? 0);
        default: return parseDbDateToMs(b.fecha) - parseDbDateToMs(a.fecha);
      }
    });
    return arr;
  }, [orders, qDeb, sort]);

  const remitoNum = (o) => o.remitoDisplay ?? o.remito ?? o.remitoNumber ?? o.remito_numero ?? "-";

  const moveToPreparing = async (id) => {
    try { await api.put(`/deposito/orders/${id}/prepare`, {}, { withCredentials: true }); }
    catch (e) { setErr(e?.response?.data?.error || e.message || "Error"); return; }
    setOrders(prev => prev.filter(o => o.id !== id));
  };

  const closeOrder = async (id) => {
    try { await api.put(`/deposito/orders/${id}/close`, {}, { withCredentials: true }); }
    catch (e) { setErr(e?.response?.data?.error || e.message || "Error"); return; }
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status: "closed", isClosed: true } : o));
    setTab("closed");
  };

  const reopenOrder = async (id) => {
    try { await api.put(`/deposito/orders/${id}/reopen`, {}, { withCredentials: true }); }
    catch (e) { setErr(e?.response?.data?.error || e.message || "Error"); return; }
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status: "open", isClosed: false } : o));
    setTab("open");
  };

  const fetchPdfSmart = async (id) => {
    for (const path of [`/orders/pdf/${id}`, `/admin/orders/pdf/${id}`, `/orders/${id}/pdf`]) {
      try {
        const res = await api.get(path, { responseType: "blob", headers: { Accept: "application/pdf" }, withCredentials: true });
        const ct = (res.headers?.["content-type"] || "").toLowerCase();
        if (!ct.includes("application/pdf")) throw new Error(`CT="${ct}"`);
        return URL.createObjectURL(res.data);
      } catch { /* try next */ }
    }
    const r = await fetch(`${API_BASE_URL?.replace(/\/$/, "")}/orders/pdf/${id}`, { headers: { Accept: "application/pdf" }, credentials: "include" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return URL.createObjectURL(await r.blob());
  };

  const onPreviewRemito = async (o) => {
    setSelected(o); setPreviewErr(""); setPreviewLoading(true);
    if (pdfUrl) { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }
    try { setPdfUrl(await fetchPdfSmart(o.id)); }
    catch (e) { setPreviewErr(e?.message || "No se pudo cargar el remito"); setSelected(null); }
    finally { setPreviewLoading(false); }
  };

  const closePreview = () => {
    setSelected(null); setPreviewErr("");
    if (pdfUrl) { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }
  };

  // Stats rápidas de pedidos por tab
  const stats = useMemo(() => ({
    open: orders.filter(o => o.status === "open").length,
    preparing: orders.filter(o => o.status === "preparing").length,
    closed: orders.filter(o => o.status === "closed").length,
  }), [orders]);

  return (
    <div className="deposito-orders-panel">
      {/* KPI mini row de pedidos */}
      <div className="dep-order-kpis">
        <div className="dep-order-kpi dep-order-kpi--open">
          <span className="dep-order-kpi-num">{stats.open}</span>
          <span className="dep-order-kpi-lbl">Pendientes</span>
        </div>
        <div className="dep-order-kpi dep-order-kpi--prep">
          <span className="dep-order-kpi-num">{stats.preparing}</span>
          <span className="dep-order-kpi-lbl">En preparación</span>
        </div>
        <div className="dep-order-kpi dep-order-kpi--closed">
          <span className="dep-order-kpi-num">{stats.closed}</span>
          <span className="dep-order-kpi-lbl">Cerrados</span>
        </div>
        {pedidosPorDia && pedidosPorDia.length > 1 && (
          <div className="dep-order-kpi dep-order-kpi--trend">
            <Sparkline data={pedidosPorDia} color="#0ea5e9" />
            <span className="dep-order-kpi-lbl">Tendencia</span>
          </div>
        )}
      </div>

      {/* Tabs + filtros */}
      <div className="deposito-header-actions" style={{ gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        {[
          { key: "open", label: "Pedidos" },
          { key: "preparing", label: "En preparación" },
          { key: "closed", label: "Cerrados" },
        ].map(({ key, label }) => (
          <button key={key} type="button"
            className={`pill pill--ghost${tab === key ? " is-active" : ""}`}
            onClick={() => setTab(key)}
          >{label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <input type="search" className="deposito-search"
          placeholder="Buscar #id, remito, empleado…"
          value={q} onChange={e => setQ(e.target.value)} />
        <label className="deposito-field" style={{ minWidth: 200 }}>
          <span>Ordenar</span>
          <select value={sort} onChange={e => setSort(e.target.value)} className="deposito-select">
            <option value="fecha_desc">Fecha (nuevos primero)</option>
            <option value="fecha_asc">Fecha (viejos primero)</option>
            <option value="total_desc">Total (mayor a menor)</option>
            <option value="total_asc">Total (menor a mayor)</option>
            <option value="id_desc">ID desc</option>
            <option value="id_asc">ID asc</option>
          </select>
        </label>
      </div>

      {err && <div className="state error deposito-state">{err}</div>}

      <div className="deposito-table-wrapper">
        <table className="deposito-table" aria-label="Pedidos (Depósito)">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Remito</th>
              <th scope="col">Empleado</th>
              <th scope="col">Rol</th>
              <th scope="col">Fecha</th>
              <th scope="col" className="deposito-th--numeric">Total</th>
              <th scope="col" style={{ width: 300 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="deposito-empty">Sin resultados</td></tr>
            )}
            {filtered.map(o => (
              <tr key={o.id} className="deposito-row">
                <td>{o.displayId || String(o.id ?? "").padStart(7, "0")}</td>
                <td>{remitoNum(o)}</td>
                <td><strong>{o.empleadoNombre || o.empleadoId}</strong></td>
                <td>{o.rol}</td>
                <td>{formatFechaAr(o.fecha)}</td>
                <td className="deposito-td--numeric">{o.total == null ? "—" : money(o.total)}</td>
                <td style={{ textAlign: "right" }}>
                  <button type="button" className="pill" onClick={() => onPreviewRemito(o)}>Ver remito</button>
                  {tab === "open" && <button type="button" className="pill" onClick={() => moveToPreparing(o.id)} style={{ marginLeft: 6 }}>Preparar</button>}
                  {tab === "preparing" && <button type="button" className="pill" onClick={() => closeOrder(o.id)} style={{ marginLeft: 6 }}>Cerrar</button>}
                  {tab === "closed" && <button type="button" className="pill pill--ghost" onClick={() => reopenOrder(o.id)} style={{ marginLeft: 6 }}>Reabrir</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(selected || previewErr) && (
        <div style={{ marginTop: 16 }}>
          <div className="section-header">
            {selected && (
              <div className="muted">
                Remito #{String(selected.id).padStart(7, "0")} — <strong>{selected.empleadoNombre || selected.empleadoId}</strong> — {selected.rol}
              </div>
            )}
            <div className="actions-row">
              {pdfUrl && <a href={pdfUrl} target="_blank" rel="noreferrer" className="pill pill--ghost">Nueva pestaña</a>}
              <button className="pill pill--ghost" onClick={closePreview}>Cerrar</button>
            </div>
          </div>
          {previewErr && <div className="state error deposito-state">{previewErr}</div>}
          {pdfUrl && !previewErr && (
            <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid #d1d5db", height: 540, background: "#0f172a" }}>
              <iframe title={`Remito #${selected?.id}`} src={pdfUrl} style={{ width: "100%", height: "100%", border: "none" }} />
            </div>
          )}
          {!pdfUrl && !previewErr && previewLoading && <div className="state deposito-state">Cargando remito…</div>}
        </div>
      )}
    </div>
  );
}

/* ========= Componente principal ========= */
export default function Deposito() {
  const [start, setStart] = useState(isoFirstOfMonth());
  const [end, setEnd] = useState(isoToday());
  const [thresholdInput, setThresholdInput] = useState("10");
  const [riskPercentInput, setRiskPercentInput] = useState("30");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [top, setTop] = useState([]);
  const [low, setLow] = useState([]);
  const [consumos, setConsumos] = useState({});

  const [searchTop, setSearchTop] = useState("");
  const [searchLow, setSearchLow] = useState("");
  const [lowFilter, setLowFilter] = useState("all");

  const [sortTop, setSortTop] = useState({ field: "total", dir: "desc" });
  const [sortLow, setSortLow] = useState({ field: "stock", dir: "asc" });

  // Vista activa: "overview" | "pedidos"
  const [activeView, setActiveView] = useState("overview");

  const threshold = useMemo(() => {
    const p = parseInt(thresholdInput, 10);
    return Number.isNaN(p) ? 0 : Math.max(0, p);
  }, [thresholdInput]);

  const riskPercent = useMemo(() => {
    const p = parseInt(riskPercentInput, 10);
    if (Number.isNaN(p)) return 0;
    return Math.min(100, Math.max(1, p));
  }, [riskPercentInput]);

  const fechaInvalida = useMemo(() => !!start && !!end && start > end, [start, end]);

  useEffect(() => {
    if (fechaInvalida) return;
    let alive = true;
    async function fetchOverview() {
      setLoading(true); setError("");
      try {
        const r = await api.get("/deposito/overview", { params: { start, end, threshold } });
        if (!alive) return;
        setTop(r.data?.top || []);
        setLow(r.data?.low || []);

        const calls = (r.data?.low || []).map(row =>
          api.get(`/deposito/consumo-desde-ultimo-ingreso/${row.productId}`, { params: { fallbackStart: start } })
            .then(rsp => ({ productId: row.productId, ...rsp.data }))
            .catch(() => ({ productId: row.productId, consumido: null, last_ingreso: null, incoming_total: null, next_eta: null }))
        );
        const details = await Promise.all(calls);
        if (!alive) return;
        setConsumos(Object.fromEntries(details.map(d => [String(d.productId), d])));
      } catch (e) {
        console.error(e);
        setError("No se pudo cargar el panel de Depósito");
      } finally {
        if (alive) setLoading(false);
      }
    }
    fetchOverview();
    return () => { alive = false; };
  }, [start, end, threshold, fechaInvalida]);

  const setQuickRange = (type) => {
    const today = isoToday();
    const map = { "7d": [isoNDaysAgo(7), today], "30d": [isoNDaysAgo(30), today], "month": [isoFirstOfMonth(), today], "year": [isoFirstOfYear(), today] };
    if (map[type]) { setStart(map[type][0]); setEnd(map[type][1]); }
  };

  const resumen = useMemo(() => {
    const totalConsumido = top.reduce((s, r) => s + (Number(r.total) || 0), 0);
    const riesgoLimite = threshold > 0 ? Math.floor(threshold * (riskPercent / 100)) : 0;
    let productosSinStock = 0, productosEnRiesgo = 0;
    for (const r of low) {
      const st = Number(r.stock || 0);
      if (st <= 0) { productosSinStock++; continue; }
      if (riesgoLimite > 0 && st <= riesgoLimite) productosEnRiesgo++;
    }
    const bajoResto = Math.max(0, low.length - productosSinStock - productosEnRiesgo);

    // Cobertura promedio
    let covSum = 0, covCount = 0;
    for (const r of low) {
      const c = calcCoverageDays(r.stock, consumos[String(r.productId)]);
      if (c != null) { covSum += c; covCount++; }
    }
    const avgCoverage = covCount > 0 ? covSum / covCount : null;

    // Top 5 consumidos para sparkline simulado (por posición)
    const top5 = top.slice(0, 5).map((r, i) => ({ pedidos: Number(r.total || 0), i }));

    return { totalConsumido, productosTop: top.length, productosBajo: low.length, productosSinStock, productosEnRiesgo, bajoResto, riesgoLimite, avgCoverage, top5 };
  }, [top, low, threshold, riskPercent, consumos]);

  const topFiltrados = useMemo(() => {
    let rows = top;
    if (searchTop.trim()) {
      const q = searchTop.trim().toLowerCase();
      rows = rows.filter(r => String(r.name || "").toLowerCase().includes(q) || String(r.unit || "").toLowerCase().includes(q));
    }
    return sortByField(rows, sortTop.field, sortTop.dir);
  }, [top, searchTop, sortTop]);

  const lowFiltrados = useMemo(() => {
    let rows = low;
    if (searchLow.trim()) {
      const q = searchLow.trim().toLowerCase();
      rows = rows.filter(r => String(r.name || "").toLowerCase().includes(q));
    }
    const riesgoLimite = threshold > 0 ? Math.floor(threshold * (riskPercent / 100)) : 0;
    if (lowFilter !== "all") {
      rows = rows.filter(r => {
        const st = Number(r.stock || 0);
        if (lowFilter === "sin-stock") return st <= 0;
        if (lowFilter === "riesgo") return st > 0 && riesgoLimite > 0 && st <= riesgoLimite;
        if (lowFilter === "bajo") return st > riesgoLimite && (threshold <= 0 || st <= threshold);
        return true;
      });
    }
    const getValue = (row, field) => {
      const d = consumos[String(row.productId)] || {};
      if (field === "stock") return Number(row.stock || 0);
      if (field === "consumido") return Number(d.consumido || 0);
      if (field === "incoming") return Number(d.incoming_total || 0);
      if (field === "coverage") return calcCoverageDays(row.stock, d);
      if (field === "name") return row.name || "";
      return null;
    };
    return sortByField(rows, sortLow.field, sortLow.dir, getValue);
  }, [low, searchLow, sortLow, consumos, lowFilter, threshold, riskPercent]);

  const handleSortTop = (field) => setSortTop(prev => ({ field, dir: prev.field === field ? (prev.dir === "asc" ? "desc" : "asc") : "desc" }));
  const handleSortLow = (field) => setSortLow(prev => ({ field, dir: prev.field === field ? (prev.dir === "asc" ? "desc" : "asc") : "asc" }));
  const sortIndicator = (current, field) => current.field === field ? (current.dir === "asc" ? " ▲" : " ▼") : "";

  const handleExportLowCsv = () => {
    if (!lowFiltrados.length) return;
    const header = ["Producto", "Stock", "ConsumoDesdeUltIngreso", "FechaUltIngreso", "IngresoFuturo", "ProximaETA", "CoberturaDias"];
    const rows = lowFiltrados.map(r => {
      const d = consumos[String(r.productId)] || {};
      const coverage = calcCoverageDays(r.stock, d);
      return [r.name || "", r.stock, d.consumido ?? "", d.last_ingreso ? String(d.last_ingreso).slice(0, 10) : "", d.incoming_total ?? "", d.next_eta ? String(d.next_eta).slice(0, 10) : "", coverage != null ? coverage.toFixed(1) : ""];
    });
    const csv = [header, ...rows].map(r => r.map(v => String(v).includes(";") ? `"${v}"` : v).join(";")).join("\n");
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" })), download: `stock_bajo_${start}_${end}.csv` });
    a.click();
  };

  return (
    <section className="admin-panel deposito-page">
      <div className="dep-topbar">
        <h1 className="deposito-title">Panel de Depósito</h1>
        <div className="dep-view-tabs">
          <button type="button" className={`pill${activeView === "overview" ? "" : " pill--ghost"}`} onClick={() => setActiveView("overview")}>📊 Stock & KPIs</button>
          <button type="button" className={`pill${activeView === "pedidos" ? "" : " pill--ghost"}`} onClick={() => setActiveView("pedidos")}>📦 Pedidos</button>
        </div>
      </div>

      {/* Filtros globales */}
      <div className="filters deposito-filters">
        <label className="deposito-field">
          <span>Desde</span>
          <input type="date" value={start} onChange={e => setStart(e.target.value)} />
        </label>
        <label className="deposito-field">
          <span>Hasta</span>
          <input type="date" value={end} onChange={e => setEnd(e.target.value)} />
        </label>
        <label className="deposito-field">
          <span>Umbral stock bajo</span>
          <input type="number" min="0" value={thresholdInput}
            onChange={e => { if (e.target.value === "" || /^\d*$/.test(e.target.value)) setThresholdInput(e.target.value); }} />
        </label>
        <label className="deposito-field">
          <span>% Riesgo</span>
          <input type="number" min="1" max="100" value={riskPercentInput}
            onChange={e => { if (e.target.value === "" || /^\d*$/.test(e.target.value)) setRiskPercentInput(e.target.value); }} />
        </label>
        <div className="deposito-quickranges">
          <span className="deposito-quickranges-label">Rangos rápidos</span>
          <div className="deposito-quickranges-buttons">
            {[["7d", "7 días"], ["30d", "30 días"], ["month", "Este mes"], ["year", "Año"]].map(([k, l]) => (
              <button key={k} type="button" className="pill pill--ghost" onClick={() => setQuickRange(k)}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {fechaInvalida && <div className="state error deposito-state">El rango de fechas es inválido.</div>}
      {loading && <div className="state deposito-state">Cargando…</div>}
      {error && !loading && <div className="state error deposito-state">{error}</div>}

      {/* ===== VISTA STOCK & KPIs ===== */}
      {activeView === "overview" && !loading && !error && !fechaInvalida && (
        <>
          {/* KPI Cards */}
          <div className="deposito-summary dep-kpi-grid">

            <div className="deposito-summary-card deposito-summary-card--main">
              <div className="deposito-summary-label">Consumo total (unidades)</div>
              <div className="deposito-summary-value">{fmt(resumen.totalConsumido)}</div>
              <div className="deposito-summary-sub">{start} → {end}</div>
            </div>

            <div className="deposito-summary-card">
              <div className="deposito-summary-label">Productos con consumo</div>
              <div className="deposito-summary-value">{resumen.productosTop}</div>
              <div className="deposito-summary-sub">en el período seleccionado</div>
              {resumen.top5.length > 1 && <Sparkline data={resumen.top5.map(d => ({ pedidos: d.pedidos }))} color="#0ea5e9" width={100} height={28} />}
            </div>

            <div className="deposito-summary-card deposito-summary-card--alert">
              <div className="deposito-summary-label">Distribución de alertas</div>
              <div className="dep-kpi-donut-row">
                <StockDonut
                  sinStock={resumen.productosSinStock}
                  enRiesgo={resumen.productosEnRiesgo}
                  bajo={resumen.bajoResto}
                  normal={Math.max(0, resumen.productosTop - resumen.productosBajo)}
                />
                <div className="dep-kpi-donut-labels">
                  <div><span className="legend-dot legend-danger" /> Sin stock: <b>{resumen.productosSinStock}</b></div>
                  {resumen.riesgoLimite > 0 && <div><span className="legend-dot legend-warning" /> En riesgo: <b>{resumen.productosEnRiesgo}</b></div>}
                  <div><span className="legend-dot legend-neutral" /> Bajo umbral: <b>{resumen.bajoResto}</b></div>
                </div>
              </div>
            </div>

            <div className="deposito-summary-card deposito-summary-card--alert">
              <div className="deposito-summary-label">Cobertura promedio</div>
              <div className="deposito-summary-value">
                {resumen.avgCoverage != null ? `${resumen.avgCoverage.toFixed(0)} días` : "—"}
              </div>
              <div className="deposito-summary-sub">
                {resumen.avgCoverage != null
                  ? resumen.avgCoverage < 7 ? "⚠️ Cobertura crítica" : resumen.avgCoverage < 15 ? "⚡ Cobertura baja" : "✅ Cobertura aceptable"
                  : "Sin datos de consumo"
                }
              </div>
              <div className="deposito-summary-sub">Umbral: ≤ {threshold} · Riesgo: {riskPercent}%</div>
            </div>
          </div>

          {/* Grid de tablas */}
          <div className="deposito-grid">

            {/* Más consumidos + Mini gráfico */}
            <div className="card deposito-card">
              <div className="card-header deposito-card-header">
                <div>
                  <h2>Más consumidos</h2>
                  <small>{start} → {end}</small>
                </div>
                <div className="deposito-header-actions">
                  <input type="search" className="deposito-search" placeholder="Buscar…" value={searchTop} onChange={e => setSearchTop(e.target.value)} />
                </div>
              </div>

              {/* Gráfico de barras horizontales */}
              {topFiltrados.length > 0 && (
                <div style={{ padding: "0.5rem 0.75rem 0.25rem" }}>
                  <MiniBarChart data={topFiltrados} maxItems={8} />
                </div>
              )}

              <div className="deposito-table-wrapper" style={{ maxHeight: "38vh" }}>
                <table className="deposito-table" aria-label="Productos más consumidos">
                  <thead>
                    <tr>
                      <th onClick={() => handleSortTop("name")} className="deposito-th--sortable" scope="col">Producto{sortIndicator(sortTop, "name")}</th>
                      <th onClick={() => handleSortTop("unit")} className="deposito-th--sortable" scope="col">Unidad{sortIndicator(sortTop, "unit")}</th>
                      <th onClick={() => handleSortTop("total")} className="deposito-th--sortable deposito-th--numeric" scope="col">Total{sortIndicator(sortTop, "total")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topFiltrados.length === 0 && <tr><td colSpan={3} className="deposito-empty">Sin consumos en el período</td></tr>}
                    {topFiltrados.map(r => (
                      <tr key={r.productId} className="deposito-row">
                        <td>{r.name}</td>
                        <td>{r.unit || "-"}</td>
                        <td className="deposito-td--numeric">{fmt(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Stock bajo con gauge de cobertura */}
            <div className="card deposito-card deposito-card--alert">
              <div className="card-header deposito-card-header">
                <div><h2>Stock bajo</h2></div>
                <div className="deposito-header-actions">
                  <div className="deposito-lowfilter">
                    {[
                      ["all", `Todos (${resumen.productosBajo})`],
                      ["sin-stock", `Sin stock (${resumen.productosSinStock})`],
                      ["riesgo", `Riesgo (${resumen.productosEnRiesgo})`],
                      ["bajo", `Bajo (${resumen.bajoResto})`],
                    ].map(([k, l]) => (
                      <button key={k} type="button"
                        className={`pill pill--ghost deposito-lowfilter-btn${lowFilter === k ? " is-active" : ""}`}
                        onClick={() => setLowFilter(k)}
                      >{l}</button>
                    ))}
                  </div>
                  <input type="search" className="deposito-search" placeholder="Buscar producto…" value={searchLow} onChange={e => setSearchLow(e.target.value)} />
                  <button type="button" className="pill deposito-export-btn" onClick={handleExportLowCsv} disabled={!lowFiltrados.length}>Exportar CSV</button>
                </div>
              </div>

              <div className="deposito-table-wrapper">
                <table className="deposito-table" aria-label="Productos con stock bajo">
                  <thead>
                    <tr>
                      <th onClick={() => handleSortLow("name")} className="deposito-th--sortable" scope="col">Producto{sortIndicator(sortLow, "name")}</th>
                      <th onClick={() => handleSortLow("stock")} className="deposito-th--sortable deposito-th--numeric" scope="col">Stock{sortIndicator(sortLow, "stock")}</th>
                      <th onClick={() => handleSortLow("consumido")} className="deposito-th--sortable deposito-th--numeric" scope="col">Consumo{sortIndicator(sortLow, "consumido")}</th>
                      <th onClick={() => handleSortLow("incoming")} className="deposito-th--sortable deposito-th--numeric" scope="col">Ing. futuro{sortIndicator(sortLow, "incoming")}</th>
                      <th onClick={() => handleSortLow("coverage")} className="deposito-th--sortable deposito-th--numeric" scope="col">Cobertura{sortIndicator(sortLow, "coverage")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowFiltrados.length === 0 && <tr><td colSpan={5} className="deposito-empty">No hay alertas de stock bajo</td></tr>}
                    {lowFiltrados.map(r => {
                      const d = consumos[String(r.productId)] || {};
                      const stockActual = Number(r.stock || 0);
                      const coverage = calcCoverageDays(stockActual, d);
                      const riesgoLimite = threshold > 0 ? Math.floor(threshold * (riskPercent / 100)) : 0;
                      const sinStock = stockActual <= 0;
                      const enRiesgo = !sinStock && riesgoLimite > 0 && stockActual <= riesgoLimite;
                      const ratio = threshold > 0 ? Math.max(0, Math.min(stockActual / threshold, 1)) : 0;

                      return (
                        <tr key={r.productId} className={`deposito-row${sinStock ? " deposito-row--sin-stock" : enRiesgo ? " deposito-row--riesgo" : ""}`}>
                          <td>
                            {r.name}
                            {sinStock && <span className="deposito-badge deposito-badge--danger">SIN STOCK</span>}
                            {!sinStock && enRiesgo && <span className="deposito-badge deposito-badge--warning">riesgo</span>}
                          </td>
                          <td className="deposito-td--numeric">
                            {fmt(stockActual)}
                            <div className="deposito-stockbar" style={{ "--ratio": ratio }} aria-hidden="true">
                              <div className="deposito-stockbar-fill" />
                            </div>
                          </td>
                          <td className="deposito-td--numeric">
                            {d.consumido == null ? "-" : fmt(d.consumido)}
                            <div className="deposito-subtext">desde {d.last_ingreso ? String(d.last_ingreso).slice(0, 10) : start}</div>
                          </td>
                          <td className="deposito-td--numeric">
                            {d.incoming_total ? fmt(d.incoming_total) : "-"}
                            {d.next_eta && <div className="deposito-subtext">ETA {String(d.next_eta).slice(0, 10)}</div>}
                          </td>
                          <td className="deposito-td--numeric">
                            <CoverageGauge days={coverage} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="deposito-legend" style={{ marginTop: 8 }}>
                <span className="legend-dot legend-danger" /><span>Sin stock (0): <b>{resumen.productosSinStock}</b></span>
                {resumen.riesgoLimite > 0 && <><span className="legend-dot legend-warning" /><span>En riesgo (1..{resumen.riesgoLimite}): <b>{resumen.productosEnRiesgo}</b></span></>}
                <span className="legend-dot legend-neutral" /><span>Bajo umbral: <b>{resumen.bajoResto}</b></span>
              </div>
              <p className="deposito-footnote">Tip: cargá ingresos futuros desde el panel Administrativo → <strong>Futuro Ingreso</strong>.</p>
            </div>
          </div>
        </>
      )}

      {/* ===== VISTA PEDIDOS ===== */}
      {activeView === "pedidos" && (
        <div style={{ marginTop: 16 }}>
          <DepositoOrdersPanel pedidosPorDia={[]} />
        </div>
      )}
    </section>
  );
}
