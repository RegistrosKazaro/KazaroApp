// client/src/context/CartProvider.jsx
import { useEffect, useMemo, useState } from "react";
import { CartContext } from "./cart-context";

export default function CartProvider({ children }) {
  // Carrito
  const [items, setItems] = useState(() => {
    try { return JSON.parse(localStorage.getItem("cart") || "[]"); }
    catch { return []; }
  });

  // Servicio seleccionado (supervisor)
  const [service, setService] = useState(() => {
    try { return JSON.parse(localStorage.getItem("selectedService") || "null"); }
    catch { return null; }
  });

  // Persistencia
  useEffect(() => {
    localStorage.setItem("cart", JSON.stringify(items));
  }, [items]);

  useEffect(() => {
    if (service) localStorage.setItem("selectedService", JSON.stringify(service));
    else localStorage.removeItem("selectedService");
  }, [service]);

  // Acciones
  function add({ productId, name, price = 0, qty = 1, categoryName = "" }) {
    setItems(prev => {
      const i = prev.findIndex(p => p.productId === productId);
      if (i >= 0) {
        const copy = [...prev];
        copy[i] = { ...copy[i], qty: copy[i].qty + qty };
        return copy;
      }
      return [...prev, { productId, name, price, qty, categoryName }];
    });
  }
  function update(productId, qty) {
    const q = Math.max(1, Number(qty) || 1);
    setItems(prev => prev.map(it => it.productId === productId ? { ...it, qty: q } : it));
  }
  function remove(productId) {
    setItems(prev => prev.filter(it => it.productId !== productId));
  }
  /**
   * Deja el carrito igual a un pedido anterior, para repetirlo.
   *
   * Reemplaza en vez de sumar: si no, repetir un pedido se mezclaría con lo
   * que hubiera a medio cargar y saldría cualquier cosa. Después se edita
   * como siempre y al enviarlo sale con número nuevo, porque es un pedido
   * nuevo: el viejo no se toca.
   *
   * Los precios NO viajan desde el pedido viejo: el servidor los toma del
   * catálogo al crear, así que repetir un pedido de hace un mes sale a precio
   * de hoy.
   */
  function reemplazar(nuevos = [], servicio = null) {
    setItems((nuevos || [])
      .map((it) => ({
        productId: it.productId,
        name: it.name ?? it.nombre ?? "",
        price: Number(it.price ?? it.precio ?? 0),
        qty: Math.max(1, Number(it.qty ?? it.cantidad ?? 1)),
        categoryName: it.categoryName ?? "",
      }))
      .filter((it) => it.productId != null));
    if (servicio) setService(servicio);
  }

  function clear() {
    setItems([]);
    setService(null);
    localStorage.removeItem("cart");
    localStorage.removeItem("selectedService");
  }

  // Limpia si alguien dispara logout
  useEffect(() => {
    const onLogout = () => clear();
    window.addEventListener("app:logout", onLogout);
    return () => window.removeEventListener("app:logout", onLogout);
  }, []);

  const total = useMemo(
    () => items.reduce((s, it) => s + (Number(it.price || 0) * Number(it.qty || 1)), 0),
    [items]
  );

  const value = useMemo(
    () => ({ items, add, update, remove, clear, reemplazar, total, service, setService }),
    [items, total, service]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
