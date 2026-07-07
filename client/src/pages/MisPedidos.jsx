// client/src/pages/MisPedidos.jsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import ReturnModal from "../components/ReturnModal";

const API_BASE_URL = (import.meta?.env && import.meta.env.VITE_API_URL) || "http://localhost:4000";

function parseDbDate(raw) {
  if (!raw) return NaN;
  try { return new Date(String(raw).replace(" ", "T") + "-03:00").getTime(); }
  catch { return NaN; }
}

function formatFecha(raw) {
  const t = parseDbDate(raw);
  if (Number.isNaN(t)) return raw || "";
  return new Date(t).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function diasDesde(raw) {
  const t = parseDbDate(raw);
  if (Number.isNaN(t)) return 0;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

function money(v) {
  try {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 }).format(Number(v || 0));
  } catch { return `$ ${Number(v || 0).toFixed(2)}`; }
}

const ESTADO_CONFIG = {
  open:       { label: "Pendiente",      color: "#d97706", bg: "#fffbeb", border: "#fde68a", icon: "⏳" },
  preparing:  { label: "En preparación", color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe", icon: "🔧" },
  closed:     { label: "Listo para retirar", color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0", icon: "✅" },
  retirado:   { label: "Retirado",       color: "#6b7280", bg: "#f9fafb", border: "#e5e7eb", icon: "📦" },
};

function EstadoBadge({ status }) {
  const cfg = ESTADO_CONFIG[status] || { label: status, color: "#6b7280", bg: "#f9fafb", border: "#e5e7eb", icon: "❓" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 999,
      background: cfg.bg, color: cfg.color,
      border: `1px solid ${cfg.border}`,
      fontWeight: 700, fontSize: "0.78rem",
    }}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

function AlertaBadge({ dias, status }) {
  if (status === "retirado" || status === "closed") return null;
  if (dias < 2) return null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 999,
      background: "#fef2f2", color: "#dc2626",
      border: "1px solid #fecaca",
      fontWeight: 700, fontSize: "0.72rem", marginLeft: 6,
    }}>
      ⚠️ {Math.floor(dias)}d sin movimiento
    </span>
  );
}

