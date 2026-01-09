import { useMemo, useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useCart } from "../hooks/useCart";
import { api } from "../api/client";
import "../styles/catalog.css";

function useServiceBudget(servicioId) {
  const [settings, setSettings] = useState({ budget: null, maxPct: null });
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

function safeDateLabel(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-AR");
}

export default function Cart() {
  const { role } = useParams();
  const { user } = useAuth();
  const { items, update, remove, clear, total, service } = useCart();

  const [sending, setSending] = useState(false);
  const [errorSend, setErrorSend] = useState("");
  const [remito, setRemito] = useState(null);
  const [note, setNote] = useState("");

  // NUEVO: flag de éxito (para mostrar el cartel aunque falten campos del remito)
  const [orderOk, setOrderOk] = useState(false);

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
    setOrderOk(false);

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

      // Marcamos éxito aunque el remito venga incompleto
      setOrderOk(true);

      // Guardamos remito si vino
      setRemito(res.data?.remito || null);

      // Opcional: vaciar nota y carrito si tu flujo es “pedido enviado => limpiar”
      setNote("");
      // clear(); // si querés que se limpie el carrito al enviar, descomentá
    } catch (e) {
      setOrderOk(false);
      setErrorSend(e?.response?.data?.error || "No se pudo enviar el pedido");
    } finally {
      setSending(false);
    }
  }

  const showRemitoSection = orderOk || remito;

  const successBoxStyle = {
    border: "1px solid rgba(34,197,94,.35)",
    background: "rgba(34,197,94,.10)",
    borderRadius: 12,
    padding: 12,
    display: "flex",
    gap: 10,
    alignItems: "center",
    marginBottom: 10,
  };

  const checkBadgeStyle = {
    width: 28,
    height: 28,
    borderRadius: 999,
    background: "rgba(34,197,94,.20)",
    display: "grid",
    placeItems: "center",
    fontWeight: 900,
  };

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
              • <Link to="/app/supervisor/services">cambiar</Link>
            </>
          </div>
        )}

        {isSupervisorRoute && !service && (
          <div style={{ marginTop: 6 }}>
            <strong>Servicio:</strong> <em>no seleccionado</em> —{" "}
            <Link to="/app/supervisor/services">elegir</Link>
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
                const sub = Number(it.price || 0) * Number(it.qty || 1);
                const max = Number.isFinite(Number(it.stock))
                  ? Number(it.stock)
                  : undefined;
                const sinStock = max !== undefined && max <= 0;

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
                          {sinStock ? "Sin stock" : `Stock disponible: ${max}`}
                        </div>
                      )}
                    </td>
                    <td className="mono">{nf.format(Number(it.price || 0))}</td>
                    <td>
                      <input
                        type="number"
                        min="1"
                        {...(max !== undefined ? { max: Math.max(1, max) } : {})}
                        step="1"
                        className="qty-input"
                        value={it.qty}
                        onChange={(e) => {
                          const v = Math.max(1, Number(e.target.value) || 1);
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
                      <button className="btn" onClick={() => remove(it.productId)}>
                        Quitar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} style={{ textAlign: "right", fontWeight: 700 }}>
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
              style={{ display: "block", fontWeight: 600, marginBottom: 6 }}
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
            <div className="state error" style={{ marginTop: 12 }}>
              {errorSend}
            </div>
          )}

          {/* NUEVO: Sección de éxito + remito (con fallbacks) */}
          {showRemitoSection && (
            <section className="state" style={{ marginTop: 12 }}>
              {/* % arriba del remito (solo supervisor) */}
              {isSupervisorRoute && usagePct != null && (
                <div style={{ marginBottom: 6 }}>
                  <span className={`budget-chip ${overLimit ? "over" : "ok"}`}>
                    {usagePct.toFixed(2)}% del presupuesto usado
                  </span>
                </div>
              )}

              {/* Cartelito de aprobación */}
              <div style={successBoxStyle}>
                <div style={checkBadgeStyle}>✓</div>
                <div>
                  <div style={{ fontWeight: 800, lineHeight: 1.2 }}>
                    Remito generado con éxito
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.85 }}>
                    El pedido fue registrado correctamente.
                  </div>
                </div>
              </div>

              {/* Detalle SOLO si el backend devolvió remito con datos */}
              {remito ? (
                <>
                  <h3 style={{ marginTop: 0 }}>Detalle del remito</h3>

                  <div>
                    <strong>Número:</strong>{" "}
                    {remito.numero != null && String(remito.numero).trim()
                      ? remito.numero
                      : "—"}
                  </div>

                  <div>
                    <strong>Fecha:</strong> {safeDateLabel(remito.fecha)}
                  </div>

                  <div>
                    <strong>Generado por:</strong>{" "}
                    {remito.empleado != null && String(remito.empleado).trim()
                      ? remito.empleado
                      : "—"}
                  </div>

                  {/* Servicio SOLO cuando vino y estamos en supervisor */}
                  {isSupervisorRoute && remito.servicio?.name && (
                    <div>
                      <strong>Servicio:</strong> {remito.servicio.name}
                    </div>
                  )}

                  {/* Nota del remito */}
                  {remito.nota && remito.nota.trim() && (
                    <div style={{ whiteSpace: "pre-wrap" }}>
                      <strong>Nota:</strong> {remito.nota}
                    </div>
                  )}

                  <div>
                    <strong>Total:</strong> {nf.format(remito.total || 0)}
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
                </>
              ) : null}
            </section>
          )}
        </>
      )}
    </div>
  );
}
