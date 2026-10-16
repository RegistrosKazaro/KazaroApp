// client/src/components/PreparacionDeposito.jsx
//
// Preparación de pedidos con pistola lectora.
//
// Dos modos, según por dónde se entre:
//
//   modo="jefe"      dentro del panel de Depósito. Ve toda la cola, quién tiene
//                    qué, y reparte los pedidos pendientes.
//   modo="operario"  el que entra con rol Picking. Cae acá directo, ve SÓLO sus
//                    pedidos y no elige nada: la app ya sabe quién es.
//
// Cada preparador es un usuario con rol Picking, así que no hay ningún
// desplegable de "quién sos": lo dice la sesión. Los endpoints también lo
// resuelven del lado del servidor, no de lo que mande la pantalla.
//
// Sobre los estilos: esta pantalla se usa adentro del panel Y sola, en su
// propia ruta. Todo el diseño del depósito cuelga de .admin-panel y
// .deposito-page, así que las hojas se importan acá y el contenedor lleva esas
// clases. Si no, fuera del panel los botones quedan blancos sobre blanco.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import EscanerCamara, { hayCamara } from "./EscanerCamara";
import "../styles/admin-panel.css";
import "../styles/deposito.css";

const nro = (id) => `#${String(id).padStart(7, "0")}`;

/** Lo que se muestra cuando un escaneo entra o rebota. */
function Cartel({ aviso, onCerrar }) {
  if (!aviso) return null;
  return (
    <div role="status" className={`state deposito-state${aviso.ok ? "" : " error"}`}
         style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <strong style={{ fontSize: 18 }}>{aviso.ok ? "✔" : "✕"}</strong>
      <span style={{ flex: 1 }}>{aviso.texto}</span>
      <button type="button" className="pill pill--ghost" onClick={onCerrar}>Cerrar</button>
    </div>
  );
}

/** La barra de avance de una línea, con los mismos bloques que el panel. */
function Barra({ hecho, total }) {
  const pct = total > 0 ? Math.min(100, (hecho / total) * 100) : 0;
  const completa = hecho >= total;
  return (
    <div className="deposito-stockbar" title={`${hecho} de ${total}`}>
      <div className="deposito-stockbar-fill"
           style={{ width: `${pct}%`, background: completa ? "#16a34a" : "#2563eb" }} />
    </div>
  );
}

