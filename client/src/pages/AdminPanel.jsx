// client/src/pages/AdminPanel.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import "../styles/admin-panel.css";
import "../styles/a11y.css";
import EmployeesSection from "./EmployeesSection";
import MassReassignServicesSection from "./MassReassignServicesSection";

const API_BASE_URL =
  (import.meta?.env && import.meta.env.VITE_API_URL) || "http://localhost:4000";

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

const parseMoneyFlexible = (raw) => {
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
};

const clampInt = (v, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Math.min(max, Math.max(min, parseInt(v ?? 0, 10) || 0));

const norm = (v) =>
  String(v ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

const useDebounced = (value, delay = 300) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
};

function ProductsSection() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const qDeb = useDebounced(q, 350);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [roleVisibility, setRoleVisibility] = useState([]);

  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState(null);

  const [cats, setCats] = useState([]);
  const [catsErr, setCatsErr] = useState("");
  const [catFilter, setCatFilter] = useState("");

  const catIdByName = useMemo(() => {
    const m = new Map();
    for (const c of cats) {
      const key = norm(c?.name);
      if (key) m.set(key, String(c.id));
    }
    return m;
  }, [cats]);

  const [editingId, setEditingId] = useState(null); 
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

  const [stockEdit, setStockEdit] = useState(null);

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

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const { data } = await api.get("/admin/products", {
        params: { q: String(qDeb || "").trim(), limit: 200 },
      });

      const list = Array.isArray(data) ? data : [];

      const filteredByCategory = !catFilter
        ? list
        : list.filter((p) => {
            const rawId =
              p?.categoryId ??
              p?.category_id ??
              p?.CategoriaID ??
              p?.categoriaId ??
              p?.catId ??
              p?.CatID ??
              null;

            if (rawId != null && String(rawId) === String(catFilter)) return true;

            const rawName =
              p?.categoryName ??
              p?.category_name ??
              p?.Categoria ??
              p?.categoria ??
              p?.category ??
              p?.Category ??
              null;

            if (rawName != null) {
              const key = norm(rawName);
              const mappedId = catIdByName.get(key);
              if (mappedId && String(mappedId) === String(catFilter)) return true;
            }

            return false;
          });

      setRows(filteredByCategory);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, [qDeb, catFilter, catIdByName]);

  useEffect(() => {
    loadCats();
  }, [loadCats]);

  useEffect(() => {
    load();
  }, [load]);

  const startNew = () => {
  setEditingId("__new__");
  setCatTouched(false);

  setRoleVisibility(["supervisor", "administrativo"]); 

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

  setEditingId(row.id);
  setDraft({
    name: row.name ?? "",
    price: row.price ?? "",
    stock: row.stock ?? "",
    code: row.code ?? "",
    catId: "",
  });

  setRoleVisibility(["supervisor", "administrativo"]);

  setEditingLoading(true);
  try {

    const { data } = await api.get(`/admin/products/${row.id}`);


    const rolesRes = await api.get(`/admin/products/${row.id}/roles`);

    const rawRoles = rolesRes?.data ?? [];
    const roles = Array.isArray(rawRoles)
      ? rawRoles.map((x) => String(x).toLowerCase().trim()).filter(Boolean)
      : [];

    setRoleVisibility(roles.length ? roles : ["supervisor", "administrativo"]);

    let catId = "";
    if (data?.categoryId != null) catId = String(data.categoryId);
    else if (data?.categoryName != null) {
      const mapped = catIdByName.get(norm(data.categoryName));
      catId = mapped ? String(mapped) : "";
    }

    setDraft((prev) => ({
      ...prev,
      name: data?.name ?? prev.name ?? "",
      price: data?.price ?? prev.price ?? "",
      stock: data?.stock ?? prev.stock ?? "",
      code: data?.code ?? prev.code ?? "",
      catId,
    }));
  } catch (e) {
    setErr(e?.response?.data?.error || e.message || "No se pudo cargar el producto completo");
  } finally {
    setEditingLoading(false);
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
    price: draft.price === "" || draft.price === null ? null : Number(draft.price),
    stock: draft.stock === "" || draft.stock === null ? null : Number(draft.stock),
    code: draft.code === "" || draft.code === null ? null : String(draft.code),
  };

  if (!payload.name) {
    setErr("El nombre es requerido");
    return;
  }

  const rolesSel = Array.from(
    new Set((roleVisibility || []).map((r) => String(r).toLowerCase().trim()))
  ).filter(Boolean);

  if (!rolesSel.length) {
    setErr("Tenés que seleccionar al menos un rol (administrativo o supervisor).");
    return;
  }

  if (editingId === "__new__" || catTouched) {
    payload.catId = draft.catId || null;
  }

  try {
    if (editingId && editingId !== "__new__") {
      await api.put(`/admin/products/${editingId}`, payload);

      await api.put(`/admin/products/${editingId}/roles`, {
        roles: rolesSel,
      });
    } else {
      const { data } = await api.post("/admin/products", payload);

      await api.put(`/admin/products/${data.id}/roles`, {
        roles: rolesSel,
      });
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

  const saveStock = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (!stockEdit?.id) return;

    try {
      await api.put(`/admin/products/${stockEdit.id}`, {
        stock: Number(stockEdit.value),
      });
      setRows((prev) =>
        prev.map((it) =>
          it.id === stockEdit.id ? { ...it, stock: Number(stockEdit.value) } : it
        )
      );
      setStatusMsg("Stock actualizado.");
    } catch (e2) {
      setErr(e2?.response?.data?.error || e2.message);
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

  const downloadExcel = async () => {
    setErr("");
    setStatusMsg("");

    try {
      const res = await api.get("/admin/products/export", {
        responseType: "blob",
      });

      const blob = new Blob([res.data], {
        type:
          res.headers?.["content-type"] ||
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "productos.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setStatusMsg("Excel descargado.");
    } catch (e) {
      setErr(
        e?.response?.data?.error || e?.message || "No se pudo descargar el Excel"
      );
    }
  };

  const importExcel = async () => {
    setErr("");
    setStatusMsg("");

    if (!importFile) {
      setErr("Elegí un archivo .xlsx primero");
      return;
    }

    const fd = new FormData();
    fd.append("file", importFile);

    setImporting(true);
    try {
      const { data } = await api.post("/admin/products/import?mode=sync", fd, {
      headers: { "Content-Type": "multipart/form-data" },
      });


      const updated = Number(data?.updated ?? 0);
      const skipped = Number(data?.skipped ?? 0);

      setStatusMsg(
        data?.ok
          ? `Importación lista. Actualizados: ${updated}. Omitidos: ${skipped}.`
          : "Importación lista."
      );

      setImportFile(null);
      await load();
    } catch (e) {
      setErr(
        e?.response?.data?.error || e?.message || "No se pudo importar el Excel"
      );
    } finally {
      setImporting(false);
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

          <select
            className="select"
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            aria-label="Filtrar por categoría"
            style={{ minWidth: 220 }}
          >
            <option value="">— Todas las categorías —</option>
            {cats.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>

          <button className="btn" onClick={load} disabled={loading}>
            {loading ? "Buscando…" : "Buscar"}
          </button>

          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              setQ("");
              setCatFilter("");
            }}
          >
            Limpiar filtros
          </button>

          {/* ===== Export/Import Excel ===== */}
          <button className="btn" type="button" onClick={downloadExcel}>
            Descargar Excel
          </button>

          <label className="pill" style={{ cursor: "pointer" }}>
            Subir Excel
            <input
              type="file"
              accept=".xlsx,.xls"
              style={{ display: "none" }}
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
            />
          </label>

          <button
            className="btn"
            type="button"
            onClick={importExcel}
            disabled={!importFile || importing}
            title={!importFile ? "Elegí un .xlsx" : ""}
          >
            {importing ? "Importando…" : "Importar"}
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
                  <option key={c.id} value={String(c.id)}>
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
            <label>
  <span>Visible para</span>
  <div style={{ display: "flex", gap: 12 }}>
    {["supervisor", "administrativo"].map((role) => (
      <label key={role} style={{ display: "flex", gap: 4 }}>
        <input
          type="checkbox"
          checked={roleVisibility.includes(role)}
          onChange={(e) => {
            if (e.target.checked) {
              setRoleVisibility(prev => [...prev, role]);
            } else {
              setRoleVisibility(prev => prev.filter(r => r !== role));
            }
          }}
        />
        {role}
      </label>
    ))}
  </div>
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
                    <button type="button" className="pill" onClick={saveStock}>
                      Guardar
                    </button>
                    <button
                      type="button"
                      className="pill ghost"
                      onClick={cancelStockEdit}
                    >
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
                  {qDeb?.length >= 2 ? "Sin coincidencias." : "Escribí para buscar…"}
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

function ServiceProductsSection() {
  const [step, setStep] = useState("pick"); 
  const [service, setService] = useState(null);

  const [qSrv, setQSrv] = useState("");
  const qSrvDeb = useDebounced(qSrv, 300);
  const [srvResults, setSrvResults] = useState([]);
  const [srvLoading, setSrvLoading] = useState(false);
  const [srvMsg, setSrvMsg] = useState("");

  const [q, setQ] = useState("");
  const qDeb = useDebounced(q, 300);
  const [allRows, setAllRows] = useState([]); 
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [assignMsg, setAssignMsg] = useState("");
  const [saving, setSaving] = useState(false);

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

      {step === "manage" && service && (
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

function ServiceBudgetsSection() {
  const [rows, setRows] = useState([]); 
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
      const data = await api.get("/admin/service-budgets").then((r) => r.data || []);
      setRows(Array.isArray(data) ? data : []);
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
    const rawBudget = drafts[row.id]?.budget ?? (row.budget ?? "");
    const rawPct = drafts[row.id]?.maxPct ?? (row.maxPct ?? "");
    const presupuesto = parseMoneyFlexible(rawBudget);
    const maxPct = Number(rawPct);

    if (!Number.isFinite(presupuesto) || presupuesto < 0) {
      setErr("Presupuesto inválido");
      return;
    }
    if (!Number.isFinite(maxPct) || maxPct <= 0) {
      setErr("Porcentaje inválido");
      return;
    }

    setSavingIds((s) => new Set(s).add(row.id));
    setErr("");
    try {
      await api.put(`/admin/service-budgets/${row.id}`, { presupuesto, maxPct });
      setRows((prev) =>
        prev.map((it) =>
          it.id === row.id ? { ...it, budget: presupuesto, maxPct } : it
        )
      );
      setDrafts((d) => {
        const n = { ...d };
        delete n[row.id];
        return n;
      });
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
          const draft = drafts[row.id] || {};
          const value =
            draft.budget ??
            (row.budget == null ? "" : money(row.budget));
          const pct = draft.maxPct ?? (row.maxPct ?? "");
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
                  setDrafts((d) => ({
                    ...d,
                    [row.id]: { ...d[row.id], budget: e.target.value },
                  }))
                }
                placeholder="$ 0,00"
                style={{ width: 140 }}
                aria-label={`Presupuesto para ${row.name}`}
              />
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={pct}
                min="0"
                step="0.1"
                onChange={(e) =>
                  setDrafts((d) => ({
                    ...d,
                    [row.id]: { ...d[row.id], maxPct: e.target.value },
                  }))
                }
                placeholder="5"
                style={{ width: 100 }}
                aria-label={`Porcentaje máximo por pedido de ${row.name}`}
              />
              <button className="btn" onClick={() => onSaveOne(row)} disabled={saving}>
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
        <button className="pill" onClick={() => setPage(pageCount)} disabled={page >= pageCount}>
          »
        </button>
      </div>
    </section>
  );
}

function IncomingStockSection() {
  const [search, setSearch] = useState("");
  const searchDeb = useDebounced(search, 300);
  const [searchResults, setSearchResults] = useState([]);
  const [searchMsg, setSearchMsg] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);

  const [product, setProduct] = useState(null);
  const [rows, setRows] = useState([]); 
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
        eta,
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
        <button className="btn" type="button" onClick={doFindProduct} disabled={searchLoading}>
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
              <button className="pill" onClick={() => setProduct(p)} aria-label={`Elegir ${p.name}`}>
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
                  onChange={(e) => setForm((f) => ({ ...f, eta: e.target.value }))}
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

function OrdersSection() {
  const [orders, setOrders] = useState([]);
  const [err, setErr] = useState("");

  const [selectedOrder, setSelectedOrder] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState("");

  const isClosed = (o) => {
    if (!o) return false;

    const status = String(o.status ?? o.Status ?? "").toLowerCase();
    const estado = String(o.estado ?? o.Estado ?? "").toLowerCase();
    const closedAt = o.closedAt ?? o.ClosedAt ?? o.closed_at ?? null;

    const flagFields = [o.isClosed, o.is_closed, o.cerrado, o.Cerrado];
    const flagTrue = flagFields.some((v) => {
      if (v === 1 || v === true) return true;
      if (v === "1") return true;
      if (typeof v === "string" && v.toLowerCase() === "true") return true;
      return false;
    });

    return (
      status === "closed" ||
      estado === "cerrado" ||
      estado === "completado" ||
      estado === "completo" ||
      flagTrue ||
      closedAt != null
    );
  };

  const load = useCallback(async () => {
    setErr("");
    try {
      const { data } = await api.get("/deposito/orders", {
        params: { status: "closed" },
        withCredentials: true,
      });
      const arr = Array.isArray(data) ? data : data?.rows || [];
      setOrders(arr.filter(isClosed));
    } catch (e1) {
      console.warn("Fallo /deposito/orders, intento /admin/orders", e1?.message);
      try {
        const { data } = await api.get("/admin/orders", {
          params: { status: "closed" },
          withCredentials: true,
        });
        const arr = Array.isArray(data) ? data : data?.rows || [];
        setOrders(arr.filter(isClosed));
      } catch (e2) {
        console.error("No se pudieron cargar los pedidos cerrados", e2);
        setErr("No se pudieron cargar los pedidos cerrados");
        setOrders([]);
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      const d = new Date(base + "-03:00");
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

  const isPdfBlob = async (blob) => {
    try {
      const head = await blob.slice(0, 5).text();
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
        withCredentials: true,
        headers: { Accept: "application/pdf" },
      });
      const ct = String(
        res.headers?.["content-type"] || res.headers?.["Content-Type"] || ""
      ).toLowerCase();
      const blob = res.data;

      if (!ct.includes("application/pdf") && !(await isPdfBlob(blob))) {
        const textPreview = await blob.text().catch(() => "");
        throw new Error(
          `Content-Type="${ct}". ${textPreview ? "Preview: " + textPreview : ""}`
        );
      }
      return { url: toBlobUrl(blob), via: "axios-blob" };
    } catch (e) {
      console.debug("tryLoadPdfFromPath (axios-blob) falló", path, e?.message);
    }

    try {
      const res = await api.get(path, {
        responseType: "arraybuffer",
        withCredentials: true,
        headers: { Accept: "application/pdf" },
      });
      const ct = String(
        res.headers?.["content-type"] || res.headers?.["Content-Type"] || ""
      ).toLowerCase();
      const blob = new Blob([res.data], {
        type: ct.includes("application/pdf") ? "application/pdf" : "application/octet-stream",
      });

      if (!ct.includes("application/pdf") && !(await isPdfBlob(blob))) {
        const textPreview = await blob.text().catch(() => "");
        throw new Error(
          `Content-Type="${ct}". ${textPreview ? "Preview: " + textPreview : ""}`
        );
      }
      return { url: toBlobUrl(blob), via: "axios-arraybuffer" };
    } catch (e) {
      console.debug("tryLoadPdfFromPath (axios-arraybuffer) falló", path, e?.message);
    }

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
        (e?.message || "No se pudo cargar el remito") + status + (msg ? ` — Detalle: ${msg}` : "")
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
                {previewLoading && selectedOrder?.id === o.id ? "Cargando…" : "Ver remito"}
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
                <strong>#{String(selectedOrder.id).padStart(7, "0")}</strong> — Empleado{" "}
                <strong>{selectedOrder.empleadoId}</strong> — Rol{" "}
                <strong>{selectedOrder.rol}</strong>
              </div>
            ) : (
              <div className="muted">Detalle de remito</div>
            )}

            <div className="actions-row">
              {pdfUrl && (
                <a href={pdfUrl} target="_blank" rel="noreferrer" className="btn ghost">
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
                title={selectedOrder ? `Remito del pedido #${selectedOrder.id}` : "Remito"}
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

function CreateServiceSection() {
  const [name, setName] = useState("");
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const [importServiceFile, setImportServiceFile] = useState(null);
  const [importingServices, setImportingServices] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErr("");
    setMsg("");
    try {
      const { data } = await api.get("/admin/services-all");
      setServices(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudieron cargar los servicios");
      setServices([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const downloadServicesExcel = async () => {
    setErr("");
    setMsg("");
    try {
      const res = await api.get("/admin/services/export", { responseType: "blob" });

      const blob = new Blob([res.data], {
        type:
          res.headers?.["content-type"] ||
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "servicios.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setMsg("Excel de servicios descargado.");
    } catch (e) {
      setErr(
        e?.response?.data?.error ||
          e?.message ||
          "No se pudo descargar el Excel de servicios"
      );
    }
  };

 const importServicesExcel = async () => {
  setErr("");
  setMsg("");

  if (!importServiceFile) {
    setErr("Elegí un archivo .xlsx de servicios primero");
    return;
  }

  const fd = new FormData();
  fd.append("file", importServiceFile);

  setImportingServices(true);
  try {
    const { data } = await api.post(`/admin/services/import?mode=sync`, fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });

    const updated = Number(data?.updated ?? 0);
    const inserted = Number(data?.inserted ?? 0);
    const deleted = Number(data?.deleted ?? 0);
    const skipped = Number(data?.skipped ?? 0);

    setMsg(
      `Servicios sincronizados. Actualizados: ${updated}. Nuevos: ${inserted}. Borrados: ${deleted}. Omitidos: ${skipped}.`
    );

    setImportServiceFile(null);
    await loadAll();
  } catch (e) {
    setErr(e?.response?.data?.error || e?.message || "No se pudo importar el Excel de servicios");
  } finally {
    setImportingServices(false);
  }
};

  const deleteService = async (id) => {
    if (!confirm("¿Eliminar este servicio?")) return;

    setErr("");
    setMsg("");

    try {
      await api.delete(`/admin/services/${id}`);
      setMsg("Servicio eliminado.");
      await loadAll();
    } catch (e) {
      setErr(
        e?.response?.data?.error || e?.message || "No se pudo eliminar el servicio"
      );
    }
  };

  const create = async () => {
    const clean = String(name || "").trim();
    if (!clean) {
      setErr("El nombre es obligatorio");
      return;
    }

    setSaving(true);
    setErr("");
    setMsg("");
    try {
      const { data } = await api.post("/admin/services-create", { name: clean });
      setMsg(`Servicio creado: ${data?.service?.name || clean}`);
      setName("");
      await loadAll();
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudo crear el servicio");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="srv-card" aria-labelledby="create-service-heading">
      <div className="section-header">
        <h3 id="create-service-heading">Crear servicio</h3>
        {(msg || err) && (
          <div className={`state ${err ? "error" : "success"}`}>{err || msg}</div>
        )}
      </div>

      <div className="toolbar" style={{ gap: 10 }}>
        <input
          className="input"
          placeholder="Nombre del servicio…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Nombre del servicio"
        />

        <button className="btn primary" onClick={create} disabled={saving}>
          {saving ? "Creando…" : "+ Crear"}
        </button>

        <button className="btn" onClick={loadAll} disabled={loading}>
          {loading ? "Actualizando…" : "Actualizar lista"}
        </button>

        <div style={{ flex: 1 }} />

        <button className="btn" type="button" onClick={downloadServicesExcel}>
          Descargar Excel
        </button>

        <label className="pill" style={{ cursor: "pointer" }}>
          Subir Excel
          <input
            type="file"
            accept=".xlsx,.xls"
            style={{ display: "none" }}
            onChange={(e) => setImportServiceFile(e.target.files?.[0] || null)}
          />
        </label>

        <button
          className="btn"
          type="button"
          onClick={importServicesExcel}
          disabled={!importServiceFile || importingServices}
          title={!importServiceFile ? "Elegí un .xlsx" : ""}
        >
          {importingServices ? "Importando…" : "Importar"}
        </button>
      </div>

      {loading ? (
        <div className="state">Cargando…</div>
      ) : (
        <div className="table like" style={{ marginTop: 12 }}>
          <div className="t-head">
            <div style={{ flex: 2 }}>ID</div>
            <div style={{ flex: 6 }}>Nombre</div>
            <div style={{ width: 140 }} />
          </div>

          {services.length === 0 ? (
            <div className="t-row">
              <div style={{ flex: 1 }}>—</div>
              <div style={{ flex: 6 }}>Sin servicios</div>
            </div>
          ) : (
            services.map((s) => (
              <div key={String(s.id)} className="t-row">
                <div style={{ flex: 2 }} className="mono">
                  {s.id}
                </div>
                <div style={{ flex: 6 }}>{s.name}</div>

                <div style={{ width: 140, textAlign: "right" }}>
                  <button
                    className="pill danger"
                    onClick={() => deleteService(s.id)}
                    aria-label={`Eliminar servicio ${s.name}`}
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}

function ProductHistorialSection() {
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(false);
  const [err, setErr]             = useState("");
  const [vista, setVista]         = useState("detalle"); 

  const [q, setQ]                 = useState("");
  const [campo, setCampo]         = useState("todos");
  const [tipo, setTipo]           = useState("todos");
  const [from, setFrom]           = useState(() => {
    const d = new Date(); d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo]               = useState(() => new Date().toISOString().slice(0, 10));

  const niceCurrency = (n) => {
    if (n == null) return "—";
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 }).format(Number(n));
  };
  const niceNum = (n) => n == null ? "—" : new Intl.NumberFormat("es-AR").format(Number(n));
  const niceDate = (d) => {
    if (!d) return "—";
    return String(d).slice(0, 16).replace("T", " ");
  };

  const TIPO_LABELS = {
    excel_import:      { label: "Excel",     color: "#2563eb", bg: "#eff6ff" },
    manual_edit:       { label: "Manual",    color: "#7c3aed", bg: "#faf5ff" },
    stock_edit:        { label: "Stock rápido", color: "#059669", bg: "#f0fdf4" },
    producto_creado:   { label: "Nuevo",     color: "#d97706", bg: "#fffbeb" },
    producto_eliminado:{ label: "Eliminado", color: "#dc2626", bg: "#fef2f2" },
  };
  const CAMPO_LABELS = {
    stock:  { label: "Stock",  icon: "📦" },
    precio: { label: "Precio", icon: "💰" },
    nombre: { label: "Nombre", icon: "✏️"  },
    codigo: { label: "Código", icon: "🔢" },
  };

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const endpoint = vista === "resumen"
        ? "/admin/products/history/summary"
        : "/admin/products/history";

      const params = { campo, tipo, from, to, limit: 500 };
      if (q.trim().length >= 2) params.q = q.trim();

      const { data } = await api.get(endpoint, { params });
      setRows(data?.rows || []);
    } catch (e) {
      setErr(e?.response?.data?.error || e?.message || "No se pudo cargar el historial");
    } finally {
      setLoading(false);
    }
  }, [vista, campo, tipo, from, to, q]);

  useEffect(() => { load(); }, [load]);

  const handleSearch = (e) => { e.preventDefault(); load(); };

  const exportCsv = () => {
    if (!rows.length) return;
    const headers = vista === "resumen"
      ? ["Producto","Código","Campo","Cambios","Valor inicial","Valor final","Aumentos","Bajas","Variación neta","Primer cambio","Último cambio"]
      : ["Fecha","Producto","Código","Campo","Tipo","Valor anterior","Valor nuevo","Diferencia","Usuario"];

    const dataRows = vista === "resumen"
      ? rows.map(r => [r.nombre||"—", r.codigo||"—", r.campo, r.total_cambios, r.valor_inicial??0, r.valor_final??0, r.total_aumentos??0, r.total_bajas??0, r.variacion_neta??0, r.primer_cambio||"—", r.ultimo_cambio||"—"])
      : rows.map(r => [r.fecha, r.product_name||"—", r.product_code||"—", r.campo, r.tipo, r.valor_anterior??0, r.valor_nuevo??0, r.diferencia??0, r.usuario||"—"]);

    const csv = [headers, ...dataRows].map(row => row.map(c => `"${String(c).replace(/"/g,'""')}"`).join(";")).join("\n");
    Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" })),
      download: `historial_productos_${from}_${to}.csv`,
    }).click();
  };

  const kpis = (() => {
    if (vista !== "detalle" || !rows.length) return null;
    const stockRows  = rows.filter(r => r.campo === "stock");
    const precioRows = rows.filter(r => r.campo === "precio");
    const tiposUniq  = new Set(rows.map(r => r.product_id)).size;
    const totalAumentos = stockRows.filter(r => (r.diferencia||0) > 0).reduce((s,r) => s + (r.diferencia||0), 0);
    const totalBajas    = stockRows.filter(r => (r.diferencia||0) < 0).reduce((s,r) => s + Math.abs(r.diferencia||0), 0);
    return { total: rows.length, productos: tiposUniq, stockCambios: stockRows.length, precioCambios: precioRows.length, totalAumentos, totalBajas };
  })();

  return (
    <section className="srv-card" aria-labelledby="historial-heading">
      <div className="section-header">
        <h3 id="historial-heading">Historial de cambios de productos</h3>
        <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "#6b7280" }}>
          Registro automático de cada modificación de stock, precio, nombre o código. Se genera al importar un Excel, editar manualmente o actualizar el stock rápido.
        </p>
      </div>

      {/* ── FILTROS ── */}
      <form onSubmit={handleSearch} style={{ display:"flex", flexWrap:"wrap", gap:"0.65rem", alignItems:"flex-end", margin:"1rem 0 0.75rem", padding:"0.75rem 0.9rem", background:"#f8fafc", borderRadius:"0.6rem", border:"1px solid #e5e7eb" }}>

        <label style={{ display:"flex", flexDirection:"column", gap:3, fontSize:"0.82rem", color:"#4b5563" }}>
          <span style={{ fontWeight:600 }}>Buscar producto</span>
          <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Nombre o código…" style={{ minWidth:180 }} />
        </label>

        <label style={{ display:"flex", flexDirection:"column", gap:3, fontSize:"0.82rem", color:"#4b5563" }}>
          <span style={{ fontWeight:600 }}>Campo</span>
          <select className="select" value={campo} onChange={e => setCampo(e.target.value)} style={{ minWidth:130 }}>
            <option value="todos">Todos</option>
            <option value="stock">📦 Stock</option>
            <option value="precio">💰 Precio</option>
            <option value="nombre">✏️ Nombre</option>
            <option value="codigo">🔢 Código</option>
          </select>
        </label>

        <label style={{ display:"flex", flexDirection:"column", gap:3, fontSize:"0.82rem", color:"#4b5563" }}>
          <span style={{ fontWeight:600 }}>Tipo de cambio</span>
          <select className="select" value={tipo} onChange={e => setTipo(e.target.value)} style={{ minWidth:150 }}>
            <option value="todos">Todos</option>
            <option value="excel_import">Excel import</option>
            <option value="manual_edit">Edición manual</option>
            <option value="stock_edit">Stock rápido</option>
            <option value="producto_creado">Producto nuevo</option>
          </select>
        </label>

        <label style={{ display:"flex", flexDirection:"column", gap:3, fontSize:"0.82rem", color:"#4b5563" }}>
          <span style={{ fontWeight:600 }}>Desde</span>
          <input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} />
        </label>

        <label style={{ display:"flex", flexDirection:"column", gap:3, fontSize:"0.82rem", color:"#4b5563" }}>
          <span style={{ fontWeight:600 }}>Hasta</span>
          <input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} />
        </label>

        <label style={{ display:"flex", flexDirection:"column", gap:3, fontSize:"0.82rem", color:"#4b5563" }}>
          <span style={{ fontWeight:600 }}>Vista</span>
          <select className="select" value={vista} onChange={e => setVista(e.target.value)} style={{ minWidth:130 }}>
            <option value="detalle">Detalle (por cambio)</option>
            <option value="resumen">Resumen (por producto)</option>
          </select>
        </label>

        <div style={{ display:"flex", gap:"0.4rem", alignItems:"flex-end" }}>
          <button type="submit" className="btn primary" disabled={loading}>
            {loading ? "Cargando…" : "Buscar"}
          </button>
          <button type="button" className="btn" onClick={exportCsv} disabled={!rows.length}>
            Exportar CSV
          </button>
        </div>
      </form>

      {err && <div className="state error" role="alert">{err}</div>}

      {/* ── KPIs rápidos ── */}
      {kpis && !loading && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))", gap:"0.6rem", margin:"0 0 1rem" }}>
          {[
            { icon:"📝", val: kpis.total,         lbl: "Registros totales",  color:"#1d4ed8" },
            { icon:"📦", val: kpis.productos,      lbl: "Productos distintos",color:"#7c3aed" },
            { icon:"📊", val: kpis.stockCambios,   lbl: "Cambios de stock",   color:"#059669" },
            { icon:"💰", val: kpis.precioCambios,  lbl: "Cambios de precio",  color:"#d97706" },
            { icon:"▲",  val: `+${niceNum(kpis.totalAumentos)}`, lbl: "Total ingresado (stock)", color:"#22c55e" },
            { icon:"▼",  val: `-${niceNum(kpis.totalBajas)}`,    lbl: "Total bajado (stock)",    color:"#ef4444" },
          ].map((k, i) => (
            <div key={i} style={{ padding:"0.6rem 0.75rem", borderRadius:"0.6rem", border:"1px solid #e5e7eb", background:"#fff", display:"flex", alignItems:"center", gap:"0.5rem" }}>
              <span style={{ fontSize:"1.25rem" }}>{k.icon}</span>
              <div>
                <div style={{ fontWeight:800, fontSize:"1rem", color: k.color }}>{k.val}</div>
                <div style={{ fontSize:"0.7rem", color:"#6b7280" }}>{k.lbl}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── TABLA DETALLE ── */}
      {vista === "detalle" && !loading && (
        rows.length === 0
          ? <p style={{ color:"#6b7280", fontStyle:"italic", marginTop:"1rem" }}>Sin registros para los filtros seleccionados.</p>
          : (
            <div className="table-like" style={{ marginTop:0 }}>
              <div className="t-head" style={{ display:"grid", gridTemplateColumns:"140px 1fr 80px 90px 110px 100px 100px 90px 110px" }}>
                <div>Fecha</div>
                <div>Producto</div>
                <div>Código</div>
                <div>Campo</div>
                <div>Tipo</div>
                <div style={{ textAlign:"right" }}>Anterior</div>
                <div style={{ textAlign:"right" }}>Nuevo</div>
                <div style={{ textAlign:"right" }}>Diferencia</div>
                <div>Usuario</div>
              </div>
              {rows.map((r, i) => {
                const tipoInfo = TIPO_LABELS[r.tipo] || { label: r.tipo, color:"#374151", bg:"#f3f4f6" };
                const campoInfo = CAMPO_LABELS[r.campo] || { label: r.campo, icon:"📝" };
                const diff = r.diferencia;
                const isStock  = r.campo === "stock";
                const isPrecio = r.campo === "precio";
                const isNum = isStock || isPrecio;
                return (
                  <div key={r.id || i} className="t-row" style={{ display:"grid", gridTemplateColumns:"140px 1fr 80px 90px 110px 100px 100px 90px 110px", alignItems:"center" }}>
                    <div style={{ fontSize:"0.78rem", color:"#6b7280", fontVariantNumeric:"tabular-nums" }}>{niceDate(r.fecha)}</div>
                    <div style={{ fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={r.product_name}>{r.product_name || "—"}</div>
                    <div style={{ fontSize:"0.78rem", color:"#9ca3af" }}>{r.product_code || "—"}</div>
                    <div style={{ fontSize:"0.8rem" }}>{campoInfo.icon} {campoInfo.label}</div>
                    <div>
                      <span style={{ fontSize:"0.72rem", fontWeight:700, padding:"2px 8px", borderRadius:999, background: tipoInfo.bg, color: tipoInfo.color, border:`1px solid ${tipoInfo.color}40` }}>
                        {tipoInfo.label}
                      </span>
                    </div>
                    <div style={{ textAlign:"right", fontSize:"0.82rem", color:"#6b7280", fontVariantNumeric:"tabular-nums" }}>
                      {r.valor_anterior == null ? "—" : isNum ? (isPrecio ? niceCurrency(r.valor_anterior) : niceNum(r.valor_anterior)) : String(r.valor_anterior)}
                    </div>
                    <div style={{ textAlign:"right", fontSize:"0.82rem", fontWeight:600, fontVariantNumeric:"tabular-nums" }}>
                      {r.valor_nuevo == null ? "—" : isNum ? (isPrecio ? niceCurrency(r.valor_nuevo) : niceNum(r.valor_nuevo)) : String(r.valor_nuevo)}
                    </div>
                    <div style={{ textAlign:"right", fontWeight:700, fontSize:"0.82rem", color: diff == null ? "#9ca3af" : diff > 0 ? "#16a34a" : diff < 0 ? "#dc2626" : "#6b7280", fontVariantNumeric:"tabular-nums" }}>
                      {diff == null ? "—" : diff > 0 ? `+${isNum ? (isPrecio ? niceCurrency(diff) : niceNum(diff)) : diff}` : isNum ? (isPrecio ? niceCurrency(diff) : niceNum(diff)) : diff}
                    </div>
                    <div style={{ fontSize:"0.75rem", color:"#6b7280", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.usuario || "—"}</div>
                  </div>
                );
              })}
            </div>
          )
      )}

      {/* ── TABLA RESUMEN ── */}
      {vista === "resumen" && !loading && (
        rows.length === 0
          ? <p style={{ color:"#6b7280", fontStyle:"italic", marginTop:"1rem" }}>Sin datos para los filtros seleccionados.</p>
          : (
            <div className="table-like" style={{ marginTop:0 }}>
              <div className="t-head" style={{ display:"grid", gridTemplateColumns:"1fr 80px 70px 70px 110px 110px 110px 110px 110px" }}>
                <div>Producto</div>
                <div>Código</div>
                <div>Campo</div>
                <div style={{ textAlign:"right" }}>Cambios</div>
                <div style={{ textAlign:"right" }}>Valor inicial</div>
                <div style={{ textAlign:"right" }}>Valor final</div>
                <div style={{ textAlign:"right" }}>Total ▲</div>
                <div style={{ textAlign:"right" }}>Total ▼</div>
                <div style={{ textAlign:"right" }}>Variación neta</div>
              </div>
              {rows.map((r, i) => {
                const campoInfo = CAMPO_LABELS[r.campo] || { label: r.campo, icon:"📝" };
                const isPrecio = r.campo === "precio";
                const fmt = (v) => v == null ? "—" : isPrecio ? niceCurrency(v) : niceNum(v);
                const vnet = r.variacion_neta;
                return (
                  <div key={i} className="t-row" style={{ display:"grid", gridTemplateColumns:"1fr 80px 70px 70px 110px 110px 110px 110px 110px", alignItems:"center" }}>
                    <div style={{ fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={r.nombre}>{r.nombre || "—"}</div>
                    <div style={{ fontSize:"0.78rem", color:"#9ca3af" }}>{r.codigo || "—"}</div>
                    <div style={{ fontSize:"0.8rem" }}>{campoInfo.icon} {campoInfo.label}</div>
                    <div style={{ textAlign:"right", fontWeight:700, color:"#1d4ed8" }}>{r.total_cambios}</div>
                    <div style={{ textAlign:"right", fontSize:"0.82rem", color:"#6b7280", fontVariantNumeric:"tabular-nums" }}>{fmt(r.valor_inicial)}</div>
                    <div style={{ textAlign:"right", fontSize:"0.82rem", fontWeight:600, fontVariantNumeric:"tabular-nums" }}>{fmt(r.valor_final)}</div>
                    <div style={{ textAlign:"right", fontSize:"0.82rem", color:"#16a34a", fontWeight:600, fontVariantNumeric:"tabular-nums" }}>{r.total_aumentos > 0 ? `+${fmt(r.total_aumentos)}` : "—"}</div>
                    <div style={{ textAlign:"right", fontSize:"0.82rem", color:"#dc2626", fontWeight:600, fontVariantNumeric:"tabular-nums" }}>{r.total_bajas > 0 ? `-${fmt(r.total_bajas)}` : "—"}</div>
                    <div style={{ textAlign:"right", fontWeight:700, fontSize:"0.85rem", color: vnet == null ? "#9ca3af" : vnet > 0 ? "#16a34a" : vnet < 0 ? "#dc2626" : "#6b7280", fontVariantNumeric:"tabular-nums" }}>
                      {vnet == null ? "—" : vnet > 0 ? `+${fmt(vnet)}` : fmt(vnet)}
                    </div>
                  </div>
                );
              })}
            </div>
          )
      )}

      {loading && <div className="state" style={{ marginTop:"1rem" }}>Cargando historial…</div>}

      {!loading && rows.length > 0 && (
        <p style={{ fontSize:"0.78rem", color:"#9ca3af", marginTop:"0.75rem", textAlign:"right" }}>
          {rows.length} registro{rows.length !== 1 ? "s" : ""} mostrado{rows.length !== 1 ? "s" : ""}
        </p>
      )}
    </section>
  );
}

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

  useEffect(() => {
    if (loading) return;
    if (!user || !isAdmin) nav("/app");
  }, [user, loading, isAdmin, nav]);

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

      <div className="tabs" role="tablist" aria-label="Secciones de administración">
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
          className={`tab-btn ${tab === "createService" ? "is-active" : ""}`}
          onClick={() => setTab("createService")}
          role="tab"
          aria-selected={tab === "createService"}
        >
          Crear servicio
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

        <button
          className={`tab-btn ${tab === "historial" ? "is-active" : ""}`}
          onClick={() => setTab("historial")}
          role="tab"
          aria-selected={tab === "historial"}
        >
          Historial
        </button>
        <button
          className={`tab-btn ${tab === "employees" ? "is-active" : ""}`}
          onClick={() => setTab("employees")}
          role="tab"
          aria-selected={tab === "employees"}
        >
          Empleados
        </button>
        <div style={{ flex: 1 }} />
      </div>

      {tab === "products" && <ProductsSection />}
      {tab === "services" && <AssignServicesSection />}
      {tab === "createService" && <CreateServiceSection />}
      {tab === "serviceProducts" && <ServiceProductsSection />}
      {tab === "budgets" && <ServiceBudgetsSection />}
      {tab === "incomingStock" && <IncomingStockSection />}
      {tab === "massReassign" && <MassReassignServicesSection />}
      {tab === "orders" && <OrdersSection />}
      {tab === "historial" && <ProductHistorialSection />}
      {tab === "employees" && <EmployeesSection />}
    </div>
  );
}