// client/src/pages/ControlPedidosSection.jsx
// Control interno del admin: ir tildando qué pedidos ya se revisaron contra sus
// insumos. No cambia el estado del pedido, ni el stock, ni los informes.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { formatMoney, formatNumber } from "../utils/format";
import useDebounced from "../hooks/useDebounced";
import "../styles/control-pedidos.css";

const PER_PAGE = 30;

export default function ControlPedidosSection() {
  const [pedidos, setPedidos] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [q, setQ] = useState("");
  const qDeb = useDebounced(q, 300);
  const [control, setControl] = useState("no");     // no | si | todos
  const [orden, setOrden] = useState("movimiento"); // movimiento | pedido
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [servicioId, setServicioId] = useState("");
  const [servicios, setServicios] = useState([]);

  const [abiertos, setAbiertos] = useState(new Set());
  const [guardando, setGuardando] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const { data } = await api.get("/admin/pedidos", {
        params: {
          page, limit: PER_PAGE, orden,
          control: control === "todos" ? undefined : control,
          q: qDeb || undefined,
          servicioId: servicioId || undefined,
          desde: desde || undefined,
          hasta: hasta || undefined,
        },
      });
      setPedidos(Array.isArray(data?.pedidos) ? data.pedidos : []);
      setTotal(Number(data?.total || 0));
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudieron cargar los pedidos");
      setPedidos([]); setTotal(0);
    } finally { setLoading(false); }
  }, [page, orden, control, qDeb, servicioId, desde, hasta]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { setPage(1); }, [qDeb, control, orden, servicioId, desde, hasta]);

  useEffect(() => {
    let vivo = true;
    api.get("/admin/pedidos/servicios")
      .then(({ data }) => { if (vivo) setServicios(Array.isArray(data) ? data : []); })
      .catch(() => { if (vivo) setServicios([]); });
    return () => { vivo = false; };
  }, []);

  const marcar = async (o, valor) => {
    setGuardando(o.id);
    try {
      const { data } = await api.put(`/admin/pedidos/${o.id}/control`, { controlado: valor });
      setPedidos((prev) => prev.map((p) => (p.id === o.id
        ? { ...p, controlado: data.controlado, controladoEnAr: data.controladoEnAr, controladoPor: data.controladoPor }
        : p)));
      // Si estoy viendo "sin controlar", el pedido tildado sale de la lista.
      if (control === "no" && valor) {
        setTimeout(() => setPedidos((prev) => prev.filter((p) => p.id !== o.id)), 450);
        setTotal((t) => Math.max(0, t - 1));
      }
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudo marcar el pedido");
    } finally { setGuardando(null); }
  };

  // Tildar un insumo suelto: sirve para ir verificando uno por uno que lo que
  // figura coincide con lo que realmente salió.
  const marcarItem = async (o, item, valor) => {
    // Optimista: se ve al instante y se corrige si el servidor falla.
    const aplicar = (v) => setPedidos((prev) => prev.map((p) => (p.id !== o.id ? p : {
      ...p,
      items: (p.items || []).map((i) => (i.productoId === item.productoId ? { ...i, controlado: v } : i)),
    })));
    aplicar(valor);
    try {
      await api.put(`/admin/pedidos/${o.id}/control/item`, { productoId: item.productoId, controlado: valor });
    } catch (e) {
      aplicar(!valor);
      setErr(e?.response?.data?.error || "No se pudo marcar el insumo");
    }
  };

  const avanceDe = (o) => {
    const items = o.items || [];
    return { hechos: items.filter((i) => i.controlado).length, total: items.length };
  };

  const toggle = (id) => setAbiertos((prev) => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s;
  });

  const paginas = Math.max(1, Math.ceil(total / PER_PAGE));
  const sinControlar = useMemo(() => pedidos.filter((p) => !p.controlado).length, [pedidos]);

  const limpiar = () => { setQ(""); setServicioId(""); setDesde(""); setHasta(""); setControl("no"); };

  return (
    <section className="cp" aria-label="Control de pedidos">
      <header className="cp-head">
        <div>
          <h3 className="cp-title">Control de pedidos</h3>
          <p className="cp-sub">
            Tildá los pedidos que ya revisaste con sus insumos. Es sólo tu control: no cambia
            el estado del pedido ni afecta los informes.
          </p>
        </div>
        <div className="cp-contador">
          <strong>{total}</strong>
          <span>{control === "no" ? "sin controlar" : control === "si" ? "controlados" : "en total"}</span>
        </div>
      </header>

      {/* Filtros */}
      <div className="cp-filtros">
        <input className="cp-input cp-input--search" type="search" value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por N° de pedido, servicio, insumo o código…" />

        <div className="cp-segmented" role="group" aria-label="Estado de control">
          {[["no", "Sin controlar"], ["si", "Controlados"], ["todos", "Todos"]].map(([k, l]) => (
            <button key={k} type="button" className={control === k ? "is-active" : ""}
              onClick={() => setControl(k)}>{l}</button>
          ))}
        </div>

        <label className="cp-field">
          <span>Ordenar por</span>
          <select value={orden} onChange={(e) => setOrden(e.target.value)}>
            <option value="movimiento">Último movimiento (cierre / retiro)</option>
            <option value="pedido">Fecha del pedido</option>
          </select>
        </label>

        <label className="cp-field">
          <span>Servicio</span>
          <select value={servicioId} onChange={(e) => setServicioId(e.target.value)}>
            <option value="">Todos</option>
            {servicios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </label>

        <label className="cp-field"><span>Desde</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="cp-field"><span>Hasta</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>

        {(q || servicioId || desde || hasta || control !== "no") && (
          <button type="button" className="cp-btn-ghost" onClick={limpiar}>Limpiar</button>
        )}
      </div>

      {err && <div className="state error">{err}</div>}
      {loading && <div className="cp-vacio">Cargando pedidos…</div>}

      {!loading && pedidos.length === 0 && (
        <div className="cp-vacio cp-vacio--ok">
          {control === "no" ? "✓ No quedan pedidos sin controlar con estos filtros." : "Sin pedidos para esos filtros."}
        </div>
      )}

      <div className="cp-lista">
        {pedidos.map((o) => (
          <article key={o.id} className={`cp-item${o.controlado ? " is-controlado" : ""}`}>
            <label className="cp-check" title={o.controlado ? "Desmarcar" : "Marcar como controlado"}>
              <input type="checkbox" checked={!!o.controlado} disabled={guardando === o.id}
                onChange={(e) => marcar(o, e.target.checked)} />
            </label>

            <div className="cp-datos">
              <div className="cp-linea1">
                <span className="cp-num">#{o.numero}</span>
                <span className={`cp-estado cp-estado--${o.retiradoEnAr ? "retirado" : o.estado}`}>
                  {o.retiradoEnAr ? "Retirado" : o.estado === "cerrado" ? "Listo para retirar" : "En curso"}
                </span>
                {o.tuvoDevolucion && <span className="cp-dev">↩ con devolución</span>}
              </div>

              <div className="cp-servicio">
                {o.servicio?.nombre || <em className="muted">Sin servicio ({o.rol || "—"})</em>}
              </div>

              <div className="cp-fechas">
                <span>Pedido: <strong>{o.fechaAr}</strong></span>
                {o.cerradoEnAr && <span>Cerrado: <strong>{o.cerradoEnAr}</strong></span>}
                {o.retiradoEnAr && <span>Retirado: <strong>{o.retiradoEnAr}</strong></span>}
                <span className="cp-solicitante">{o.solicitante || "—"}</span>
              </div>

              {o.controlado && (
                <div className="cp-marca">
                  ✓ Controlado {o.controladoEnAr ? `el ${o.controladoEnAr}` : ""}
                  {o.controladoPor ? ` por ${o.controladoPor}` : ""}
                </div>
              )}

              {abiertos.has(o.id) && (
                <div className="cp-items">
                  <p className="cp-items-ayuda">
                    Tildá cada insumo a medida que verificás que coincide con lo que salió.
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th className="chk">✓</th>
                        <th>Código</th><th>Insumo</th>
                        <th className="num">Cant.</th><th className="num">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(o.items || []).map((i, idx) => (
                        <tr key={i.productoId || idx} className={i.controlado ? "is-ok" : ""}>
                          <td className="chk">
                            <input type="checkbox" checked={!!i.controlado}
                              aria-label={`Marcar ${i.nombre} como verificado`}
                              onChange={(e) => marcarItem(o, i, e.target.checked)} />
                          </td>
                          <td className="mono">{i.codigo || "—"}</td>
                          <td>
                            {i.nombre}
                            {i.devuelto > 0 && <span className="cp-devuelto"> ↩ devueltos {i.devuelto} de {i.cantidadOriginal}</span>}
                          </td>
                          <td className="num">{formatNumber(i.cantidad)}</td>
                          <td className="num">{formatMoney(i.subtotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Cuando están todos tildados, se ofrece cerrar el control del pedido. */}
                  {(() => {
                    const { hechos, total } = avanceDe(o);
                    if (total === 0) return null;
                    if (hechos < total) {
                      return <p className="cp-items-pie">Faltan {total - hechos} de {total} insumos por verificar.</p>;
                    }
                    return o.controlado
                      ? <p className="cp-items-pie is-ok">✓ Todos los insumos verificados y el pedido controlado.</p>
                      : (
                        <button type="button" className="cp-btn-ok" disabled={guardando === o.id}
                          onClick={() => marcar(o, true)}>
                          ✓ Todos verificados — marcar el pedido como controlado
                        </button>
                      );
                  })()}
                </div>
              )}
            </div>

            <div className="cp-derecha">
              <span className="cp-total">{formatMoney(o.total)}</span>
              {(() => {
                const { hechos, total } = avanceDe(o);
                if (!total) return <span className="cp-cant">{o.cantidadItems} ít.</span>;
                return (
                  <span className={`cp-avance${hechos === total ? " is-ok" : hechos > 0 ? " is-parcial" : ""}`}>
                    {hechos} de {total} insumos
                  </span>
                );
              })()}
              <button type="button" className="cp-btn-ghost" onClick={() => toggle(o.id)}>
                {abiertos.has(o.id) ? "Ocultar" : "Verificar insumos"}
              </button>
            </div>
          </article>
        ))}
      </div>

      {paginas > 1 && (
        <div className="cp-pager">
          <button type="button" className="cp-btn-ghost" disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}>Anterior</button>
          <span>Página {page} de {paginas}</span>
          <button type="button" className="cp-btn-ghost" disabled={page >= paginas}
            onClick={() => setPage((p) => Math.min(paginas, p + 1))}>Siguiente</button>
        </div>
      )}

      {!loading && pedidos.length > 0 && control !== "si" && (
        <p className="cp-pie">Quedan {sinControlar} sin controlar en esta página.</p>
      )}
    </section>
  );
}
