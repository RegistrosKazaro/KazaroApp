// client/src/pages/Products.jsx
import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useCart } from "../hooks/useCart";
import "../styles/catalog.css";

export default function Products() {
  const { role } = useParams();
  const isSupervisor = String(role).toLowerCase().includes("super");
  const [sp, setSp] = useSearchParams();

  // carrito + servicio seleccionado por el supervisor
  const { add, service, items: cartItems } = useCart();
  const serviceId = service?.id ?? null;

  const cat = sp.get("cat");
  const [cats, setCats] = useState([]);
  const catName = cats.find((c) => String(c.id) === String(cat))?.name ?? "";

  const q = sp.get("q") || "";
  const page = Number(sp.get("page") || 1);
  const pageSize = 20;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // helper para actualizar search params de forma segura
  const updateParams = (updater, options) => {
    const next = new URLSearchParams(sp);
    updater(next);
    setSp(next, options);
  };

  useEffect(() => {
    api
      .get("/catalog/categories")
      .then(({ data }) => {
        const list = data || [];
        setCats(list);
        if (!sp.get("cat") && list.length) {
          updateParams(
            (next) => {
              next.set("cat", list[0].id);
            },
            { replace: true }
          );
        }
      })
      .catch(() => setError("No se pudieron cargar las categorías"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!cat) return;

    setError("");

    // si es supervisor y aún no eligió servicio, no cargamos productos
    if (isSupervisor && !serviceId) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const params = {
      catId: cat,
      q,
      ...(isSupervisor && serviceId ? { serviceId } : {}),
    };

    api
      .get("/catalog/products", { params })
      .then(({ data }) => setItems(data || []))
      .catch(() => setError("No se pudieron cargar los productos"))
      .finally(() => setLoading(false));
  }, [cat, q, isSupervisor, serviceId]); // deps simples

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page]);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  // cantidades reservadas en el carrito por productId
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
    updateParams(
      (next) => {
        next.set("cat", v);
        next.delete("q");
        next.set("page", "1");
      },
      { replace: true }
    );
  };

  const onSearch = (e) => {
    const v = e.target.value;
    updateParams(
      (next) => {
        if (v) next.set("q", v);
        else next.delete("q");
        next.set("page", "1");
      },
      { replace: true }
    );
  };

  const goPage = (p) => {
    const nextPage = Math.min(Math.max(1, p), totalPages);
    updateParams(
      (next) => {
        next.set("page", String(nextPage));
      },
      { replace: true }
    );
  };

  return (
    <div className="catalog" role="region" aria-labelledby="cat-title">
      <h2 id="cat-title">Productos</h2>

      <div className="catalog-toolbar">
        <select
          className="select"
          value={cat || ""}
          onChange={onChangeCat}
          aria-label="Categoría"
        >
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <input
          className="input search"
          placeholder="Buscar…"
          defaultValue={q}
          onChange={onSearch}
          aria-label="Buscar productos"
        />
      </div>

      {isSupervisor && !serviceId && (
        <div className="state" style={{ marginBottom: 12 }}>
          Elegí un servicio antes de agregar productos (Menú → Supervisor →
          Servicios).
        </div>
      )}

      {loading && <div className="state">Cargando…</div>}

      {!loading && error && (
        <div className="state error" role="alert">
          {error}
        </div>
      )}

      {!loading &&
        !error &&
        !items.length &&
        !(isSupervisor && !serviceId) && (
          <div className="state">No hay productos.</div>
        )}

      {!loading && !error && items.length > 0 && (
        <>
          <div className="product-grid">
            {paginated.map((p) => {
              const totalStock = Number.isFinite(Number(p.stock))
                ? Number(p.stock)
                : undefined;
              const incoming = Number.isFinite(Number(p.incoming))
                ? Number(p.incoming)
                : 0;

              const reserved = reservedById.get(Number(p.id)) || 0;
              const remaining =
                totalStock !== undefined
                  ? Math.max(0, totalStock - reserved)
                  : undefined;

              return (
                <ProductCard
                  key={p.id}
                  p={p}
                  remainingStock={remaining}
                  onAdd={(qty) => {
                    // Sólo dejamos pedir si hay stock REAL disponible.
                    const available = totalStock ?? 0;
                    const remainingQty =
                      available > 0 && remaining !== undefined
                        ? remaining
                        : Math.max(0, available);

                    if (remainingQty <= 0) {
                      return; // sin stock real → no se puede pedir
                    }

                    const safeQty = Math.min(
                      Math.max(1, Number(qty) || 1),
                      remainingQty
                    );

                    // Validación: no mezclar Uniformes con otras categorías
                    const isUni = (s) => String(s || "").trim().toLowerCase() === "uniformes";
                    const cartHasUni = cartItems.some((it) => isUni(it.categoryName));
                    const cartHasOther = cartItems.some((it) => it.categoryName && !isUni(it.categoryName));
                    if (cartItems.length > 0) {
                      if (isUni(catName) && cartHasOther) {
                        alert("No podés mezclar Uniformes con otras categorías. Vaciá el carrito o terminá el pedido actual primero.");
                        return;
                      }
                      if (!isUni(catName) && cartHasUni) {
                        alert("Tenés Uniformes en el carrito. Los uniformes se piden por separado.");
                        return;
                      }
                    }

                    add({
                      productId: p.id,
                      name: p.name,
                      price: p.price ?? 0,
                      qty: safeQty,
                      stock: totalStock,
                      incoming,
                      categoryName: catName,
                    });
                  }}
                  addDisabled={isSupervisor && !serviceId}
                />
              );
            })}
          </div>

          <nav className="pager" aria-label="Paginación de productos">
            <button
              className="pager-btn"
              onClick={() => goPage(page - 1)}
              disabled={page <= 1}
              aria-label="Anterior"
            >
              ‹
            </button>
            <span className="pager-info">
              Página {page} de {totalPages}
            </span>
            <button
              className="pager-btn"
              onClick={() => goPage(page + 1)}
              disabled={page >= totalPages}
              aria-label="Siguiente"
            >
              ›
            </button>
          </nav>
        </>
      )}
    </div>
  );
}

