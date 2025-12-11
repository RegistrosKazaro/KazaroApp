// client/src/pages/Deposito.jsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { api } from "../api/client";
import "../styles/deposito.css";

/* ========= Utilidades existentes ========= */
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

// Estima cuántos días alcanza el stock actual
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

/* ========= Sección NUEVA: Pedidos (Depósito) ========= */
const API_BASE_URL =
  (import.meta?.env && import.meta.env.VITE_API_URL) || "http://localhost:4000";

const useDebounced = (value, delay = 300) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
};

function DepositoOrdersPanel() {
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
    const n = Number(v || 0);
    try {
      return new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: "ARS",
        maximumFractionDigits: 2,
      }).format(n);
    } catch {
      return `$ ${Number(n || 0).toFixed(2)}`;
    }
  };

  const parseDbDateToMs = (raw) => {
    if (!raw) return NaN;
    try {
      const base = String(raw).replace(" ", "T");
      return new Date(base + "-03:00").getTime();
    } catch {
      return NaN;
    }
  };

  const formatFechaAr = (raw) => {
    const t = parseDbDateToMs(raw);
    if (Number.isNaN(t)) return raw || "";
    return new Date(t).toLocaleString("es-AR", {
      timeZone: "America/Argentina/Cordoba",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const list = useCallback(async () => {
    setErr("");
    try {
      const { data } = await api.get("/deposito/orders", {
        params: { status: tab },
        withCredentials: true,
      });
      setOrders(Array.isArray(data) ? data : []);
    } catch (e) {
      try {
        const { data } = await api.get("/admin/orders", {
          withCredentials: true,
        });
        setOrders(Array.isArray(data) ? data : []);
      } catch (e2) {
        console.error("No se pudieron cargar pedidos", e2);
        setErr(
          e?.response?.data?.error ||
            e2?.message ||
            "No se pudieron cargar los pedidos"
        );
        setOrders([]);
      }
    }
  }, [tab]);

  useEffect(() => {
    list();
  }, [list]);

  const filtered = useMemo(() => {
    let arr = orders.slice();

    const t = String(qDeb || "").trim().toLowerCase();
    if (t) {
      const tId = t.startsWith("#") ? t.slice(1) : t;
      arr = arr.filter((o) => {
        const idStr = String(o.id ?? "").toLowerCase();
        // CAMBIO: Buscar por nombre del empleado si está disponible
        const empleado = String(o.empleadoNombre || o.empleadoId || "").toLowerCase();
        const rol = String(o.rol ?? "").toLowerCase();
        const remito = (
          o.remitoDisplay ??
          o.remito ??
          o.remitoNumber ??
          o.remito_numero ??
          o.numero_remito ??
          o.nro_remito ??
          o.remitonumero ??
          o.remito_num ??
          ""
        ).toLowerCase();
        const total = o.total != null ? String(o.total) : "";
        const fecha = String(o.fecha || "").toLowerCase();
        return (
          idStr.includes(tId) ||
          remito.includes(t) ||
          empleado.includes(t) ||
          rol.includes(t) ||
          total.includes(t) ||
          fecha.includes(t)
        );
      });
    }

    arr.sort((a, b) => {
      switch (sort) {
        case "fecha_asc":
          return parseDbDateToMs(a.fecha) - parseDbDateToMs(b.fecha);
        case "total_desc":
          return (b.total ?? 0) - (a.total ?? 0);
        case "total_asc":
          return (a.total ?? 0) - (b.total ?? 0);
        case "id_desc":
          return (b.id ?? 0) - (a.id ?? 0);
        case "id_asc":
          return (a.id ?? 0) - (b.id ?? 0);
        case "fecha_desc":
        default:
          return parseDbDateToMs(b.fecha) - parseDbDateToMs(a.fecha);
      }
    });

    return arr;
  }, [orders, qDeb, sort]);

  const remitoNum = (o) => {
    const val =
    o.remitoDisplay ??
    o.remito ??
    o.remitoNumber ??
    o.remito_numero ??
    o.numero_remito ??
    o.nro_remito ??
    o.remitonumero ??
    o.remito_num ??
    null;
    if (val == null || val === "") {
      return "-";
    }
    return val;
  };

  const moveToPreparing = async (id) => {
    setErr("");

    try {
      await api.put(
        `/deposito/orders/${id}/prepare`,
        {},
        { withCredentials: true }
      );
    } catch (e) {
      setErr(
        e?.response?.data?.error ||
          e.message ||
          "No se pudo pasar el pedido a preparación"
      );
      return;
    }

    setOrders((prev) => prev.filter((o) => o.id !== id));
  };

  const closeOrder = async (id) => {
    setErr("");

    try {
      await api.put(
        `/deposito/orders/${id}/close`,
        {},
        { withCredentials: true }
      );
    } catch (e) {
      setErr(
        e?.response?.data?.error || e.message || "No se pudo cerrar el pedido"
      );
      return;
    }

    const nowIso = new Date().toISOString();

    setOrders((prev) =>
      prev.map((o) =>
        o.id === id
          ? {
              ...o,
              status: "closed",
              estado: "cerrado",
              isClosed: true,
              is_closed: 1,
              cerrado: 1,
              closedAt: nowIso,
              closed_at: nowIso,
              ClosedAt: nowIso,
            }
          : o
      )
    );

    setTab("closed");
  };

  const reopenOrder = async (id) => {
    setErr("");

    try {
      await api.put(
        `/deposito/orders/${id}/reopen`,
        {},
        { withCredentials: true }
      );
    } catch (e) {
      setErr(
        e?.response?.data?.error ||
          e.message ||
          "No se pudo reabrir el pedido"
      );
      return;
    }

    setOrders((prev) =>
      prev.map((o) =>
        o.id === id
          ? {
              ...o,
              status: "open",
              estado: "abierto",
              isClosed: false,
              is_closed: 0,
              cerrado: 0,
              closedAt: null,
              closed_at: null,
              ClosedAt: null,
            }
          : o
      )
    );

    setTab("open");
  };

  const fetchPdfSmart = async (id) => {
    const paths = [
      `/orders/pdf/${id}`,
      `/admin/orders/pdf/${id}`,
      `/orders/${id}/pdf`,
    ];
    for (const path of paths) {
      try {
        const res = await api.get(path, {
          responseType: "blob",
          headers: { Accept: "application/pdf" },
          withCredentials: true,
        });
        const ct = (
          res.headers?.["content-type"] ||
          res.headers?.["Content-Type"] ||
          ""
        ).toLowerCase();
        const blob = res.data;
        if (!ct.includes("application/pdf")) {
          const txt = await blob.text().catch(() => "");
          throw new Error(`CT="${ct}". ${txt ? "Detalle: " + txt : ""}`);
        }
        return URL.createObjectURL(blob);
      } catch (e) {
        console.debug("fetchPdfSmart intent falló", path, e?.message);
      }
    }
    const abs =
      (API_BASE_URL?.replace(/\/$/, "") || "") + `/orders/pdf/${id}`;
    const r = await fetch(abs, {
      headers: { Accept: "application/pdf" },
      credentials: "include",
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const blob = await r.blob();
    return URL.createObjectURL(blob);
  };

  const onPreviewRemito = async (o) => {
    setSelected(o);
    setPreviewErr("");
    setPreviewLoading(true);
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl);
      setPdfUrl(null);
    }
    try {
      const url = await fetchPdfSmart(o.id);
      setPdfUrl(url);
    } catch (e) {
      setPreviewErr(e?.message || "No se pudo cargar el remito");
      setSelected(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setSelected(null);
    setPreviewErr("");
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl);
      setPdfUrl(null);
    }
  };

  return (
    <div className="deposito-orders">
      <div
        className="deposito-header-actions"
        style={{ gap: 8, marginBottom: 8 }}
      >
        <button
          type="button"
          className={`pill pill--ghost ${tab === "open" ? "is-active" : ""}`}
          onClick={() => setTab("open")}
        >
          Pedidos
        </button>

        <button
          type="button"
          className={`pill pill--ghost ${
            tab === "preparing" ? "is-active" : ""
          }`}
          onClick={() => setTab("preparing")}
        >
          Pedidos en preparación
        </button>

        <button
          type="button"
          className={`pill pill--ghost ${tab === "closed" ? "is-active" : ""}`}
          onClick={() => setTab("closed")}
        >
          Pedidos cerrados
        </button>

        <div style={{ flex: 1 }} />

        <input
          type="search"
          className="deposito-search"
          placeholder="Buscar #id, remito, empleado, rol, fecha o total…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <label className="deposito-field" style={{ minWidth: 220 }}>
          <span>Ordenar</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="deposito-select"
          >
            <option value="fecha_desc">Fecha (nuevos primero)</option>
            <option value="fecha_asc">Fecha (viejos primero)</option>
            <option value="total_desc">Total (mayor a menor)</option>
            <option value="total_asc">Total (menor a mayor)</option>
            <option value="id_desc">ID (desc)</option>
            <option value="id_asc">ID (asc)</option>
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
              <th scope="col" className="deposito-th--numeric">
                Total
              </th>
              <th scope="col" style={{ width: 320 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="deposito-empty">
                  Sin resultados
                </td>
              </tr>
            )}
            {filtered.map((o) => (
              <tr key={o.id} className="deposito-row">
                <td>{o.displayId || String(o.id ?? "").padStart(7, "0")}</td>
                <td>{remitoNum(o)}</td>
                {/* CAMBIO: Mostrar el nombre del empleado si está disponible */}
                <td>
                  <strong>{o.empleadoNombre || o.empleadoId}</strong>
                </td>
                <td>{o.rol}</td>
                <td>{formatFechaAr(o.fecha)}</td>
                <td className="deposito-td--numeric">
                  {o.total == null ? "—" : money(o.total)}
                </td>
                <td style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    className="pill"
                    onClick={() => onPreviewRemito(o)}
                  >
                    Ver remito
                  </button>
                  {tab === "open" && (
                    <button
                      type="button"
                      className="pill"
                      onClick={() => moveToPreparing(o.id)}
                      style={{ marginLeft: 6 }}
                    >
                      Pasar a preparación
                    </button>
                  )}

                  {tab === "preparing" && (
                    <button
                      type="button"
                      className="pill"
                      onClick={() => closeOrder(o.id)}
                      style={{ marginLeft: 6 }}
                    >
                      Cerrar pedido
                    </button>
                  )}

                  {tab === "closed" && (
                    <button
                      type="button"
                      className="pill"
                      onClick={() => reopenOrder(o.id)}
                      style={{ marginLeft: 6 }}
                    >
                      Reabrir
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(selected || previewErr) && (
        <div style={{ marginTop: 16 }}>
          <div className="section-header">
            {selected ? (
              <div className="muted">
                Remito del pedido{" "}
                <strong>#{String(selected.id).padStart(7, "0")}</strong> —{" "}
                Empleado{" "}
                {/* CAMBIO: Mostrar nombre en el detalle */}
                <strong>
                  {selected.empleadoNombre || selected.empleadoId}
                </strong>{" "}
                — Rol <strong>{selected.rol}</strong>
              </div>
            ) : (
              <div className="muted">Detalle de remito</div>
            )}

            <div className="actions-row">
              {pdfUrl && (
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="pill pill--ghost"
                >
                  Abrir en otra pestaña
                </a>
              )}
              <button className="pill pill--ghost" onClick={closePreview}>
                Cerrar detalle
              </button>
            </div>
          </div>

          {previewErr && (
            <div className="state error deposito-state">{previewErr}</div>
          )}

          {pdfUrl && !previewErr && (
            <div
              style={{
                borderRadius: 8,
                overflow: "hidden",
                border: "1px solid #d1d5db",
                height: 540,
                background: "#0f172a",
              }}
            >
              <iframe
                title={
                  selected ? `Remito del pedido #${selected.id}` : "Remito"
                }
                src={pdfUrl}
                style={{ width: "100%", height: "100%", border: "none" }}
              />
            </div>
          )}

          {!pdfUrl && !previewErr && previewLoading && (
            <div className="state deposito-state">Cargando remito…</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ========= TU COMPONENTE ORIGINAL (sin cambios de lógica) ========= */
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

  const threshold = useMemo(()=>{
    const parsed = parseInt(thresholdInput, 10);
    return Number.isNaN(parsed) ? 0 : Math.max(0,parsed);
  }, [thresholdInput]);

  const riskPercent = useMemo(()=>{
    const parsed = parseInt(riskPercentInput, 10);
    if(Number.isNaN(parsed)) return 0;
    return Math.min(100, Math.max(1, parsed));
  }, [riskPercentInput]);

  const fechaInvalida = useMemo(
    () => !!start && !!end && start > end,
    [start, end]
  );

  useEffect(() => {
    if (fechaInvalida) return;

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

  return (
    <section className="admin-panel deposito-page">
      <h1 className="deposito-title">Encargado de Depósito</h1>

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
            value = {thresholdInput}
            onChange={(e)=>{
              const { value } = e.target;
              if(value === "" || /^\d*$/.test(value)){
                setThresholdInput(value);
              }
            }}  
          />
        </label>

        <label className="deposito-field">
          <span>Riesgo (%)</span>
          <input
            type="number"
            min="1"
            max="100"
            value={riskPercentInput}
            onChange={(e) => {
            const { value } = e.target;
              if (value === "" || /^\d*$/.test(value)) {
                setRiskPercentInput(value);
              }
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

      {!loading && !error && !fechaInvalida && (
        <div className="deposito-summary">
          <div className="deposito-summary-card deposito-summary-card--main">
            <div className="deposito-summary-label">
              Consumo total (unidades)
            </div>
            <div className="deposito-summary-value">
              {new Intl.NumberFormat("es-AR").format(resumen.totalConsumido)}
            </div>
            <div className="deposito-summary-sub">
              {start} → {end}
            </div>
          </div>

          <div className="deposito-summary-card">
            <div className="deposito-summary-label">
              Productos con consumo
            </div>
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

              {resumen.riesgoLimite > 0 && (
                <>
                  <span className="legend-dot legend-warning"></span>
                  <span>
                    En riesgo (1..{resumen.riesgoLimite}):{" "}
                    <b>{resumen.productosEnRiesgo}</b>
                  </span>
                </>
              )}

              <span className="legend-dot legend-neutral"></span>
              <span>
                Bajo (resto): <b>{resumen.bajoResto}</b>
              </span>
            </div>

            {resumen.riesgoLimite === 0 && (
              <div className="deposito-summary-sub">
                Franja de riesgo desactivada (umbral = 0).
              </div>
            )}
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
                        {new Intl.NumberFormat("es-AR").format(r.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

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
                      Ingreso futuro{sortIndicator(sortLow, "incoming")}
                    </th>
                    <th
                      onClick={() => handleSortLow("coverage")}
                      className="deposito-th--sortable deposito-th--numeric"
                      scope="col"
                    >
                      Cobertura (días){sortIndicator(sortLow, "coverage")}
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
                        ? Math.max(0, Math.min(stockActual / threshold, 1))
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
                          {new Intl.NumberFormat("es-AR").format(stockActual)}
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
                            : new Intl.NumberFormat("es-AR").format(
                                d.consumido
                              )}
                          <div className="deposito-subtext">
                            desde{" "}
                            {d.last_ingreso
                              ? String(d.last_ingreso).slice(0, 10)
                              : start}
                          </div>
                        </td>
                        <td className="deposito-td--numeric">
                          {d.incoming_total
                            ? new Intl.NumberFormat("es-AR").format(
                                d.incoming_total
                              )
                            : "-"}
                          {d.next_eta && (
                            <div className="deposito-subtext">
                              ETA {String(d.next_eta).slice(0, 10)}
                            </div>
                          )}
                        </td>
                        <td className="deposito-td--numeric">
                          {coverage == null ? "-" : `${coverage.toFixed(1)} d`}
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

      <div style={{ marginTop: 24 }}>
        <h2 className="deposito-subtitle">Pedidos</h2>
        <DepositoOrdersPanel />
      </div>
    </section>
  );
}