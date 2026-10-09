// client/src/components/FlexxusDepositos.jsx
//
// A qué depósito de Flexxus corresponde cada servicio de Kazaro.
//
// Cada servicio es un depósito del otro lado, y ese código es el que necesita
// el remito de transferencia para saber a dónde va la mercadería. Sin esto, un
// despacho no puede generar su movimiento.
//
// Tres estados, y la diferencia entre los dos últimos importa:
//   mapeado       tiene su depósito
//   sin depósito  lo miramos y NO existe en Flexxus (el caso UEPC)
//   sin mapear    nadie lo revisó todavía
//
// Usa los mismos bloques que el resto del panel (srv-card, toolbar, table like,
// pill, state) para no desentonar con las demás secciones.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import useDebounced from "../hooks/useDebounced";
import { formatNumber } from "../utils/format";

const ESTADOS = {
  mapeado:      { label: "Mapeado",      color: "#166534", bg: "#dcfce7" },
  sin_deposito: { label: "No está en Flexxus", color: "#b45309", bg: "#fef3c7" },
  sin_mapear:   { label: "Sin mapear",   color: "#b91c1c", bg: "#fee2e2" },
};

export default function FlexxusDepositos() {
  const [rows, setRows] = useState([]);
  const [resumen, setResumen] = useState(null);
  const [compartidos, setCompartidos] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const qDeb = useDebounced(q, 300);
  const [estado, setEstado] = useState("todos");
  const [soloConPedidos, setSoloConPedidos] = useState(true);
  const [editando, setEditando] = useState(null);   // servicioId en edición
  const [cola, setCola] = useState(null);
  const archivoRef = useRef(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErr("");
    try {
      const { data } = await api.get("/admin/flexxus/depositos", {
        params: {
          q: String(qDeb || "").trim(),
          estado: estado === "todos" ? undefined : estado,
          soloConPedidos: soloConPedidos ? "1" : undefined,
        },
      });
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setResumen(data?.resumen || null);
      setCompartidos(Array.isArray(data?.compartidos) ? data.compartidos : []);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || "No se pudo cargar el mapeo");
    } finally {
      setCargando(false);
    }
  }, [qDeb, estado, soloConPedidos]);

  useEffect(() => { cargar(); }, [cargar]);

  const cargarCola = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/flexxus/outbox", { params: { limite: 25 } });
      setCola(data || null);
    } catch { /* es informativa: si falla, no molesta */ }
  }, []);

  useEffect(() => { cargarCola(); }, [cargarCola]);

  const importar = async (archivo) => {
    setErr(""); setMsg("");
    try {
      const texto = await archivo.text();
      let datos;
      try { datos = JSON.parse(texto); }
      catch { setErr("Ese archivo no es un JSON válido."); return; }

      const { data } = await api.post("/admin/flexxus/depositos/importar", datos);
      const partes = [`${data.asignados} servicios con depósito`];
      if (data.sinDeposito) partes.push(`${data.sinDeposito} marcados como "no está en Flexxus"`);
      if (data.respetados) partes.push(`${data.respetados} ya confirmados que no se tocaron`);
      setMsg(`Importado: ${partes.join(" · ")}.`);
      if (data.errores?.length) setErr(data.errores.join(" "));
      cargar();
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || "No se pudo importar el archivo");
    } finally {
      if (archivoRef.current) archivoRef.current.value = "";
    }
  };

  return (
    <section className="srv-card" aria-labelledby="fdep-heading">
      <div className="section-header">
        <h3 id="fdep-heading">Flexxus — depósitos por servicio (Kazaro)</h3>
        <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "#6b7280" }}>
          En Flexxus, cada servicio es un depósito. Este código es el que usa el remito de transferencia
          para saber a dónde va la mercadería. Un servicio sin depósito no rompe nada: su movimiento queda
          esperando, visible en la cola, hasta que se le asigne uno.
        </p>
      </div>

      {resumen && (
        <div className="toolbar" style={{ gap: 8, flexWrap: "wrap" }}>
          <Dato titulo="Con depósito" valor={resumen.conDeposito} color="#166534" bg="#dcfce7" />
          <Dato titulo="No están en Flexxus" valor={resumen.sinDeposito} color="#b45309" bg="#fef3c7" />
          <Dato titulo="Sin mapear" valor={resumen.sinMapear ?? "—"} color="#b91c1c" bg="#fee2e2" />
          <Dato titulo="Confirmados a mano" valor={resumen.confirmados} color="#1d4ed8" bg="#dbeafe" />
          {cola?.resumen?.total > 0 && (
            <Dato titulo="Movimientos en cola" valor={cola.resumen.total} color="#374151" bg="#f3f4f6" />
          )}
        </div>
      )}

      <div className="toolbar">
        <input
          className="input"
          placeholder="Buscar por servicio, depósito o código…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Buscar en el mapeo"
        />
        <select
          className="select"
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
          aria-label="Filtrar por estado"
        >
          <option value="todos">— Todos los estados —</option>
          {Object.entries(ESTADOS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <label className="muted" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={soloConPedidos}
            onChange={(e) => setSoloConPedidos(e.target.checked)}
          />
          Solo los que piden
        </label>
        <div style={{ flex: 1 }} />
        <input
          ref={archivoRef}
          type="file"
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importar(f); }}
          aria-label="Archivo de decisiones confirmadas"
        />
        <button className="btn" onClick={() => archivoRef.current?.click()}>
          Importar confirmados…
        </button>
      </div>

      {(msg || err) && (
        <div className={`state ${err ? "error" : "success"}`} role={err ? "alert" : "status"}>
          {err || msg}
        </div>
      )}

      {compartidos.length > 0 && (
        <div className="state" role="status">
          {compartidos.length === 1 ? "Hay 1 depósito" : `Hay ${compartidos.length} depósitos`}{" "}
          que comparten más de un servicio. Es válido —Flexxus a veces agrupa lo que la app separa—,
          pero conviene revisarlo: {compartidos.slice(0, 4).map((c) => `${c.codigo} (${c.cuantos})`).join(", ")}
          {compartidos.length > 4 ? "…" : ""}
        </div>
      )}

      {cargando ? (
        <div className="state">Cargando…</div>
      ) : rows.length === 0 ? (
        <div className="state">No hay servicios que coincidan con el filtro.</div>
      ) : (
        <div className="table like" role="table" aria-label="Servicios y su depósito en Flexxus">
          <div className="t-head" role="row">
            <div style={{ flex: 4 }}>Servicio</div>
            <div style={{ flex: 1, textAlign: "right" }}>Pedidos</div>
            <div style={{ flex: 4 }}>Depósito en Flexxus</div>
            <div style={{ flex: 2 }}>Estado</div>
            <div style={{ flex: 1 }} />
          </div>

          {rows.map((r) => (
            <Fila
              key={r.servicioId}
              fila={r}
              editando={editando === r.servicioId}
              onEditar={() => { setEditando(r.servicioId); setMsg(""); setErr(""); }}
              onCancelar={() => setEditando(null)}
              onGuardado={(aviso) => { setEditando(null); setMsg(aviso); cargar(); cargarCola(); }}
              onError={(e) => setErr(e)}
            />
          ))}
        </div>
      )}

      {cola?.rows?.length > 0 && (
        <>
          <div className="section-header" style={{ marginTop: 20 }}>
            <h3>Últimos movimientos en cola</h3>
            <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "#6b7280" }}>
              Todavía no se envía nada a Flexxus: esto es lo que saldría cuando se active.
            </p>
          </div>
          <div className="table like" role="table" aria-label="Cola de movimientos">
            <div className="t-head" role="row">
              <div style={{ flex: 2 }}>Remito</div>
              <div style={{ flex: 4 }}>Servicio</div>
              <div style={{ flex: 2 }}>Tipo</div>
              <div style={{ flex: 2 }}>Estado</div>
              <div style={{ flex: 3 }}>Detalle</div>
            </div>
            {cola.rows.map((m) => (
              <div key={m.id} className="t-row" role="row">
                <div style={{ flex: 2, fontWeight: 600 }}>#{String(m.pedidoId).padStart(7, "0")}</div>
                <div style={{ flex: 4, minWidth: 0 }} className="truncate">{m.servicio || "—"}</div>
                <div style={{ flex: 2 }}>{m.tipo === "entrada" ? "Devolución" : "Entrega"}</div>
                <div style={{ flex: 2 }}>
                  <span className="pill" style={{ cursor: "default" }}>{m.estado}</span>
                </div>
                <div style={{ flex: 3, minWidth: 0 }} className="muted">
                  {m.numeroMovimiento || m.ultimoError || "—"}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Dato({ titulo, valor, color, bg }) {
  return (
    <div style={{ background: bg, color, borderRadius: 8, padding: "6px 12px", minWidth: 110 }}>
      <div style={{ fontSize: "1.2rem", fontWeight: 700, lineHeight: 1.1 }}>
        {typeof valor === "number" ? formatNumber(valor) : valor}
      </div>
      <div style={{ fontSize: "0.75rem", opacity: 0.85 }}>{titulo}</div>
    </div>
  );
}

function Fila({ fila, editando, onEditar, onCancelar, onGuardado, onError }) {
  const est = ESTADOS[fila.estado] || { label: fila.estado, color: "#374151", bg: "#f3f4f6" };
  const [codigo, setCodigo] = useState(fila.codigo || "");
  const [deposito, setDeposito] = useState(fila.deposito || "");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (editando) { setCodigo(fila.codigo || ""); setDeposito(fila.deposito || ""); }
  }, [editando, fila.codigo, fila.deposito]);

  const guardar = async (limpiar = false) => {
    setGuardando(true);
    try {
      const { data } = await api.put(`/admin/flexxus/depositos/${fila.servicioId}`, {
        codigo: limpiar ? null : codigo.trim(),
        deposito: limpiar ? null : deposito.trim(),
        motivo: limpiar ? "No existe en Flexxus." : null,
      });
      const extra = data.reencolados
        ? ` Se reencolaron ${data.reencolados} movimiento(s) que estaban esperando.`
        : "";
      onGuardado(limpiar
        ? `"${fila.servicio}" quedó marcado como que no existe en Flexxus.`
        : `"${fila.servicio}" quedó apuntando al depósito ${codigo.trim()}.${extra}`);
    } catch (e) {
      onError(e?.response?.data?.error || e.message || "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  if (!editando) {
    return (
      <div className="t-row" role="row">
        <div style={{ flex: 4, minWidth: 0 }}>
          <div className="truncate">{fila.servicio}</div>
          {(fila.zona || fila.grupo) && (
            <div className="muted truncate">{[fila.grupo, fila.zona].filter(Boolean).join(" · ")}</div>
          )}
        </div>
        <div style={{ flex: 1, textAlign: "right" }}>{formatNumber(fila.pedidos || 0)}</div>
        <div style={{ flex: 4, minWidth: 0 }}>
          {fila.codigo ? (
            <>
              <div className="truncate"><strong>{fila.codigo}</strong> · {fila.deposito || "—"}</div>
              {fila.origen === "confirmado" && <div className="muted">confirmado a mano</div>}
            </>
          ) : (
            <span className="muted">{fila.motivo || "—"}</span>
          )}
        </div>
        <div style={{ flex: 2 }}>
          <span className="pill" style={{ background: est.bg, color: est.color, cursor: "default" }}>
            {est.label}
          </span>
        </div>
        <div style={{ flex: 1 }}>
          <button className="btn" onClick={onEditar}>Editar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="t-row" role="row" style={{ alignItems: "flex-start", gap: 8 }}>
      <div style={{ flex: 4, minWidth: 0 }}>
        <div className="truncate">{fila.servicio}</div>
      </div>
      <div style={{ flex: 1, textAlign: "right" }}>{formatNumber(fila.pedidos || 0)}</div>
      <div style={{ flex: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ maxWidth: 110 }}
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          placeholder="Código"
          aria-label={`Código de depósito de ${fila.servicio}`}
          autoFocus
        />
        <input
          className="input"
          style={{ flex: 1, minWidth: 160 }}
          value={deposito}
          onChange={(e) => setDeposito(e.target.value)}
          placeholder="Nombre del depósito en Flexxus"
          aria-label={`Nombre del depósito de ${fila.servicio}`}
        />
      </div>
      <div style={{ flex: 3, display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="btn primary" onClick={() => guardar(false)} disabled={guardando || !codigo.trim()}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <button className="btn" onClick={() => guardar(true)} disabled={guardando}>
          No está en Flexxus
        </button>
        <button className="btn" onClick={onCancelar} disabled={guardando}>Cancelar</button>
      </div>
    </div>
  );
}