export default function PreparacionDeposito({ modo = "jefe" }) {
  const soyJefe = modo !== "operario";

  const [preparadores, setPreparadores] = useState([]);
  const [cola, setCola] = useState([]);
  const [abierto, setAbierto] = useState(null);     // { pedido, lineas, avance }
  const [aviso, setAviso] = useState(null);
  const [destacada, setDestacada] = useState(null); // productoId que acaba de sumar
  const [err, setErr] = useState("");
  const [cargando, setCargando] = useState(false);
  const escaneoRef = useRef(null);
  // La cámara es el respaldo de la pistola; el botón sólo aparece si el
  // equipo la soporta (Android sí, iPhone no).
  const [camara, setCamara] = useState(false);

  /* ---------- Carga ---------- */

  const cargarPreparadores = useCallback(async () => {
    if (!soyJefe) return;
    try {
      const { data } = await api.get("/deposito/preparadores");
      setPreparadores(data?.preparadores ?? []);
    } catch (e) { setErr(e?.response?.data?.error || e.message); }
  }, [soyJefe]);

  const cargarCola = useCallback(async () => {
    setCargando(true);
    try {
      // El operario no manda a quién pedir: el servidor usa su sesión. Si lo
      // mandara, con cambiar el número vería la cola de otro.
      const { data } = await api.get("/deposito/preparacion");
      setCola(data?.pedidos ?? []);
      setErr("");
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally { setCargando(false); }
  }, []);

  useEffect(() => { cargarPreparadores(); }, [cargarPreparadores]);
  useEffect(() => { cargarCola(); }, [cargarCola]);

  /* ---------- Abrir un pedido ---------- */

  const abrir = async (id) => {
    try {
      const { data } = await api.get(`/deposito/orders/${id}/picking`);
      setAbierto(data);
      setAviso(null);
      setTimeout(() => escaneoRef.current?.focus(), 50);
    } catch (e) { setErr(e?.response?.data?.error || e.message); }
  };

  const cerrarPedido = () => { setAbierto(null); setAviso(null); cargarCola(); };

  /* ---------- El escaneo ---------- */

  const escanear = async (codigo) => {
    const limpio = String(codigo || "").trim();
    if (!limpio || !abierto) return;
    try {
      const { data } = await api.post(`/deposito/orders/${abierto.pedido.id}/picking/escanear`,
                                      { codigoBarra: limpio });
      if (data.ok) {
        setAbierto((prev) => ({
          ...prev,
          avance: data.avance,
          lineas: prev.lineas.map((l) =>
            l.productoId === data.linea.productoId ? { ...l, preparada: data.linea.preparada } : l),
        }));
        setDestacada(data.linea.productoId);
        setTimeout(() => setDestacada(null), 800);
        setAviso({ ok: true, texto: `${data.insumo.nombre} — ${data.linea.preparada} de ${data.linea.pedida}` });
      } else {
        setAbierto((prev) => ({ ...prev, avance: data.avance ?? prev.avance }));
        setAviso({ ok: false, texto: data.error });
      }
    } catch (e) {
      setAviso({ ok: false, texto: e?.response?.data?.error || e.message });
    }
  };

  /* ---------- Carga a mano ---------- */

  const cambiarCantidad = (productoId, valor) => {
    setAbierto((prev) => ({
      ...prev,
      lineas: prev.lineas.map((l) => (l.productoId === productoId ? { ...l, preparada: valor } : l)),
    }));
  };

  const guardarManual = async () => {
    if (!abierto) return;
    try {
      const { data } = await api.put(`/deposito/orders/${abierto.pedido.id}/picking`, {
        items: abierto.lineas.map((l) => ({
          productoId: l.productoId,
          cantidadPreparada: Number(l.preparada) || 0,
        })),
      });
      setAbierto((prev) => ({ ...prev, lineas: data.lineas, avance: data.avance }));
      setAviso(data.ok
        ? { ok: true, texto: "Guardado." }
        : { ok: false, texto: data.errores.join(" ") });
    } catch (e) { setAviso({ ok: false, texto: e?.response?.data?.error || e.message }); }
  };

  const terminar = async () => {
    if (!abierto) return;
    const a = abierto.avance;
    const falta = Math.max(0, a.unidadesPedidas - a.unidadesPreparadas);
    if (!a.completo && !window.confirm(
      `Preparaste ${a.unidadesPreparadas} de ${a.unidadesPedidas} unidades.\n\n`
      + `Las ${falta} que faltan van a quedar PENDIENTES: no se le cobran al `
      + `servicio y se entregan cuando haya stock.\n\n¿Confirmás?`
    )) return;
    try {
      await api.put(`/deposito/orders/${abierto.pedido.id}/picking/terminar`);
      cerrarPedido();
    } catch (e) { setAviso({ ok: false, texto: e?.response?.data?.error || e.message }); }
  };

  /* ---------- Jefe ---------- */

  const desasignar = async (id) => {
    try {
      await api.put(`/deposito/orders/${id}/desasignar`);
      cargarCola();
    } catch (e) { setErr(e?.response?.data?.error || e.message); }
  };

  const devolver = async (id) => {
    try {
      await api.put(`/deposito/orders/${id}/picking/reabrir`);
      cargarCola();
    } catch (e) { setErr(e?.response?.data?.error || e.message); }
  };

  /* ================= Pedido abierto: el picking ================= */

  if (abierto) {
    const { pedido, lineas, avance } = abierto;
    return (
      <section className="admin-panel deposito-page">
        <div className="dep-topbar">
          <h1 className="deposito-title">
            {nro(pedido.id)} · {pedido.servicio || "Sin servicio"}
          </h1>
          <button type="button" className="pill pill--ghost" onClick={cerrarPedido}>
            ← Volver a la lista
          </button>
        </div>

        <div className="dep-order-kpis">
          <div className="dep-order-kpi dep-order-kpi--prep">
            <span className="dep-order-kpi-num">{avance.unidadesPreparadas}</span>
            <span className="dep-order-kpi-lbl">de {avance.unidadesPedidas} unidades</span>
          </div>
          <div className={`dep-order-kpi ${avance.completo ? "dep-order-kpi--closed" : "dep-order-kpi--open"}`}>
            <span className="dep-order-kpi-num">{avance.lineasCompletas}</span>
            <span className="dep-order-kpi-lbl">de {avance.lineas} insumos</span>
          </div>
        </div>

        <label className="deposito-field" style={{ margin: "12px 0" }}>
          <span>Escaneá el insumo con la pistola</span>
          <input
            ref={escaneoRef}
            className="deposito-search"
            placeholder="Código del insumo"
            autoFocus
            // .deposito-search viene con max-width 220px, pensado para los
            // filtros. Acá es el campo principal: tiene que ocupar todo.
            style={{ width: "100%", maxWidth: "none", fontSize: 18, padding: "12px 14px" }}
            // La pistola escribe el código y manda Enter. No usamos un <form>
            // para que ese Enter no dispare nada más.
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              escanear(e.currentTarget.value);
              e.currentTarget.value = "";
            }}
            // Si alguien toca otra cosa, el foco vuelve solo: en una tablet es
            // facilísimo perderlo y que los escaneos se pierdan en el aire.
            onBlur={(e) => { if (!e.relatedTarget) setTimeout(() => escaneoRef.current?.focus(), 150); }}
          />
        </label>

        {hayCamara() && !camara && (
          <button type="button" className="pill pill--ghost" onClick={() => setCamara(true)}
                  style={{ marginBottom: 10 }}>
            Escanear con la cámara
          </button>
        )}
        {camara && <EscanerCamara onCodigo={escanear} onCerrar={() => setCamara(false)} />}

        <Cartel aviso={aviso} onCerrar={() => setAviso(null)} />

        {/* tabla-ficha: en el celular cada fila se vuelve una ficha, porque
            el picking se usa caminando entre las estanterías. */}
        <div className="deposito-table-wrapper tabla-ficha">
          <table className="deposito-table" aria-label="Insumos del pedido">
            <thead>
              <tr>
                <th scope="col">Insumo</th>
                <th scope="col" className="deposito-th--numeric">Preparado</th>
                <th scope="col" className="deposito-th--numeric">Pedido</th>
                <th scope="col" style={{ width: 160 }}>Avance</th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l) => {
                const completa = Number(l.preparada) >= Number(l.pedida);
                return (
                  <tr key={l.productoId} className="deposito-row"
                      style={{
                        // Ámbar: el flash de la línea que acaba de sumar.
                        // Verde: ya está completa.
                        background: destacada === l.productoId ? "#fef3c7"
                                  : completa ? "#f0fdf4" : undefined,
                        transition: "background .4s",
                      }}>
                    <td>
                      <div className="deposito-product-cell">
                        <span className="deposito-product-name">{l.nombre}</span>
                        <span className="deposito-product-code">
                          {l.codigo ? `Cód. ${l.codigo}` : "Sin código"}
                          {!l.codigoBarra && " · ✋ cargar a mano"}
                        </span>
                      </div>
                    </td>
                    <td className="deposito-td--numeric" data-rotulo="Preparado">
                      <input
                        type="number"
                        className="deposito-search pick-cant"
                        min={0}
                        max={l.pedida}
                        value={l.preparada}
                        onChange={(e) => cambiarCantidad(l.productoId, e.target.value)}
                        style={{ width: 90, minWidth: 0, textAlign: "right",
                                 fontWeight: 700, fontSize: 16 }}
                        aria-label={`Preparado de ${l.nombre}`}
                      />
                    </td>
                    <td className="deposito-td--numeric" data-rotulo="Se pidió">{l.pedida}</td>
                    <td><Barra hecho={Number(l.preparada) || 0} total={Number(l.pedida)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="deposito-header-actions" style={{ marginTop: 12, justifyContent: "flex-end" }}>
          <button type="button" className="pill pill--ghost" onClick={guardarManual}>
            Guardar cantidades
          </button>
          <button type="button" className="pill" onClick={terminar}>
            {avance.completo ? "Terminé, está completo" : "Terminé (incompleto)"}
          </button>
        </div>
      </section>
    );
  }

  /* ================= La cola ================= */

  return (
    <section className="admin-panel deposito-page">
      <div className="dep-topbar">
        <h1 className="deposito-title">
          {soyJefe ? "Preparación de pedidos" : "Mis pedidos para preparar"}
        </h1>
        <button type="button" className="pill pill--ghost" onClick={cargarCola} disabled={cargando}>
          {cargando ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      {err && <div className="state error deposito-state">{err}</div>}

      {soyJefe && <AsignarPedido preparadores={preparadores} onListo={cargarCola} />}

      <div className="deposito-table-wrapper tabla-ficha">
        <table className="deposito-table" aria-label="Pedidos en preparación">
          <thead>
            <tr>
              <th scope="col">Pedido</th>
              <th scope="col">Servicio</th>
              {soyJefe && <th scope="col">Preparador</th>}
              <th scope="col" className="deposito-th--numeric">Avance</th>
              <th scope="col" style={{ width: 280 }}></th>
            </tr>
          </thead>
          <tbody>
            {!cola.length && !cargando && (
              <tr>
                <td colSpan={soyJefe ? 5 : 4} className="deposito-empty">
                  {soyJefe
                    ? "No hay pedidos asignados todavía. Elegí uno de la lista de arriba y repartilo."
                    : "No tenés pedidos asignados. Pedile al jefe que te asigne."}
                </td>
              </tr>
            )}
            {cola.map((p) => {
              const terminado = !!p.terminadaAt;
              return (
                <tr key={p.id} className="deposito-row"
                    style={terminado ? { background: "#f0fdf4" } : undefined}>
                  <td>
                    <span className="deposito-code">{nro(p.id)}</span>
                    {terminado && (
                      <div className="deposito-retirado-tag">terminado</div>
                    )}
                  </td>
                  <td className="deposito-service-name">{p.servicio || "Sin servicio"}</td>
                  {soyJefe && <td>{p.preparador}</td>}
                  <td className="deposito-td--numeric">
                    <div style={{ fontWeight: 700 }}>
                      {p.unidadesPreparadas} / {p.unidadesPedidas}
                    </div>
                    <div className="deposito-subtext">
                      {p.lineasCompletas} de {p.lineas} insumos
                    </div>
                  </td>
                  <td>
                    <div className="deposito-header-actions" style={{ justifyContent: "flex-end" }}>
                      <button type="button" className="pill" onClick={() => abrir(p.id)}>
                        {terminado ? "Ver" : "Preparar"}
                      </button>
                      {soyJefe && terminado && (
                        <button type="button" className="pill pill--ghost" onClick={() => devolver(p.id)}
                                title="Devolvérselo al preparador para que lo siga">
                          Devolver
                        </button>
                      )}
                      {soyJefe && (
                        <button type="button" className="pill pill--ghost" onClick={() => desasignar(p.id)}
                                title="Sacárselo para dárselo a otro. Lo que ya separó no se pierde.">
                          Desasignar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * El jefe reparte. La lista son los pedidos de la solapa Pendientes que
 * todavía no tienen dueño; al asignar uno, pasa solo a En preparación y
 * desaparece de acá.
 */
function AsignarPedido({ preparadores, onListo }) {
  const [pendientes, setPendientes] = useState([]);
  const [cual, setCual] = useState("");
  const [quien, setQuien] = useState("");
  const [msg, setMsg] = useState("");

  const cargar = useCallback(async () => {
    try {
      const { data } = await api.get("/deposito/preparacion/asignables");
      setPendientes(data?.pedidos ?? []);
    } catch (e) { setMsg(e?.response?.data?.error || e.message); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const asignar = async () => {
    if (!cual || !quien) { setMsg("Elegí el pedido y a quién se lo asignás."); return; }
    try {
      const { data } = await api.put(`/deposito/orders/${cual}/asignar`, { preparadorId: Number(quien) });
      setMsg(`Pedido ${nro(cual)} asignado a ${data.preparador}.`);
      setCual("");
      cargar();
      onListo();
    } catch (e) { setMsg(e?.response?.data?.error || e.message); }
  };

  return (
    <div className="filters deposito-filters">
      <label className="deposito-field" style={{ minWidth: 320, flex: "1 1 320px" }}>
        <span>Pedido a asignar ({pendientes.length} pendientes)</span>
        <select className="deposito-select" value={cual} onChange={(e) => setCual(e.target.value)}>
          <option value="">— Elegí el pedido —</option>
          {pendientes.map((p) => (
            <option key={p.id} value={p.id}>
              {nro(p.id)} · {p.servicio || "Sin servicio"} ({p.lineas} insumos)
            </option>
          ))}
        </select>
      </label>

      <label className="deposito-field" style={{ minWidth: 220 }}>
        <span>Preparador</span>
        <select className="deposito-select" value={quien} onChange={(e) => setQuien(e.target.value)}>
          <option value="">— Elegí preparador —</option>
          {preparadores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </label>

      <div className="deposito-header-actions">
        <button type="button" className="pill" onClick={asignar}>Asignar</button>
      </div>

      {msg && <div className="deposito-footnote" style={{ flexBasis: "100%" }}>{msg}</div>}
      {!preparadores.length && (
        <div className="deposito-footnote" style={{ flexBasis: "100%" }}>
          No hay nadie con rol Picking. Creá el usuario del operario en Empleados
          y asignale ese rol.
        </div>
      )}
    </div>
  );
}
