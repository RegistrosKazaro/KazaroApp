// client/src/context/EmpresaProvider.jsx
import { useState, useEffect } from "react";
import { EmpresaContext } from "./empresa-context";

const STORAGE_KEY = "kazaro_empresa";

function applyTheme(slug) {
  let styleEl = document.getElementById("empresa-theme");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "empresa-theme";
    document.head.appendChild(styleEl);
  }

  if (slug === "pazar") {
   styleEl.textContent = `
  :root {
    --brand:        #2d8653;
    --brand-dark:   #1a5c3a;
    --brand-light:  #f0faf4;
    --border-focus: #2d8653;
    --ring:         rgba(45,134,83,.25);
    --primary:      #2d8653;

    /* Service budgets */
    --sb-primary:       #2d8653;
    --sb-primary-700:   #1a5c3a;
    --sb-primary-weak:  #f0faf4;
    --sb-bg:            #f0faf4;
    --sb-ring:          rgba(45,134,83,.35);

    /* Reports */
    --rp-primary:       #2d8653;
    --rp-primary-dark:  #1a5c3a;
    --rp-primary-soft:  #dcfce7;
    --rp-focus:         rgba(45,134,83,.35);
    --rp-bg:            #f0faf4;
  }

  /* Navbar */
  .appbar { background: #1a5c3a !important; }
  .pill.active { background: #2d8653 !important; border-color: #2d8653 !important; }
  .pill.danger { background: #b91c1c !important; border-color: #b91c1c !important; }

  /* Botones generales app.css */
  .btn { background: #2d8653 !important; border-color: #1a5c3a !important; }
  .btn:hover { background: #1a5c3a !important; }

  /* Tabs del admin panel */
  .admin-panel .tabs { background: #dcfce7 !important; box-shadow: inset 0 0 0 1px #86efac !important; }
  .admin-panel .tab-btn { color: #14532d !important; }
  .admin-panel .tab-btn:hover { background: #bbf7d0 !important; }
  .admin-panel .tab-btn.is-active {
    background: #2d8653 !important;
    color: #f0fdf4 !important;
    box-shadow: 0 6px 16px rgba(45,134,83,.35) !important;
  }
  .admin-panel { background: #f0faf4 !important; }

  /* Reports — botones y pills */
  .reports-page { background: #f0faf4 !important; }
  .reports-page .pill { border-color: #2d8653 !important; color: #1a5c3a !important; }
  .reports-page .pill.active,
  .reports-page .pill--active,
  .reports-page .pill.is-active { background: #2d8653 !important; color: #fff !important; }
  .rp-btn-primary,
  .reports-page button[class*="primary"],
  .reports-page .btn-current { background: #2d8653 !important; border-color: #1a5c3a !important; color: #fff !important; }
  [class*="rp-"][class*="primary"] { background: #2d8653 !important; color: #fff !important; }

  /* Service budgets — encabezados y botones */
  .sb-container { background: #f0faf4 !important; }
  .sb-th-sort { color: #2d8653 !important; }
  [class*="sb-btn"][class*="primary"],
  .sb-btn-primary { background: #2d8653 !important; border-color: #1a5c3a !important; color: #fff !important; }

  /* Login */
  .login-title { color: #1a5c3a !important; }
  .login-subtitle strong { color: #2d8653 !important; }
  .field-group label { color: #1a5c3a !important; }
  .btn-primary { background: #2d8653 !important; border-color: #1a5c3a !important; box-shadow: 0 4px 14px rgba(45,134,83,.30) !important; }
  .btn-primary:hover { background: #1a5c3a !important; }
  .input:focus { border-color: #2d8653 !important; box-shadow: 0 0 0 3px rgba(45,134,83,.25) !important; }

  /* Reports — pills y degradado */
  .reports-page {
    background: #f0faf4 !important;
  }
  .reports-page .pill {
    background-image: none !important;
    background-color: #2d8653 !important;
    color: #fff !important;
    border-color: #1a5c3a !important;
    box-shadow: 0 4px 10px rgba(45,134,83,.25) !important;
  }
  .reports-page .pill:hover:not(:disabled) {
    background-color: #1a5c3a !important;
    box-shadow: 0 8px 20px rgba(45,134,83,.30) !important;
  }
  .reports-page .pill--ghost {
    background-color: #fff !important;
    background-image: none !important;
    color: #1a5c3a !important;
    border-color: #86efac !important;
  }
  .reports-page .pill--ghost:hover:not(:disabled) {
    background-color: #f0faf4 !important;
    border-color: #2d8653 !important;
  }

  /* Admin panel — botones primary, ghost y tonal */
  .admin-panel .btn.primary {
    background: #2d8653 !important;
    border-color: #1a5c3a !important;
    color: #fff !important;
  }
  .admin-panel .btn.primary:hover {
    background: #1a5c3a !important;
  }
  .admin-panel .btn.ghost {
    color: #2d8653 !important;
    border-color: #2d8653 !important;
  }
  .admin-panel .btn.ghost:hover {
    background: #f0faf4 !important;
  }
  .admin-panel .transfer-actions .btn.primary {
    background: #2d8653 !important;
    border-color: #1a5c3a !important;
  }
  .admin-panel .transfer-actions .btn.primary:hover {
    background: #1a5c3a !important;
  }
  .admin-panel .transfer-actions .btn.tonal {
    background: #dcfce7 !important;
    color: #14532d !important;
    border-color: #86efac !important;
  }
  .admin-panel .transfer-actions .btn.tonal:hover {
    background: #bbf7d0 !important;
  }
    /* Botones deshabilitados — hacerlos visibles */
  .admin-panel .btn:disabled {
    opacity: 0.45 !important;
    background: #2d8653 !important;
    color: #fff !important;
  }

  /* Subir Excel y botones ghost del admin */
  .admin-panel .btn {
    background: #2d8653 !important;
    border-color: #1a5c3a !important;
    color: #fff !important;
  }
  .admin-panel .btn:hover:not(:disabled) {
    background: #1a5c3a !important;
  }

  /* Tablas — encabezados azules */
  .admin-panel th,
  .admin-panel .th,
  .admin-panel [class*="th"] {
    color: #1a5c3a !important;
    border-color: #86efac !important;
  }
  .admin-panel table thead tr {
    background: #dcfce7 !important;
  }
  .admin-panel table thead th {
    color: #14532d !important;
  }

  /* Service budgets — encabezados tabla */
  .sb-table thead th,
  .sb-th-sort,
  [class*="sb-th"] {
    color: #1a5c3a !important;
  }
  .sb-table thead {
    background: #dcfce7 !important;
  }

  /* Reasignación masiva — botones tonal/secundarios */
  .admin-panel .btn.tonal {
    background: #dcfce7 !important;
    color: #14532d !important;
    border-color: #86efac !important;
  }
  .admin-panel .btn.tonal:hover:not(:disabled) {
    background: #bbf7d0 !important;
  }

  /* Historial — botón Exportar CSV deshabilitado */
  .admin-panel .btn:disabled {
    background: #86efac !important;
    color: #14532d !important;
    border-color: #4ade80 !important;
    opacity: 0.6 !important;
    cursor: not-allowed !important;
  }

  /* Empleados — botón Recargar */
  .admin-panel .btn.ghost {
    background: transparent !important;
    color: #2d8653 !important;
    border-color: #2d8653 !important;
  }
  .admin-panel .btn.ghost:hover {
    background: #f0faf4 !important;
  }

  /* Editar empleado — botón celeste */
  .admin-panel .btn-edit,
  .admin-panel button[class*="edit"] {
    color: #2d8653 !important;
    border-color: #2d8653 !important;
  }

  /* Fondo degradado informes — sacar degradado */
  .reports-page {
    background: #f0faf4 !important;
  }

  /* Seleccioná todo / Limpiar en reasignación */
  .admin-panel .transfer-tools .btn {
    background: #dcfce7 !important;
    color: #14532d !important;
    border-color: #86efac !important;
  }
  .admin-panel .transfer-tools .btn:hover:not(:disabled) {
    background: #bbf7d0 !important;
  }

  /* Invertir lados */
  .admin-panel .transfer-actions .btn {
    background: #2d8653 !important;
    color: #fff !important;
    border-color: #1a5c3a !important;
  }
  .admin-panel .transfer-actions .btn:hover:not(:disabled) {
    background: #1a5c3a !important;
  }

  /* Intercambiar todos deshabilitado */
  .admin-panel .transfer-actions .btn:disabled {
    background: #86efac !important;
    color: #14532d !important;
    border-color: #4ade80 !important;
    opacity: 0.6 !important;
  }
    /* Botón desactivar empleado */
  .pill.danger {
    background: #dc2626 !important;
    border-color: #b91c1c !important;
    color: #fff !important;
    opacity: 1 !important;
  }
  .pill.danger:hover {
    background: #b91c1c !important;
  }
  `;
  } else {
    styleEl.textContent = `
      :root {
        --brand:        #2563eb;
        --brand-dark:   #1d4ed8;
        --brand-light:  #eff6ff;
        --border-focus: #2563eb;
        --ring:         rgba(37,99,235,.25);
        --primary:      #2563eb;
      }
    `;
  }
}

function loadInitial() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function EmpresaProvider({ children }) {
  const [empresa, setEmpresaState] = useState(loadInitial);

  useEffect(() => {
    applyTheme(empresa?.slug ?? "kazaro");
  }, [empresa]);

  function setEmpresa(emp) {
    try {
      if (emp) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(emp));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch  { /* ignorado */ }
    setEmpresaState(emp);
    applyTheme(emp?.slug ?? "kazaro");
  }

  return (
    <EmpresaContext.Provider value={{ empresa, setEmpresa }}>
      {children}
    </EmpresaContext.Provider>
  );
}