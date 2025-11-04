// client/src/pages/IncomingStockSection.jsx
import { useState } from "react";
import { api } from "../api/client";
import "../styles/admin-panel.css";

export default function IncomingStockSection() {
  const [productId, setProductId] = useState("");
  const [product, setProduct] = useState(null);
  const [rows, setRows] = useState([]);
  const [qty, setQty] = useState("");
  const [eta, setEta] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const nf = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  });

  async function load() {
    setError("");
    setLoading(true);
    try {
      const id = productId.trim();
      if (!id) {
        setError("Ingresá un ID de producto");
        setLoading(false);
        return;
      }

      // 1) Datos del producto
      const prodRes = await api.get(`/admin/products/${id}`);
      setProduct(prodRes.data);

      // 2) Ingresos futuros
      const incRes = await api.get(`/admin/products/${id}/incoming`);
      setRows((incRes.data || []).sort((a, b) => String(a.eta).localeCompare(String(b.eta))));
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.error || "No se pudo cargar la información");
      setProduct(null);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function addRow(e) {
    e.preventDefault();
    setError("");
    try {
      const id = productId.trim();
      if (!id) {
        setError("Ingresá un ID de producto");
        return;
      }
      const body = {
        qty: Number(qty),
        eta, // viene del <input type="date" />
      };
      const res = await api.post(`/admin/products/${id}/incoming`, body);
      setRows(prev =>
        [...prev, res.data].sort((a, b) => String(a.eta).localeCompare(String(b.eta)))
      );
      setQty("");
      setEta("");
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.error || "No se pudo guardar");
    }
  }

  async function removeRow(id) {
    if (!window.confirm("¿Eliminar este ingreso futuro?")) return;
    try {
      await api.delete(`/admin/incoming/${id}`);
      setRows(prev => prev.filter(r => r.id !== id));
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.error || "No se pudo eliminar");
    }
  }

  // NUEVO: confirmar ingreso → mover a stock real
  async function confirmRow(id) {
    if (!window.confirm("¿Confirmar que este ingreso se recibió y pasarlo al stock real?")) {
      return;
    }
    setError("");
    try {
      const res = await api.post(`/admin/incoming/${id}/confirm`);
      const { product: updatedProduct } = res.data || {};

      // saco el ingreso confirmado de la tabla
      setRows(prev => prev.filter(r => r.id !== id));

      // actualizo el stock mostrado del producto
      if (updatedProduct && typeof updatedProduct.stock !== "undefined") {
        setProduct(prev =>
          prev ? { ...prev, stock: updatedProduct.stock } : prev
        );
      }
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.error || "No se pudo confirmar el ingreso");
    }
  }

  return (
    <section className="admin-block">
      <h3>Ingresos futuros de stock</h3>

      <div className="admin-toolbar" style={{ gap: 8 }}>
        <label>
          ID de producto:&nbsp;
          <input
            className="input"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            style={{ maxWidth: 120 }}
          />
        </label>
        <button className="btn" type="button" onClick={load} disabled={loading}>
          {loading ? "Buscando…" : "Cargar"}
        </button>
      </div>

      {error && <div className="state error" style={{ marginTop: 8 }}>{error}</div>}

      {product && (
        <div className="state" style={{ marginTop: 8 }}>
          <div><strong>Producto:</strong> {product.name} (ID {product.id})</div>
          {product.code && <div><strong>Código:</strong> {product.code}</div>}
          {product.price != null && (
            <div><strong>Precio:</strong> {nf.format(product.price)}</div>
          )}
          {product.stock != null && (
            <div><strong>Stock actual:</strong> {product.stock}</div>
          )}
        </div>
      )}

      {product && (
        <>
          <form
            className="admin-form"
            onSubmit={addRow}
            style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}
          >
            <label>
              Cantidad:
              <input
                type="number"
                min="1"
                className="input"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                required
              />
            </label>
            <label>
              Fecha de ingreso (ETA):
              <input
                type="date"
                className="input"
                value={eta}
                onChange={(e) => setEta(e.target.value)}
                required
              />
            </label>
            <button className="btn" type="submit">
              Agregar ingreso
            </button>
          </form>

          <table className="sup-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Cantidad</th>
                <th>Fecha (ETA)</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", fontStyle: "italic" }}>
                    Este producto no tiene ingresos futuros cargados.
                  </td>
                </tr>
              )}
              {rows.map(r => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.qty}</td>
                  <td>{r.eta}</td>
                  <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      className="btn primary"
                      type="button"
                      onClick={() => confirmRow(r.id)}
                    >
                      Confirmar ingreso
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => removeRow(r.id)}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
