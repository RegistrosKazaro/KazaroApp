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

const soloNumeros = (v) => String(v ?? "").replace(/\D/g, "");
const unidades = (n) => `${formatNumber(n)} ${n === 1 ? "unidad" : "unidades"}`;

export default function DevolucionesDeposito() {
  const [numero, setNumero] = useState("");
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
  };

  const buscar = async (e) => {
    e?.preventDefault?.();
    const n = soloNumeros(numero);
    if (!n) { setErr("Escribí el número que figura en el remito."); return; }
    setBuscando(true); setErr(""); setHecho(null); setRemito(null); setCant({});
    try {
      const { data } = await api.get(`/deposito/devoluciones/remito/${n}`);
      setRemito(data);
    } catch (e2) {
      setErr(e2?.response?.data?.error || "No se pudo buscar el remito.");
    } finally {
      setBuscando(false);
    }
  };

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

  const uDescuentan = elegidos.filter((x) => !x.item.retornable).reduce((a, x) => a + x.cantidad, 0);
  const uRetornables = elegidos.filter((x) => x.item.retornable).reduce((a, x) => a + x.cantidad, 0);

  const confirmar = async () => {
    if (!elegidos.length) return;
    setGuardando(true); setErr("");
    try {
      const { data } = await api.post("/deposito/devoluciones", {
        pedidoId: remito.pedido.id,
        items: elegidos.map((x) => ({ productoId: x.item.productoId, cantidad: x.cantidad })),
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
        </form>

        {err && <div className="state error deposito-state">{err}</div>}

        {hecho && (
          <div className="state deposito-state dev-hecho">
            <strong>Devolución registrada — remito #{hecho.remito}</strong>
            <ul>
              {hecho.devueltos.map((x) => (
                <li key={x.productoId}>
                  {formatNumber(x.cantidad)} {x.nombre} — volvió al stock y{" "}
                  {x.retornable ? "sigue contando como usado" : "se le descuenta al servicio"}
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
              <small>{remito.pedido.servicio} · poné cuánto volvió de cada insumo</small>
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
                        Vuelven <strong>{unidades(uDescuentan + uRetornables)}</strong> al stock
                        {uDescuentan > 0 && <> · se le descuentan {formatNumber(uDescuentan)} al consumo del servicio</>}
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
