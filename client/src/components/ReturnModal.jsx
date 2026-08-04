// client/src/components/ReturnModal.jsx
import { useEffect, useState } from "react";
import { api } from "../api/client";

const MOTIVOS = ["Sobrante", "Dañado", "Vencido", "Error de pedido", "Otro"];

export default function ReturnModal({ order, onClose, onDone }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState({}); // productId -> { cantidad, motivo, custom }
  const [saving, setSaving] = useState(false);
  const [okMsg, setOkMsg] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setErr("");
      try {
        const { data } = await api.get(`/orders/${order.id}/returnable`);
        if (alive) setItems(data?.items || []);
      } catch (e) {
        if (alive) setErr(e?.response?.data?.error || "No se pudo cargar el pedido");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [order.id]);

  const cur = (pid) => sel[pid] || {};
  const setField = (pid, field, value) =>
    setSel((s) => ({ ...s, [pid]: { ...s[pid], [field]: value } }));

  const setCantidad = (it, val) => {
    const n = Math.max(1, Math.min(it.disponible, Math.trunc(Number(val) || 1)));
    setField(it.productId, "cantidad", n);
  };
  const paso = (it, delta) => {
    const actual = Number(cur(it.productId).cantidad) || 1;
    setCantidad(it, actual + delta);
  };

  const motivoFinal = (pid) => {
    const c = cur(pid);
    return c.motivo === "Otro" ? String(c.custom || "").trim() : String(c.motivo || "").trim();
  };

  const enviar = async (it) => {
    const c = cur(it.productId);
    const cantidad = Math.trunc(Number(c.cantidad) || 0);
    const motivo = motivoFinal(it.productId);
    if (!Number.isFinite(cantidad) || cantidad <= 0) return setErr("Elegí una cantidad válida.");
    if (cantidad > it.disponible) return setErr(`Máximo devolvible: ${it.disponible}`);
    if (!motivo) return setErr("Elegí un motivo.");
    setSaving(true); setOkMsg(""); setErr("");
    try {
      await api.post("/orders/returns", { pedidoId: order.id, productoId: it.productId, cantidad, motivo });
      setOkMsg(`Devolución de "${it.name}" enviada. Queda pendiente de aprobación del depósito.`);
      const { data } = await api.get(`/orders/${order.id}/returnable`);
      setItems(data?.items || []);
      setSel((s) => ({ ...s, [it.productId]: {} }));
      onDone && onDone();
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudo enviar la devolución");
    } finally {
      setSaving(false);
    }
  };

  const stepBtn = { width: 32, height: 34, border: 0, background: "transparent", color: "#475569", fontSize: 18, cursor: "pointer", lineHeight: 1 };

  return (
    <div
      role="dialog" aria-modal="true" aria-label={`Devolver productos del pedido ${order.id}`}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", display: "grid", placeItems: "center", zIndex: 200, padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: 14, width: 580, maxWidth: "calc(100vw - 24px)", maxHeight: "85vh", overflowY: "auto", overflowX: "hidden", boxShadow: "0 20px 50px rgba(0,0,0,.3)", boxSizing: "border-box" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid #f1f5f9" }}>
          <strong style={{ fontSize: 16 }}>Devolver — Pedido #{String(order.id).padStart(7, "0")}</strong>
          <button type="button" onClick={onClose} aria-label="Cerrar" style={{ border: 0, background: "transparent", fontSize: 22, cursor: "pointer", color: "#64748b" }}>×</button>
        </div>

        <div style={{ padding: 18 }}>
          {loading ? (
            <div style={{ color: "#64748b" }}>Cargando…</div>
          ) : err && items.length === 0 ? (
            <div style={{ color: "#b91c1c" }}>{err}</div>
          ) : items.length === 0 ? (
            <div style={{ color: "#64748b" }}>Este pedido no tiene ítems para devolver.</div>
          ) : (
            <>
              {okMsg && <div style={{ background: "#ecfdf5", color: "#166534", border: "1px solid #bbf7d0", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 13 }}>{okMsg}</div>}
              {err && <div style={{ background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 13 }}>{err}</div>}
              <div style={{ fontSize: 13, color: "#64748b", marginBottom: 12 }}>
                Elegí cantidad y motivo. La devolución queda <strong>pendiente</strong> hasta que el depósito la apruebe.
              </div>

              {items.map((it) => {
                const c = cur(it.productId);
                const agotado = it.disponible <= 0;
                const pct = it.pedido > 0 ? Math.round((it.disponible / it.pedido) * 100) : 0;
                return (
                  <div key={it.productId} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, marginBottom: 10, background: agotado ? "#f8fafc" : "#fff" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontWeight: 700, color: "#0f172a" }}>{it.name}</span>
                      <span style={{ fontSize: 12, color: "#64748b", whiteSpace: "nowrap" }}>
                        Disponible <strong style={{ color: "#0f172a" }}>{it.disponible}</strong> de {it.pedido}
                      </span>
                    </div>
                    <div style={{ height: 6, background: "#eef2f7", borderRadius: 999, margin: "8px 0 12px", overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: agotado ? "#22c55e" : "#1d4ed8", borderRadius: 999 }} />
                    </div>

                    {agotado ? (
                      <div style={{ fontSize: 13, color: "#16a34a", fontWeight: 600 }}>✓ Todo devuelto</div>
                    ) : (
                      <>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
                          <div>
                            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Cantidad</div>
                            <div style={{ display: "inline-flex", alignItems: "center", border: "1px solid #d1d5db", borderRadius: 8, overflow: "hidden" }}>
                              <button type="button" aria-label="Restar" onClick={() => paso(it, -1)} style={stepBtn}>−</button>
                              <input
                                type="number" min="1" max={it.disponible}
                                value={c.cantidad || ""}
                                onChange={(e) => setCantidad(it, e.target.value)}
                                aria-label="Cantidad a devolver"
                                style={{ width: 46, textAlign: "center", padding: "7px 0", border: 0, borderLeft: "1px solid #e5e7eb", borderRight: "1px solid #e5e7eb", fontWeight: 600, MozAppearance: "textfield" }}
                              />
                              <button type="button" aria-label="Sumar" onClick={() => paso(it, +1)} style={stepBtn}>+</button>
                            </div>
                          </div>
                          <div style={{ flex: 1, minWidth: 200 }}>
                            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Motivo</div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {MOTIVOS.map((m) => {
                                const activo = c.motivo === m;
                                return (
                                  <button key={m} type="button" onClick={() => setField(it.productId, "motivo", m)}
                                    style={{
                                      fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 999, cursor: "pointer",
                                      border: activo ? "1px solid #1d4ed8" : "1px solid #d1d5db",
                                      background: activo ? "#e0edff" : "#fff",
                                      color: activo ? "#1d4ed8" : "#475569",
                                    }}>
                                    {m}
                                  </button>
                                );
                              })}
                            </div>
                            {c.motivo === "Otro" && (
                              <input
                                type="text" value={c.custom || ""}
                                onChange={(e) => setField(it.productId, "custom", e.target.value)}
                                placeholder="Escribí el motivo…" autoFocus
                                style={{ marginTop: 8, width: "100%", padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 8, boxSizing: "border-box" }}
                              />
                            )}
                          </div>
                        </div>

                        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
                          <button
                            type="button" onClick={() => enviar(it)} disabled={saving}
                            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 18px", borderRadius: 8, border: 0, background: "#1d4ed8", color: "#fff", fontWeight: 600, cursor: "pointer" }}
                          >
                            {saving ? "Enviando…" : "↩ Devolver"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
