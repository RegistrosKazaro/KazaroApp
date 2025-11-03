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
  const q = sp.get("q") || "";
  const page = Number(sp.get("page") || 1);
  const pageSize = 20;

  const [cats, setCats] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // helper para actualizar search params de forma segura (sin función en setSp)
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
  }, [cat, q, isSupervisor, serviceId]); // deps simples y completas

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
                    const available = totalStock ?? 0;
                    const inc = incoming;
                    let limit;

                    if (available > 0) {
                      // venta normal: hasta el stock restante (ya descontando lo reservado en el carrito)
                      limit = remaining ?? available;
                    } else if (available <= 0 && inc > 0) {
                      // preventa: sin stock actual pero con ingreso futuro
                      limit = inc;
                    } else {
                      limit = 0;
                    }

                    if (limit <= 0) return;

                    const safeQty = Math.min(
                      Math.max(1, Number(qty) || 1),
                      limit
                    );

                    add({
                      productId: p.id,
                      name: p.name,
                      price: p.price ?? 0,
                      qty: safeQty,
                      stock: totalStock,
                      incoming: inc,
                    });
                  }}
                  // acá SOLO controlamos la restricción de supervisor sin servicio
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
  const [qty, setQty] = useState(1);

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

  const actualStock = Number.isFinite(Number(p.stock))
    ? Number(p.stock)
    : null;
  const incoming = Number.isFinite(Number(p.incoming))
    ? Number(p.incoming)
    : 0;

  const hasPreorder =
    actualStock != null && actualStock <= 0 && incoming > 0;

  // sinRestante ahora significa "no se puede pedir nada", ya sea por stock ni preventa
  const sinRestante =
    remainingStock !== undefined &&
    remainingStock <= 0 &&
    !hasPreorder;

  const etaText = useMemo(() => {
    if (!p.nextEta) return null;
    try {
      return new Date(p.nextEta).toLocaleDateString("es-AR");
    } catch {
      return String(p.nextEta);
    }
  }, [p.nextEta]);

  const maxQty = useMemo(() => {
    if (sinRestante) return 1;
    if (remainingStock !== undefined && remainingStock > 0) {
      return Math.max(1, remainingStock);
    }
    if (hasPreorder) {
      return Math.max(1, incoming);
    }
    return undefined;
  }, [sinRestante, remainingStock, hasPreorder, incoming]);

  // Ajustar cantidad si cambia el límite
  useEffect(() => {
    if (maxQty !== undefined) {
      setQty((q) => {
        const base = Math.max(1, q);
        return Math.min(base, maxQty);
      });
    }
  }, [maxQty]);

  return (
    <article className="product-card">
      <h3 className="product-title">{p.name}</h3>
      <div className="product-code">{p.code || "\u00A0"}</div>
      {p.price != null && <div className="product-price">{priceText}</div>}

      {remainingStock !== undefined && (
        <div
          className="product-stock"
          aria-live="polite"
          style={{ marginTop: 6 }}
        >
          {sinRestante && "Sin stock"}
          {!sinRestante && remainingStock > 0 && (
            <>Stock restante: {remainingStock}</>
          )}
          {!sinRestante &&
            remainingStock <= 0 &&
            hasPreorder &&
            (etaText ? (
              <>Sin stock actual. Ingreso disponible: {incoming} (desde {etaText})</>
            ) : (
              <>Sin stock actual. Ingreso disponible: {incoming}</>
            ))}
        </div>
      )}

      <div className="actions">
        <input
          type="number"
          min="1"
          {...(maxQty !== undefined
            ? { max: Math.max(1, maxQty) }
            : {})}
          step="1"
          className="qty-input"
          value={qty}
          onChange={(e) => {
            const v = Math.max(1, Number(e.target.value) || 1);
            if (maxQty !== undefined) {
              setQty(Math.min(v, maxQty));
            } else {
              setQty(v);
            }
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
