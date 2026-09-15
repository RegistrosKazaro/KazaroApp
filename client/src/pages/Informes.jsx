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

/* ── Gráficos ──────────────────────────────────────────────────── */

/** Escala "linda" para el eje: 0, 1/4, 1/2, 3/4 y el máximo redondeado. */
function escala(max) {
  if (!Number.isFinite(max) || max <= 0) return { tope: 1, marcas: [0, 1] };
  const paso = Math.pow(10, Math.floor(Math.log10(max)));
  const tope = Math.ceil(max / (paso / 2)) * (paso / 2);
  return { tope, marcas: [0, 0.25, 0.5, 0.75, 1].map((f) => tope * f) };
}

const corto = (n) => {
  const v = Math.abs(n);
  if (v >= 1e6) return `${(n / 1e6).toFixed(1).replace(".0", "")}M`;
  if (v >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(Math.round(n));
};

/**
 * Línea de tendencia con ejes y grilla. La curva se suaviza con una
 * interpolación monótona: se ve redondeada pero nunca inventa subidas ni
 * bajadas que los datos no tengan.
 */
function LineaTendencia({ datos, etiqueta, valor, titulo, ayuda, formato }) {
  if (!datos || datos.length < 2) return null;
  const W = 820, H = 170, IZQ = 54, DER = 14, ARR = 14, ABA = 26;
  const ancho = W - IZQ - DER, alto = H - ARR - ABA;
  const vals = datos.map(valor);
  const { tope, marcas } = escala(Math.max(...vals));
  const x = (i) => IZQ + (datos.length === 1 ? ancho / 2 : (i * ancho) / (datos.length - 1));
  const y = (v) => ARR + alto - (v / tope) * alto;
  const puntos = datos.map((d, i) => [x(i), y(valor(d))]);

  // Tangentes monótonas (Fritsch–Carlson simplificado): sin sobrepasos.
  const d = puntos.map((p, i) => {
    if (i === 0 || i === puntos.length - 1) return 0;
    const [x0, y0] = puntos[i - 1], [x1, y1] = puntos[i + 1];
    const izq = (puntos[i][1] - y0) / (puntos[i][0] - x0 || 1);
    const der = (y1 - puntos[i][1]) / (x1 - puntos[i][0] || 1);
    return izq * der <= 0 ? 0 : (izq + der) / 2;
  });
  let path = `M ${puntos[0][0]} ${puntos[0][1]}`;
  for (let i = 0; i < puntos.length - 1; i++) {
    const [x0, y0] = puntos[i], [x1, y1] = puntos[i + 1];
    const dx = (x1 - x0) / 4;   // curva suave pero sin exagerar las ondas
    path += ` C ${x0 + dx} ${y0 + d[i] * dx}, ${x1 - dx} ${y1 - d[i + 1] * dx}, ${x1} ${y1}`;
  }
  const area = `${path} L ${puntos.at(-1)[0]} ${ARR + alto} L ${puntos[0][0]} ${ARR + alto} Z`;
  const cadaCuantos = Math.ceil(datos.length / 6);

  return (
    <section className="inf-card">
      <h3 className="inf-card-titulo">{titulo}</h3>
      {ayuda && <p className="inf-card-ayuda">{ayuda}</p>}
      <svg className="inf-grafico" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={titulo}>
        <defs>
          <linearGradient id="infArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
          </linearGradient>
        </defs>
        {marcas.map((m, i) => (
          <g key={i}>
            <line x1={IZQ} y1={y(m)} x2={W - DER} y2={y(m)} stroke="#e5e7eb" strokeDasharray={i ? "3 4" : ""} />
            <text x={IZQ - 8} y={y(m) + 4} textAnchor="end" className="inf-eje">{corto(m)}</text>
          </g>
        ))}
        <path d={area} fill="url(#infArea)" />
        <path d={path} fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" className="inf-linea" />
        {puntos.map(([px, py], i) => (
          <g key={i}>
            <circle cx={px} cy={py} r="3.5" fill="#fff" stroke="#2563eb" strokeWidth="2" />
            <title>{`${etiqueta(datos[i])}: ${formato(valor(datos[i]))} · ${datos[i].pedidos} pedidos`}</title>
          </g>
        ))}
        {datos.map((dd, i) => (i % cadaCuantos === 0 || i === datos.length - 1 ? (
          <text key={i} x={x(i)} y={H - 9} textAnchor="middle" className="inf-eje">{etiqueta(dd)}</text>
        ) : null))}
      </svg>
    </section>
  );
}

/**
 * Barras horizontales con eje. Van en HTML y no en SVG a propósito: así el
 * nombre del insumo o del servicio se muestra COMPLETO, partido en dos
 * renglones si hace falta, en vez de recortado con puntos suspensivos.
 */
function BarrasHorizontales({ datos, metrica, titulo, ayuda, formato, cuantas = 8 }) {
  if (!datos?.length) return null;
  const valor = (d) => (metrica === "monto" ? d.monto : d.unidades);
  const top = [...datos].sort((a, b) => valor(b) - valor(a)).slice(0, cuantas);
  const { tope, marcas } = escala(Math.max(...top.map(valor)));
  const COLORES = ["#1d4ed8", "#0ea5e9", "#0d9488", "#16a34a", "#65a30d", "#d97706", "#ea580c", "#dc2626"];

  return (
    <section className="inf-card">
      <h3 className="inf-card-titulo">{titulo}</h3>
      {ayuda && <p className="inf-card-ayuda">{ayuda}</p>}
      <div className="inf-barras">
        {top.map((d, i) => (
          <div key={d.id ?? i} className="inf-barra-fila" title={`${d.nombre}: ${formato(valor(d))}`}>
            <div className="inf-barra-nombre">
              {d.codigo ? <span className="inf-codigo">{d.codigo}</span> : null}{d.nombre}
            </div>
            <div className="inf-barra-pista">
              <div className="inf-barra-color" style={{ width: `${Math.max(1.5, (valor(d) / tope) * 100)}%`, background: COLORES[i % COLORES.length] }} />
              <span className="inf-barra-valor">{formato(valor(d))}</span>
            </div>
          </div>
        ))}
        <div className="inf-eje-x">
          {marcas.map((m, i) => <span key={i}>{corto(m)}</span>)}
        </div>
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
  const [bajando, setBajando] = useState(false);

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
  const exportarExcel = async () => {
    setBajando(true);
    try {
      const { data: blob } = await api.get("/reports/panel/excel", {
        params: { desde: rango.desde, hasta: rango.hasta, modo }, responseType: "blob",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `informe_${modo}_${rango.desde}_a_${rango.hasta}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setErr("No se pudo generar el Excel");
    } finally { setBajando(false); }
  };

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
        <div className="inf-head-acciones">
          <button type="button" className="inf-btn inf-btn--excel" onClick={exportarExcel} disabled={bajando || cargando}>
            {bajando ? "Generando…" : "Exportar a Excel"}
          </button>
          <Link className="inf-link" to="/app/admin/reports/completo">Informe clásico</Link>
        </div>
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

          {(() => {
            // Con pocas semanas se muestra semana a semana, que es más fino;
            // con muchas, mes a mes, para que no quede ilegible.
            const semanal = data.tendencia?.length >= 3 && data.tendencia.length <= 30;
            const serie = semanal ? data.tendencia : data.evolucion;
            return (
              <LineaTendencia
                datos={serie}
                titulo={semanal ? "Cómo viene, semana a semana" : "Cómo viene, mes a mes"}
                ayuda={semanal ? "Cada punto es una semana, de lunes a domingo." : null}
                etiqueta={(d) => (semanal ? fechaCorta(d.semana).slice(0, 5) : mesLabel(d.mes))}
                valor={(d) => (metrica === "monto" ? d.monto : d.unidades)}
                formato={(v) => (metrica === "monto" ? formatMoney(v) : `${formatNumber(v)} u.`)}
              />
            );
          })()}

          <BarrasHorizontales
            datos={data.servicios} metrica={metrica}
            titulo="Los 8 servicios que más pidieron"
            formato={(v) => (metrica === "monto" ? formatMoney(v) : `${formatNumber(v)} u.`)}
          />

          <BarrasHorizontales
            datos={data.insumos} metrica={metrica}
            titulo="Los 8 insumos más pedidos"
            formato={(v) => (metrica === "monto" ? formatMoney(v) : `${formatNumber(v)} u.`)}
          />

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
