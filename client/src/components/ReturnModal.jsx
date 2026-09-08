// client/src/components/ReturnModal.jsx
//
// Devolución de insumos de un pedido ya retirado.
//
// Se marcan los insumos que se devuelven, se pone la cantidad de cada uno y un
// motivo para toda la devolución, y se envía TODO junto. Antes había que
// repetir la operación insumo por insumo, que con pedidos de 20 líneas era
// tedioso y propenso a olvidarse alguno.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { normalizeText } from "../utils/text";
import "../styles/return-modal.css";

const MOTIVOS = ["Sobrante", "Dañado", "Vencido", "Error de pedido", "Otro"];

export default function ReturnModal({ order, onClose, onDone }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState({});          // productId -> cantidad
  const [motivo, setMotivo] = useState("");
  const [motivoOtro, setMotivoOtro] = useState("");

  const cargar = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const { data } = await api.get(`/orders/${order.id}/returnable`);
      setItems(data?.items || []);
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudo cargar el pedido");
    } finally { setLoading(false); }
  }, [order.id]);

  useEffect(() => { cargar(); }, [cargar]);

  const disponibles = useMemo(() => items.filter((i) => i.disponible > 0), [items]);
  const devueltos = useMemo(() => items.filter((i) => i.disponible <= 0), [items]);

  const visibles = useMemo(() => {
    const t = normalizeText(q);
    if (!t) return disponibles;
    return disponibles.filter((i) => normalizeText(i.name).includes(t) || normalizeText(i.code).includes(t));
  }, [disponibles, q]);

  const marcado = (pid) => sel[pid] != null;
  const cantidadDe = (pid) => Number(sel[pid] || 0);

  const alternar = (it) => {
    setSel((s) => {
      const n = { ...s };
      if (n[it.productId] != null) delete n[it.productId];
      else n[it.productId] = 1;      // arranca en 1; se sube con los botones o "todo"
      return n;
    });
    setOkMsg("");
  };

  const setCantidad = (it, val) => {
    const n = Math.max(0, Math.min(it.disponible, Math.trunc(Number(val) || 0)));
    setSel((s) => (n === 0 ? (() => { const x = { ...s }; delete x[it.productId]; return x; })()
      : { ...s, [it.productId]: n }));
  };

  const elegidos = Object.entries(sel).filter(([, c]) => Number(c) > 0);
  const totalUnidades = elegidos.reduce((a, [, c]) => a + Number(c), 0);
  const motivoFinal = motivo === "Otro" ? motivoOtro.trim() : motivo;

  const enviar = async () => {
    if (!elegidos.length) return setErr("Marcá al menos un insumo para devolver.");
    if (!motivoFinal) return setErr("Elegí el motivo de la devolución.");
    setSaving(true); setErr(""); setOkMsg("");
    try {
      await api.post("/orders/returns", {
        pedidoId: order.id,
        items: elegidos.map(([pid, c]) => ({ productoId: Number(pid), cantidad: Number(c), motivo: motivoFinal })),
      });
      setOkMsg(`Se enviaron ${elegidos.length} devolución${elegidos.length === 1 ? "" : "es"} (${totalUnidades} unidades). Quedan pendientes de que el depósito las apruebe.`);
      setSel({}); setMotivo(""); setMotivoOtro("");
      await cargar();
      onDone && onDone();
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudo enviar la devolución");
    } finally { setSaving(false); }
  };

  return (
    <div className="rm-fondo" role="dialog" aria-modal="true"
      aria-label={`Devolver insumos del pedido ${order.id}`} onClick={onClose}>
      <div className="rm" onClick={(e) => e.stopPropagation()}>

        <header className="rm-head">
          <div>
            <div className="rm-num">Devolver — Pedido #{String(order.id).padStart(7, "0")}</div>
            {/* El nombre completo del servicio, sin recortar: es lo que
                identifica el pedido para el supervisor. */}
            {order.servicioNombre && <div className="rm-servicio">{order.servicioNombre}</div>}
          </div>
          <button type="button" className="rm-cerrar" onClick={onClose} aria-label="Cerrar">×</button>
        </header>

        <div className="rm-cuerpo">
          {loading ? <div className="rm-info">Cargando…</div>
            : err && !items.length ? <div className="rm-error">{err}</div>
              : !items.length ? <div className="rm-info">Este pedido no tiene insumos para devolver.</div>
                : (
                  <>
                    {okMsg && <div className="rm-ok">{okMsg}</div>}
                    {err && <div className="rm-error">{err}</div>}

                    {disponibles.length === 0 ? (
                      <div className="rm-info">Ya devolviste todo lo de este pedido.</div>
                    ) : (
                      <>
                        <p className="rm-ayuda">
                          Marcá los insumos que devolvés y poné la cantidad de cada uno.
                          Se envían todos juntos y quedan <strong>pendientes</strong> hasta que
                          el depósito los apruebe.
                        </p>

                        {disponibles.length > 6 && (
                          <input className="rm-buscar" type="search" value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="Buscar insumo…" />
                        )}

                        <div className="rm-lista">
                          {visibles.map((it) => {
                            const on = marcado(it.productId);
                            return (
                              <div key={it.productId} className={`rm-item${on ? " is-on" : ""}`}>
                                <label className="rm-check">
                                  <input type="checkbox" checked={on} onChange={() => alternar(it)} />
                                  <span className="rm-nombre">{it.name}</span>
                                </label>

                                <div className="rm-derecha">
                                  <span className="rm-disp">
                                    hasta <strong>{it.disponible}</strong>
                                    {it.pedido !== it.disponible && <> de {it.pedido}</>}
                                  </span>

                                  {on && (
                                    <>
                                      <div className="rm-cant">
                                        <button type="button" aria-label="Restar"
                                          onClick={() => setCantidad(it, cantidadDe(it.productId) - 1)}>−</button>
                                        <input type="number" min="0" max={it.disponible}
                                          value={cantidadDe(it.productId)}
                                          onChange={(e) => setCantidad(it, e.target.value)}
                                          aria-label={`Cantidad a devolver de ${it.name}`} />
                                        <button type="button" aria-label="Sumar"
                                          onClick={() => setCantidad(it, cantidadDe(it.productId) + 1)}>+</button>
                                      </div>
                                      {cantidadDe(it.productId) !== it.disponible && (
                                        <button type="button" className="rm-todo"
                                          onClick={() => setCantidad(it, it.disponible)}>
                                          todo
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          {visibles.length === 0 && <div className="rm-info">Ningún insumo coincide con la búsqueda.</div>}
                        </div>

                        {/* Un motivo para toda la devolución: casi siempre es el
                            mismo, y pedirlo por insumo era repetitivo. */}
                        <div className="rm-motivo">
                          <div className="rm-rot">Motivo de la devolución</div>
                          <div className="rm-motivos">
                            {MOTIVOS.map((m) => (
                              <button key={m} type="button"
                                className={`rm-pill${motivo === m ? " is-on" : ""}`}
                                onClick={() => setMotivo(m)}>{m}</button>
                            ))}
                          </div>
                          {motivo === "Otro" && (
                            <input className="rm-otro" type="text" value={motivoOtro} autoFocus
                              onChange={(e) => setMotivoOtro(e.target.value)}
                              placeholder="Escribí el motivo…" />
                          )}
                        </div>
                      </>
                    )}

                    {devueltos.length > 0 && (
                      <details className="rm-ya">
                        <summary>Ya devueltos ({devueltos.length})</summary>
                        <ul>{devueltos.map((i) => <li key={i.productId}>{i.name} — {i.pedido} unidades</li>)}</ul>
                      </details>
                    )}
                  </>
                )}
        </div>

        {disponibles.length > 0 && (
          <footer className="rm-pie">
            <span className="rm-resumen">
              {elegidos.length === 0
                ? "Ningún insumo marcado"
                : `${elegidos.length} insumo${elegidos.length === 1 ? "" : "s"} · ${totalUnidades} unidades`}
            </span>
            <div className="rm-acciones">
              <button type="button" className="rm-btn" onClick={onClose}>Cancelar</button>
              <button type="button" className="rm-btn rm-btn--ok"
                onClick={enviar} disabled={saving || !elegidos.length || !motivoFinal}>
                {saving ? "Enviando…" : "Enviar devolución"}
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
