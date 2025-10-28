// client/src/pages/ServiceBudgets.jsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import "../styles/service-budgets.css";
import "../styles/a11y.css";

const PAGE_SIZE = 15;

function parseMoneyFlexible(raw) {
  if (raw == null) return NaN;
  let s = String(raw).trim().replace(/\s+/g, "");
  if (s === "") return NaN;

  s = s.replace(/[^\d.,-]/g, "");

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const last = Math.max(lastComma, lastDot);

  if (last === -1) {
    s = s.replace(/[^\d-]/g, "");
    return s ? Number(s) : NaN;
  }

  const intPart = s.slice(0, last).replace(/[^\d-]/g, "");
  const decPart = s.slice(last + 1).replace(/[^\d]/g, "");
  const normalized = `${intPart}.${decPart}`;

  const num = Number(normalized);
  return Number.isFinite(num) ? num : NaN;
}

export default function ServiceBudgets() {
  const nav = useNavigate();
  const { user, loading } = useAuth();

  // Gate: solo admin
  useEffect(() => {
    if (!loading) {
      const isAdmin = (user?.roles || []).map(r => String(r).toLowerCase()).includes("admin");
      if (!user || !isAdmin) nav("/app");
    }
  }, [user, loading, nav]);

  const [rows, setRows] = useState([]);          
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [status, setStatus] = useState("");

  // drafts controlados por fila para no depender de recarga
  const [drafts, setDrafts] = useState({});      

  // Paginación
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try {
      const data = (await api.get("/admin/service-budgets")).data || [];
      setRows(data);
      setDrafts({}); 
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => { setPage(1); }, [q]);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return rows;
    return rows.filter(r =>
      String(r.name || "").toLowerCase().includes(k) ||
      String(r.id ?? "").includes(k)
    );
  }, [rows, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const startIdx = (pageSafe - 1) * PAGE_SIZE;
  const endIdx = startIdx + PAGE_SIZE;
  const pageRows = filtered.slice(startIdx, endIdx);

  const onSave = async (id, valRaw) => {
    setSavingId(id);
    setStatus("");
    try {
      const presupuesto = parseMoneyFlexible(valRaw);
      if (!Number.isFinite(presupuesto) || presupuesto < 0) throw new Error("Presupuesto inválido");

      // Persistimos en server
      await api.put(`/admin/service-budgets/${id}`, { presupuesto });
      setRows(prev => prev.map(r => (r.id === id ? { ...r, budget: presupuesto } : r)));

      // Limpiamos el draft para que el input muestre el valor "oficial"
      setDrafts(d => {
        const nx = { ...d };
        delete nx[id];
        return nx;
      });

      setStatus("Presupuesto guardado.");
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally {
      setSavingId(null);
    }
  };

  const goFirst = () => setPage(1);
  const goPrev  = () => setPage(p => Math.max(1, p - 1));
  const goNext  = () => setPage(p => Math.min(totalPages, p + 1));
  const goLast  = () => setPage(totalPages);

  if (loading) return <div className="sb-state">Cargando…</div>;

  return (
    <div className="sb-container">
      <header className="sb-header">
        <div className="sb-title">
          <h1>Presupuesto de servicios</h1>
          <p className="sb-sub">
            Definí el presupuesto base por servicio. Un pedido no puede superar el <strong>5%</strong> de este valor.
          </p>
        </div>
        <div className="sb-actions">
          <Link className="sb-btn" to="/app/admin">← Volver al panel</Link>
        </div>
      </header>

      {/* región viva de estado accesible */}
      <p className="sr-only" aria-live="polite">{status}</p>
      {err && <div role="alert" className="sb-alert error">{err}</div>}

      <div className="sb-toolbar" role="region" aria-label="Búsqueda de servicios">
        <label htmlFor="sb-q" className="sr-only">Buscar servicio</label>
        <input
          id="sb-q"
          className="sb-input"
          placeholder="Buscar servicio…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="sb-table" role="table" aria-label="Listado de presupuestos por servicio">
        <div className="sb-thead" role="rowgroup">
          <div className="sb-tr" role="row">
            <div role="columnheader">Servicio</div>
            <div role="columnheader" className="num">Presupuesto</div>
            <div role="columnheader">Acciones</div>
          </div>
        </div>
        <div className="sb-tbody" role="rowgroup">
          {pageRows.map(r => {
            const inputId = `b-${r.id}`;
            const inputValue =
              drafts[r.id] ??
              (r.budget === null || r.budget === undefined || r.budget === ""
                ? ""
                : String(r.budget).replace(".", ","));
            return (
              <div key={r.id} className="sb-tr" role="row">
                <div className="td" role="cell">
                  <div className="sb-service">{r.name}</div>
                  <div className="sb-id">ID: {r.id}</div>
                </div>
                <div className="td num" role="cell">
                  <label htmlFor={inputId} className="sr-only">Presupuesto para {r.name}</label>
                  <input
                    id={inputId}
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={inputValue}
                    onChange={(e) => setDrafts(d => ({ ...d, [r.id]: e.target.value }))}
                    className="sb-input sb-money mono"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        onSave(r.id, inputValue);
                      }
                    }}
                  />
                </div>
                <div className="td" role="cell">
                  <button
                    className="sb-btn primary"
                    onClick={() => onSave(r.id, inputValue)}
                    disabled={savingId === r.id}
                    aria-label={`Guardar presupuesto de ${r.name}`}
                  >
                    {savingId === r.id ? "Guardando…" : "Guardar"}
                  </button>
                </div>
              </div>
            );
          })}
          {pageRows.length === 0 && (
            <div className="sb-tr" role="row">
              <div className="td" role="cell" style={{ gridColumn: "1 / -1" }}>Sin resultados</div>
            </div>
          )}
        </div>
      </div>

      {/* Paginación */}
      <nav className="sb-pager" role="navigation" aria-label="Paginación de servicios">
        <div className="sb-pager-info" aria-live="polite">
          {filtered.length > 0
            ? <>Mostrando <strong>{filtered.length === 0 ? 0 : startIdx + 1}</strong>–<strong>{Math.min(endIdx, filtered.length)}</strong> de <strong>{filtered.length}</strong> servicios</>
            : <>Sin resultados</>}
        </div>
        <div className="sb-page-controls">
          <button className="sb-page-btn" onClick={goFirst} disabled={pageSafe <= 1} aria-label="Primera página">«</button>
          <button className="sb-page-btn" onClick={goPrev}  disabled={pageSafe <= 1} aria-label="Página anterior">‹</button>
          <span className="sb-pager-info" style={{ padding: "0 6px" }}>
            Página <strong>{pageSafe}</strong> de <strong>{totalPages}</strong>
          </span>
          <button className="sb-page-btn" onClick={goNext}  disabled={pageSafe >= totalPages} aria-label="Página siguiente">›</button>
          <button className="sb-page-btn" onClick={goLast}  disabled={pageSafe >= totalPages} aria-label="Última página">»</button>
        </div>
      </nav>
    </div>
  );
}
