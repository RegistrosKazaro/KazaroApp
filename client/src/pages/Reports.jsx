// client/src/pages/Reports.jsx
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import "../styles/reports.css";

const NOW = new Date();
const CURRENT_YEAR = NOW.getFullYear();
const CURRENT_MONTH = NOW.getMonth() + 1;

function monthNameEs(m) {
  const names = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  return names[Math.max(1, Math.min(12, Number(m) || 1)) - 1];
}
function niceNumber(n) { return new Intl.NumberFormat("es-AR").format(Number(n || 0)); }
function niceCurrency(n) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 }).format(Number(n || 0));
}
// Parsea "YYYY-MM-DD" descomponiendo manualmente año/mes/día
// Evita CUALQUIER problema de timezone — new Date(y, m, d) siempre es hora local
function parseLocalDate(d) {
  if (!d) return new Date(NaN);
  const s = String(d).slice(0, 10); // asegurar "YYYY-MM-DD"
  const [y, m, day] = s.split("-").map(Number);
  if (!y || !m || !day) return new Date(NaN);
  return new Date(y, m - 1, day); // new Date(año, mes-1, día) = siempre local, nunca UTC
}

function niceDate(d) {
  if (!d) return "";
  return String(d).slice(0, 10); // devolver el string directamente, sin pasar por Date
}

/* ================================================================
   GRÁFICOS Y COMPONENTES VISUALES
   ================================================================ */

