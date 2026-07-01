import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";

import AuthProvider from "./context/AuthProvider.jsx";
import EmpresaProvider from "./context/EmpresaProvider.jsx";
import CartProvider from "./context/CartProvider.jsx";

import "./styles/global.css";
import { ensureCsrf } from "./api/client";
import "./styles/a11y-boost.css";
import "./styles/ui-polish.css";
import "./styles/ui-kit.css";
import "./styles/ui-kit-full.css";
import "./styles/ui-kit-nav.css";
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
      <EmpresaProvider>
        <AuthProvider>
        <CartProvider>
          <Boot>
            <App />
          </Boot>
        </CartProvider>
      </AuthProvider>
      </EmpresaProvider>
    </BrowserRouter>
  </React.StrictMode>
);
