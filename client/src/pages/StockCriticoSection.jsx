// client/src/pages/StockCriticoSection.jsx
//
// Stock crítico medido en MESES DE COBERTURA, no en unidades.
//
// Antes ordenaba por stock a secas y por eso no avisaba de los quiebres
// reales: 3.700 bolsas negras están por encima de cualquier umbral razonable,
// pero se consumen 32.487 por mes. Duran tres días.
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { formatNumber } from "../utils/format";

/** Cuánto falta para quedarse sin: rojo ya, naranja esta semana, amarillo pronto. */
function colorDe(meses) {
  if (meses <= 0.25) return "#dc2626";
  if (meses <= 1) return "#d97706";
  return "#ca8a04";
}

function textoMeses(meses) {
  if (meses <= 0) return "Sin stock";
  if (meses < 1) return `${Math.round(meses * 30)} días`;
  return `${meses.toFixed(1)} meses`;
}

export default function StockCriticoSection() {
  const [meses, setMeses] = useState(2);
  const [items, setItems] = useState([]);
  const [resumen, setResumen] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const { data } = await api.get("/deposito/stock-critico", { params: { meses } });
      setItems(Array.isArray(data?.items) ? data.items : []);
      setResumen(data?.resumen ?? null);
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudo cargar el stock crítico");
      setItems([]);
      setResumen(null);
    } finally {
      setLoading(false);
    }
  }, [meses]);

  useEffect(() => { load(); }, [load]);

  return (
    <section className="srv-card" aria-labelledby="stockcrit-heading">
      <div className="section-header">
        <h3 id="stockcrit-heading">Stock crítico</h3>
        <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "#6b7280" }}>
          Para cuánto alcanza cada insumo, según lo que realmente se consumió en los últimos
          90 días. Ordenado por lo que primero se va a quebrar.
        </p>
      </div>

      <div className="toolbar" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.9rem" }}>
          Mostrar lo que no llega a
          <select
            className="input"
            value={meses}
            onChange={(e) => setMeses(Number(e.target.value))}
            style={{ width: 120 }}
          >
            <option value={0.5}>15 días</option>
            <option value={1}>1 mes</option>
            <option value={2}>2 meses</option>
            <option value={3}>3 meses</option>
            <option value={6}>6 meses</option>
          </select>
        </label>
        <button className="btn" onClick={load} disabled={loading}>
          {loading ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.6rem", margin: "12px 0" }}>
        <div style={{ padding: "0.6rem 0.75rem", borderRadius: "0.6rem", border: "1px solid #e5e7eb", background: "#fff" }}>
          <div style={{ fontWeight: 800, fontSize: "1.4rem", color: "#dc2626" }}>{resumen?.sinStock ?? 0}</div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>Sin stock</div>
        </div>
        <div style={{ padding: "0.6rem 0.75rem", borderRadius: "0.6rem", border: "1px solid #e5e7eb", background: "#fff" }}>
          <div style={{ fontWeight: 800, fontSize: "1.4rem", color: "#d97706" }}>{items.length}</div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>A reponer</div>
        </div>
        <div style={{ padding: "0.6rem 0.75rem", borderRadius: "0.6rem", border: "1px solid #e5e7eb", background: "#fff" }}>
          <div style={{ fontWeight: 800, fontSize: "1.4rem", color: "#6b7280" }}>{resumen?.sinConsumo ?? 0}</div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>Sin consumo en 90 días</div>
        </div>
      </div>

      {(resumen?.dudosos ?? 0) > 0 && (
        <div className="state" style={{ background: "#fef3c7", color: "#92400e" }}>
          {resumen.dudosos} de estos tienen un stock cargado que no parece real (10.000 o más).
          Están marcados: tomalos con pinzas hasta cargar el stock de verdad.
        </div>
      )}

      {err && <div className="state error" role="alert">{err}</div>}

      {loading ? (
        <div className="state">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="state" style={{ color: "#16a34a" }}>
          ✓ Nada se quiebra dentro de ese plazo.
        </div>
      ) : (
        <div className="table like">
          <div className="t-head">
            <div style={{ flex: 4 }}>Insumo</div>
            <div style={{ flex: 2 }}>Código</div>
            <div style={{ flex: 2, textAlign: "right" }}>Consumo/mes</div>
            <div style={{ flex: 2, textAlign: "right" }}>Stock</div>
            <div style={{ flex: 2, textAlign: "right" }}>Alcanza para</div>
          </div>
          {items.map((r) => (
            <div key={r.productId} className="t-row">
              <div style={{ flex: 4, minWidth: 0 }}>
                <div style={{ wordBreak: "break-word", lineHeight: 1.4 }}>
                  {r.name}
                  {r.dudoso && (
                    <span style={{ marginLeft: 6, fontSize: ".7rem", color: "#92400e", background: "#fef3c7", padding: "1px 6px", borderRadius: 6 }}>
                      stock dudoso
                    </span>
                  )}
                </div>
              </div>
              <div style={{ flex: 2 }}>{r.code || "—"}</div>
              <div style={{ flex: 2, textAlign: "right" }}>{formatNumber(r.porMes)}</div>
              <div style={{ flex: 2, textAlign: "right" }}>{formatNumber(r.stock)}</div>
              <div style={{ flex: 2, textAlign: "right", fontWeight: 700, color: colorDe(r.meses) }}>
                {textoMeses(r.meses)}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
