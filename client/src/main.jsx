import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";

import AuthProvider from "./context/AuthProvider.jsx";
import CartProvider from "./context/CartProvider.jsx";

import "./styles/global.css";
import { ensureCsrf } from "./api/client";

/** Exportar el componente evita el warning de react-refresh */
export function Boot({ children }) {
  useEffect(() => {
    // establece cookie/secret y guarda token en memoria
    ensureCsrf().catch(() => {});
  }, []);
  return children;
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <CartProvider>
          <Boot>
            <App />
          </Boot>
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
