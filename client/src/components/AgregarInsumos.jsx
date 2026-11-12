// client/src/components/AgregarInsumos.jsx
//
// Buscador para sumar insumos al carrito sin salir de él. Nació para "Repetir
// este pedido": el pedido viejo se carga en el carrito y, si había que sumarle
// algo, había que ir al catálogo, buscarlo y volver.
//
// Usa la misma consulta que el catálogo (/catalog/products con el servicio),
// así que sólo ofrece lo que ese servicio tiene habilitado. Y las mismas dos
// reglas al agregar: no se pide lo que no tiene stock, y los uniformes no se
// mezclan con insumos (el servidor también lo frena al enviar).
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import useDebounced from "../hooks/useDebounced";
import { formatMoney } from "../utils/format";

const esUniforme = (nombre) => String(nombre || "").trim().toLowerCase() === "uniformes";

export default function AgregarInsumos({ serviceId = null, cartItems = [], onAdd, disabled = false }) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [categorias, setCategorias] = useState(new Map());
  const [aviso, setAviso] = useState(null);   // { texto, error }
  const qDeb = useDebounced(q, 250);
  const input = useRef(null);

  // El nombre de la categoría hace falta para la regla de uniformes: la
  // búsqueda trae sólo el id.
  useEffect(() => {
    if (!abierto || categorias.size) return;
    api.get("/catalog/categories")
      .then(({ data }) => setCategorias(new Map((data || []).map((c) => [String(c.id), c.name]))))
      .catch(() => {});
  }, [abierto, categorias.size]);

  useEffect(() => {
    if (abierto) input.current?.focus();
  }, [abierto]);

  useEffect(() => {
    let vivo = true;
    const termino = qDeb.trim();
    if (!abierto || termino.length < 2) { setResultados([]); setBuscando(false); return; }
    setBuscando(true);
    api.get("/catalog/products", {
      params: { catId: "__all__", q: termino, ...(serviceId ? { serviceId } : {}) },
    })
      .then(({ data }) => { if (vivo) setResultados(Array.isArray(data) ? data.slice(0, 12) : []); })
      .catch(() => { if (vivo) setResultados([]); })
      .finally(() => { if (vivo) setBuscando(false); });
    return () => { vivo = false; };
  }, [qDeb, abierto, serviceId]);

  const enCarrito = (id) => cartItems.find((it) => Number(it.productId) === Number(id));

  function agregar(p) {
    const categoria = categorias.get(String(p.categoryId)) || "";
    const yaHay = Number(enCarrito(p.id)?.qty || 0);
    const stock = Number(p.stock ?? 0);

    if (stock - yaHay <= 0) {
      setAviso({ error: true, texto: `${p.name}: no queda stock para agregar más.` });
      return;
    }
    // Sólo se compara contra lo que tiene categoría conocida: lo que viene de
    // un pedido repetido no la trae, y para eso está el control del servidor.
    const hayUniformes = cartItems.some((it) => esUniforme(it.categoryName));
    const hayInsumos = cartItems.some((it) => it.categoryName && !esUniforme(it.categoryName));
    if (esUniforme(categoria) && hayInsumos) {
      setAviso({ error: true, texto: "Los uniformes se piden por separado: no se pueden mezclar con insumos." });
      return;
    }
    if (!esUniforme(categoria) && hayUniformes) {
      setAviso({ error: true, texto: "El pedido tiene uniformes: los insumos van en un pedido aparte." });
      return;
    }

    onAdd({ productId: p.id, name: p.name, price: p.price ?? 0, qty: 1, stock, categoryName: categoria });
    setAviso({ texto: yaHay ? `Se sumó 1 más de ${p.name}.` : `Agregado: ${p.name}. Ajustá la cantidad en la lista.` });
    setQ("");
    setResultados([]);
    input.current?.focus();
  }

  if (!abierto) {
    return (
      <button
        type="button"
        className="btn"
        onClick={() => { setAbierto(true); setAviso(null); }}
        disabled={disabled}
        // Sólo cuando está apagado: si no, el lector de pantalla leía el
        // title en vez de lo que dice el botón.
        title={disabled ? "Elegí un servicio primero" : undefined}
        style={{ marginBottom: 12 }}
      >
        ➕ Agregar insumos
      </button>
    );
  }

  return (
    <div className="state" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <strong style={{ marginRight: "auto" }}>Agregar insumos al pedido</strong>
        <button type="button" className="btn" onClick={() => { setAbierto(false); setQ(""); setAviso(null); }}>
          Listo
        </button>
      </div>

      <div style={{ position: "relative" }}>
        <input
          ref={input}
          type="search"
          className="input"
          value={q}
          onChange={(e) => { setQ(e.target.value); setAviso(null); }}
          placeholder="Buscar por nombre o código… (ej.: lavandina, 004)"
          aria-label="Buscar insumo para agregar"
          autoComplete="off"
          style={{ width: "100%" }}
        />

        {q.trim().length >= 2 && (
          <div
            role="listbox"
            aria-label="Insumos encontrados"
            style={{
              marginTop: 4, border: "1px solid #d1d5db", borderRadius: 8, background: "#fff",
              maxHeight: 320, overflowY: "auto", boxShadow: "0 8px 24px rgba(15,23,42,.12)",
            }}
          >
            {buscando && <div style={{ padding: "10px 12px", color: "#6b7280" }}>Buscando…</div>}
            {!buscando && resultados.length === 0 && (
              <div style={{ padding: "10px 12px", color: "#6b7280" }}>
                No se encontró “{q.trim()}” entre los insumos de este servicio.
              </div>
            )}
            {!buscando && resultados.map((p) => {
              const stock = Number(p.stock ?? 0);
              const yaHay = Number(enCarrito(p.id)?.qty || 0);
              const sinStock = stock - yaHay <= 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  disabled={sinStock}
                  onClick={() => agregar(p)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, width: "100%", border: 0,
                    borderBottom: "1px solid #f1f5f9", padding: "9px 12px", textAlign: "left",
                    background: "#fff", cursor: sinStock ? "not-allowed" : "pointer", opacity: sinStock ? 0.55 : 1,
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.name}
                    </span>
                    <span style={{ fontSize: "0.78rem", color: "#6b7280" }}>
                      {p.code ? `Cód. ${String(p.code).trim()} · ` : ""}
                      {sinStock ? <strong style={{ color: "#b91c1c" }}>Sin stock</strong> : `Stock ${stock}`}
                      {yaHay > 0 && <span style={{ color: "#1d4ed8" }}> · ya en el pedido ({yaHay})</span>}
                    </span>
                  </span>
                  <span style={{ fontSize: "0.85rem", whiteSpace: "nowrap" }}>{formatMoney(p.price ?? 0)}</span>
                  {!sinStock && <span aria-hidden="true" style={{ fontWeight: 700, color: "#047857" }}>＋</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {aviso && (
        <div role="status" style={{ marginTop: 8, fontSize: "0.85rem", color: aviso.error ? "#b91c1c" : "#047857" }}>{aviso.texto}</div>
      )}
    </div>
  );
}
