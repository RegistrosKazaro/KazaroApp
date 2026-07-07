// client/src/components/DevolucionesPendientes.jsx
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

export default function DevolucionesPendientes() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const { data } = await api.get("/orders/returns", { params: { estado: "pendiente" } });
      setRows(data?.rows || []);
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudieron cargar las devoluciones");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const resolver = async (id, accion) => {
    setBusy(id); setMsg(""); setErr("");
    try {
      const { data } = await api.put(`/orders/returns/${id}/${accion}`);
      setRows((prev) => prev.filter((r) => r.id !== id));
      setMsg(accion === "approve"
        ? `Devolución aprobada. Stock actualizado${data?.nuevoStock != null ? ` a ${data.nuevoStock}` : ""}.`
        : "Devolución rechazada.");
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudo procesar");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-label="Devoluciones pendientes" style={{ marginTop: 8 }}>
      {msg && <div style={{ background: "#ecfdf5", color: "#166534", border: "1px solid #bbf7d0", borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>{msg}</div>}
      {err && <div style={{ background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>{err}</div>}

      {loading ? (
        <div style={{ color: "#64748b", padding: 12 }}>Cargando…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "#16a34a", padding: 16, textAlign: "center", background: "#f0fdf4", borderRadius: 10, border: "1px solid #bbf7d0" }}>
          ✓ No hay devoluciones pendientes.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => (
            <div key={r.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 14, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.05)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: "#0f172a" }}>
                    {r.producto_nombre || `Producto #${r.producto_id}`} · <span style={{ color: "#1d4ed8" }}>x{r.cantidad}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#64748b", marginTop: 3 }}>
                    Pedido #{String(r.pedido_id).padStart(7, "0")} · Motivo: {r.motivo || "—"}
                  </div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                    Solicitada: {r.fecha_solicitud}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button" onClick={() => resolver(r.id, "approve")} disabled={busy === r.id}
                    style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "#16a34a", color: "#fff", fontWeight: 600, cursor: "pointer" }}
                  >
                    {busy === r.id ? "…" : "Aprobar"}
                  </button>
                  <button
                    type="button" onClick={() => resolver(r.id, "reject")} disabled={busy === r.id}
                    style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #dc2626", background: "#fff", color: "#dc2626", fontWeight: 600, cursor: "pointer" }}
                  >
                    Rechazar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}