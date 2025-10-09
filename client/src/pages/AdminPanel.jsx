// client/src/pages/AdminPanel.jsx
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import "../styles/admin-panel.css"; // usa SOLO los estilos del panel

/* =======================  PRODUCTS  ======================= */
function ProductsSection() {
  const [schema, setSchema] = useState(null);
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ name: "", price: "", stock: "", code: "", catId: "" });
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState("");

  // Edición inline de stock
  const [stockEdit, setStockEdit] = useState({ id: null, value: "" });

  const can = (k) => !!(schema?.cols?.[k]);

  const loadSchema = useCallback(async () => {
    try { setSchema((await api.get("/admin/products/_schema")).data); }
    catch (e) { setErr(e?.response?.data?.error || e.message); }
  }, []);

  const loadRows = useCallback(async () => {
    try { setRows((await api.get("/admin/products", { params: { q } })).data || []); }
    catch (e) { setErr(e?.response?.data?.error || e.message); }
  }, [q]);

  useEffect(() => { loadSchema(); }, [loadSchema]);
  useEffect(() => { loadRows(); }, [loadRows]);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      if (editing) {
        await api.put(`/admin/products/${editing}`, {
          name: form.name,
          ...(can("prodPrice") ? { price: form.price === "" ? null : Number(form.price) } : {}),
          ...(can("prodStock") ? { stock: form.stock === "" ? null : Number(form.stock) } : {}),
          ...(can("prodCode")  ? { code:  form.code  } : {}),
          ...(can("prodCat")   ? { catId: form.catId || null } : {}),
        });
      } else {
        await api.post("/admin/products", {
          name: form.name,
          ...(can("prodPrice") ? { price: form.price === "" ? null : Number(form.price) } : {}),
          ...(can("prodStock") ? { stock: form.stock === "" ? null : Number(form.stock) } : {}),
          ...(can("prodCode")  ? { code:  form.code  } : {}),
          ...(can("prodCat")   ? { catId: form.catId || null } : {}),
        });
      }
      setForm({ name: "", price: "", stock: "", code: "", catId: "" });
      setEditing(null);
      await loadRows();
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
  };

  const onDelete = async (id) => {
    if (!confirm("¿Eliminar producto?")) return;
    try { await api.delete(`/admin/products/${id}`); await loadRows(); }
    catch (e) { setErr(e?.response?.data?.error || e.message); }
  };

  // ====== Stock inline ======
  const startStockEdit = (row) => setStockEdit({ id: row.id, value: row.stock ?? 0 });
  const cancelStockEdit = () => setStockEdit({ id: null, value: "" });
  const saveStock = async () => {
    if (!can("prodStock") || stockEdit.id == null) return;
    try {
      await api.put(`/admin/products/${stockEdit.id}`, { stock: Number(stockEdit.value) });
      await loadRows();
      cancelStockEdit();
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    }
  };
  const onKeyDownStock = (e) => {
    if (e.key === "Enter") { e.preventDefault(); saveStock(); }
    if (e.key === "Escape") { e.preventDefault(); cancelStockEdit(); }
  };

  return (
    <section className="card">
      <h2>Productos</h2>

      {err && <div className="alert error">{err}</div>}

      <div className="toolbar">
        <input className="input" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <form onSubmit={submit} className="form-grid">
        <input className="input" placeholder="Nombre *" value={form.name}
               onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        {can("prodPrice") && (
          <input className="input" type="number" step="0.01" placeholder="Precio"
                 value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        )}
        {can("prodStock") && (
          <input className="input" type="number" placeholder="Stock"
                 value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
        )}
        {can("prodCode") && (
          <input className="input" placeholder="Código"
                 value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        )}
        <div className="buttons">
          <button className="btn primary" type="submit">{editing ? "Guardar cambios" : "Crear producto"}</button>
          {editing && (
            <button className="btn" type="button"
                    onClick={() => { setEditing(null); setForm({ name:"", price:"", stock:"", code:"", catId:"" }); }}>
              Cancelar
            </button>
          )}
        </div>
      </form>

      <div className="table table-products">
        <div className="thead">
          <div>ID</div><div>Nombre</div><div>Código</div><div className="num">Precio</div><div className="num">Stock</div><div>Acciones</div>
        </div>
        <div className="tbody">
          {rows.map(r => (
            <div key={r.id} className="tr">
              <div>{r.id}</div>
              <div className="truncate-2">{r.name}</div>
              <div>{r.code ?? "-"}</div>
              <div className="num">{r.price ?? "-"}</div>

              {/* STOCK: edición directa */}
              <div>
                {stockEdit.id === r.id ? (
                  <div className="stock-inline">
                    <input
                      className="input stock-input"
                      type="number"
                      value={stockEdit.value}
                      onChange={(e) => setStockEdit(s => ({ ...s, value: e.target.value }))}
                      onKeyDown={onKeyDownStock}
                      autoFocus
                    />
                    <button className="btn primary xs" type="button" onClick={saveStock}>Guardar</button>
                    <button className="btn xs" type="button" onClick={cancelStockEdit}>Cancelar</button>
                  </div>
                ) : (
                  <div className="stock-inline">
                    <span className="stock-value">{r.stock ?? "-"}</span>
                    {can("prodStock") && (
                      <button className="btn xs" type="button" onClick={() => startStockEdit(r)}>
                        Editar stock
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="actions">
                <button className="btn tonal" onClick={() => onEdit(r)} type="button">Editar</button>
                <button className="btn danger" onClick={() => onDelete(r.id)} type="button">Eliminar</button>
              </div>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="tr">
              <div style={{ gridColumn: "1 / -1" }}>Sin productos</div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* =======================  ASSIGN / REASSIGN SERVICES  ======================= */
function AssignServicesSection() {
  const [supervisors, setSupervisors] = useState([]);
  const [selectedSupervisor, setSelectedSupervisor] = useState("");
  const [assignments, setAssignments] = useState([]);

  const [q, setQ] = useState("");
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const loadSupervisors = useCallback(async () => {
    try { setSupervisors((await api.get("/admin/supervisors")).data || []); }
    catch (e) { setMsg(e?.response?.data?.error || "Error al listar supervisores"); }
  }, []);

  const loadAssignments = useCallback(async (EmpleadoID) => {
    setMsg("");
    if (!EmpleadoID) { setAssignments([]); return; }
    try { setAssignments((await api.get("/admin/assignments", { params: { EmpleadoID } })).data || []); }
    catch (e) { setMsg(e?.response?.data?.error || "Error al listar asignaciones"); }
  }, []);

  useEffect(() => { loadSupervisors(); }, [loadSupervisors]);
  useEffect(() => { loadAssignments(selectedSupervisor); }, [selectedSupervisor, loadAssignments]);

  const isAssigned = (srvId) => assignments.some(a => String(a.ServicioID) === String(srvId));
  const pivotIdOf  = (srvId) => (assignments.find(a => String(a.ServicioID) === String(srvId))?.id) ?? null;

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
  const onKeyDownSearch = (e) => { if (e.key === "Enter") { e.preventDefault(); searchServices(); } };

  const toggle = async (srvId) => {
    if (!selectedSupervisor) return;
    setMsg("");
    try {
      if (isAssigned(srvId)) {
        const pid = pivotIdOf(srvId);
        if (pid) await api.delete(`/admin/assignments/${pid}`);
        else await api.delete(`/admin/assignments/by-key`, { params: { EmpleadoID: selectedSupervisor, ServicioID: srvId } });
      } else {
        await api.post("/admin/assignments", { EmpleadoID: String(selectedSupervisor), ServicioID: String(srvId) });
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
          onChange={(e) => { setSelectedSupervisor(e.target.value); setMsg(""); }}
        >
          <option value="">-- Elegir supervisor --</option>
          {supervisors.map(s => (
            <option key={s.id} value={s.id}>{s.username || `Supervisor #${s.id}`}</option>
          ))}
        </select>

        <input
          className="input"
          placeholder="Buscar servicio… (mín. 2 letras)"
          value={q}
          onChange={(e) => { setQ(e.target.value); setMsg(""); }}
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
            {services.map(s => (
              <label key={s.id} className={`assign-item ${isAssigned(s.id) ? "assigned" : ""}`}>
                <input
                  type="checkbox"
                  checked={isAssigned(s.id)}
                  onChange={() => toggle(s.id)}
                />
                <div className="assign-content">
                  <div className="assign-title">{s.name}</div>
                  <div className="assign-badges">
                    {isAssigned(s.id) ? <span className="badge">Asignado</span> : <span className="badge">Disponible</span>}
                  </div>
                </div>
              </label>
            ))}
          </div>

          <div className="hint small" style={{ marginTop: 12 }}>
            <strong>Asignados:</strong>{" "}
            {assignments.length ? assignments.map(a => a.service_name).join(", ") : "ninguno"}
          </div>
        </>
      )}
    </section>
  );
}

/* =======================  SERVICE ↔ PRODUCTS (confirmación al guardar)  ======================= */
function ServiceProductsSection() {
  const PAGE_SIZE = 12;

  const [step, setStep] = useState("pick"); // pick | assign
  const [service, setService] = useState(null);

  // búsqueda incremental de servicios
  const [qSrv, setQSrv] = useState("");
  const [srvResults, setSrvResults] = useState([]);
  const [srvMsg, setSrvMsg] = useState("");
  const [srvLoading, setSrvLoading] = useState(false);
  const debounceRef = useRef(null);
  const lastQueryRef = useRef("");

  // cat / productos (desde /catalog)
  const [cats, setCats] = useState([]);
  const [catId, setCatId] = useState("__all__");
  const [q, setQ] = useState("");
  const [allRows, setAllRows] = useState([]);
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);

  // asignaciones
  const [selected, setSelected] = useState(new Set());

  // estados
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [saveOk, setSaveOk] = useState("");
  const [saving, setSaving] = useState(false);

  /* ==== búsqueda incremental de servicios ==== */
  useEffect(() => {
    if (step !== "pick") return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      const term = qSrv.trim();
      if (term === lastQueryRef.current) return;
      lastQueryRef.current = term;

      if (!term) { setSrvResults([]); setSrvMsg(""); return; }
      try {
        setSrvLoading(true);
        const { data } = await api.get("/admin/services", { params: { q: term, limit: 25 } });
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

  /* ==== al pasar a 'assign': traer categorías y asignaciones ==== */
  useEffect(() => {
    if (step !== "assign" || !service) return;
    setPage(1);
    setSaveOk(""); setSaveErr(""); setLoadErr("");

    api.get("/catalog/categories")
      .then(({ data }) => setCats(Array.isArray(data) ? data : []))
      .catch(() => setCats([]));

    api.get(`/admin/sp/assignments/${service.id}`)
      .then(({ data }) => setSelected(new Set((data?.productIds || []).map(String))))
      .catch(() => setSelected(new Set()));
  }, [step, service]);

  /* ==== cargar artículos desde /catalog/products ==== */
  const loadProducts = useCallback(async () => {
    if (step !== "assign" || !service) return;
    setLoadErr("");
    setLoading(true);
    try {
      const { data } = await api.get("/catalog/products", {
        params: { catId: catId || "__all__", q: q || "" }
      });
      setAllRows(Array.isArray(data) ? data : []);
      setPage(1);
    } catch (e) {
      setAllRows([]);
      setLoadErr(e?.response?.data?.error || "No se pudieron cargar los productos");
    } finally {
      setLoading(false);
    }
  }, [step, service, catId, q]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  /* ==== paginación (cliente) ==== */
  useEffect(() => {
    const start = (page - 1) * PAGE_SIZE;
    setRows(allRows.slice(start, start + PAGE_SIZE));
  }, [allRows, page]);
  useEffect(() => { setPage(1); }, [catId]);
  useEffect(() => { setPage(1); }, [q]);

  /* ==== toggle asignado ==== */
  const toggle = (id, checked) => {
    const next = new Set(selected);
    if (checked) next.add(String(id)); else next.delete(String(id));
    setSelected(next);
    setSaveOk(""); setSaveErr("");
  };

  /* ==== guardar (con verificación y confirmación) ==== */
  const saveAll = async () => {
    if (!service) return;
    setSaving(true);
    setSaveErr("");
    setSaveOk("");

    const before = new Set(selected);

    try {
      const res = await api.put(`/admin/sp/assignments/${service.id}`, {
        productIds: Array.from(selected)
      });

      // Releer para confirmar
      const { data } = await api.get(`/admin/sp/assignments/${service.id}`);
      const afterIds = (data?.productIds || []).map(String);
      const afterSet = new Set(afterIds);

      let added = 0, removed = 0;
      for (const id of afterSet) if (!before.has(id)) added++;
      for (const id of before) if (!afterSet.has(id)) removed++;

      setSelected(new Set(afterSet));

      const stamp = new Date().toLocaleTimeString();
      const baseMsg = res?.data?.message || "Asignaciones guardadas";
      setSaveOk(`${baseMsg} ✓ — asignados: ${afterIds.length} ( +${added} / -${removed} ) — ${stamp}`);
    } catch (e) {
      setSaveErr(e?.response?.data?.error || e.message || "No se pudieron guardar");
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
  const canNext = page < totalPages;
  const prevPage = () => setPage(p => Math.max(1, p - 1));
  const nextPage = () => { if (canNext) setPage(p => p + 1); };

  return (
    <section className="card">
      <h2>Servicio ↔ Productos</h2>

      {step === "pick" && (
        <>
          <div className="toolbar">
            <input className="input" placeholder="Buscar servicio…" value={qSrv} onChange={(e)=>setQSrv(e.target.value)} />
            <button className="btn primary" onClick={()=>setQSrv(qSrv)} disabled={srvLoading}>
              {srvLoading ? "Buscando…" : "Buscar"}
            </button>
          </div>
          {srvMsg && <div className="alert error">{srvMsg}</div>}
          <div className="assign-list">
            {srvResults.map(s => (
              <label key={s.id} className="assign-item">
                <input type="radio" name="srv-pick" onChange={()=>{ setService(s); setStep("assign"); }} />
                <div className="assign-content"><div className="assign-title">{s.name}</div></div>
              </label>
            ))}
            {!srvResults.length && !srvMsg && <div className="hint">Empezá a escribir para ver resultados.</div>}
          </div>
        </>
      )}

      {step === "assign" && (
        <>
          <div className="toolbar">
            <button className="btn" onClick={()=>{ setStep("pick"); setService(null); setAllRows([]); setRows([]); setSelected(new Set()); }}>
              ← Cambiar servicio
            </button>
            <div className="sp-service-pill">Servicio: <strong>{service?.name}</strong></div>
            <div style={{ flex: 1 }} />
            <button className="btn primary" onClick={saveAll} disabled={saving}>
              {saving ? "Guardando…" : (saveOk ? "Guardado ✓" : "Guardar cambios")}
            </button>
          </div>

          <div className="toolbar">
            <select className="input" value={catId} onChange={(e)=>setCatId(e.target.value)}>
              <option value="__all__">Todas las categorías</option>
              {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input className="input" placeholder="Buscar producto…" value={q} onChange={(e)=>setQ(e.target.value)} />
          </div>

          {loadErr && (
            <div className="alert error">
              {loadErr} <button className="btn xs" type="button" onClick={loadProducts}>Reintentar</button>
            </div>
          )}
          {saveErr && <div className="alert error">{saveErr}</div>}
          {saveOk && <div className="alert">{saveOk}</div>}

          <div className="assign-list">
            {rows.map(r => {
              const on = selected.has(String(r.id));
              return (
                <label key={r.id} className={`assign-item ${on ? "assigned" : ""}`}>
                  <input type="checkbox" checked={on} onChange={(e)=>toggle(r.id, e.target.checked)} />
                  <div className="assign-content">
                    <div className="assign-title">{r.name}</div>
                    <div className="assign-badges">
                      <span className="badge">{r.code || "s/código"}</span>
                      {typeof r.price === "number" && <span className="badge">${r.price}</span>}
                      {typeof r.stock === "number" && <span className="badge">stock {r.stock}</span>}
                    </div>
                  </div>
                </label>
              );
            })}
            {!rows.length && !loadErr && <div className="hint">{loading ? "Cargando…" : "No hay productos para mostrar."}</div>}
          </div>

          <div className="toolbar" style={{ justifyContent: "space-between" }}>
            <div className="hint">Página {page} / {totalPages}</div>
            <div>
              <button className="btn" onClick={prevPage} disabled={page <= 1}>Anterior</button>
              <button className="btn" onClick={nextPage} disabled={!canNext} style={{ marginLeft: 8 }}>Siguiente</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/* =======================  PRESUPUESTOS  ======================= */
function BudgetsSection() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(async () => {
    try { setRows((await api.get("/admin/service-budgets")).data || []); }
    catch (e) { setErr(e?.response?.data?.error || e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return rows;
    return rows.filter(r => String(r.name || "").toLowerCase().includes(k));
  }, [rows, q]);

  const onSave = async (id, val) => {
    setSavingId(id);
    try {
      await api.put(`/admin/service-budgets/${id}`, { presupuesto: Number(val) });
      await load();
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="card">
      <h2>Presupuestos por servicio</h2>
      {err && <div className="alert error">{err}</div>}
      <div className="toolbar">
        <input className="input" placeholder="Buscar servicio…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="table">
        <div className="thead">
          <div>Servicio</div><div style={{textAlign:'right'}}>Presupuesto</div><div>Acciones</div>
        </div>
        <div className="tbody">
          {filtered.map(r => {
            const inputId = `b-${r.id}`;
            return (
              <div key={r.id} className="tr">
                <div className="td">{r.name}</div>
                <div className="td" style={{textAlign:'right'}}>
                  <input id={inputId} type="number" step="0.01" defaultValue={r.budget ?? ""} className="input mono" style={{maxWidth:160}} />
                </div>
                <div className="td">
                  <button className="btn" onClick={() => onSave(r.id, document.getElementById(inputId).value)} disabled={savingId===r.id}>
                    {savingId===r.id ? "Guardando…" : "Guardar"}
                  </button>
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div className="tr"><div style={{ gridColumn: "1 / -1" }}>Sin resultados</div></div>
          )}
        </div>
      </div>
      <div className="hint small" style={{marginTop:8}}>
        El pedido de un servicio no puede superar el <strong>5%</strong> de su presupuesto. Aquí definís el presupuesto base por servicio.
      </div>
    </section>
  );
}

/* =======================  ORDERS  ======================= */
function OrdersSection() {
  const [orders, setOrders] = useState([]);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    try { setOrders((await api.get("/admin/orders")).data || []); }
    catch (e) { setErr(e?.response?.data?.error || e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const onDeleteOrder = async (id) => {
    if (!confirm(`¿Eliminar pedido #${id}?`)) return;
    try { await api.delete(`/admin/orders/${id}`); await load(); }
    catch (e) { setErr(e?.response?.data?.error || e.message); }
  };
  const onUpdateOrderTotal = async (id) => {
    const val = prompt("Nuevo total:", "");
    if (val == null) return;
    try { await api.put(`/admin/orders/${id}/price`, { newPrice: Number(val) }); await load(); }
    catch (e) { setErr(e?.response?.data?.error || e.message); }
  };
  return (
    <section className="card">
      <h2>Pedidos</h2>
      {err && <div className="alert error">{err}</div>}
      <div className="table">
        <div className="thead">
          <div>ID</div><div>Empleado</div><div>Rol</div><div>Total</div><div>Fecha</div><div>Acciones</div>
        </div>
        <div className="tbody">
          {orders.map(o => (
            <div key={o.id} className="tr">
              <div>{o.id}</div><div>{o.empleadoId}</div><div>{o.rol}</div><div>${o.total}</div>
              <div>{o.fecha?.slice(0, 19)?.replace("T", " ")}</div>
              <div className="actions">
                <button className="btn tonal" onClick={() => onUpdateOrderTotal(o.id)}>Modificar total</button>
                <button className="btn danger" onClick={() => onDeleteOrder(o.id)}>Eliminar</button>
              </div>
            </div>
          ))}
          {orders.length === 0 && <div className="tr"><div style={{ gridColumn: "1 / -1" }}>Sin pedidos</div></div>}
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
      const isAdmin = (user?.roles || []).map(r => String(r).toLowerCase()).includes("admin");
      if (!user || !isAdmin) nav("/app");
    }
  }, [user, loading, nav]);

  if (loading) return <div className="state">Cargando…</div>;

  return (
    <div className="admin-container">
      {/* Barra superior de tabs (sticky y compacta) */}
      <div className="admin-topbar" role="tablist" aria-label="Secciones de administración">
        <button
          className={`tab-btn ${tab==="products" ? "is-active" : ""}`}
          onClick={()=>setTab("products")}
          role="tab"
          aria-selected={tab==="products"}
        >
          Productos
        </button>
        <button
          className={`tab-btn ${tab==="services" ? "is-active" : ""}`}
          onClick={()=>setTab("services")}
          role="tab"
          aria-selected={tab==="services"}
        >
          Asignar servicios
        </button>
        <button
          className={`tab-btn ${tab==="serviceProducts" ? "is-active" : ""}`}
          onClick={()=>setTab("serviceProducts")}
          role="tab"
          aria-selected={tab==="serviceProducts"}
        >
          Servicio ↔ Productos
        </button>
        <button
          className={`tab-btn ${tab==="budgets" ? "is-active" : ""}`}
          onClick={()=>setTab("budgets")}
          role="tab"
          aria-selected={tab==="budgets"}
        >
          Presupuestos
        </button>
        <button
          className={`tab-btn ${tab==="orders" ? "is-active" : ""}`}
          onClick={()=>setTab("orders")}
          role="tab"
          aria-selected={tab==="orders"}
        >
          Pedidos
        </button>
      </div>

      {tab==="products" && <ProductsSection />}
      {tab==="services" && <AssignServicesSection />}
      {tab==="serviceProducts" && <ServiceProductsSection />}
      {tab==="budgets" && <BudgetsSection />}
      {tab==="orders" && <OrdersSection />}
    </div>
  );
}

