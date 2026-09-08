// client/src/components/Trazabilidad.jsx
//
// La vida completa de cada pedido: qué pidió el supervisor, qué ajustó el
// depósito, qué salió, qué quedó pendiente y qué se devolvió.
//
// La unidad es el PEDIDO: rastrear un pedido es más directo que perseguir un
// insumo entre cientos. Y por defecto se muestran sólo los que tienen alguna
// diferencia, porque la mayoría cierra parejo y enterraría a los que importan.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { formatMoney, formatNumber, csvNumber } from "../utils/format";
import { normalizeText } from "../utils/text";
import useDebounced from "../hooks/useDebounced";
import "../styles/trazabilidad.css";

// Fechas en día argentino: con toISOString() se toma el día UTC, que después
// de las 21:00 ya es el siguiente.
const diaAr = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Cordoba" });
const hoy = () => diaAr();
const haceDias = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return diaAr(d); };

/** Un número que no aporta (cero) se muestra como guion, para que salten los que sí. */
function Num({ v, destacado = false, color }) {
  if (!v) return <span className="tz-nada">—</span>;
  return <span style={{ fontWeight: destacado ? 700 : 400, color }}>{formatNumber(v)}</span>;
}

export default function Trazabilidad() {
  const [desde, setDesde] = useState(haceDias(30));
  const [hasta, setHasta] = useState(hoy());
  const [soloDif, setSoloDif] = useState(true);
  const [modo, setModo] = useState("insumos");
  const [q, setQ] = useState("");
  const qDeb = useDebounced(q, 250);
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true); setError("");
    try {
      const { data: d } = await api.get("/deposito/trazabilidad", {
        params: { desde, hasta, modo, soloDiferencias: soloDif ? "1" : "0" },
      });
      setData(d);
    } catch (e) {
      setError(e?.response?.data?.error || "No se pudo cargar la trazabilidad.");
      setData(null);
    } finally { setCargando(false); }
  }, [desde, hasta, modo, soloDif]);

  useEffect(() => { cargar(); }, [cargar]);

  const pedidos = useMemo(() => {
    const t = normalizeText(qDeb);
    const lista = data?.pedidos || [];
    if (!t) return lista;
    const digitos = t.replace(/\D/g, "");
    return lista.filter((p) =>
      (digitos && (String(p.id).includes(digitos) || p.numero.includes(digitos)))
      || normalizeText(p.servicio).includes(t)
      || normalizeText(p.solicitante).includes(t)
      || (p.items || []).some((i) => normalizeText(i.nombre).includes(t) || normalizeText(i.codigo).includes(t)));
  }, [data, qDeb]);

  const exportar = () => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const filas = [["Pedido", "Fecha", "Servicio", "Solicitante", "Codigo", "Insumo",
      "Pidio", "Entrego", "Pendiente", "Devuelto", "Neto", "Listo para retirar", "Retirado"]
      .map(esc).join(";")];
    for (const p of pedidos) {
      for (const i of p.items) {
        filas.push([esc(p.numero), esc(p.pedidoAr), esc(p.servicio || "(administrativo)"),
          esc(p.solicitante), esc(i.codigo), esc(i.nombre),
          csvNumber(i.pidio), csvNumber(i.entregado), csvNumber(i.pendiente),
          csvNumber(i.devuelto), csvNumber(i.neto),
          esc(p.listoAr), esc(p.retiradoAr)].join(";"));
      }
    }
    const blob = new Blob(["﻿" + filas.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `trazabilidad_${desde}_a_${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const atajos = [
    ["Hoy", () => [hoy(), hoy()]],
    ["Últimos 7 días", () => [haceDias(6), hoy()]],
    ["Últimos 30 días", () => [haceDias(30), hoy()]],
    ["Mes pasado", () => {
      const d = new Date();
      return [diaAr(new Date(d.getFullYear(), d.getMonth() - 1, 1)), diaAr(new Date(d.getFullYear(), d.getMonth(), 0))];
    }],
  ];

  // Los números de arriba se calculan sobre lo que se está VIENDO. Si salieran
  // del total del período, al buscar algo mostrarían 24 pedidos con 5 filas
  // abajo, y no habría forma de saber a qué corresponden.
  const t = useMemo(() => ({
    pedidos: pedidos.length,
    conPendiente: pedidos.filter((p) => p.tienePendiente).length,
    conDevolucion: pedidos.filter((p) => p.tieneDevolucion).length,
    conAjuste: pedidos.filter((p) => p.tieneAjuste).length,
  }), [pedidos]);

  return (
    <div className="tz">
      <div>
        <h2 className="tz-title">Trazabilidad de pedidos</h2>
        <p className="tz-sub">
          El recorrido completo de cada pedido: lo que pidió el supervisor, lo que ajustó el
          depósito, lo que salió, lo que quedó pendiente y lo que se devolvió. Por defecto se
          muestran <strong>sólo los pedidos con alguna diferencia</strong>.
        </p>
      </div>

      <div className="tz-filtros">
        <label className="tz-field"><span>Desde</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="tz-field"><span>Hasta</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <div className="tz-atajos">
          {atajos.map(([et, calc]) => (
            <button key={et} type="button" className="tz-btn-ghost"
              onClick={() => { const [a, b] = calc(); setDesde(a); setHasta(b); }}>{et}</button>
          ))}
        </div>
      </div>

      <div className="tz-filtros">
        <label className="tz-check">
          <input type="checkbox" checked={soloDif} onChange={(e) => setSoloDif(e.target.checked)} />
          <span>Sólo pedidos con diferencias</span>
        </label>
        <label className="tz-field"><span>Ver</span>
          <select value={modo} onChange={(e) => setModo(e.target.value)}>
            <option value="insumos">Insumos</option>
            <option value="uniformes">Uniformes</option>
          </select>
        </label>
        <input className="tz-search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por número, servicio, solicitante o insumo…" />
        <button type="button" className="tz-btn-ghost" onClick={exportar} disabled={!pedidos.length}>
          Exportar CSV
        </button>
      </div>

      {error && <div className="state error">{error}</div>}

      {!!t?.pedidos && (
        <div className="tz-kpis">
          <div className="tz-kpi"><span className="tz-kpi-n">{formatNumber(t.pedidos)}</span><span>pedidos</span></div>
          <div className="tz-kpi"><span className="tz-kpi-n tz-amb">{formatNumber(t.conPendiente)}</span><span>con pendientes</span></div>
          <div className="tz-kpi"><span className="tz-kpi-n tz-amb">{formatNumber(t.conDevolucion)}</span><span>con devolución</span></div>
          <div className="tz-kpi"><span className="tz-kpi-n tz-amb">{formatNumber(t.conAjuste)}</span><span>ajustados por depósito</span></div>
        </div>
      )}

      {cargando ? <div className="tz-vacio">Cargando…</div>
        : pedidos.length === 0 ? (
          <div className="tz-vacio">
            {q ? "No hay pedidos que coincidan con la búsqueda."
              : soloDif
                ? <>No hubo diferencias entre el {desde} y el {hasta}.<br />
                    <span style={{ fontSize: "0.85rem" }}>Todo se entregó como se pidió. Destildá el filtro para ver todos.</span></>
                : `No hubo pedidos entre el ${desde} y el ${hasta}.`}
          </div>
        ) : (
          <div className="tz-tabla-wrap">
            <table className="tz-tabla">
              <thead>
                <tr>
                  <th>Pedido</th><th>Servicio</th>
                  <th className="num">Pidió</th><th className="num">Entregó</th>
                  <th className="num">Pend.</th><th className="num">Devol.</th><th className="num">Neto</th>
                  <th>Qué pasó</th><th />
                </tr>
              </thead>
              <tbody>
                {pedidos.map((p) => {
                  const esta = abierto === p.id;
                  return (
                    <Fragment key={p.id}>
                      <tr className={esta ? "is-abierto" : ""}>
                        <td>
                          <span className="mono">#{p.numero}</span>
                          <span className="tz-fecha">{p.pedidoAr}</span>
                        </td>
                        <td>
                          {p.servicio || <em className="tz-admin">Sin servicio (administrativo)</em>}
                          <span className="tz-quien">{p.solicitante || "—"}</span>
                        </td>
                        <td className="num">{formatNumber(p.totales.pidio)}</td>
                        <td className="num">{formatNumber(p.totales.entregado)}</td>
                        <td className="num"><Num v={p.totales.pendiente} destacado color="#b45309" /></td>
                        <td className="num"><Num v={p.totales.devuelto} destacado color="#b45309" /></td>
                        <td className="num tz-fuerte">{formatNumber(p.totales.neto)}</td>
                        <td>
                          <div className="tz-marcas">
                            {p.tieneAjuste && <span className="tz-marca">ajustado</span>}
                            {p.tienePendiente && <span className="tz-marca">pendiente</span>}
                            {p.tieneDevolucion && <span className="tz-marca">devolución</span>}
                            {!p.tieneAjuste && !p.tienePendiente && !p.tieneDevolucion &&
                              <span className="tz-ok">sin diferencias</span>}
                          </div>
                        </td>
                        <td>
                          <button type="button" className="tz-btn-ghost"
                            onClick={() => setAbierto(esta ? null : p.id)}>
                            {esta ? "Ocultar" : "Ver"}
                          </button>
                        </td>
                      </tr>

                      {esta && (
                        <tr className="tz-fila-detalle">
                          <td colSpan={9}>
                            <div className="tz-detalle">
                              <div className="tz-linea">
                                <span className="tz-paso">Pidió {p.pedidoAr}</span>
                                {p.listoAr && <><span className="tz-flecha">→</span><span className="tz-paso">Listo {p.listoAr}</span></>}
                                {p.retiradoAr && <><span className="tz-flecha">→</span><span className="tz-paso">Retiró {p.retiradoAr}</span></>}
                                {p.pendienteEntregadoAr && <><span className="tz-flecha">→</span>
                                  <span className="tz-paso tz-paso--amb">Pendiente entregado {p.pendienteEntregadoAr}</span></>}
                              </div>
                              {p.nota && <div className="tz-nota">Nota: {p.nota}</div>}
                              <table className="tz-tabla tz-tabla--interna">
                                <thead>
                                  <tr>
                                    <th>Código</th><th>Insumo</th>
                                    <th className="num">Pidió</th><th className="num">Entregó</th>
                                    <th className="num">Pend.</th><th className="num">Devol.</th>
                                    <th className="num">Neto</th><th />
                                  </tr>
                                </thead>
                                <tbody>
                                  {p.items.map((i) => (
                                    <tr key={i.productId}>
                                      <td className="mono">{i.codigo || "—"}</td>
                                      <td>{i.nombre}</td>
                                      <td className="num">{i.agregado ? <span className="tz-nada">—</span> : formatNumber(i.pidio)}</td>
                                      <td className="num">{formatNumber(i.entregado)}</td>
                                      <td className="num"><Num v={i.pendiente} destacado color="#b45309" /></td>
                                      <td className="num"><Num v={i.devuelto} destacado color="#b45309" /></td>
                                      <td className="num tz-fuerte">{formatNumber(i.neto)}</td>
                                      <td>
                                        {i.agregado ? <span className="tz-marca">lo agregó el depósito</span>
                                          : i.ajustado ? <span className="tz-marca">pidió {formatNumber(i.pidio)}</span>
                                            : null}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <div className="tz-pie">
                                Valor de lo que quedó en el servicio: <strong>{formatMoney(p.totales.monto)}</strong>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}
