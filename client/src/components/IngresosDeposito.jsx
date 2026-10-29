// client/src/components/IngresosDeposito.jsx
//
// Ingreso de mercadería: la única pantalla donde el stock SUBE.
//
// Son dos manos a propósito. El depósito controla lo que llegó y carga el
// remito: eso no toca el stock. Después compras compara ese remito con la
// factura del proveedor y la asocia; ahí sube el stock y queda el precio de
// compra. Si las cantidades no coinciden no se asocia, y el sistema dice en qué
// línea difiere: esa diferencia la resuelve una persona.
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import useDebounced from "../hooks/useDebounced";
import { formatMoney, formatNumber } from "../utils/format";

const hoy = () => new Date().toISOString().slice(0, 10);
const errorDe = (e) => e?.response?.data?.error || e?.message || "No se pudo completar la operación";

/* ===== Cargar un remito ya controlado ===== */
function FormRemito({ onListo, onCancelar }) {
  const [proveedor, setProveedor] = useState("");
  const [numero, setNumero] = useState("");
  const [fecha, setFecha] = useState(hoy());
  const [observaciones, setObservaciones] = useState("");
  const [items, setItems] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState("");

  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState([]);
  const qDeb = useDebounced(q, 200);

  useEffect(() => {
    let vivo = true;
    const termino = qDeb.trim();
    if (termino.length < 2) { setResultados([]); return; }
    api.get("/deposito/productos", { params: { q: termino } })
      .then(({ data }) => { if (vivo) setResultados(Array.isArray(data) ? data.slice(0, 8) : []); })
      .catch(() => { if (vivo) setResultados([]); });
    return () => { vivo = false; };
  }, [qDeb]);

  const agregar = (p) => {
    const pid = Number(p.id);
    setItems((prev) => prev.some((it) => it.productoId === pid)
      ? prev.map((it) => it.productoId === pid ? { ...it, cantidad: Number(it.cantidad) + 1 } : it)
      : [...prev, { productoId: pid, nombre: p.name ?? "", codigo: p.code ?? "", stock: Number(p.stock ?? 0), cantidad: 1 }]);
    setQ(""); setResultados([]);
  };

  const puedeGuardar = proveedor.trim() && numero.trim() && items.length > 0
    && items.every((it) => Number(it.cantidad) > 0);

  const guardar = async () => {
    setGuardando(true); setErr("");
    try {
      await api.post("/deposito/ingresos", {
        proveedor: proveedor.trim(), numero: numero.trim(), fecha, observaciones: observaciones.trim(),
        items: items.map((it) => ({ productoId: it.productoId, cantidad: Math.trunc(Number(it.cantidad)) })),
      });
      onListo(`Remito ${numero.trim()} cargado. El stock sube cuando se asocie la factura.`);
    } catch (e) {
      setErr(errorDe(e));
    } finally { setGuardando(false); }
  };

  return (
    <div className="deposito-items-panel">
      <div className="deposito-items-title">Cargar un remito que ya controlaste</div>

      {err && <div className="state error" style={{ marginBottom: 8 }}>{err}</div>}

      <div className="dev-confirmar">
        <label className="deposito-field" style={{ flex: "1 1 220px" }}>
          <span>Proveedor</span>
          <input className="deposito-search" value={proveedor} style={{ maxWidth: "none", width: "100%" }}
            onChange={(e) => setProveedor(e.target.value)} />
        </label>
        <label className="deposito-field" style={{ flex: "0 1 160px" }}>
          <span>N° de remito</span>
          <input className="deposito-search" value={numero} style={{ maxWidth: "none", width: "100%" }}
            onChange={(e) => setNumero(e.target.value)} />
        </label>
        <label className="deposito-field" style={{ flex: "0 1 150px" }}>
          <span>Fecha</span>
          <input className="deposito-search" type="date" value={fecha} style={{ maxWidth: "none", width: "100%" }}
            onChange={(e) => setFecha(e.target.value)} />
        </label>
        <label className="deposito-field" style={{ flex: "1 1 220px" }}>
          <span>Observaciones</span>
          <input className="deposito-search" value={observaciones} placeholder="llegó golpeado, falta un bulto…"
            style={{ maxWidth: "none", width: "100%" }} onChange={(e) => setObservaciones(e.target.value)} />
        </label>
      </div>

      <table className="deposito-items-table" style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th scope="col">Código</th>
            <th scope="col">Insumo</th>
            <th scope="col" className="numeric" style={{ width: 110 }} title="Lo que contaste que llegó">
              Llegó
            </th>
            <th scope="col" className="numeric" style={{ width: 90 }}>Stock hoy</th>
            <th scope="col" style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.productoId}>
              <td>{it.codigo ? <span className="deposito-code">{it.codigo}</span> : "—"}</td>
              <td>{it.nombre}</td>
              <td className="numeric">
                <input type="number" min="1" value={it.cantidad} style={{ width: 80, textAlign: "right" }}
                  onChange={(e) => setItems((prev) => prev.map((x) =>
                    x.productoId === it.productoId ? { ...x, cantidad: e.target.value } : x))} />
              </td>
              <td className="numeric">{formatNumber(it.stock)}</td>
              <td style={{ textAlign: "center" }}>
                <button type="button" className="pill pill--ghost" title="Quitar"
                  style={{ padding: "2px 8px", color: "#b91c1c" }}
                  onClick={() => setItems((prev) => prev.filter((x) => x.productoId !== it.productoId))}>✕</button>
              </td>
            </tr>
          ))}
          {!items.length && (
            <tr><td colSpan={5} style={{ color: "#6b7280" }}>Buscá abajo los insumos que llegaron.</td></tr>
          )}
        </tbody>
      </table>

      <div style={{ position: "relative", marginTop: 10, maxWidth: 520 }}>
        <input type="search" className="deposito-search" style={{ width: "100%" }} autoComplete="off"
          placeholder="Agregar insumo: buscar por nombre o código…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        {resultados.length > 0 && (
          <div style={{ position: "absolute", zIndex: 20, left: 0, right: 0, background: "#fff",
            border: "1px solid #d1d5db", borderRadius: 8, marginTop: 2, maxHeight: 280, overflowY: "auto",
            boxShadow: "0 8px 24px rgba(15,23,42,.12)" }}>
            {resultados.map((p) => (
              <button key={p.id} type="button" onClick={() => agregar(p)}
                style={{ display: "flex", gap: 10, width: "100%", border: 0, background: "#fff",
                  padding: "8px 12px", cursor: "pointer", textAlign: "left", borderBottom: "1px solid #f1f5f9" }}>
                <span style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: ".75rem", color: "#4b5563", minWidth: 74 }}>
                  {p.code || "—"}
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name}
                </span>
                <span style={{ fontSize: ".8rem", color: "#6b7280" }}>stock {formatNumber(p.stock ?? 0)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <span style={{ marginRight: "auto", fontSize: ".85rem", color: "#6b7280" }}>
          Cargar el remito no cambia el stock. Sube cuando compras asocie la factura.
        </span>
        <button type="button" className="pill pill--ghost" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </button>
        <button type="button" className="pill" onClick={guardar} disabled={!puedeGuardar || guardando}>
          {guardando ? "Cargando…" : "Cargar remito"}
        </button>
      </div>
    </div>
  );
}

