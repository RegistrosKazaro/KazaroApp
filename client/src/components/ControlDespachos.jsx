// client/src/components/ControlDespachos.jsx
// Control de despachos: qué salió realmente del depósito (pedidos RETIRADOS),
// por artículo y con el detalle de qué servicio lo pidió. Sirve para cruzarlo a
// mano contra las salidas que se extraen de Flexxus; cuando el ERP se integre,
// la comparación se puede automatizar sobre estos mismos datos.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { formatMoney, formatNumber, csvNumber } from "../utils/format";
import useDebounced from "../hooks/useDebounced";
import "../styles/control-despachos.css";

const hoy = () => new Date().toISOString().slice(0, 10);
const primeroDelMes = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

export default function ControlDespachos() {
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState(hoy());
  const [q, setQ] = useState("");
  const qDeb = useDebounced(q, 250);

  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const [abierto, setAbierto] = useState(null);   // productId desplegado
  const [detalle, setDetalle] = useState([]);
  const [cargandoDet, setCargandoDet] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true); setError(""); setAbierto(null); setDetalle([]);
    try {
      const { data: d } = await api.get("/deposito/despachos", { params: { desde, hasta } });
      setData(d);
    } catch (e) {
      setError(e?.response?.data?.error || "No se pudieron cargar los despachos");
      setData(null);
    } finally { setCargando(false); }
  }, [desde, hasta]);

  useEffect(() => { cargar(); }, [cargar]);

  const abrir = async (art) => {
    if (abierto === art.productId) { setAbierto(null); setDetalle([]); return; }
    setAbierto(art.productId); setDetalle([]); setCargandoDet(true);
    try {
      const { data: d } = await api.get("/deposito/despachos", {
        params: { desde, hasta, productId: art.productId },
      });
      setDetalle(d?.detalle || []);
    } catch { setDetalle([]); }
    finally { setCargandoDet(false); }
  };

  const articulos = useMemo(() => {
    const t = qDeb.trim().toLowerCase();
    const lista = data?.articulos || [];
    if (!t) return lista;
    return lista.filter((a) =>
      String(a.nombre || "").toLowerCase().includes(t) ||
      String(a.codigo || "").toLowerCase().includes(t));
  }, [data, qDeb]);

  const totalFiltrado = useMemo(
    () => articulos.reduce((a, x) => a + x.unidades, 0), [articulos]);

  // CSV pensado para pegarlo al lado de la extracción de Flexxus en Excel.
  const exportar = async () => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const filas = [["Codigo", "Articulo", "Pedidos", "Unidades despachadas", "Monto"].map(esc).join(";")];
    for (const a of articulos) {
      filas.push([esc(a.codigo), esc(a.nombre), csvNumber(a.pedidos), csvNumber(a.unidades), csvNumber(a.monto)].join(";"));
    }
    const blob = new Blob(["﻿" + filas.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `despachos_${desde}_a_${hasta}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  const exportarDetalle = () => {
    if (!detalle.length) return;
    const art = articulos.find((x) => x.productId === abierto);
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const filas = [["Pedido", "Servicio", "Solicitante", "Cantidad", "Retirado"].map(esc).join(";")];
    for (const d of detalle) {
      filas.push([esc(d.numero), esc(d.servicio || "(administrativo)"), esc(d.solicitante),
        csvNumber(d.cantidad), esc(d.retiradoAr)].join(";"));
    }
    const blob = new Blob(["﻿" + filas.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `despachos_${(art?.codigo || abierto)}_${desde}_a_${hasta}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <section className="cd" aria-label="Control de despachos">
      <header className="cd-head">
        <div>
          <h2 className="cd-title">Control de despachos</h2>
          <p className="cd-sub">
            Lo que realmente salió del depósito: sólo pedidos <strong>retirados</strong>, que son los
            mismos que alimentan los informes. Las cantidades ya vienen netas de devoluciones
            aprobadas. Exportá el listado y cruzalo contra las salidas de Flexxus.
          </p>
        </div>
      </header>

      <div className="cd-filtros">
        <label className="cd-field"><span>Desde (fecha de retiro)</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="cd-field"><span>Hasta</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <input className="cd-search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar artículo por código o descripción…" />
        <button type="button" className="cd-btn" onClick={exportar} disabled={!articulos.length}>
          Exportar CSV
        </button>
      </div>

      {error && <div className="state error">{error}</div>}
      {cargando && <div className="cd-vacio">Cargando despachos…</div>}

      {!cargando && data && (
        <>
          <div className="cd-kpis">
            <div className="cd-kpi"><span className="cd-kpi-n">{formatNumber(articulos.length)}</span><span>artículos</span></div>
            <div className="cd-kpi"><span className="cd-kpi-n">{formatNumber(totalFiltrado)}</span><span>unidades despachadas</span></div>
            <div className="cd-kpi"><span className="cd-kpi-n">{formatNumber(data.totales?.pedidos)}</span><span>pedidos retirados</span></div>
          </div>

          {articulos.length === 0 ? (
            <div className="cd-vacio">
              {q ? "No hay artículos que coincidan con la búsqueda." : "No hubo despachos en este período."}
            </div>
          ) : (
            <div className="cd-tabla-wrap">
              <table className="cd-tabla">
                <thead>
                  <tr>
                    <th>Código</th><th>Artículo</th>
                    <th className="num">Pedidos</th><th className="num">Unidades</th>
                    <th className="num">Monto</th><th style={{ width: 130 }} />
                  </tr>
                </thead>
                <tbody>
                  {articulos.map((a) => (
                    <Fragment key={a.productId}>
                      <tr className={abierto === a.productId ? "is-abierto" : ""}>
                        <td className="mono">{a.codigo || "—"}</td>
                        <td>{a.nombre}</td>
                        <td className="num">{formatNumber(a.pedidos)}</td>
                        <td className="num cd-fuerte">{formatNumber(a.unidades)}</td>
                        <td className="num">{formatMoney(a.monto)}</td>
                        <td className="num">
                          <button type="button" className="cd-btn-ghost" onClick={() => abrir(a)}>
                            {abierto === a.productId ? "Ocultar" : "Ver detalle"}
                          </button>
                        </td>
                      </tr>
                      {abierto === a.productId && (
                        <tr className="cd-fila-detalle">
                          <td colSpan={6}>
                            {cargandoDet ? <div className="cd-vacio">Cargando detalle…</div> : (
                              <div className="cd-detalle">
                                <div className="cd-detalle-head">
                                  <strong>Quién pidió este artículo</strong>
                                  <button type="button" className="cd-btn-ghost" onClick={exportarDetalle}>
                                    Exportar detalle
                                  </button>
                                </div>
                                <table className="cd-tabla cd-tabla--interna">
                                  <thead>
                                    <tr>
                                      <th>Pedido</th><th>Servicio</th><th>Solicitante</th>
                                      <th className="num">Cantidad</th><th>Retirado</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detalle.map((d) => (
                                      <tr key={d.pedidoId}>
                                        <td className="mono">#{d.numero}</td>
                                        <td>{d.servicio || <em className="cd-admin">Sin servicio (administrativo)</em>}</td>
                                        <td>{d.solicitante || "—"}</td>
                                        <td className="num cd-fuerte">
                                          {formatNumber(d.cantidad)}
                                          {d.devuelto > 0 && (
                                            <span className="cd-dev"> (pidió {d.cantidadOriginal}, devolvió {d.devuelto})</span>
                                          )}
                                        </td>
                                        <td>{d.retiradoAr || "—"}</td>
                                      </tr>
                                    ))}
                                    <tr className="cd-total-row">
                                      <td colSpan={3}>Total despachado</td>
                                      <td className="num">{formatNumber(detalle.reduce((s, d) => s + d.cantidad, 0))}</td>
                                      <td />
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="cd-pie">
            Período tomado por <strong>fecha de retiro</strong> (cuando el material salió), que es lo
            que corresponde cruzar contra el ERP — no la fecha en que se hizo el pedido.
          </p>
        </>
      )}
    </section>
  );
}
