// client/src/components/DevolucionesDeposito.jsx
//
// Devoluciones: las carga el depósito, que es quien recibe la mercadería.
//
// El supervisor trae el remito en la mano, así que la pantalla va en ese orden:
// primero el número de remito, después las cantidades que volvieron, y al final
// un resumen que dice en castellano qué va a pasar antes de confirmar.
//
// Lo que vuelve siempre suma stock. Lo que cambia es el consumo del servicio:
// los insumos marcados "va y vuelve" (tachos, contenedores, dispensers) se
// usaron igual y no se descuentan; el resto sí.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";

const soloNumeros = (v) => String(v ?? "").replace(/\D/g, "");
const unidades = (n) => `${n} ${n === 1 ? "unidad" : "unidades"}`;

function Resultado({ datos, onOtra }) {
  const d = Number(datos.unidadesDescontadas || 0);
  const r = Number(datos.unidadesRetornables || 0);
  return (
    <div className="dev-hecho" role="status">
      <div className="dev-hecho-titulo">Devolución registrada — remito #{datos.remito}</div>
      <ul className="dev-hecho-lista">
        {datos.devueltos.map((x) => (
          <li key={x.productoId}>
            <strong>{x.cantidad}</strong> {x.nombre}
            {x.retornable
              ? <span className="dev-nota"> — volvió al stock y sigue contando como usado</span>
              : <span className="dev-nota"> — volvió al stock y se le descuenta al servicio</span>}
          </li>
        ))}
      </ul>
      <div className="dev-hecho-pie">
        {d > 0 && <span>{unidades(d)} menos en el consumo del servicio.</span>}
        {r > 0 && <span>{unidades(r)} de las que van y vuelven: el consumo no cambia.</span>}
        <button type="button" className="btn primary" onClick={onOtra}>Cargar otra devolución</button>
      </div>
    </div>
  );
}

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
    <section className="dev">
      <header className="dev-cab">
        <div>
          <h2>Devoluciones</h2>
          <p>Lo que el servicio devuelve vuelve al stock. Se carga con el número de remito que trae el supervisor.</p>
        </div>
        {ultimas.length > 0 && (
          <button type="button" className="btn ghost" onClick={() => setVerUltimas((v) => !v)}>
            {verUltimas ? "Ocultar" : "Ver"} las últimas ({ultimas.length})
          </button>
        )}
      </header>

      {err && <div className="dev-error" role="alert">{err}</div>}
      {hecho && <Resultado datos={hecho} onOtra={empezarDeNuevo} />}

      {!remito && !hecho && (
        <form className="dev-paso1" onSubmit={buscar}>
          <label htmlFor="dev-remito-input">Número de remito</label>
          <div className="dev-paso1-fila">
            <input id="dev-remito-input" className="dev-remito-input" value={numero} inputMode="numeric"
              onChange={(e) => setNumero(e.target.value)} placeholder="0001186"
              aria-label="Número de remito" autoFocus />
            <button type="submit" className="btn primary" disabled={buscando}>
              {buscando ? "Buscando…" : "Buscar remito"}
            </button>
          </div>
          <span className="dev-pista">Es el número que figura arriba del remito, con ceros o sin ceros.</span>
        </form>
      )}

      {remito && (
        <div className="dev-trabajo">
          <div className="dev-remito-cab">
            <div className="dev-remito-datos">
              <span className="dev-remito-num">Remito #{remito.pedido.numero}</span>
              <span className="dev-remito-serv">{remito.pedido.servicio}</span>
            </div>
            <button type="button" className="btn ghost" onClick={empezarDeNuevo}>Buscar otro remito</button>
          </div>

          {pendientes.length === 0 ? (
            <div className="dev-vacio">De este remito ya se devolvió todo lo que se podía devolver.</div>
          ) : (
            <>
              <p className="dev-instruccion">Poné cuánto volvió de cada insumo. Lo que no volvió, dejalo vacío.</p>

              <div className="dev-tabla" role="table" aria-label="Insumos del remito">
                <div className="dev-fila dev-fila--cab" role="row">
                  <span role="columnheader">Insumo</span>
                  <span role="columnheader" className="dev-num">Se entregó</span>
                  <span role="columnheader" className="dev-num">Volvió antes</span>
                  <span role="columnheader" className="dev-num">Vuelve ahora</span>
                </div>

                {pendientes.map((it) => {
                  const valor = cant[it.productoId] ?? "";
                  return (
                    <div key={it.productoId} role="row"
                      className={`dev-fila${Number(valor) > 0 ? " is-cargada" : ""}`}>
                      <span role="cell" className="dev-insumo">
                        <span className="dev-nombre">{it.nombre}</span>
                        <span className="dev-sub">
                          {it.codigo ? `Cód. ${it.codigo}` : "Sin código"}
                          {it.retornable && (
                            <span className="dev-chip" title="Vuelve al stock, pero el servicio lo usó igual: no se le descuenta">
                              va y vuelve
                            </span>
                          )}
                        </span>
                        {/* En el celular las columnas no entran: el dato va acá. */}
                        <span className="dev-sub dev-solo-movil">
                          Se entregó {it.entregado}
                          {it.devuelto > 0 ? ` · ya volvieron ${it.devuelto}` : ""}
                        </span>
                      </span>
                      <span role="cell" className="dev-num dev-dato">{it.entregado}</span>
                      <span role="cell" className="dev-num dev-dato">{it.devuelto > 0 ? it.devuelto : "—"}</span>
                      <span role="cell" className="dev-num dev-entrada">
                        <input className="dev-cant" type="text" inputMode="numeric" value={valor}
                          onChange={(e) => escribir(it, e.target.value)}
                          onFocus={(e) => e.target.select()}
                          placeholder="0" aria-label={`Cantidad que vuelve de ${it.nombre}`} />
                        <button type="button" className="dev-todo"
                          onClick={() => escribir(it, String(it.disponible))}
                          disabled={Number(valor) === it.disponible}>
                          volvió todo ({it.disponible})
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className={`dev-confirmar${elegidos.length ? " is-lista" : ""}`}>
                <input className="dev-motivo" value={motivo} maxLength={120}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Motivo (opcional): sobrante, error de pedido…" aria-label="Motivo" />

                <div className="dev-efecto" aria-live="polite">
                  {elegidos.length === 0 ? (
                    <span className="dev-efecto-vacio">Cargá las cantidades que volvieron.</span>
                  ) : (
                    <>
                      <span className="dev-efecto-total">
                        {uDescuentan + uRetornables === 1 ? "Vuelve" : "Vuelven"} {unidades(uDescuentan + uRetornables)} al stock
                      </span>
                      {uDescuentan > 0 && <span>· se le descuentan {uDescuentan} al consumo del servicio</span>}
                      {uRetornables > 0 && <span>· {uRetornables} {uRetornables === 1 ? "va" : "van"} y {uRetornables === 1 ? "vuelve" : "vuelven"}: el consumo no cambia</span>}
                    </>
                  )}
                </div>

                <button type="button" className="btn primary" onClick={confirmar}
                  disabled={guardando || !elegidos.length}>
                  {guardando ? "Registrando…" : "Registrar devolución"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {verUltimas && ultimas.length > 0 && (
        <div className="dev-historial">
          <h3>Últimas devoluciones</h3>
          <ul>
            {ultimas.map((u) => (
              <li key={u.id}>
                <span className="dev-hist-cant">{u.cantidad}</span>
                <span className="dev-hist-insumo">
                  {u.insumo}
                  {u.tipo === "retornable" && <span className="dev-chip">va y vuelve</span>}
                  <small>Remito #{u.remito} · {u.servicio}</small>
                </span>
                <span className="dev-hist-meta">{u.motivo || "—"}{u.quien ? ` · ${u.quien}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
