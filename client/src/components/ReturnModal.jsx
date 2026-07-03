// client/src/components/ReturnModal.jsx
import { useEffect, useState } from "react";
import { api } from "../api/client";

export default function ReturnModal({ order, onClose, onDone }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState({}); // productId -> { cantidad, motivo }
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

  const setField = (pid, field, value) =>
    setSel((s) => ({ ...s, [pid]: { ...s[pid], [field]: value } }));

  const enviar = async (it) => {
    const cur = sel[it.productId] || {};
    const cantidad = Math.trunc(Number(cur.cantidad));
    const motivo = String(cur.motivo || "").trim();
    if (!Number.isFinite(cantidad) || cantidad <= 0) return alert("Cantidad inválida");
    if (cantidad > it.disponible) return alert(`Máximo devolvible: ${it.disponible}`);
    if (!motivo) return alert("El motivo es obligatorio");
    setSaving(true); setOkMsg(""); setErr("");
    try {
      await api.post("/orders/returns", { pedidoId: order.id, productoId: it.productId, cantidad, motivo });
      setOkMsg(`Devolución de "${it.name}" enviada. Queda pendiente de aprobación del depósito.`);
      // refrescar disponibles
      const { data } = await api.get(`/orders/${order.id}/returnable`);
      setItems(data?.items || []);
      setSel((s) => ({ ...s, [it.productId]: { cantidad: "", motivo: "" } }));
      onDone && onDone();
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudo enviar la devolución");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog" aria-modal="true" aria-label={`Devolver productos del pedido ${order.id}`}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", display: "grid", placeItems: "center", zIndex: 200, padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: 12, width: 560, maxWidth: "100%", maxHeight: "85vh", overflow: "auto", boxShadow: "0 20px 50px rgba(0,0,0,.3)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid #f1f5f9" }}>
          <strong style={{ fontSize: 16 }}>Devolver productos — Pedido #{String(order.id).padStart(7, "0")}</strong>
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
              <div style={{ fontSize: 13, color: "#64748b", marginBottom: 10 }}>
                Ingresá la cantidad y el motivo. La devolución queda <strong>pendiente</strong> hasta que el depósito la apruebe.
              </div>
              {items.map((it) => {
                const cur = sel[it.productId] || {};
                const agotado = it.disponible <= 0;
                return (
                  <div key={it.productId} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, marginBottom: 10, background: agotado ? "#f8fafc" : "#fff" }}>
                    <div style={{ fontWeight: 600, color: "#0f172a", marginBottom: 4 }}>{it.name}</div>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
                      Pedido: {it.pedido} · Ya devuelto: {it.devuelto} · Disponible: <strong>{it.disponible}</strong>
                    </div>
                    {agotado ? (
                      <div style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>✓ Todo devuelto</div>
                    ) : (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                        <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12 }}>
                          Cantidad
                          <input
                            type="number" min="1" max={it.disponible}
                            value={cur.cantidad || ""}
                            onChange={(e) => setField(it.productId, "cantidad", e.target.value)}
                            style={{ width: 90, padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6 }}
                          />
                        </label>
                        <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, flex: 1, minWidth: 160 }}>
                          Motivo
                          <input
                            type="text"
                            value={cur.motivo || ""}
                            onChange={(e) => setField(it.productId, "motivo", e.target.value)}
                            placeholder="Ej: sobrante, dañado, error"
                            style={{ padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6 }}
                          />
                        </label>
                        <button
                          type="button" onClick={() => enviar(it)} disabled={saving}
                          style={{ padding: "8px 14px", borderRadius: 8, border: 0, background: "#1d4ed8", color: "#fff", fontWeight: 600, cursor: "pointer" }}
                        >
                          {saving ? "Enviando…" : "Devolver"}
                        </button>
                      </div>
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