/* ===== Asociar la factura: acá sube el stock ===== */
function PanelFactura({ detalle, onListo }) {
  const [numeroFactura, setNumeroFactura] = useState("");
  const [fechaFactura, setFechaFactura] = useState(hoy());
  // Arrancan iguales al remito: compras sólo toca lo que la factura diga distinto.
  const [lineas, setLineas] = useState(() => detalle.items.map((it) => ({
    itemId: it.id, nombre: it.nombre, codigo: it.codigo,
    delRemito: Number(it.cantidad), cantidad: String(it.cantidad), precioUnitario: "",
  })));
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState("");
  const [difs, setDifs] = useState([]);

  const escribir = (itemId, campo, val) =>
    setLineas((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, [campo]: val } : l)));

  const total = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.precioUnitario) || 0), 0);
  const puedeAsociar = numeroFactura.trim() && lineas.every((l) => Number(l.cantidad) > 0);

  const asociar = async () => {
    if (!window.confirm(`Se va a sumar al stock lo del remito ${detalle.numero}. ¿Seguir?`)) return;
    setGuardando(true); setErr(""); setDifs([]);
    try {
      const { data } = await api.post(`/deposito/ingresos/${detalle.id}/factura`, {
        numeroFactura: numeroFactura.trim(), fechaFactura,
        lineas: lineas.map((l) => ({
          itemId: l.itemId,
          cantidad: Number(l.cantidad),
          precioUnitario: l.precioUnitario === "" ? null : Number(l.precioUnitario),
        })),
      });
      onListo(`Factura asociada: entraron ${formatNumber(data.unidades)} unidades al stock.`);
    } catch (e) {
      setErr(errorDe(e));
      setDifs(e?.response?.data?.diferencias || []);
    } finally { setGuardando(false); }
  };

  return (
    <div className="deposito-items-panel">
      <div className="deposito-items-title">Conciliar con la factura del proveedor</div>
      <p className="deposito-footnote" style={{ marginTop: 0 }}>
        Remito {detalle.numero} de {detalle.proveedor}.
        {detalle.observaciones ? ` Observaciones: ${detalle.observaciones}` : ""}
      </p>

      {err && (
        <div className="state error" style={{ marginBottom: 8 }}>
          {err}
          {difs.length > 0 && (
            <ul style={{ margin: "4px 0 0 18px" }}>
              {difs.map((d) => {
                const l = lineas.find((x) => x.itemId === d.itemId);
                return <li key={d.itemId}>{l?.nombre || `línea ${d.itemId}`}: el remito dice {formatNumber(d.remito)}, la factura {formatNumber(d.factura)}</li>;
              })}
            </ul>
          )}
        </div>
      )}

      <div className="dev-confirmar">
        <label className="deposito-field" style={{ flex: "1 1 200px" }}>
          <span>N° de factura</span>
          <input className="deposito-search" value={numeroFactura} placeholder="A-0001-00001234"
            style={{ maxWidth: "none", width: "100%" }} onChange={(e) => setNumeroFactura(e.target.value)} />
        </label>
        <label className="deposito-field" style={{ flex: "0 1 150px" }}>
          <span>Fecha de la factura</span>
          <input className="deposito-search" type="date" value={fechaFactura}
            style={{ maxWidth: "none", width: "100%" }} onChange={(e) => setFechaFactura(e.target.value)} />
        </label>
      </div>

      <table className="deposito-items-table" style={{ marginTop: 10 }}>
        <thead>
          {/* Sin columna de código: compras matchea por nombre contra la
              factura de papel, y en el celular cada columna de más empuja los
              campos que hay que tipear fuera de la pantalla. */}
          <tr>
            <th scope="col">Insumo</th>
            <th scope="col" className="numeric" style={{ width: 80 }}>Remito</th>
            <th scope="col" className="numeric" style={{ width: 90 }} title="Lo que dice la factura. Tiene que coincidir con el remito.">
              Factura
            </th>
            <th scope="col" className="numeric" style={{ width: 110 }}>Precio</th>
            <th scope="col" className="numeric">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {lineas.map((l) => {
            const difiere = Number(l.cantidad) !== l.delRemito;
            return (
              <tr key={l.itemId}>
                <td>{l.nombre}</td>
                <td className="numeric">{formatNumber(l.delRemito)}</td>
                <td className="numeric">
                  <input type="number" min="1" value={l.cantidad}
                    onChange={(e) => escribir(l.itemId, "cantidad", e.target.value)}
                    style={{ width: 80, textAlign: "right", color: difiere ? "#b91c1c" : undefined,
                      fontWeight: difiere ? 700 : undefined }} />
                </td>
                <td className="numeric">
                  <input type="number" min="0" step="0.01" value={l.precioUnitario}
                    onChange={(e) => escribir(l.itemId, "precioUnitario", e.target.value)}
                    style={{ width: 100, textAlign: "right" }} />
                </td>
                <td className="numeric">
                  {formatMoney((Number(l.cantidad) || 0) * (Number(l.precioUnitario) || 0))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
        <strong style={{ marginRight: "auto" }}>Total: {formatMoney(total)}</strong>
        <button type="button" className="pill" onClick={asociar} disabled={!puedeAsociar || guardando}
          style={{ background: "#16a34a", borderColor: "#15803d" }}>
          {guardando ? "Asociando…" : "Asociar factura y subir el stock"}
        </button>
      </div>
      <div style={{ marginTop: 6, fontSize: ".82rem", color: "#6b7280" }}>
        Si una cantidad no coincide con el remito, no se asocia: el sistema avisa en qué línea.
      </div>
    </div>
  );
}

/* ===== Pantalla ===== */
export default function IngresosDeposito() {
  const [rows, setRows] = useState([]);
  const [estado, setEstado] = useState("cargado");
  const [cargando, setCargando] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [nuevo, setNuevo] = useState(false);
  const [detalle, setDetalle] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const { data } = await api.get("/deposito/ingresos", { params: { estado: estado || undefined } });
      setRows(data?.rows ?? []);
      setErr("");
    } catch (e) {
      setErr(errorDe(e));
    } finally { setCargando(false); }
  }, [estado]);

  useEffect(() => { cargar(); }, [cargar]);

  const abrir = async (id) => {
    if (detalle?.id === id) { setDetalle(null); return; }
    setErr("");
    try {
      const { data } = await api.get(`/deposito/ingresos/${id}`);
      setDetalle(data);
    } catch (e) { setErr(errorDe(e)); }
  };

  const listo = (texto) => { setMsg(texto); setNuevo(false); setDetalle(null); cargar(); };

  return (
    <div>
      <div className="dep-topbar">
        <h2 className="deposito-title">Ingreso de mercadería</h2>
        <div className="deposito-header-actions">
          {/* "Conciliar", no "facturar": acá no se emite nada, se toman los
              datos de la factura del proveedor y se comparan con el remito. */}
          {[["cargado", "Sin conciliar"], ["facturado", "Conciliados"], ["", "Todos"]].map(([k, l]) => (
            <button key={k || "todos"} type="button"
              className={`pill${estado === k ? "" : " pill--ghost"}`}
              onClick={() => { setEstado(k); setDetalle(null); }}>{l}</button>
          ))}
          <button type="button" className="pill pill--ghost" onClick={cargar} disabled={cargando}>
            {cargando ? "Actualizando…" : "Actualizar"}
          </button>
          <button type="button" className="pill" onClick={() => { setNuevo((v) => !v); setDetalle(null); setMsg(""); }}>
            {nuevo ? "Cerrar" : "Cargar remito"}
          </button>
        </div>
      </div>

      <p className="deposito-footnote">
        El depósito controla lo que llegó y carga el remito. El stock sube recién cuando
        compras asocia la factura y las cantidades coinciden. Hasta entonces la mercadería
        está en el estante pero no en el sistema.
      </p>

      {err && <div className="state error deposito-state">{err}</div>}
      {msg && <div className="state deposito-state">{msg}</div>}

      {nuevo && <FormRemito onListo={listo} onCancelar={() => setNuevo(false)} />}

      {/* El panel del remito abierto va acá y no dentro de la tabla: la tabla
          scrollea a lo ancho, y en el celular el panel se iba con ella — se
          tipeaban cantidades sin ver a qué insumo correspondían. */}
      {detalle && (detalle.estado === "cargado"
        ? <PanelFactura key={detalle.id} detalle={detalle} onListo={listo} />
        : (
          <div className="deposito-items-panel">
            <div className="deposito-items-title">
              Factura {detalle.factura_numero} · el stock ya subió
            </div>
            <p className="deposito-footnote" style={{ marginTop: 0 }}>
              Remito {detalle.numero} de {detalle.proveedor}.
              {detalle.observaciones ? ` Observaciones: ${detalle.observaciones}` : ""}
            </p>
            <table className="deposito-items-table">
              <thead>
                <tr>
                  <th scope="col">Código</th>
                  <th scope="col">Insumo</th>
                  <th scope="col" className="numeric">Cantidad</th>
                  <th scope="col" className="numeric">Precio unitario</th>
                  <th scope="col" className="numeric">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {detalle.items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.codigo ? <span className="deposito-code">{it.codigo}</span> : "—"}</td>
                    <td>{it.nombre}</td>
                    <td className="numeric">{formatNumber(it.cantidad)}</td>
                    <td className="numeric">{it.precioUnitario == null ? "—" : formatMoney(it.precioUnitario)}</td>
                    <td className="numeric">
                      {it.precioUnitario == null ? "—" : formatMoney(it.cantidad * it.precioUnitario)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      <div className="deposito-table-wrapper">
        <table className="deposito-table" aria-label="Remitos de proveedores">
          <thead>
            <tr>
              <th scope="col">Proveedor</th>
              <th scope="col">Remito</th>
              <th scope="col">Fecha</th>
              <th scope="col" className="deposito-th--numeric">Insumos</th>
              <th scope="col" className="deposito-th--numeric">Unidades</th>
              <th scope="col">Factura</th>
              <th scope="col" style={{ width: 160 }}></th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && !cargando && (
              <tr><td colSpan={7} className="deposito-empty">
                {estado === "cargado" ? "No hay remitos esperando factura." : "No hay remitos cargados."}
              </td></tr>
            )}
            {rows.map((r) => {
              const puestoEnPantalla = detalle?.id === r.id;
              return (
                <tr key={r.id} className={`deposito-row${puestoEnPantalla ? " deposito-row--expanded" : ""}`}>
                  <td>{r.proveedor}</td>
                  <td><span className="deposito-code">{r.numero}</span></td>
                  {/* La fecha se guardó como texto YYYY-MM-DD: se muestra tal cual,
                      sin pasar por Date, que la correría por zona horaria. */}
                  <td>{r.fecha}</td>
                  <td className="deposito-td--numeric">{formatNumber(r.lineas)}</td>
                  <td className="deposito-td--numeric">{formatNumber(r.unidades)}</td>
                  <td>
                    {r.facturaNumero
                      ? <span style={{ color: "#166534", fontWeight: 600 }}>{r.facturaNumero}</span>
                      : <span style={{ color: "#b45309" }}>sin factura</span>}
                  </td>
                  <td>
                    <div className="deposito-header-actions" style={{ justifyContent: "flex-end" }}>
                      <button type="button" className={puestoEnPantalla ? "pill pill--ghost" : "pill"}
                        onClick={() => abrir(r.id)}>
                        {puestoEnPantalla ? "Cerrar" : r.estado === "cargado" ? "Conciliar" : "Ver"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}