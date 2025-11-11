// client/src/pages/Reports.jsx
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import "../styles/reports.css";

const NOW = new Date();
const CURRENT_YEAR = NOW.getFullYear();
const CURRENT_MONTH = NOW.getMonth() + 1; // 1..12

function monthNameEs(m) {
  const names = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ];
  const idx = Math.max(1, Math.min(12, Number(m) || 1)) - 1;
  return names[idx];
}

function niceNumber(n) {
  if (n == null || Number.isNaN(Number(n))) return "0";
  return new Intl.NumberFormat("es-AR").format(Number(n));
}

function niceCurrency(n) {
  if (n == null || Number.isNaN(Number(n))) return "$ 0,00";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  }).format(Number(n));
}

function niceDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10);
  return dt.toISOString().slice(0, 10);
}

/* ========= Gráficos sencillos sin librerías ========= */

function HorizontalBarChart({
  data,
  valueKey,
  labelKey,
  valueFormatter,
  showPercent = true,
}) {
  if (!data || !data.length) return null;

  const numericValues = data.map((d) => Number(d[valueKey] || 0));
  const maxVal = Math.max(...numericValues, 0);
  const sumVal = numericValues.reduce((acc, v) => acc + v, 0);

  if (maxVal <= 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        margin: "6px 0 10px",
      }}
    >
      {data.map((item, idx) => {
        const raw = Number(item[valueKey] || 0);
        const pctOfMax = maxVal > 0 ? (raw / maxVal) * 100 : 0;
        const width = Math.max(8, pctOfMax); // mínimo para que se vea
        const label = String(item[labelKey] ?? "").trim() || "—";
        const pctOfTotal =
          sumVal > 0 ? Math.round((raw / sumVal) * 100) : 0;

        return (
          <div
            key={idx}
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              alignItems: "center",
              columnGap: 8,
              fontSize: "0.8rem",
            }}
          >
            {/* Nombre / etiqueta */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                minWidth: 0,
              }}
              title={label}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "999px",
                  border: "1px solid #d1d5db",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.7rem",
                  background: "#f9fafb",
                }}
              >
                {idx + 1}
              </span>
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </span>
            </div>

            {/* Barra */}
            <div
              style={{
                flex: 1,
                background: "#e5e7eb",
                borderRadius: 999,
                overflow: "hidden",
                height: 10,
              }}
            >
              <div
                style={{
                  width: `${width}%`,
                  maxWidth: "100%",
                  height: "100%",
                  borderRadius: 999,
                  background:
                    idx === 0
                      ? "linear-gradient(90deg, #0ea5e9, #0369a1)"
                      : "linear-gradient(90deg, #38bdf8, #0ea5e9)",
                  transition: "width 0.2s ease-out",
                }}
              />
            </div>

            {/* Valor numérico + % */}
            <div
              style={{
                textAlign: "right",
                minWidth: 110,
                fontVariantNumeric: "tabular-nums",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                lineHeight: 1.1,
              }}
            >
              <span>
                {valueFormatter ? valueFormatter(raw) : niceNumber(raw)}
              </span>
              {showPercent && (
                <span
                  style={{
                    fontSize: "0.7rem",
                    color: "#6b7280",
                  }}
                >
                  {pctOfTotal}% del total
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BarChartByDay({ data }) {
  if (!data || !data.length) return null;

  const values = data.map((d) => Number(d.pedidos ?? 0));
  const maxVal = Math.max(...values, 0);
  if (maxVal <= 0) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 4,
        height: 160,
        margin: "6px 0 10px",
        padding: "4px 0",
        borderBottom: "1px solid #e5e7eb",
      }}
    >
      {data.map((d) => {
        const v = Number(d.pedidos ?? 0);
        const pct = maxVal > 0 ? (v / maxVal) * 100 : 0;
        const h = Math.max(8, pct);
        const label =
          (d.day && String(d.day).slice(8, 10)) || String(d.day || "");
        return (
          <div
            key={d.day}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              fontSize: "0.7rem",
            }}
          >
            {/* Cantidad de pedidos arriba de la barra */}
            <span
              style={{
                fontSize: "0.65rem",
                marginBottom: 2,
                color: "#4b5563",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {v > 0 ? v : ""}
            </span>

            <div
              style={{
                width: "70%",
                background: "#e5e7eb",
                borderRadius: 999,
                overflow: "hidden",
                display: "flex",
                alignItems: "flex-end",
                height: "100%",
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: `${h}%`,
                  borderRadius: 999,
                  background:
                    "linear-gradient(180deg, #22c55e, #16a34a, #166534)",
                }}
                title={`${niceNumber(v)} pedidos`}
              />
            </div>
            <span style={{ marginTop: 4 }}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ========= Datos DEMO ========= */

const DEMO_MONTHLY = {
  totals: {
    ordersCount: 42,
    itemsCount: 380,
    amount: 123456,
  },
  top_services: [
    {
      serviceId: "1",
      serviceName: "Oncología",
      pedidos: 14,
      qty: 180,
      amount: 65432,
    },
    {
      serviceId: "2",
      serviceName: "Guardia",
      pedidos: 10,
      qty: 140,
      amount: 43210,
    },
    {
      serviceId: "3",
      serviceName: "Terapia Intensiva",
      pedidos: 8,
      qty: 90,
      amount: 14800,
    },
  ],
  top_products: [
    {
      productId: 1,
      code: "GUA-001",
      name: "Guantes descartables",
      pedidos: 18,
      qty: 120,
      amount: 24000,
    },
    {
      productId: 2,
      code: "BAR-010",
      name: "Barbijos quirúrgicos",
      pedidos: 15,
      qty: 95,
      amount: 19000,
    },
    {
      productId: 3,
      code: "ALC-500",
      name: "Alcohol en gel 500ml",
      pedidos: 20,
      qty: 80,
      amount: 16000,
    },
  ],
  by_day: [
    { day: "2025-01-01", pedidos: 2, monto: 5000 },
    { day: "2025-01-02", pedidos: 4, monto: 8000 },
    { day: "2025-01-03", pedidos: 1, monto: 2000 },
    { day: "2025-01-04", pedidos: 5, monto: 10000 },
    { day: "2025-01-05", pedidos: 3, monto: 7000 },
  ],
};

function buildDemoServiceReport(serviceId, serviceName) {
  return {
    service: {
      id: serviceId,
      name: serviceName,
      budget: 500000,
      utilization: 0.7,
    },
    totals: {
      ordersCount: 10,
      itemsCount: 80,
      amount: 230000,
    },
    top_products: [
      {
        productId: 1,
        code: "GUA-001",
        name: "Guantes descartables",
        pedidos: 6,
        qty: 40,
        amount: 80000,
      },
      {
        productId: 2,
        code: "BAR-010",
        name: "Barbijos quirúrgicos",
        pedidos: 4,
        qty: 25,
        amount: 50000,
      },
    ],
    orders: [
      { id: 101, fecha: "2025-01-03", total: 20000 },
      { id: 102, fecha: "2025-01-05", total: 35000 },
      { id: 103, fecha: "2025-01-09", total: 42000 },
    ],
  };
}

/* ========= Componente principal ========= */

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

  // modo demo
  const [demoMode, setDemoMode] = useState(false);

  // Cargar lista de servicios para el combo
  useEffect(() => {
    let alive = true;
    api
      .get("/reports/services")
      .then(({ data }) => {
        if (!alive) return;
        setServices(data || []);
      })
      .catch((e) => {
        console.error("[Reports] GET /reports/services", e);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Cargar informe mensual global
  useEffect(() => {
    let alive = true;
    async function fetchMonthly() {
      setLoadingMonthly(true);
      setError("");
      try {
        if (demoMode) {
          if (!alive) return;
          setMonthly(DEMO_MONTHLY);
          setLoadingMonthly(false);
          return;
        }

        const { data } = await api.get("/reports/monthly", {
          params: { year, month },
        });
        if (!alive) return;
        setMonthly(data || null);
      } catch (e) {
        console.error("[Reports] GET /reports/monthly", e);
        if (!alive) return;
        setError("No se pudo cargar el informe mensual.");
        setMonthly(null);
      } finally {
        if (alive) setLoadingMonthly(false);
      }
    }
    fetchMonthly();
    return () => {
      alive = false;
    };
  }, [year, month, demoMode]);

  // Cargar informe por servicio (si hay uno seleccionado)
  useEffect(() => {
    let alive = true;
    if (!serviceId) {
      setServiceReport(null);
      return () => {
        alive = false;
      };
    }

    async function fetchServiceReport() {
      setLoadingService(true);
      try {
        if (demoMode) {
          const svc = services.find(
            (s) => String(s.id) === String(serviceId)
          );
          const name = svc?.name || String(serviceId);
          if (!alive) return;
          setServiceReport(buildDemoServiceReport(serviceId, name));
          setLoadingService(false);
          return;
        }

        const { data } = await api.get(
          `/reports/service/${encodeURIComponent(serviceId)}`,
          { params: { year, month } }
        );
        if (!alive) return;
        setServiceReport(data || null);
      } catch (e) {
        console.error("[Reports] GET /reports/service/:id", e);
        if (!alive) return;
        // No tiramos error global, sólo vaciamos el reporte del servicio
        setServiceReport(null);
      } finally {
        if (alive) setLoadingService(false);
      }
    }

    fetchServiceReport();
    return () => {
      alive = false;
    };
  }, [serviceId, year, month, demoMode, services]);

  const monthLabel = useMemo(
    () => `${monthNameEs(month)} ${year}`,
    [year, month]
  );

  const monthlyTotals = useMemo(() => {
    const t = monthly?.totals || {};
    const ordersCount = Number(t.ordersCount || 0);
    const itemsCount = Number(t.itemsCount || 0);
    const amount = Number(t.amount || 0);
    const avgItems = ordersCount > 0 ? itemsCount / ordersCount : 0;
    return { ordersCount, itemsCount, amount, avgItems };
  }, [monthly]);

  // normalizamos arreglos para que sean estables (evita warnings de hooks)
  const topServices = useMemo(
    () => monthly?.top_services || [],
    [monthly]
  );
  const topProducts = useMemo(
    () => monthly?.top_products || [],
    [monthly]
  );
  const byDay = useMemo(() => monthly?.by_day || [], [monthly]);

  // Nombres de servicios para gráficos/tabla
  const topServicesWithNames = useMemo(() => {
    return (topServices || []).map((s) => {
      const cleanBackendName =
        s.serviceName && s.serviceName !== "—"
          ? String(s.serviceName)
          : "";

      const fromList =
        services.find(
          (svc) => String(svc.id) === String(s.serviceId)
        )?.name || "";

      const label =
        cleanBackendName ||
        fromList ||
        (s.serviceId != null && s.serviceId !== ""
          ? `Servicio ${s.serviceId}`
          : "Sin servicio");

      return { ...s, _label: label };
    });
  }, [topServices, services]);

  const serviceNameSelected = useMemo(() => {
    if (!serviceId) return "";
    if (serviceReport?.service?.name) {
      return serviceReport.service.name;
    }
    const found = services.find((s) => String(s.id) === String(serviceId));
    return found?.name || serviceId;
  }, [services, serviceId, serviceReport]);

  // Helpers de cambio de mes
  const goToCurrentMonth = () => {
    setYear(CURRENT_YEAR);
    setMonth(CURRENT_MONTH);
  };

  const goToPreviousMonth = () => {
    let y = year;
    let m = month - 1;
    if (m <= 0) {
      m = 12;
      y = y - 1;
    }
    setYear(y);
    setMonth(m);
  };

  // Exportar PDF (usa imprimir del navegador)
  const handleExportPdf = () => {
    window.print();
  };

  // CSV simple del resumen mensual (global)
  const exportMonthlyCsv = () => {
    if (!monthly) return;

    const lines = [];

    lines.push(`Resumen mensual;${monthLabel}`);
    lines.push(`Pedidos;${monthlyTotals.ordersCount}`);
    lines.push(`Ítems;${monthlyTotals.itemsCount}`);
    lines.push(`Monto;${monthlyTotals.amount}`);
    lines.push("");

    lines.push("Top servicios (por monto)");
    lines.push("Servicio;Pedidos;Unidades;Monto");
    for (const s of topServicesWithNames) {
      lines.push(
        [
          s._label || "",
          s.pedidos ?? 0,
          s.qty ?? 0,
          s.amount ?? 0,
        ].join(";")
      );
    }
    lines.push("");

    lines.push("Top productos (por monto)");
    lines.push("Código;Producto;Pedidos;Unidades;Monto");
    for (const p of topProducts) {
      lines.push(
        [
          p.code || "",
          p.name || "",
          p.pedidos ?? 0,
          p.qty ?? 0,
          p.amount ?? 0,
        ].join(";")
      );
    }
    lines.push("");

    lines.push("Pedidos por día");
    lines.push("Día;Pedidos;Monto");
    for (const d of byDay) {
      lines.push([d.day || "", d.pedidos ?? 0, d.monto ?? 0].join(";"));
    }

    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `informe_mensual_${year}_${String(month).padStart(
      2,
      "0"
    )}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // CSV del servicio (si hay)
  const exportServiceCsv = () => {
    if (!serviceReport || !serviceId) return;
    const sr = serviceReport;
    const t = sr.totals || {};
    const lines = [];

    lines.push(
      `Servicio;${sr.service?.name || serviceNameSelected} (ID ${
        sr.service?.id || serviceId
      })`
    );
    lines.push(`Mes;${monthLabel}`);
    lines.push(`Pedidos;${t.ordersCount ?? 0}`);
    lines.push(`Ítems;${t.itemsCount ?? 0}`);
    lines.push(`Monto;${t.amount ?? 0}`);
    if (sr.service?.budget != null) {
      lines.push(`Presupuesto;${sr.service.budget}`);
      if (sr.service.utilization != null) {
        lines.push(
          `Uso sobre presupuesto;${(sr.service.utilization * 100).toFixed(
            1
          )}%`
        );
      }
    }
    lines.push("");

    lines.push("Top productos del servicio");
    lines.push("Código;Producto;Pedidos;Unidades;Monto");
    for (const p of sr.top_products || []) {
      lines.push(
        [
          p.code || "",
          p.name || "",
          p.pedidos ?? 0,
          p.qty ?? 0,
          p.amount ?? 0,
        ].join(";")
      );
    }
    lines.push("");

    lines.push("Pedidos del servicio");
    lines.push("PedidoID;Fecha;Total");
    for (const o of sr.orders || []) {
      lines.push([o.id ?? "", niceDate(o.fecha), o.total ?? 0].join(";"));
    }

    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `informe_servicio_${serviceId}_${year}_${String(
      month
    ).padStart(2, "0")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const hasMonthlyData =
    monthlyTotals.ordersCount > 0 ||
    (topServices && topServices.length > 0) ||
    (topProducts && topProducts.length > 0);

  return (
    <section className="admin-panel reports-page">
      <header className="reports-page-header">
        <div>
          <h1>Informes</h1>
          <p className="reports-page-subtitle">
            Resumen mensual de pedidos y consumo de productos.
          </p>

          {/* Toggle de DEMO */}
          <label
            className="no-print"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
              fontSize: "0.8rem",
              color: "#4b5563",
              marginTop: "0.4rem",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={demoMode}
              onChange={(e) => setDemoMode(e.target.checked)}
              style={{ width: 14, height: 14 }}
            />
            <span>Modo demo (datos de ejemplo con gráficos)</span>
          </label>

          {/* Resumen corto que sólo se ve en el PDF */}
          <p className="reports-print-meta print-only">
            Período: {monthLabel} · Servicio:{" "}
            {serviceId ? serviceNameSelected : "Todos los servicios"}
          </p>
        </div>

        <div className="reports-period-filters no-print">
          <label className="reports-field">
            <span>Mes</span>
            <select
              value={month}
              onChange={(e) =>
                setMonth(Number(e.target.value) || CURRENT_MONTH)
              }
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {monthNameEs(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="reports-field">
            <span>Año</span>
            <input
              type="number"
              min="2000"
              max="2100"
              value={year}
              onChange={(e) =>
                setYear(Number(e.target.value) || CURRENT_YEAR)
              }
            />
          </label>
          <div className="reports-period-buttons">
            <button
              type="button"
              className="pill pill--ghost"
              onClick={goToPreviousMonth}
            >
              Mes anterior
            </button>
            <button
              type="button"
              className="pill"
              onClick={goToCurrentMonth}
            >
              Mes actual
            </button>
          </div>
        </div>
      </header>

      <div className="reports-service-filter no-print">
        <label className="reports-field">
          <span>Servicio (detalle opcional)</span>
          <select
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
          >
            <option value="">Todos los servicios</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <div className="reports-service-actions">
          <button
            type="button"
            className="pill pill--ghost"
            onClick={exportMonthlyCsv}
            disabled={!hasMonthlyData}
          >
            Exportar CSV (mes)
          </button>
          {serviceId && serviceReport && (
            <button
              type="button"
              className="pill pill--ghost"
              onClick={exportServiceCsv}
            >
              Exportar CSV (servicio)
            </button>
          )}
          <button
            type="button"
            className="pill"
            onClick={handleExportPdf}
            disabled={!hasMonthlyData}
          >
            Exportar PDF
          </button>
        </div>
      </div>

      {loadingMonthly && (
        <div className="state" style={{ marginTop: 8 }}>
          Cargando informe mensual…
        </div>
      )}
      {error && !loadingMonthly && (
        <div className="state error" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}

      {!loadingMonthly && !error && !hasMonthlyData && (
        <div className="state" style={{ marginTop: 8 }}>
          No hay datos para {monthLabel}.
        </div>
      )}

      {/* Resumen mensual global */}
      {!loadingMonthly && !error && hasMonthlyData && (
        <>
          <section className="reports-section">
            <header className="reports-section-header">
              <div className="reports-section-title">
                <h2>Resumen mensual global</h2>
                <p className="reports-section-subtitle">{monthLabel}</p>
              </div>
            </header>

            <div className="reports-summary-grid">
              <div className="reports-summary-card reports-summary-card--main">
                <div className="reports-summary-label">Pedidos totales</div>
                <div className="reports-summary-value">
                  {niceNumber(monthlyTotals.ordersCount)}
                </div>
                <div className="reports-summary-sub">
                  Ítems totales:{" "}
                  <strong>{niceNumber(monthlyTotals.itemsCount)}</strong>
                </div>
              </div>

              <div className="reports-summary-card">
                <div className="reports-summary-label">
                  Monto total del período
                </div>
                <div className="reports-summary-value">
                  {niceCurrency(monthlyTotals.amount)}
                </div>
                <div className="reports-summary-sub">
                  Basado en los pedidos registrados en el mes.
                </div>
              </div>

              <div className="reports-summary-card">
                <div className="reports-summary-label">
                  Promedio de ítems por pedido
                </div>
                <div className="reports-summary-value">
                  {monthlyTotals.avgItems.toFixed(1)}
                </div>
                <div className="reports-summary-sub">
                  {monthlyTotals.ordersCount > 0
                    ? `Sobre ${niceNumber(
                        monthlyTotals.ordersCount
                      )} pedidos.`
                    : "Sin pedidos en el mes."}
                </div>
              </div>
            </div>

            {/* Top servicios */}
            <div className="reports-section-block">
              <h3 className="reports-subtitle">
                Servicios con mayor consumo (por monto)
              </h3>

              {topServicesWithNames &&
                topServicesWithNames.length > 0 && (
                  <HorizontalBarChart
                    data={topServicesWithNames}
                    valueKey="amount"
                    labelKey="_label"
                    valueFormatter={(v) => niceCurrency(v)}
                  />
                )}

              <div className="reports-table-wrapper">
                <table
                  className="reports-table"
                  aria-label="Servicios con mayor consumo"
                >
                  <thead>
                    <tr>
                      <th>Servicio</th>
                      <th className="numeric">Pedidos</th>
                      <th className="numeric">Unidades</th>
                      <th className="numeric">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(!topServicesWithNames ||
                      topServicesWithNames.length === 0) && (
                      <tr>
                        <td colSpan={4} className="empty">
                          No hay pedidos asociados a servicios en el mes.
                        </td>
                      </tr>
                    )}
                    {topServicesWithNames.map((s) => (
                      <tr key={s.serviceId || s._label}>
                        <td>{s._label}</td>
                        <td className="numeric">
                          {niceNumber(s.pedidos ?? 0)}
                        </td>
                        <td className="numeric">
                          {niceNumber(s.qty ?? 0)}
                        </td>
                        <td className="numeric">
                          {niceCurrency(s.amount ?? 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Top productos */}
            <div className="reports-section-block">
              <h3 className="reports-subtitle">
                Productos más consumidos (por monto)
              </h3>

              {topProducts && topProducts.length > 0 && (
                <HorizontalBarChart
                  data={topProducts.map((p) => ({
                    ...p,
                    _label: p.name || p.code || "—",
                  }))}
                  valueKey="amount"
                  labelKey="_label"
                  valueFormatter={(v) => niceCurrency(v)}
                />
              )}

              <div className="reports-table-wrapper">
                <table
                  className="reports-table"
                  aria-label="Productos más consumidos"
                >
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Producto</th>
                      <th className="numeric">Pedidos</th>
                      <th className="numeric">Unidades</th>
                      <th className="numeric">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(!topProducts || topProducts.length === 0) && (
                      <tr>
                        <td colSpan={5} className="empty">
                          No hay consumos de productos en el mes.
                        </td>
                      </tr>
                    )}
                    {topProducts.map((p) => (
                      <tr key={p.productId || p.name}>
                        <td>{p.code || "—"}</td>
                        <td>{p.name || "—"}</td>
                        <td className="numeric">
                          {niceNumber(p.pedidos ?? 0)}
                        </td>
                        <td className="numeric">
                          {niceNumber(p.qty ?? 0)}
                        </td>
                        <td className="numeric">
                          {niceCurrency(p.amount ?? 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pedidos por día */}
            <div className="reports-section-block">
              <h3 className="reports-subtitle">Pedidos por día</h3>

              <BarChartByDay data={byDay} />

              <div className="reports-table-wrapper">
                <table
                  className="reports-table"
                  aria-label="Pedidos por día"
                >
                  <thead>
                    <tr>
                      <th>Día</th>
                      <th className="numeric">Pedidos</th>
                      <th className="numeric">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(!byDay || byDay.length === 0) && (
                      <tr>
                        <td colSpan={3} className="empty">
                          No hay pedidos registrados en el mes.
                        </td>
                      </tr>
                    )}
                    {byDay.map((d) => (
                      <tr key={d.day}>
                        <td>{niceDate(d.day)}</td>
                        <td className="numeric">
                          {niceNumber(d.pedidos ?? 0)}
                        </td>
                        <td className="numeric">
                          {niceCurrency(d.monto ?? 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* Detalle por servicio (opcional) */}
          {serviceId && (
            <section className="reports-section">
              <header className="reports-section-header">
                <div className="reports-section-title">
                  <h2>Detalle del servicio</h2>
                  <p className="reports-section-subtitle">
                    {serviceNameSelected} · {monthLabel}
                  </p>
                </div>
              </header>

              {loadingService && (
                <div className="state" style={{ marginTop: 8 }}>
                  Cargando detalle del servicio…
                </div>
              )}

              {!loadingService && !serviceReport && (
                <div className="state" style={{ marginTop: 8 }}>
                  No hay datos para este servicio en el mes.
                </div>
              )}

              {!loadingService && serviceReport && (
                <>
                  <div className="reports-summary-grid">
                    <div className="reports-summary-card">
                      <div className="reports-summary-label">
                        Pedidos del servicio
                      </div>
                      <div className="reports-summary-value">
                        {niceNumber(
                          serviceReport.totals?.ordersCount ?? 0
                        )}
                      </div>
                      <div className="reports-summary-sub">
                        Ítems totales:{" "}
                        <strong>
                          {niceNumber(
                            serviceReport.totals?.itemsCount ?? 0
                          )}
                        </strong>
                      </div>
                    </div>

                    <div className="reports-summary-card">
                      <div className="reports-summary-label">
                        Monto total del servicio
                      </div>
                      <div className="reports-summary-value">
                        {niceCurrency(
                          serviceReport.totals?.amount ?? 0
                        )}
                      </div>
                    </div>

                    <div className="reports-summary-card">
                      <div className="reports-summary-label">
                        Presupuesto asignado
                      </div>
                      <div className="reports-summary-value">
                        {serviceReport.service?.budget != null
                          ? niceCurrency(serviceReport.service.budget)
                          : "—"}
                      </div>
                      {serviceReport.service?.utilization != null && (
                        <div className="reports-summary-sub">
                          Uso del presupuesto:{" "}
                          <strong>
                            {(
                              serviceReport.service.utilization * 100
                            ).toFixed(1)}
                            %
                          </strong>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="reports-two-columns">
                    <div className="reports-section-block">
                      <h3 className="reports-subtitle">
                        Productos más consumidos en este servicio
                      </h3>

                      {serviceReport.top_products &&
                        serviceReport.top_products.length > 0 && (
                          <HorizontalBarChart
                            data={serviceReport.top_products.map((p) => ({
                              ...p,
                              _label: p.name || p.code || "—",
                            }))}
                            valueKey="amount"
                            labelKey="_label"
                            valueFormatter={(v) => niceCurrency(v)}
                          />
                        )}

                      <div className="reports-table-wrapper">
                        <table
                          className="reports-table"
                          aria-label="Productos del servicio"
                        >
                          <thead>
                            <tr>
                              <th>Código</th>
                              <th>Producto</th>
                              <th className="numeric">Pedidos</th>
                              <th className="numeric">Unidades</th>
                              <th className="numeric">Monto</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(!serviceReport.top_products ||
                              serviceReport.top_products.length ===
                                0) && (
                              <tr>
                                <td colSpan={5} className="empty">
                                  No hay productos asociados al servicio en
                                  el mes.
                                </td>
                              </tr>
                            )}
                            {(serviceReport.top_products || []).map(
                              (p) => (
                                <tr key={p.productId || p.name}>
                                  <td>{p.code || "—"}</td>
                                  <td>{p.name || "—"}</td>
                                  <td className="numeric">
                                    {niceNumber(p.pedidos ?? 0)}
                                  </td>
                                  <td className="numeric">
                                    {niceNumber(p.qty ?? 0)}
                                  </td>
                                  <td className="numeric">
                                    {niceCurrency(p.amount ?? 0)}
                                  </td>
                                </tr>
                              )
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="reports-section-block">
                      <h3 className="reports-subtitle">
                        Pedidos del servicio
                      </h3>
                      <div className="reports-table-wrapper">
                        <table
                          className="reports-table"
                          aria-label="Pedidos del servicio"
                        >
                          <thead>
                            <tr>
                              <th>Pedido</th>
                              <th>Fecha</th>
                              <th className="numeric">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(!serviceReport.orders ||
                              serviceReport.orders.length === 0) && (
                              <tr>
                                <td colSpan={3} className="empty">
                                  No hay pedidos del servicio en el mes.
                                </td>
                              </tr>
                            )}
                            {(serviceReport.orders || []).map((o) => (
                              <tr key={o.id}>
                                <td>#{o.id}</td>
                                <td>{niceDate(o.fecha)}</td>
                                <td className="numeric">
                                  {niceCurrency(o.total ?? 0)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}
