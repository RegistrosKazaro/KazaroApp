// client/src/pages/Deposito.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import useDebounced from "../hooks/useDebounced";
import "../styles/deposito.css";
import DevolucionesPendientes from "../components/DevolucionesPendientes";

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
function money(v) {
  try {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 }).format(Number(v || 0));
  } catch { return `$ ${Number(v || 0).toFixed(2)}`; }
}

function parseDateToMs(raw) {
  if (!raw) return NaN;
  try {
    const s = String(raw).replace(" ", "T");
    const d = new Date(s.includes("+") || s.endsWith("Z") ? s : s + "-03:00");
    return d.getTime();
  } catch { return NaN; }
}

function calcDuration(fromRaw, toRaw) {
  const f = parseDateToMs(fromRaw);
  const t = parseDateToMs(toRaw);
  if (Number.isNaN(f) || Number.isNaN(t)) return null;
  const diffMs = t - f;
  if (diffMs <= 0) return null;
  const totalMin = Math.floor(diffMs / 60000);
  if (totalMin < 60) return `${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const mins  = totalMin % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH > 0 ? `${days}d ${remH}h` : `${days} día${days !== 1 ? "s" : ""}`;
}

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

function MiniBarChart({ data, maxItems = 8 }) {
  const items = (data || []).slice(0, maxItems);
  if (!items.length) return <p style={{ color: "#9ca3af", fontSize: "0.8rem" }}>Sin datos</p>;
  const maxVal = Math.max(...items.map(d => Number(d.total || 0)), 1);
  const COLORS = ["#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#1d4ed8", "#1e40af", "#1e3a8a", "#172554"];
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

function StockDonut({ sinStock, enRiesgo, bajo, normal }) {
  const total = sinStock + enRiesgo + bajo + normal;
  if (total === 0) return null;
  const pctS = (sinStock / total) * 100;
  const pctR = (enRiesgo / total) * 100;
  const pctB = (bajo / total) * 100;
  const size = 80, cx = 40, cy = 40, r = 30, stroke = 12;
  const circ = 2 * Math.PI * r;
  const segments = [
    { pct: pctS, color: "#dc2626", label: "Sin stock" },
    { pct: pctR, color: "#d97706", label: "Riesgo" },
    { pct: pctB, color: "#ca8a04", label: "Bajo" },
    { pct: Math.max(0, 100 - pctS - pctR - pctB), color: "#16a34a", label: "OK" },
  ];
  let offset = 0;
  return (
    <div className="dep-donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
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
        {segments.slice(0, 3).map((s, i) => (
          <span key={i} className="dep-donut-dot" style={{ "--c": s.color }}>
            {[sinStock, enRiesgo, bajo][i]}
          </span>
        ))}
      </div>
    </div>
  );
}

function Sparkline({ data, color = "#2563eb", height = 36, width = 120 }) {
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
    <svg width={width} height={height} style={{ display: "block" }} aria-hidden="true">
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CoverageGauge({ days, max = 30 }) {
  if (days == null) return <span style={{ color: "#9ca3af" }}>—</span>;
  const pct = Math.min(days / max, 1);
  const color = pct >= 0.6 ? "#16a34a" : pct >= 0.3 ? "#d97706" : "#dc2626";
  return (
    <div className="dep-gauge">
      <div className="dep-gauge-track">
        <div className="dep-gauge-fill" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
      <span style={{ color, fontWeight: 600, fontSize: "0.8rem", minWidth: "2.5rem", textAlign: "right" }}>
        {days.toFixed(0)} días
      </span>
    </div>
  );
}


const API_BASE_URL = (import.meta?.env && import.meta.env.VITE_API_URL) || "http://localhost:4000";

/* =====================================================
   Editor de un pedido en revisión (agregar/quitar/cambiar
   cantidad de insumos y confirmar). onDone recarga la lista.
   ===================================================== */
function RevisionOrderEditor({ order, onDone, canConfirm = true, seedFaltantes = null }) {
  const [items, setItems] = useState(() =>
    (order.items || []).map((it) => ({
      productId: Number(it.productId ?? it.ProductoID ?? it.product_id),
      nombre: it.nombre ?? it.name ?? "",
      codigo: it.codigo ?? it.code ?? "",
      precio: Number(it.precio ?? it.price ?? 0),
      cantidad: Number(it.cantidad ?? it.qty ?? 1),
    }))
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [faltantes, setFaltantes] = useState([]);
  const [dirty, setDirty] = useState(false);

  // Si el retiro se bloqueó por faltta de stock, se muestran acá para resolverlos.
  useEffect(() => {
    if (seedFaltantes && seedFaltantes.length) {
      setFaltantes(seedFaltantes);
      setMsg("No se puede retirar: faltan estos insumos en stock.");
    }
  }, [seedFaltantes]);

  // Buscador de productos para agregar insumo.
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const qDeb = useDebounced(q, 200);
  useEffect(() => {
    let vivo = true;
    const termino = qDeb.trim();
    if (termino.length < 2) { setResultados([]); setBuscando(false); return; }
    setBuscando(true);
    api.get("/deposito/productos", { params: { q: termino } })
      .then(({ data }) => { if (vivo) { setResultados(Array.isArray(data) ? data.slice(0, 10) : []); setActiveIdx(-1); } })
      .catch(() => { if (vivo) setResultados([]); })
      .finally(() => { if (vivo) setBuscando(false); });
    return () => { vivo = false; };
  }, [qDeb]);

  // Navegación por teclado en la lista de resultados.
  const onSearchKey = (e) => {
    if (!resultados.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(resultados.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter" && activeIdx >= 0) { e.preventDefault(); agregar(resultados[activeIdx]); }
    else if (e.key === "Escape") { setResultados([]); setActiveIdx(-1); }
  };
  const yaEnPedido = (pid) => items.some((it) => it.productId === Number(pid));

  const total = items.reduce((s, it) => s + it.precio * it.cantidad, 0);

  const setCantidad = (pid, val) => {
    const n = Math.max(1, Math.trunc(Number(val) || 1));
    setItems((prev) => prev.map((it) => (it.productId === pid ? { ...it, cantidad: n } : it)));
    setDirty(true);
  };
  const quitar = (pid) => { setItems((prev) => prev.filter((it) => it.productId !== pid)); setDirty(true); };
  const agregar = (p) => {
    const pid = Number(p.id);
    setItems((prev) => prev.some((it) => it.productId === pid)
      ? prev.map((it) => it.productId === pid ? { ...it, cantidad: it.cantidad + 1 } : it)
      : [...prev, { productId: pid, nombre: p.name ?? p.nombre ?? "", codigo: p.code ?? p.codigo ?? "", precio: Number(p.price ?? p.precio ?? 0), cantidad: 1 }]);
    setQ(""); setResultados([]); setDirty(true);
  };

  const guardar = async () => {
    setBusy(true); setMsg(""); setFaltantes([]);
    try {
      await api.put(`/deposito/orders/${order.id}/items`, {
        items: items.map((it) => ({ productId: it.productId, cantidad: it.cantidad })),
      });
      setDirty(false); setMsg("Cambios guardados.");
    } catch (e) { setMsg(e?.response?.data?.error || "No se pudieron guardar los cambios"); }
    finally { setBusy(false); }
  };

  const confirmar = async () => {
    setBusy(true); setMsg(""); setFaltantes([]);
    try {
      if (dirty) {
        await api.put(`/deposito/orders/${order.id}/items`, {
          items: items.map((it) => ({ productId: it.productId, cantidad: it.cantidad })),
        });
        setDirty(false);
      }
      await api.post(`/deposito/orders/${order.id}/confirm`);
      onDone && onDone();
    } catch (e) {
      const data = e?.response?.data;
      if (data?.faltantes) { setFaltantes(data.faltantes); setMsg("No se puede confirmar: faltan estos insumos en stock."); }
      else setMsg(data?.error || "No se pudo confirmar el pedido");
    } finally { setBusy(false); }
  };

  return (
    <div className="deposito-items-panel">
      <div className="deposito-items-title">Revisar y ajustar el pedido</div>

      {faltantes.length > 0 && (
        <div className="state error" style={{ marginBottom: 8 }}>
          <strong>Stock insuficiente:</strong>
          <ul style={{ margin: "4px 0 0 18px" }}>
            {faltantes.map((f) => (
              <li key={f.productId}>{f.nombre} — pedido {f.pedido}, disponible {f.disponible == null ? "s/d" : f.disponible}</li>
            ))}
          </ul>
          <div style={{ marginTop: 4, fontSize: "0.85rem" }}>Cargá stock, bajá la cantidad o quitá el insumo para poder confirmar.</div>
        </div>
      )}

      <table className="deposito-items-table">
        <thead>
          <tr>
            <th scope="col">Código</th>
            <th scope="col">Insumo</th>
            <th scope="col" className="numeric" style={{ width: 110 }}>Cantidad</th>
            <th scope="col" className="numeric">Precio</th>
            <th scope="col" className="numeric">Subtotal</th>
            <th scope="col" style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.productId} className={faltantes.some((f) => f.productId === it.productId) ? "" : ""}>
              <td>{it.codigo ? <span className="deposito-code">{it.codigo}</span> : <span style={{ color: "#9ca3af" }}>—</span>}</td>
              <td>{it.nombre}</td>
              <td className="numeric">
                <input type="number" min="1" value={it.cantidad}
                  onChange={(e) => setCantidad(it.productId, e.target.value)}
                  style={{ width: 70, textAlign: "right" }} />
              </td>
              <td className="numeric">{money(it.precio)}</td>
              <td className="numeric">{money(it.precio * it.cantidad)}</td>
              <td style={{ textAlign: "center" }}>
                <button type="button" className="pill pill--ghost" onClick={() => quitar(it.productId)}
                  title="Quitar insumo" style={{ padding: "2px 8px", color: "#b91c1c" }}>✕</button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr><td colSpan={6} style={{ color: "#b91c1c" }}>El pedido quedó sin insumos. Agregá al menos uno.</td></tr>
          )}
        </tbody>
      </table>

      {/* Agregar insumo */}
      <div style={{ position: "relative", marginTop: 10, maxWidth: 520 }}>
        <input type="search" className="deposito-search" style={{ width: "100%" }}
          placeholder="Agregar insumo: buscar por nombre o código…"
          value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey}
          autoComplete="off" role="combobox" aria-expanded={resultados.length > 0} />
        {buscando && (
          <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: "0.8rem", color: "#94a3b8" }}>Buscando…</span>
        )}
        {q.trim().length >= 2 && !buscando && resultados.length === 0 && (
          <div style={{ position: "absolute", zIndex: 20, left: 0, right: 0, background: "#fff", border: "1px solid #d1d5db", borderRadius: 8, marginTop: 2, padding: "10px 12px", color: "#6b7280", fontSize: "0.88rem", boxShadow: "0 8px 24px rgba(15,23,42,.12)" }}>
            No se encontraron insumos para “{q.trim()}”.
          </div>
        )}
        {resultados.length > 0 && (
          <div style={{ position: "absolute", zIndex: 20, left: 0, right: 0, background: "#fff", border: "1px solid #d1d5db", borderRadius: 8, marginTop: 2, maxHeight: 280, overflowY: "auto", boxShadow: "0 8px 24px rgba(15,23,42,.12)" }}>
            {resultados.map((p, idx) => {
              const stock = Number(p.stock ?? 0);
              const enPedido = yaEnPedido(p.id);
              return (
                <button key={p.id} type="button" onMouseEnter={() => setActiveIdx(idx)} onClick={() => agregar(p)}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", border: 0,
                    background: idx === activeIdx ? "#eff6ff" : "#fff", padding: "8px 12px", cursor: "pointer",
                    textAlign: "left", borderBottom: "1px solid #f1f5f9" }}>
                  <span style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: "0.75rem", color: "#9ca3af", minWidth: 74 }}>
                    {p.code || "—"}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.name ?? p.nombre}
                    {enPedido && <span style={{ marginLeft: 6, fontSize: "0.72rem", color: "#2563eb" }}>· ya en el pedido</span>}
                  </span>
                  <span style={{ fontSize: "0.8rem", fontWeight: 600, color: stock <= 0 ? "#b91c1c" : stock < 5 ? "#b45309" : "#16a34a" }}>
                    stock {fmt(stock)}
                  </span>
                  <span style={{ fontSize: "0.8rem", color: "#6b7280", minWidth: 72, textAlign: "right" }}>{money(p.price ?? 0)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <strong style={{ marginRight: "auto" }}>Total: {money(total)}</strong>
        {msg && <span style={{ fontSize: "0.85rem", color: faltantes.length ? "#b91c1c" : "#166534" }}>{msg}</span>}
        <button type="button" className="pill pill--ghost" onClick={guardar} disabled={busy || !items.length}>
          {busy ? "Guardando…" : "Guardar cambios"}
        </button>
        {canConfirm && (
          <button type="button" className="pill" onClick={confirmar} disabled={busy || !items.length}
            style={{ background: "#16a34a", borderColor: "#15803d" }}>
            Confirmar pedido
          </button>
        )}
      </div>
      {!canConfirm && (
        <div style={{ marginTop: 6, fontSize: "0.82rem", color: "#6b7280" }}>
          El stock se descuenta recién al marcar el pedido como <strong>retirado</strong>.
          Guardá los cambios y cuando esté todo, marcalo como retirado.
        </div>
      )}
    </div>
  );
}

/* =====================================================
   Panel de Pedidos
   ===================================================== */
function DepositoOrdersPanel({ pedidosPorDia }) {
  const [tab, setTab] = useState("open");
  const [orders, setOrders] = useState([]);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const qDeb = useDebounced(q, 250);
  const [sort, setSort] = useState("fecha_desc");
  const [servicioFilter, setServicioFilter] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [selected, setSelected] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState("");
  const [expandedOrders, setExpandedOrders] = useState(new Set());
  // Pedidos que el depósito está editando fuera de "Por confirmar" (open/prep/closed).
  const [editingOrders, setEditingOrders] = useState(new Set());
  // Faltantes de stock devueltos al intentar retirar, por id de pedido.
  const [pickupFaltantes, setPickupFaltantes] = useState({});

  // La base guarda UTC. Antes esto hacía new Date(str + "-03:00"), es decir lo
  // interpretaba como hora argentina y adelantaba 3 horas, el mismo bug que
  // tenían los remitos. Un string plano "YYYY-MM-DD HH:MM:SS" se lee como UTC.
  const parseDbDateToMs = (raw) => {
    if (!raw) return NaN;
    try {
      const s = String(raw).trim();
      const conZona = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(s);
      return new Date(s.replace(" ", "T") + (conZona ? "" : "Z")).getTime();
    } catch { return NaN; }
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

  // aaaa-mm-dd del día argentino, para filtrar por rango sin el corrimiento UTC.
  const diaArDe = (raw) => {
    const t = parseDbDateToMs(raw);
    if (Number.isNaN(t)) return "";
    return new Date(t).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Cordoba" });
  };

  const list = useCallback(async () => {
    setErr("");
    setExpandedOrders(new Set());
    setEditingOrders(new Set());
    setPickupFaltantes({});
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

  const toggleExpand = (id) => {
    setExpandedOrders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleEdit = (id) => {
    setEditingOrders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Servicios presentes en los pedidos cargados, para armar el desplegable.
  const serviciosDisponibles = useMemo(() => {
    const set = new Set();
    for (const o of orders) {
      const n = String(o.servicioNombre || "").trim();
      if (n) set.add(n);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [orders]);

  const filtered = useMemo(() => {
    let arr = orders.slice();
    const t = String(qDeb || "").trim().toLowerCase();
    if (t) {
      const tId = t.startsWith("#") ? t.slice(1) : t;
      arr = arr.filter(o => {
        const idStr = String(o.id ?? "").toLowerCase();
        const empleado = String(o.empleadoNombre || o.empleadoId || "").toLowerCase();
        const servicio = String(o.servicioNombre || "").toLowerCase();
        const rol = String(o.rol ?? "").toLowerCase();
        const remito = String(o.remitoDisplay ?? o.remito ?? "").toLowerCase();
        return idStr.includes(tId) || remito.includes(t) || empleado.includes(t) || rol.includes(t) || servicio.includes(t);
      });
    }
    if (servicioFilter) {
      arr = arr.filter(o => String(o.servicioNombre || "").trim() === servicioFilter);
    }
    if (desde) arr = arr.filter(o => { const d = diaArDe(o.fecha); return d && d >= desde; });
    if (hasta) arr = arr.filter(o => { const d = diaArDe(o.fecha); return d && d <= hasta; });
    arr.sort((a, b) => {
      switch (sort) {
        case "fecha_asc":  return parseDbDateToMs(a.fecha) - parseDbDateToMs(b.fecha);
        case "total_desc": return (b.total ?? 0) - (a.total ?? 0);
        case "total_asc":  return (a.total ?? 0) - (b.total ?? 0);
        case "id_desc":    return (b.id ?? 0) - (a.id ?? 0);
        case "id_asc":     return (a.id ?? 0) - (b.id ?? 0);
        default:           return parseDbDateToMs(b.fecha) - parseDbDateToMs(a.fecha);
      }
    });
    return arr;
    // parseDbDateToMs/diaArDe son estables por render; no hace falta listarlas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, qDeb, sort, servicioFilter, desde, hasta]);

  const remitoNum = (o) => o.remitoDisplay ?? o.remito ?? o.remitoNumber ?? o.remito_numero ?? "-";

  const moveToPreparing = async (id) => {
    try { await api.put(`/deposito/orders/${id}/prepare`, {}, { withCredentials: true }); }
    catch (e) { setErr(e?.response?.data?.error || e.message || "Error"); return; }
    setOrders(prev => prev.filter(o => o.id !== id));
  };

  // En todas las transiciones se saca el pedido de la lista actual pero NO se
  // cambia de pestaña: el encargado sigue trabajando en la etapa donde está.
  const closeOrder = async (id) => {
    try { await api.put(`/deposito/orders/${id}/close`, {}, { withCredentials: true }); }
    catch (e) { setErr(e?.response?.data?.error || e.message || "Error"); return; }
    setOrders(prev => prev.filter(o => o.id !== id));
  };

  const reopenOrder = async (id) => {
    try { await api.put(`/deposito/orders/${id}/reopen`, {}, { withCredentials: true }); }
    catch (e) { setErr(e?.response?.data?.error || e.message || "Error"); return; }
    setOrders(prev => prev.filter(o => o.id !== id));
  };

  const markPickup = async (id) => {
    try {
      await api.put(`/deposito/orders/${id}/pickup`, {}, { withCredentials: true });
      setPickupFaltantes(prev => { const n = { ...prev }; delete n[id]; return n; });
      setOrders(prev => prev.filter(o => o.id !== id));
    } catch (e) {
      const data = e?.response?.data;
      if (data?.faltantes) {
        // Stock insuficiente: se abre el editor del pedido con los faltantes
        // marcados para que el depósito baje cantidades, cargue stock o quite.
        setPickupFaltantes(prev => ({ ...prev, [id]: data.faltantes }));
        setEditingOrders(prev => new Set(prev).add(id));
        setErr("");
      } else {
        setErr(data?.error || e.message || "Error al registrar el retiro");
      }
    }
  };

  const fetchPdfSmart = async (id) => {
    for (const path of [`/orders/pdf/${id}`, `/admin/orders/pdf/${id}`, `/orders/${id}/pdf`]) {
      try {
        const res = await api.get(path, { responseType: "blob", headers: { Accept: "application/pdf" }, withCredentials: true });
        const ct = (res.headers?.["content-type"] || "").toLowerCase();
        if (!ct.includes("application/pdf")) throw new Error(`CT="${ct}"`);
        return URL.createObjectURL(res.data);
      } catch { /* intentar siguiente */ }
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

  const stats = useMemo(() => ({
    open:      orders.filter(o => o.status === "open").length,
    preparing: orders.filter(o => o.status === "preparing").length,
    closed:    orders.filter(o => o.status === "closed" && !o.retiroAt).length,
    retirado:  orders.filter(o => o.status === "closed" && !!o.retiroAt).length,
  }), [orders]);

  return (
    <div className="deposito-orders-panel">
      {/* Contadores de estado */}
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
          <span className="dep-order-kpi-lbl">Listos para retirar</span>
        </div>
        <div className="dep-order-kpi dep-order-kpi--retirado">
          <span className="dep-order-kpi-num">{stats.retirado}</span>
          <span className="dep-order-kpi-lbl">Retirados</span>
        </div>
        {pedidosPorDia && pedidosPorDia.length > 1 && (
          <div className="dep-order-kpi dep-order-kpi--trend">
            <Sparkline data={pedidosPorDia} color="#2563eb" />
            <span className="dep-order-kpi-lbl">Tendencia</span>
          </div>
        )}
      </div>

      {/* Tabs + filtros */}
      <div className="deposito-header-actions" style={{ gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        {[
          { key: "revision_deposito", label: "Por confirmar" },
          { key: "open",      label: "Pendientes" },
          { key: "preparing", label: "En preparación" },
          { key: "closed",    label: "Listos para retirar" },
          { key: "retirado",  label: "Retirados" },
          { key: "devoluciones", label: "Devoluciones" },
        ].map(({ key, label }) => (
          <button key={key} type="button"
            className={`pill pill--ghost${tab === key ? " is-active" : ""}`}
            onClick={() => setTab(key)}
          >{label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <input type="search" className="deposito-search"
          placeholder="Buscar por número, remito, empleado o servicio…"
          value={q} onChange={e => setQ(e.target.value)} />
        <label className="deposito-field" style={{ minWidth: 200 }}>
          <span>Ordenar por</span>
          <select value={sort} onChange={e => setSort(e.target.value)} className="deposito-select">
            <option value="fecha_desc">Fecha — más nuevos primero</option>
            <option value="fecha_asc">Fecha — más viejos primero</option>
            <option value="total_desc">Total — mayor a menor</option>
            <option value="total_asc">Total — menor a mayor</option>
            <option value="id_desc">Número de pedido — descendente</option>
            <option value="id_asc">Número de pedido — ascendente</option>
          </select>
        </label>
      </div>

      {/* Filtros de control por servicio y fecha */}
      {tab !== "devoluciones" && (
        <div className="deposito-header-actions" style={{ gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="deposito-field" style={{ minWidth: 240, flex: "1 1 240px" }}>
            <span>Servicio</span>
            <select value={servicioFilter} onChange={e => setServicioFilter(e.target.value)} className="deposito-select">
              <option value="">Todos los servicios</option>
              {serviciosDisponibles.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="deposito-field">
            <span>Desde</span>
            <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="deposito-select" />
          </label>
          <label className="deposito-field">
            <span>Hasta</span>
            <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="deposito-select" />
          </label>
          {(servicioFilter || desde || hasta || q) && (
            <button type="button" className="pill pill--ghost"
              onClick={() => { setServicioFilter(""); setDesde(""); setHasta(""); setQ(""); }}>
              Limpiar filtros
            </button>
          )}
          <div style={{ flex: 1 }} />
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            {filtered.length} de {orders.length} pedido{orders.length === 1 ? "" : "s"}
          </span>
        </div>
      )}

      {err && <div className="state error deposito-state">{err}</div>}

      {tab === "devoluciones" ? <DevolucionesPendientes /> : (
      <div className="deposito-table-wrapper">
        <table className="deposito-table" aria-label="Pedidos del depósito">
          <thead>
            <tr>
              <th scope="col">Número</th>
              <th scope="col">Remito</th>
              <th scope="col">Empleado</th>
              <th scope="col">Fecha</th>
              <th scope="col" className="deposito-th--numeric">Total</th>
              <th scope="col" style={{ width: 320 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="deposito-empty">Sin resultados para la búsqueda</td></tr>
            )}
            {filtered.map(o => {
              const isExpanded = expandedOrders.has(o.id);
              const hasItems = Array.isArray(o.items) && o.items.length > 0;
              return (
                <React.Fragment key={o.id}>
                  <tr className={`deposito-row${isExpanded ? " deposito-row--expanded" : ""}`}>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>
                      #{o.displayId || String(o.id ?? "").padStart(7, "0")}
                    </td>
                    <td>{remitoNum(o)}</td>
                    <td>
                      <div className="deposito-employee-cell">
                        <span className="deposito-employee-name">{o.empleadoNombre}</span>
                        {o.servicioNombre
                          ? <span className="deposito-service-name">Servicio: {o.servicioNombre}</span>
                          : o.rol
                            ? <span className="deposito-role-badge">{o.rol}</span>
                            : null
                        }
                      </div>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{formatFechaAr(o.fecha)}</td>
                    <td className="deposito-td--numeric" style={{ whiteSpace: "nowrap" }}>
                      {o.total == null ? "—" : money(o.total)}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        {hasItems && (
                          <button type="button" className="pill pill--ghost"
                            onClick={() => toggleExpand(o.id)}
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? "Ocultar detalle" : `Ver detalle (${o.items.length} items)`}
                          </button>
                        )}
                        <button type="button" className="pill pill--ghost" onClick={() => onPreviewRemito(o)}>
                          Ver remito
                        </button>
                        {(tab === "open" || tab === "preparing" || tab === "closed")
                          && String(o.rol || "").toLowerCase() === "supervisor" && (
                          <button type="button" className="pill pill--ghost" onClick={() => toggleEdit(o.id)}
                            style={{ borderColor: "#2563eb", color: "#1d4ed8" }}>
                            {editingOrders.has(o.id) ? "Cerrar edición" : "Editar"}
                          </button>
                        )}
                        {tab === "revision_deposito" && (
                          <button type="button" className="pill" onClick={() => toggleExpand(o.id)}
                            style={{ background: "#2563eb", borderColor: "#1d4ed8" }}>
                            {isExpanded ? "Cerrar" : "Revisar y confirmar"}
                          </button>
                        )}
                        {tab === "open" && (
                          <button type="button" className="pill" onClick={() => moveToPreparing(o.id)}>
                            Preparar
                          </button>
                        )}
                        {tab === "preparing" && (
                          <button type="button" className="pill" onClick={() => closeOrder(o.id)}>
                            Cerrar pedido
                          </button>
                        )}
                        {tab === "closed" && (
                          <button type="button" className="pill"
                            style={{ background: "#16a34a", borderColor: "#15803d" }}
                            onClick={() => markPickup(o.id)}
                          >
                            Marcar como retirado
                          </button>
                        )}
                        {tab === "closed" && (
                          <button type="button" className="pill pill--ghost" onClick={() => reopenOrder(o.id)}>
                            Reabrir
                          </button>
                        )}
                        {tab === "retirado" && (
                          <span className="deposito-retirado-tag">Retirado</span>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Fila expandida: editor si está en revisión, detalle si no */}
                  {isExpanded && tab === "revision_deposito" && (
                    <tr key={`${o.id}-edit`} className="deposito-row--items-container">
                      <td colSpan={6} style={{ padding: 0 }}>
                        <RevisionOrderEditor order={o} onDone={list} />
                      </td>
                    </tr>
                  )}
                  {/* Editor en pestañas de trabajo (no revisión, no retirado) */}
                  {tab !== "revision_deposito" && tab !== "retirado" && editingOrders.has(o.id) && (
                    <tr key={`${o.id}-edit`} className="deposito-row--items-container">
                      <td colSpan={6} style={{ padding: 0 }}>
                        <RevisionOrderEditor order={o} onDone={list} canConfirm={false}
                          seedFaltantes={pickupFaltantes[o.id] || null} />
                      </td>
                    </tr>
                  )}
                  {isExpanded && !editingOrders.has(o.id) && tab !== "revision_deposito" && (
                    <tr key={`${o.id}-items`} className="deposito-row--items-container">
                      <td colSpan={6} style={{ padding: 0 }}>
                        <div className="deposito-items-panel">
                          {/* Tiempos de preparación y retiro */}
                          {(o.fecha || o.closedAt || o.retiroAt) && (
                            <div className="deposito-order-timing">
                              {o.fecha && o.closedAt && (() => {
                                const dur = calcDuration(o.fecha, o.closedAt);
                                return dur
                                  ? <span>Tiempo de preparación: <strong>{dur}</strong></span>
                                  : null;
                              })()}
                              {o.closedAt && o.retiroAt && (() => {
                                const dur = calcDuration(o.closedAt, o.retiroAt);
                                return dur
                                  ? <span>Tiempo hasta retiro: <strong>{dur}</strong></span>
                                  : null;
                              })()}
                              {o.retiroAt && (
                                <span>Retirado el: <strong>{formatFechaAr(o.retiroAt)}</strong></span>
                              )}
                              {o.closedAt && !o.retiroAt && (
                                <span style={{ color: "#d97706" }}>Pendiente de retiro desde: <strong>{formatFechaAr(o.closedAt)}</strong></span>
                              )}
                            </div>
                          )}

                          {hasItems && (
                            <>
                          <div className="deposito-items-title">Insumos del pedido</div>
                          <table className="deposito-items-table">
                            <thead>
                              <tr>
                                <th scope="col">Código</th>
                                <th scope="col">Nombre del insumo</th>
                                <th scope="col" className="numeric">Cantidad</th>
                                <th scope="col" className="numeric">Precio unitario</th>
                                <th scope="col" className="numeric">Subtotal</th>
                              </tr>
                            </thead>
                            <tbody>
                              {o.items.map((item, idx) => (
                                <tr key={idx}>
                                  <td>
                                    {item.codigo
                                      ? <span className="deposito-code">{item.codigo}</span>
                                      : <span style={{ color: "#9ca3af" }}>—</span>
                                    }
                                  </td>
                                  <td>{item.nombre}</td>
                                  <td className="numeric">{fmt(item.cantidad)}</td>
                                  <td className="numeric">{money(item.precio)}</td>
                                  <td className="numeric">{money(item.subtotal)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
         </table>
      </div>
      )}

      {/* Vista previa del remito */}
      {(selected || previewErr) && (
        <div style={{ marginTop: 16 }}>
          <div className="section-header">
            {selected && (
              <div className="muted">
                Remito #{String(selected.id).padStart(7, "0")} —{" "}
                <strong>{selected.empleadoNombre}</strong>
                {selected.servicioNombre && ` — ${selected.servicioNombre}`}
              </div>
            )}
            <div className="actions-row">
              {pdfUrl && <a href={pdfUrl} target="_blank" rel="noreferrer" className="pill pill--ghost">Abrir en nueva pestaña</a>}
              <button className="pill pill--ghost" onClick={closePreview}>Cerrar</button>
            </div>
          </div>
          {previewErr && <div className="state error deposito-state">{previewErr}</div>}
          {pdfUrl && !previewErr && (
            <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid #d1d5db", height: 540, background: "#1e293b" }}>
              <iframe title={`Remito #${selected?.id}`} src={pdfUrl} style={{ width: "100%", height: "100%", border: "none" }} />
            </div>
          )}
          {!pdfUrl && !previewErr && previewLoading && (
            <div className="deposito-state">Cargando remito…</div>
          )}
        </div>
      )}
    </div>
  );
}