function ProductCard({ p, remainingStock, onAdd, addDisabled }) {
  const [qtyText, setQtyText] = useState("1");
  const [added, setAdded] = useState(false); // FIX: feedback visual

  const priceText = useMemo(() => {
    if (p.price == null) return "";
    const n = Number(p.price);
    if (Number.isNaN(n)) return String(p.price);
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      minimumFractionDigits: 2,
    }).format(n);
  }, [p.price]);

  const actualStock = Number.isFinite(Number(p.stock)) ? Number(p.stock) : null;
  const incoming = Number.isFinite(Number(p.incoming)) ? Number(p.incoming) : 0;
  const hasIncoming = incoming > 0;
  const noStockActual = actualStock != null && actualStock <= 0;
  const showIncomingInfo = noStockActual && hasIncoming;
  const sinRestante = remainingStock !== undefined && remainingStock <= 0;

  const etaText = useMemo(() => {
    if (!p.nextEta) return null;
    try { return new Date(p.nextEta).toLocaleDateString("es-AR"); }
    catch { return String(p.nextEta); }
  }, [p.nextEta]);

  const maxQty = useMemo(() => {
    if (sinRestante) return 1;
    if (remainingStock !== undefined && remainingStock > 0) return Math.max(1, remainingStock);
    return undefined;
  }, [sinRestante, remainingStock]);

  const getQtyNumber = () => {
    const n = Number(qtyText);
    let v = Number.isFinite(n) ? Math.trunc(n) : 1;
    v = Math.max(1, v);
    if (maxQty !== undefined) v = Math.min(v, maxQty);
    return v;
  };

  // FIX: mostrar checkmark por 1.5 segundos al agregar
  const handleAdd = () => {
    const pedido = Math.max(1, Math.trunc(Number(qtyText) || 1));
    const qn = getQtyNumber();
    if (maxQty !== undefined && pedido > maxQty) {
      alert(`Solo hay ${maxQty} disponible(s) de "${p.name}". Se agregó esa cantidad.`);
    }
    setQtyText(String(qn));
    onAdd(qn);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  return (
    <article className="product-card">
      <h3 className="product-title">{p.name}</h3>
      <div className="product-code">{p.code || "\u00A0"}</div>
      {p.price != null && <div className="product-price">{priceText}</div>}

      {remainingStock !== undefined && (
        <div className="product-stock" aria-live="polite" style={{ marginTop: 6 }}>
          {remainingStock > 0 && <>Stock restante: {remainingStock}</>}
          {remainingStock <= 0 && showIncomingInfo && (
            <>Sin stock actual. Ingreso disponible: {incoming}{etaText ? <> (desde {etaText})</> : null}</>
          )}
          {remainingStock <= 0 && !showIncomingInfo && "Sin stock"}
        </div>
      )}

      <div className="actions">
        <input
          type="number"
          min="1"
          {...(maxQty !== undefined ? { max: Math.max(1, maxQty) } : {})}
          step="1"
          className="qty-input"
          value={qtyText}
          onChange={(e) => {
            const next = e.target.value;
            if (next === "") { setQtyText(""); return; }
            const n = Number(next);
            if (!Number.isFinite(n)) return;
            setQtyText(next);
          }}
          onBlur={() => setQtyText(String(getQtyNumber()))}
          disabled={sinRestante}
          aria-label={`Cantidad de ${p.name}`}
        />
        <button
          type="button"
          className={`btn btn-add${added ? " btn-add--ok" : ""}`}
          onClick={handleAdd}
          disabled={addDisabled || sinRestante}
          aria-label={`Agregar ${getQtyNumber()} de ${p.name} al carrito`}
          style={added ? {
            background: "#22c55e",
            borderColor: "#16a34a",
            color: "#fff",
            transition: "background 0.2s, border-color 0.2s",
          } : { transition: "background 0.2s, border-color 0.2s" }}
        >
          {added ? "✓ Agregado" : "Agregar"}
        </button>
      </div>
    </article>
  );
}