// client/src/pages/AdminPanel.jsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import "../styles/admin-panel.css";
import "../styles/a11y.css";

// (Opcional) ya existe en tu repo:
import MassReassignServicesSection from "./MassReassignServicesSection";

/* -----------------------------------------------------------
 * Utilidades locales
 * --------------------------------------------------------- */
const API_BASE_URL =
  (import.meta?.env && import.meta.env.VITE_API_URL) ||
  "http://localhost:4000";

const money = (v) => {
  const n = Number(v || 0);
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$ ${n.toFixed(2)}`;
  }
};
const clampInt = (v, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Math.min(max, Math.max(min, parseInt(v ?? 0, 10) || 0));
const useDebounced = (value, delay = 300) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
};

/* ===========================================================
 * 1) Productos
 * ========================================================= */
function ProductsSection() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const qDeb = useDebounced(q, 350);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  // Categorías
  const [cats, setCats] = useState([]);
  const [catsErr, setCatsErr] = useState("");

  // Edición/alta
  const [editingId, setEditingId] = useState(null); // null | "__new__" | id
  const [draft, setDraft] = useState({
    name: "",
    price: "",
    stock: "",
    code: "",
    catId: "",
  });
  const [catTouched, setCatTouched] = useState(false);
  const [editingLoading, setEditingLoading] = useState(false);
  const nameRef = useRef(null);

  // Edición rápida de stock
  const [stockEdit, setStockEdit] = useState(null); // { id, value }

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const { data } = await api.get("/admin/products", {
        params: { q: String(qDeb || "").trim(), limit: 200 },
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, [qDeb]);

  const loadCats = useCallback(async () => {
    try {
      const { data } = await api.get("/catalog/categories");
      setCats(Array.isArray(data) ? data : []);
      setCatsErr("");
    } catch (e) {
      setCats([]);
      setCatsErr(
        e?.response?.data?.error ||
          e.message ||
          "No se pudieron cargar las categorías"
      );
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadCats();
  }, [loadCats]);

  const startNew = () => {
    setEditingId("__new__");
    setCatTouched(false);
    setDraft({
      name: "",
      price: "",
      stock: "",
      code: "",
      catId: "",
    });
    setTimeout(() => nameRef.current?.focus(), 0);
  };

  const onEdit = async (row) => {
    if (!row || !row.id) {
      startNew();
      return;
    }
    setStatusMsg("");
    setErr("");
    setCatTouched(false);

    // Mostrar algo inmediato
    setEditingId(row.id);
    setDraft({
      name: row.name ?? "",
      price: row.price ?? "",
      stock: row.stock ?? "",
      code: row.code ?? "",
      catId: "",
    });

    setEditingLoading(true);
    try {
      const { data } = await api.get(`/admin/products/${row.id}`);
      setDraft((prev) => ({
        ...prev,
        name: data?.name ?? prev.name ?? "",
        price: data?.price ?? prev.price ?? "",
        stock: data?.stock ?? prev.stock ?? "",
        code: data?.code ?? prev.code ?? "",
        catId:
          data?.categoryId != null
            ? String(data.categoryId)
            : data?.categoryName != null
            ? String(data.categoryName)
            : prev.catId ?? "",
      }));
    } catch {
      setErr("No se pudo cargar el producto completo");
    } finally {
      setEditingLoading(false);
      setTimeout(() => nameRef.current?.focus(), 0);
    }
  };

  const onCancel = () => {
    setEditingId(null);
    setCatTouched(false);
    setDraft({ name: "", price: "", stock: "", code: "", catId: "" });
    setStatusMsg("");
    setErr("");
  };

  const onSave = async () => {
    setStatusMsg("");
    setErr("");

    const payload = {
      name: String(draft.name || "").trim(),
      price:
        draft.price === "" || draft.price === null
          ? null
          : Number(draft.price),
      stock:
        draft.stock === "" || draft.stock === null
          ? null
          : Number(draft.stock),
      code:
        draft.code === "" || draft.code === null ? null : String(draft.code),
    };

    if (!payload.name) {
      setErr("El nombre es requerido");
      return;
    }

    // Categoría
    if (editingId === "__new__") {
      payload.catId = draft.catId || null;
    } else if (catTouched) {
      payload.catId = draft.catId || null;
    }

    try {
      if (editingId && editingId !== "__new__") {
        await api.put(`/admin/products/${editingId}`, payload);
        setStatusMsg("Producto actualizado.");
      } else {
        await api.post("/admin/products", payload);
        setStatusMsg("Producto creado.");
      }
      await load();
      onCancel();
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    }
  };

  const onDelete = async (id) => {
    if (!confirm("¿Eliminar producto?")) return;
    try {
      await api.delete(`/admin/products/${id}`);
      await load();
      setStatusMsg("Producto eliminado.");
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    }
  };

  const startStockEdit = (row) =>
    setStockEdit({ id: row.id, value: row.stock ?? 0 });

  const cancelStockEdit = () => setStockEdit(null);

  const saveStock = async () => {
    try {
      await api.put(`/admin/products/${stockEdit.id}`, {
        stock: Number(stockEdit.value),
      });
      await load();
      setStatusMsg("Stock actualizado.");
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally {
      cancelStockEdit();
    }
  };

  const onKeyDownStock = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveStock();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelStockEdit();
    }
  };

  return (
    <section className="srv-card" aria-labelledby="products-heading">
      <div className="section-header">
        <h3 id="products-heading">Productos</h3>
        <div className="toolbar" role="search">
          <input
            className="input"
            placeholder="Buscar… (mín. 2 letras)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Buscar productos"
          />
          <button className="btn" onClick={load} disabled={loading}>
            {loading ? "Buscando…" : "Buscar"}
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn primary" onClick={startNew}>
            + Nuevo
          </button>
        </div>
        {(statusMsg || err) && (
          <div
            className={`state ${err ? "error" : "success"}`}
            role={err ? "alert" : "status"}
          >
            {err || statusMsg}
          </div>
        )}
      </div>

      {/* Form alta/edición */}
      {editingId !== null && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="grid-4">
            <label>
              <span>Nombre</span>
              <input
                ref={nameRef}
                className="input"
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
              />
            </label>
            <label>
              <span>Precio</span>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={draft.price}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, price: e.target.value }))
                }
              />
            </label>
            <label>
              <span>Stock</span>
              <input
                className="input"
                type="number"
                inputMode="numeric"
                value={draft.stock}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, stock: e.target.value }))
                }
              />
            </label>
            <label>
              <span>Código</span>
              <input
                className="input"
                value={draft.code}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, code: e.target.value }))
                }
              />
            </label>
            <label>
              <span>Categoría</span>
              <select
                className="select"
                value={draft.catId}
                onChange={(e) => {
                  const value = e.target.value;
                  setDraft((d) => ({ ...d, catId: value }));
                  setCatTouched(true);
                }}
              >
                <option value="">— Sin categoría —</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {catsErr && (
                <div className="hint" role="alert">
                  {catsErr}
                </div>
              )}
            </label>
          </div>

          {editingLoading && editingId !== "__new__" && (
            <div className="hint" style={{ marginTop: 6 }}>
              Cargando datos del producto…
            </div>
          )}

          <div className="actions-row">
            <button className="btn primary" onClick={onSave}>
              Guardar
            </button>
            <button className="btn ghost" onClick={onCancel}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Tabla */}
      {loading ? (
        <div className="state">Cargando…</div>
      ) : rows.length === 0 ? (
        <div className="state">Sin resultados</div>
      ) : (
        <div className="table like" role="table" aria-label="Lista de productos">
          <div className="t-head" role="row">
            <div style={{ flex: 4 }}>Nombre</div>
            <div style={{ flex: 2, textAlign: "right" }}>Precio</div>
            <div style={{ flex: 2, textAlign: "center" }}>Stock</div>
            <div style={{ flex: 2 }}>Código</div>
            <div style={{ width: 160 }} />
          </div>
          {rows.map((r) => (
            <div key={r.id} className="t-row" role="row">
              <div style={{ flex: 4, minWidth: 0 }}>
                <div className="truncate">
                  {r.name} <span className="muted">#{r.id}</span>
                </div>
              </div>
              <div style={{ flex: 2, textAlign: "right" }}>
                {r.price == null ? "—" : money(r.price)}
              </div>
              <div style={{ flex: 2, textAlign: "center" }}>
                {stockEdit?.id === r.id ? (
                  <input
                    className="input"
                    type="number"
                    inputMode="numeric"
                    value={stockEdit.value}
                    onChange={(e) =>
                      setStockEdit((s) => ({
                        ...s,
                        value: clampInt(e.target.value, 0),
                      }))
                    }
                    onKeyDown={onKeyDownStock}
                    style={{ width: 94, textAlign: "center" }}
                    aria-label={`Stock para ${r.name}`}
                  />
                ) : (
                  r.stock ?? 0
                )}
              </div>
              <div style={{ flex: 2 }}>{r.code ?? "—"}</div>
              <div
                style={{
                  width: 160,
                  display: "flex",
                  gap: 6,
                  justifyContent: "flex-end",
                }}
              >
                {stockEdit?.id === r.id ? (
                  <>
                    <button className="pill" onClick={saveStock}>
                      Guardar
                    </button>
                    <button className="pill ghost" onClick={cancelStockEdit}>
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    <button className="pill" onClick={() => startStockEdit(r)}>
                      Stock
                    </button>
                    <button className="pill" onClick={() => onEdit(r)}>
                      Editar
                    </button>
                    <button
                      className="pill danger"
                      onClick={() => onDelete(r.id)}
                      aria-label={`Eliminar ${r.name}`}
                    >
                      Eliminar
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ===========================================================
 * 2) Asignar servicios a supervisores
 * ========================================================= */
function AssignServicesSection() {
  const [supervisors, setSupervisors] = useState([]);
  const [selectedSupervisor, setSelectedSupervisor] = useState("");
  const [assignments, setAssignments] = useState([]);

  const [q, setQ] = useState("");
  const qDeb = useDebounced(q, 300);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const loadSupervisors = useCallback(async () => {
    try {
      setSupervisors((await api.get("/admin/supervisors")).data || []);
    } catch {
      setMsg("Error al listar supervisores");
    }
  }, []);

  const loadAssignments = useCallback(async () => {
    if (!selectedSupervisor) {
      setAssignments([]);
      return;
    }
    try {
      const { data } = await api.get("/admin/assignments", {
        params: { EmpleadoID: selectedSupervisor },
      });
      setAssignments(Array.isArray(data) ? data : []);
    } catch {
      setMsg("Error al listar asignaciones");
    }
  }, [selectedSupervisor]);

  const searchServices = useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      if (!qDeb || String(qDeb).trim().length < 2) {
        setServices([]);
        return;
      }
      const { data } = await api.get("/admin/services", {
        params: { q: String(qDeb).trim(), limit: 50 },
      });
      setServices(Array.isArray(data) ? data : []);
    } catch {
      setMsg("Error al buscar servicios");
    } finally {
      setLoading(false);
    }
  }, [qDeb]);

  useEffect(() => {
    loadSupervisors();
  }, [loadSupervisors]);

  useEffect(() => {
    loadAssignments();
  }, [loadAssignments]);

  useEffect(() => {
    searchServices();
  }, [searchServices]);

  const onAssign = async (serviceId) => {
    if (!selectedSupervisor) {
      setMsg("Elegí un supervisor");
      return;
    }
    try {
      await api.post("/admin/assignments", {
        EmpleadoID: Number(selectedSupervisor),
        ServicioID: Number(serviceId),
      });
      setMsg("Servicio asignado");
      await loadAssignments();
      await searchServices();
    } catch {
      setMsg("No se pudo asignar");
    }
  };

  const onUnassign = async (assignmentRowId, serviceName) => {
    if (!confirm(`¿Quitar ${serviceName} del supervisor?`)) return;
    try {
      await api.delete(`/admin/assignments/${assignmentRowId}`);
      setMsg("Asignación eliminada");
      await loadAssignments();
      await searchServices();
    } catch {
      setMsg("No se pudo eliminar");
    }
  };

  return (
    <section className="srv-card" aria-labelledby="assign-heading">
      <div className="section-header">
        <h3 id="assign-heading">Asignar servicios a supervisores</h3>
        {msg && <div className="state">{msg}</div>}
      </div>

      <div className="toolbar">
        <label className="select-row">
          <span>Supervisor</span>
          <select
            className="select"
            value={selectedSupervisor}
            onChange={(e) => setSelectedSupervisor(e.target.value)}
            aria-label="Supervisor"
          >
            <option value="">— Elegí —</option>
            {supervisors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.username} (#{s.id})
              </option>
            ))}
          </select>
        </label>

        <input
          className="input"
          placeholder="Buscar servicio… (mín. 2 letras)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Buscar servicio"
        />
        <button className="btn" onClick={searchServices} disabled={loading}>
          {loading ? "Buscando…" : "Buscar"}
        </button>
      </div>

      {!selectedSupervisor ? (
        <div className="hint">Elegí un supervisor y buscá un servicio.</div>
      ) : (
        <div className="grid-2">
          <div>
            <h4>Resultados</h4>
            <div className="list">
              {services.length === 0 ? (
                <div className="state">
                  {qDeb?.length >= 2
                    ? "Sin coincidencias."
                    : "Escribí para buscar…"}
                </div>
              ) : (
                services.map((s) => (
                  <div key={s.id} className="list-row">
                    <div className="truncate">
                      {s.name} <span className="muted">#{s.id}</span>
                    </div>
                    <div>
                      {s.is_assigned ? (
                        <span className="pill">Asignado</span>
                      ) : (
                        <button
                          className="pill"
                          onClick={() => onAssign(s.id)}
                          aria-label={`Asignar ${s.name}`}
                        >
                          Asignar
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <h4>Asignados</h4>
            <div className="list">
              {assignments.length === 0 ? (
                <div className="state">Sin asignaciones.</div>
              ) : (
                assignments.map((a) => (
                  <div key={a.id} className="list-row">
                    <div className="truncate">
                      {a.service_name}{" "}
                      <span className="muted">ID: {a.ServicioID}</span>
                    </div>
                    <button
                      className="pill danger"
                      onClick={() => onUnassign(a.id, a.service_name)}
                      aria-label={`Quitar ${a.service_name}`}
                    >
                      Quitar
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ===========================================================
 * 3) Relación Servicio ↔ Productos
 * ========================================================= */
function ServiceProductsSection() {
  const [step, setStep] = useState("pick"); // pick | manage
  const [service, setService] = useState(null);

  // Búsqueda de servicio
  const [qSrv, setQSrv] = useState("");
  const qSrvDeb = useDebounced(qSrv, 300);
  const [srvResults, setSrvResults] = useState([]);
  const [srvLoading, setSrvLoading] = useState(false);
  const [srvMsg, setSrvMsg] = useState("");

  // Productos
  const [q, setQ] = useState("");
  const qDeb = useDebounced(q, 300);
  const [allRows, setAllRows] = useState([]); // todos los productos
  const [rows, setRows] = useState([]); // filtrados
  const [selected, setSelected] = useState(new Set());
  const [assignMsg, setAssignMsg] = useState("");
  const [saving, setSaving] = useState(false);

  // Buscar servicio
  const searchServices = useCallback(async () => {
    setSrvLoading(true);
    setSrvMsg("");
    try {
      const term = String(qSrvDeb || "").trim();
      if (!term || term.length < 2) {
        setSrvResults([]);
        return;
      }
      const { data } = await api.get("/admin/services", {
        params: { q: term, limit: 50 },
      });
      setSrvResults(Array.isArray(data) ? data : []);
    } catch {
      setSrvMsg("Error al buscar servicios");
    } finally {
      setSrvLoading(false);
    }
  }, [qSrvDeb]);

  // Cargar productos y preselección por servicio
  const loadProductsAndSelection = useCallback(async () => {
    if (!service) return;
    setAssignMsg("");
    try {
      const { data: products } = await api.get("/admin/products", {
        params: { q: "", limit: 500 },
      });
      setAllRows(Array.isArray(products) ? products : []);

      const current = await api.get(`/admin/sp/assignments/${service.id}`);
      const ids = new Set((current.data?.productIds || []).map(String));
      setSelected(ids);
    } catch {
      setAssignMsg("Error al cargar datos");
    }
  }, [service]);

  // Filtro de productos
  useEffect(() => {
    const term = String(qDeb || "").trim().toLowerCase();
    if (!term) {
      setRows(allRows);
    } else {
      setRows(
        allRows.filter((p) => {
          const name = String(p?.name ?? "").toLowerCase();
          const idStr = String(p?.id ?? "");
          const code = String(p?.code ?? "").toLowerCase();
          return (
            name.includes(term) ||
            idStr.includes(term) ||
            (!!code && code.includes(term))
          );
        })
      );
    }
  }, [qDeb, allRows]);

  useEffect(() => {
    searchServices();
  }, [searchServices]);

  useEffect(() => {
    loadProductsAndSelection();
  }, [loadProductsAndSelection]);

  const toggle = (id) => {
    setSelected((prev) => {
      const s = new Set(prev);
      const k = String(id);
      if (s.has(k)) s.delete(k);
      else s.add(k);
      return s;
    });
  };

  const save = async () => {
    if (!service) return;
    setSaving(true);
    setAssignMsg("");
    try {
      const res = await api.put(`/admin/sp/assignments/${service.id}`, {
        productIds: Array.from(selected),
      });
      const added = res?.data?.added?.length || 0;
      const removed = res?.data?.removed?.length || 0;
      setAssignMsg(`Guardado. +${added} / -${removed}`);
    } catch {
      setAssignMsg("No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="srv-card" aria-labelledby="sp-heading">
      <h3 id="sp-heading">Servicio ↔ Productos</h3>

      {step === "pick" && (
        <>
          <div className="toolbar">
            <input
              className="input"
              value={qSrv}
              onChange={(e) => setQSrv(e.target.value)}
              placeholder="Buscar servicio (mín. 2 letras)…"
            />
            <button className="btn" onClick={searchServices} disabled={srvLoading}>
              {srvLoading ? "Buscando…" : "Buscar"}
            </button>
          </div>

          {srvMsg && <div className="state">{srvMsg}</div>}

          <div className="list">
            {srvResults.length === 0 ? (
              <div className="state">Sin resultados</div>
            ) : (
              srvResults.map((s) => (
                <div key={s.id} className="list-row">
                  <div className="truncate">
                    {s.name} <span className="muted">#{s.id}</span>
                  </div>
                  <button
                    className="pill"
                    onClick={() => {
                      setService({ id: s.id, name: s.name });
                      setStep("manage");
                    }}
                  >
                    Elegir
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {step === "manage" && (
        <>
          <div className="section-header">
            <div className="muted">
              Servicio seleccionado: <strong>{service.name}</strong> (#{service.id})
            </div>
            <div className="actions-row">
              <button className="btn ghost" onClick={() => setStep("pick")}>
                Cambiar servicio
              </button>
              <button className="btn primary" onClick={save} disabled={saving}>
                {saving ? "Guardando…" : "Guardar asignaciones"}
              </button>
            </div>
            {assignMsg && <div className="state">{assignMsg}</div>}
          </div>

          <div className="toolbar">
            <input
              className="input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filtrar productos (ID, nombre o código)…"
            />
          </div>

          <div className="table like">
            <div className="t-head">
              <div style={{ flex: 4 }}>Producto</div>
              <div style={{ flex: 2 }}>Código</div>
              <div style={{ flex: 2, textAlign: "right" }}>Precio</div>
              <div style={{ width: 120, textAlign: "right" }}>Asignado</div>
            </div>

            {rows.map((p) => {
              const checked = selected.has(String(p.id));
              return (
                <label key={p.id} className="t-row" style={{ cursor: "pointer" }}>
                  <div style={{ flex: 4, minWidth: 0 }}>
                    <div className="truncate">
                      {p.name} <span className="muted">#{p.id}</span>
                    </div>
                  </div>
                  <div style={{ flex: 2 }}>{p.code ?? "—"}</div>
                  <div style={{ flex: 2, textAlign: "right" }}>
                    {p.price == null ? "—" : money(p.price)}
                  </div>
                  <div style={{ width: 120, textAlign: "right" }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(p.id)}
                      aria-label={`Asignar ${p.name}`}
                    />
                  </div>
                </label>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

/* ===========================================================
 * 4) Presupuestos por servicio
 * ========================================================= */
function ServiceBudgetsSection() {
  const [rows, setRows] = useState([]); // [{id, name, budget}]
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState({});
  const [savingIds, setSavingIds] = useState(new Set());

  const PER_PAGE = 15;
  const pageCount = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const start = (page - 1) * PER_PAGE;
  const current = rows.slice(start, start + PER_PAGE);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const data = await api
        .get("/admin/service-budgets")
        .then((r) => r.data || []);
      setRows(data);
    } catch {
      setErr("Error al cargar presupuestos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onSaveOne = async (row) => {
    const raw = drafts[row.id] ?? (row.budget ?? "");
    const presupuesto = Number(raw);
    if (!Number.isFinite(presupuesto) || presupuesto < 0) {
      setErr("Presupuesto inválido");
      return;
    }

    setSavingIds((s) => new Set(s).add(row.id));
    setErr("");
    try {
      await api.put(`/admin/service-budgets/${row.id}`, { presupuesto });
      setRows((prev) =>
        prev.map((it) =>
          it.id === row.id ? { ...it, budget: presupuesto } : it
        )
      );
    } catch {
      setErr("No se pudo guardar");
    } finally {
      setSavingIds((s) => {
        const n = new Set(s);
        n.delete(row.id);
        return n;
      });
    }
  };

  if (loading)
    return (
      <section className="srv-card">
        <div className="state">Cargando…</div>
      </section>
    );

  return (
    <section className="srv-card" aria-labelledby="budgets-heading">
      <div className="section-header">
        <h3 id="budgets-heading">Presupuestos por servicio</h3>
        {err && <div className="state error">{err}</div>}
      </div>

      <div className="list">
        {current.map((row) => {
          const saving = savingIds.has(row.id);
          const value = drafts[row.id] ?? (row.budget ?? "");
          return (
            <div key={row.id} className="budget-item">
              <div className="budget-title">
                <div className="budget-name">{row.name}</div>
                <div className="budget-id">ID: {row.id}</div>
              </div>
              <input
                className="input"
                type="text"
                inputMode="decimal"
                value={value}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [row.id]: e.target.value }))
                }
                placeholder="0"
                style={{ width: 140 }}
                aria-label={`Presupuesto para ${row.name}`}
              />
              <button
                className="btn"
                onClick={() => onSaveOne(row)}
                disabled={saving}
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          );
        })}
      </div>

      <div className="pager">
        <button className="pill" onClick={() => setPage(1)} disabled={page <= 1}>
          «
        </button>
        <button
          className="pill"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
        >
          Anterior
        </button>
        <span className="muted">
          Página {page} / {pageCount}
        </span>
        <button
          className="pill"
          onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          disabled={page >= pageCount}
        >
          Siguiente
        </button>
        <button
          className="pill"
          onClick={() => setPage(pageCount)}
          disabled={page >= pageCount}
        >
          »
        </button>
      </div>
    </section>
  );
}

/* ===========================================================
 * 5) Ingresos de stock programados (preventa)
 * ========================================================= */
function IncomingStockSection() {
  const [search, setSearch] = useState("");
  const searchDeb = useDebounced(search, 300);
  const [searchResults, setSearchResults] = useState([]);
  const [searchMsg, setSearchMsg] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);

  const [product, setProduct] = useState(null);
  const [rows, setRows] = useState([]); // [{id, product_id, qty, eta}]
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [form, setForm] = useState({ qty: "", eta: "" });

  const doFindProduct = useCallback(async () => {
    setSearchLoading(true);
    setSearchMsg("");
    try {
      const term = String(searchDeb || "").trim();
      if (!term || term.length < 2) {
        setSearchResults([]);
        return;
      }
      const { data } = await api.get("/admin/products", {
        params: { q: term, limit: 50 },
      });
      setSearchResults(Array.isArray(data) ? data : []);
    } catch {
      setSearchMsg("Error al buscar");
    } finally {
      setSearchLoading(false);
    }
  }, [searchDeb]);

  useEffect(() => {
    doFindProduct();
  }, [doFindProduct]);

  const load = useCallback(async () => {
    if (!product?.id) return;
    setLoading(true);
    setErr("");
    try {
      const { data } = await api.get(`/admin/incoming-stock/${product.id}`);
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setErr("Error al cargar ingresos");
    } finally {
      setLoading(false);
    }
  }, [product?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setErr("");
    if (!product?.id) {
      setErr("Elegí un producto");
      return;
    }
    const qty = Number(form.qty);
    const eta = String(form.eta || "").trim();
    if (!Number.isFinite(qty) || qty <= 0) {
      setErr("Cantidad inválida");
      return;
    }
    if (!eta) {
      setErr("Fecha estimada requerida");
      return;
    }
    try {
      await api.post("/admin/incoming-stock", {
        productId: product.id,
        qty,
        eta, // "YYYY-MM-DD" o "YYYY-MM-DD HH:mm:ss"
      });
      setForm({ qty: "", eta: "" });
      await load();
    } catch {
      setErr("No se pudo crear");
    }
  };

  const onDelete = async (row) => {
    if (!confirm("¿Eliminar ingreso programado?")) return;
    try {
      await api.delete(`/admin/incoming-stock/${row.id}`);
      await load();
    } catch {
      setErr("No se pudo eliminar");
    }
  };

  return (
    <section className="srv-card" aria-labelledby="incoming-heading">
      <h3 id="incoming-heading">Ingresos programados de stock</h3>

      <div className="toolbar" aria-label="Búsqueda de producto">
        <input
          className="input"
          placeholder="Buscar producto… (mín. 2 letras)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className="btn"
          type="button"
          onClick={doFindProduct}
          disabled={searchLoading}
        >
          {searchLoading ? "Buscando…" : "Buscar"}
        </button>
      </div>

      {searchMsg && <div className="state">{searchMsg}</div>}

      <div className="list">
        {searchResults.length === 0 ? (
          <div className="state">Sin resultados</div>
        ) : (
          searchResults.map((p) => (
            <div key={p.id} className="list-row">
              <div className="truncate">
                {p.name} <span className="muted">#{p.id}</span>
              </div>
              <button
                className="pill"
                onClick={() => setProduct(p)}
                aria-label={`Elegir ${p.name}`}
              >
                Elegir
              </button>
            </div>
          ))
        )}
      </div>

      {product && (
        <>
          <div className="section-header">
            <div className="muted">
              Producto seleccionado: <strong>{product.name}</strong> (#{product.id})
            </div>
          </div>

          <div className="card">
            <div className="grid-3">
              <label>
                <span>Cantidad</span>
                <input
                  className="input"
                  type="number"
                  inputMode="numeric"
                  value={form.qty}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, qty: clampInt(e.target.value, 1) }))
                  }
                />
              </label>
              <label>
                <span>Fecha estimada (YYYY-MM-DD)</span>
                <input
                  className="input"
                  placeholder="2025-12-15"
                  value={form.eta}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, eta: e.target.value }))
                  }
                />
              </label>
              <div className="actions-row">
                <button className="btn primary" onClick={create}>
                  Agregar
                </button>
              </div>
            </div>
            {err && <div className="state error">{err}</div>}
          </div>

          <div className="table like" style={{ marginTop: 12 }}>
            <div className="t-head">
              <div style={{ flex: 4 }}>ETA</div>
              <div style={{ flex: 2, textAlign: "right" }}>Cantidad</div>
              <div style={{ width: 120 }} />
            </div>
            {loading ? (
              <div className="state">Cargando…</div>
            ) : rows.length === 0 ? (
              <div className="state">Sin ingresos</div>
            ) : (
              rows.map((r) => (
                <div key={r.id} className="t-row">
                  <div style={{ flex: 4 }}>{r.eta}</div>
                  <div style={{ flex: 2, textAlign: "right" }}>{r.qty}</div>
                  <div style={{ width: 120, textAlign: "right" }}>
                    <button
                      className="pill danger"
                      onClick={() => onDelete(r)}
                      aria-label={`Eliminar ingreso ${r.id}`}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}

/* ===========================================================
 * 6) Pedidos (admin) — SOLO cerrados + visor de remito
 * ========================================================= */
function OrdersSection() {
  const [orders, setOrders] = useState([]);
  const [err, setErr] = useState("");

  const [selectedOrder, setSelectedOrder] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState("");

  // Detecta "cerrado" con distintas convenciones de backend
  const isClosed = (o) =>
    o?.status === "closed" ||
    String(o?.Estado || "").toLowerCase() === "cerrado" ||
    o?.ClosedAt != null ||
    o?.closedAt != null;

  const load = useCallback(async () => {
    setErr("");
    try {
      const { data } = await api.get("/admin/orders", {
        params: { status: "closed" },
      });
      const arr = Array.isArray(data) ? data : data?.rows || [];
      setOrders(arr.filter(isClosed));
    } catch {
      try {
        const { data } = await api.get("/admin/orders");
        const arr = Array.isArray(data) ? data : data?.rows || [];
        setOrders(arr.filter(isClosed));
      } catch {
        setErr("No se pudieron cargar los pedidos cerrados");
        setOrders([]);
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Si borro un pedido seleccionado, cierro visor y limpio blob
  useEffect(() => {
    if (selectedOrder && !orders.some((o) => o.id === selectedOrder.id)) {
      setSelectedOrder(null);
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
        setPdfUrl(null);
      }
    }
  }, [orders, selectedOrder, pdfUrl]);

  const formatFecha = (raw) => {
    if (!raw) return "";
    try {
      const base = String(raw).replace(" ", "T");
      const d = new Date(base + "-03:00"); // AR -03
      return d.toLocaleString("es-AR", {
        timeZone: "America/Argentina/Cordoba",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return raw;
    }
  };

  // --------- Utils robustos para PDF ----------
  const isPdfBlob = async (blob) => {
    try {
      const head = await blob.slice(0, 5).text(); // "%PDF-"
      return head.startsWith("%PDF-");
    } catch {
      return false;
    }
  };
  const toBlobUrl = (blob) => URL.createObjectURL(blob);

  const tryLoadPdfFromPath = async (path) => {
    try {
      const res = await api.get(path, {
        responseType: "blob",
        headers: { Accept: "application/pdf" },
        withCredentials: true,
      });
      const ct = (res.headers?.["content-type"] || res.headers?.["Content-Type"] || "").toLowerCase();
      let blob = res.data;
      if (!ct.includes("application/pdf")) {
        if (!(blob instanceof Blob) || !(await isPdfBlob(blob))) {
          const txt = await blob.text().catch(() => "");
          throw new Error(`Content-Type="${ct}". ${txt ? "Detalle: " + txt : ""}`);
        }
      }
      return { url: toBlobUrl(blob), via: "axios-blob" };
    } catch {
      try {
        const res = await api.get(path, {
          responseType: "arraybuffer",
          headers: { Accept: "application/pdf" },
          withCredentials: true,
        });
        const ct = (res.headers?.["content-type"] || res.headers?.["Content-Type"] || "").toLowerCase();
        const blob = new Blob([res.data], { type: ct || "application/pdf" });
        if (!(await isPdfBlob(blob))) {
          let textPreview = "";
          try {
            textPreview = new TextDecoder().decode(res.data.slice(0, 256));
          } catch {
            textPreview = "";
          }
          throw new Error(
            `Respuesta no parece PDF (arraybuffer). ${textPreview ? "Preview: " + textPreview : ""}`
          );
        }
        return { url: toBlobUrl(blob), via: "axios-arraybuffer" };
      } catch {
        const abs = (API_BASE_URL?.replace(/\/$/, "") || "") + path;
        const r = await fetch(abs, {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/pdf" },
        });
        const ct = (r.headers.get("content-type") || "").toLowerCase();
        const blob = await r.blob();
        if (!ct.includes("application/pdf") && !(await isPdfBlob(blob))) {
          const txt = await blob.text().catch(() => "");
          throw new Error(`Fetch: Content-Type="${ct}". ${txt ? "Detalle: " + txt : ""}`);
        }
        return { url: toBlobUrl(blob), via: "fetch" };
      }
    }
  };

  const fetchRemitoPdfSmart = async (orderId) => {
    const candidates = [
      `/admin/orders/pdf/${orderId}`,
      `/orders/pdf/${orderId}`,
      `/orders/${orderId}/pdf`,
    ];
    let lastErr = null;
    for (const path of candidates) {
      try {
        const r = await tryLoadPdfFromPath(path);
        console.debug("[Remito] cargado desde:", path, "via", r.via);
        return { url: r.url, path };
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) throw lastErr;
    throw new Error("No se encontró ninguna ruta válida para el remito.");
  };
  // -------------------------------------------

  const onPreviewRemito = async (order) => {
    setPreviewLoading(true);
    setPreviewErr("");
    setSelectedOrder(order);

    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl);
      setPdfUrl(null);
    }

    try {
      const { url } = await fetchRemitoPdfSmart(order.id);
      setPdfUrl(url);
    } catch (e) {
      let msg = "";
      if (e?.response?.data instanceof Blob) {
        try {
          msg = await e.response.data.text();
        } catch {
          msg = "";
        }
      }
      const status = e?.response?.status ? ` (HTTP ${e.response.status})` : "";
      setPreviewErr(
        (e?.message || "No se pudo cargar el remito") +
          status +
          (msg ? ` — Detalle: ${msg}` : "")
      );
      setSelectedOrder(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setSelectedOrder(null);
    setPreviewErr("");
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl);
      setPdfUrl(null);
    }
  };

  return (
    <section className="srv-card" aria-labelledby="orders-heading">
      <h3 id="orders-heading">Pedidos (cerrados)</h3>
      {err && <div className="state error">{err}</div>}

      <div className="table like">
        <div className="t-head">
          <div style={{ flex: 1 }}>#</div>
          <div style={{ flex: 2 }}>Empleado</div>
          <div style={{ flex: 2 }}>Rol</div>
          <div style={{ flex: 2 }}>Fecha</div>
          <div style={{ flex: 2, textAlign: "right" }}>Total</div>
          <div style={{ width: 220 }} />
        </div>
        {orders.map((o) => (
          <div key={o.id} className="t-row">
            <div style={{ flex: 1 }}>{String(o.id).padStart(7, "0")}</div>
            <div style={{ flex: 2 }}>{o.empleadoId}</div>
            <div style={{ flex: 2 }}>{o.rol}</div>
            <div style={{ flex: 2 }}>{formatFecha(o.fecha)}</div>
            <div style={{ flex: 2, textAlign: "right" }}>
              {o.total == null ? "—" : money(o.total)}
            </div>
            <div
              style={{
                width: 220,
                display: "flex",
                gap: 6,
                justifyContent: "flex-end",
              }}
            >
              <button
                className="pill"
                onClick={() => onPreviewRemito(o)}
                disabled={previewLoading && selectedOrder?.id === o.id}
              >
                {previewLoading && selectedOrder?.id === o.id
                  ? "Cargando…"
                  : "Ver remito"}
              </button>
            </div>
          </div>
        ))}
        {orders.length === 0 && (
          <div className="t-row">
            <div style={{ flex: 1 }}>—</div>
            <div style={{ flex: 2 }}>Sin pedidos cerrados</div>
            <div style={{ flex: 2 }} />
            <div style={{ flex: 2 }} />
            <div style={{ flex: 2 }} />
            <div style={{ width: 220 }} />
          </div>
        )}
      </div>

      {(selectedOrder || previewErr) && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="section-header">
            {selectedOrder ? (
              <div className="muted">
                Remito del pedido{" "}
                <strong>
                  #{selectedOrder && String(selectedOrder.id).padStart(7, "0")}
                </strong>{" "}
                — Empleado{" "}
                <strong>{selectedOrder && selectedOrder.empleadoId}</strong> — Rol{" "}
                <strong>{selectedOrder && selectedOrder.rol}</strong>
              </div>
            ) : (
              <div className="muted">Detalle de remito</div>
            )}

            <div className="actions-row">
              {pdfUrl && (
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn ghost"
                >
                  Abrir en otra pestaña
                </a>
              )}
              <button className="btn ghost" onClick={closePreview}>
                Cerrar detalle
              </button>
            </div>
          </div>

          {previewErr && (
            <div className="state error" style={{ marginBottom: 8 }}>
              {previewErr}
            </div>
          )}

          {pdfUrl && !previewErr && (
            <div
              style={{
                borderRadius: 8,
                overflow: "hidden",
                border: "1px solid #d1d5db",
                height: 540,
                background: "#0f172a",
              }}
            >
              <iframe
                title={
                  selectedOrder
                    ? `Remito del pedido #${selectedOrder.id}`
                    : "Remito"
                }
                src={pdfUrl}
                style={{ width: "100%", height: "100%", border: "none" }}
              />
            </div>
          )}

          {!pdfUrl && !previewErr && previewLoading && (
            <div className="state">Cargando remito…</div>
          )}
        </div>
      )}
    </section>
  );
}

