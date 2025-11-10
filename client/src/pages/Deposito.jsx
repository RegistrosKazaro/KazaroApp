// client/src/pages/Deposito.jsx
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}
function isoFirstOfMonth() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

export default function Deposito() {
  const [start, setStart] = useState(isoFirstOfMonth());
  const [end, setEnd] = useState(isoToday());
  const [threshold, setThreshold] = useState(10);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [top, setTop] = useState([]);
  const [low, setLow] = useState([]);
  const [consumos, setConsumos] = useState({}); // { [productId]: detalles }

  useEffect(() => {
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
            .get(
              `/deposito/consumo-desde-ultimo-ingreso/${row.productId}`,
              { params: { fallbackStart: start } },
            )
            .then((rsp) => ({
              productId: row.productId,
              ...rsp.data,
            }))
            .catch(() => ({ productId: row.productId, consumido: null })),
        );

        const details = await Promise.all(calls);
        if (!alive) return;
        const byId = Object.fromEntries(
          details.map((d) => [String(d.productId), d]),
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
  }, [start, end, threshold]);

  const nf = useMemo(() => new Intl.NumberFormat("es-AR"), []);

  return (
    <section className="admin-panel" style={{ padding: 16 }}>
      <h1>Encargado de Depósito</h1>

      {/* Filtros */}
      <div
        className="filters"
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "flex-end",
          marginBottom: 16,
        }}
      >
        <label>
          Desde
          <br />
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>

        <label>
          Hasta
          <br />
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>

        <label>
          Umbral stock bajo
          <br />
          <input
            type="number"
            min="0"
            value={threshold}
            onChange={(e) =>
              setThreshold(parseInt(e.target.value || "0", 10))
            }
          />
        </label>
      </div>

      {loading && <div className="state">Cargando…</div>}
      {error && <div className="state error">{error}</div>}

      {!loading && !error && (
        <div
          className="grid"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
          }}
        >
          {/* Más consumidos */}
          <div
            className="card"
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              padding: 12,
            }}
          >
            <div
              className="card-header"
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <h2 style={{ margin: 0 }}>Más consumidos</h2>
              <small>
                {start} → {end}
              </small>
            </div>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 14,
              }}
            >
              <thead>
                <tr>
                  <th style={{ textAlign: "left", paddingBottom: 4 }}>
                    Producto
                  </th>
                  <th style={{ textAlign: "left", paddingBottom: 4 }}>
                    Unidad
                  </th>
                  <th style={{ textAlign: "right", paddingBottom: 4 }}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {top.length === 0 && (
                  <tr>
                    <td
                      colSpan={3}
                      style={{
                        paddingTop: 6,
                        fontStyle: "italic",
                        color: "#6b7280",
                      }}
                    >
                      Sin consumos en el período
                    </td>
                  </tr>
                )}
                {top.map((r) => (
                  <tr key={r.productId}>
                    <td style={{ padding: "2px 0" }}>{r.name}</td>
                    <td style={{ padding: "2px 0" }}>{r.unit || "-"}</td>
                    <td style={{ padding: "2px 0", textAlign: "right" }}>
                      {nf.format(r.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Stock bajo */}
          <div
            className="card"
            style={{
              border: "1px solid #fee2e2",
              borderRadius: 10,
              padding: 12,
            }}
          >
            <div
              className="card-header"
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <h2 style={{ margin: 0 }}>Stock bajo</h2>
              <small>Umbral ≤ {threshold}</small>
            </div>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 14,
              }}
            >
              <thead>
                <tr>
                  <th style={{ textAlign: "left", paddingBottom: 4 }}>
                    Producto
                  </th>
                  <th style={{ textAlign: "right", paddingBottom: 4 }}>
                    Stock
                  </th>
                  <th style={{ textAlign: "right", paddingBottom: 4 }}>
                    Consumo desde último ingreso
                  </th>
                  <th style={{ textAlign: "right", paddingBottom: 4 }}>
                    Ingreso futuro
                  </th>
                </tr>
              </thead>
              <tbody>
                {low.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      style={{
                        paddingTop: 6,
                        fontStyle: "italic",
                        color: "#6b7280",
                      }}
                    >
                      No hay alertas de stock bajo
                    </td>
                  </tr>
                )}
                {low.map((r) => {
                  const d = consumos[String(r.productId)] || {};
                  return (
                    <tr key={r.productId}>
                      <td style={{ padding: "2px 0" }}>{r.name}</td>
                      <td style={{ padding: "2px 0", textAlign: "right" }}>
                        {nf.format(r.stock)}
                      </td>
                      <td style={{ padding: "2px 0", textAlign: "right" }}>
                        {d.consumido == null ? "-" : nf.format(d.consumido)}
                        <br />
                        <small style={{ color: "#6b7280" }}>
                          desde{" "}
                          {d.last_ingreso
                            ? new Date(d.last_ingreso)
                                .toISOString()
                                .slice(0, 10)
                            : start}
                        </small>
                      </td>
                      <td style={{ padding: "2px 0", textAlign: "right" }}>
                        {d.incoming_total ? nf.format(d.incoming_total) : "-"}
                        {d.next_eta && (
                          <>
                            <br />
                            <small style={{ color: "#6b7280" }}>
                              ETA {d.next_eta.slice(0, 10)}
                            </small>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
              Tip: para cargar ingresos futuros, usá la sección{" "}
              <strong>Futuro Ingreso</strong> en el panel Administrativo.
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
