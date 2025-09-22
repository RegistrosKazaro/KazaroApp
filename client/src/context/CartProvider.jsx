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
  function add({ productId, name, price = 0, qty = 1 }) {
    setItems(prev => {
      const i = prev.findIndex(p => p.productId === productId);
      if (i >= 0) {
        const copy = [...prev];
        copy[i] = { ...copy[i], qty: copy[i].qty + qty };
        return copy;
      }
      return [...prev, { productId, name, price, qty }];
    });
  }
  function update(productId, qty) {
    const q = Math.max(1, Number(qty) || 1);
    setItems(prev => prev.map(it => it.productId === productId ? { ...it, qty: q } : it));
  }
  function remove(productId) {
    setItems(prev => prev.filter(it => it.productId !== productId));
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
    () => ({ items, add, update, remove, clear, total, service, setService }),
    [items, total, service]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
