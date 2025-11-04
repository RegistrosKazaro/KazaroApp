// client/src/pages/AdminPanel.jsx
import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import "../styles/admin-panel.css";
import "../styles/a11y.css";

import MassReassignServicesSection from "./MassReassignServicesSection";

/* =======================  PRODUCTS  ======================= */
function ProductsSection() {
  const [schema, setSchema] = useState(null);
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ name: "", price: "", stock: "", code: "", catId: "" });
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  // categorías para el selector
  const [cats, setCats] = useState([]);
  const [catsErr, setCatsErr] = useState("");

  const [stockEdit, setStockEdit] = useState({ id: null, value: "" });

  const nameRef = useRef(null);
  const headingRef = useRef(null);

  const can = (k) => !!(schema?.cols?.[k]);

  const loadSchema = useCallback(async () => {
    try {
      setSchema((await api.get("/admin/products/_schema")).data);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    }
  }, []);

  const loadRows = useCallback(async () => {
    try {
      setRows((await api.get("/admin/products", { params: { q, limit: 200 } })).data || []);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    }
  }, [q]);

  useEffect(() => { loadSchema(); }, [loadSchema]);
  useEffect(() => { loadRows(); }, [loadRows]);

  // cargar categorías una sola vez
  useEffect(() => {
    api.get("/catalog/categories")
      .then(({ data }) => setCats(Array.isArray(data) ? data : []))
      .catch((e) => setCatsErr(e?.response?.data?.error || "No se pudieron cargar las categorías"));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      const payload = {
        name: form.name,
        ...(can("prodPrice") ? { price: form.price === "" ? null : Number(form.price) } : {}),
        ...(can("prodStock") ? { stock: form.stock === "" ? null : Number(form.stock) } : {}),
        ...(can("prodCode")  ? { code:  form.code  } : {}),
        ...(can("prodCat")   ? { catId: form.catId || null } : {}),
      };

      if (editing) {
        await api.put(`/admin/products/${editing}`, payload);
        setStatusMsg("Producto actualizado.");
      } else {
        await api.post("/admin/products", payload);
        setStatusMsg("Producto creado.");
      }

      setForm({ name: "", price: "", stock: "", code: "", catId: "" });
      setEditing(null);
      await loadRows();
      headingRef.current?.focus();
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    }
  };

  const onEdit = (row) => {
    setEditing(row.id);
    setForm({
      name: row.name ?? "",
      price: row.price ?? "",
      stock: row.stock ?? "",
      code: row.code ?? "",
      catId: row.catId ?? "",
    });
    setTimeout(() => nameRef.current?.focus(), 0);
  };

  const onDelete = async (id) => {
    if (!confirm("¿Eliminar producto?")) return;
    try {
      await api.delete(`/admin/products/${id}`);
      await loadRows();
      setStatusMsg("Producto eliminado.");
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    }
  };

  const cancelStockEdit = () => setStockEdit({ id: null, value: "" });

  const saveStock = async () => {
    try {
      await api.put(`/admin/products/${stockEdit.id}`, { stock: Number(stockEdit.value) });
      await loadRows();
      setStatusMsg("Stock actualizado.");
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally {
      cancelStockEdit();
    }
  };

  const onKeyDownStock = (e) => {
    if (e.key === "Enter") { e.preventDefault(); saveStock(); }
    if (e.key === "Escape") { e.preventDefault(); cancelStockEdit(); }
  };

  const onSearchKeyDown = (e) => { if (e.key === "Enter") { e.preventDefault(); loadRows(); } };

  return (
    <section className="card" aria-labelledby="products-heading">
      <h2 id="products-heading" ref={headingRef} tabIndex={-1}>Productos</h2>
      <p className="sr-only" aria-live="polite">{statusMsg}</p>
      {err && <div role="alert" className="alert error">{err}</div>}

      <div className="toolbar" role="region" aria-label="Búsqueda de productos">
        <label htmlFor="prod-search" className="sr-only">Buscar productos</label>
        <input
          id="prod-search"
          className="input"
          placeholder="Buscar…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onSearchKeyDown}
        />
      </div>

      <form onSubmit={submit} className="form-grid" aria-describedby="prod-form-help">
        <fieldset>
          <legend>{editing ? "Editar producto" : "Crear producto"}</legend>
          <p id="prod-form-help" className="sr-only">Los campos marcados con * son obligatorios.</p>

          <div className="field">
            <label htmlFor="prod-name">Nombre *</label>
            <input
              id="prod-name"
              ref={nameRef}
              className="input"
              placeholder="Nombre *"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              aria-required="true"
            />
          </div>

          {can("prodPrice") && (
            <div className="field">
              <label htmlFor="prod-price">Precio</label>
              <input
                id="prod-price"
                className="input"
                type="number"
                step="0.01"
                inputMode="decimal"
                placeholder="Precio"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </div>
          )}

          {can("prodStock") && (
            <div className="field">
              <label htmlFor="prod-stock">Stock</label>
              <input
                id="prod-stock"
                className="input"
                type="number"
                inputMode="numeric"
                placeholder="Stock"
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
              />
            </div>
          )}

          {can("prodCat") && (
            <div className="field">
              <label htmlFor="prod-cat">Categoría</label>
              <select
                id="prod-cat"
                className="input"
                value={form.catId}
                onChange={(e) => setForm({ ...form, catId: e.target.value })}
              >
                <option value="">-- Sin categoría --</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {catsErr && <div className="hint error" role="alert">{catsErr}</div>}
            </div>
          )}

          {can("prodCode") && (
            <div className="field">
              <label htmlFor="prod-code">Código</label>
              <input
                id="prod-code"
                className="input"
                placeholder="Código"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </div>
          )}

          <div className="buttons">
            <button className="btn primary" type="submit">
              {editing ? "Guardar cambios" : "Crear producto"}
            </button>
            {editing && (
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setEditing(null);
                  setForm({ name: "", price: "", stock: "", code: "", catId: "" });
                }}
              >
                Cancelar
              </button>
            )}
          </div>
        </fieldset>
      </form>

      <div className="table table-products" role="table" aria-label="Listado de productos">
        <div className="thead" role="rowgroup">
          <div className="tr" role="row">
            <div role="columnheader">ID</div>
            <div role="columnheader">Nombre</div>
            <div role="columnheader">Código</div>
            <div role="columnheader" className="num">Precio</div>
            <div role="columnheader" className="num">Stock</div>
            <div role="columnheader">Acciones</div>
          </div>
        </div>
        <div className="tbody" role="rowgroup">
          {rows.map(r => (
            <div key={r.id} className="tr" role="row">
              <div role="cell">{r.id}</div>
              <div role="cell" className="truncate-2">{r.name}</div>
              <div role="cell">{r.code ?? "-"}</div>
              <div role="cell" className="num">
                {r.price == null
                  ? "-"
                  : new Intl.NumberFormat("es-AR", {
                      style: "currency",
                      currency: "ARS",
                    }).format(r.price)}
              </div>
              <div role="cell">
                {stockEdit.id === r.id ? (
                  <div className="stock-inline">
                    <label htmlFor={`stk-${r.id}`} className="sr-only">
                      Stock para {r.name}
                    </label>
                    <input
                      id={`stk-${r.id}`}
                      className="input stock-input"
                      type="number"
                      value={stockEdit.value}
                      onChange={(e) =>
                        setStockEdit((s) => ({ ...s, value: e.target.value }))
                      }
                      onKeyDown={onKeyDownStock}
                      autoFocus
                    />
                    <button
                      className="btn primary xs"
                      type="button"
                      onClick={saveStock}
                      aria-label={`Guardar stock de ${r.name}`}
                    >
                      Guardar
                    </button>
                    <button
                      className="btn xs"
                      type="button"
                      onClick={cancelStockEdit}
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="stock-inline">
                    <span className="stock-value">{r.stock ?? "-"}</span>
                    <button
                      className="btn xs"
                      type="button"
                      onClick={() =>
                        setStockEdit({ id: r.id, value: r.stock ?? 0 })
                      }
                      aria-label={`Editar stock de ${r.name}`}
                    >
                      Editar stock
                    </button>
                  </div>
                )}
              </div>
              <div className="actions" role="cell">
                <button
                  className="btn small tonal"
                  onClick={() => onEdit(r)}
                  type="button"
                  aria-label={`Editar ${r.name}`}
                >
                  Editar
                </button>
                <button
                  className="btn small danger"
                  onClick={() => onDelete(r.id)}
                  type="button"
                  aria-label={`Eliminar ${r.name}`}
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="tr" role="row">
              <div role="cell" style={{ gridColumn: "1 / -1" }}>
                Sin productos
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* =======================  ASSIGN / REASSIGN SERVICES (unitario) ======================= */
function AssignServicesSection() {
  const [supervisors, setSupervisors] = useState([]);
  const [selectedSupervisor, setSelectedSupervisor] = useState("");
  const [assignments, setAssignments] = useState([]);

  const [q, setQ] = useState("");
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const loadSupervisors = useCallback(async () => {
    try {
      setSupervisors((await api.get("/admin/supervisors")).data || []);
    } catch (e) {
      setMsg(e?.response?.data?.error || "Error al listar supervisores");
    }
  }, []);

  const loadAssignments = useCallback(async (EmpleadoID) => {
    setMsg("");
    if (!EmpleadoID) {
      setAssignments([]);
      return;
    }
    try {
      setAssignments(
        (await api.get("/admin/assignments", { params: { EmpleadoID } }))
          .data || []
      );
    } catch (e) {
      setMsg(e?.response?.data?.error || "Error al listar asignaciones");
    }
  }, []);

  useEffect(() => { loadSupervisors(); }, [loadSupervisors]);
  useEffect(() => { loadAssignments(selectedSupervisor); }, [selectedSupervisor, loadAssignments]);

  const isAssigned = (srvId) =>
    assignments.some((a) => String(a.ServicioID) === String(srvId));
  const pivotIdOf = (srvId) =>
    assignments.find((a) => String(a.ServicioID) === String(srvId))?.id ?? null;

  const searchServices = async () => {
    setMsg("");
    if (q.trim().length < 2) {
      setServices([]);
      setMsg("Escribí al menos 2 letras para buscar.");
      return;
    }
    setLoading(true);
    try {
      const res = await api.get("/admin/services", { params: { q, limit: 25 } });
      setServices(res.data || []);
      if ((res.data || []).length === 0) setMsg("No se encontraron servicios.");
    } catch (e) {
      setMsg(e?.response?.data?.error || "Error buscando servicios");
    } finally {
      setLoading(false);
    }
  };

  const onKeyDownSearch = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      searchServices();
    }
  };

  const toggle = async (srvId) => {
    if (!selectedSupervisor) return;
    setMsg("");
    try {
      if (isAssigned(srvId)) {
        const pid = pivotIdOf(srvId);
        if (pid) {
          await api.delete(`/admin/assignments/${pid}`);
        } else {
          await api.delete(`/admin/assignments/by-key`, {
            params: { EmpleadoID: selectedSupervisor, ServicioID: srvId },
          });
        }
      } else {
        await api.post("/admin/assignments", {
          EmpleadoID: String(selectedSupervisor),
          ServicioID: String(srvId),
        });
      }
      await loadAssignments(selectedSupervisor);
    } catch (e) {
      setMsg(e?.response?.data?.error || "No se pudo actualizar la asignación");
    }
  };

  return (
    <section className="card">
      <h2>Asignar / Reasignar servicios</h2>
      {msg && <div className="alert error">{msg}</div>}

      <div className="assign-toolbar">
        <select
          className="input"
          value={selectedSupervisor}
          onChange={(e) => {
            setSelectedSupervisor(e.target.value);
            setMsg("");
          }}
        >
          <option value="">-- Elegir supervisor --</option>
          {supervisors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.username || `Supervisor #${s.id}`}
            </option>
          ))}
        </select>

        <input
          className="input"
          placeholder="Buscar servicio… (mín. 2 letras)"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setMsg("");
          }}
          onKeyDown={onKeyDownSearch}
        />
        <button className="btn primary" onClick={searchServices} disabled={loading}>
          {loading ? "Buscando…" : "Buscar"}
        </button>
      </div>

      {!selectedSupervisor ? (
        <div className="hint">Elegí un supervisor y buscá un servicio.</div>
      ) : (
        <>
          <div className="assign-list">
            {services.map((s) => (
              <label
                key={s.id}
                className={`assign-item ${isAssigned(s.id) ? "assigned" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={isAssigned(s.id)}
                  onChange={() => toggle(s.id)}
                />
                <div className="assign-content">
                  <div className="assign-title">{s.name}</div>
                  <div className="assign-badges">
                    {isAssigned(s.id) ? (
                      <span className="badge">Asignado</span>
                    ) : (
                      <span className="badge">Disponible</span>
                    )}
                  </div>
                </div>
              </label>
            ))}
          </div>

          <div className="hint small" style={{ marginTop: 12 }}>
            <strong>Asignados:</strong>{" "}
            {assignments.length
              ? assignments.map((a) => a.service_name).join(", ")
              : "ninguno"}
          </div>
        </>
      )}
    </section>
  );
}

/* =======================  SERVICE ↔ PRODUCTS  ======================= */
function ServiceProductsSection() {
  const PAGE_SIZE = 12;
  const [step, setStep] = useState("pick");
  const [service, setService] = useState(null);
  const [qSrv, setQSrv] = useState("");
  const [srvResults, setSrvResults] = useState([]);
  const [srvMsg, setSrvMsg] = useState("");
  const [srvLoading, setSrvLoading] = useState(false);
  const debounceRef = useRef(null);
  const lastQueryRef = useRef("");

  const [cats, setCats] = useState([]);
  const [catId, setCatId] = useState("__all__");
  const [q, setQ] = useState("");
  const [allRows, setAllRows] = useState([]);
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Set());

  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [saveOk, setSaveOk] = useState("");
  const [saving, setSaving] = useState(false);

  // búsqueda de servicios (paso "pick")
  useEffect(() => {
    if (step !== "pick") return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const term = qSrv.trim();
      if (term === lastQueryRef.current) return;
      lastQueryRef.current = term;
      if (!term) {
        setSrvResults([]);
        setSrvMsg("");
        return;
      }
      try {
        setSrvLoading(true);
        const { data } = await api.get("/admin/services", {
          params: { q: term, limit: 25 },
        });
        setSrvResults(data || []);
        setSrvMsg((data || []).length ? "" : "No se encontraron servicios.");
      } catch (e) {
        setSrvMsg(e?.response?.data?.error || "Error buscando servicios");
      } finally {
        setSrvLoading(false);
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [qSrv, step]);

  // al entrar a "assign" y elegir servicio
  useEffect(() => {
    if (step !== "assign" || !service) return;
    setPage(1);
    setSaveOk("");
    setSaveErr("");
    setLoadErr("");
    api
      .get("/catalog/categories")
      .then(({ data }) => setCats(Array.isArray(data) ? data : []))
      .catch(() => setCats([]));
    api
      .get(`/admin/sp/assignments/${service.id}`)
      .then(({ data }) =>
        setSelected(new Set((data?.productIds || []).map(String)))
      )
      .catch(() => setSelected(new Set()));
  }, [step, service]);

  const loadProducts = useCallback(async () => {
    if (step !== "assign" || !service) return;
    setLoadErr("");
    setLoading(true);
    try {
      const { data } = await api.get("/catalog/products", {
        params: { catId: catId || "__all__", q: q || "" },
      });
      setAllRows(Array.isArray(data) ? data : []);
      setPage(1);
    } catch (e) {
      setAllRows([]);
      setLoadErr(
        e?.response?.data?.error || "No se pudieron cargar los productos"
      );
    } finally {
      setLoading(false);
    }
  }, [step, service, catId, q]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  useEffect(() => {
    const start = (page - 1) * PAGE_SIZE;
    setRows(allRows.slice(start, start + PAGE_SIZE));
  }, [allRows, page]);

  useEffect(() => { setPage(1); }, [catId, q]);

  const toggle = (id, checked) => {
    const next = new Set(selected);
    if (checked) next.add(String(id));
    else next.delete(String(id));
    setSelected(next);
    setSaveOk("");
    setSaveErr("");
  };

  const saveAll = async () => {
    if (!service) return;
    setSaving(true);
    setSaveErr("");
    setSaveOk("");
    const before = new Set(selected);
    try {
      const res = await api.put(`/admin/sp/assignments/${service.id}`, {
        productIds: Array.from(selected),
      });
      const { data } = await api.get(`/admin/sp/assignments/${service.id}`);
      const afterIds = (data?.productIds || []).map(String);
      const afterSet = new Set(afterIds);
      let added = 0,
        removed = 0;
      for (const id of afterSet) if (!before.has(id)) added++;
      for (const id of before) if (!afterSet.has(id)) removed++;
      setSelected(new Set(afterSet));
      const stamp = new Date().toLocaleTimeString();
      const baseMsg = res?.data?.message || "Asignaciones guardadas";
      setSaveOk(
        `${baseMsg} ✓ — asignados: ${afterIds.length} ( +${added} / -${removed} ) — ${stamp}`
      );
    } catch (e) {
      setSaveErr(e?.response?.data?.error || e.message || "No se pudieron guardar");
    } finally {
      setSaving(false);
    }
  };

  const PAGE_TOTAL = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
  const canNext = page < PAGE_TOTAL;
  const prevPage = () => setPage((p) => Math.max(1, p - 1));
  const nextPage = () => {
    if (canNext) setPage((p) => p + 1);
  };

  return (
    <section className="card">
      <h2>Servicio ↔ Productos</h2>

      {step === "pick" && (
        <>
          <div className="toolbar">
            <input
              className="input"
              placeholder="Buscar servicio…"
              value={qSrv}
              onChange={(e) => setQSrv(e.target.value)}
            />
            <button
              className="btn primary"
              onClick={() => setQSrv(qSrv)}
              disabled={srvLoading}
            >
              {srvLoading ? "Buscando…" : "Buscar"}
            </button>
          </div>
          {srvMsg && <div className="alert error">{srvMsg}</div>}
          <div className="assign-list">
            {srvResults.map((s) => (
              <label key={s.id} className="assign-item">
                <input
                  type="radio"
                  name="srv-pick"
                  onChange={() => {
                    setService(s);
                    setStep("assign");
                  }}
                />
                <div className="assign-content">
                  <div className="assign-title">{s.name}</div>
                </div>
              </label>
            ))}
            {!srvResults.length && !srvMsg && (
              <div className="hint">Empezá a escribir para ver resultados.</div>
            )}
          </div>
        </>
      )}

      {step === "assign" && (
        <>
          <div className="toolbar">
            <button
              className="btn"
              onClick={() => {
                setStep("pick");
                setService(null);
                setAllRows([]);
                setRows([]);
                setSelected(new Set());
              }}
            >
              ← Cambiar servicio
            </button>
            <div className="sp-service-pill">
              Servicio: <strong>{service?.name}</strong>
            </div>
            <div style={{ flex: 1 }} />
            <button className="btn primary" onClick={saveAll} disabled={saving}>
              {saving ? "Guardando…" : saveOk ? "Guardado ✓" : "Guardar cambios"}
            </button>
          </div>

          <div className="toolbar">
            <select
              className="input"
              value={catId}
              onChange={(e) => setCatId(e.target.value)}
            >
              <option value="__all__">Todas las categorías</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              className="input"
              placeholder="Buscar producto…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          {loadErr && (
            <div className="alert error">
              {loadErr}{" "}
              <button
                className="btn xs"
                type="button"
                onClick={loadProducts}
              >
                Reintentar
              </button>
            </div>
          )}
          {saveErr && <div className="alert error">{saveErr}</div>}
          {saveOk && <div className="alert">{saveOk}</div>}

          <div className="assign-list">
            {rows.map((r) => {
              const on = selected.has(String(r.id));
              return (
                <label
                  key={r.id}
                  className={`assign-item ${on ? "assigned" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => toggle(r.id, e.target.checked)}
                  />
                  <div className="assign-content">
                    <div className="assign-title">{r.name}</div>
                    <div className="assign-badges">
                      <span className="badge">{r.code || "s/código"}</span>
                      {typeof r.price === "number" && (
                        <span className="badge">${r.price}</span>
                      )}
                      {typeof r.stock === "number" && (
                        <span className="badge">stock {r.stock}</span>
                      )}
                    </div>
                  </div>
                </label>
              );
            })}
            {!rows.length && !loadErr && (
              <div className="hint">
                {loading ? "Cargando…" : "No hay productos para mostrar."}
              </div>
            )}
          </div>

          <div className="toolbar" style={{ justifyContent: "space-between" }}>
            <div className="hint">
              Página {page} / {PAGE_TOTAL}
            </div>
            <div>
              <button className="btn" onClick={prevPage} disabled={page <= 1}>
                Anterior
              </button>
              <button
                className="btn"
                onClick={nextPage}
                disabled={!canNext}
                style={{ marginLeft: 8 }}
              >
                Siguiente
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/* =======================  SERVICE BUDGETS  ======================= */
/** NO resetea de página al guardar y persiste la página en URL y sessionStorage */
function ServiceBudgetsSection() {
  const PAGE_SIZE = 15;
  const PAGE_KEY = "admin:budgets:page";

  const [searchParams, setSearchParams] = useSearchParams();

  const initPage = (() => {
    const fromUrl = Number(searchParams.get("bPage"));
    if (Number.isFinite(fromUrl) && fromUrl > 0) return fromUrl;
    const fromSS = Number(sessionStorage.getItem(PAGE_KEY));
    return Number.isFinite(fromSS) && fromSS > 0 ? fromSS : 1;
  })();

  const [rows, setRows] = useState([]); // [{id, name, budget}]
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [page, setPage] = useState(initPage);
  const [drafts, setDrafts] = useState({}); // id -> texto del input
  const [savingIds, setSavingIds] = useState(new Set());

  useEffect(() => {
    sessionStorage.setItem(PAGE_KEY, String(page));
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("bPage", String(page));
        return p;
      },
      { replace: true }
    );
  }, [page, setSearchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const data = await api
        .get("/admin/service-budgets")
        .then((r) => r.data || []);
      setRows(data);
    } catch (e) {
      setErr(
        e?.response?.data?.error || e.message || "Error al cargar presupuestos"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil((rows.length || 0) / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const current = rows.slice(start, start + PAGE_SIZE);

  const updateDraft = (id, val) =>
    setDrafts((d) => ({
      ...d,
      [id]: val,
    }));

  const saveOne = async (row, ev) => {
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }

    const raw = String(drafts[row.id] ?? row.budget ?? "").trim();
    const normalized = raw.replace(/\./g, "").replace(/,/g, ".");
    const parsed = Number(normalized);
    const presupuesto = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;

    setSavingIds((prev) => new Set(prev).add(row.id));
    try {
      await api.put(`/admin/service-budgets/${row.id}`, { presupuesto });

      setRows((prev) =>
        prev.map((it) =>
          it.id === row.id ? { ...it, budget: presupuesto } : it
        )
      );
      setDrafts((d) => {
        const n = { ...d };
        delete n[row.id];
        return n;
      });

      const totalPagesAfter = Math.max(
        1,
        Math.ceil((rows.length || 0) / PAGE_SIZE)
      );
      setPage((p) => Math.min(Math.max(1, p), totalPagesAfter));
    } catch (e) {
      alert(e?.response?.data?.error || e.message || "No se pudo guardar");
    } finally {
      setSavingIds((prev) => {
        const n = new Set(prev);
        n.delete(row.id);
        return n;
      });
    }
  };

  const prevPage = () => setPage((p) => Math.max(1, p - 1));
  const nextPage = () => setPage((p) => Math.min(totalPages, p + 1));

  return (
    <section className="card">
      <h2>Presupuestos por servicio</h2>
      {err && <div className="alert error">{err}</div>}

      {loading ? (
        <div className="state">Cargando…</div>
      ) : (
        <>
          <div className="budget-list">
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
                    onChange={(e) => updateDraft(row.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.stopPropagation();
                        saveOne(row);
                      }
                    }}
                    aria-label={`Presupuesto para ${row.name}`}
                  />
                  <button
                    className="btn primary"
                    onClick={(e) => saveOne(row, e)}
                    disabled={saving}
                    type="button"
                  >
                    {saving ? "Guardando…" : "Guardar"}
                  </button>
                </div>
              );
            })}
            {!current.length && (
              <div className="hint">No hay servicios para mostrar.</div>
            )}
          </div>

          <div className="toolbar" style={{ justifyContent: "space-between" }}>
            <div className="hint">
              Mostrando {start + 1}–{Math.min(start + PAGE_SIZE, rows.length)}{" "}
              de {rows.length} servicios
            </div>
            <div>
              <button
                className="btn"
                onClick={() => setPage(1)}
                disabled={safePage === 1}
              >
                «
              </button>
              <button
                className="btn"
                onClick={prevPage}
                disabled={safePage === 1}
                style={{ marginLeft: 8 }}
              >
                ‹
              </button>
              <span style={{ margin: "0 12px" }}>
                Página <strong>{safePage}</strong> de{" "}
                <strong>{totalPages}</strong>
              </span>
              <button
                className="btn"
                onClick={nextPage}
                disabled={safePage === totalPages}
              >
                ›
              </button>
              <button
                className="btn"
                onClick={() => setPage(totalPages)}
                disabled={safePage === totalPages}
                style={{ marginLeft: 8 }}
              >
                »
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/* =======================  INCOMING STOCK (Ingresos programados)  ======================= */
function IncomingStockSection() {
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchMsg, setSearchMsg] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);

  const [product, setProduct] = useState(null);

  const [rows, setRows] = useState([]); // [{id, product_id, qty, eta}]
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [form, setForm] = useState({
    qty: "",
    eta: "",
  });
  const [saving, setSaving] = useState(false);

  const loadIncoming = useCallback(async (productId) => {
    if (!productId) {
      setRows([]);
      return;
    }
    setErr("");
    setLoading(true);
    try {
      const { data } = await api.get("/admin/incoming-stock", {
        params: { productId },
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudieron cargar los ingresos");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const searchProducts = async () => {
    setSearchMsg("");
    setSearchResults([]);
    if (search.trim().length < 2) {
      setSearchMsg("Escribí al menos 2 letras para buscar productos.");
      return;
    }
    setSearchLoading(true);
    try {
      const res = await api.get("/admin/products", {
        params: { q: search.trim(), limit: 50 },
      });
      const list = res.data || [];
      setSearchResults(list);
      if (!list.length) setSearchMsg("No se encontraron productos.");
    } catch (e) {
      setSearchMsg(e?.response?.data?.error || "Error buscando productos");
    } finally {
      setSearchLoading(false);
    }
  };

  const onSelectProduct = async (p) => {
    setProduct(p);
    setForm({ qty: "", eta: "" });
    await loadIncoming(p.id);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!product) {
      setErr("Elegí un producto primero.");
      return;
    }
    const qtyNum = Number(form.qty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setErr("Cantidad inválida.");
      return;
    }
    if (!form.eta) {
      setErr("Fecha estimada requerida.");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      await api.post("/admin/incoming-stock", {
        productId: product.id,
        qty: qtyNum,
        eta: form.eta,
      });
      setForm({ qty: "", eta: "" });
      await loadIncoming(product.id);
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudo guardar el ingreso");
    } finally {
      setSaving(false);
    }
  };

  const removeRow = async (id) => {
    if (!confirm("¿Eliminar este ingreso programado?")) return;
    try {
      await api.delete(`/admin/incoming/${id}`);
      if (product) await loadIncoming(product.id);
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudo eliminar");
    }
  };

  const confirmRow = async (id) => {
    if (!confirm("¿Confirmar este ingreso y sumarlo al stock actual?")) return;
    try {
      await api.post(`/admin/incoming/${id}/confirm`);
      if (product) await loadIncoming(product.id);
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudo confirmar el ingreso");
    }
  };

  const onSearchKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      searchProducts();
    }
  };

  return (
    <section className="card">
      <h2>Ingresos programados (stock futuro)</h2>

      {/* Búsqueda de producto */}
      <div className="toolbar" aria-label="Búsqueda de producto">
        <input
          className="input"
          placeholder="Buscar producto… (mín. 2 letras)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={onSearchKeyDown}
        />
        <button
          className="btn primary"
          type="button"
          onClick={searchProducts}
          disabled={searchLoading}
        >
          {searchLoading ? "Buscando…" : "Buscar"}
        </button>
      </div>
      {searchMsg && <div className="hint">{searchMsg}</div>}

      {searchResults.length > 0 && (
        <div className="assign-list" style={{ marginBottom: 16 }}>
          {searchResults.map((p) => (
            <button
              key={p.id}
              type="button"
              className={
                "assign-item as-button " +
                (product && String(product.id) === String(p.id)
                  ? "assigned"
                  : "")
              }
              onClick={() => onSelectProduct(p)}
            >
              <div className="assign-content">
                <div className="assign-title">
                  #{p.id} – {p.name}
                </div>
                <div className="assign-badges">
                  {p.code && <span className="badge">{p.code}</span>}
                  {typeof p.price === "number" && (
                    <span className="badge">
                      {new Intl.NumberFormat("es-AR", {
                        style: "currency",
                        currency: "ARS",
                      }).format(p.price)}
                    </span>
                  )}
                  {typeof p.stock === "number" && (
                    <span className="badge">stock {p.stock}</span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {product && (
        <>
          <div className="hint" style={{ marginBottom: 12 }}>
            Producto seleccionado: <strong>#{product.id} – {product.name}</strong>
          </div>

          {err && <div className="alert error">{err}</div>}

          {/* Form de alta de ingreso programado */}
          <form onSubmit={submit} className="form-grid">
            <fieldset>
              <legend>Nuevo ingreso programado</legend>
              <div className="field">
                <label htmlFor="inc-qty">Cantidad *</label>
                <input
                  id="inc-qty"
                  className="input"
                  type="number"
                  inputMode="numeric"
                  value={form.qty}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, qty: e.target.value }))
                  }
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="inc-eta">Fecha estimada *</label>
                <input
                  id="inc-eta"
                  className="input"
                  type="date"
                  value={form.eta}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, eta: e.target.value }))
                  }
                  required
                />
              </div>
              <div className="buttons">
                <button className="btn primary" type="submit" disabled={saving}>
                  {saving ? "Guardando…" : "Agregar ingreso"}
                </button>
              </div>
            </fieldset>
          </form>

          {/* Listado de ingresos existentes */}
          <div className="table" style={{ marginTop: 16 }}>
            <div className="thead">
              <div>ID</div>
              <div>Cantidad</div>
              <div>Fecha estimada</div>
              <div>Acciones</div>
            </div>
            <div className="tbody">
              {loading ? (
                <div className="tr">
                  <div style={{ gridColumn: "1 / -1" }}>Cargando…</div>
                </div>
              ) : rows.length === 0 ? (
                <div className="tr">
                  <div style={{ gridColumn: "1 / -1" }}>
                    No hay ingresos programados para este producto.
                  </div>
                </div>
              ) : (
                rows.map((r) => (
                  <div key={r.id} className="tr">
                    <div>{r.id}</div>
                    <div>{r.qty}</div>
                    <div>{r.eta?.slice(0, 10) || r.eta}</div>
                    <div className="actions">
                      <button
                        className="btn small primary"
                        type="button"
                        onClick={() => confirmRow(r.id)}
                      >
                        Confirmar
                      </button>
                      <button
                        className="btn danger small"
                        type="button"
                        onClick={() => removeRow(r.id)}
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/* =======================  ORDERS  ======================= */
function OrdersSection() {
  const [orders, setOrders] = useState([]);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      setOrders((await api.get("/admin/orders")).data || []);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onDeleteOrder = async (id) => {
    if (!confirm(`¿Eliminar pedido #${id}?`)) return;
    try {
      await api.delete(`/admin/orders/${id}`);
      await load();
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    }
  };

  const onUpdateOrderTotal = async (id) => {
    const val = prompt("Nuevo total:", "");
    if (val == null) return;
    try {
      await api.put(`/admin/orders/${id}/price`, { newPrice: Number(val) });
      await load();
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    }
  };

  return (
    <section className="card">
      <h2>Pedidos</h2>
      {err && <div className="alert error">{err}</div>}
      <div className="table">
        <div className="thead">
          <div>ID</div>
          <div>Empleado</div>
          <div>Rol</div>
          <div>Total</div>
          <div>Fecha</div>
          <div>Acciones</div>
        </div>
        <div className="tbody">
          {orders.map((o) => (
            <div key={o.id} className="tr">
              <div>{o.id}</div>
              <div>{o.empleadoId}</div>
              <div>{o.rol}</div>
              <div>${o.total}</div>
              <div>{o.fecha?.slice(0, 19)?.replace("T", " ")}</div>
              <div className="actions">
                <button
                  className="btn tonal"
                  onClick={() => onUpdateOrderTotal(o.id)}
                >
                  Modificar total
                </button>
                <button
                  className="btn danger"
                  onClick={() => onDeleteOrder(o.id)}
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))}
          {orders.length === 0 && (
            <div className="tr">
              <div style={{ gridColumn: "1 / -1" }}>Sin pedidos</div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* =======================  ADMIN PANEL (PARENT)  ======================= */
export default function AdminPanel() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const [tab, setTab] = useState("products");

  useEffect(() => {
    if (!loading) {
      const isAdmin = (user?.roles || [])
        .map((r) => String(r).toLowerCase())
        .includes("admin");
      if (!user || !isAdmin) nav("/app");
    }
  }, [user, loading, nav]);

  if (loading) return <div className="state">Cargando…</div>;

  return (
    <div className="admin-container">
      <div
        className="admin-topbar"
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
          className={`tab-btn ${
            tab === "serviceProducts" ? "is-active" : ""
          }`}
          onClick={() => setTab("serviceProducts")}
          role="tab"
          aria-selected={tab === "serviceProducts"}
        >
          Servicio ↔ Productos
        </button>
       
        <button
          className={`tab-btn ${
            tab === "incomingStock" ? "is-active" : ""
          }`}
          onClick={() => setTab("incomingStock")}
          role="tab"
          aria-selected={tab === "incomingStock"}
        >
          Ingresos programados
        </button>
        <button
          className={`tab-btn ${
            tab === "massReassign" ? "is-active" : ""
          }`}
          onClick={() => setTab("massReassign")}
          role="tab"
          aria-selected={tab === "massReassign"}
        >
          Reasignación masiva
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
