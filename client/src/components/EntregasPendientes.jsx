// client/src/components/EntregasPendientes.jsx
//
// Pedidos que se despacharon incompletos: material que quedó esperando stock.
// Al entregarlo NO se genera un remito nuevo — se suma al mismo pedido como una
// entrega adicional, con su propia fecha (que es la que cruza contra Flexxus).
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { formatNumber } from "../utils/format";
import { normalizeText } from "../utils/text";
import useDebounced from "../hooks/useDebounced";
import "../styles/entregas-pendientes.css";

export default function EntregasPendientes() {
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const qDeb = useDebounced(q, 250);
  const [abierto, setAbierto] = useState(null);
  const [cantidades, setCantidades] = useState({});   // productId -> a entregar
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true); setError("");
    try {
      const { data: d } = await api.get("/deposito/pendientes");
      setData(d);
    } catch (e) {
      setError(e?.response?.data?.error || "No se pudieron cargar las entregas pendientes.");
      setData(null);
    } finally { setCargando(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const pedidos = useMemo(() => {
    const t = normalizeText(qDeb);
    const lista = data?.pedidos || [];
    if (!t) return lista;
    const soloDigitos = t.replace(/\D/g, "");
    return lista.filter((p) =>
      (soloDigitos && (String(p.id).includes(soloDigitos) || p.numero.includes(soloDigitos)))
      || normalizeText(p.servicio).includes(t)
      || normalizeText(p.solicitante).includes(t)
      || (p.items || []).some((i) => normalizeText(i.nombre).includes(t) || normalizeText(i.codigo).includes(t))
    );
  }, [data, qDeb]);

  const abrir = (p) => {
    if (abierto === p.id) { setAbierto(null); return; }
    setAbierto(p.id);
    // Por defecto se entrega todo lo pendiente; el encargado puede bajarlo.
    const inicial = {};
    for (const i of p.items) inicial[i.productId] = i.pendiente;
    setCantidades(inicial);
    setAviso("");
  };

  const setCant = (productId, max, val) => {
    const n = Math.max(0, Math.min(max, Math.trunc(Number(val) || 0)));
    setCantidades((prev) => ({ ...prev, [productId]: n }));
  };

  const entregar = async (p) => {
    const items = (p.items || [])
      .map((i) => ({ productId: i.productId, cantidad: cantidades[i.productId] ?? 0 }))
      .filter((i) => i.cantidad > 0);
    if (!items.length) { setAviso("Indicá al menos una cantidad para entregar."); return; }

    const total = items.reduce((s, i) => s + i.cantidad, 0);
    const parcial = total < (p.items || []).reduce((s, i) => s + i.pendiente, 0);
    const texto = parcial
      ? `Vas a entregar ${formatNumber(total)} unidades del pedido #${p.numero}. El resto queda pendiente. ¿Confirmás?`
      : `Vas a entregar todo lo pendiente del pedido #${p.numero}. ¿Confirmás?`;
    if (!window.confirm(texto)) return;

    setGuardando(true); setAviso("");
    try {
      const { data: r } = await api.post(`/deposito/orders/${p.id}/entregar-pendientes`, { items });
      setAviso(r.pendientesRestantes > 0
        ? `Entrega registrada. Quedan ${formatNumber(r.pendientesRestantes)} unidades pendientes.`
        : "Entrega registrada. El pedido quedó completo.");
      setAbierto(null);
      await cargar();
    } catch (e) {
      const d = e?.response?.data;
      setAviso(d?.faltantes?.length
        ? `No hay stock suficiente: ${d.faltantes.map((f) => f.nombre).join(", ")}.`
        : (d?.error || "No se pudo registrar la entrega."));
    } finally { setGuardando(false); }
  };

  return (
    <div className="ep">
      <div>
        <h2 className="ep-title">Entregas pendientes</h2>
        <p className="ep-sub">
          Pedidos que se despacharon incompletos porque faltaba stock. Al entregar lo que quedó,
          se suma <strong>al mismo pedido y al mismo remito</strong> como una entrega adicional —
          no se genera un remito nuevo.
        </p>
      </div>

      {!!data?.totales?.pedidos && (
        <div className="ep-kpis">
          <div className="ep-kpi">
            <span className="ep-kpi-n">{formatNumber(data.totales.pedidos)}</span>
            <span>pedidos con material esperando</span>
          </div>
          <div className="ep-kpi">
            <span className="ep-kpi-n">{formatNumber(data.totales.unidades)}</span>
            <span>unidades sin entregar</span>
          </div>
        </div>
      )}

      <input className="ep-search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por número de pedido, servicio, solicitante o insumo…" />

      {aviso && <div className="state">{aviso}</div>}
      {error && <div className="state error">{error}</div>}

      {cargando ? <div className="ep-vacio">Cargando…</div>
        : pedidos.length === 0 ? (
          <div className="ep-vacio">
            {q ? "No hay pedidos que coincidan con la búsqueda."
              : "No hay entregas pendientes. Todos los pedidos se despacharon completos."}
          </div>
        ) : (
          <div className="ep-lista">
            {pedidos.map((p) => {
              const totalPend = p.items.reduce((s, i) => s + i.pendiente, 0);
              const estaAbierto = abierto === p.id;
              return (
                <article key={p.id} className={`ep-card${estaAbierto ? " is-abierto" : ""}`}>
                  <header className="ep-card-head">
                    <div>
                      <span className="ep-num">#{p.numero}</span>
                      <span className="ep-servicio">
                        {p.servicio || <em>Sin servicio (administrativo)</em>}
                      </span>
                      <span className="ep-meta">
                        {p.solicitante || "—"}
                        {p.retirado && <span className="ep-tag">ya retirado</span>}
                        {p.cerradoAr && <span className="ep-fecha">listo el {p.cerradoAr}</span>}
                      </span>
                    </div>
                    <div className="ep-card-acciones">
                      <span className="ep-pend">{formatNumber(totalPend)} sin entregar</span>
                      <button type="button" className="ep-btn" onClick={() => abrir(p)}>
                        {estaAbierto ? "Cerrar" : "Entregar"}
                      </button>
                    </div>
                  </header>

                  {estaAbierto && (
                    <div className="ep-detalle">
                      <table className="ep-tabla">
                        <thead>
                          <tr>
                            <th>Código</th><th>Insumo</th>
                            <th className="num">Pidió</th>
                            <th className="num">Ya entregado</th>
                            <th className="num">Pendiente</th>
                            <th className="num">Entregar ahora</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.items.map((i) => (
                            <tr key={i.productId}>
                              <td className="mono">{i.codigo || "—"}</td>
                              <td>{i.nombre}</td>
                              <td className="num">{formatNumber(i.cantidad)}</td>
                              <td className="num">{formatNumber(i.entregado)}</td>
                              <td className="num ep-fuerte">{formatNumber(i.pendiente)}</td>
                              <td className="num">
                                <input type="number" min="0" max={i.pendiente}
                                  value={cantidades[i.productId] ?? 0}
                                  onChange={(e) => setCant(i.productId, i.pendiente, e.target.value)} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="ep-pie">
                        <span>
                          Si no tenés todo, entregá lo que haya: el resto queda pendiente para una próxima entrega.
                        </span>
                        <button type="button" className="ep-btn ep-btn--ok"
                          disabled={guardando} onClick={() => entregar(p)}>
                          {guardando ? "Registrando…" : "Confirmar entrega"}
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
    </div>
  );
}