export default function Deposito() {
  const { user } = useAuth();
  const roles = (user?.roles || []).map(r => String(r).toLowerCase());
  const puedeVer = roles.includes("deposito");

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

  // El panel abre directo en Pedidos. La vista "Stock y alertas" queda en el
  // código pero sin botón que la active. Para reactivarla, cambiar este valor
  // inicial a "overview" y volver a mostrar el switcher del topbar.
  const [activeView] = useState("pedidos");

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
    // La vista de stock está oculta: no traer overview salvo que se reactive.
    if (activeView !== "overview") return;
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
  }, [start, end, threshold, fechaInvalida, activeView]);

  const setQuickRange = (type) => {
    const today = isoToday();
    const map = {
      "7d":    [isoNDaysAgo(7), today],
      "30d":   [isoNDaysAgo(30), today],
      "month": [isoFirstOfMonth(), today],
      "year":  [isoFirstOfYear(), today],
    };
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

    let covSum = 0, covCount = 0;
    for (const r of low) {
      const c = calcCoverageDays(r.stock, consumos[String(r.productId)]);
      if (c != null) { covSum += c; covCount++; }
    }
    const avgCoverage = covCount > 0 ? covSum / covCount : null;

    const top5 = top.slice(0, 5).map((r, i) => ({ pedidos: Number(r.total || 0), i }));

    return {
      totalConsumido,
      productosTop: top.length,
      productosBajo: low.length,
      productosSinStock,
      productosEnRiesgo,
      bajoResto,
      riesgoLimite,
      avgCoverage,
      top5,
    };
  }, [top, low, threshold, riskPercent, consumos]);

  const topFiltrados = useMemo(() => {
    let rows = top;
    if (searchTop.trim()) {
      const q = searchTop.trim().toLowerCase();
      rows = rows.filter(r =>
        String(r.name || "").toLowerCase().includes(q) ||
        String(r.code || "").toLowerCase().includes(q) ||
        String(r.unit || "").toLowerCase().includes(q)
      );
    }
    return sortByField(rows, sortTop.field, sortTop.dir);
  }, [top, searchTop, sortTop]);

  const lowFiltrados = useMemo(() => {
    let rows = low;
    if (searchLow.trim()) {
      const q = searchLow.trim().toLowerCase();
      rows = rows.filter(r =>
        String(r.name || "").toLowerCase().includes(q) ||
        String(r.code || "").toLowerCase().includes(q)
      );
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
      if (field === "stock")    return Number(row.stock || 0);
      if (field === "consumido") return Number(d.consumido || 0);
      if (field === "incoming") return Number(d.incoming_total || 0);
      if (field === "coverage") return calcCoverageDays(row.stock, d);
      if (field === "name")     return row.name || "";
      if (field === "code")     return row.code || "";
      return null;
    };
    return sortByField(rows, sortLow.field, sortLow.dir, getValue);
  }, [low, searchLow, sortLow, consumos, lowFilter, threshold, riskPercent]);

  const handleSortTop = (field) => setSortTop(prev => ({ field, dir: prev.field === field ? (prev.dir === "asc" ? "desc" : "asc") : "desc" }));
  const handleSortLow = (field) => setSortLow(prev => ({ field, dir: prev.field === field ? (prev.dir === "asc" ? "desc" : "asc") : "asc" }));
  const sortIndicator = (current, field) => current.field === field ? (current.dir === "asc" ? " ▲" : " ▼") : "";

  const handleExportLowCsv = () => {
    if (!lowFiltrados.length) return;
    const header = ["Código", "Producto", "Stock actual", "Consumo desde último ingreso", "Fecha último ingreso", "Ingreso futuro", "Próxima ETA", "Cobertura en días"];
    const rows = lowFiltrados.map(r => {
      const d = consumos[String(r.productId)] || {};
      const coverage = calcCoverageDays(r.stock, d);
      return [
        r.code || "",
        r.name || "",
        r.stock,
        d.consumido ?? "",
        d.last_ingreso ? String(d.last_ingreso).slice(0, 10) : "",
        d.incoming_total ?? "",
        d.next_eta ? String(d.next_eta).slice(0, 10) : "",
        coverage != null ? coverage.toFixed(1) : "",
      ];
    });
    const csv = [header, ...rows].map(r => r.map(v => String(v).includes(";") ? `"${v}"` : v).join(";")).join("\n");
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" })),
      download: `stock_bajo_${start}_${end}.csv`,
    });
    a.click();
  };

  // Solo el rol depósito ve este panel. (El backend sigue permitiendo también a
  // admin porque el "Stock crítico" del panel admin usa /deposito/overview.)
  if (user && !puedeVer) return <Navigate to="/app" replace />;

  return (
    <section className="admin-panel deposito-page">
      <div className="dep-topbar">
        <h1 className="deposito-title">Panel de Depósito</h1>
      </div>

      {/* Filtros globales de stock: ocultos mientras la vista es Pedidos.
          Se muestran solo si se reactiva la vista "Stock y alertas". */}
      {activeView === "overview" && (
      <div className="filters deposito-filters">
        <label className="deposito-field">
          <span>Fecha desde</span>
          <input type="date" value={start} onChange={e => setStart(e.target.value)} />
        </label>
        <label className="deposito-field">
          <span>Fecha hasta</span>
          <input type="date" value={end} onChange={e => setEnd(e.target.value)} />
        </label>
        <label className="deposito-field">
          <span>Umbral de stock bajo</span>
          <input type="number" min="0" value={thresholdInput}
            onChange={e => { if (e.target.value === "" || /^\d*$/.test(e.target.value)) setThresholdInput(e.target.value); }} />
        </label>
        <label className="deposito-field">
          <span>Porcentaje de riesgo</span>
          <input type="number" min="1" max="100" value={riskPercentInput}
            onChange={e => { if (e.target.value === "" || /^\d*$/.test(e.target.value)) setRiskPercentInput(e.target.value); }} />
        </label>
        <div className="deposito-quickranges">
          <span className="deposito-quickranges-label">Rangos rápidos</span>
          <div className="deposito-quickranges-buttons">
            {[["7d", "7 días"], ["30d", "30 días"], ["month", "Este mes"], ["year", "Este año"]].map(([k, l]) => (
              <button key={k} type="button" className="pill pill--ghost" onClick={() => setQuickRange(k)}>{l}</button>
            ))}
          </div>
        </div>
      </div>
      )}

      {fechaInvalida && <div className="state error deposito-state">El rango de fechas es inválido: la fecha de inicio debe ser anterior a la fecha de fin.</div>}
      {loading && <div className="deposito-state">Cargando datos…</div>}
      {error && !loading && <div className="state error deposito-state">{error}</div>}

      {/* ===== VISTA STOCK & KPIs ===== */}
      {activeView === "overview" && !loading && !error && !fechaInvalida && (
        <>
          {/* KPI Cards */}
          <div className="deposito-summary dep-kpi-grid">

            <div className="deposito-summary-card deposito-summary-card--main">
              <div className="deposito-summary-label">Consumo total (unidades)</div>
              <div className="deposito-summary-value">{fmt(resumen.totalConsumido)}</div>
              <div className="deposito-summary-sub">{start} al {end}</div>
            </div>

            <div className="deposito-summary-card">
              <div className="deposito-summary-label">Productos con consumo registrado</div>
              <div className="deposito-summary-value">{resumen.productosTop}</div>
              <div className="deposito-summary-sub">en el período seleccionado</div>
              {resumen.top5.length > 1 && <Sparkline data={resumen.top5.map(d => ({ pedidos: d.pedidos }))} color="#2563eb" width={100} height={28} />}
            </div>

            <div className="deposito-summary-card deposito-summary-card--alert">
              <div className="deposito-summary-label">Distribución de alertas de stock</div>
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
              <div className="deposito-summary-label">Cobertura promedio de stock</div>
              <div className="deposito-summary-value">
                {resumen.avgCoverage != null ? `${resumen.avgCoverage.toFixed(0)} días` : "—"}
              </div>
              <div className="deposito-summary-sub">
                {resumen.avgCoverage != null
                  ? resumen.avgCoverage < 7
                    ? "Cobertura crítica — requiere atención inmediata"
                    : resumen.avgCoverage < 15
                      ? "Cobertura baja — revisar reabastecimiento"
                      : "Cobertura aceptable"
                  : "Sin datos de consumo suficientes"
                }
              </div>
              <div className="deposito-summary-sub">
                Umbral configurado: {threshold} unidades · Zona de riesgo: {riskPercent}%
              </div>
            </div>
          </div>

          {/* Grid de tablas */}
          <div className="deposito-grid">

            {/* Más consumidos */}
            <div className="card deposito-card">
              <div className="card-header deposito-card-header">
                <div>
                  <h2>Insumos más consumidos</h2>
                  <small>{start} al {end}</small>
                </div>
                <div className="deposito-header-actions">
                  <input type="search" className="deposito-search"
                    placeholder="Buscar por nombre o código…"
                    value={searchTop}
                    onChange={e => setSearchTop(e.target.value)} />
                </div>
              </div>

              {topFiltrados.length > 0 && (
                <div style={{ padding: "0.5rem 0.75rem 0.25rem" }}>
                  <MiniBarChart data={topFiltrados} maxItems={8} />
                </div>
              )}

              <div className="deposito-table-wrapper" style={{ maxHeight: "38vh" }}>
                <table className="deposito-table" aria-label="Insumos más consumidos">
                  <thead>
                    <tr>
                      <th onClick={() => handleSortTop("name")} className="deposito-th--sortable" scope="col">
                        Nombre del insumo{sortIndicator(sortTop, "name")}
                      </th>
                      <th onClick={() => handleSortTop("code")} className="deposito-th--sortable" scope="col">
                        Código{sortIndicator(sortTop, "code")}
                      </th>
                      <th onClick={() => handleSortTop("unit")} className="deposito-th--sortable" scope="col">
                        Unidad{sortIndicator(sortTop, "unit")}
                      </th>
                      <th onClick={() => handleSortTop("total")} className="deposito-th--sortable deposito-th--numeric" scope="col">
                        Total consumido{sortIndicator(sortTop, "total")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {topFiltrados.length === 0 && (
                      <tr><td colSpan={4} className="deposito-empty">Sin consumos registrados en el período</td></tr>
                    )}
                    {topFiltrados.map(r => (
                      <tr key={r.productId} className="deposito-row">
                        <td>{r.name}</td>
                        <td>
                          {r.code
                            ? <span className="deposito-code">{r.code}</span>
                            : <span style={{ color: "#9ca3af" }}>—</span>
                          }
                        </td>
                        <td>{r.unit || "—"}</td>
                        <td className="deposito-td--numeric">{fmt(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Stock bajo */}
            <div className="card deposito-card deposito-card--alert">
              <div className="card-header deposito-card-header">
                <div><h2>Insumos con stock bajo</h2></div>
                <div className="deposito-header-actions">
                  <div className="deposito-lowfilter">
                    {[
                      ["all",       `Todos (${resumen.productosBajo})`],
                      ["sin-stock", `Sin stock (${resumen.productosSinStock})`],
                      ["riesgo",    `En riesgo (${resumen.productosEnRiesgo})`],
                      ["bajo",      `Bajo umbral (${resumen.bajoResto})`],
                    ].map(([k, l]) => (
                      <button key={k} type="button"
                        className={`pill pill--ghost deposito-lowfilter-btn${lowFilter === k ? " is-active" : ""}`}
                        onClick={() => setLowFilter(k)}
                      >{l}</button>
                    ))}
                  </div>
                  <input type="search" className="deposito-search"
                    placeholder="Buscar por nombre o código…"
                    value={searchLow}
                    onChange={e => setSearchLow(e.target.value)} />
                  <button type="button" className="pill deposito-export-btn"
                    onClick={handleExportLowCsv}
                    disabled={!lowFiltrados.length}
                  >
                    Exportar CSV
                  </button>
                </div>
              </div>

              <div className="deposito-table-wrapper">
                <table className="deposito-table" aria-label="Insumos con stock bajo">
                  <thead>
                    <tr>
                      <th onClick={() => handleSortLow("name")} className="deposito-th--sortable" scope="col">
                        Nombre del insumo{sortIndicator(sortLow, "name")}
                      </th>
                      <th onClick={() => handleSortLow("code")} className="deposito-th--sortable" scope="col">
                        Código{sortIndicator(sortLow, "code")}
                      </th>
                      <th onClick={() => handleSortLow("stock")} className="deposito-th--sortable deposito-th--numeric" scope="col">
                        Stock actual{sortIndicator(sortLow, "stock")}
                      </th>
                      <th onClick={() => handleSortLow("consumido")} className="deposito-th--sortable deposito-th--numeric" scope="col">
                        Consumido{sortIndicator(sortLow, "consumido")}
                      </th>
                      <th onClick={() => handleSortLow("incoming")} className="deposito-th--sortable deposito-th--numeric" scope="col">
                        Ingreso futuro{sortIndicator(sortLow, "incoming")}
                      </th>
                      <th onClick={() => handleSortLow("coverage")} className="deposito-th--sortable deposito-th--numeric" scope="col">
                        Cobertura{sortIndicator(sortLow, "coverage")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowFiltrados.length === 0 && (
                      <tr><td colSpan={6} className="deposito-empty">No hay insumos con alerta de stock bajo</td></tr>
                    )}
                    {lowFiltrados.map(r => {
                      const d = consumos[String(r.productId)] || {};
                      const stockActual = Number(r.stock || 0);
                      const coverage = calcCoverageDays(stockActual, d);
                      const riesgoLimite = threshold > 0 ? Math.floor(threshold * (riskPercent / 100)) : 0;
                      const sinStock = stockActual <= 0;
                      const enRiesgo = !sinStock && riesgoLimite > 0 && stockActual <= riesgoLimite;
                      const ratio = threshold > 0 ? Math.max(0, Math.min(stockActual / threshold, 1)) : 0;
                      const stockColor = ratio >= 0.6 ? "#16a34a" : ratio >= 0.3 ? "#d97706" : "#dc2626";

                      return (
                        <tr key={r.productId}
                          className={`deposito-row${sinStock ? " deposito-row--sin-stock" : enRiesgo ? " deposito-row--riesgo" : ""}`}
                        >
                          <td>
                            <div className="deposito-product-cell">
                              <span className="deposito-product-name">
                                {r.name}
                                {sinStock && <span className="deposito-badge deposito-badge--danger">SIN STOCK</span>}
                                {!sinStock && enRiesgo && <span className="deposito-badge deposito-badge--warning">EN RIESGO</span>}
                              </span>
                            </div>
                          </td>
                          <td>
                            {r.code
                              ? <span className="deposito-code">{r.code}</span>
                              : <span style={{ color: "#9ca3af" }}>—</span>
                            }
                          </td>
                          <td className="deposito-td--numeric">
                            {fmt(stockActual)}
                            <div className="deposito-stockbar" style={{ "--ratio": ratio }} aria-hidden="true">
                              <div className="deposito-stockbar-fill" style={{ background: stockColor }} />
                            </div>
                          </td>
                          <td className="deposito-td--numeric">
                            {d.consumido == null ? "—" : fmt(d.consumido)}
                            {d.last_ingreso && (
                              <div className="deposito-subtext">
                                desde {String(d.last_ingreso).slice(0, 10)}
                              </div>
                            )}
                          </td>
                          <td className="deposito-td--numeric">
                            {d.incoming_total ? fmt(d.incoming_total) : "—"}
                            {d.next_eta && (
                              <div className="deposito-subtext">
                                Llega: {String(d.next_eta).slice(0, 10)}
                              </div>
                            )}
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

              <div className="deposito-legend">
                <span className="legend-dot legend-danger" /><span>Sin stock (0 unidades): <b>{resumen.productosSinStock}</b></span>
                {resumen.riesgoLimite > 0 && (
                  <>
                    <span className="legend-dot legend-warning" />
                    <span>En riesgo (1 a {resumen.riesgoLimite} unidades): <b>{resumen.productosEnRiesgo}</b></span>
                  </>
                )}
                <span className="legend-dot legend-neutral" /><span>Bajo umbral configurado: <b>{resumen.bajoResto}</b></span>
              </div>
              <p className="deposito-footnote">
                Para registrar ingresos futuros, ir a Panel Administrativo → Ingreso futuro de stock.
              </p>
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
