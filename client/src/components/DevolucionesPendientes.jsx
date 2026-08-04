// client/src/components/DevolucionesPendientes.jsx
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

// La base guarda UTC. Un string plano "YYYY-MM-DD HH:MM:SS" se lee como UTC.
function parseDbMs(raw) {
  if (!raw) return NaN;
  const s = String(raw).trim();
  const conZona = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(s);
  return new Date(s.replace(" ", "T") + (conZona ? "" : "Z")).getTime();
}
function tiempoRelativo(raw) {
  const t = parseDbMs(raw);
  if (Number.isNaN(t)) return raw || "";
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ayer";
  if (d < 7) return `hace ${d} días`;
  return new Date(t).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Cordoba", day: "2-digit", month: "2-digit", year: "numeric" });
}

// Color de la etiqueta de motivo según el tipo.
function motivoStyle(m) {
  const s = String(m || "").toLowerCase();
  if (/dañ|roto|rota/.test(s))  return { bg: "#fef2f2", fg: "#b91c1c", icon: "⚠" };
  if (/venc/.test(s))           return { bg: "#fff7ed", fg: "#9a3412", icon: "⏳" };
  if (/sobr/.test(s))           return { bg: "#fffbeb", fg: "#92400e", icon: "↩" };
  if (/error|equivoc/.test(s))  return { bg: "#eff6ff", fg: "#1e40af", icon: "✎" };
  return { bg: "#f1f5f9", fg: "#475569", icon: "•" };
}

export default function DevolucionesPendientes() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(null);
  const [confirmReject, setConfirmReject] = useState(null);

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
    setBusy(id); setMsg(""); setErr(""); setConfirmReject(null);
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
      {/* Encabezado con contador y refrescar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong style={{ fontSize: 16, color: "#0f172a" }}>Devoluciones pendientes</strong>
          {!loading && (
            <span style={{ background: rows.length ? "#fef3c7" : "#dcfce7", color: rows.length ? "#92400e" : "#166534", fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 999 }}>
              {rows.length}
            </span>
          )}
        </div>
        <button type="button" onClick={load} disabled={loading}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          ↻ Actualizar
        </button>
      </div>

      {msg && <div style={{ background: "#ecfdf5", color: "#166534", border: "1px solid #bbf7d0", borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>{msg}</div>}
      {err && <div style={{ background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>{err}</div>}

      {loading ? (
        <div style={{ color: "#4b5563", padding: 12 }}>Cargando…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "#166534", padding: 20, textAlign: "center", background: "#f0fdf4", borderRadius: 12, border: "1px solid #bbf7d0" }}>
          ✓ No hay devoluciones pendientes.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => {
            const ms = motivoStyle(r.motivo);
            const estaConfirmando = confirmReject === r.id;
            return (
              <div key={r.id} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.05)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    {/* Producto + cantidad */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>
                        {r.producto_nombre || `Producto #${r.producto_id}`}
                      </span>
                      <span style={{ background: "#e0edff", color: "#1d4ed8", fontSize: 12, fontWeight: 700, padding: "1px 9px", borderRadius: 999 }}>×{r.cantidad}</span>
                    </div>
                    {/* Metadatos */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13, color: "#4b5563", marginBottom: 8 }}>
                      {r.producto_codigo && (
                        <span style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 12, background: "#f3f4f6", color: "#374151", padding: "1px 6px", borderRadius: 4 }}>{r.producto_codigo}</span>
                      )}
                      <span>Pedido #{String(r.pedido_id).padStart(7, "0")}</span>
                      {r.solicitante_nombre && (<><span style={{ color: "#cbd5e1" }}>·</span><span>👤 {r.solicitante_nombre}</span></>)}
                      <span style={{ color: "#cbd5e1" }}>·</span>
                      <span>🕐 {tiempoRelativo(r.fecha_solicitud)}</span>
                    </div>
                    {/* Motivo */}
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: ms.bg, color: ms.fg, fontSize: 12, fontWeight: 600, padding: "3px 11px", borderRadius: 999 }}>
                      <span aria-hidden="true">{ms.icon}</span> {r.motivo || "Sin motivo"}
                    </span>
                  </div>

                  {/* Acciones */}
                  {estaConfirmando ? (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                      <span style={{ fontSize: 13, color: "#b91c1c", fontWeight: 600 }}>¿Rechazar?</span>
                      <button type="button" onClick={() => resolver(r.id, "reject")} disabled={busy === r.id}
                        style={{ padding: "8px 14px", borderRadius: 8, border: 0, background: "#dc2626", color: "#fff", fontWeight: 600, cursor: "pointer" }}>
                        {busy === r.id ? "…" : "Sí, rechazar"}
                      </button>
                      <button type="button" onClick={() => setConfirmReject(null)}
                        style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontWeight: 600, cursor: "pointer" }}>
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                      <button type="button" onClick={() => resolver(r.id, "approve")} disabled={busy === r.id}
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 16px", borderRadius: 8, border: 0, background: "#16a34a", color: "#fff", fontWeight: 600, cursor: "pointer" }}>
                        {busy === r.id ? "…" : "✓ Aprobar"}
                      </button>
                      <button type="button" onClick={() => setConfirmReject(r.id)} disabled={busy === r.id}
                        style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #dc2626", background: "#fff", color: "#dc2626", fontWeight: 600, cursor: "pointer" }}>
                        Rechazar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
