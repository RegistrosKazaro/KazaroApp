// client/src/pages/ServiceBudgets.jsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import "../styles/service-budgets.css";
import "../styles/a11y.css";

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

  const load = useCallback(async () => {
    try { setRows((await api.get("/admin/service-budgets")).data || []); }
    catch (e) { setErr(e?.response?.data?.error || e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return rows;
    return rows.filter(r =>
      String(r.name || "").toLowerCase().includes(k) ||
      String(r.id ?? "").includes(k)
    );
  }, [rows, q]);

  const onSave = async (id, val) => {
    setSavingId(id);
    setStatus("");
    try {
      const presupuesto = Number(val);
      if (!Number.isFinite(presupuesto) || presupuesto < 0) throw new Error("Presupuesto inválido");
      await api.put(`/admin/service-budgets/${id}`, { presupuesto });
      await load();
      setStatus("Presupuesto guardado.");
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally {
      setSavingId(null);
    }
  };

  if (loading) return <div className="sb-state">Cargando…</div>;

  return (
    <div className="sb-container">
      <header className="sb-header">
        <div className="sb-title">
          <h1>Presupuesto de servicios</h1>
          <p className="sb-sub">Definí el presupuesto base por servicio. Un pedido no puede superar el <strong>5%</strong> de este valor.</p>
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
          {filtered.map(r => {
            const inputId = `b-${r.id}`;
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
                    type="number"
                    step="0.01"
                    defaultValue={r.budget ?? ""}
                    className="sb-input mono"
                  />
                </div>
                <div className="td" role="cell">
                  <button
                    className="sb-btn primary"
                    onClick={() => onSave(r.id, document.getElementById(inputId).value)}
                    disabled={savingId===r.id}
                    aria-label={`Guardar presupuesto de ${r.name}`}
                  >
                    {savingId===r.id ? "Guardando…" : "Guardar"}
                  </button>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="sb-tr" role="row">
              <div className="td" role="cell" style={{ gridColumn: "1 / -1" }}>Sin resultados</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
