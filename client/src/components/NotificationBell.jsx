// client/src/components/NotificationBell.jsx
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";

export default function NotificationBell() {
  const [rows, setRows] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const load = async () => {
    try {
      const { data } = await api.get("/orders/notifications");
      setRows(data?.rows || []);
      setUnread(data?.unread || 0);
    } catch { /* noop */ }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 60000); // cada 60s
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const markAll = async () => {
    try {
      await api.put("/orders/notifications/read-all");
      setRows((prev) => prev.map((r) => ({ ...r, leida: 1 })));
      setUnread(0);
    } catch { /* noop */ }
  };

  const markOne = async (id) => {
    try {
      await api.put(`/orders/notifications/${id}/read`);
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, leida: 1 } : r)));
      setUnread((u) => Math.max(0, u - 1));
    } catch { /* noop */ }
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notificaciones${unread ? `, ${unread} sin leer` : ""}`}
        className="pill"
        style={{ position: "relative", padding: "6px 10px" }}
      >
        🔔
        {unread > 0 && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute", top: -4, right: -4,
              background: "#dc2626", color: "#fff", borderRadius: 999,
              fontSize: 11, fontWeight: 700, minWidth: 18, height: 18,
              display: "grid", placeItems: "center", padding: "0 4px",
            }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notificaciones"
          style={{
            position: "absolute", right: 0, top: "calc(100% + 8px)",
            width: 320, maxWidth: "90vw", background: "#fff", color: "#0f172a",
            border: "1px solid #e5e7eb", borderRadius: 12,
            boxShadow: "0 10px 30px rgba(15,23,42,.15)", zIndex: 100, overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderBottom: "1px solid #f1f5f9" }}>
            <strong style={{ fontSize: 14 }}>Notificaciones</strong>
            {unread > 0 && (
              <button type="button" onClick={markAll} style={{ border: 0, background: "transparent", color: "#2563eb", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                Marcar todas
              </button>
            )}
          </div>
          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {rows.length === 0 ? (
              <div style={{ padding: 16, color: "#64748b", fontSize: 14, textAlign: "center" }}>Sin notificaciones</div>
            ) : (
              rows.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => markOne(n.id)}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "10px 12px", border: 0, borderBottom: "1px solid #f1f5f9",
                    background: n.leida ? "#fff" : "#eff6ff", cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: 13.5, fontWeight: n.leida ? 500 : 700, color: "#0f172a" }}>{n.titulo}</div>
                  {n.cuerpo && <div style={{ fontSize: 12.5, color: "#475569", marginTop: 2 }}>{n.cuerpo}</div>}
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>{n.created_at}</div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}