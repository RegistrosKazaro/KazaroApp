import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useCart } from "../hooks/useCart";
import "../styles/catalog.css";

export default function Products() {
  const { role } = useParams();
  const isSupervisor = String(role).toLowerCase().includes("super");
  const [sp, setSp] = useSearchParams();

  // ⬇️ además de add y service, ahora leemos items del carrito
  const { add, service, items: cartItems } = useCart();

  const cat = sp.get("cat");
  const q = sp.get("q") || "";
  const page = Number(sp.get("page") || 1);
  const pageSize = 20;

  const [cats, setCats] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/catalog/categories")
      .then(({ data }) => {
        const list = data || [];
        setCats(list);
        if (!sp.get("cat") && list.length) {
          setSp(prev => { prev.set("cat", list[0].id); return prev; }, { replace: true });
        }
      })
      .catch(() => setError("No se pudieron cargar las categorías"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!cat) return;
    setLoading(true);
    setError("");
    api.get("/catalog/products", { params: { catId: cat, q } })
      .then(({ data }) => setItems(data || []))
      .catch(() => setError("No se pudieron cargar los productos"))
      .finally(() => setLoading(false));
  }, [cat, q]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page]);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  // ⬇️ mapa de cantidades reservadas en el carrito por productId
  const reservedById = useMemo(() => {
    const map = new Map();
    for (const it of cartItems) {
      const id = Number(it.productId);
      const qty = Math.max(0, Number(it.qty) || 0);
      map.set(id, (map.get(id) || 0) + qty);
    }
    return map;
  }, [cartItems]);

  const onChangeCat = (e) => {
    const v = e.target.value;
    setSp(prev => { prev.set("cat", v); prev.delete("q"); prev.set("page", "1"); return prev; }, { replace: true });
  };
  const onSearch = (e) => {
    const v = e.target.value;
    setSp(prev => { if (v) prev.set("q", v); else prev.delete("q"); prev.set("page","1"); return prev; }, { replace: true });
  };
  const goPage = (p) => {
    const next = Math.min(Math.max(1, p), totalPages);
    setSp(prev => { prev.set("page", String(next)); return prev; }, { replace: true });
  };

  return (
    <div className="catalog" role="region" aria-labelledby="cat-title">
      <h2 id="cat-title">Productos</h2>

      <div className="catalog-toolbar">
        <select className="select" value={cat || ""} onChange={onChangeCat} aria-label="Categoría">
          {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <input
          className="input search"
          placeholder="Buscar…"
          defaultValue={q}
          onChange={onSearch}
          aria-label="Buscar productos"
        />
      </div>

      {isSupervisor && !service && (
        <div className="state" style={{ marginBottom: 12 }}>
          Elegí un servicio antes de agregar productos (Menú → Supervisor → Servicios).
        </div>
      )}

      {loading && <div className="state">Cargando…</div>}
      {!loading && error && <div className="state error" role="alert">{error}</div>}
      {!loading && !error && !items.length && <div className="state">No hay productos.</div>}

      {!loading && !error && items.length > 0 && (
        <>
          <div className="product-grid">
            {paginated.map(p => {
              const totalStock = Number.isFinite(Number(p.stock)) ? Number(p.stock) : undefined;
              const reserved = reservedById.get(Number(p.id)) || 0;
              const remaining = totalStock !== undefined ? Math.max(0, totalStock - reserved) : undefined;

              return (
                <ProductCard
                  key={p.id}
                  p={p}
                  remainingStock={remaining}
                  onAdd={(qty) => {
                    const limit = remaining ?? Infinity;
                    if (limit <= 0) return; // sin restante, no agrega
                    const safeQty = Math.min(Math.max(1, Number(qty) || 1), limit);
                    // guardamos también el stock total para el carrito (referencia)
                    add({ productId: p.id, name: p.name, price: p.price ?? 0, qty: safeQty, stock: totalStock });
                  }}
                  addDisabled={(isSupervisor && !service) || ((remaining !== undefined) && remaining <= 0)}
                />
              );
            })}
          </div>

          <nav className="pager" aria-label="Paginación de productos">
            <button className="pager-btn" onClick={() => goPage(page - 1)} disabled={page <= 1} aria-label="Anterior">‹</button>
            <span className="pager-info">Página {page} de {totalPages}</span>
            <button className="pager-btn" onClick={() => goPage(page + 1)} disabled={page >= totalPages} aria-label="Siguiente">›</button>
          </nav>
        </>
      )}
    </div>
  );
}

function ProductCard({ p, remainingStock, onAdd, addDisabled }) {
  const [qty, setQty] = useState(1);

  const priceText = useMemo(() => {
    if (p.price == null) return "";
    const n = Number(p.price);
    if (Number.isNaN(n)) return String(p.price);
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 }).format(n);
  }, [p.price]);

  const sinRestante = (remainingStock !== undefined) && (remainingStock <= 0);

  // Si cambia el restante (por agregar al carrito), ajustamos la cantidad visible
  useEffect(() => {
    if (remainingStock !== undefined) {
      setQty(q => Math.min(Math.max(1, q), Math.max(1, remainingStock)));
    }
  }, [remainingStock]);

  return (
    <article className="product-card">
      <h3 className="product-title">{p.name}</h3>
      <div className="product-code">{p.code || "\u00A0"}</div>
      {p.price != null && <div className="product-price">{priceText}</div>}

      {remainingStock !== undefined && (
        <div className="product-stock" aria-live="polite" style={{ marginTop: 6 }}>
          {sinRestante ? "Sin stock" : `Stock restante: ${remainingStock}`}
        </div>
      )}

      <div className="actions">
        <input
          type="number"
          min="1"
          {...(remainingStock !== undefined ? { max: Math.max(1, remainingStock) } : {})}
          step="1"
          className="qty-input"
          value={qty}
          onChange={(e) => {
            const v = Math.max(1, Number(e.target.value) || 1);
            setQty(remainingStock !== undefined ? Math.min(v, Math.max(1, remainingStock)) : v);
          }}
          disabled={sinRestante}
          aria-label={`Cantidad de ${p.name}`}
        />
        <button
          type="button"
          className="btn btn-add"
          onClick={() => onAdd(qty)}
          disabled={addDisabled || sinRestante}
          aria-label={`Agregar ${qty} de ${p.name} al carrito`}
        >
          Agregar
        </button>
      </div>
    </article>
  );
}
