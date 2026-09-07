// client/src/components/PapeleraPedidos.jsx
//
// Pedidos borrados. Siguen en la base y se pueden recuperar; el borrado
// definitivo los saca del todo, junto con su detalle, para liberar espacio.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { formatMoney, formatNumber } from "../utils/format";
import { normalizeText } from "../utils/text";
import useDebounced from "../hooks/useDebounced";
import "../styles/papelera.css";

export default function PapeleraPedidos() {
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(null);   // id en proceso
  const [q, setQ] = useState("");
  const qDeb = useDebounced(q, 250);

  const cargar = useCallback(async () => {
    setCargando(true); setError("");
    try {
      const { data: d } = await api.get("/deposito/papelera");
      setData(d);
    } catch (e) {
      setError(e?.response?.data?.error || "No se pudo leer la papelera.");
      setData(null);
    } finally { setCargando(false); }
  }, []);

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
      || normalizeText(p.borradoPor).includes(t)
    );
  }, [data, qDeb]);

  const restaurar = async (p) => {
    const extra = p.habiaDescontado
      ? "\n\nEste pedido ya había descontado stock, así que al restaurarlo se vuelve a descontar."
      : "";
    if (!window.confirm(`¿Restaurar el pedido #${p.numero}?${extra}`)) return;
    setOcupado(p.id); setAviso("");
    try {
      const { data: r } = await api.post(`/deposito/orders/${p.id}/restaurar`);
      let msg = `Pedido #${p.numero} restaurado.`;
      if (r.stockDescontado > 0) msg += ` Se volvieron a descontar ${formatNumber(r.stockDescontado)} unidades.`;
      if (r.descubierto?.length) {
        msg += ` Ojo: ${r.descubierto.map((f) => f.nombre).join(", ")} quedó sin stock suficiente.`;
      }
      setAviso(msg);
      await cargar();
    } catch (e) {
      setError(e?.response?.data?.error || "No se pudo restaurar el pedido.");
    } finally { setOcupado(null); }
  };

  const borrarDefinitivo = async (p) => {
    if (!window.confirm(
      `¿Borrar DEFINITIVAMENTE el pedido #${p.numero}?\n\n` +
      `Se elimina el pedido y todo su detalle. Esto NO se puede deshacer.`
    )) return;
    // Segunda confirmación: es irreversible.
    if (!window.confirm(`Última confirmación: el pedido #${p.numero} se borra para siempre.`)) return;
    setOcupado(p.id); setAviso("");
    try {
      await api.delete(`/deposito/orders/${p.id}/definitivo`);
      setAviso(`Pedido #${p.numero} borrado definitivamente.`);
      await cargar();
    } catch (e) {
      setError(e?.response?.data?.error || "No se pudo borrar definitivamente.");
    } finally { setOcupado(null); }
  };

  return (
    <div className="pap">
      <div>
        <h2 className="pap-title">Papelera</h2>
        <p className="pap-sub">
          Pedidos borrados. No cuentan en informes, pedidos ni control de despachos, pero
          siguen en la base: se pueden <strong>restaurar</strong>. El borrado definitivo los
          elimina junto con su detalle y <strong>no se puede deshacer</strong>.
        </p>
      </div>

      {!!data?.total && (
        <div className="pap-kpi">
          <span className="pap-kpi-n">{formatNumber(data.total)}</span>
          <span>pedidos en la papelera</span>
        </div>
      )}

      <input className="pap-search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por número, servicio, solicitante o quién lo borró…" />

      {aviso && <div className="state">{aviso}</div>}
      {error && <div className="state error">{error}</div>}

      {cargando ? <div className="pap-vacio">Cargando…</div>
        : pedidos.length === 0 ? (
          <div className="pap-vacio">
            {q ? "No hay pedidos que coincidan con la búsqueda." : "La papelera está vacía."}
          </div>
        ) : (
          <div className="pap-tabla-wrap">
            <table className="pap-tabla">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Servicio</th>
                  <th>Solicitante</th>
                  <th className="num">Items</th>
                  <th className="num">Unidades</th>
                  <th className="num">Total</th>
                  <th>Borrado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pedidos.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">
                      #{p.numero}
                      {p.habiaDescontado && (
                        <span className="pap-tag" title="Había descontado stock. Al restaurarlo se vuelve a descontar.">
                          movió stock
                        </span>
                      )}
                    </td>
                    <td>{p.servicio || <em className="pap-admin">Sin servicio</em>}</td>
                    <td>{p.solicitante || "—"}</td>
                    <td className="num">{formatNumber(p.items)}</td>
                    <td className="num">{formatNumber(p.unidades)}</td>
                    <td className="num">{formatMoney(p.total)}</td>
                    <td>
                      {p.borradoAr || "—"}
                      {p.borradoPor && <span className="pap-quien">por {p.borradoPor}</span>}
                    </td>
                    <td className="pap-acciones">
                      <button type="button" className="pap-btn" disabled={ocupado === p.id}
                        onClick={() => restaurar(p)}>
                        Restaurar
                      </button>
                      <button type="button" className="pap-btn pap-btn--peligro" disabled={ocupado === p.id}
                        onClick={() => borrarDefinitivo(p)}
                        title="Elimina el pedido y su detalle. No se puede deshacer.">
                        Borrar del todo
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}
