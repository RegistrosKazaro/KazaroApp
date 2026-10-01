// client/src/components/DevolucionesDeposito.jsx
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

/* Devoluciones (depósito).

   El supervisor trae el remito en la mano; acá se busca por ese número, se
   ponen las cantidades que volvieron y listo. Se aplica en el momento: la
   carga quien recibe la mercadería, así que no hay nada que aprobar después.

   Lo que vuelve siempre suma stock. Lo que cambia es el consumo del servicio:
   los insumos marcados "va y vuelve" (tachos, contenedores) se usaron igual y
   no se descuentan; el resto sí. */
export default function DevolucionesDeposito() {
  const [numero, setNumero] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [remito, setRemito] = useState(null);     // { pedido, items }
  const [cant, setCant] = useState({});           // productoId -> texto
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [ultimas, setUltimas] = useState([]);

  const cargarUltimas = useCallback(async () => {
    try {
      const { data } = await api.get("/deposito/devoluciones", { params: { limit: 20 } });
      setUltimas(data?.rows || []);
    } catch { /* la lista es informativa: si falla, no molesta */ }
  }, []);

  useEffect(() => { cargarUltimas(); }, [cargarUltimas]);

  const buscar = async (e) => {
    e?.preventDefault?.();
    const n = String(numero).replace(/[^0-9]/g, "");
    if (!n) { setErr("Poné el número de remito"); return; }
    setBuscando(true); setErr(""); setOk(""); setRemito(null); setCant({});
    try {
      const { data } = await api.get(`/deposito/devoluciones/remito/${n}`);
      setRemito(data);
      if (!(data?.items || []).some((i) => i.disponible > 0)) {
        setErr("Ese remito ya tiene todo devuelto.");
      }
    } catch (e2) {
      setErr(e2?.response?.data?.error || "No se pudo buscar el remito");
    } finally {
      setBuscando(false);
    }
  };

  const escribir = (item, texto) => {
    const digitos = String(texto).replace(/\D/g, "");
    const n = Number(digitos);
    const limpio = digitos && n > item.disponible ? String(item.disponible) : digitos;
    setCant((c) => ({ ...c, [item.productoId]: limpio }));
    setOk("");
  };

  const elegidos = Object.entries(cant)
    .map(([pid, txt]) => ({ productoId: pid, cantidad: Number(txt) }))
    .filter((x) => x.cantidad > 0);
  const totalUnidades = elegidos.reduce((a, x) => a + x.cantidad, 0);

  const confirmar = async () => {
    if (!elegidos.length) { setErr("Poné la cantidad de lo que volvió"); return; }
    setGuardando(true); setErr(""); setOk("");
    try {
      const { data } = await api.post("/deposito/devoluciones", {
        pedidoId: remito.pedido.id, items: elegidos, motivo: motivo.trim(),
      });
      const d = Number(data?.unidadesDescontadas || 0);
      const r = Number(data?.unidadesRetornables || 0);
      setOk(`Listo: volvieron ${d + r} unidades al stock del remito #${data.remito}.`
        + (d ? ` Se le descuentan ${d} al consumo del servicio.` : "")
        + (r ? ` ${r} son de los que van y vuelven: siguen contando como usadas.` : ""));
      setCant({}); setMotivo("");
      const n = remito.pedido.id;
      const { data: rec } = await api.get(`/deposito/devoluciones/remito/${n}`);
      setRemito(rec);
      cargarUltimas();
    } catch (e2) {
      setErr(e2?.response?.data?.error || "No se pudo registrar la devolución");
    } finally {
      setGuardando(false);
    }
  };

  const items = (remito?.items || []).filter((i) => i.disponible > 0 || Number(cant[i.productoId]) > 0);

  return (
    <section className="dev-dep">
      <form className="dev-buscar" onSubmit={buscar}>
        <label>
          <span>Número de remito</span>
          <input className="input" value={numero} inputMode="numeric"
            onChange={(e) => setNumero(e.target.value)}
            placeholder="Ej.: 0001186" aria-label="Número de remito" />
        </label>
        <button type="submit" className="btn primary" disabled={buscando}>
          {buscando ? "Buscando…" : "Buscar"}
        </button>
        <span className="dev-ayuda">El número que figura en el remito que trae el supervisor.</span>
      </form>

      {err && <div className="dev-error" role="alert">{err}</div>}
      {ok && <div className="dev-ok" role="status">{ok}</div>}

      {remito && (
        <div className="dev-remito">
          <div className="dev-remito-cab">
            <div>
              <span className="dev-remito-num">Remito #{remito.pedido.numero}</span>
              <span className="dev-remito-serv">{remito.pedido.servicio}</span>
            </div>
            <button type="button" className="btn ghost" onClick={() => { setRemito(null); setNumero(""); setCant({}); setErr(""); }}>
              Buscar otro
            </button>
          </div>

          {items.length === 0 ? (
            <div className="dev-vacio">No queda nada para devolver de este remito.</div>
          ) : (
            <>
              <div className="dev-lista">
                <div className="dev-fila dev-fila--cab">
                  <span>Insumo</span>
                  <span className="dev-col-num">Se entregó</span>
                  <span className="dev-col-num">Ya devuelto</span>
                  <span className="dev-col-num">Vuelve ahora</span>
                </div>
                {items.map((it) => (
                  <div key={it.productoId} className={`dev-fila${Number(cant[it.productoId]) > 0 ? " is-cargada" : ""}`}>
                    <span className="dev-insumo">
                      {it.nombre}
                      {it.retornable && <span className="dev-tag" title="Vuelve al stock pero se sigue contando como usado">va y vuelve</span>}
                      <small>{it.codigo ? `Cód. ${it.codigo}` : "Sin código"}</small>
                    </span>
                    <span className="dev-col-num">{it.entregado}</span>
                    <span className="dev-col-num">{it.devuelto || "—"}</span>
                    <span className="dev-col-num">
                      <input className="input dev-cant" type="text" inputMode="numeric"
                        value={cant[it.productoId] ?? ""}
                        onChange={(e) => escribir(it, e.target.value)}
                        onFocus={(e) => e.target.select()}
                        placeholder="0" aria-label={`Cantidad que vuelve de ${it.nombre}`} />
                      <button type="button" className="dev-todo" onClick={() => escribir(it, String(it.disponible))}>
                        todo ({it.disponible})
                      </button>
                    </span>
                  </div>
                ))}
              </div>

              <div className="dev-pie">
                <input className="input dev-motivo" value={motivo} maxLength={120}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Motivo (opcional): sobrante, error de pedido…" aria-label="Motivo" />
                <span className="dev-resumen">
                  {elegidos.length
                    ? `${elegidos.length} insumo${elegidos.length === 1 ? "" : "s"} · ${totalUnidades} unidades`
                    : "Nada cargado todavía"}
                </span>
                <button type="button" className="btn primary" onClick={confirmar} disabled={guardando || !elegidos.length}>
                  {guardando ? "Registrando…" : "Registrar devolución"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {ultimas.length > 0 && (
        <div className="dev-ultimas">
          <h3>Últimas devoluciones</h3>
          <div className="dev-lista">
            {ultimas.map((u) => (
              <div key={u.id} className="dev-fila dev-fila--hist">
                <span className="dev-insumo">
                  {u.insumo}
                  {u.tipo === "retornable" && <span className="dev-tag">va y vuelve</span>}
                  <small>Remito #{u.remito} · {u.servicio}</small>
                </span>
                <span className="dev-col-num">{u.cantidad} u.</span>
                <span className="dev-hist-meta">{u.motivo || "—"}{u.quien ? ` · ${u.quien}` : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
