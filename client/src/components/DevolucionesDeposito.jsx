// client/src/components/DevolucionesDeposito.jsx
//
// Devoluciones: las carga el depósito, que es quien recibe la mercadería.
//
// Usa los mismos bloques que el resto del panel (deposito-card, deposito-table,
// pill, state), para que no desentone con Pedidos, Despachos o Trazabilidad.
//
// El supervisor trae el remito en la mano, así que la pantalla va en ese orden:
// número de remito, cantidades que volvieron y, antes de confirmar, un resumen
// de qué va a pasar. Lo que vuelve siempre suma stock; lo que cambia es el
// consumo del servicio: los insumos marcados "va y vuelve" (tachos,
// contenedores, dispensers) se usaron igual y no se descuentan, el resto sí.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { formatNumber } from "../utils/format";
import { formatoFechaHoraAr } from "../utils/fechas";
import useDebounced from "../hooks/useDebounced";

const soloNumeros = (v) => String(v ?? "").replace(/\D/g, "");
const unidades = (n) => `${formatNumber(n)} ${n === 1 ? "unidad" : "unidades"}`;

/**
 * Qué se le pregunta a cada insumo al devolverlo. El número lo manda el
 * servidor en `preguntaEstado` y sale de `Productos.pregunta_estado`.
 *
 * A un líquido se le pregunta CUÁNTO QUEDA, no si se abrió: un bidón de 5
 * litros al que le falta uno está abierto pero prácticamente entero, y
 * cobrarlo completo era lo que trababa estas devoluciones.
 *
 * A una herramienta se le pregunta en qué estado volvió: si vuelve sana es
 * como si nunca hubiera salido, y si vuelve rota la paga el que la rompió.
 */
const OPCIONES = {
  1: [
    ["sin_abrir",  "Sin abrir",      "Entra al stock y se le descuenta el consumo al servicio"],
    ["casi_lleno", "Más de ¾ lleno", "Va a remanentes, pero igual se le descuenta el consumo"],
    ["usado",      "Usado",          "Va a remanentes y el servicio lo paga: ya lo gastó"],
  ],
  2: [
    ["buen_estado", "En buen estado",    "Entra al stock y no se le cobra nada: volvió como salió"],
    ["roto",        "Roto o inservible", "Va a remanentes y lo paga el servicio, que lo rompió"],
  ],
};

