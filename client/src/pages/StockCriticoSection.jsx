// client/src/pages/StockCriticoSection.jsx
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

export default function StockCriticoSection() {
  const [threshold, setThreshold] = useState(5);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const { data } = await api.get("/deposito/overview", { params: { threshold } });
      const low = Array.isArray(data?.low) ? data.low : [];
      // ordenar de menor a mayor stock
      low.sort((a, b) => Number(a.stock ?? 0) - Number(b.stock ?? 0));
      setRows(low);
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudo cargar el stock crítico");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [threshold]);

  useEffect(() => {
    load();
  }, [load]);

  const sinStock = rows.filter((r) => Number(r.stock ?? 0) <= 0).length;
  const bajos = rows.length - sinStock;

  return (
    <section className="srv-card" aria-labelledby="stockcrit-heading">
      <div className="section-header">
        <h3 id="stockcrit-heading">Stock crítico</h3>
        <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "#6b7280" }}>
          Productos con stock igual o por debajo del umbral. Revisalos para reponer a tiempo.
        </p>
      </div>

      <div className="toolbar" style={{ gap: 10, alignItems: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.9rem" }}>
          Umbral (≤)
          <input
            className="input"
            type="number"
            min="0"
            value={threshold}
            onChange={(e) => setThreshold(Math.max(0, parseInt(e.target.value, 10) || 0))}
            style={{ width: 90 }}
          />
        </label>
        <button className="btn" onClick={load} disabled={loading}>
          {loading ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.6rem", margin: "12px 0" }}>
        <div style={{ padding: "0.6rem 0.75rem", borderRadius: "0.6rem", border: "1px solid #e5e7eb", background: "#fff" }}>
          <div style={{ fontWeight: 800, fontSize: "1.4rem", color: "#dc2626" }}>{sinStock}</div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>Sin stock (0)</div>
        </div>
        <div style={{ padding: "0.6rem 0.75rem", borderRadius: "0.6rem", border: "1px solid #e5e7eb", background: "#fff" }}>
          <div style={{ fontWeight: 800, fontSize: "1.4rem", color: "#d97706" }}>{bajos}</div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>Stock bajo</div>
        </div>
        <div style={{ padding: "0.6rem 0.75rem", borderRadius: "0.6rem", border: "1px solid #e5e7eb", background: "#fff" }}>
          <div style={{ fontWeight: 800, fontSize: "1.4rem", color: "#1d4ed8" }}>{rows.length}</div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>Total a revisar</div>
        </div>
      </div>

      {err && <div className="state error" role="alert">{err}</div>}

      {loading ? (
        <div className="state">Cargando…</div>
      ) : rows.length === 0 ? (
        <div className="state" style={{ color: "#16a34a" }}>
          ✓ No hay productos en o por debajo del umbral. Todo en orden.
        </div>
      ) : (
        <div className="table like">
          <div className="t-head">
            <div style={{ flex: 4 }}>Producto</div>
            <div style={{ flex: 2 }}>Código</div>
            <div style={{ flex: 2, textAlign: "center" }}>Stock</div>
          </div>
          {rows.map((r) => {
            const stock = Number(r.stock ?? 0);
            const color = stock <= 0 ? "#dc2626" : "#d97706";
            return (
              <div key={r.productId} className="t-row">
                <div style={{ flex: 4, minWidth: 0 }}>
                  <div style={{ wordBreak: "break-word", lineHeight: 1.4 }}>{r.name}</div>
                </div>
                <div style={{ flex: 2 }}>{r.code || "—"}</div>
                <div style={{ flex: 2, textAlign: "center", fontWeight: 700, color }}>
                  {stock <= 0 ? "Sin stock" : stock}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}