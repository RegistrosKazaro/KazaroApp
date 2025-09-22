import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useCart } from "../hooks/useCart";
import { api } from "../api/client";
import "../styles/catalog.css";


export default function Cart() {
  const { role } = useParams();
  const { user } = useAuth();
  const { items, update, remove, clear, total, service } = useCart();

  const [sending, setSending] = useState(false);
  const [errorSend, setErrorSend] = useState("");
  const [remito, setRemito] = useState(null);

  const userLabel = useMemo(() => user?.username || `Usuario ${user?.id || ""}`, [user]);

  async function sendOrder() {
    setSending(true); setErrorSend(""); setRemito(null);
    try {
      const payload = {
        rol: role,
        nota: "",
        items: items.map(it => ({ productId: it.productId, qty: it.qty })),
        servicioId: service?.id ?? null,
        servicioName: service?.name ?? null,
      };
      const res = await api.post("/orders", payload);
      setRemito(res.data?.remito || null);
    } catch (e) {
      setErrorSend(e?.response?.data?.error || "No se pudo enviar el pedido");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="catalog" style={{maxWidth: 960, marginInline: "auto"}}>
      <h2>Carrito</h2>

      <section className="state" style={{ marginBottom: 12 }}>
        <div><strong>Usuario:</strong> {userLabel}</div>
        {service && (
          <div style={{ marginTop: 6 }}>
            <strong>Servicio:</strong> {service.name} <small>(ID: {service.id})</small>{" "}
            {String(role).includes("super") && (
              <>• <Link to="/app/supervisor/services">cambiar</Link></>
            )}
          </div>
        )}
        {!service && String(role).includes("super") && (
          <div style={{ marginTop: 6 }}>
            <strong>Servicio:</strong> <em>no seleccionado</em> — <Link to="/app/supervisor/services">elegir</Link>
          </div>
        )}
      </section>

      {items.length === 0 ? (
        <div className="state">No hay productos en el carrito.</div>
      ) : (
        <>
          <table className="sup-table" style={{ marginBottom: 12 }}>
            <thead>
              <tr>
                <th>Producto</th>
                <th style={{width: 120}}>Precio</th>
                <th style={{width: 120}}>Cantidad</th>
                <th style={{width: 120}}>Subtotal</th>
                <th style={{width: 80}}></th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => {
                const sub = Number(it.price || 0) * Number(it.qty || 1);
                return (
                  <tr key={it.productId}>
                    <td>{it.name}</td>
                    <td className="mono">
                      {new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS"}).format(Number(it.price || 0))}
                    </td>
                    <td>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        className="qty-input"
                        value={it.qty}
                        onChange={(e) => update(it.productId, Math.max(1, Number(e.target.value) || 1))}
                        aria-label={`Cantidad de ${it.name}`}
                      />
                    </td>
                    <td className="mono">
                      {new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS"}).format(sub)}
                    </td>
                    <td>
                      <button className="btn" onClick={() => remove(it.productId)}>Quitar</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} style={{ textAlign: "right", fontWeight: 700 }}>Total</td>
                <td className="mono" colSpan={2}>
                  {new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS"}).format(total)}
                </td>
              </tr>
            </tfoot>
          </table>

          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" onClick={clear}>Limpiar</button>
            <button className="btn" onClick={sendOrder} disabled={sending || items.length === 0}>
              {sending ? "Enviando…" : "Enviar pedido"}
            </button>
          </div>

          {errorSend && <div className="state error" style={{ marginTop: 12 }}>{errorSend}</div>}

          {remito && (
  <section className="state" style={{ marginTop: 12 }}>
    <h3 style={{ marginTop: 0 }}>Remito generado</h3>
    <div><strong>Número:</strong> {remito.numero}</div>
    <div><strong>Fecha:</strong> {new Date(remito.fecha).toLocaleString("es-AR")}</div>
    <div><strong>Generado por:</strong> {remito.empleado}</div>
    {remito.servicio && <div><strong>Servicio:</strong> {remito.servicio.name}</div>}
    <div><strong>Total:</strong> {new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS"}).format(remito.total || 0)}</div>
    {remito.pdfUrl && (
      <div style={{ marginTop: 8 }}>
        <a className="pill" href={remito.pdfUrl} target="_blank" rel="noopener noreferrer">Descargar PDF</a>
      </div>
    )}
  </section>
)}
        </>
      )}
    </div>
  );
}