export default function DevolucionesDeposito() {
  // productoId -> "sin_abrir" | "casi_lleno" | "usado" | "buen_estado" | "roto"
  const [estados, setEstados] = useState({});
  const [numero, setNumero] = useState("");
  const [porServicio, setPorServicio] = useState("");
  const [candidatos, setCandidatos] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [remito, setRemito] = useState(null);
  const [cant, setCant] = useState({});
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState("");
  const [hecho, setHecho] = useState(null);
  const [ultimas, setUltimas] = useState([]);
  const [verUltimas, setVerUltimas] = useState(false);

  const cargarUltimas = useCallback(async () => {
    try {
      const { data } = await api.get("/deposito/devoluciones", { params: { limit: 25 } });
      setUltimas(data?.rows || []);
    } catch { /* es informativa: si falla, no molesta */ }
  }, []);

  useEffect(() => { cargarUltimas(); }, [cargarUltimas]);

  const empezarDeNuevo = () => {
    setRemito(null); setNumero(""); setCant({}); setMotivo(""); setErr(""); setHecho(null);
    setEstados({});
  };

  const cargarRemito = async (valor) => {
    const n = soloNumeros(valor);
    if (!n) { setErr("Escribí el número que figura en el remito."); return; }
    setBuscando(true); setErr(""); setHecho(null); setRemito(null); setCant({}); setEstados({});
    try {
      const { data } = await api.get(`/deposito/devoluciones/remito/${n}`);
      setRemito(data);
    } catch (e2) {
      setErr(e2?.response?.data?.error || "No se pudo buscar el remito.");
    } finally {
      setBuscando(false);
    }
  };

  const buscar = (e) => { e?.preventDefault?.(); cargarRemito(numero); };

  // Buscar por servicio mientras se escribe, sin castigar al servidor.
  const servicioDeb = useDebounced(porServicio, 300);
  useEffect(() => {
    const q = servicioDeb.trim();
    if (q.length < 2) { setCandidatos([]); return; }
    let vigente = true;
    api.get("/deposito/devoluciones/buscar", { params: { q } })
      .then(({ data }) => { if (vigente) setCandidatos(data?.remitos ?? []); })
      .catch(() => { if (vigente) setCandidatos([]); });
    return () => { vigente = false; };
  }, [servicioDeb]);

  const escribir = (item, texto) => {
    const digitos = soloNumeros(texto);
    const limpio = digitos && Number(digitos) > item.disponible ? String(item.disponible) : digitos;
    setCant((c) => ({ ...c, [item.productoId]: limpio }));
    setErr("");
  };

  const items = useMemo(() => remito?.items || [], [remito]);
  const pendientes = items.filter((i) => i.disponible > 0);

  const elegidos = useMemo(() => items
    .map((i) => ({ item: i, cantidad: Number(cant[i.productoId] || 0) }))
    .filter((x) => x.cantidad > 0), [items, cant]);

  // Al servicio se le cobra lo que gastó o lo que rompió. Lo demás se le
  // descuenta, aunque vuelva abierto: dónde entra la mercadería y a quién se
  // le cobra son dos preguntas distintas.
  const SE_COBRAN = new Set(["usado", "roto"]);
  // Y lo que no vuelve como nuevo no entra al stock general: espera en
  // remanentes a que alguien lo revise.
  const A_REMANENTES = new Set(["casi_lleno", "usado", "roto"]);

  const porDefecto = (item) => (Number(item.preguntaEstado) === 2 ? "buen_estado" : "sin_abrir");
  const estadoDe = (item) => estados[item.productoId] || porDefecto(item);
  const volvioUsado = (item) => Number(item.preguntaEstado) > 0 && SE_COBRAN.has(estadoDe(item));
  const vaARemanentes = (item) =>
    !item.retornable && Number(item.preguntaEstado) > 0 && A_REMANENTES.has(estadoDe(item));

  const sumar = (filtro) => elegidos.filter(filtro).reduce((a, x) => a + x.cantidad, 0);
  const uRetornables = sumar((x) => x.item.retornable);
  const uUsados = sumar((x) => !x.item.retornable && volvioUsado(x.item));
  const uDescuentan = sumar((x) => !x.item.retornable && !volvioUsado(x.item));
  const uRemanentes = sumar((x) => vaARemanentes(x.item));

  const confirmar = async () => {
    if (!elegidos.length) return;
    setGuardando(true); setErr("");
    try {
      const { data } = await api.post("/deposito/devoluciones", {
        pedidoId: remito.pedido.id,
        items: elegidos.map((x) => ({
          productoId: x.item.productoId,
          cantidad: x.cantidad,
          ...(x.item.preguntaEstado ? { estado: estadoDe(x.item) } : {}),
        })),
        motivo: motivo.trim(),
      });
      setHecho(data);
      setRemito(null); setCant({}); setMotivo(""); setNumero("");
      cargarUltimas();
    } catch (e2) {
      setErr(e2?.response?.data?.error || "No se pudo registrar la devolución.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="dev-wrap">
      {/* Buscar el remito */}
      <section className="deposito-card">
        <div className="deposito-card-header">
          <div>
            <h2>Devoluciones</h2>
            <small>Lo que el servicio devuelve vuelve al stock. Se carga con el número de remito que trae el supervisor.</small>
          </div>
          <div className="deposito-header-actions">
            {ultimas.length > 0 && (
              <button type="button" className="pill pill--ghost" onClick={() => setVerUltimas((v) => !v)}>
                {verUltimas ? "Ocultar" : "Ver"} últimas ({ultimas.length})
              </button>
            )}
          </div>
        </div>

        <form className="dev-busqueda" onSubmit={buscar}>
          <label className="deposito-field">
            <span>Número de remito</span>
            <input id="dev-remito-input" className="deposito-search dev-numero" value={numero} inputMode="numeric"
              onChange={(e) => setNumero(e.target.value)} placeholder="0001186"
              aria-label="Número de remito" autoFocus />
          </label>
          <button type="submit" className="pill" disabled={buscando}>
            {buscando ? "Buscando…" : "Buscar remito"}
          </button>

          {/* El supervisor no siempre trae el número: a veces sólo sabe de qué
              servicio es. Se listan los remitos ya retirados de ese servicio. */}
          <label className="deposito-field" style={{ flex: "1 1 240px" }}>
            <span>…o buscá por servicio</span>
            <input className="deposito-search" value={porServicio}
              onChange={(e) => setPorServicio(e.target.value)}
              placeholder="Nombre del servicio"
              aria-label="Buscar por servicio"
              style={{ maxWidth: "none", width: "100%" }} />
          </label>
        </form>

        {porServicio.trim().length >= 2 && (
          <div className="deposito-table-wrapper" style={{ marginBottom: 10 }}>
            <table className="deposito-table" aria-label="Remitos del servicio">
              <thead>
                <tr>
                  <th scope="col">Remito</th><th scope="col">Servicio</th>
                  <th scope="col">Retirado</th><th scope="col" style={{ width: 110 }}></th>
                </tr>
              </thead>
              <tbody>
                {!candidatos.length && (
                  <tr><td colSpan={4} className="deposito-empty">
                    No hay remitos retirados de ese servicio.
                  </td></tr>
                )}
                {candidatos.map((r) => (
                  <tr key={r.id} className="deposito-row">
                    <td><span className="deposito-code">#{r.numero}</span></td>
                    <td className="deposito-service-name">{r.servicio || "Sin servicio"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{formatoFechaHoraAr(r.retiroAt)}</td>
                    <td>
                      <button type="button" className="pill"
                        onClick={() => { setNumero(r.numero); setPorServicio(""); cargarRemito(r.numero); }}>
                        Elegir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {err && <div className="state error deposito-state">{err}</div>}

        {hecho && (
          <div className="state deposito-state dev-hecho">
            <strong>Devolución registrada — remito #{hecho.remito}</strong>
            <ul>
              {hecho.devueltos.map((x) => (
                <li key={x.productoId}>
                  {formatNumber(x.cantidad)} {x.nombre} — volvió al stock y{" "}
                  {x.retornable ? "sigue contando como usado"
                    : x.usado ? "se le cobra igual, porque volvió abierto o usado"
                    : "se le descuenta al servicio"}
                </li>
              ))}
            </ul>
            <button type="button" className="pill" onClick={empezarDeNuevo}>Cargar otra devolución</button>
          </div>
        )}
      </section>

      {/* El remito y sus insumos */}
      {remito && (
        <section className="deposito-card">
          <div className="deposito-card-header">
            <div>
              <h2>Remito #{remito.pedido.numero}</h2>
              <small>
                {remito.pedido.servicio} · poné cuánto volvió de cada insumo.
                {" "}Si lo que salió no coincide con el remito, corregí el pedido antes de cargar la devolución.
              </small>
            </div>
            <div className="deposito-header-actions">
              <button type="button" className="pill pill--ghost" onClick={empezarDeNuevo}>Buscar otro</button>
            </div>
          </div>

          {pendientes.length === 0 ? (
            <div className="state deposito-state">De este remito ya se devolvió todo lo que se podía devolver.</div>
          ) : (
            <>
              <div className="deposito-table-wrapper">
                <table className="deposito-table" aria-label="Insumos del remito">
                  <thead>
                    <tr>
                      <th scope="col">Insumo</th>
                      <th scope="col" className="deposito-th--numeric">Se entregó</th>
                      <th scope="col" className="deposito-th--numeric">Volvió antes</th>
                      <th scope="col" className="deposito-th--numeric">Vuelve ahora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendientes.map((it) => {
                      const valor = cant[it.productoId] ?? "";
                      return (
                        <tr key={it.productoId} className={Number(valor) > 0 ? "dev-tr-cargada" : ""}>
                          <td>
                            <div className="dev-nombre">{it.nombre}</div>
                            <div className="dev-sub">
                              {it.codigo ? `Cód. ${it.codigo}` : "Sin código"}
                              {it.retornable && (
                                <span className="dev-chip" title="Vuelve al stock, pero el servicio lo usó igual: no se le descuenta">
                                  va y vuelve
                                </span>
                              )}
                            </div>
                            {it.preguntaEstado && Number(valor) > 0 && (
                              <div className="dev-estado" role="radiogroup"
                                aria-label={Number(it.preguntaEstado) === 2
                                  ? `¿En qué estado volvió ${it.nombre}?`
                                  : `¿Cuánto queda de ${it.nombre}?`}>
                                {OPCIONES[Number(it.preguntaEstado)].map(([valorEstado, etiqueta, ayuda]) => (
                                  <label key={valorEstado} title={ayuda}>
                                    <input type="radio" name={`estado-${it.productoId}`}
                                      checked={estadoDe(it) === valorEstado}
                                      onChange={() => setEstados((e) => ({ ...e, [it.productoId]: valorEstado }))} />
                                    {etiqueta}
                                  </label>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="deposito-td--numeric" data-rotulo="Se entregó">{formatNumber(it.entregado)}</td>
                          <td className="deposito-td--numeric" data-rotulo="Volvió antes">{it.devuelto > 0 ? formatNumber(it.devuelto) : "—"}</td>
                          <td className="deposito-td--numeric">
                            <input className="deposito-search dev-cant" type="text" inputMode="numeric" value={valor}
                              onChange={(e) => escribir(it, e.target.value)}
                              onFocus={(e) => e.target.select()}
                              placeholder="0" aria-label={`Cantidad que vuelve de ${it.nombre}`} />
                            <button type="button" className="dev-todo"
                              onClick={() => escribir(it, String(it.disponible))}
                              disabled={Number(valor) === it.disponible}>
                              volvió todo ({formatNumber(it.disponible)})
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="dev-confirmar">
                <label className="deposito-field dev-motivo">
                  <span>Motivo (opcional)</span>
                  <input className="deposito-search" value={motivo} maxLength={120}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Sobrante, error de pedido…" aria-label="Motivo" />
                </label>
                <p className="dev-efecto" aria-live="polite">
                  {elegidos.length === 0
                    ? "Cargá las cantidades que volvieron."
                    : (
                      <>
                        Vuelven <strong>{unidades(uDescuentan + uRetornables + uUsados)}</strong>
                        {uRemanentes > 0
                          ? <> · {formatNumber(uDescuentan + uRetornables + uUsados - uRemanentes)} al stock
                              y {formatNumber(uRemanentes)} a remanentes, para revisar</>
                          : <> al stock</>}
                        {uDescuentan > 0 && <> · se le descuentan {formatNumber(uDescuentan)} al consumo del servicio</>}
                        {uUsados > 0 && <> · {formatNumber(uUsados)} se le cobran igual: las gastó o las rompió</>}
                        {uRetornables > 0 && <> · {formatNumber(uRetornables)} de los que van y vuelven: el consumo no cambia</>}
                      </>
                    )}
                </p>
                <button type="button" className="pill" onClick={confirmar} disabled={guardando || !elegidos.length}>
                  {guardando ? "Registrando…" : "Registrar devolución"}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {/* Historial */}
      {verUltimas && ultimas.length > 0 && (
        <section className="deposito-card">
          <div className="deposito-card-header">
            <div>
              <h2>Últimas devoluciones</h2>
              <small>Las {ultimas.length} más recientes</small>
            </div>
          </div>
          <div className="deposito-table-wrapper">
            <table className="deposito-table" aria-label="Últimas devoluciones">
              <thead>
                <tr>
                  <th scope="col">Insumo</th>
                  <th scope="col" className="deposito-th--numeric">Cantidad</th>
                  <th scope="col">Remito</th>
                  <th scope="col">Servicio</th>
                  <th scope="col">Motivo</th>
                  <th scope="col">Quién</th>
                </tr>
              </thead>
              <tbody>
                {ultimas.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="dev-nombre">{u.insumo}</div>
                      {u.tipo === "retornable" && <span className="dev-chip">va y vuelve</span>}
                      {u.tipo === "usado" && <span className="dev-chip">volvió abierto</span>}
                    </td>
                    <td className="deposito-td--numeric" data-rotulo="Cantidad">{formatNumber(u.cantidad)}</td>
                    <td data-rotulo="Remito">#{u.remito}</td>
                    <td data-rotulo="Servicio">{u.servicio || "—"}</td>
                    <td data-rotulo="Motivo">{u.motivo || "—"}</td>
                    <td data-rotulo="Quién">{u.quien || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
