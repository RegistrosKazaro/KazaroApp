// client/src/pages/Informes.jsx
//
// Informes: quién pidió más, qué se pidió más y cuánto se devolvió.
//
// Todo sale de un solo endpoint (/reports/panel), que calcula los montos
// sumando los ítems netos de devoluciones y de lo que quedó pendiente. Por eso
// los números cierran entre sí: el total es igual a la suma de los servicios,
// que es igual a la suma de los insumos.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { formatMoney, formatNumber } from "../utils/format";
import { normalizeText } from "../utils/text";
import "../styles/informes.css";

/* ── Períodos ──────────────────────────────────────────────────── */
const dia = (d) => d.toISOString().slice(0, 10);
/** Hoy en Argentina (la base guarda UTC; Argentina es UTC-3). */
const hoyAr = () => new Date(Date.now() - 3 * 3600 * 1000);

function periodos() {
  const h = hoyAr();
  const y = h.getUTCFullYear(), m = h.getUTCMonth();
  const primero = (yy, mm) => dia(new Date(Date.UTC(yy, mm, 1)));
  const ultimo = (yy, mm) => dia(new Date(Date.UTC(yy, mm + 1, 0)));
  return {
    mes: { label: "Este mes", desde: primero(y, m), hasta: dia(h) },
    anterior: { label: "Mes pasado", desde: primero(y, m - 1), hasta: ultimo(y, m - 1) },
    tres: { label: "Últimos 3 meses", desde: primero(y, m - 2), hasta: dia(h) },
    anio: { label: "Este año", desde: primero(y, 0), hasta: dia(h) },
  };
}

const fechaCorta = (aaaammdd) => {
  const [a, m, d] = String(aaaammdd || "").split("-");
  return d ? `${d}/${m}/${a}` : aaaammdd;
};
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mesLabel = (aaaamm) => {
  const [a, m] = String(aaaamm || "").split("-");
  return m ? `${MESES_CORTOS[Number(m) - 1]} ${String(a).slice(2)}` : aaaamm;
};

/* ── Piezas visuales ───────────────────────────────────────────── */

function Kpi({ label, valor, detalle, destacado }) {
  return (
    <div className={`inf-kpi${destacado ? " is-main" : ""}`}>
      <div className="inf-kpi-label">{label}</div>
      <div className="inf-kpi-valor">{valor}</div>
      {detalle && <div className="inf-kpi-detalle">{detalle}</div>}
    </div>
  );
}

