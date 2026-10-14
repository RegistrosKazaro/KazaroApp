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
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";

const nro = (id) => `#${String(id).padStart(7, "0")}`;

/** Lo que se muestra cuando un escaneo no entra. */
function Cartel({ aviso, onCerrar }) {
  if (!aviso) return null;
  const ok = aviso.ok;
  return (
    <div
      role="status"
      style={{
        padding: "10px 12px", borderRadius: 8, marginBottom: 10,
        background: ok ? "#dcfce7" : "#fee2e2",
        color: ok ? "#166534" : "#b91c1c",
        border: `1px solid ${ok ? "#86efac" : "#fca5a5"}`,
        display: "flex", alignItems: "center", gap: 10,
      }}
    >
      <strong style={{ fontSize: 18 }}>{ok ? "✔" : "✕"}</strong>
      <span style={{ flex: 1 }}>{aviso.texto}</span>
      <button type="button" className="pill pill--ghost" onClick={onCerrar}>Cerrar</button>
    </div>
  );
}

/** Una línea del pedido. La cantidad también se escribe a mano. */
function Linea({ linea, onCantidad, destacada }) {
  const completa = Number(linea.preparada) >= Number(linea.pedida);
  const pct = linea.pedida > 0 ? Math.min(100, (linea.preparada / linea.pedida) * 100) : 0;

  return (
    <div
      style={{
        padding: "10px 12px", borderBottom: "1px solid #e5e7eb",
        background: destacada ? "#fef9c3" : completa ? "#f0fdf4" : "transparent",
        transition: "background .4s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{linea.nombre}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {linea.codigo ? `Cód. ${linea.codigo}` : "Sin código"}
            {!linea.codigoBarra && (
              <span title="Este insumo no tiene código de barras: cargalo a mano">
                {" · "}✋ a mano
              </span>
            )}
          </div>
        </div>
        <input
          type="number"
          className="input"
          min={0}
          max={linea.pedida}
          value={linea.preparada}
          onChange={(e) => onCantidad(linea.productoId, e.target.value)}
          style={{ width: 80, textAlign: "right", fontWeight: 700 }}
          aria-label={`Preparado de ${linea.nombre}`}
        />
        <div style={{ width: 54, textAlign: "left" }} className="muted">
          / {linea.pedida}
        </div>
      </div>
      <div style={{ height: 4, background: "#e5e7eb", borderRadius: 2, marginTop: 8 }}>
        <div style={{ height: "100%", width: `${pct}%`, borderRadius: 2,
                      background: completa ? "#16a34a" : "#2563eb", transition: "width .3s" }} />
      </div>
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
    if (!a.completo && !window.confirm(
      `Vas a avisar que terminaste con ${a.unidadesPreparadas} de ${a.unidadesPedidas} unidades. ¿Seguro?`
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
      <div className="srv-card">
        <div className="toolbar" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="pill pill--ghost" onClick={cerrarPedido}>← Volver</button>
          <strong>{nro(pedido.id)}</strong>
          <span className="muted">{pedido.servicio || "Sin servicio"}</span>
          <div style={{ flex: 1 }} />
          <strong style={{ fontSize: 18 }}>
            {avance.unidadesPreparadas} / {avance.unidadesPedidas}
          </strong>
          <span className="muted">
            {avance.lineasCompletas} de {avance.lineas} insumos
          </span>
        </div>

        <div style={{ padding: "10px 0" }}>
          <input
            ref={escaneoRef}
            className="input"
            placeholder="Escaneá el insumo con la pistola…"
            autoFocus
            style={{ width: "100%", fontSize: 18, padding: "12px 14px" }}
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
        </div>

        <Cartel aviso={aviso} onCerrar={() => setAviso(null)} />

        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
          {lineas.map((l) => (
            <Linea key={l.productoId} linea={l} destacada={destacada === l.productoId}
                   onCantidad={cambiarCantidad} />
          ))}
        </div>

        <div className="toolbar" style={{ marginTop: 12, gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="pill pill--ghost" onClick={guardarManual}>
            Guardar cantidades
          </button>
          <button type="button" className="pill" onClick={terminar}>
            {avance.completo ? "Terminé, está completo" : "Terminé (incompleto)"}
          </button>
        </div>
      </div>
    );
  }

  /* ================= La cola ================= */

  return (
    <div className="srv-card">
      <div className="toolbar" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <strong>{soyJefe ? "Preparación de pedidos" : "Mis pedidos para preparar"}</strong>
        <div style={{ flex: 1 }} />
        <button type="button" className="pill pill--ghost" onClick={cargarCola} disabled={cargando}>
          {cargando ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      {err && <div className="state state--error" style={{ marginTop: 8 }}>{err}</div>}

      {soyJefe && <AsignarPedido preparadores={preparadores} onListo={cargarCola} />}

      <div style={{ marginTop: 12 }}>
        {!cola.length && !cargando && (
          <div className="state">
            {soyJefe
              ? "No hay pedidos asignados todavía."
              : "No tenés pedidos asignados. Pedile al jefe que te asigne."}
          </div>
        )}

        {cola.map((p) => {
          const terminado = !!p.terminadaAt;
          return (
            <div key={p.id} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
              border: "1px solid #e5e7eb", borderRadius: 8, marginBottom: 8,
              background: terminado ? "#f0fdf4" : "#fff",
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>
                  {nro(p.id)} {terminado && <span style={{ color: "#166534" }}>· terminado</span>}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {p.servicio || "Sin servicio"}
                  {soyJefe && ` · ${p.preparador}`}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 600 }}>
                  {p.unidadesPreparadas} / {p.unidadesPedidas}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {p.lineasCompletas} de {p.lineas} insumos
                </div>
              </div>
              <button type="button" className="pill" onClick={() => abrir(p.id)}>
                {terminado ? "Ver" : "Preparar"}
              </button>
              {soyJefe && (
                <>
                  {terminado && (
                    <button type="button" className="pill pill--ghost" onClick={() => devolver(p.id)}>
                      Devolver
                    </button>
                  )}
                  <button type="button" className="pill pill--ghost" onClick={() => desasignar(p.id)}>
                    Desasignar
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
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
    <div style={{ margin: "12px 0", padding: 12, background: "#f8fafc",
                  borderRadius: 8, border: "1px solid #e5e7eb" }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>
        Asignar un pedido <span className="muted">({pendientes.length} pendientes)</span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select className="select" value={cual} onChange={(e) => setCual(e.target.value)}
                aria-label="Pedido a asignar" style={{ minWidth: 320 }}>
          <option value="">— Elegí el pedido —</option>
          {pendientes.map((p) => (
            <option key={p.id} value={p.id}>
              {nro(p.id)} · {p.servicio || "Sin servicio"} ({p.lineas} insumos)
            </option>
          ))}
        </select>
        <select className="select" value={quien} onChange={(e) => setQuien(e.target.value)}
                aria-label="Preparador">
          <option value="">— Elegí preparador —</option>
          {preparadores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        <button type="button" className="pill" onClick={asignar}>Asignar</button>
        {msg && <span className="muted">{msg}</span>}
      </div>
      {!preparadores.length && (
        <div className="muted" style={{ marginTop: 8 }}>
          No hay nadie con rol Picking. Creá el usuario del operario en Empleados
          y asignale ese rol.
        </div>
      )}
    </div>
  );
}