export default function MisPedidos() {
  useParams();
  useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [expanded, setExpanded] = useState(new Set());
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfOrder, setPdfOrder] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfErr, setPdfErr] = useState("");
  const [tabFilter, setTabFilter] = useState("activos");
  const [returnOrder, setReturnOrder] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const { data } = await api.get("/orders/mis-pedidos");
      setOrders(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudieron cargar los pedidos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (tabFilter === "activos")
      return orders.filter(o => o.status !== "retirado");
    return orders.filter(o => o.status === "retirado");
  }, [orders, tabFilter]);

  const alertCount = useMemo(() =>
    orders.filter(o => o.status !== "retirado" && o.status !== "closed" && diasDesde(o.fecha) >= 2).length,
  [orders]);

  const toggleExpand = (id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const fetchPdf = async (id) => {
    setPdfLoading(true);
    setPdfErr("");
    if (pdfUrl) { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }
    try {
      for (const path of [`/orders/pdf/${id}`, `/api/admin/orders/pdf/${id}`]) {
        try {
          const res = await api.get(path, { responseType: "blob", headers: { Accept: "application/pdf" } });
          const ct = (res.headers?.["content-type"] || "").toLowerCase();
          if (ct.includes("application/pdf")) { setPdfUrl(URL.createObjectURL(res.data)); return; }
        } catch { /* empty */ }
      }
      const r = await fetch(`${API_BASE_URL.replace(/\/$/, "")}/orders/pdf/${id}`, { headers: { Accept: "application/pdf" }, credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setPdfUrl(URL.createObjectURL(await r.blob()));
    } catch (e) {
      setPdfErr(e?.message || "No se pudo cargar el remito");
    } finally {
      setPdfLoading(false);
    }
  };

  const onVerRemito = (o) => {
    setPdfOrder(o);
    fetchPdf(o.id);
  };

  const closePdf = () => {
    setPdfOrder(null);
    setPdfErr("");
    if (pdfUrl) { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }
  };

  const pad7 = (n) => String(n ?? "").padStart(7, "0");

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "1.25rem 1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 700, color: "#0f172a" }}>
          Mis pedidos
        </h2>
        {alertCount > 0 && (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "4px 12px", borderRadius: 999,
            background: "#fef2f2", color: "#dc2626",
            border: "1px solid #fecaca", fontWeight: 700, fontSize: "0.85rem",
          }}>
            ⚠️ {alertCount} pedido{alertCount !== 1 ? "s" : ""} demorado{alertCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Tabs */}
      {orders.some(o => o.status === "closed") && (
        <div style={{
          background: "#f0fdf4", border: "1.5px solid #86efac",
          borderRadius: 10, padding: "12px 16px", marginBottom: 16,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ fontSize: "1.4rem" }}>✅</span>
          <div>
            <div style={{ fontWeight: 700, color: "#15803d", fontSize: "0.95rem" }}>
              ¡Tenés {orders.filter(o => o.status === "closed").length} pedido{orders.filter(o => o.status === "closed").length !== 1 ? "s" : ""} listo{orders.filter(o => o.status === "closed").length !== 1 ? "s" : ""} para retirar!
            </div>
            <div style={{ color: "#16a34a", fontSize: "0.82rem" }}>
              Acercate al depósito para retirarlo.
            </div>
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[
          { key: "activos", label: "Activos" },
          { key: "retirados", label: "Retirados" },
        ].map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTabFilter(t.key)}
            style={{
              padding: "6px 18px", borderRadius: 999, border: 0, cursor: "pointer",
              fontWeight: 600, fontSize: "0.88rem",
              background: tabFilter === t.key ? "#1d4ed8" : "#e0edff",
              color: tabFilter === t.key ? "#fff" : "#1e3a8a",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div style={{ color: "#6b7280", padding: 16 }}>Cargando pedidos…</div>}
      {err && <div style={{ color: "#dc2626", padding: 12, background: "#fef2f2", borderRadius: 8 }}>{err}</div>}

      {!loading && !err && filtered.length === 0 && (
        <div style={{ color: "#6b7280", padding: 16, textAlign: "center" }}>
          No tenés pedidos {tabFilter === "activos" ? "activos" : "retirados"}.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.map(o => {
          const dias = diasDesde(o.fecha);
          const isExpanded = expanded.has(o.id);
          const demorado = o.status !== "retirado" && o.status !== "closed" && dias >= 2;

          return (
            <div key={o.id} style={{
              background: "#fff", borderRadius: 12,
              border: demorado ? "1.5px solid #fca5a5" : "1px solid #e5e7eb",
              boxShadow: demorado ? "0 0 0 3px #fee2e2" : "0 1px 4px rgba(0,0,0,0.06)",
              overflow: "hidden",
            }}>
              {/* Header del pedido */}
              <div
                style={{ padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}
                onClick={() => toggleExpand(o.id)}
              >
                <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "#0f172a", minWidth: 80 }}>
                  #{pad7(o.id)}
                </span>

                <EstadoBadge status={o.status} />
                <AlertaBadge dias={dias} status={o.status} />

                <span style={{ color: "#6b7280", fontSize: "0.82rem", marginLeft: "auto" }}>
                  {formatFecha(o.fecha)}
                </span>

                <span style={{ fontWeight: 700, color: "#0f172a", fontSize: "0.9rem" }}>
                  {money(o.total)}
                </span>

                <span style={{ color: "#6b7280", fontSize: "0.85rem" }}>
                  {isExpanded ? "▲" : "▼"}
                </span>
              </div>

              {/* Servicio */}
              {o.servicioNombre && (
                <div style={{ padding: "0 16px 8px", fontSize: "0.82rem", color: "#4b5563" }}>
                  🏥 {o.servicioNombre}
                </div>
              )}

              {/* Detalle expandido */}
              {isExpanded && (
                <div style={{ borderTop: "1px solid #f1f5f9", padding: "12px 16px" }}>

                  {/* Línea de tiempo del estado */}
                  <div style={{ display: "flex", gap: 0, marginBottom: 16, alignItems: "center" }}>
                    {[
                      { key: "open", label: "Pendiente", icon: "⏳" },
                      { key: "preparing", label: "En preparación", icon: "🔧" },
                      { key: "closed", label: "Listo", icon: "✅" },
                      { key: "retirado", label: "Retirado", icon: "📦" },
                    ].map((step, i, arr) => {
                      const order = ["open", "preparing", "closed", "retirado"];
                      const currentIdx = order.indexOf(o.status);
                      const stepIdx = order.indexOf(step.key);
                      const done = stepIdx <= currentIdx;
                      const current = stepIdx === currentIdx;
                      return (
                        <div key={step.key} style={{ display: "flex", alignItems: "center", flex: i < arr.length - 1 ? 1 : 0 }}>
                          <div style={{
                            display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                          }}>
                            <div style={{
                              width: 32, height: 32, borderRadius: "50%",
                              background: done ? (current ? "#1d4ed8" : "#22c55e") : "#e5e7eb",
                              color: done ? "#fff" : "#9ca3af",
                              display: "grid", placeItems: "center",
                              fontSize: "0.9rem", fontWeight: 700,
                              border: current ? "2px solid #1e40af" : "none",
                            }}>
                              {done ? (current ? step.icon : "✓") : step.icon}
                            </div>
                            <span style={{ fontSize: "0.65rem", color: done ? "#374151" : "#9ca3af", fontWeight: current ? 700 : 400, whiteSpace: "nowrap" }}>
                              {step.label}
                            </span>
                          </div>
                          {i < arr.length - 1 && (
                            <div style={{ flex: 1, height: 2, background: stepIdx < currentIdx ? "#22c55e" : "#e5e7eb", margin: "0 4px", marginBottom: 18 }} />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Items del pedido */}
                  {o.items?.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontWeight: 600, fontSize: "0.82rem", color: "#374151", marginBottom: 6 }}>
                        Ítems ({o.items.length})
                      </div>
                      <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
                        {o.items.map((it, i) => (
                          <div key={i} style={{
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                            padding: "6px 12px", fontSize: "0.82rem",
                            background: i % 2 === 0 ? "#fff" : "#f9fafb",
                            borderBottom: i < o.items.length - 1 ? "1px solid #f1f5f9" : "none",
                          }}>
                            <span style={{ color: "#111827" }}>{it.name || it.nombre}</span>
                            <span style={{ color: "#6b7280" }}>x{it.qty || it.cantidad}</span>
                            <span style={{ fontWeight: 600 }}>{money(it.subtotal)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Nota */}
                  {o.nota && o.nota !== "—" && (
                    <div style={{ fontSize: "0.82rem", color: "#4b5563", marginBottom: 10 }}>
                      <strong>Nota:</strong> {o.nota}
                    </div>
                  )}

                  {/* Botones */}
                  <button
                    type="button"
                    onClick={() => onVerRemito(o)}
                    disabled={pdfLoading && pdfOrder?.id === o.id}
                    style={{
                      padding: "6px 16px", borderRadius: 999, border: 0, cursor: "pointer",
                      background: "#1d4ed8", color: "#fff", fontWeight: 600, fontSize: "0.85rem",
                    }}
                  >
                    {pdfLoading && pdfOrder?.id === o.id ? "Cargando…" : "Ver remito"}
                  </button>
                  {(o.status === "closed" || o.status === "retirado") && (
                    <button type="button" onClick={() => setReturnOrder(o)}
                      style={{ padding: "6px 16px", borderRadius: 999, border: "1px solid #1d4ed8", cursor: "pointer", background: "#fff", color: "#1d4ed8", fontWeight: 600, fontSize: "0.85rem", marginLeft: 8 }}>
                      Devolver
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modal PDF */}
      {pdfOrder && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000, padding: 16,
        }}>
          <div style={{ background: "#fff", borderRadius: 12, width: "100%", maxWidth: 780, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #e5e7eb" }}>
              <span style={{ fontWeight: 700 }}>Remito #{pad7(pdfOrder.id)}</span>
              <div style={{ display: "flex", gap: 8 }}>
                {pdfUrl && <a href={pdfUrl} target="_blank" rel="noreferrer" style={{ padding: "4px 12px", borderRadius: 999, background: "#e0edff", color: "#1e3a8a", fontWeight: 600, fontSize: "0.82rem", textDecoration: "none" }}>Abrir</a>}
                <button type="button" onClick={closePdf} style={{ padding: "4px 12px", borderRadius: 999, border: 0, cursor: "pointer", background: "#fee2e2", color: "#dc2626", fontWeight: 600, fontSize: "0.82rem" }}>Cerrar</button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: "hidden", padding: 8 }}>
              {pdfErr && <div style={{ color: "#dc2626", padding: 12 }}>{pdfErr}</div>}
              {pdfLoading && <div style={{ color: "#6b7280", padding: 12 }}>Cargando remito…</div>}
              {pdfUrl && !pdfErr && (
                <iframe src={pdfUrl} style={{ width: "100%", height: 500, border: "none", borderRadius: 8 }} title="Remito" />
              )}
            </div>
          </div>
        </div>
      )}

      {returnOrder && <ReturnModal order={returnOrder} onClose={() => setReturnOrder(null)} />}
    </div>
  );
}