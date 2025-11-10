// client/src/pages/Deposito.jsx
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import "../styles/deposito.css";

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function isoFirstOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function isoNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function isoFirstOfYear() {
  const d = new Date();
  return new Date(d.getFullYear(), 0, 1).toISOString().slice(0, 10);
}

// Helper para ordenar
function sortByField(rows, field, dir, getExtraValue) {
  const mul = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const aVal = getExtraValue ? getExtraValue(a, field) : a[field];
    const bVal = getExtraValue ? getExtraValue(b, field) : b[field];

    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;

    if (typeof aVal === "string" && typeof bVal === "string") {
      return aVal.localeCompare(bVal) * mul;
    }
    const na = Number(aVal);
    const nb = Number(bVal);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      return (na - nb) * mul;
    }
    return 0;
  });
}

// Estima cuántos días alcanza el stock actual, según consumo desde el último ingreso
function calcCoverageDays(stockActual, consumosRow) {
  const stock = Number(stockActual || 0);
  const consumido = Number(consumosRow?.consumido || 0);
  const lastIng = consumosRow?.last_ingreso;

  if (!lastIng || !consumido || consumido <= 0 || stock <= 0) return null;

  const lastDate = new Date(lastIng);
  if (Number.isNaN(lastDate.getTime())) return null;

  const now = new Date();
  const diffMs = now.getTime() - lastDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  const days = diffDays <= 0 ? 1 : diffDays;

  const avgPerDay = consumido / days;
  if (avgPerDay <= 0) return null;

  const coverage = stock / avgPerDay;
  if (!Number.isFinite(coverage) || coverage <= 0) return null;

  return coverage;
}