function HorizontalBarChart({ data, valueKey, labelKey, valueFormatter, showPercent = true }) {
  if (!data?.length) return null;
  const numericValues = data.map(d => Number(d[valueKey] || 0));
  const maxVal = Math.max(...numericValues, 0);
  const sumVal = numericValues.reduce((a, v) => a + v, 0);
  if (maxVal <= 0) return null;
  const PALETTE = ["#0ea5e9","#38bdf8","#7dd3fc","#0369a1","#2563eb","#4f46e5","#7c3aed","#a21caf","#db2777","#e11d48"];
  return (
    <div className="rp-hbarchart">
      {data.map((item, idx) => {
        const raw = Number(item[valueKey] || 0);
        const pctOfMax = maxVal > 0 ? (raw / maxVal) * 100 : 0;
        const pctOfTotal = sumVal > 0 ? Math.round((raw / sumVal) * 100) : 0;
        const label = String(item[labelKey] ?? "").trim() || "—";
        const color = PALETTE[idx % PALETTE.length];
        return (
          <div key={idx} className="rp-hbarchart-row">
            <div className="rp-hbarchart-label" title={label}>
              <span className="rp-hbarchart-rank">{idx + 1}</span>
              <span className="rp-hbarchart-name">{label}</span>
            </div>
            <div className="rp-hbarchart-track">
              <div className="rp-hbarchart-fill" style={{ width: `${Math.max(4, pctOfMax)}%`, background: color }} />
            </div>
            <div className="rp-hbarchart-values">
              <span>{valueFormatter ? valueFormatter(raw) : niceNumber(raw)}</span>
              {showPercent && <span className="rp-hbarchart-pct">{pctOfTotal}%</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BarChartByDay({ data, valueKey = "pedidos" }) {
  if (!data?.length) return null;
  const values = data.map(d => Number(d[valueKey] ?? 0));
  const maxVal = Math.max(...values, 0);
  if (maxVal <= 0) return null;
  const avg = values.reduce((a, v) => a + v, 0) / values.length;
  return (
    <div className="rp-daychart">
      {data.map((d, i) => {
        const v = Number(d[valueKey] ?? 0);
        const pct = maxVal > 0 ? (v / maxVal) * 100 : 0;
        const h = Math.max(6, pct);
        const label = (d.day && String(d.day).slice(8, 10)) || String(d.day || "");
        const isWeekend = (() => { if (!d.day) return false; const dow = parseLocalDate(d.day).getDay(); return dow === 0 || dow === 6; })();
        const isAboveAvg = v > avg * 1.3;
        return (
          <div key={i} className="rp-daychart-col">
            {v > 0 && <span className="rp-daychart-val">{v}</span>}
            <div className="rp-daychart-track" title={`${d.day}: ${niceNumber(v)}`}>
              <div className="rp-daychart-bar" style={{
                height: `${h}%`,
                background: isAboveAvg ? "linear-gradient(180deg,#f97316,#ea580c)" : isWeekend ? "linear-gradient(180deg,#7dd3fc,#38bdf8)" : "linear-gradient(180deg,#0ea5e9,#0369a1)"
              }} />
            </div>
            <span className="rp-daychart-lbl" style={{ color: isWeekend ? "#0ea5e9" : "#6b7280" }}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function MoneyChartByDay({ data }) { return <BarChartByDay data={data} valueKey="monto" />; }

function YearBarChart({ months, valueKey, valueFormatter }) {
  if (!months?.length) return null;
  const vals = months.map(m => Number(m[valueKey] || 0));
  const maxVal = Math.max(...vals, 0);
  if (maxVal <= 0) return null;
  return (
    <div className="rp-yearchart">
      {months.map((m) => {
        const v = Number(m[valueKey] || 0);
        const pct = maxVal > 0 ? (v / maxVal) * 100 : 0;
        return (
          <div key={m.month} className="rp-yearchart-col" title={`${monthNameEs(m.month)}: ${valueFormatter ? valueFormatter(v) : niceNumber(v)}`}>
            <div className="rp-yearchart-track">
              <div className="rp-yearchart-bar" style={{ height: `${Math.max(4, pct)}%` }} />
            </div>
            <div className="rp-yearchart-lbl">{monthNameEs(m.month).slice(0, 3)}</div>
          </div>
        );
      })}
    </div>
  );
}

function BudgetBar({ used, budget }) {
  if (!budget || budget <= 0) return null;
  const pct = Math.min((used / budget) * 100, 100);
  const color = pct >= 90 ? "#ef4444" : pct >= 70 ? "#f97316" : "#22c55e";
  return (
    <div className="rp-budgetbar">
      <div className="rp-budgetbar-track">
        <div className="rp-budgetbar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="rp-budgetbar-pct" style={{ color }}>{pct.toFixed(1)}%</span>
    </div>
  );
}

function Sparkline({ data, color = "#0ea5e9", width = 100, height = 32, trendOverride }) {
  if (!data || data.length < 2) return null;
  const vals = data.map(d => Number(d.monto ?? d.pedidos ?? 0));
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  // Si hay trendOverride (comparativa mes vs mes anterior), usarlo
  // Si no, comparar primera mitad vs segunda mitad del mes (más representativo que último día vs penúltimo)
  let trend, trendColor;
  if (trendOverride !== undefined) {
    trend = trendOverride > 0 ? "▲" : trendOverride < 0 ? "▼" : "—";
    trendColor = trendOverride > 0 ? "#22c55e" : trendOverride < 0 ? "#ef4444" : "#9ca3af";
  } else {
    const mid = Math.floor(vals.length / 2);
    const firstHalf  = vals.slice(0, mid).reduce((a, v) => a + v, 0);
    const secondHalf = vals.slice(mid).reduce((a, v) => a + v, 0);
    trend = secondHalf > firstHalf ? "▲" : secondHalf < firstHalf ? "▼" : "—";
    trendColor = secondHalf > firstHalf ? "#22c55e" : secondHalf < firstHalf ? "#ef4444" : "#9ca3af";
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <svg width={width} height={height}>
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span style={{ color: trendColor, fontWeight: 700, fontSize: "0.85rem" }}>{trend}</span>
    </div>
  );
}

function ServicePieChart({ data }) {
  if (!data?.length) return null;
  const total = data.reduce((s, d) => s + Number(d.amount || 0), 0);
  if (total <= 0) return null;
  const PALETTE = ["#0ea5e9","#0369a1","#38bdf8","#7dd3fc","#2563eb","#4f46e5","#7c3aed","#a21caf"];
  const SIZE = 100, CX = 50, CY = 50, R = 38;
  const circ = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="rp-pie">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ transform: "rotate(-90deg)" }}>
        {data.slice(0, 8).map((d, i) => {
          const pct = Number(d.amount || 0) / total;
          const dash = pct * circ, gap = circ - dash;
          const el = <circle key={i} cx={CX} cy={CY} r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth={24} strokeDasharray={`${dash} ${gap}`} strokeDashoffset={-offset * circ} />;
          offset += pct;
          return el;
        })}
        <circle cx={CX} cy={CY} r={20} fill="white" />
      </svg>
      <div className="rp-pie-legend">
        {data.slice(0, 6).map((d, i) => (
          <div key={i} className="rp-pie-item">
            <span className="rp-pie-dot" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="rp-pie-name">{d._label || d.serviceName || "—"}</span>
            <span className="rp-pie-pct">{total > 0 ? Math.round((Number(d.amount || 0) / total) * 100) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ value, thresholds, labels }) {
  const [warn, danger] = thresholds || [70, 90];
  const n = Number(value || 0);
  const color = n >= danger ? "#ef4444" : n >= warn ? "#f97316" : "#22c55e";
  const bg = n >= danger ? "#fef2f2" : n >= warn ? "#fff7ed" : "#f0fdf4";
  const label = n >= danger ? (labels?.[2] || "Crítico") : n >= warn ? (labels?.[1] || "Atención") : (labels?.[0] || "Normal");
  return (
    <span className="rp-status-badge" style={{ background: bg, color, borderColor: color }}>
      <span className="rp-status-dot" style={{ background: color }} />
      {label}
    </span>
  );
}

function DeltaBadge({ current, previous, formatter }) {
  if (previous == null || previous === 0) return null;
  const delta = current - previous;
  const pct = (delta / previous) * 100;
  const isUp   = delta > 0;
  const isDown = delta < 0;
  const color = isUp ? "#22c55e" : isDown ? "#ef4444" : "#9ca3af";
  const arrow = isUp ? "▲" : isDown ? "▼" : "—";
  return (
    <span className="rp-delta-badge" style={{ color }}>
      {arrow} {Math.abs(pct).toFixed(1)}%
      {formatter && <span style={{ fontSize: "0.7rem", marginLeft: 3, fontWeight: 900 }}>({formatter(Math.abs(delta))})</span>}
    </span>
  );
}

function RankTable({ rows, columns, emptyMsg = "Sin datos" }) {
  if (!rows?.length) return <p className="rp-empty-msg">{emptyMsg}</p>;
  return (
    <div className="reports-table-wrapper">
      <table className="reports-table">
        <thead>
          <tr>
            <th style={{ width: 36 }}>#</th>
            {columns.map((c, i) => <th key={i} className={c.numeric ? "numeric" : ""}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>
                <span className="rp-rank-num" style={{
                  background: i === 0 ? "#fbbf24" : i === 1 ? "#94a3b8" : i === 2 ? "#f97316" : "#f1f5f9",
                  color: i < 3 ? "#fff" : "#374151"
                }}>{i + 1}</span>
              </td>
              {columns.map((c, j) => (
                <td key={j} className={c.numeric ? "numeric" : ""}>
                  {c.render ? c.render(row) : (row[c.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WeekdayHeatmap({ data }) {
  if (!data?.length) return null;
  const dias = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
  const byDow = [0,0,0,0,0,0,0];
  const countDow = [0,0,0,0,0,0,0];
  data.forEach(d => {
    if (!d.day) return;
    const dow = parseLocalDate(d.day).getDay();
    byDow[dow] += Number(d.pedidos || 0);
    countDow[dow]++;
  });
  const avgs = byDow.map((sum, i) => countDow[i] > 0 ? sum / countDow[i] : 0);
  const maxAvg = Math.max(...avgs, 0.01);
  return (
    <div className="rp-heatmap">
      {avgs.map((avg, i) => {
        const intensity = avg / maxAvg;
        return (
          <div key={i} className="rp-heatmap-cell" title={`${dias[i]}: ${avg.toFixed(1)} pedidos prom.`}>
            <div className="rp-heatmap-bar" style={{ background: `rgba(14,165,233,${0.1 + intensity * 0.85})`, height: `${Math.max(8, intensity * 100)}%` }} />
            <span className="rp-heatmap-label">{dias[i]}</span>
            <span className="rp-heatmap-val">{avg > 0 ? avg.toFixed(1) : "—"}</span>
          </div>
        );
      })}
    </div>
  );
}

function ConcentrationMeter({ data, valueKey, label }) {
  if (!data?.length) return null;
  const vals = data.map(d => Number(d[valueKey] || 0));
  const total = vals.reduce((s, v) => s + v, 0);
  if (total === 0) return null;
  const hhi = vals.reduce((s, v) => s + Math.pow(v / total, 2), 0);
  const pct = Math.round(hhi * 100);
  const level = hhi > 0.5 ? "Alta" : hhi > 0.25 ? "Media" : "Baja";
  const color = hhi > 0.5 ? "#ef4444" : hhi > 0.25 ? "#f97316" : "#22c55e";
  return (
    <div className="rp-concentration">
      <div className="rp-concentration-label">{label}</div>
      <div className="rp-concentration-track">
        <div className="rp-concentration-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="rp-concentration-value" style={{ color }}>Concentración {level}</span>
      <span className="rp-concentration-hint">
        {hhi > 0.5 ? "Pocas unidades concentran la mayoría del consumo"
          : hhi > 0.25 ? "Distribución moderada entre unidades"
          : "Consumo bien distribuido entre todas las unidades"}
      </span>
    </div>
  );
}

/* ================================================================
   NUEVOS COMPONENTES PARA TRAZABILIDAD MEJORADA
   ================================================================ */

/** Tarjeta de KPI de trazabilidad con tendencia y desglose */
function TraceKpiCard({ icon, label, qty, amount, alertColor, note, badge }) {
  return (
    <div className={`rp-trace-kpi-card${alertColor ? " rp-trace-kpi-card--alert" : ""}`}>
      <div className="rp-trace-kpi-icon">{icon}</div>
      <div className="rp-trace-kpi-body">
        <div className="rp-trace-kpi-label">{label}</div>
        <div className="rp-trace-kpi-qty" style={alertColor ? { color: alertColor } : {}}>
          {niceNumber(qty)} <span className="rp-trace-kpi-unit">unid.</span>
        </div>
        <div className="rp-trace-kpi-amount">{niceCurrency(amount)}</div>
        {note && <div className="rp-trace-kpi-note">{note}</div>}
        {badge && badge}
      </div>
    </div>
  );
}

/** Balance visual ingreso vs salida */
function BalanceVisual({ inQty, outQty, inAmount, outAmount }) {
  const totalQ = Math.max(inQty + outQty, 1);
  const inPct = Math.round((inQty / totalQ) * 100);
  const outPct = 100 - inPct;
  const balanceQ = inQty - outQty;
  const balanceA = inAmount - outAmount;
  const isPositive = balanceQ >= 0;
  return (
    <div className="rp-balance-visual">
      <div className="rp-balance-row">
        <div className="rp-balance-side rp-balance-side--in">
          <span className="rp-balance-side-icon">📥</span>
          <span className="rp-balance-side-label">Ingresos</span>
          <strong>{niceNumber(inQty)} ud.</strong>
          <span className="rp-balance-side-amount">{niceCurrency(inAmount)}</span>
        </div>
        <div className="rp-balance-bar-wrap">
          <div className="rp-balance-bar">
            <div className="rp-balance-bar-in" style={{ width: `${inPct}%` }} title={`${inPct}% ingresos`} />
            <div className="rp-balance-bar-out" style={{ width: `${outPct}%` }} title={`${outPct}% salidas`} />
          </div>
          <div className="rp-balance-net" style={{ color: isPositive ? "#22c55e" : "#ef4444" }}>
            {isPositive ? "▲" : "▼"} Balance neto: {niceNumber(Math.abs(balanceQ))} ud. · {niceCurrency(Math.abs(balanceA))}
          </div>
        </div>
        <div className="rp-balance-side rp-balance-side--out">
          <span className="rp-balance-side-icon">📤</span>
          <span className="rp-balance-side-label">Salidas</span>
          <strong>{niceNumber(outQty)} ud.</strong>
          <span className="rp-balance-side-amount">{niceCurrency(outAmount)}</span>
        </div>
      </div>
    </div>
  );
}

/** Observaciones / panel de calidad */
function ObservacionesPanel({ items, emptyMsg = "Sin observaciones registradas." }) {
  if (!items?.length) return (
    <div className="rp-obs-empty">
      <span>📋</span>
      <p>{emptyMsg}</p>
    </div>
  );
  return (
    <div className="rp-obs-list">
      {items.map((obs, i) => (
        <div key={i} className={`rp-obs-item rp-obs-item--${obs.type || "info"}`}>
          <span className="rp-obs-icon">{obs.type === "warn" ? "⚠️" : obs.type === "error" ? "🔴" : "📝"}</span>
          <div className="rp-obs-body">
            <div className="rp-obs-product">{obs.product || "General"}</div>
            <div className="rp-obs-text">{obs.text}</div>
            {obs.date && <div className="rp-obs-date">{niceDate(obs.date)}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Tabla top con barra de progreso inline */
function TopProductTable({ rows, title, columns, colorFn, emptyMsg }) {
  if (!rows?.length) return <p className="rp-empty-msg">{emptyMsg || "Sin datos."}</p>;
  const maxVal = Math.max(...rows.map(r => Number(r._sortVal || r.qty || r.amount || 0)), 1);
  return (
    <div className="rp-top-product-table">
      {title && <h4 className="rp-top-table-title">{title}</h4>}
      {rows.map((row, i) => {
        const val = Number(row._sortVal || row.qty || row.amount || 0);
        const pct = Math.max(4, (val / maxVal) * 100);
        const color = colorFn ? colorFn(i) : ["#0ea5e9","#38bdf8","#7dd3fc","#0369a1","#2563eb","#4f46e5","#7c3aed","#a21caf"][i % 8];
        return (
          <div key={i} className="rp-top-row">
            <div className="rp-top-row-header">
              <span className="rp-rank-num" style={{
                background: i === 0 ? "#fbbf24" : i === 1 ? "#94a3b8" : i === 2 ? "#f97316" : "#e5e7eb",
                color: i < 3 ? "#fff" : "#374151"
              }}>{i + 1}</span>
              <span className="rp-top-row-name" title={row.name || row.code || "—"}>{row.name || row.code || "—"}</span>
              {row.code && row.name && <span className="rp-top-row-code">{row.code}</span>}
            </div>
            <div className="rp-top-row-bar-wrap">
              <div className="rp-top-row-bar" style={{ width: `${pct}%`, background: color }} />
            </div>
            <div className="rp-top-row-values">
              {columns.map((col, j) => (
                <span key={j} className="rp-top-row-val">
                  <span className="rp-top-row-val-label">{col.label}</span>
                  <strong>{col.render ? col.render(row) : (row[col.key] ?? "—")}</strong>
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Resumen ejecutivo de trazabilidad */
function ResumenEjecutivo({ summary, topUsed, topExpensive, supervisors, byService, monthLabel }) {
  const topProducto = topUsed?.[0];
  const topCaro = topExpensive?.[0];
  const topSupervisor = supervisors?.[0];
  const topServicio = byService?.[0];
  const balance = (summary?.balanceQty ?? 0);
  const isPositive = balance >= 0;

  return (
    <div className="rp-exec-summary">
      <div className="rp-exec-summary-header">
        <span className="rp-exec-summary-icon">📊</span>
        <div>
          <h4 className="rp-exec-summary-title">Resumen Ejecutivo — {monthLabel}</h4>
          <p className="rp-exec-summary-sub">Principales indicadores de trazabilidad del período</p>
        </div>
      </div>
      <div className="rp-exec-grid">
        <div className="rp-exec-item rp-exec-item--green">
          <span className="rp-exec-item-icon">✅</span>
          <div>
            <div className="rp-exec-item-label">Total ingresado</div>
            <div className="rp-exec-item-value">{niceNumber(summary?.totalIncomingQty ?? 0)} ud.</div>
            <div className="rp-exec-item-sub">{niceCurrency(summary?.totalIncomingAmount ?? 0)}</div>
          </div>
        </div>
        <div className="rp-exec-item rp-exec-item--blue">
          <span className="rp-exec-item-icon">📤</span>
          <div>
            <div className="rp-exec-item-label">Total despachado</div>
            <div className="rp-exec-item-value">{niceNumber(summary?.totalOutgoingQty ?? 0)} ud.</div>
            <div className="rp-exec-item-sub">{niceCurrency(summary?.totalOutgoingAmount ?? 0)}</div>
          </div>
        </div>
        <div className={`rp-exec-item ${isPositive ? "rp-exec-item--green" : "rp-exec-item--red"}`}>
          <span className="rp-exec-item-icon">{isPositive ? "📈" : "📉"}</span>
          <div>
            <div className="rp-exec-item-label">Balance neto</div>
            <div className="rp-exec-item-value">{isPositive ? "+" : ""}{niceNumber(balance)} ud.</div>
            <div className="rp-exec-item-sub">{niceCurrency(summary?.balanceAmount ?? 0)}</div>
          </div>
        </div>
        {topProducto && (
          <div className="rp-exec-item rp-exec-item--yellow">
            <span className="rp-exec-item-icon">🔁</span>
            <div>
              <div className="rp-exec-item-label">Producto estrella</div>
              <div className="rp-exec-item-value rp-exec-item-value--name">{topProducto.name}</div>
              <div className="rp-exec-item-sub">{niceNumber(topProducto.qty)} unidades despachadas</div>
            </div>
          </div>
        )}
        {topCaro && (
          <div className="rp-exec-item rp-exec-item--purple">
            <span className="rp-exec-item-icon">💰</span>
            <div>
              <div className="rp-exec-item-label">Insumo más costoso</div>
              <div className="rp-exec-item-value rp-exec-item-value--name">{topCaro.name}</div>
              <div className="rp-exec-item-sub">{niceCurrency(topCaro.unitPrice)} / unidad</div>
            </div>
          </div>
        )}
        {topSupervisor && (
          <div className="rp-exec-item rp-exec-item--orange">
            <span className="rp-exec-item-icon">🏆</span>
            <div>
              <div className="rp-exec-item-label">Top solicitante</div>
              <div className="rp-exec-item-value rp-exec-item-value--name">{topSupervisor.employeeName}</div>
              <div className="rp-exec-item-sub">{niceNumber(topSupervisor.pedidos)} pedidos · {niceCurrency(topSupervisor.amount)}</div>
            </div>
          </div>
        )}
        {topServicio && (
          <div className="rp-exec-item rp-exec-item--teal">
            <span className="rp-exec-item-icon">🏥</span>
            <div>
              <div className="rp-exec-item-label">Servicio con mayor consumo</div>
              <div className="rp-exec-item-value rp-exec-item-value--name">{topServicio.serviceName}</div>
              <div className="rp-exec-item-sub">{niceNumber(topServicio.qty)} ud. · {niceCurrency(topServicio.amount)}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   DEMO DATA
   ================================================================ */
const DEMO_MONTHLY = {
  totals: { ordersCount: 42, itemsCount: 380, amount: 123456 },
  top_services: [
    { serviceId: "1", serviceName: "Oncología", pedidos: 14, qty: 180, amount: 65432 },
    { serviceId: "2", serviceName: "Guardia", pedidos: 10, qty: 140, amount: 43210 },
    { serviceId: "3", serviceName: "Terapia Intensiva", pedidos: 8, qty: 90, amount: 14800 },
    { serviceId: "4", serviceName: "Cardiología", pedidos: 6, qty: 60, amount: 8000 },
    { serviceId: "5", serviceName: "Pediatría", pedidos: 4, qty: 50, amount: 5400 },
    { serviceId: "6", serviceName: "Cirugía", pedidos: 3, qty: 30, amount: 3200 },
    { serviceId: "7", serviceName: "Neurología", pedidos: 2, qty: 20, amount: 2100 },
  ],
  top_products: [
    { productId: 1, code: "GUA-001", name: "Guantes descartables", pedidos: 18, qty: 120, amount: 24000 },
    { productId: 2, code: "BAR-010", name: "Barbijos quirúrgicos", pedidos: 15, qty: 95, amount: 19000 },
    { productId: 3, code: "ALC-500", name: "Alcohol en gel 500ml", pedidos: 20, qty: 80, amount: 16000 },
    { productId: 4, code: "JER-010", name: "Jeringas 10ml", pedidos: 12, qty: 70, amount: 14000 },
    { productId: 5, code: "SUE-001", name: "Suero fisiológico", pedidos: 9, qty: 55, amount: 11000 },
    { productId: 6, code: "CAN-002", name: "Cánulas nasales", pedidos: 7, qty: 40, amount: 8000 },
    { productId: 7, code: "GAS-050", name: "Gasas estériles", pedidos: 6, qty: 35, amount: 5600 },
    { productId: 8, code: "APA-100", name: "Apósitos 10x10", pedidos: 5, qty: 28, amount: 4200 },
  ],
  by_day: Array.from({ length: 28 }, (_, i) => ({
    day: `2025-01-${String(i + 1).padStart(2, "0")}`,
    pedidos: Math.max(0, Math.floor(Math.sin(i * 0.5) * 3 + Math.random() * 4 + 1)),
    monto: Math.floor(Math.random() * 15000) + 2000,
  })),
  prev_totals: { ordersCount: 38, itemsCount: 310, amount: 98000 },
};

function buildDemoServiceReport(serviceId, serviceName) {
  return {
    service: { id: serviceId, name: serviceName, budget: 500000, utilization: 0.46 },
    totals: { ordersCount: 10, itemsCount: 80, amount: 230000 },
    top_products: [
      { productId: 1, code: "GUA-001", name: "Guantes descartables", pedidos: 6, qty: 40, amount: 80000 },
      { productId: 2, code: "BAR-010", name: "Barbijos quirúrgicos", pedidos: 4, qty: 25, amount: 50000 },
      { productId: 3, code: "ALC-500", name: "Alcohol en gel", pedidos: 3, qty: 20, amount: 40000 },
      { productId: 4, code: "JER-010", name: "Jeringas 10ml", pedidos: 3, qty: 18, amount: 32000 },
      { productId: 5, code: "SUE-001", name: "Suero fisiológico", pedidos: 2, qty: 12, amount: 28000 },
    ],
    orders: [
      { id: 101, fecha: "2025-01-03", total: 20000 },
      { id: 102, fecha: "2025-01-05", total: 35000 },
      { id: 103, fecha: "2025-01-09", total: 42000 },
      { id: 104, fecha: "2025-01-14", total: 28000 },
      { id: 105, fecha: "2025-01-19", total: 55000 },
    ],
    by_day: Array.from({ length: 20 }, (_, i) => ({
      day: `2025-01-${String(i + 1).padStart(2, "0")}`,
      pedidos: Math.floor(Math.random() * 3) + 1,
      monto: Math.floor(Math.random() * 8000) + 1000,
    })),
  };
}

const DEMO_TRACEABILITY = {
  ok: true,
  summary: {
    totalIncomingQty: 520,
    totalIncomingAmount: 185000,
    totalOutgoingQty: 380,
    totalOutgoingAmount: 123456,
    balanceQty: 140,
    balanceAmount: 61544,
  },
  incoming: [
    { productId: 1, code: "GUA-001", name: "Guantes descartables", qty: 200, unitPrice: 200, amount: 40000, stock: 120 },
    { productId: 2, code: "BAR-010", name: "Barbijos quirúrgicos", qty: 180, unitPrice: 180, amount: 32400, stock: 95 },
    { productId: 3, code: "ALC-500", name: "Alcohol en gel 500ml", qty: 80, unitPrice: 220, amount: 17600, stock: 45 },
    { productId: 4, code: "JER-010", name: "Jeringas 10ml", qty: 60, unitPrice: 320, amount: 19200, stock: 70 },
  ],
  outgoing: [
    { productId: 1, code: "GUA-001", name: "Guantes descartables", pedidos: 18, qty: 120, amount: 24000 },
    { productId: 2, code: "BAR-010", name: "Barbijos quirúrgicos", pedidos: 15, qty: 95, amount: 19000 },
    { productId: 3, code: "ALC-500", name: "Alcohol en gel 500ml", pedidos: 20, qty: 80, amount: 16000 },
    { productId: 4, code: "JER-010", name: "Jeringas 10ml", pedidos: 12, qty: 70, amount: 14000 },
    { productId: 5, code: "SUE-001", name: "Suero fisiológico", pedidos: 9, qty: 55, amount: 11000 },
  ],
  topUsed: [
    { productId: 1, code: "GUA-001", name: "Guantes descartables", pedidos: 18, qty: 120, amount: 24000 },
    { productId: 2, code: "BAR-010", name: "Barbijos quirúrgicos", pedidos: 15, qty: 95, amount: 19000 },
    { productId: 3, code: "ALC-500", name: "Alcohol en gel 500ml", pedidos: 20, qty: 80, amount: 16000 },
    { productId: 4, code: "JER-010", name: "Jeringas 10ml", pedidos: 12, qty: 70, amount: 14000 },
    { productId: 5, code: "SUE-001", name: "Suero fisiológico", pedidos: 9, qty: 55, amount: 11000 },
    { productId: 6, code: "CAN-002", name: "Cánulas nasales", pedidos: 7, qty: 40, amount: 8000 },
    { productId: 7, code: "GAS-050", name: "Gasas estériles", pedidos: 6, qty: 35, amount: 5600 },
    { productId: 8, code: "APA-100", name: "Apósitos 10x10", pedidos: 5, qty: 28, amount: 4200 },
  ],
  topExpensive: [
    { productId: 4, code: "JER-010", name: "Jeringas 10ml", unitPrice: 320, stock: 70, totalSpentInPeriod: 14000, qtyOutInPeriod: 70 },
    { productId: 2, code: "BAR-010", name: "Barbijos quirúrgicos", unitPrice: 260, stock: 95, totalSpentInPeriod: 19000, qtyOutInPeriod: 95 },
    { productId: 3, code: "ALC-500", name: "Alcohol en gel 500ml", unitPrice: 220, stock: 45, totalSpentInPeriod: 16000, qtyOutInPeriod: 80 },
    { productId: 1, code: "GUA-001", name: "Guantes descartables", unitPrice: 200, stock: 120, totalSpentInPeriod: 24000, qtyOutInPeriod: 120 },
    { productId: 5, code: "SUE-001", name: "Suero fisiológico", unitPrice: 180, stock: 55, totalSpentInPeriod: 11000, qtyOutInPeriod: 55 },
    { productId: 6, code: "CAN-002", name: "Cánulas nasales", unitPrice: 150, stock: 40, totalSpentInPeriod: 8000, qtyOutInPeriod: 40 },
  ],
  byService: [
    { serviceId: "1", serviceName: "Oncología", pedidos: 14, qty: 180, amount: 65432, pctAmount: 46 },
    { serviceId: "2", serviceName: "Guardia", pedidos: 10, qty: 140, amount: 43210, pctAmount: 30 },
    { serviceId: "3", serviceName: "Terapia Intensiva", pedidos: 8, qty: 90, amount: 14800, pctAmount: 12 },
    { serviceId: "4", serviceName: "Cardiología", pedidos: 6, qty: 60, amount: 8000, pctAmount: 7 },
    { serviceId: "5", serviceName: "Pediatría", pedidos: 4, qty: 50, amount: 5400, pctAmount: 5 },
  ],
  supervisors: [
    { employeeId: "10", employeeName: "Martínez, Ana", pedidos: 18, qty: 210, amount: 72000 },
    { employeeId: "11", employeeName: "González, Carlos", pedidos: 14, qty: 160, amount: 54000 },
    { employeeId: "12", employeeName: "López, María", pedidos: 10, qty: 110, amount: 38000 },
    { employeeId: "13", employeeName: "Rodríguez, Juan", pedidos: 7, qty: 80, amount: 22000 },
    { employeeId: "14", employeeName: "García, Laura", pedidos: 5, qty: 50, amount: 14000 },
  ],
  stockAlerts: [
    { productId: 3, code: "ALC-500", name: "Alcohol en gel 500ml", stock: 45, unitPrice: 220 },
    { productId: 6, code: "CAN-002", name: "Cánulas nasales", stock: 40, unitPrice: 150 },
    { productId: 8, code: "APA-100", name: "Apósitos 10x10", stock: 28, unitPrice: 95 },
  ],
  observations: [
    { product: "Barbijos quirúrgicos", type: "warn", text: "Lote recibido con fecha de vencimiento próxima (3 meses). Priorizar uso.", date: "2025-01-12" },
    { product: "Alcohol en gel 500ml", type: "info", text: "Rendimiento normal. Sin observaciones de calidad.", date: "2025-01-15" },
    { product: "General", type: "info", text: "Se registró demora en la entrega de los pedidos del servicio de Guardia en la segunda semana del mes.", date: "2025-01-18" },
  ],
};

/* ================================================================
   COMPONENTE PRINCIPAL
   ================================================================ */
export default function Reports() {
  const [year, setYear] = useState(CURRENT_YEAR);
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [services, setServices] = useState([]);
  const [serviceId, setServiceId] = useState("");
  const [monthly, setMonthly] = useState(null);
  const [serviceReport, setServiceReport] = useState(null);
  const [loadingMonthly, setLoadingMonthly] = useState(false);
  const [loadingService, setLoadingService] = useState(false);
  const [error, setError] = useState("");
  const [demoMode, setDemoMode] = useState(false);
  const [monthlyView, setMonthlyView] = useState("resumen");
  const [yearly, setYearly] = useState(null);
  const [loadingYearly, setLoadingYearly] = useState(false);
  const [forecast, setForecast] = useState(null);
  const [loadingForecast, setLoadingForecast] = useState(false);
  const [traceability, setTraceability] = useState(null);
  const [loadingTraceability, setLoadingTraceability] = useState(false);
  // Nuevo: parámetros configurables de trazabilidad
  const [traceTopN, setTraceTopN] = useState(8);
  const [traceView, setTraceView] = useState("resumen");

  useEffect(() => {
    let alive = true;
    api.get("/reports/services").then(({ data }) => { if (alive) setServices(data || []); }).catch(console.error);
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    async function fetchMonthly() {
      setLoadingMonthly(true); setError("");
      try {
        if (demoMode) { if (alive) { setMonthly(DEMO_MONTHLY); setLoadingMonthly(false); } return; }
        const { data } = await api.get("/reports/monthly", { params: { year, month } });
        if (alive) setMonthly(data || null);
      } catch {
        if (alive) { setError("No se pudo cargar el informe mensual."); setMonthly(null); }
      } finally { if (alive) setLoadingMonthly(false); }
    }
    fetchMonthly();
    return () => { alive = false; };
  }, [year, month, demoMode]);

  useEffect(() => {
    let alive = true;
    async function fetchForecast() {
      setLoadingForecast(true);
      try {
        if (demoMode) {
          if (alive) setForecast({ target: { year, month }, forecast: { ordersCount: 45, itemsCount: 420, amount: 140000 }, series: [], method: "WMA_3", weights: [0.5, 0.3, 0.2] });
          return;
        }
        let fy = year, fm = month + 1;
        if (fm > 12) { fm = 1; fy += 1; }
        const { data } = await api.get("/reports/forecast", { params: { year: fy, month: fm, serviceId: serviceId || undefined } });
        if (alive) setForecast(data || null);
      } catch (e) {
        console.error("[Reports] forecast error:", e);
        if (alive) setForecast(null);
      } finally { if (alive) setLoadingForecast(false); }
    }
    fetchForecast();
    return () => { alive = false; };
  }, [year, month, serviceId, demoMode]);

  useEffect(() => {
    let alive = true;
    async function fetchYearly() {
      setLoadingYearly(true);
      try {
        if (demoMode) {
          const months = Array.from({ length: 12 }, (_, i) => ({
            month: i + 1,
            ordersCount: Math.floor(Math.random() * 80) + 20,
            itemsCount: Math.floor(Math.random() * 900) + 200,
            amount: Math.floor(Math.random() * 4500000) + 500000,
          }));
          const totals = months.reduce((a, m) => ({ ordersCount: a.ordersCount + m.ordersCount, itemsCount: a.itemsCount + m.itemsCount, amount: a.amount + m.amount }), { ordersCount: 0, itemsCount: 0, amount: 0 });
          if (alive) setYearly({ year, months, totals, prev_year: null });
          return;
        }
        const { data } = await api.get("/reports/yearly", { params: { year, serviceId: serviceId || undefined } });
        if (alive) setYearly(data || null);
      } catch { if (alive) setYearly(null); }
      finally { if (alive) setLoadingYearly(false); }
    }
    fetchYearly();
    return () => { alive = false; };
  }, [year, serviceId, demoMode]);

  useEffect(() => {
    let alive = true;
    if (!serviceId) { setServiceReport(null); return () => { alive = false; }; }
    async function fetchServiceReport() {
      setLoadingService(true);
      try {
        if (demoMode) {
          const name = services.find(s => String(s.id) === String(serviceId))?.name || String(serviceId);
          if (alive) { setServiceReport(buildDemoServiceReport(serviceId, name)); setLoadingService(false); }
          return;
        }
        const { data } = await api.get(`/reports/service/${encodeURIComponent(serviceId)}`, { params: { year, month } });
        if (alive) setServiceReport(data || null);
      } catch { if (alive) setServiceReport(null); }
      finally { if (alive) setLoadingService(false); }
    }
    fetchServiceReport();
    return () => { alive = false; };
  }, [serviceId, year, month, demoMode, services]);

  useEffect(() => {
    let alive = true;
    async function fetchTraceability() {
      setLoadingTraceability(true);
      try {
        if (demoMode) {
          if (alive) setTraceability(DEMO_TRACEABILITY);
          return;
        }
        const { data } = await api.get("/reports/traceability", { params: { year, month, top: traceTopN } });
        if (alive) setTraceability(data || null);
      } catch (e) {
        console.error("[Reports] traceability error:", e);
        if (alive) setTraceability(null);
      } finally { if (alive) setLoadingTraceability(false); }
    }
    fetchTraceability();
    return () => { alive = false; };
  }, [year, month, traceTopN, demoMode]);

  const monthLabel = useMemo(() => `${monthNameEs(month)} ${year}`, [year, month]);

  const monthlyTotals = useMemo(() => {
    const t = monthly?.totals || {};
    const ordersCount = Number(t.ordersCount || 0);
    const itemsCount = Number(t.itemsCount || 0);
    const amount = Number(t.amount || 0);
    const avgItems = ordersCount > 0 ? itemsCount / ordersCount : 0;
    const avgAmount = ordersCount > 0 ? amount / ordersCount : 0;
    return { ordersCount, itemsCount, amount, avgItems, avgAmount };
  }, [monthly]);

  const topServices = useMemo(() => monthly?.top_services || [], [monthly]);
  const topProducts = useMemo(() => monthly?.top_products || [], [monthly]);
  const byDay = useMemo(() => monthly?.by_day || [], [monthly]);
  const prevTotals = useMemo(() => monthly?.prev_totals || null, [monthly]);
  const yearlyMonths = useMemo(() => yearly?.months || [], [yearly]);
  const yearlyTotals = useMemo(() => yearly?.totals || null, [yearly]);
  const prevYearTotals = useMemo(() => yearly?.prev_year?.totals || null, [yearly]);
  const traceSummary = useMemo(() => traceability?.summary || null, [traceability]);
  const traceIncoming = useMemo(() => traceability?.incoming || [], [traceability]);
  const traceOutgoing = useMemo(() => traceability?.outgoing || [], [traceability]);
  const traceTopUsed = useMemo(() => traceability?.topUsed || [], [traceability]);
  const traceTopExpensive = useMemo(() => traceability?.topExpensive || [], [traceability]);
  const traceByService = useMemo(() => traceability?.byService || [], [traceability]);
  const traceSupervisors = useMemo(() => traceability?.supervisors || [], [traceability]);
  const traceStockAlerts = useMemo(() => traceability?.stockAlerts || [], [traceability]);
  const traceObservations = useMemo(() => traceability?.observations || [], [traceability]);

  const yoy = useMemo(() => {
    if (!yearlyTotals || !prevYearTotals) return null;
    return {
      orders: { cur: Number(yearlyTotals.ordersCount || 0), prev: Number(prevYearTotals.ordersCount || 0) },
      items: { cur: Number(yearlyTotals.itemsCount || 0), prev: Number(prevYearTotals.itemsCount || 0) },
      amount: { cur: Number(yearlyTotals.amount || 0), prev: Number(prevYearTotals.amount || 0) },
    };
  }, [yearlyTotals, prevYearTotals]);

  const topServicesWithNames = useMemo(() => topServices.map(s => {
    const cleanName = s.serviceName && s.serviceName !== "—" ? String(s.serviceName) : "";
    const fromList = services.find(svc => String(svc.id) === String(s.serviceId))?.name || "";
    const label = cleanName || fromList || (s.serviceId != null && s.serviceId !== "" ? `Servicio ${s.serviceId}` : "Sin servicio");
    return { ...s, _label: label };
  }), [topServices, services]);

  const serviceNameSelected = useMemo(() => {
    if (!serviceId) return "";
    return serviceReport?.service?.name || services.find(s => String(s.id) === String(serviceId))?.name || serviceId;
  }, [services, serviceId, serviceReport]);

  const actividadKpis = useMemo(() => {
    if (!byDay.length) return {};
    const vals = byDay.map(d => Number(d.pedidos || 0));
    const montos = byDay.map(d => Number(d.monto || 0));
    const diasConPedidos = vals.filter(v => v > 0).length;
    const maxIdx = vals.indexOf(Math.max(...vals));
    const maxDia = byDay[maxIdx] || {};
    const minActivo = Math.min(...vals.filter(v => v > 0), Infinity);
    const avg = vals.reduce((a, v) => a + v, 0) / vals.length;
    const variance = vals.reduce((a, v) => a + Math.pow(v - avg, 2), 0) / vals.length;
    const stdDev = Math.sqrt(variance);
    const cv = avg > 0 ? (stdDev / avg) * 100 : 0;
    const montoProm = montos.reduce((a, v) => a + v, 0) / montos.length;
    const mitad = Math.floor(byDay.length / 2);
    const primeraM = vals.slice(0, mitad).reduce((a, v) => a + v, 0);
    const segundaM = vals.slice(mitad).reduce((a, v) => a + v, 0);
    const tendenciaNum = primeraM > 0 ? ((segundaM - primeraM) / primeraM) * 100 : 0;
    const byDow = [0,0,0,0,0,0,0];
    const cntDow = [0,0,0,0,0,0,0];
    byDay.forEach(d => {
      if (!d.day) return;
      const dow = parseLocalDate(d.day).getDay();
      byDow[dow] += Number(d.pedidos || 0);
      cntDow[dow]++;
    });
    const avgDow = byDow.map((s, i) => cntDow[i] > 0 ? s / cntDow[i] : 0);
    const diasSemana = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
    const maxDow = avgDow.indexOf(Math.max(...avgDow));
    return { diasConPedidos, maxDia, minActivo, avg, cv, montoProm, tendenciaNum, maxDow: diasSemana[maxDow], diasTotal: byDay.length };
  }, [byDay]);

  const insumosKpis = useMemo(() => {
    if (!topProducts.length) return {};
    const total = topProducts.reduce((s, p) => s + Number(p.amount || 0), 0);
    const totalQty = topProducts.reduce((s, p) => s + Number(p.qty || 0), 0);
    const sorted = [...topProducts].sort((a, b) => Number(b.amount) - Number(a.amount));
    let acum = 0, paretoCount = 0;
    const paretoProducts = [];
    for (const p of sorted) {
      acum += Number(p.amount || 0);
      paretoCount++;
      paretoProducts.push({
        ...p,
        acumPct: total > 0 ? Math.round((acum / total) * 100) : 0,
        pct: total > 0 ? Math.round((Number(p.amount || 0) / total) * 100) : 0,
      });
      if (total > 0 && acum / total >= 0.8) break;
    }
    const ticketUnitario = totalQty > 0 ? total / totalQty : 0;
    const masPedido = [...topProducts].sort((a, b) => Number(b.pedidos) - Number(a.pedidos))[0];
    const withUP = topProducts.map(p => ({ ...p, unitPrice: Number(p.qty) > 0 ? Number(p.amount) / Number(p.qty) : 0 }));
    const masCaro = [...withUP].sort((a, b) => b.unitPrice - a.unitPrice)[0];
    return { total, totalQty, paretoCount, paretoTotal: topProducts.length, paretoProducts, ticketUnitario, masPedido, masCaro };
  }, [topProducts]);

  const serviciosKpis = useMemo(() => {
    if (!topServicesWithNames.length) return {};
    const totalAmount = topServicesWithNames.reduce((s, sv) => s + Number(sv.amount || 0), 0);
    const sorted = [...topServicesWithNames].sort((a, b) => Number(b.amount) - Number(a.amount));
    const top1pct = totalAmount > 0 ? (Number(sorted[0]?.amount || 0) / totalAmount) * 100 : 0;
    const top3pct = totalAmount > 0 ? (sorted.slice(0, 3).reduce((s, sv) => s + Number(sv.amount || 0), 0) / totalAmount) * 100 : 0;
    const avgPedidosByService = topServicesWithNames.reduce((s, sv) => s + Number(sv.pedidos || 0), 0) / topServicesWithNames.length;
    const conMasPedidos = [...topServicesWithNames].sort((a, b) => Number(b.pedidos) - Number(a.pedidos))[0];
    const conMasQty = [...topServicesWithNames].sort((a, b) => Number(b.qty) - Number(a.qty))[0];
    return { top1pct, top3pct, avgPedidosByService, conMasPedidos, conMasQty, count: topServicesWithNames.length };
  }, [topServicesWithNames]);

  const goToCurrentMonth = () => { setYear(CURRENT_YEAR); setMonth(CURRENT_MONTH); };
  const goToPreviousMonth = () => { let y = year, m = month - 1; if (m <= 0) { m = 12; y--; } setYear(y); setMonth(m); };
  const goToNextMonth = () => { let y = year, m = month + 1; if (m > 12) { m = 1; y++; } setYear(y); setMonth(m); };
  const handleExportPdf = () => window.print();

  const [exportingImg, setExportingImg] = useState(false);
  const [imgTarget, setImgTarget]       = useState("resumen"); // qué sección capturar

  const exportImage = async (sectionId) => {
    setExportingImg(true);
    try {
      // Cargar html2canvas dinámicamente (no requiere instalar nada)
      if (!window.html2canvas) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
          s.onload = resolve;
          s.onerror = () => reject(new Error("No se pudo cargar html2canvas"));
          document.head.appendChild(s);
        });
      }

      // Determinar el elemento a capturar
      const el = sectionId
        ? document.getElementById(sectionId)
        : document.querySelector(".reports-page");

      if (!el) {
        alert("No se encontró la sección a capturar.");
        return;
      }

      const canvas = await window.html2canvas(el, {
        scale: 2,                    // doble resolución → nitidez alta
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
        removeContainer: true,
        // Ignorar elementos no-print (botones, filtros)
        ignoreElements: (node) =>
          node.classList?.contains("no-print") ||
          node.classList?.contains("rp-trace-params"),
      });

      // Descargar como PNG
      const link = document.createElement("a");
      link.download = `informe_${sectionId || "completo"}_${year}_${String(month).padStart(2, "0")}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (e) {
      console.error("[exportImage]", e);
      alert("No se pudo generar la imagen. Intentá con el PDF.");
    } finally {
      setExportingImg(false);
    }
  };

  const exportMonthlyCsv = () => {
    if (!monthly) return;
    const lines = [
      `Resumen mensual;${monthLabel}`,
      `Pedidos;${monthlyTotals.ordersCount}`, `Ítems;${monthlyTotals.itemsCount}`, `Monto;${monthlyTotals.amount}`, "",
      "Top servicios", "Servicio;Pedidos;Unidades;Monto",
      ...topServicesWithNames.map(s => [s._label, s.pedidos ?? 0, s.qty ?? 0, s.amount ?? 0].join(";")),
      "", "Top productos", "Código;Producto;Pedidos;Unidades;Monto",
      ...topProducts.map(p => [p.code || "", p.name || "", p.pedidos ?? 0, p.qty ?? 0, p.amount ?? 0].join(";")),
      "", "Pedidos por día", "Día;Pedidos;Monto",
      ...byDay.map(d => [d.day || "", d.pedidos ?? 0, d.monto ?? 0].join(";")),
    ];
    Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" })),
      download: `informe_mensual_${year}_${String(month).padStart(2, "0")}.csv`,
    }).click();
  };

  const exportTraceCsv = () => {
    if (!traceability) return;
    const lines = [
      `Trazabilidad;${monthLabel}`,
      `Ingresó (ud.);${traceSummary?.totalIncomingQty ?? 0}`,
      `Ingresó ($);${traceSummary?.totalIncomingAmount ?? 0}`,
      `Salió (ud.);${traceSummary?.totalOutgoingQty ?? 0}`,
      `Salió ($);${traceSummary?.totalOutgoingAmount ?? 0}`,
      `Balance (ud.);${traceSummary?.balanceQty ?? 0}`,
      "", "TOP MÁS USADOS", "Producto;Código;Pedidos;Unidades;Monto",
      ...traceTopUsed.map(r => [r.name, r.code, r.pedidos, r.qty, r.amount].join(";")),
      "", "TOP MÁS CAROS", "Producto;Código;Precio unit.;Stock;Gastado período",
      ...traceTopExpensive.map(r => [r.name, r.code, r.unitPrice, r.stock, r.totalSpentInPeriod].join(";")),
      "", "DESTINO POR SERVICIO", "Servicio;Pedidos;Unidades;Monto;% Total",
      ...traceByService.map(r => [r.serviceName, r.pedidos, r.qty, r.amount, r.pctAmount?.toFixed(1)].join(";")),
      "", "RANKING SUPERVISORES", "Solicitante;Pedidos;Unidades;Monto",
      ...traceSupervisors.map(r => [r.employeeName, r.pedidos, r.qty, r.amount].join(";")),
    ];
    Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" })),
      download: `trazabilidad_${year}_${String(month).padStart(2, "0")}.csv`,
    }).click();
  };

  const exportServiceCsv = () => {
    if (!serviceReport || !serviceId) return;
    const sr = serviceReport, t = sr.totals || {};
    const lines = [
      `Servicio;${sr.service?.name || serviceNameSelected}`, `Mes;${monthLabel}`,
      `Pedidos;${t.ordersCount ?? 0}`, `Ítems;${t.itemsCount ?? 0}`, `Monto;${t.amount ?? 0}`,
      "", "Top productos", "Código;Producto;Pedidos;Unidades;Monto",
      ...(sr.top_products || []).map(p => [p.code || "", p.name || "", p.pedidos ?? 0, p.qty ?? 0, p.amount ?? 0].join(";")),
    ];
    Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" })),
      download: `informe_servicio_${serviceId}_${year}_${String(month).padStart(2, "0")}.csv`,
    }).click();
  };

  const hasMonthlyData = monthlyTotals.ordersCount > 0 || topServices.length > 0 || topProducts.length > 0;

  const colsServicios = [
    { label: "Servicio", key: "_label" },
    { label: "Pedidos", numeric: true, render: r => niceNumber(r.pedidos) },
    { label: "Unidades", numeric: true, render: r => niceNumber(r.qty) },
    { label: "Monto", numeric: true, render: r => niceCurrency(r.amount) },
    { label: "% total", numeric: true, render: r => {
      const pct = monthlyTotals.amount > 0 ? ((Number(r.amount||0)/monthlyTotals.amount)*100).toFixed(1) : "0.0";
      return <div className="rp-inlinetbar"><div className="rp-inlinetbar-fill" style={{ width:`${pct}%` }} /><span>{pct}%</span></div>;
    }},
  ];

  const colsProductos = [
    { label: "Código", key: "code" },
    { label: "Producto", key: "name" },
    { label: "Pedidos", numeric: true, render: r => niceNumber(r.pedidos) },
    { label: "Unidades", numeric: true, render: r => niceNumber(r.qty) },
    { label: "Monto", numeric: true, render: r => niceCurrency(r.amount) },
    { label: "$/ud", numeric: true, render: r => {
      const up = Number(r.qty) > 0 ? Number(r.amount) / Number(r.qty) : 0;
      return <span style={{ color:"#6b7280" }}>{niceCurrency(up)}</span>;
    }},
  ];

  const colsTraceService = [
    { label: "Servicio", key: "serviceName" },
    { label: "Pedidos", numeric: true, render: r => niceNumber(r.pedidos) },
    { label: "Unidades", numeric: true, render: r => niceNumber(r.qty) },
    {
      label: "Monto", numeric: true,
      render: r => {
        const max = Math.max(...traceByService.map(x => Number(x.amount || 0)), 0);
        const pct = max > 0 ? (Number(r.amount || 0) / max) * 100 : 0;
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
            <div style={{ height: 6, width: 90, background: "#e5e7eb", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: "#3b82f6", borderRadius: 999 }} />
            </div>
            <span>{niceCurrency(r.amount)}</span>
          </div>
        );
      }
    },
    { label: "% total", numeric: true, render: r => `${Number(r.pctAmount || 0).toFixed(1)}%` },
  ];

  const ROL_BADGE = {
    supervisor:      { label: "Supervisor",      color: "#0369a1", bg: "#e0f2fe" },
    administrativo:  { label: "Administrativo",  color: "#7c3aed", bg: "#ede9fe" },
    admin:           { label: "Admin",            color: "#dc2626", bg: "#fee2e2" },
  };

  const colsTraceSupervisors = [
    {
      label: "Solicitante",
      render: r => {
        const rolKey = r.rol ? String(r.rol).toLowerCase().trim() : null;
        const badge  = rolKey ? (ROL_BADGE[rolKey] || { label: r.rol, color: "#374151", bg: "#f3f4f6" }) : null;
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontWeight: 700, color: "#111827" }}>{r.employeeName || "—"}</span>
            {badge && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: "0.68rem", fontWeight: 700,
                padding: "1px 7px", borderRadius: 999,
                background: badge.bg, color: badge.color,
                border: `1px solid ${badge.color}40`,
                width: "fit-content",
              }}>
                {rolKey === "supervisor" ? "👤" : rolKey === "admin" ? "🔑" : "🗂️"} {badge.label}
              </span>
            )}
          </div>
        );
      }
    },
    { label: "Pedidos",    numeric: true, render: r => niceNumber(r.pedidos) },
    { label: "Unidades",   numeric: true, render: r => niceNumber(r.qty) },
    { label: "Monto total",numeric: true, render: r => niceCurrency(r.amount) },
    { label: "Prom/pedido",numeric: true, render: r => {
      const avg = Number(r.pedidos) > 0 ? Number(r.amount) / Number(r.pedidos) : 0;
      return <span style={{ color: "#6b7280", fontSize: "0.82rem" }}>{niceCurrency(avg)}</span>;
    }},
  ];

  const colsTraceStockAlerts = [
    { label: "Producto", render: r => <span style={{ fontWeight: 700, color: "#111827" }}>{r.name || "Sin nombre"}</span> },
    { label: "Stock", numeric: true, render: r => (
      <span style={{ color: Number(r.stock || 0) < 50 ? "#ef4444" : "#22c55e", fontWeight: 700 }}>
        {niceNumber(r.stock)} {Number(r.stock || 0) < 50 ? "⚠️" : "✅"}
      </span>
    )},
    { label: "Precio unit.", numeric: true, render: r => niceCurrency(r.unitPrice) },
  ];

  /* ================================================================
     RENDER
     ================================================================ */
  return (
    <section className="admin-panel reports-page">

      {/* HEADER */}
      <header className="reports-page-header">
        <div>
          <h1>Informes</h1>
          <p className="reports-page-subtitle">Análisis de pedidos, insumos, trazabilidad y servicios por período.</p>
          <label className="no-print" style={{ display:"inline-flex", alignItems:"center", gap:"0.35rem", fontSize:"0.8rem", color:"#4b5563", marginTop:"0.4rem", userSelect:"none" }}>
            <input type="checkbox" checked={demoMode} onChange={e => setDemoMode(e.target.checked)} style={{ width:14, height:14 }} />
            Modo demo
          </label>
          <p className="reports-print-meta print-only">Período: {monthLabel} · Servicio: {serviceId ? serviceNameSelected : "Todos"}</p>
        </div>
        <div className="reports-period-filters no-print">
          <label className="reports-field">
            <span>Mes</span>
            <select value={month} onChange={e => setMonth(Number(e.target.value) || CURRENT_MONTH)}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{monthNameEs(m)}</option>)}
            </select>
          </label>
          <label className="reports-field">
            <span>Año</span>
            <input type="number" min="2000" max="2100" value={year} onChange={e => setYear(Number(e.target.value) || CURRENT_YEAR)} />
          </label>
          <div className="reports-period-buttons">
            <button type="button" className="pill pill--ghost" onClick={goToPreviousMonth}>‹ Anterior</button>
            <button type="button" className="pill" onClick={goToCurrentMonth}>Mes actual</button>
            <button type="button" className="pill pill--ghost" onClick={goToNextMonth}>Siguiente ›</button>
          </div>
        </div>
      </header>

      {/* FILTRO SERVICIO + EXPORTAR */}
      <div className="reports-service-filter no-print">
        <label className="reports-field">
          <span>Servicio (detalle opcional)</span>
          <select value={serviceId} onChange={e => setServiceId(e.target.value)}>
            <option value="">Todos los servicios</option>
            {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <div className="reports-service-actions">
          <button type="button" className="pill pill--ghost" onClick={exportMonthlyCsv} disabled={!hasMonthlyData}>CSV mes</button>
          {traceability && <button type="button" className="pill pill--ghost" onClick={exportTraceCsv}>CSV trazabilidad</button>}
          {serviceId && serviceReport && <button type="button" className="pill pill--ghost" onClick={exportServiceCsv}>CSV servicio</button>}
          <button type="button" className="pill" onClick={handleExportPdf} disabled={!hasMonthlyData}>Exportar PDF</button>

          {/* ── Exportar imagen ── */}
          <div className="rp-img-export-wrap">
            <select
              className="rp-img-select"
              value={imgTarget}
              onChange={e => setImgTarget(e.target.value)}
              title="Elegir sección a capturar"
            >
              <option value="rp-section-main">KPIs + vista activa</option>
              <option value="rp-section-kpis">Solo tarjetas KPI</option>
              <option value="rp-section-service">Detalle servicio</option>
              <option value="">Página completa</option>
            </select>
            <button
              type="button"
              className="pill pill--ghost"
              onClick={() => exportImage(imgTarget || null)}
              disabled={exportingImg || !hasMonthlyData}
              title="Descargar PNG de alta resolución"
            >
              {exportingImg ? "Generando…" : "🖼️ Imagen PNG"}
            </button>
          </div>
        </div>
      </div>

      {loadingMonthly && <div className="state" style={{ marginTop:8 }}>Cargando informe mensual…</div>}
      {error && !loadingMonthly && <div className="state error" style={{ marginTop:8 }}>{error}</div>}
      {!loadingMonthly && !error && !hasMonthlyData && <div className="state" style={{ marginTop:8 }}>No hay datos para {monthLabel}.</div>}

      {!loadingMonthly && !error && hasMonthlyData && (
        <>
          {/* ============================================================
              SECCIÓN PRINCIPAL — RESUMEN MENSUAL
              ============================================================ */}
          <section className="reports-section" id="rp-section-main">
            <header className="reports-section-header">
              <div className="reports-section-title">
                <h2>Resumen de {monthLabel}</h2>
              </div>
              <div className="rp-view-tabs no-print">
                {[
                  ["resumen", "🏠 General"],
                  ["actividad", "📅 Actividad"],
                  ["insumos", "📦 Insumos"],
                  ["servicios", "🏥 Servicios"],
                  ["dias", "📆 Por día"],
                  ["anual", "📈 Anual"],
                  ["trazabilidad", "🧭 Trazabilidad"],
                ].map(([k, l]) => (
                  <button key={k} type="button" className={`pill${monthlyView === k ? "" : " pill--ghost"}`} onClick={() => setMonthlyView(k)}>{l}</button>
                ))}
              </div>
            </header>

            {/* ---- 8 KPI CARDS PRINCIPALES ---- */}
            <div className="rp-kpi-row" id="rp-section-kpis">
              <div className="reports-summary-card reports-summary-card--main">
                <div className="reports-summary-label">Pedidos totales</div>
                <div className="reports-summary-value">{niceNumber(monthlyTotals.ordersCount)}</div>
                {prevTotals
                  ? <DeltaBadge current={monthlyTotals.ordersCount} previous={prevTotals.ordersCount} />
                  : <span style={{ fontSize:"0.72rem", color:"rgba(255,255,255,0.55)", marginTop:2 }}>Sin datos mes anterior</span>
                }
                {byDay.length > 1 && (
                  <Sparkline
                    data={byDay}
                    color="rgba(255,255,255,0.85)"
                    width={90}
                    height={26}
                    trendOverride={prevTotals
                      ? monthlyTotals.ordersCount - prevTotals.ordersCount
                      : undefined
                    }
                  />
                )}
              </div>
              <div className="reports-summary-card">
                <div className="reports-summary-label">Monto total</div>
                <div className="reports-summary-value">{niceCurrency(monthlyTotals.amount)}</div>
                {prevTotals && <DeltaBadge current={monthlyTotals.amount} previous={prevTotals.amount} formatter={niceCurrency} />}
                <div className="reports-summary-sub">Prom/pedido: <strong>{niceCurrency(monthlyTotals.avgAmount)}</strong></div>
              </div>
              <div className="reports-summary-card">
                <div className="reports-summary-label">Unidades despachadas</div>
                <div className="reports-summary-value">{niceNumber(monthlyTotals.itemsCount)}</div>
                {prevTotals && <DeltaBadge current={monthlyTotals.itemsCount} previous={prevTotals.itemsCount} />}
                <div className="reports-summary-sub">Prom/pedido: <strong>{monthlyTotals.avgItems.toFixed(1)} ítems</strong></div>
              </div>
              <div className="reports-summary-card">
                <div className="reports-summary-label">Días con actividad</div>
                <div className="reports-summary-value">{actividadKpis.diasConPedidos ?? "—"}<span style={{fontSize:"0.85rem",color:"#6b7280"}}> / {actividadKpis.diasTotal ?? "—"}</span></div>
                <div className="reports-summary-sub">Día más activo: <strong>{actividadKpis.maxDow ?? "—"}</strong></div>
                {actividadKpis.tendenciaNum != null && (
                  <span style={{ color: actividadKpis.tendenciaNum >= 0 ? "#22c55e" : "#ef4444", fontSize:"0.75rem", fontWeight:700 }}>
                    {actividadKpis.tendenciaNum >= 0 ? "▲" : "▼"} {Math.abs(actividadKpis.tendenciaNum).toFixed(1)}% 2ª vs 1ª quincena
                  </span>
                )}
              </div>
              <div className="reports-summary-card">
                <div className="reports-summary-label">Variabilidad diaria</div>
                <div className="reports-summary-value">{actividadKpis.cv != null ? `${actividadKpis.cv.toFixed(0)}%` : "—"}</div>
                <div className="reports-summary-sub" style={{ fontSize:"0.7rem", lineHeight:1.35 }}>
                  {actividadKpis.cv != null && actividadKpis.avg != null
                    ? `Prom: ${actividadKpis.avg.toFixed(1)} ped/día · CV mide irregularidad día a día`
                    : "Coef. de variación (CV)"
                  }
                </div>
                {actividadKpis.cv != null && <StatusBadge value={actividadKpis.cv} thresholds={[40, 70]} labels={["Demanda estable","Demanda variable","Muy irregular"]} />}
              </div>
              <div className="reports-summary-card rp-pareto-card">
                <div className="reports-summary-label">Regla 80/20 (Pareto)</div>
                <div className="reports-summary-value">
                  {insumosKpis.paretoCount ?? "—"}
                  <span style={{fontSize:"0.85rem",color:"#6b7280"}}> / {insumosKpis.paretoTotal ?? "—"}</span>
                </div>
                <div className="reports-summary-sub">insumos = 80% del gasto total</div>
                {insumosKpis.paretoProducts?.length > 0 && (
                  <div className="rp-pareto-list">
                    {insumosKpis.paretoProducts.map((p, i) => (
                      <div key={i} className="rp-pareto-item" title={niceCurrency(p.amount) + " · " + p.pct + "% del total"}>
                        <span className="rp-pareto-item-num">{i + 1}</span>
                        <span className="rp-pareto-item-name">{p.name || p.code || "—"}</span>
                        <span className="rp-pareto-item-pct">{p.pct}%</span>
                      </div>
                    ))}
                    <div className="rp-pareto-acum">
                      Acumulado: <strong>{insumosKpis.paretoProducts[insumosKpis.paretoProducts.length - 1]?.acumPct ?? 0}%</strong> del gasto
                    </div>
                  </div>
                )}
              </div>
              <div className="reports-summary-card">
                <div className="reports-summary-label">Servicios activos</div>
                <div className="reports-summary-value">{serviciosKpis.count ?? "—"}</div>
                <div className="reports-summary-sub">Top 3: <strong>{serviciosKpis.top3pct != null ? `${serviciosKpis.top3pct.toFixed(0)}%` : "—"}</strong> del monto</div>
                {serviciosKpis.top1pct != null && <StatusBadge value={serviciosKpis.top1pct} thresholds={[40, 60]} labels={["Distribuido","Concentrado","Muy concentrado"]} />}
              </div>
              <div className="reports-summary-card">
                <div className="reports-summary-label">Costo unitario prom.</div>
                <div className="reports-summary-value" style={{fontSize:"1rem"}}>{insumosKpis.ticketUnitario ? niceCurrency(insumosKpis.ticketUnitario) : "—"}</div>
                <div className="reports-summary-sub">Monto ÷ unidades totales</div>
                {insumosKpis.masCaro && <div className="reports-summary-sub" style={{fontSize:"0.68rem"}}>Más caro/ud: <strong>{insumosKpis.masCaro.name}</strong></div>}
              </div>
              <div className="reports-summary-card">
                <div className="reports-summary-label">{monthNameEs(month === 12 ? 1 : month + 1)} {month === 12 ? year + 1 : year}</div>
                <div className="reports-summary-value" style={{ fontSize: "1rem" }}>
                  {loadingForecast ? "Cargando…" : forecast?.forecast?.ordersCount != null ? `${niceNumber(Math.round(forecast.forecast.ordersCount))} ped.` : "—"}
                </div>
                <div className="reports-summary-sub">
                  Unidades: <strong>{forecast?.forecast?.itemsCount != null ? niceNumber(Math.round(forecast.forecast.itemsCount)) : "—"}</strong>
                  {" · "}Monto: <strong>{forecast?.forecast?.amount != null ? niceCurrency(forecast.forecast.amount) : "—"}</strong>
                </div>
              </div>
            </div>

            {/* ---- VISTA: GENERAL ---- */}
            {monthlyView === "resumen" && (
              <div className="rp-overview-grid" style={{ marginTop:"1rem" }}>
                <div>
                  <h3 className="reports-subtitle">Distribución por servicio</h3>
                  <ServicePieChart data={topServicesWithNames} />
                  <ConcentrationMeter data={topServicesWithNames} valueKey="amount" label="Concentración de gasto por servicio" />
                </div>
                <div>
                  <h3 className="reports-subtitle">Pedidos por día <small style={{color:"#f97316"}}>● días pico</small></h3>
                  <BarChartByDay data={byDay} />
                  <h3 className="reports-subtitle" style={{ marginTop:"1rem" }}>Promedio por día de semana</h3>
                  <WeekdayHeatmap data={byDay} />
                </div>
              </div>
            )}

            {/* ---- VISTA: ACTIVIDAD ---- */}
            {monthlyView === "actividad" && (
              <div style={{ marginTop:"1rem" }}>
                <div className="rp-metric-grid">
                  {[
                    { icon:"📅", val:`${actividadKpis.diasConPedidos ?? "—"} / ${actividadKpis.diasTotal ?? "—"}`, lbl:"Días con al menos un pedido" },
                    { icon:"📊", val:`${actividadKpis.avg?.toFixed(1) ?? "—"}`, lbl:"Pedidos promedio por día" },
                    { icon:"🏆", val:`${actividadKpis.maxDia?.pedidos ?? "—"}`, lbl:`Máximo · ${niceDate(actividadKpis.maxDia?.day)}` },
                    { icon:"📉", val:`${actividadKpis.minActivo === Infinity ? "—" : actividadKpis.minActivo}`, lbl:"Mínimo en días activos" },
                    { icon:"〰️", val:`${actividadKpis.cv?.toFixed(1) ?? "—"}%`, lbl:`Variabilidad (CV) · ${!actividadKpis.cv ? "" : actividadKpis.cv < 30 ? "Estable" : actividadKpis.cv < 60 ? "Variable" : "Irregular"}` },
                    { icon:"📆", val:`${actividadKpis.maxDow ?? "—"}`, lbl:"Día de semana más activo" },
                    { icon:"📈", val:`${actividadKpis.tendenciaNum != null ? (actividadKpis.tendenciaNum >= 0 ? "+" : "") + actividadKpis.tendenciaNum.toFixed(1) + "%" : "—"}`, lbl:"Tendencia 2ª vs 1ª quincena" },
                    { icon:"💰", val:`${actividadKpis.montoProm ? niceCurrency(actividadKpis.montoProm) : "—"}`, lbl:"Monto promedio por día" },
                  ].map((m, i) => (
                    <div key={i} className="rp-metric-card">
                      <span className="rp-metric-icon">{m.icon}</span>
                      <div><div className="rp-metric-value">{m.val}</div><div className="rp-metric-label">{m.lbl}</div></div>
                    </div>
                  ))}
                </div>
                <div className="reports-two-columns" style={{ marginTop:"1.25rem" }}>
                  <div><h3 className="reports-subtitle">Pedidos por día</h3><BarChartByDay data={byDay} /></div>
                  <div><h3 className="reports-subtitle">Monto por día</h3><MoneyChartByDay data={byDay} /></div>
                </div>
                <div style={{ marginTop:"1rem" }}>
                  <h3 className="reports-subtitle">Promedio por día de semana</h3>
                  <WeekdayHeatmap data={byDay} />
                </div>
                <div style={{ marginTop:"1rem" }}>
                  <h3 className="reports-subtitle">Tabla diaria completa</h3>
                  <div className="reports-table-wrapper">
                    <table className="reports-table">
                      <thead><tr><th>Fecha</th><th>Día</th><th className="numeric">Pedidos</th><th className="numeric">Monto</th></tr></thead>
                      <tbody>
                        {byDay.length === 0 && <tr><td colSpan={4} className="empty">Sin datos.</td></tr>}
                        {byDay.map(d => {
                          const dt = parseLocalDate(d.day);
                          const dias = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
                          const dow = !Number.isNaN(dt.getTime()) ? dias[dt.getDay()] : "";
                          const isWe = dow === "Dom" || dow === "Sáb";
                          return (
                            <tr key={d.day} style={isWe ? { color:"#0ea5e9" } : {}}>
                              <td>{niceDate(d.day)}</td><td>{dow}</td>
                              <td className="numeric">{niceNumber(d.pedidos ?? 0)}</td>
                              <td className="numeric">{niceCurrency(d.monto ?? 0)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ---- VISTA: INSUMOS ---- */}
            {monthlyView === "insumos" && (
              <div style={{ marginTop:"1rem" }}>
                <div className="rp-metric-grid">
                  {[
                    { icon:"📦", val:`${topProducts.length}`, lbl:"Insumos distintos solicitados", highlight: false },
                    { icon:"📐", val:`${niceNumber(insumosKpis.totalQty)}`, lbl:"Unidades totales despachadas", highlight: false },
                    { icon:"⚡", val:`${insumosKpis.paretoCount ?? "—"} de ${insumosKpis.paretoTotal ?? "—"}`, lbl:"Pareto: productos = 80% del gasto", highlight: true },
                    { icon:"💲", val:`${insumosKpis.ticketUnitario ? niceCurrency(insumosKpis.ticketUnitario) : "—"}`, lbl:"Costo unitario promedio", highlight: false },
                    { icon:"🔁", val:`${insumosKpis.masPedido?.name ?? "—"}`, lbl:`Más solicitado · ${niceNumber(insumosKpis.masPedido?.pedidos)} pedidos`, highlight: false },
                    { icon:"💸", val:`${insumosKpis.masCaro?.name ?? "—"}`, lbl:`Más caro/ud · ${insumosKpis.masCaro ? niceCurrency(insumosKpis.masCaro.unitPrice) : "—"}`, highlight: false },
                  ].map((m, i) => (
                    <div key={i} className={`rp-metric-card${m.highlight ? " rp-metric-card--highlight" : ""}`}>
                      <span className="rp-metric-icon">{m.icon}</span>
                      <div><div className="rp-metric-value">{m.val}</div><div className="rp-metric-label">{m.lbl}</div></div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop:"1.25rem" }}>
                  <h3 className="reports-subtitle">Distribución del gasto por insumo</h3>
                  <HorizontalBarChart data={topProducts.map(p => ({ ...p, _label: p.name || p.code || "—" }))} valueKey="amount" labelKey="_label" valueFormatter={niceCurrency} />
                  <ConcentrationMeter data={topProducts} valueKey="amount" label="Concentración del gasto en insumos" />
                </div>
                <div style={{ marginTop:"1.25rem" }}>
                  <h3 className="reports-subtitle">Ranking completo de insumos</h3>
                  <RankTable rows={topProducts.map(p => ({ ...p, unitPrice: Number(p.qty)>0 ? Number(p.amount)/Number(p.qty) : 0 }))} columns={colsProductos} emptyMsg="Sin insumos en el mes." />
                </div>

                {/* ---- BLOQUE PARETO DETALLADO ---- */}
                {insumosKpis.paretoProducts?.length > 0 && (
                  <div className="rp-pareto-section" style={{ marginTop:"1.25rem" }}>
                    <div className="rp-pareto-section-header">
                      <span className="rp-pareto-section-icon">⚡</span>
                      <div>
                        <h3 className="rp-pareto-section-title">
                          Productos críticos — Regla 80/20
                        </h3>
                        <p className="rp-pareto-section-sub">
                          Estos <strong>{insumosKpis.paretoCount}</strong> insumos concentran el 80% del gasto total del mes. Son los que más impactan el presupuesto y los que requieren mayor seguimiento y control de stock.
                        </p>
                      </div>
                    </div>
                    <div className="rp-pareto-detail-table">
                      {insumosKpis.paretoProducts.map((p, i) => {
                        const acumPrev = i === 0 ? 0 : insumosKpis.paretoProducts[i - 1].acumPct;
                        return (
                          <div key={i} className="rp-pareto-detail-row">
                            <div className="rp-pareto-detail-rank">
                              <span className="rp-rank-num" style={{
                                background: i === 0 ? "#fbbf24" : i === 1 ? "#94a3b8" : i === 2 ? "#f97316" : "#e5e7eb",
                                color: i < 3 ? "#fff" : "#374151", width: 26, height: 26, fontSize: "0.75rem"
                              }}>{i + 1}</span>
                            </div>
                            <div className="rp-pareto-detail-info">
                              <span className="rp-pareto-detail-name">{p.name || p.code || "—"}</span>
                              {p.code && p.name && <span className="rp-pareto-detail-code">{p.code}</span>}
                            </div>
                            <div className="rp-pareto-detail-bar-wrap">
                              <div className="rp-pareto-detail-bar-bg">
                                <div className="rp-pareto-detail-bar-prev" style={{ width: `${acumPrev}%` }} />
                                <div className="rp-pareto-detail-bar-cur" style={{ width: `${p.pct}%`, marginLeft: `${acumPrev}%` }} />
                              </div>
                              <span className="rp-pareto-detail-acum">acum. {p.acumPct}%</span>
                            </div>
                            <div className="rp-pareto-detail-nums">
                              <span className="rp-pareto-detail-amount">{niceCurrency(p.amount)}</span>
                              <span className="rp-pareto-detail-pct-badge">{p.pct}% del total</span>
                            </div>
                          </div>
                        );
                      })}
                      <div className="rp-pareto-detail-footer">
                        <span>✅ Estos {insumosKpis.paretoCount} insumos representan el {insumosKpis.paretoProducts[insumosKpis.paretoProducts.length - 1]?.acumPct}% del gasto mensual.</span>
                        <span>Los restantes {(insumosKpis.paretoTotal || 0) - (insumosKpis.paretoCount || 0)} insumos suman el {100 - (insumosKpis.paretoProducts[insumosKpis.paretoProducts.length - 1]?.acumPct || 0)}%.</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ---- VISTA: SERVICIOS ---- */}
            {monthlyView === "servicios" && (
              <div style={{ marginTop:"1rem" }}>
                <div className="rp-metric-grid">
                  {[
                    { icon:"🏥", val:`${serviciosKpis.count ?? "—"}`, lbl:"Servicios con pedidos en el mes", highlight: false },
                    { icon:"🥇", val:`${serviciosKpis.conMasPedidos?._label ?? "—"}`, lbl:`Más pedidos · ${niceNumber(serviciosKpis.conMasPedidos?.pedidos)}`, highlight: true },
                    { icon:"📦", val:`${serviciosKpis.conMasQty?._label ?? "—"}`, lbl:`Más unidades retiradas · ${niceNumber(serviciosKpis.conMasQty?.qty)}`, highlight: true },
                    { icon:"📊", val:`${serviciosKpis.avgPedidosByService?.toFixed(1) ?? "—"}`, lbl:"Pedidos promedio por servicio", highlight: false },
                    { icon:"🔝", val:`${serviciosKpis.top1pct?.toFixed(0) ?? "—"}%`, lbl:"% del 1er servicio sobre el total", highlight: false },
                    { icon:"3️⃣", val:`${serviciosKpis.top3pct?.toFixed(0) ?? "—"}%`, lbl:"% del top 3 sobre el total", highlight: false },
                  ].map((m, i) => (
                    <div key={i} className={`rp-metric-card${m.highlight ? " rp-metric-card--highlight" : ""}`}>
                      <span className="rp-metric-icon">{m.icon}</span>
                      <div><div className="rp-metric-value">{m.val}</div><div className="rp-metric-label">{m.lbl}</div></div>
                    </div>
                  ))}
                </div>
                <div className="rp-overview-grid" style={{ marginTop:"1.25rem" }}>
                  <div>
                    <h3 className="reports-subtitle">Distribución del gasto</h3>
                    <ServicePieChart data={topServicesWithNames} />
                    <ConcentrationMeter data={topServicesWithNames} valueKey="amount" label="Concentración del gasto" />
                  </div>
                  <div>
                    <h3 className="reports-subtitle">Por volumen de pedidos</h3>
                    <HorizontalBarChart data={topServicesWithNames} valueKey="pedidos" labelKey="_label" valueFormatter={n => `${niceNumber(n)} ped.`} />
                  </div>
                </div>
                <div style={{ marginTop:"1.25rem" }}>
                  <h3 className="reports-subtitle">Ranking de servicios</h3>
                  <RankTable rows={topServicesWithNames} columns={colsServicios} emptyMsg="Sin servicios en el mes." />
                </div>
              </div>
            )}

            {/* ---- VISTA: POR DÍA ---- */}
            {monthlyView === "dias" && (
              <div style={{ marginTop:"1rem" }}>
                <div className="reports-two-columns">
                  <div><h3 className="reports-subtitle">Pedidos por día</h3><BarChartByDay data={byDay} /></div>
                  <div><h3 className="reports-subtitle">Monto por día</h3><MoneyChartByDay data={byDay} /></div>
                </div>
                <div style={{ marginTop:"1rem" }}>
                  <h3 className="reports-subtitle">Promedio por día de semana</h3>
                  <WeekdayHeatmap data={byDay} />
                </div>
                <div style={{ marginTop:"1rem" }}>
                  <h3 className="reports-subtitle">Tabla completa</h3>
                  <div className="reports-table-wrapper">
                    <table className="reports-table">
                      <thead><tr><th>Fecha</th><th>Día</th><th className="numeric">Pedidos</th><th className="numeric">Monto</th></tr></thead>
                      <tbody>
                        {byDay.length === 0 && <tr><td colSpan={4} className="empty">Sin datos.</td></tr>}
                        {byDay.map(d => {
                          const dt = parseLocalDate(d.day);
                          const dias = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
                          const dow = !Number.isNaN(dt.getTime()) ? dias[dt.getDay()] : "";
                          const isWe = dow === "Dom" || dow === "Sáb";
                          return (
                            <tr key={d.day} style={isWe ? { color:"#0ea5e9" } : {}}>
                              <td>{niceDate(d.day)}</td><td>{dow}</td>
                              <td className="numeric">{niceNumber(d.pedidos ?? 0)}</td>
                              <td className="numeric">{niceCurrency(d.monto ?? 0)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ---- VISTA: ANUAL ---- */}
            {monthlyView === "anual" && (
              <div style={{ marginTop: "1rem" }}>
                {loadingYearly && <div className="state">Cargando comparativa anual…</div>}
                {!loadingYearly && !yearly && <div className="state">Sin datos anuales para {year}.</div>}
                {!loadingYearly && yearly && (
                  <>
                    <div className="reports-two-columns">
                      <div><h3 className="reports-subtitle">Pedidos por mes</h3><YearBarChart months={yearlyMonths} valueKey="ordersCount" valueFormatter={(v) => `${niceNumber(v)} ped.`} /></div>
                      <div><h3 className="reports-subtitle">Monto por mes</h3><YearBarChart months={yearlyMonths} valueKey="amount" valueFormatter={niceCurrency} /></div>
                    </div>
                    {yearlyTotals && (
                      <div className="rp-kpi-row" style={{ marginTop: "1rem", "--cols": "3" }}>
                        <div className="reports-summary-card">
                          <div className="reports-summary-label">Pedidos (año)</div>
                          <div className="reports-summary-value">{niceNumber(yearlyTotals.ordersCount ?? 0)}</div>
                          {yoy?.orders && <DeltaBadge current={yoy.orders.cur} previous={yoy.orders.prev} />}
                        </div>
                        <div className="reports-summary-card">
                          <div className="reports-summary-label">Unidades (año)</div>
                          <div className="reports-summary-value">{niceNumber(yearlyTotals.itemsCount ?? 0)}</div>
                          {yoy?.items && <DeltaBadge current={yoy.items.cur} previous={yoy.items.prev} />}
                        </div>
                        <div className="reports-summary-card">
                          <div className="reports-summary-label">Monto (año)</div>
                          <div className="reports-summary-value">{niceCurrency(yearlyTotals.amount ?? 0)}</div>
                          {yoy?.amount && <DeltaBadge current={yoy.amount.cur} previous={yoy.amount.prev} formatter={niceCurrency} />}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ================================================================
                VISTA: TRAZABILIDAD — COMPLETAMENTE RENOVADA
                ================================================================ */}
            {monthlyView === "trazabilidad" && (
              <div style={{ marginTop: "1rem" }}>

                {/* Parámetros configurables */}
                <div className="rp-trace-params no-print">
                  <span className="rp-trace-params-label">⚙️ Parámetros del informe:</span>
                  <label className="reports-field" style={{ flexDirection:"row", alignItems:"center", gap:"0.4rem" }}>
                    <span style={{ whiteSpace:"nowrap" }}>Top productos:</span>
                    <select value={traceTopN} onChange={e => setTraceTopN(Number(e.target.value))} style={{ minWidth: 70 }}>
                      {[4,5,6,7,8].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                  <div className="rp-trace-tabs">
                    {[
                      ["resumen","📊 Resumen"],
                      ["productos","📦 Productos"],
                      ["flujo","🔄 Flujo"],
                      ["servicios","🏥 Servicios"],
                      ["supervisores","👤 Supervisores"],
                      ["observaciones","📋 Observaciones"],
                    ].map(([k, l]) => (
                      <button key={k} type="button" className={`pill${traceView === k ? "" : " pill--ghost"}`} style={{ fontSize:"0.78rem", padding:"0.35rem 0.7rem" }} onClick={() => setTraceView(k)}>{l}</button>
                    ))}
                  </div>
                </div>

                {loadingTraceability && <div className="state" style={{ marginTop:8 }}>Cargando trazabilidad…</div>}
                {!loadingTraceability && !traceability && <div className="state" style={{ marginTop:8 }}>Sin datos de trazabilidad para {monthLabel}.</div>}

                {!loadingTraceability && traceability && (
                  <>
                    {/* --- SUB-VISTA: RESUMEN EJECUTIVO --- */}
                    {traceView === "resumen" && (
                      <>
                        <ResumenEjecutivo
                          summary={traceSummary}
                          topUsed={traceTopUsed}
                          topExpensive={traceTopExpensive}
                          supervisors={traceSupervisors}
                          byService={traceByService}
                          monthLabel={monthLabel}
                        />
                        <BalanceVisual
                          inQty={traceSummary?.totalIncomingQty ?? 0}
                          outQty={traceSummary?.totalOutgoingQty ?? 0}
                          inAmount={traceSummary?.totalIncomingAmount ?? 0}
                          outAmount={traceSummary?.totalOutgoingAmount ?? 0}
                        />
                        {traceStockAlerts.length > 0 && (
                          <div style={{ marginTop:"1.25rem" }}>
                            <h3 className="reports-subtitle">⚠️ Alertas de stock ({traceStockAlerts.length})</h3>
                            <RankTable rows={traceStockAlerts} columns={colsTraceStockAlerts} emptyMsg="Sin alertas." />
                          </div>
                        )}
                      </>
                    )}

                    {/* --- SUB-VISTA: PRODUCTOS --- */}
                    {traceView === "productos" && (
                      <>
                        <div className="reports-insight">
                          {traceTopUsed.length > 0
                            ? `📦 Top ${traceTopN} productos activos: el más utilizado es "${traceTopUsed[0].name}" con ${niceNumber(traceTopUsed[0].qty)} unidades despachadas.`
                            : "Sin datos de productos en el período."}
                        </div>
                        <div className="reports-two-columns" style={{ marginTop:"1rem" }}>
                          <div>
                            <h3 className="reports-subtitle">🔁 Top {traceTopN} más usados por volumen</h3>
                            <TopProductTable
                              rows={traceTopUsed.slice(0, traceTopN).map(r => ({ ...r, _sortVal: r.qty }))}
                              columns={[
                                { label: "Pedidos", render: r => <span className="rp-top-val-num">{niceNumber(r.pedidos)}</span> },
                                { label: "Unidades", render: r => <span className="rp-top-val-num rp-top-val-highlight">{niceNumber(r.qty)}</span> },
                                { label: "Monto", render: r => <span className="rp-top-val-currency">{niceCurrency(r.amount)}</span> },
                              ]}
                              emptyMsg="Sin datos."
                            />
                            <HorizontalBarChart
                              data={traceTopUsed.slice(0, traceTopN).map(p => ({ ...p, _label: p.name || p.code || "—" }))}
                              valueKey="qty" labelKey="_label"
                              valueFormatter={n => `${niceNumber(n)} ud.`}
                            />
                          </div>
                          <div>
                            <h3 className="reports-subtitle">💰 Top {traceTopN} más caros por precio unitario</h3>
                            <TopProductTable
                              rows={traceTopExpensive.slice(0, traceTopN).map(r => ({ ...r, _sortVal: r.unitPrice }))}
                              columns={[
                                { label: "Precio/ud", render: r => <span className="rp-top-val-currency rp-top-val-highlight">{niceCurrency(r.unitPrice)}</span> },
                                { label: "Stock", render: r => (
                                  <span style={{ color: Number(r.stock || 0) < 50 ? "#ef4444" : "#22c55e", fontWeight: 700 }}>
                                    {niceNumber(r.stock)}{Number(r.stock || 0) < 50 ? " ⚠️" : ""}
                                  </span>
                                )},
                                { label: "Gastado", render: r => <span className="rp-top-val-currency">{niceCurrency(r.totalSpentInPeriod)}</span> },
                              ]}
                              emptyMsg="Sin datos de precios."
                            />
                            <HorizontalBarChart
                              data={traceTopExpensive.slice(0, traceTopN).map(p => ({ ...p, _label: p.name || p.code || "—" }))}
                              valueKey="unitPrice" labelKey="_label"
                              valueFormatter={niceCurrency}
                            />
                          </div>
                        </div>
                        <div style={{ marginTop:"1.25rem" }}>
                          <h3 className="reports-subtitle">Tabla completa — Top más usados</h3>
                          <RankTable
                            rows={traceTopUsed.slice(0, traceTopN)}
                            columns={[
                              { label: "Producto", key: "name" },
                              { label: "Código", key: "code" },
                              { label: "Pedidos", numeric: true, render: r => niceNumber(r.pedidos) },
                              { label: "Unidades", numeric: true, render: r => <strong style={{ color:"#0ea5e9" }}>{niceNumber(r.qty)}</strong> },
                              { label: "Monto período", numeric: true, render: r => niceCurrency(r.amount) },
                              { label: "$/ud promedio", numeric: true, render: r => {
                                const up = Number(r.qty) > 0 ? Number(r.amount) / Number(r.qty) : 0;
                                return <span style={{ color:"#6b7280" }}>{niceCurrency(up)}</span>;
                              }},
                            ]}
                            emptyMsg="Sin salidas en el período."
                          />
                        </div>
                        <div style={{ marginTop:"1.25rem" }}>
                          <h3 className="reports-subtitle">Tabla completa — Top más caros</h3>
                          <RankTable
                            rows={traceTopExpensive.slice(0, traceTopN)}
                            columns={[
                              { label: "Producto", render: r => <span style={{ fontWeight: 700 }}>{r.name || "Sin nombre"}</span> },
                              { label: "Código", key: "code" },
                              { label: "Precio unit.", numeric: true, render: r => <strong style={{ color:"#7c3aed" }}>{niceCurrency(r.unitPrice)}</strong> },
                              { label: "Stock actual", numeric: true, render: r => (
                                <span style={{ color: Number(r.stock || 0) < 50 ? "#ef4444" : "#22c55e", fontWeight: 700 }}>
                                  {niceNumber(r.stock)} {Number(r.stock || 0) < 50 ? "⚠️" : "✅"}
                                </span>
                              )},
                              { label: "Salidas (ud.)", numeric: true, render: r => niceNumber(r.qtyOutInPeriod) },
                              { label: "Gastado período", numeric: true, render: r => <strong>{niceCurrency(r.totalSpentInPeriod)}</strong> },
                            ]}
                            emptyMsg="Sin datos de precios."
                          />
                        </div>
                      </>
                    )}

                    {/* --- SUB-VISTA: FLUJO (INGRESOS Y SALIDAS) --- */}
                    {traceView === "flujo" && (
                      <>
                        <BalanceVisual
                          inQty={traceSummary?.totalIncomingQty ?? 0}
                          outQty={traceSummary?.totalOutgoingQty ?? 0}
                          inAmount={traceSummary?.totalIncomingAmount ?? 0}
                          outAmount={traceSummary?.totalOutgoingAmount ?? 0}
                        />
                        <div className="reports-two-columns" style={{ marginTop:"1.25rem" }}>
                          <div>
                            <h3 className="reports-subtitle">📥 Ingresos del período</h3>
                            {traceIncoming.length === 0
                              ? <p className="rp-empty-msg">Sin ingresos registrados en el período.</p>
                              : (
                                <RankTable
                                  rows={traceIncoming}
                                  columns={[
                                    { label: "Producto", key: "name" },
                                    { label: "Unidades", numeric: true, render: r => <strong style={{ color:"#22c55e" }}>{niceNumber(r.qty)}</strong> },
                                    { label: "Precio unit.", numeric: true, render: r => niceCurrency(r.unitPrice) },
                                    { label: "Monto", numeric: true, render: r => niceCurrency(r.amount) },
                                    { label: "Stock actual", numeric: true, render: r => niceNumber(r.stock) },
                                  ]}
                                  emptyMsg="Sin ingresos."
                                />
                              )
                            }
                          </div>
                          <div>
                            <h3 className="reports-subtitle">📤 Salidas del período</h3>
                            <RankTable
                              rows={traceOutgoing}
                              columns={[
                                { label: "Producto", key: "name" },
                                { label: "Pedidos", numeric: true, render: r => niceNumber(r.pedidos) },
                                { label: "Unidades", numeric: true, render: r => <strong style={{ color:"#ef4444" }}>{niceNumber(r.qty)}</strong> },
                                { label: "Monto", numeric: true, render: r => niceCurrency(r.amount) },
                              ]}
                              emptyMsg="Sin salidas."
                            />
                          </div>
                        </div>
                        {/* Comparativa ingreso-salida por producto */}
                        {traceIncoming.length > 0 && traceOutgoing.length > 0 && (
                          <div style={{ marginTop:"1.25rem" }}>
                            <h3 className="reports-subtitle">Diferencia ingreso - salida por producto</h3>
                            <div className="reports-table-wrapper">
                              <table className="reports-table">
                                <thead>
                                  <tr>
                                    <th>#</th>
                                    <th>Producto</th>
                                    <th className="numeric">Ingresó (ud.)</th>
                                    <th className="numeric">Salió (ud.)</th>
                                    <th className="numeric">Diferencia</th>
                                    <th className="numeric">Estado</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(() => {
                                    const allIds = new Set([
                                      ...traceIncoming.map(r => String(r.productId)),
                                      ...traceOutgoing.map(r => String(r.productId)),
                                    ]);
                                    return [...allIds].map((pid, i) => {
                                      const inc = traceIncoming.find(r => String(r.productId) === pid);
                                      const out = traceOutgoing.find(r => String(r.productId) === pid);
                                      const name = inc?.name || out?.name || "—";
                                      const inQty = Number(inc?.qty || 0);
                                      const outQty = Number(out?.qty || 0);
                                      const diff = inQty - outQty;
                                      const isPos = diff >= 0;
                                      return (
                                        <tr key={pid}>
                                          <td><span className="rp-rank-num" style={{ background:"#f1f5f9", color:"#374151" }}>{i + 1}</span></td>
                                          <td style={{ fontWeight: 600 }}>{name}</td>
                                          <td className="numeric" style={{ color:"#22c55e", fontWeight:700 }}>{inQty > 0 ? `+${niceNumber(inQty)}` : "—"}</td>
                                          <td className="numeric" style={{ color:"#ef4444", fontWeight:700 }}>{outQty > 0 ? `-${niceNumber(outQty)}` : "—"}</td>
                                          <td className="numeric" style={{ fontWeight:700, color: isPos ? "#22c55e" : "#ef4444" }}>
                                            {isPos ? "+" : ""}{niceNumber(diff)}
                                          </td>
                                          <td className="numeric">
                                            {inQty === 0 && outQty > 0
                                              ? <span className="rp-status-badge" style={{ background:"#fef2f2", color:"#ef4444", borderColor:"#ef4444" }}><span className="rp-status-dot" style={{ background:"#ef4444" }}/>Solo salidas</span>
                                              : outQty === 0 && inQty > 0
                                                ? <span className="rp-status-badge" style={{ background:"#f0fdf4", color:"#22c55e", borderColor:"#22c55e" }}><span className="rp-status-dot" style={{ background:"#22c55e" }}/>Solo ingresos</span>
                                                : diff >= 0
                                                  ? <span className="rp-status-badge" style={{ background:"#eff6ff", color:"#3b82f6", borderColor:"#3b82f6" }}><span className="rp-status-dot" style={{ background:"#3b82f6" }}/>Superávit</span>
                                                  : <span className="rp-status-badge" style={{ background:"#fff7ed", color:"#f97316", borderColor:"#f97316" }}><span className="rp-status-dot" style={{ background:"#f97316" }}/>Déficit</span>
                                            }
                                          </td>
                                        </tr>
                                      );
                                    });
                                  })()}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* --- SUB-VISTA: SERVICIOS --- */}
                    {traceView === "servicios" && (
                      <>
                        <div className="reports-insight">
                          {traceByService.length > 0
                            ? `🏥 ${traceByService.length} servicios con consumo en ${monthLabel}. El de mayor gasto es "${traceByService[0].serviceName}" con ${niceCurrency(traceByService[0].amount)} (${Number(traceByService[0].pctAmount || 0).toFixed(1)}% del total).`
                            : "Sin datos de servicios para el período."}
                        </div>
                        <div className="rp-overview-grid" style={{ marginTop:"1rem" }}>
                          <div>
                            <h3 className="reports-subtitle">Distribución por servicio</h3>
                            <ServicePieChart data={traceByService.map(r => ({ ...r, _label: r.serviceName }))} />
                          </div>
                          <div>
                            <h3 className="reports-subtitle">Monto por servicio</h3>
                            <HorizontalBarChart
                              data={traceByService.map(r => ({ ...r, _label: r.serviceName }))}
                              valueKey="amount" labelKey="_label"
                              valueFormatter={niceCurrency}
                            />
                          </div>
                        </div>
                        <div style={{ marginTop:"1.25rem" }}>
                          <h3 className="reports-subtitle">Ranking detallado por servicio</h3>
                          <RankTable rows={traceByService} columns={colsTraceService} emptyMsg="Sin destinos por servicio." />
                        </div>
                      </>
                    )}

                    {/* --- SUB-VISTA: SUPERVISORES --- */}
                    {traceView === "supervisores" && (
                      <>
                        <div className="reports-insight">
                          {traceSupervisors.length > 0
                            ? `👤 ${traceSupervisors.length} solicitantes activos en ${monthLabel}. El de mayor actividad es "${traceSupervisors[0].employeeName}"${traceSupervisors[0].rol ? ` (${traceSupervisors[0].rol})` : ""} con ${niceNumber(traceSupervisors[0].pedidos)} pedidos (${niceCurrency(traceSupervisors[0].amount)}).`
                            : "Sin datos de solicitantes para el período."}
                        </div>

                        {/* Desglose por rol */}
                        {traceSupervisors.some(r => r.rol) && (() => {
                          const byRol = traceSupervisors.reduce((acc, r) => {
                            const k = r.rol ? String(r.rol).toLowerCase() : "sin rol";
                            if (!acc[k]) acc[k] = { rol: r.rol || "Sin rol", personas: 0, pedidos: 0, amount: 0 };
                            acc[k].personas++;
                            acc[k].pedidos += r.pedidos;
                            acc[k].amount  += r.amount;
                            return acc;
                          }, {});
                          return (
                            <div className="rp-rol-breakdown">
                              {Object.values(byRol).map((g, i) => {
                                const rolKey = String(g.rol).toLowerCase();
                                const badge = ROL_BADGE[rolKey] || { color: "#374151", bg: "#f3f4f6" };
                                return (
                                  <div key={i} className="rp-rol-card" style={{ borderColor: badge.color + "40", background: badge.bg }}>
                                    <div className="rp-rol-card-title" style={{ color: badge.color }}>
                                      {rolKey === "supervisor" ? "👤" : rolKey === "admin" ? "🔑" : "🗂️"} {g.rol}
                                    </div>
                                    <div className="rp-rol-card-stats">
                                      <span><strong>{g.personas}</strong> persona{g.personas !== 1 ? "s" : ""}</span>
                                      <span><strong>{niceNumber(g.pedidos)}</strong> pedidos</span>
                                      <span><strong>{niceCurrency(g.amount)}</strong></span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}

                        <div style={{ marginTop:"1rem" }}>
                          <h3 className="reports-subtitle">Monto solicitado por solicitante</h3>
                          <HorizontalBarChart
                            data={traceSupervisors.map(r => ({ ...r, _label: r.employeeName }))}
                            valueKey="amount" labelKey="_label"
                            valueFormatter={niceCurrency}
                          />
                        </div>
                        <div style={{ marginTop:"1rem" }}>
                          <h3 className="reports-subtitle">Pedidos por solicitante</h3>
                          <HorizontalBarChart
                            data={traceSupervisors.map(r => ({ ...r, _label: r.employeeName }))}
                            valueKey="pedidos" labelKey="_label"
                            valueFormatter={n => `${niceNumber(n)} ped.`}
                          />
                        </div>
                        <div style={{ marginTop:"1.25rem" }}>
                          <h3 className="reports-subtitle">Ranking completo de solicitantes</h3>
                          <RankTable rows={traceSupervisors} columns={colsTraceSupervisors} emptyMsg="Sin solicitudes registradas." />
                        </div>
                      </>
                    )}

                    {/* --- SUB-VISTA: OBSERVACIONES --- */}
                    {traceView === "observaciones" && (
                      <>
                        <div className="reports-insight" style={{ background:"#f0f9ff", borderColor:"#0ea5e9", color:"#0369a1" }}>
                          📋 Registrá aquí observaciones sobre calidad, rendimiento, vencimientos, devoluciones o cualquier dato relevante del período. Los datos provienen de la tabla de observaciones de tu sistema.
                        </div>
                        <div className="reports-two-columns" style={{ marginTop:"1rem" }}>
                          <div>
                            <h3 className="reports-subtitle">Observaciones del período</h3>
                            <ObservacionesPanel items={traceObservations} />
                          </div>
                          <div>
                            <h3 className="reports-subtitle">⚠️ Alertas de stock bajo</h3>
                            {traceStockAlerts.length === 0
                              ? <p className="rp-empty-msg">✅ Sin alertas de stock en el período.</p>
                              : <RankTable rows={traceStockAlerts} columns={colsTraceStockAlerts} emptyMsg="Sin alertas." />
                            }
                            <div style={{ marginTop:"1rem" }}>
                              <h3 className="reports-subtitle">Datos relevantes del período</h3>
                              <div className="rp-relevant-data">
                                <div className="rp-relevant-item">
                                  <span className="rp-relevant-icon">📦</span>
                                  <div>
                                    <strong>Total de insumos distintos despachados</strong>
                                    <p>{niceNumber(traceOutgoing.length)} productos únicos en el período</p>
                                  </div>
                                </div>
                                <div className="rp-relevant-item">
                                  <span className="rp-relevant-icon">💰</span>
                                  <div>
                                    <strong>Gasto total en período</strong>
                                    <p>{niceCurrency(traceSummary?.totalOutgoingAmount ?? 0)} en {niceNumber(traceSummary?.totalOutgoingQty ?? 0)} unidades</p>
                                  </div>
                                </div>
                                <div className="rp-relevant-item">
                                  <span className="rp-relevant-icon">🏥</span>
                                  <div>
                                    <strong>Servicios abastecidos</strong>
                                    <p>{traceByService.length} servicios recibieron insumos este mes</p>
                                  </div>
                                </div>
                                <div className="rp-relevant-item">
                                  <span className="rp-relevant-icon">👤</span>
                                  <div>
                                    <strong>Solicitantes activos</strong>
                                    <p>{traceSupervisors.length} supervisores realizaron pedidos</p>
                                  </div>
                                </div>
                                {traceStockAlerts.length > 0 && (
                                  <div className="rp-relevant-item rp-relevant-item--warn">
                                    <span className="rp-relevant-icon">⚠️</span>
                                    <div>
                                      <strong>Productos con stock bajo</strong>
                                      <p>{traceStockAlerts.map(a => a.name).join(", ")}</p>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </section>

          {/* ============================================================
              SECCIÓN 2 — DETALLE POR SERVICIO
              ============================================================ */}
          {serviceId && (
            <section className="reports-section" id="rp-section-service">
              <header className="reports-section-header">
                <div className="reports-section-title">
                  <h2>Detalle: {serviceNameSelected}</h2>
                  <p className="reports-section-subtitle">{monthLabel}</p>
                </div>
              </header>

              {loadingService && <div className="state" style={{ marginTop:8 }}>Cargando…</div>}
              {!loadingService && !serviceReport && <div className="state" style={{ marginTop:8 }}>Sin datos para este servicio en el mes.</div>}

              {!loadingService && serviceReport && (() => {
                const sr = serviceReport;
                const srProds = sr.top_products || [];
                const srTotal = Number(sr.totals?.amount || 0);
                const srSorted = [...srProds].sort((a,b) => Number(b.amount)-Number(a.amount));
                let srAcum=0, srParetoN=0;
                for (const p of srSorted) { srAcum+=Number(p.amount||0); srParetoN++; if(srTotal>0&&srAcum/srTotal>=0.8) break; }
                return (
                  <>
                    <div className="rp-kpi-row" style={{ "--cols":"4" }}>
                      <div className="reports-summary-card reports-summary-card--main">
                        <div className="reports-summary-label">Pedidos del servicio</div>
                        <div className="reports-summary-value">{niceNumber(sr.totals?.ordersCount ?? 0)}</div>
                        <div className="reports-summary-sub">Ítems: <strong>{niceNumber(sr.totals?.itemsCount ?? 0)}</strong></div>
                      </div>
                      <div className="reports-summary-card">
                        <div className="reports-summary-label">Monto total</div>
                        <div className="reports-summary-value">{niceCurrency(srTotal)}</div>
                        <div className="reports-summary-sub">Prom/pedido: <strong>{sr.totals?.ordersCount > 0 ? niceCurrency(srTotal / sr.totals.ordersCount) : "—"}</strong></div>
                      </div>
                      <div className="reports-summary-card">
                        <div className="reports-summary-label">Presupuesto</div>
                        <div className="reports-summary-value">{sr.service?.budget != null ? niceCurrency(sr.service.budget) : "—"}</div>
                        {sr.service?.budget > 0 && (
                          <>
                            <BudgetBar used={srTotal} budget={sr.service.budget} />
                            <div className="reports-summary-sub">Uso: <strong>{((sr.service.utilization ?? 0)*100).toFixed(1)}%</strong>{(sr.service.utilization ?? 0) >= 0.9 && " ⚠️"}</div>
                          </>
                        )}
                      </div>
                      <div className="reports-summary-card">
                        <div className="reports-summary-label">Pareto del servicio</div>
                        <div className="reports-summary-value">{srParetoN} <span style={{fontSize:"0.85rem",color:"#6b7280"}}>/ {srProds.length}</span></div>
                        <div className="reports-summary-sub">insumos = 80% del gasto</div>
                      </div>
                    </div>

                    {sr.by_day?.length > 1 && (
                      <div className="reports-two-columns" style={{ marginTop:"1rem" }}>
                        <div><h3 className="reports-subtitle">Pedidos diarios</h3><BarChartByDay data={sr.by_day} /></div>
                        <div><h3 className="reports-subtitle">Monto diario</h3><MoneyChartByDay data={sr.by_day} /></div>
                      </div>
                    )}

                    <div className="reports-two-columns" style={{ marginTop:"1rem" }}>
                      <div>
                        <h3 className="reports-subtitle">Top insumos del servicio</h3>
                        {srProds.length > 0 && <HorizontalBarChart data={srProds.map(p=>({...p,_label:p.name||p.code||"—"}))} valueKey="amount" labelKey="_label" valueFormatter={niceCurrency} />}
                        <ConcentrationMeter data={srProds} valueKey="amount" label="Concentración en insumos de este servicio" />
                      </div>
                      <div>
                        <h3 className="reports-subtitle">Pedidos del servicio</h3>
                        <div className="reports-table-wrapper">
                          <table className="reports-table">
                            <thead><tr><th>Pedido</th><th>Fecha</th><th className="numeric">Total</th></tr></thead>
                            <tbody>
                              {(!sr.orders?.length) && <tr><td colSpan={3} className="empty">Sin pedidos.</td></tr>}
                              {(sr.orders || []).map(o => (
                                <tr key={o.id}>
                                  <td>#{o.id}</td>
                                  <td>{niceDate(o.fecha)}</td>
                                  <td className="numeric">{niceCurrency(o.total ?? 0)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop:"1rem" }}>
                      <h3 className="reports-subtitle">Detalle completo de insumos del servicio</h3>
                      <RankTable rows={srProds.map(p => ({ ...p, unitPrice: Number(p.qty)>0?Number(p.amount)/Number(p.qty):0 }))} columns={colsProductos} emptyMsg="Sin insumos." />
                    </div>
                  </>
                );
              })()}
            </section>
          )}
        </>
      )}
    </section>
  );
}