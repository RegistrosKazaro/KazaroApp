// client/src/components/MovimientosDeposito.jsx
//
// Movimientos entre depósitos, con la misma forma que la planilla de Flexxus:
// tipo, número, fecha, depósito origen, depósito destino, responsable, total
// de artículos y observaciones. Se abre una fila y se ve su detalle.
//
// Cada servicio es un depósito del otro lado, así que lo que sale del central
// hacia un servicio es una SALIDA y lo que vuelve es una ENTRADA.
//
// Los datos salen de lo que ya pasó en el depósito —despachos y devoluciones—,
// no de la cola de Flexxus. Por eso la planilla sirve desde hoy. Cuando
// Flexxus se enganche, cada fila además muestra su número de comprobante; hasta
// entonces va en blanco, que es lo honesto: el movimiento pasó pero todavía no
// se informó.
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { formatNumber } from "../utils/format";
import { formatoFechaHoraAr } from "../utils/fechas";
import "../styles/admin-panel.css";
import "../styles/deposito.css";

const HOY = () => new Date().toISOString().slice(0, 10);
const HACE_UN_MES = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
};

const deposito = (d) =>
  !d?.codigo ? (d?.nombre || "—") : `${d.codigo} · ${d.nombre || ""}`.trim();

export default function MovimientosDeposito() {
  const [filtros, setFiltros] = useState({
    tipo: "", desde: HACE_UN_MES(), hasta: HOY(), deposito: "", q: "",
  });
  const [rows, setRows] = useState([]);
  const [resumen, setResumen] = useState({ total: 0, unidades: 0 });
  const [depositos, setDepositos] = useState([]);
  const [abierto, setAbierto] = useState(null);     // clave de la fila abierta
  const [detalle, setDetalle] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [err, setErr] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const { data } = await api.get("/deposito/movimientos", {
        params: {
          tipo: filtros.tipo || undefined,
          desde: filtros.desde || undefined,
          hasta: filtros.hasta || undefined,
          deposito: filtros.deposito || undefined,
          q: filtros.q || undefined,
          limit: 200,
        },
      });
      setRows(data?.rows ?? []);
      setResumen({ total: data?.total ?? 0, unidades: data?.unidades ?? 0 });
      setErr("");
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally { setCargando(false); }
  }, [filtros]);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    api.get("/deposito/movimientos/depositos")
      .then(({ data }) => setDepositos(data?.depositos ?? []))
      .catch(() => {});
  }, []);

  const abrir = async (fila) => {
    if (abierto === fila.clave) { setAbierto(null); setDetalle(null); return; }
    setAbierto(fila.clave);
    setDetalle(null);
    try {
      const { data } = await api.get(`/deposito/movimientos/${fila.clave}`);
      setDetalle(data);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    }
  };

  const cambiar = (campo) => (e) =>
    setFiltros((f) => ({ ...f, [campo]: e.target.value }));

  return (
    <section className="admin-panel deposito-page">
      <div className="dep-topbar">
        <h2 className="deposito-title">Movimientos entre depósitos</h2>
        <button type="button" className="pill pill--ghost" onClick={cargar} disabled={cargando}>
          {cargando ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      <p className="deposito-footnote">
        Cada servicio es un depósito. Lo que sale del central hacia un servicio es una
        salida; lo que vuelve, una entrada. El número de comprobante aparece cuando el
        movimiento se informa a Flexxus.
      </p>

      <div className="filters deposito-filters">
        <label className="deposito-field">
          <span>Tipo</span>
          <select className="deposito-select" value={filtros.tipo} onChange={cambiar("tipo")}>
            <option value="">Todos</option>
            <option value="salida">Salidas</option>
            <option value="entrada">Entradas</option>
          </select>
        </label>
        <label className="deposito-field">
          <span>Desde</span>
          <input type="date" value={filtros.desde} onChange={cambiar("desde")} />
        </label>
        <label className="deposito-field">
          <span>Hasta</span>
          <input type="date" value={filtros.hasta} onChange={cambiar("hasta")} />
        </label>
        <label className="deposito-field" style={{ minWidth: 220 }}>
          <span>Depósito</span>
          <select className="deposito-select" value={filtros.deposito} onChange={cambiar("deposito")}>
            <option value="">Todos</option>
            {depositos.map((d) => (
              <option key={d.codigo} value={d.codigo}>
                {d.codigo} · {d.nombre} ({d.movimientos})
              </option>
            ))}
          </select>
        </label>
        <label className="deposito-field" style={{ flex: "1 1 220px" }}>
          <span>Buscar</span>
          <input className="deposito-search" value={filtros.q} onChange={cambiar("q")}
            placeholder="N° de remito o servicio…"
            style={{ maxWidth: "none", width: "100%" }} />
        </label>
      </div>

      {err && <div className="state error deposito-state">{err}</div>}

      <div className="dep-order-kpis">
        <div className="dep-order-kpi dep-order-kpi--prep">
          <span className="dep-order-kpi-num">{formatNumber(resumen.total)}</span>
          <span className="dep-order-kpi-lbl">movimientos</span>
        </div>
        <div className="dep-order-kpi dep-order-kpi--open">
          <span className="dep-order-kpi-num">{formatNumber(resumen.unidades)}</span>
          <span className="dep-order-kpi-lbl">artículos movidos</span>
        </div>
      </div>

      <div className="deposito-table-wrapper">
        <table className="deposito-table" aria-label="Movimientos entre depósitos">
          <thead>
            <tr>
              <th scope="col">Tipo</th>
              <th scope="col">Número</th>
              <th scope="col">Fecha</th>
              <th scope="col">Depósito origen</th>
              <th scope="col">Depósito destino</th>
              <th scope="col">Responsable</th>
              <th scope="col" className="deposito-th--numeric">Artículos</th>
              <th scope="col">Observaciones</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && !cargando && (
              <tr><td colSpan={8} className="deposito-empty">
                No hay movimientos en ese rango.
              </td></tr>
            )}
            {rows.map((r) => [
              <tr key={r.clave}
                  className={`deposito-row${abierto === r.clave ? " deposito-row--expanded" : ""}`}
                  onClick={() => abrir(r)} style={{ cursor: "pointer" }}>
                <td>
                  <span className="deposito-code">{r.comprobante}</span>
                  <div className="deposito-subtext">
                    {r.tipo === "salida" ? "salida" : "entrada"}
                  </div>
                </td>
                <td>
                  {r.numeroMovimiento
                    ? <span className="deposito-code">{r.numeroMovimiento}</span>
                    : <span className="muted" title="Todavía no se informó a Flexxus">sin informar</span>}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>{formatoFechaHoraAr(r.fecha)}</td>
                <td className="deposito-service-name">{deposito(r.origen)}</td>
                <td className="deposito-service-name">
                  {deposito(r.destino)}
                  {r.sinDeposito && (
                    <div className="deposito-badge deposito-badge--warning">sin depósito</div>
                  )}
                </td>
                <td>{r.responsable || "—"}</td>
                <td className="deposito-td--numeric" style={{ fontWeight: 700 }}>
                  {formatNumber(r.unidades)}
                  <div className="deposito-subtext">{r.lineas} insumos</div>
                </td>
                <td><span className="deposito-code">{r.referencia}</span></td>
              </tr>,

              abierto === r.clave && (
                <tr key={`${r.clave}-det`} className="deposito-row--items-container">
                  <td colSpan={8}>
                    {!detalle ? (
                      <div className="deposito-state">Abriendo…</div>
                    ) : (
                      <>
                        <div className="deposito-items-title">
                          Detalle del movimiento {r.referencia} · {formatNumber(detalle.unidades)} artículos
                        </div>
                        <table className="deposito-items-table">
                          <thead>
                            <tr>
                              <th scope="col">Código</th>
                              <th scope="col">Descripción</th>
                              <th scope="col" className="deposito-th--numeric">Cantidad</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detalle.items.map((i, n) => (
                              <tr key={`${i.codigo || "s"}-${n}`}>
                                <td><span className="deposito-product-code">{i.codigo || "—"}</span></td>
                                <td>{i.nombre}</td>
                                <td className="deposito-td--numeric">{formatNumber(i.cantidad)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </td>
                </tr>
              ),
            ])}
          </tbody>
        </table>
      </div>
    </section>
  );
}
