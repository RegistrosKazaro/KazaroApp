// client/src/components/RemanentesDeposito.jsx
//
// Remanentes: lo que volvió abierto, usado o roto y NO entró al stock general.
//
// Un bidón devuelto por la mitad no es un bidón lleno, así que mezclarlo con
// el stock de siempre lo deformaba. Queda acá hasta que alguien lo mire y
// decida: si sirve, pasa al stock; si no, se descarta. Sin esas dos puertas
// esto sería un pozo donde todo entra y nada sale.
//
// Mover un remanente NO cambia el consumo del servicio: eso ya se decidió
// cuando se cargó la devolución.
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { formatMoney, formatNumber } from "../utils/format";

export default function RemanentesDeposito() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState({ unidades: 0, monto: 0 });
  const [cargando, setCargando] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [abierto, setAbierto] = useState(null);   // productoId en el que se está trabajando
  const [cant, setCant] = useState("");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const { data } = await api.get("/deposito/remanentes");
      setRows(data?.rows ?? []);
      setTotal({ unidades: data?.unidades ?? 0, monto: data?.monto ?? 0 });
      setErr("");
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally { setCargando(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const empezar = (fila) => {
    setAbierto(fila.productoId);
    setCant(String(fila.remanente));   // lo más común es mover todo
    setMotivo("");
    setMsg("");
  };

  const mover = async (fila, accion) => {
    setGuardando(true); setErr("");
    try {
      const { data } = await api.put(`/deposito/remanentes/${fila.productoId}`, {
        accion, cantidad: Number(cant), motivo: motivo.trim(),
      });
      setMsg(accion === "al_stock"
        ? `${formatNumber(data.cantidad)} u. de ${fila.nombre} pasaron al stock.`
        : `${formatNumber(data.cantidad)} u. de ${fila.nombre} se descartaron.`);
      setAbierto(null);
      cargar();
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally { setGuardando(false); }
  };

  return (
    <div>
      <div className="dep-topbar">
        <h2 className="deposito-title">Remanentes</h2>
        <button type="button" className="pill pill--ghost" onClick={cargar} disabled={cargando}>
          {cargando ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      <p className="deposito-footnote">
        Lo que volvió abierto, usado o roto espera acá a que lo revises. Si sirve, pasalo
        al stock; si no, descartalo. El consumo del servicio no cambia: eso ya se decidió
        al cargar la devolución.
      </p>

      {err && <div className="state error deposito-state">{err}</div>}
      {msg && <div className="state deposito-state">{msg}</div>}

      {rows.length > 0 && (
        <div className="dep-order-kpis">
          <div className="dep-order-kpi dep-order-kpi--open">
            <span className="dep-order-kpi-num">{formatNumber(total.unidades)}</span>
            <span className="dep-order-kpi-lbl">unidades en remanentes</span>
          </div>
          <div className="dep-order-kpi dep-order-kpi--prep">
            <span className="dep-order-kpi-num">{formatMoney(total.monto)}</span>
            <span className="dep-order-kpi-lbl">valorizado</span>
          </div>
        </div>
      )}

      <div className="deposito-table-wrapper">
        <table className="deposito-table" aria-label="Insumos en remanentes">
          <thead>
            <tr>
              <th scope="col">Insumo</th>
              <th scope="col" className="deposito-th--numeric">En remanentes</th>
              <th scope="col" className="deposito-th--numeric">Stock general</th>
              <th scope="col" style={{ width: 320 }}></th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && !cargando && (
              <tr><td colSpan={4} className="deposito-empty">
                No hay nada en remanentes.
              </td></tr>
            )}
            {rows.map((r) => {
              const revisando = abierto === r.productoId;
              return [
                <tr key={r.productoId}
                    className={`deposito-row${revisando ? " deposito-row--expanded" : ""}`}>
                  <td>
                    <div className="deposito-product-cell">
                      <span className="deposito-product-name">{r.nombre}</span>
                      <span className="deposito-product-code">
                        {r.codigo ? `Cód. ${r.codigo}` : "Sin código"}
                        {r.precio > 0 && ` · ${formatMoney(r.remanente * r.precio)}`}
                      </span>
                    </div>
                  </td>
                  <td className="deposito-td--numeric" style={{ fontWeight: 700 }}>
                    {formatNumber(r.remanente)}
                  </td>
                  <td className="deposito-td--numeric">{formatNumber(r.stock)}</td>
                  <td>
                    <div className="deposito-header-actions" style={{ justifyContent: "flex-end" }}>
                      <button type="button" className={revisando ? "pill pill--ghost" : "pill"}
                        onClick={() => (revisando ? setAbierto(null) : empezar(r))}>
                        {revisando ? "Cancelar" : "Revisar"}
                      </button>
                    </div>
                  </td>
                </tr>,

                // Los controles van abajo y a todo el ancho: cinco cosas no
                // entran en la columna de acciones sin quedar apretadas.
                revisando && (
                  <tr key={`${r.productoId}-rev`} className="deposito-row--items-container">
                    <td colSpan={4}>
                      <div className="dev-confirmar">
                        <label className="deposito-field" style={{ minWidth: 110 }}>
                          <span>Cuántas de {formatNumber(r.remanente)}</span>
                          <input className="deposito-search" type="text" inputMode="numeric"
                            value={cant} aria-label={`Cuántas unidades de ${r.nombre}`}
                            style={{ width: 100, minWidth: 0, textAlign: "right" }}
                            onChange={(e) => setCant(e.target.value.replace(/\D/g, ""))} />
                        </label>
                        <label className="deposito-field" style={{ flex: "1 1 240px" }}>
                          <span>Motivo (obligatorio para descartar)</span>
                          <input className="deposito-search" value={motivo}
                            aria-label={`Motivo para ${r.nombre}`}
                            placeholder="vencido, roto, se perdió…"
                            style={{ maxWidth: "none", width: "100%" }}
                            onChange={(e) => setMotivo(e.target.value)} />
                        </label>
                        <button type="button" className="pill" disabled={guardando}
                          onClick={() => mover(r, "al_stock")}
                          title="Sirve: se suma al stock general">
                          Al stock
                        </button>
                        <button type="button" className="pill pill--ghost" disabled={guardando}
                          onClick={() => mover(r, "descartar")}
                          style={{ borderColor: "#b91c1c", color: "#b91c1c" }}
                          title="No sirve: se da de baja. Hay que decir por qué.">
                          Descartar
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
