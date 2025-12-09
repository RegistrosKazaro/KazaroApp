import { useMemo, useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useCart } from "../hooks/useCart";
import { api } from "../api/client";
import "../styles/catalog.css";

function useServiceBudget(servicioId) {
  const [settings, setSettings] = useState({budget:null, maxPct: null})
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!servicioId) {
        setSettings({ budget: null, maxPct: null });
        return;
      }
      setLoading(true);
      try {
        const r = await api.get(`/services/${servicioId}/budget`);
        if (alive)
          setSettings({
            budget: r.data?.budget ?? null,
            maxPct: r.data?.maxPct ?? null,
          });
      } catch {
        if (alive) setSettings({ budget: null, maxPct: null });
      } finally {
        setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [servicioId]);

  return { ...settings, loading };
}

export default function Cart() {
  const { role } = useParams();
  const { user } = useAuth();
  const { items, update, remove, clear, total, service } = useCart();

  const [sending, setSending] = useState(false);
  const [errorSend, setErrorSend] = useState("");
  const [remito, setRemito] = useState(null);
  const [note, setNote] = useState("");

  // Modo supervisor según la URL (/app/supervisor/...)
  const isSupervisorRoute = useMemo(
    () => String(role || "").toLowerCase().includes("super"),
    [role]
  );

  const userLabel = useMemo(() => {
    if (!user) return "";
    const u = user;
    return [u?.nombre, u?.apellido, `(${u?.username || ""})`]
      .filter(Boolean)
      .join(" ");
  }, [user]);

  // Presupuesto del servicio SOLO en modo supervisor
    const { budget, maxPct } = useServiceBudget(
    isSupervisorRoute ? service?.id : null
  );

  const nf = useMemo(
    () => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }),
    []
  );

  const usagePct = useMemo(() => {
    if (!isSupervisorRoute) return null;
    if (!service) return null;
    if (!budget || budget <= 0) return null;
    return (Number(total) / Number(budget)) * 100;
  }, [total, budget, isSupervisorRoute, service]);

  const maxPctAllowed = useMemo(() => {
    if (!isSupervisorRoute) return null;
    const pctNum = Number(maxPct);
    if (!Number.isFinite(pctNum) || pctNum <= 0) return null;
    return pctNum;
  }, [maxPct, isSupervisorRoute]);

  const overLimit =
    usagePct != null && maxPctAllowed != null && usagePct > maxPctAllowed;

  async function sendOrder() {
    setSending(true);
    setErrorSend("");
    setRemito(null);

    try {
      const payload = {
        rol: role,
        nota: String(note || "").trim(),
        items: items.map((it) => ({
          productId: it.productId,
          qty: it.qty,
        })),
        // Solo mandamos servicio cuando está en panel de supervisor
        servicioId: isSupervisorRoute ? service?.id ?? null : null,
        servicioName: isSupervisorRoute ? service?.name ?? null : null,
      };

      const res = await api.post("/orders", payload);
      setRemito(res.data?.remito || null);
      setNote("");
    } catch (e) {
      setErrorSend(
        e?.response?.data?.error || "No se pudo enviar el pedido"
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="catalog" style={{ maxWidth: 960, marginInline: "auto" }}>
      <h2>Carrito</h2>

      {/* Cabecera con usuario/servicio */}
      <section className="state" style={{ marginBottom: 12 }}>
        <div>
          <strong>Usuario:</strong> {userLabel}
        </div>

        {/* Servicio SOLO en panel de supervisor */}
        {isSupervisorRoute && service && (
          <div>
            <strong>Servicio:</strong> {service?.name}{" "}
            <small>(ID: {service?.id})</small>{" "}
            <>
              •{" "}
              <Link to="/app/supervisor/services">
                cambiar
              </Link>
            </>
          </div>
        )}

        {isSupervisorRoute && !service && (
          <div style={{ marginTop: 6 }}>
            <strong>Servicio:</strong>{" "}
            <em>no seleccionado</em> —{" "}
            <Link to="/app/supervisor/services">
              elegir
            </Link>
          </div>
        )}

        {/* % de presupuesto usado SOLO en modo supervisor */}
        {isSupervisorRoute && service && usagePct != null && (
          <div style={{ marginTop: 8 }}>
            <span className={`budget-chip ${overLimit ? "over" : "ok"}`}>
              {usagePct.toFixed(2)}%
            </span>
          </div>
        )}
      </section>

      {items.length === 0 ? (
        <div className="state">No tenés productos en el carrito.</div>
      ) : (
        <>
          <table className="sup-table" style={{ marginBottom: 12 }}>
            <thead>
              <tr>
                <th>Producto</th>
                <th style={{ width: 120 }}>Precio</th>
                <th style={{ width: 120 }}>Cantidad</th>
                <th style={{ width: 120 }}>Subtotal</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const sub =
                  Number(it.price || 0) * Number(it.qty || 1);
                const max = Number.isFinite(Number(it.stock))
                  ? Number(it.stock)
                  : undefined;
                const sinStock =
                  max !== undefined && max <= 0;

                return (
                  <tr key={it.productId}>
                    <td>
                      {it.name}
                      {max !== undefined && (
                        <div
                          style={{
                            fontSize: 12,
                            opacity: 0.85,
                            marginTop: 4,
                          }}
                        >
                          {sinStock
                            ? "Sin stock"
                            : `Stock disponible: ${max}`}
                        </div>
                      )}
                    </td>
                    <td className="mono">
                      {nf.format(Number(it.price || 0))}
                    </td>
                    <td>
                      <input
                        type="number"
                        min="1"
                        {...(max !== undefined
                          ? { max: Math.max(1, max) }
                          : {})}
                        step="1"
                        className="qty-input"
                        value={it.qty}
                        onChange={(e) => {
                          const v = Math.max(
                            1,
                            Number(e.target.value) || 1
                          );
                          const safe =
                            max !== undefined
                              ? Math.min(v, Math.max(1, max))
                              : v;
                          update(it.productId, safe);
                        }}
                        disabled={sinStock}
                        aria-label={`Cantidad de ${it.name}`}
                      />
                    </td>
                    <td className="mono">{nf.format(sub)}</td>
                    <td>
                      <button
                        className="btn"
                        onClick={() => remove(it.productId)}
                      >
                        Quitar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              {usagePct != null && isSupervisorRoute && (
                <tr>
                  <td
                    colSpan={3}
                    style={{ textAlign: "right", fontWeight: 700 }}
                  ></td>
                  <td colSpan={2}></td>
                </tr>
              )}
              <tr>
                <td
                  colSpan={3}
                  style={{ textAlign: "right", fontWeight: 700 }}
                >
                  Total
                </td>
                <td className="mono" colSpan={2}>
                  {nf.format(total)}
                </td>
              </tr>
            </tfoot>
          </table>

          {/* Nota del pedido */}
          <div className="state" style={{ marginTop: 12 }}>
            <label
              htmlFor="order-note"
              style={{
                display: "block",
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              Nota del pedido (opcional)
            </label>
            <textarea
              id="order-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ej.: Entregar en guardia, embalaje especial, referencias internas, etc."
              rows={3}
              style={{ width: "100%", resize: "vertical" }}
            />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" onClick={clear}>
              Limpiar
            </button>
            <button
              className="btn"
              onClick={sendOrder}
              disabled={sending || items.length === 0 || overLimit}
              title={
                overLimit
                  ? `El pedido excede el ${maxPctAllowed ?? ""}% del presupuesto del servicio`
                  : ""
              }
            >
              {sending
                ? "Enviando…"
                : overLimit
                ? `Excede ${maxPctAllowed ?? ""}% del presupuesto`
                : "Enviar pedido"}
            </button>
          </div>

          {errorSend && (
            <div
              className="state error"
              style={{ marginTop: 12 }}
            >
              {errorSend}
            </div>
          )}

          {remito && (
            <section
              className="state"
              style={{ marginTop: 12 }}
            >
              {/* % arriba del remito (solo supervisor) */}
              {isSupervisorRoute && usagePct != null && (
                <div style={{ marginBottom: 6 }}>
                  <span
                    className={`budget-chip ${
                      overLimit ? "over" : "ok"
                    }`}
                  >
                    {usagePct.toFixed(2)}% del presupuesto usado
                  </span>
                </div>
              )}

              <h3 style={{ marginTop: 0 }}>Remito generado</h3>
              <div>
                <strong>Número:</strong> {remito.numero}
              </div>
              <div>
                <strong>Fecha:</strong>{" "}
                {new Date(remito.fecha).toLocaleString("es-AR")}
              </div>
              <div>
                <strong>Generado por:</strong> {remito.empleado}
              </div>

              {/* Servicio SOLO cuando vino y estamos en supervisor */}
              {isSupervisorRoute && remito.servicio && (
                <div>
                  <strong>Servicio:</strong>{" "}
                  {remito.servicio.name}
                </div>
              )}

              {/* Nota del remito */}
              {remito.nota && remito.nota.trim() && (
                <div style={{ whiteSpace: "pre-wrap" }}>
                  <strong>Nota:</strong> {remito.nota}
                </div>
              )}

              <div>
                <strong>Total:</strong>{" "}
                {nf.format(remito.total || 0)}
              </div>
              {remito.pdfUrl && (
                <div style={{ marginTop: 8 }}>
                  <a
                    className="pill"
                    href={remito.pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Descargar PDF
                  </a>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
