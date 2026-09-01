// client/src/components/ControlDespachos.jsx
// Control de despachos: qué salió realmente del depósito (pedidos RETIRADOS),
// por artículo y con el detalle de qué servicio lo pidió. Sirve para cruzarlo a
// mano contra las salidas que se extraen de Flexxus; cuando el ERP se integre,
// la comparación se puede automatizar sobre estos mismos datos.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { formatMoney, formatNumber, csvNumber } from "../utils/format";
import useDebounced from "../hooks/useDebounced";
import { normalizeText } from "../utils/text";
import "../styles/control-despachos.css";

// Fechas en día ARGENTINO. Con toISOString() se tomaba el día UTC, que después
// de las 21:00 ya es el día siguiente.
const diaAr = (d = new Date()) =>
  d.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Cordoba" });

const hoy = () => diaAr();

// Arranca mostrando los últimos 30 días. Antes empezaba el 1° del mes: el día 1
// el rango era un solo día y no se veía nada de lo despachado los días previos.
const hace30Dias = () => {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return diaAr(d);
};

export default function ControlDespachos() {
  const [desde, setDesde] = useState(hace30Dias());
  const [hasta, setHasta] = useState(hoy());
  const [q, setQ] = useState("");
  const qDeb = useDebounced(q, 250);

  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const [abierto, setAbierto] = useState(null);   // productId desplegado
  const [detalle, setDetalle] = useState([]);
  const [cargandoDet, setCargandoDet] = useState(false);
  // El detalle se ordena por fecha (no por cantidad). Se puede invertir.
  const [ordenDet, setOrdenDet] = useState("fecha_desc");

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

  const traerDetalle = useCallback(async (productId, orden) => {
    setCargandoDet(true);
    try {
      const { data: d } = await api.get("/deposito/despachos", {
        params: { desde, hasta, productId, orden },
      });
      setDetalle(d?.detalle || []);
    } catch { setDetalle([]); }
    finally { setCargandoDet(false); }
  }, [desde, hasta]);

  const abrir = async (art) => {
    if (abierto === art.productId) { setAbierto(null); setDetalle([]); return; }
    setAbierto(art.productId); setDetalle([]);
    await traerDetalle(art.productId, ordenDet);
  };

  const cambiarOrden = async (nuevo) => {
    setOrdenDet(nuevo);
    if (abierto) await traerDetalle(abierto, nuevo);
  };

  const articulos = useMemo(() => {
    // normalizeText saca acentos, así "algodon" encuentra "ALGODÓN".
    const t = normalizeText(qDeb);
    const lista = data?.articulos || [];
    if (!t) return lista;
    return lista.filter((a) =>
      normalizeText(a.nombre).includes(t) || normalizeText(a.codigo).includes(t));
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
    const filas = [["Pedido", "Servicio", "Solicitante", "Cantidad", "Listo para retirar"].map(esc).join(";")];
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
            Muestra el detalle <strong>tal como estaba al marcarse listo para retirar</strong>, que
            es el movimiento que quedó en Flexxus. Si después se edita el pedido, este listado no
            cambia (se avisa al lado de la cantidad). Cada pedido va en su propia fila, ordenado por
            fecha.
          </p>
        </div>
      </header>

      <div className="cd-filtros">
        <label className="cd-field"><span>Desde (listo para retirar)</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="cd-field"><span>Hasta</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <div className="cd-atajos" role="group" aria-label="Períodos rápidos">
          {[
            ["Hoy", () => [hoy(), hoy()]],
            ["Últimos 7 días", () => [diaAr(new Date(Date.now() - 6 * 864e5)), hoy()]],
            ["Últimos 30 días", () => [hace30Dias(), hoy()]],
            ["Mes pasado", () => {
              const d = new Date();
              const ini = new Date(d.getFullYear(), d.getMonth() - 1, 1);
              const fin = new Date(d.getFullYear(), d.getMonth(), 0);
              return [diaAr(ini), diaAr(fin)];
            }],
          ].map(([etiqueta, calc]) => (
            <button key={etiqueta} type="button" className="cd-btn-ghost"
              onClick={() => { const [a, b] = calc(); setDesde(a); setHasta(b); }}>
              {etiqueta}
            </button>
          ))}
        </div>

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
            <div className="cd-kpi"><span className="cd-kpi-n">{formatNumber(data.totales?.pedidos)}</span><span>pedidos despachados</span></div>
          </div>

          {articulos.length === 0 ? (
            <div className="cd-vacio">
              {q ? "No hay artículos que coincidan con la búsqueda." : (
                <>
                  No hubo despachos entre el {desde} y el {hasta}.
                  <br />
                  <span style={{ fontSize: "0.85rem" }}>
                    Probá ampliar el período con los botones de arriba.
                  </span>
                </>
              )}
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
                                  <div className="cd-detalle-acciones">
                                    <label className="cd-orden">
                                      <span>Ordenar por fecha</span>
                                      <select value={ordenDet} onChange={(e) => cambiarOrden(e.target.value)}>
                                        <option value="fecha_desc">Más reciente primero</option>
                                        <option value="fecha_asc">Más antiguo primero</option>
                                      </select>
                                    </label>
                                    <button type="button" className="cd-btn-ghost" onClick={exportarDetalle}>
                                      Exportar detalle
                                    </button>
                                  </div>
                                </div>
                                <table className="cd-tabla cd-tabla--interna">
                                  <thead>
                                    <tr>
                                      <th>Pedido</th><th>Servicio</th><th>Solicitante</th>
                                      <th className="col-cant">Cantidad</th><th>Listo para retirar</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detalle.map((d) => (
                                      <tr key={d.pedidoId}>
                                        <td className="mono">#{d.numero}</td>
                                        <td>{d.servicio || <em className="cd-admin">Sin servicio (administrativo)</em>}</td>
                                        <td>{d.solicitante || "—"}</td>
                                        <td className="col-cant cd-fuerte">
                                          {formatNumber(d.cantidad)}
                                          {d.corregido && (
                                            <span className="cd-editado"
                                              title={`Al despachar se había registrado ${formatNumber(d.cantidadInicial)} y el depósito lo corrigió a ${formatNumber(d.cantidad)}. Se muestra la corrección, que es lo que realmente salió.`}>
                                              corregido (era {formatNumber(d.cantidadInicial)})
                                            </span>
                                          )}
                                        </td>
                                        <td>{d.retiradoAr || "—"}</td>
                                      </tr>
                                    ))}
                                    <tr className="cd-total-row">
                                      <td colSpan={3}>Total despachado</td>
                                      <td className="col-cant">{formatNumber(detalle.reduce((s, d) => s + d.cantidad, 0))}</td>
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
            El período se toma por la fecha en que el pedido pasó a <strong>listo para retirar</strong>,
            no por la fecha en que se hizo el pedido: ese es el momento que coincide con el
            movimiento en Flexxus.
          </p>
        </>
      )}
    </section>
  );
}