/* ===========================================================
 * Componente principal con tabs
 * ========================================================= */
export default function AdminPanel() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const roles = useMemo(
    () => (user?.roles || []).map((r) => String(r).toLowerCase()),
    [user]
  );
  const isAdmin = roles.includes("admin");

  const initialTab = (() => {
    const t = searchParams.get("tab");
    return t || "products";
  })();
  const [tab, setTab] = useState(initialTab);

  // Guard: solo admins
  useEffect(() => {
    if (loading) return;
    if (!user || !isAdmin) nav("/app");
  }, [user, loading, isAdmin, nav]);

  // Sincronizar ?tab= con estado
  useEffect(() => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("tab", tab);
      return p;
    });
  }, [tab, setSearchParams]);

  if (loading) return <div className="state">Cargando…</div>;
  if (!isAdmin) return null;

  return (
    <div className="admin-panel">
      <header className="page-header">
        <h2>Panel de administración</h2>
      </header>

      <div
        className="tabs"
        role="tablist"
        aria-label="Secciones de administración"
      >
        <button
          className={`tab-btn ${tab === "products" ? "is-active" : ""}`}
          onClick={() => setTab("products")}
          role="tab"
          aria-selected={tab === "products"}
        >
          Productos
        </button>

        <button
          className={`tab-btn ${tab === "services" ? "is-active" : ""}`}
          onClick={() => setTab("services")}
          role="tab"
          aria-selected={tab === "services"}
        >
          Asignar servicios
        </button>

        <button
          className={`tab-btn ${tab === "serviceProducts" ? "is-active" : ""}`}
          onClick={() => setTab("serviceProducts")}
          role="tab"
          aria-selected={tab === "serviceProducts"}
        >
          Servicio ↔ Productos
        </button>

      
        <button
          className={`tab-btn ${tab === "incomingStock" ? "is-active" : ""}`}
          onClick={() => setTab("incomingStock")}
          role="tab"
          aria-selected={tab === "incomingStock"}
        >
          Ingresos programados
        </button>

        <button
          className={`tab-btn ${tab === "massReassign" ? "is-active" : ""}`}
          onClick={() => setTab("massReassign")}
          role="tab"
          aria-selected={tab === "massReassign"}
        >
          Reasignación masiva
        </button>

        <button
          className={`tab-btn ${tab === "orders" ? "is-active" : ""}`}
          onClick={() => setTab("orders")}
          role="tab"
          aria-selected={tab === "orders"}
        >
          Pedidos
        </button>

        <div style={{ flex: 1 }} />
      </div>

      {tab === "products" && <ProductsSection />}
      {tab === "services" && <AssignServicesSection />}
      {tab === "serviceProducts" && <ServiceProductsSection />}
      {tab === "budgets" && <ServiceBudgetsSection />}
      {tab === "incomingStock" && <IncomingStockSection />}
      {tab === "massReassign" && <MassReassignServicesSection />}
      {tab === "orders" && <OrdersSection />}
    </div>
  );
}