/** Evolución mes a mes. Sólo aparece si el período abarca más de un mes. */
function Evolucion({ datos, metrica }) {
  if (!datos || datos.length < 2) return null;
  const valor = (d) => (metrica === "monto" ? d.monto : d.unidades);
  const max = Math.max(...datos.map(valor), 1);
  return (
    <section className="inf-card">
      <h3 className="inf-card-titulo">Mes a mes</h3>
      <div className="inf-evolucion">
        {datos.map((d) => {
          const v = valor(d);
          return (
            <div key={d.mes} className="inf-mes" title={`${mesLabel(d.mes)}: ${metrica === "monto" ? formatMoney(d.monto) : formatNumber(d.unidades) + " unidades"} · ${d.pedidos} pedidos`}>
              <div className="inf-mes-barra-fondo">
                <div className="inf-mes-barra" style={{ height: `${Math.max(3, (v / max) * 100)}%` }} />
              </div>
              <div className="inf-mes-valor">{metrica === "monto" ? formatMoney(d.monto) : formatNumber(d.unidades)}</div>
              <div className="inf-mes-label">{mesLabel(d.mes)}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Un ranking: barras ordenadas de mayor a menor, con buscador y "ver todos".
 * Se usa igual para servicios, insumos y supervisores.
 */
function Ranking({ titulo, ayuda, filas, metrica, columnas, onFila, vacio, idPrefijo }) {
  const [q, setQ] = useState("");
  const [todos, setTodos] = useState(false);
  const TOPE = 8;

  const valor = useCallback((f) => (metrica === "monto" ? f.monto : f.unidades), [metrica]);
  const filtradas = useMemo(() => {
    const t = normalizeText(q);
    const arr = t ? filas.filter((f) => normalizeText(f.nombre).includes(t) || normalizeText(f.codigo).includes(t)) : filas;
    return [...arr].sort((a, b) => valor(b) - valor(a));
  }, [filas, q, valor]);

  const visibles = todos || q ? filtradas : filtradas.slice(0, TOPE);
  const max = Math.max(...filtradas.map(valor), 1);
  const total = filtradas.reduce((a, f) => a + valor(f), 0);

  const exportar = () => {
    const cab = ["#", "Nombre", "Monto", "Unidades", ...columnas.map((c) => c.label)];
    const filasCsv = filtradas.map((f, i) => [i + 1, f.nombre, Math.round(f.monto), f.unidades, ...columnas.map((c) => c.valor(f))]);
    const csv = [cab, ...filasCsv].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `${idPrefijo}.csv`;
    a.click();
  };

  return (
    <section className="inf-card">
      <div className="inf-card-head">
        <div>
          <h3 className="inf-card-titulo">{titulo}</h3>
          {ayuda && <p className="inf-card-ayuda">{ayuda}</p>}
        </div>
        <div className="inf-card-acciones">
          {filas.length > TOPE && (
            <input className="inf-buscar" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" />
          )}
          <button type="button" className="inf-btn" onClick={exportar} disabled={!filtradas.length}>Exportar</button>
        </div>
      </div>

      {!filtradas.length ? (
        <div className="inf-vacio">{q ? `Nada coincide con “${q}”.` : vacio}</div>
      ) : (
        <>
          <ol className="inf-lista">
            {visibles.map((f, i) => {
              const v = valor(f);
              const pct = total ? (v / total) * 100 : 0;
              return (
                <li key={f.id ?? i} className={`inf-fila${onFila ? " is-clickable" : ""}`}
                  onClick={onFila ? () => onFila(f) : undefined}
                  role={onFila ? "button" : undefined} tabIndex={onFila ? 0 : undefined}
                  onKeyDown={onFila ? (e) => { if (e.key === "Enter") onFila(f); } : undefined}>
                  <span className="inf-pos">{filtradas.indexOf(f) + 1}</span>
                  <div className="inf-fila-cuerpo">
                    <div className="inf-fila-top">
                      <span className="inf-nombre" title={f.nombre}>
                        {f.codigo ? <span className="inf-codigo">{f.codigo}</span> : null}{f.nombre}
                      </span>
                      <span className="inf-valor">
                        {metrica === "monto" ? formatMoney(f.monto) : `${formatNumber(f.unidades)} u.`}
                      </span>
                    </div>
                    <div className="inf-barra-fondo">
                      <div className="inf-barra" style={{ width: `${Math.max(1, (v / max) * 100)}%` }} />
                    </div>
                    <div className="inf-fila-pie">
                      <span>{pct.toFixed(1)}% del total</span>
                      {columnas.map((c) => <span key={c.label}>{c.valor(f)} {c.label}</span>)}
                      <span className="inf-secundario">
                        {metrica === "monto" ? `${formatNumber(f.unidades)} unidades` : formatMoney(f.monto)}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          {!q && filtradas.length > TOPE && (
            <button type="button" className="inf-vermas" onClick={() => setTodos((v) => !v)}>
              {todos ? "Ver sólo los primeros 8" : `Ver los ${filtradas.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/* ── Pantalla ──────────────────────────────────────────────────── */

export default function Informes() {
  const P = useMemo(periodos, []);
  const [rango, setRango] = useState(P.mes);
  const [personalizado, setPersonalizado] = useState(false);
  const [modo, setModo] = useState("insumos");
  const [metrica, setMetrica] = useState("monto");
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [err, setErr] = useState("");
  const [servicioAbierto, setServicioAbierto] = useState(null);

  useEffect(() => {
    let vivo = true;
    setCargando(true); setErr("");
    api.get("/reports/panel", { params: { desde: rango.desde, hasta: rango.hasta, modo } })
      .then(({ data }) => { if (vivo) setData(data); })
      .catch((e) => { if (vivo) setErr(e?.response?.data?.error || "No se pudo cargar el informe"); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [rango.desde, rango.hasta, modo]);

  const k = data?.kpis;
  const dev = data?.devoluciones;
  const elegirPeriodo = (p) => { setPersonalizado(false); setRango(p); setServicioAbierto(null); };
  const detalleServicio = servicioAbierto ? (data?.insumosPorServicio?.[servicioAbierto.id] || []) : [];

  return (
    <div className="informes">
      <header className="inf-head">
        <div>
          <h2>Informes</h2>
          <p className="inf-sub">
            {fechaCorta(rango.desde)} al {fechaCorta(rango.hasta)} ·{" "}
            {modo === "uniformes" ? "uniformes" : "insumos"} · pedidos ya retirados
          </p>
        </div>
        <Link className="inf-link" to="/app/admin/reports/completo">Informe clásico</Link>
      </header>

      {/* Filtros: período, qué se mira y en qué unidad */}
      <div className="inf-filtros">
        <div className="inf-grupo">
          {Object.entries(P).map(([clave, p]) => (
            <button key={clave} type="button"
              className={`inf-chip${!personalizado && rango.desde === p.desde && rango.hasta === p.hasta ? " is-on" : ""}`}
              onClick={() => elegirPeriodo(p)}>{p.label}</button>
          ))}
          <button type="button" className={`inf-chip${personalizado ? " is-on" : ""}`}
            onClick={() => setPersonalizado((v) => !v)}>Otro período</button>
        </div>

        {personalizado && (
          <div className="inf-grupo">
            <label className="inf-fecha">Desde
              <input type="date" value={rango.desde} max={rango.hasta}
                onChange={(e) => setRango((r) => ({ ...r, label: "Personalizado", desde: e.target.value }))} />
            </label>
            <label className="inf-fecha">Hasta
              <input type="date" value={rango.hasta} min={rango.desde}
                onChange={(e) => setRango((r) => ({ ...r, label: "Personalizado", hasta: e.target.value }))} />
            </label>
          </div>
        )}

        <div className="inf-grupo inf-grupo--der">
          <div className="inf-toggle">
            <button type="button" className={modo === "insumos" ? "is-on" : ""} onClick={() => setModo("insumos")}>Insumos</button>
            <button type="button" className={modo === "uniformes" ? "is-on" : ""} onClick={() => setModo("uniformes")}>Uniformes</button>
          </div>
          <div className="inf-toggle">
            <button type="button" className={metrica === "monto" ? "is-on" : ""} onClick={() => setMetrica("monto")}>Por $</button>
            <button type="button" className={metrica === "unidades" ? "is-on" : ""} onClick={() => setMetrica("unidades")}>Por cantidad</button>
          </div>
        </div>
      </div>

      {err && <div className="inf-error">{err}</div>}
      {cargando && <div className="inf-cargando">Cargando…</div>}

      {!cargando && data && (
        <>
          <div className="inf-kpis">
            <Kpi destacado label="Total del período" valor={formatMoney(k.monto)} detalle={`${formatNumber(k.unidades)} unidades`} />
            <Kpi label="Pedidos" valor={formatNumber(k.pedidos)} detalle={`${formatMoney(k.promedioPorPedido)} por pedido`} />
            <Kpi label="Servicios que pidieron" valor={formatNumber(k.servicios)} />
            <Kpi label="Insumos distintos" valor={formatNumber(k.insumos)} />
            <Kpi label="Devoluciones aprobadas" valor={formatNumber(dev.aprobadas)}
              detalle={dev.aprobadas ? `${formatMoney(dev.monto)} · ${formatNumber(dev.unidades)} u.` : "ninguna en el período"} />
          </div>

          {data.sinRetirar?.pedidos > 0 && (
            <div className="inf-aviso">
              <strong>Faltan {formatNumber(data.sinRetirar.pedidos)} pedidos por marcar como retirados</strong> ({formatMoney(data.sinRetirar.monto)}).
              No entran en estos números: un pedido se cuenta recién cuando se retira. Están en Depósito → “Listos para retirar”.
            </div>
          )}

          <Evolucion datos={data.evolucion} metrica={metrica} />

          <Ranking
            titulo="Servicios que más pidieron"
            ayuda="Tocá un servicio para ver qué insumos pidió."
            filas={data.servicios} metrica={metrica} idPrefijo="servicios"
            columnas={[{ label: "pedidos", valor: (f) => f.pedidos }, { label: "insumos", valor: (f) => f.insumos }]}
            onFila={(f) => setServicioAbierto(f)}
            vacio="Ningún servicio pidió en este período."
          />

          {servicioAbierto && (
            <section className="inf-card inf-detalle">
              <div className="inf-card-head">
                <div>
                  <h3 className="inf-card-titulo">{servicioAbierto.nombre}</h3>
                  <p className="inf-card-ayuda">
                    {formatMoney(servicioAbierto.monto)} · {formatNumber(servicioAbierto.unidades)} unidades ·{" "}
                    {servicioAbierto.pedidos} pedidos
                  </p>
                </div>
                <button type="button" className="inf-btn" onClick={() => setServicioAbierto(null)}>Cerrar</button>
              </div>
              <table className="inf-tabla">
                <thead><tr><th>Código</th><th>Insumo</th><th className="num">Cantidad</th><th className="num">Monto</th></tr></thead>
                <tbody>
                  {detalleServicio.map((it) => (
                    <tr key={it.id}>
                      <td className="mono">{it.codigo}</td>
                      <td>{it.nombre}</td>
                      <td className="num">{formatNumber(it.unidades)}</td>
                      <td className="num">{formatMoney(it.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <Ranking
            titulo="Insumos más pedidos"
            ayuda="Sumando todos los servicios del período."
            filas={data.insumos} metrica={metrica} idPrefijo="insumos"
            columnas={[{ label: "servicios", valor: (f) => f.servicios }, { label: "pedidos", valor: (f) => f.pedidos }]}
            vacio="No hay insumos en este período."
          />

          <Ranking
            titulo="Quién más pidió"
            ayuda="El supervisor o administrativo que generó el pedido."
            filas={data.supervisores} metrica={metrica} idPrefijo="supervisores"
            columnas={[{ label: "pedidos", valor: (f) => f.pedidos }, { label: "servicios", valor: (f) => f.servicios }]}
            vacio="Nadie generó pedidos en este período."
          />

          <section className="inf-card">
            <div className="inf-card-head">
              <div>
                <h3 className="inf-card-titulo">Devoluciones</h3>
                <p className="inf-card-ayuda">
                  Las hechas en el período. El descuento va al pedido original, así que ya está restado de los montos de arriba.
                </p>
              </div>
            </div>
            <div className="inf-dev-kpis">
              <div className="inf-dev-kpi is-ok"><span>{formatNumber(dev.aprobadas)}</span>aprobadas</div>
              <div className="inf-dev-kpi is-wait"><span>{formatNumber(dev.pendientes)}</span>a aprobar</div>
              <div className="inf-dev-kpi is-no"><span>{formatNumber(dev.rechazadas)}</span>rechazadas</div>
              <div className="inf-dev-kpi"><span>{formatNumber(dev.unidades)}</span>unidades devueltas</div>
              <div className="inf-dev-kpi"><span>{formatMoney(dev.monto)}</span>en dinero</div>
            </div>

            {dev.topInsumos.length > 0 && (
              <div className="inf-dev-cols">
                <div>
                  <h4>Insumos más devueltos</h4>
                  <table className="inf-tabla">
                    <thead><tr><th>Insumo</th><th className="num">Unid.</th><th className="num">Monto</th></tr></thead>
                    <tbody>
                      {dev.topInsumos.map((d) => (
                        <tr key={d.id}><td>{d.nombre || `#${d.id}`}</td><td className="num">{formatNumber(d.unidades)}</td><td className="num">{formatMoney(d.monto)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <h4>Servicios que más devolvieron</h4>
                  <table className="inf-tabla">
                    <thead><tr><th>Servicio</th><th className="num">Devol.</th><th className="num">Unid.</th></tr></thead>
                    <tbody>
                      {dev.topServicios.map((d, i) => (
                        <tr key={i}><td>{d.nombre}</td><td className="num">{formatNumber(d.cantidad)}</td><td className="num">{formatNumber(d.unidades)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {!dev.total && <div className="inf-vacio">No hubo devoluciones en este período.</div>}
          </section>

          <p className="inf-pie">
            Los montos se calculan sumando los insumos de cada pedido, ya descontadas las devoluciones aprobadas y
            lo que quedó pendiente de entregar. Por eso el total es siempre igual a la suma de los servicios, de los
            insumos y de quienes pidieron.
          </p>
        </>
      )}
    </div>
  );
}