export default function Deposito() {
  const [start, setStart] = useState(isoFirstOfMonth());
  const [end, setEnd] = useState(isoToday());
  const [threshold, setThreshold] = useState(10);

  // % de riesgo (por defecto 30%)
  const [riskPercent, setRiskPercent] = useState(30);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [top, setTop] = useState([]);
  const [low, setLow] = useState([]);
  const [consumos, setConsumos] = useState({}); // { [productId]: detalles }

  // Filtros locales
  const [searchTop, setSearchTop] = useState("");
  const [searchLow, setSearchLow] = useState("");

  // Filtro de stock bajo: todos / sin stock / en riesgo / bajo resto
  const [lowFilter, setLowFilter] = useState("all"); // 'all' | 'sin-stock' | 'riesgo' | 'bajo'

  // Ordenamiento
  const [sortTop, setSortTop] = useState({ field: "total", dir: "desc" });
  const [sortLow, setSortLow] = useState({ field: "stock", dir: "asc" });

  const nf = useMemo(() => new Intl.NumberFormat("es-AR"), []);

  const fechaInvalida = useMemo(
    () => !!start && !!end && start > end,
    [start, end]
  );

  useEffect(() => {
    if (fechaInvalida) return; // No pedir si el rango está mal

    let alive = true;

    async function fetchOverview() {
      setLoading(true);
      setError("");
      try {
        const r = await api.get("/deposito/overview", {
          params: { start, end, threshold },
        });
        if (!alive) return;

        const topRows = r.data?.top || [];
        const lowRows = r.data?.low || [];

        setTop(topRows);
        setLow(lowRows);

        // Cargar detalles por producto para la tabla de stock bajo
        const calls = lowRows.map((row) =>
          api
            .get(`/deposito/consumo-desde-ultimo-ingreso/${row.productId}`, {
              params: { fallbackStart: start },
            })
            .then((rsp) => ({
              productId: row.productId,
              ...rsp.data,
            }))
            .catch(() => ({
              productId: row.productId,
              consumido: null,
              last_ingreso: null,
              incoming_total: null,
              next_eta: null,
            }))
        );

        const details = await Promise.all(calls);
        if (!alive) return;
        const byId = Object.fromEntries(
          details.map((d) => [String(d.productId), d])
        );
        setConsumos(byId);
      } catch (e) {
        console.error(e);
        setError("No se pudo cargar el panel de Depósito");
      } finally {
        if (alive) setLoading(false);
      }
    }

    fetchOverview();
    return () => {
      alive = false;
    };
  }, [start, end, threshold, fechaInvalida]);

  /* ===== Rango rápido de fechas ===== */
  const setQuickRange = (type) => {
    const today = isoToday();
    if (type === "7d") {
      setStart(isoNDaysAgo(7));
      setEnd(today);
    } else if (type === "30d") {
      setStart(isoNDaysAgo(30));
      setEnd(today);
    } else if (type === "month") {
      setStart(isoFirstOfMonth());
      setEnd(today);
    } else if (type === "year") {
      setStart(isoFirstOfYear());
      setEnd(today);
    }
  };

  /* ===== Resumen rápido (con nueva lógica de riesgo) ===== */
  const resumen = useMemo(() => {
    const totalConsumido = top.reduce(
      (sum, r) => sum + (Number(r.total) || 0),
      0
    );
    const productosTop = top.length;
    const productosBajo = low.length;

    let productosEnRiesgo = 0;
    let productosSinStock = 0;

    const riesgoLimite =
      threshold > 0 ? Math.floor(threshold * (riskPercent / 100)) : 0;

    for (const r of low) {
      const stockActual = Number(r.stock || 0);

      if (stockActual <= 0) {
        productosSinStock += 1;
        continue;
      }
      const enRiesgo =
        riesgoLimite > 0 && stockActual > 0 && stockActual <= riesgoLimite;
      if (enRiesgo) productosEnRiesgo += 1;
    }

    const bajoResto = Math.max(
      0,
      productosBajo - productosSinStock - productosEnRiesgo
    );

    return {
      totalConsumido,
      productosTop,
      productosBajo,
      productosEnRiesgo,
      productosSinStock,
      bajoResto,
      riesgoLimite,
    };
  }, [top, low, threshold, riskPercent]);

  /* ===== Tablas filtradas y ordenadas ===== */

  const topFiltrados = useMemo(() => {
    let rows = top;
    if (searchTop.trim()) {
      const q = searchTop.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          String(r.name || "").toLowerCase().includes(q) ||
          String(r.unit || "").toLowerCase().includes(q)
      );
    }
    rows = sortByField(rows, sortTop.field, sortTop.dir);
    return rows;
  }, [top, searchTop, sortTop]);

  const lowFiltrados = useMemo(() => {
    let rows = low;
    if (searchLow.trim()) {
      const q = searchLow.trim().toLowerCase();
      rows = rows.filter((r) =>
        String(r.name || "").toLowerCase().includes(q)
      );
    }

    const riesgoLimite =
      threshold > 0 ? Math.floor(threshold * (riskPercent / 100)) : 0;

    // Aplicar filtro (todos / sin stock / en riesgo / bajo resto)
    if (lowFilter !== "all") {
      rows = rows.filter((r) => {
        const stockActual = Number(r.stock || 0);
        if (lowFilter === "sin-stock") return stockActual <= 0;
        if (lowFilter === "riesgo") {
          return (
            stockActual > 0 &&
            riesgoLimite > 0 &&
            stockActual <= riesgoLimite
          );
        }
        if (lowFilter === "bajo") {
          return (
            stockActual > riesgoLimite &&
            (threshold <= 0 || stockActual <= threshold)
          );
        }
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

    rows = sortByField(rows, sortLow.field, sortLow.dir, getValue);
    return rows;
  }, [
    low,
    searchLow,
    sortLow,
    consumos,
    lowFilter,
    threshold,
    riskPercent,
  ]);

  const handleSortTop = (field) => {
    setSortTop((prev) => {
      if (prev.field === field) {
        return { field, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      return { field, dir: "desc" };
    });
  };

  const handleSortLow = (field) => {
    setSortLow((prev) => {
      if (prev.field === field) {
        return { field, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      return { field, dir: field === "name" ? "asc" : "asc" };
    });
  };

  const sortIndicator = (current, field) =>
    current.field === field ? (current.dir === "asc" ? " ▲" : " ▼") : "";

  /* ===== Exportar CSV de stock bajo ===== */

  const handleExportLowCsv = () => {
    if (!lowFiltrados.length) return;

    const header = [
      "Producto",
      "Stock",
      "ConsumoDesdeUltIngreso",
      "FechaUltIngreso",
      "IngresoFuturo",
      "ProximaETA",
      "CoberturaDias",
    ];

    const rows = lowFiltrados.map((r) => {
      const d = consumos[String(r.productId)] || {};
      const stockActual = Number(r.stock || 0);
      const coverage = calcCoverageDays(stockActual, d);

      return [
        r.name || "",
        stockActual,
        d.consumido ?? "",
        d.last_ingreso ? String(d.last_ingreso).slice(0, 10) : "",
        d.incoming_total ?? "",
        d.next_eta ? String(d.next_eta).slice(0, 10) : "",
        coverage != null ? coverage.toFixed(1) : "",
      ];
    });

    const csvLines = [
      header.join(";"),
      ...rows.map((row) =>
        row
          .map((v) =>
            String(v).includes(";") || String(v).includes('"')
              ? `"${String(v).replace(/"/g, '""')}"`
              : String(v)
          )
          .join(";")
      ),
    ];

    const blob = new Blob([csvLines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock_bajo_${start}_${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ===== Render ===== */

  return (
    <section className="admin-panel deposito-page">
      <h1 className="deposito-title">Encargado de Depósito</h1>

      {/* Filtros de cabecera */}
      <div className="filters deposito-filters">
        <label className="deposito-field">
          <span>Desde</span>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>

        <label className="deposito-field">
          <span>Hasta</span>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>

        <label className="deposito-field">
          <span>Umbral stock bajo (unidades)</span>
          <input
            type="number"
            min="0"
            value={threshold}
            onChange={(e) =>
              setThreshold(
                Number.isNaN(parseInt(e.target.value, 10))
                  ? 0
                  : parseInt(e.target.value, 10)
              )
            }
          />
        </label>

        <label className="deposito-field">
          <span>Riesgo (%)</span>
          <input
            type="number"
            min="1"
            max="100"
            value={riskPercent}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              setRiskPercent(
                Number.isNaN(v)
                  ? 30
                  : Math.min(100, Math.max(1, v))
              );
            }}
          />
        </label>

        <div className="deposito-quickranges">
          <span className="deposito-quickranges-label">Rangos rápidos</span>
          <div className="deposito-quickranges-buttons">
            <button
              type="button"
              className="pill pill--ghost"
              onClick={() => setQuickRange("7d")}
            >
              Últimos 7 días
            </button>
            <button
              type="button"
              className="pill pill--ghost"
              onClick={() => setQuickRange("30d")}
            >
              Últimos 30 días
            </button>
            <button
              type="button"
              className="pill pill--ghost"
              onClick={() => setQuickRange("month")}
            >
              Este mes
            </button>
            <button
              type="button"
              className="pill pill--ghost"
              onClick={() => setQuickRange("year")}
            >
              Año actual
            </button>
          </div>
        </div>
      </div>

      {fechaInvalida && (
        <div className="state error deposito-state">
          El rango de fechas es inválido (Desde &gt; Hasta).
        </div>
      )}

      {loading && <div className="state deposito-state">Cargando…</div>}
      {error && !loading && (
        <div className="state error deposito-state">{error}</div>
      )}

      {/* Resumen rápido */}
      {!loading && !error && !fechaInvalida && (
        <div className="deposito-summary">
          <div className="deposito-summary-card deposito-summary-card--main">
            <div className="deposito-summary-label">
              Consumo total (unidades)
            </div>
            <div className="deposito-summary-value">
              {nf.format(resumen.totalConsumido)}
            </div>
            <div className="deposito-summary-sub">
              {start} → {end}
            </div>
          </div>

          <div className="deposito-summary-card">
            <div className="deposito-summary-label">Productos con consumo</div>
            <div className="deposito-summary-value">
              {resumen.productosTop}
            </div>
            <div className="deposito-summary-sub">cantidad de productos</div>
          </div>

          <div className="deposito-summary-card deposito-summary-card--alert">
            <div className="deposito-summary-label">
              Stock bajo (productos)
            </div>
            <div className="deposito-summary-value">
              {resumen.productosBajo}
            </div>
            <div className="deposito-summary-sub">
              Se considera <b>stock bajo</b> cuando{" "}
              <code>stock ≤ {threshold}</code>.
            </div>
            <div className="deposito-legend">
              <span className="legend-dot legend-danger"></span>
              <span>
                Sin stock (0): <b>{resumen.productosSinStock}</b>
              </span>
              <span className="legend-dot legend-warning"></span>
              <span>
                En riesgo (1..{resumen.riesgoLimite}):{" "}
                <b>{resumen.productosEnRiesgo}</b>
              </span>
              <span className="legend-dot legend-neutral"></span>
              <span>
                Bajo (resto): <b>{resumen.bajoResto}</b>
              </span>
            </div>
          </div>

          <div className="deposito-summary-card deposito-summary-card--alert">
            <div className="deposito-summary-label">Críticos</div>
            <div className="deposito-critical">
              <div>
                <b>{resumen.productosSinStock}</b>
                <small>Sin stock (0)</small>
              </div>
              <div>
                <b>{resumen.productosEnRiesgo}</b>
                <small>
                  En riesgo (≤ {resumen.riesgoLimite})
                </small>
              </div>
            </div>
            <div className="deposito-summary-sub">
              Riesgo = {riskPercent}% del umbral
            </div>
          </div>
        </div>
      )}

      {!loading && !error && !fechaInvalida && (
        <div className="deposito-grid">
          {/* Más consumidos */}
          <div className="card deposito-card">
            <div className="card-header deposito-card-header">
              <div>
                <h2>Más consumidos</h2>
                <small>
                  {start} → {end}
                </small>
              </div>
              <div>
                <input
                  type="search"
                  className="deposito-search"
                  placeholder="Buscar producto…"
                  value={searchTop}
                  onChange={(e) => setSearchTop(e.target.value)}
                />
              </div>
            </div>
            <div className="deposito-table-wrapper">
              <table
                className="deposito-table"
                aria-label="Productos más consumidos"
              >
                <thead>
                  <tr>
                    <th
                      onClick={() => handleSortTop("name")}
                      className="deposito-th--sortable"
                      scope="col"
                    >
                      Producto{sortIndicator(sortTop, "name")}
                    </th>
                    <th
                      onClick={() => handleSortTop("unit")}
                      className="deposito-th--sortable"
                      scope="col"
                    >
                      Unidad{sortIndicator(sortTop, "unit")}
                    </th>
                    <th
                      onClick={() => handleSortTop("total")}
                      className="deposito-th--sortable deposito-th--numeric"
                      scope="col"
                    >
                      Total{sortIndicator(sortTop, "total")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topFiltrados.length === 0 && (
                    <tr>
                      <td colSpan={3} className="deposito-empty">
                        Sin consumos en el período
                      </td>
                    </tr>
                  )}
                  {topFiltrados.map((r) => (
                    <tr key={r.productId} className="deposito-row">
                      <td>{r.name}</td>
                      <td>{r.unit || "-"}</td>
                      <td className="deposito-td--numeric">
                        {nf.format(r.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Stock bajo */}
          <div className="card deposito-card deposito-card--alert">
            <div className="card-header deposito-card-header">
              <div>
                <h2>Stock bajo</h2>
              </div>
              <div className="deposito-header-actions">
                <div className="deposito-lowfilter">
                  <button
                    type="button"
                    className={`pill pill--ghost deposito-lowfilter-btn ${
                      lowFilter === "all" ? "is-active" : ""
                    }`}
                    onClick={() => setLowFilter("all")}
                  >
                    Todos ({resumen.productosBajo})
                  </button>
                  <button
                    type="button"
                    className={`pill pill--ghost deposito-lowfilter-btn ${
                      lowFilter === "sin-stock" ? "is-active" : ""
                    }`}
                    onClick={() => setLowFilter("sin-stock")}
                  >
                    Sin stock ({resumen.productosSinStock})
                  </button>
                  <button
                    type="button"
                    className={`pill pill--ghost deposito-lowfilter-btn ${
                      lowFilter === "riesgo" ? "is-active" : ""
                    }`}
                    onClick={() => setLowFilter("riesgo")}
                  >
                    En riesgo ({resumen.productosEnRiesgo})
                  </button>
                  <button
                    type="button"
                    className={`pill pill--ghost deposito-lowfilter-btn ${
                      lowFilter === "bajo" ? "is-active" : ""
                    }`}
                    onClick={() => setLowFilter("bajo")}
                  >
                    Bajo (resto) ({resumen.bajoResto})
                  </button>
                </div>

                <input
                  type="search"
                  className="deposito-search"
                  placeholder="Buscar producto…"
                  value={searchLow}
                  onChange={(e) => setSearchLow(e.target.value)}
                />
                <button
                  type="button"
                  className="pill deposito-export-btn"
                  onClick={handleExportLowCsv}
                  disabled={!lowFiltrados.length}
                >
                  Exportar CSV
                </button>
              </div>
            </div>
            <div className="deposito-table-wrapper">
              <table
                className="deposito-table"
                aria-label="Productos con stock bajo"
              >
                <thead>
                  <tr>
                    <th
                      onClick={() => handleSortLow("name")}
                      className="deposito-th--sortable"
                      scope="col"
                    >
                      Producto{sortIndicator(sortLow, "name")}
                    </th>
                    <th
                      onClick={() => handleSortLow("stock")}
                      className="deposito-th--sortable deposito-th--numeric"
                      scope="col"
                    >
                      Stock{sortIndicator(sortLow, "stock")}
                    </th>
                    <th
                      onClick={() => handleSortLow("consumido")}
                      className="deposito-th--sortable deposito-th--numeric"
                      scope="col"
                    >
                      Consumo desde último ingreso
                      {sortIndicator(sortLow, "consumido")}
                    </th>
                    <th
                      onClick={() => handleSortLow("incoming")}
                      className="deposito-th--sortable deposito-th--numeric"
                      scope="col"
                    >
                      Ingreso futuro
                      {sortIndicator(sortLow, "incoming")}
                    </th>
                    <th
                      onClick={() => handleSortLow("coverage")}
                      className="deposito-th--sortable deposito-th--numeric"
                      scope="col"
                    >
                      Cobertura (días)
                      {sortIndicator(sortLow, "coverage")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lowFiltrados.length === 0 && (
                    <tr>
                      <td colSpan={5} className="deposito-empty">
                        No hay alertas de stock bajo
                      </td>
                    </tr>
                  )}
                  {lowFiltrados.map((r) => {
                    const d = consumos[String(r.productId)] || {};
                    const stockActual = Number(r.stock || 0);
                    const coverage = calcCoverageDays(stockActual, d);

                    const sinStock = stockActual <= 0;
                    const riesgoLimite =
                      threshold > 0
                        ? Math.floor(threshold * (riskPercent / 100))
                        : 0;
                    const enRiesgo =
                      stockActual > 0 &&
                      riesgoLimite > 0 &&
                      stockActual <= riesgoLimite;

                    const ratio =
                      threshold > 0
                        ? Math.max(
                            0,
                            Math.min(stockActual / threshold, 1)
                          )
                        : 0;

                    const rowClasses = [
                      "deposito-row",
                      sinStock
                        ? "deposito-row--sin-stock"
                        : enRiesgo
                        ? "deposito-row--riesgo"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ");

                    return (
                      <tr key={r.productId} className={rowClasses}>
                        <td>
                          {r.name}
                          {sinStock && (
                            <span className="deposito-badge deposito-badge--danger">
                              SIN STOCK
                            </span>
                          )}
                          {!sinStock && enRiesgo && (
                            <span className="deposito-badge deposito-badge--warning">
                              en riesgo
                            </span>
                          )}
                        </td>
                        <td className="deposito-td--numeric">
                          {nf.format(stockActual)}
                          <div
                            className="deposito-stockbar"
                            style={{ "--ratio": ratio }}
                            aria-hidden="true"
                          >
                            <div className="deposito-stockbar-fill" />
                          </div>
                        </td>
                        <td className="deposito-td--numeric">
                          {d.consumido == null
                            ? "-"
                            : nf.format(d.consumido)}
                          <div className="deposito-subtext">
                            desde{" "}
                            {d.last_ingreso
                              ? String(d.last_ingreso).slice(0, 10)
                              : start}
                          </div>
                        </td>
                        <td className="deposito-td--numeric">
                          {d.incoming_total ? nf.format(d.incoming_total) : "-"}
                          {d.next_eta && (
                            <div className="deposito-subtext">
                              ETA {String(d.next_eta).slice(0, 10)}
                            </div>
                          )}
                        </td>
                        <td className="deposito-td--numeric">
                          {coverage == null
                            ? "-"
                            : `${coverage.toFixed(1)} d`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="deposito-footnote">
              Tip: para cargar ingresos futuros, usá la sección{" "}
              <strong>Futuro Ingreso</strong> en el panel Administrativo.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
