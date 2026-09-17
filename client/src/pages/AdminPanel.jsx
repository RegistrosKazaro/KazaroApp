// client/src/pages/AdminPanel.jsx
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import useDebounced from "../hooks/useDebounced";
import { normalizeText as norm } from "../utils/text";
import { formatMoney, formatNumber, csvNumber } from "../utils/format";
import "../styles/admin-panel.css";
import "../styles/a11y.css";
import EmployeesSection from "./EmployeesSection";
import MassReassignServicesSection from "./MassReassignServicesSection";
import TwoFactorSection from "./TwoFactorSection";
import StockCriticoSection from "./StockCriticoSection";
import ControlPedidosSection from "./ControlPedidosSection";
const API_BASE_URL =
  (import.meta?.env && import.meta.env.VITE_API_URL) || "http://localhost:4000";

const money = formatMoney;

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
  const [newCatName, setNewCatName] = useState("");
  const [creatingCat, setCreatingCat] = useState(false);
  const [deletingCat, setDeletingCat] = useState(false);

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
    imageUrl: "",
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
    setDraft({ name: "", price: "", stock: "", code: "", catId: "", imageUrl: "" });
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
    imageUrl: draft.imageUrl === "" || draft.imageUrl === null ? null : String(draft.imageUrl).trim(),
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
  const adjustStock = async (row) => {
    const deltaStr = window.prompt(`Ajustar stock de "${row.name}" (stock actual: ${row.stock ?? 0}).\nEscribí la cantidad: positiva suma (devolución/ingreso), negativa resta (rotura/salida).`, "");
    if (deltaStr === null) return;
    const delta = parseInt(deltaStr, 10);
    if (!Number.isFinite(delta) || delta === 0) { alert("Cantidad inválida"); return; }
    const motivo = window.prompt("Motivo del ajuste (obligatorio):", "");
    if (motivo === null || !motivo.trim()) { alert("El motivo es obligatorio"); return; }
    try {
      const { data } = await api.post(`/admin/products/${row.id}/adjust-stock`, { delta, motivo: motivo.trim(), tipo: delta > 0 ? "devolucion" : "ajuste_salida" });
      setRows((prev) => prev.map((it) => it.id === row.id ? { ...it, stock: data.nuevo } : it));
      setStatusMsg(`Stock ajustado: ${data.anterior} → ${data.nuevo}`);
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudo ajustar");
    }
  };

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

  const onCreateCategory = async () => {
    const name = String(newCatName || "").trim();

    if (!name) {
      setCatsErr("Escribí un nombre para la categoría.");
      return;
    }

    setCreatingCat(true);
    setCatsErr("");
    setStatusMsg("");

    try {
      const { data } = await api.post("/admin/product-categories", { name });
      const created = data?.category ?? null;

      await loadCats();

      if (created?.id != null) {
        setDraft((d) => ({ ...d, catId: String(created.id) }));
        setCatTouched(true);
      }

      setNewCatName("");
      setStatusMsg(
        created?.created === false
          ? "La categoría ya existía y quedó seleccionada."
          : "Categoría creada."
      );
    } catch (e) {
      setCatsErr(
        e?.response?.data?.error || e?.message || "No se pudo crear la categoría"
      );
    } finally {
      setCreatingCat(false);
    }
  };

  const onDeleteCategory = async () => {
    const categoryId = String(draft.catId || "").trim();

    if (!categoryId) {
      setCatsErr("Seleccioná una categoría para eliminar.");
      return;
    }

    const selected = cats.find((c) => String(c.id) === categoryId);
    const label = selected?.name || `#${categoryId}`;

    if (!confirm(`¿Eliminar la categoría "${label}"?`)) return;

    setDeletingCat(true);
    setCatsErr("");
    setStatusMsg("");

    try {
      await api.delete(`/admin/product-categories/${categoryId}`);
      await loadCats();
      setDraft((d) => ({ ...d, catId: "" }));
      setCatTouched(true);
      setStatusMsg("Categoría eliminada.");
    } catch (e) {
      setCatsErr(
        e?.response?.data?.error || e?.message || "No se pudo eliminar la categoría"
      );
    } finally {
      setDeletingCat(false);
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

          <label className="btn" style={{ cursor: "pointer" }}>
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
              <span>URL de foto (opcional)</span>
              <input
                className="input"
                type="url"
                placeholder="https://…/foto.jpg"
                value={draft.imageUrl}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, imageUrl: e.target.value }))
                }
              />
              {draft.imageUrl ? (
                <img src={draft.imageUrl} alt="Vista previa" style={{ marginTop: 6, width: 90, height: 90, objectFit: "cover", borderRadius: 8, border: "1px solid #e5e7eb" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
              ) : null}
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
              <span>Nueva categoria</span>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="input"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onCreateCategory();
                    }
                  }}
                  placeholder="Ej: Limpieza"
                />
                <button
                  type="button"
                  className="btn"
                  onClick={onCreateCategory}
                  disabled={creatingCat}
                >
                  {creatingCat ? "Creando..." : "Crear"}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={onDeleteCategory}
                  disabled={deletingCat || !draft.catId}
                  title={!draft.catId ? "Seleccioná una categoría" : ""}
                >
                  {deletingCat ? "Eliminando..." : "Eliminar"}
                </button>
              </div>
            </label>
           </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8, padding: "8px 4px" }}>
            <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "#1e3a8a", minWidth: 100 }}>Visible para</span>
            {["supervisor", "administrativo"].map((role) => (
              <label key={role} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.9rem", fontWeight: 500, color: "#1e3a8a" }}>
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
                  style={{ width: 16, height: 16, accentColor: "#1d4ed8", cursor: "pointer" }}
                />
                {role}
              </label>
            ))}
          </div>

          <div style={{ display: "none" }}>

          </div>

          {editingLoading && editingId !== "__new__" && (
            <div className="hint" style={{ marginTop: 6 }}>
              Cargando datos del producto…
            </div>
          )}

          <label>
            <span>Asignación masiva a servicios</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn"
                disabled={editingId === "__new__" || editingLoading}
                onClick={async () => {
                  if (!confirm("¿Asignar este producto a TODOS los servicios?")) return;
                  try {
                    await api.post(`/admin/products/${editingId}/assign-all-services`);
                    setStatusMsg("Producto asignado a todos los servicios.");
                  } catch (e) {
                    setErr(e?.response?.data?.error || "No se pudo asignar");
                  }
                }}
              >
                Asignar a todos los servicios
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={editingId === "__new__" || editingLoading}
                onClick={async () => {
                  if (!confirm("¿Quitar este producto de TODOS los servicios?")) return;
                  try {
                    await api.post(`/admin/products/${editingId}/remove-all-services`);
                    setStatusMsg("Producto quitado de todos los servicios.");
                  } catch (e) {
                    setErr(e?.response?.data?.error || "No se pudo quitar");
                  }
                }}
              >
                Quitar de todos los servicios
              </button>
            </div>
          </label>

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
            <div style={{ width: 280 }} />
          </div>

          {rows.map((r) => (
            <div key={r.id} className="t-row" role="row">
              <div style={{ flex: 4, minWidth: 0 }}>
                <div style={{ fontSize: "0.82rem", wordBreak: "break-word", whiteSpace: "normal", lineHeight: 1.4 }}>
                {r.name}
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
                  width: 280,
                  display: "flex",
                  gap: 6,
                  justifyContent: "flex-end",
                  flexWrap: "wrap",
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
<button className="pill" onClick={() => adjustStock(r)} title="Devolución / ajuste con motivo">
  Ajustar
</button>
<button className="pill" onClick={() => onEdit(r)}>
  Editar
</button>
<button
  className={`pill ${r.is_active === 0 ? "" : "danger"}`}
  style={{ background: r.is_active === 0 ? "#f0fdf4" : undefined, color: r.is_active === 0 ? "#16a34a" : undefined }}
  onClick={async () => {
    try {
      const { data } = await api.put(`/admin/products/${r.id}/toggle-active`);
      setRows(prev => prev.map(p => p.id === r.id ? { ...p, is_active: data.is_active } : p));
      setStatusMsg(data.is_active ? "Producto activado." : "Producto desactivado.");
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudo cambiar el estado");
    }
  }}
>
  {r.is_active === 0 ? "Activar" : "Desactivar"}
</button>
<button
  className="pill danger"
  onClick={() => onDelete(r.id)}
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

/* Clasificar servicios: grupo (el rubro de cada hoja de la planilla) y zona.
   Se cargan de una desde el Excel y después se editan a mano acá. */
const CLASIF_POR_PAGINA = 25;

function ClasificarServiciosSection() {
  const [servicios, setServicios] = useState([]);
  const [grupos, setGrupos] = useState([]);
  const [zonas, setZonas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [err, setErr] = useState("");

  const [q, setQ] = useState("");
  const qDeb = useDebounced(q, 300);
  const [fGrupo, setFGrupo] = useState("todos");
  const [fZona, setFZona] = useState("todas");
  const [pagina, setPagina] = useState(1);
  const [guardandoId, setGuardandoId] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const { data } = await api.get("/admin/services/clasificacion");
      setServicios(Array.isArray(data?.servicios) ? data.servicios : []);
      setGrupos(data?.grupos || []);
      setZonas(data?.zonas || []);
      setErr("");
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudo cargar la clasificación");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const filtrados = useMemo(() => {
    const t = norm(String(qDeb || "").trim());
    return servicios.filter((s) => {
      if (fGrupo === "sinGrupo" ? !!s.grupo : fGrupo !== "todos" && s.grupo !== fGrupo) return false;
      if (fZona === "sinZona" ? !!s.zona : fZona !== "todas" && s.zona !== fZona) return false;
      if (!t) return true;
      return norm(String(s.name ?? "")).includes(t) || String(s.id ?? "").includes(t);
    });
  }, [servicios, qDeb, fGrupo, fZona]);

  const paginas = Math.max(1, Math.ceil(filtrados.length / CLASIF_POR_PAGINA));
  const paginaActual = Math.min(pagina, paginas);
  const desde = (paginaActual - 1) * CLASIF_POR_PAGINA;
  const visibles = filtrados.slice(desde, desde + CLASIF_POR_PAGINA);

  const sinClasificar = servicios.filter((s) => !s.grupo).length;

  const guardarFila = async (servicio, campos) => {
    setGuardandoId(servicio.id);
    try {
      await api.put(`/admin/services/${servicio.id}/clasificacion`, campos);
      setServicios((prev) => prev.map((s) => (String(s.id) === String(servicio.id) ? { ...s, ...campos } : s)));
      const nuevoGrupo = campos.grupo;
      const nuevaZona = campos.zona;
      if (nuevoGrupo && !grupos.includes(nuevoGrupo)) setGrupos((g) => [...g, nuevoGrupo].sort());
      if (nuevaZona && !zonas.includes(nuevaZona)) setZonas((z) => [...z, nuevaZona].sort());
      setErr("");
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudo guardar");
    } finally {
      setGuardandoId(null);
    }
  };

  const filtrar = (fn) => { fn(); setPagina(1); };

  return (
    <section className="srv-card" aria-labelledby="cl-heading">
      <h3 id="cl-heading">Clasificar servicios</h3>

      <p className="muted gi-intro">
        Cada servicio tiene un <strong>grupo</strong> (Públicos, Privados, Supermercados, EPEC…) y una <strong>zona</strong>.
        Se cargan de una desde la planilla y después se corrigen acá. Sirven para buscar, agrupar y mirar los informes por zona o por rubro.
      </p>

      <ImportarClasificacion onAplicado={cargar} />

      {err && <div className="state">{err}</div>}

      {cargando ? <div className="state">Cargando…</div> : (
        <>
          <div className="toolbar sp-filtros">
            <input
              className="input" value={q} onChange={(e) => filtrar(() => setQ(e.target.value))}
              placeholder="Buscar servicio por nombre o número…" aria-label="Buscar servicio"
            />
            <select className="input" value={fGrupo} onChange={(e) => filtrar(() => setFGrupo(e.target.value))} aria-label="Filtrar por grupo">
              <option value="todos">Todos los grupos</option>
              <option value="sinGrupo">Sin grupo ({sinClasificar})</option>
              {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <select className="input" value={fZona} onChange={(e) => filtrar(() => setFZona(e.target.value))} aria-label="Filtrar por zona">
              <option value="todas">Todas las zonas</option>
              <option value="sinZona">Sin zona</option>
              {zonas.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>

          <div className="sp-acciones">
            <span className="muted sp-contador">
              {filtrados.length} de {servicios.length} servicios
              {sinClasificar > 0 && <> · <strong>{sinClasificar}</strong> sin grupo</>}
            </span>
          </div>

          <div className="table like">
            <div className="t-head">
              <div style={{ flex: 5 }}>Servicio</div>
              <div style={{ flex: 3 }}>Grupo</div>
              <div style={{ flex: 2 }}>Zona</div>
            </div>

            {visibles.length === 0 ? (
              <div className="state">Ningún servicio coincide con el filtro</div>
            ) : visibles.map((s) => (
              <div key={s.id} className="t-row">
                <div style={{ flex: 5, minWidth: 0 }}>
                  <div className="truncate">{s.name} <span className="muted">#{s.id}</span></div>
                </div>
                <div style={{ flex: 3 }}>
                  <select
                    className="input" value={s.grupo || ""} disabled={guardandoId === s.id}
                    onChange={(e) => guardarFila(s, { grupo: e.target.value })}
                    aria-label={`Grupo de ${s.name}`}
                  >
                    <option value="">— sin grupo —</option>
                    {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div style={{ flex: 2 }}>
                  <select
                    className="input" value={s.zona || ""} disabled={guardandoId === s.id}
                    onChange={(e) => guardarFila(s, { zona: e.target.value })}
                    aria-label={`Zona de ${s.name}`}
                  >
                    <option value="">— sin zona —</option>
                    {zonas.map((z) => <option key={z} value={z}>{z}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>

          {filtrados.length > CLASIF_POR_PAGINA && (
            <div className="sp-paginado">
              <button className="btn ghost" onClick={() => setPagina((p) => Math.max(1, p - 1))}
                disabled={paginaActual <= 1} aria-label="Página anterior">‹ Anterior</button>
              <span className="muted">
                Mostrando {desde + 1}–{Math.min(desde + CLASIF_POR_PAGINA, filtrados.length)} de {filtrados.length}
                {" · "}Página {paginaActual} de {paginas}
              </span>
              <button className="btn ghost" onClick={() => setPagina((p) => Math.min(paginas, p + 1))}
                disabled={paginaActual >= paginas} aria-label="Página siguiente">Siguiente ›</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* Sube la planilla, muestra el previo y recién ahí aplica. */
function ImportarClasificacion({ onAplicado }) {
  const [archivo, setArchivo] = useState(null);
  const [previo, setPrevio] = useState(null);
  const [leyendo, setLeyendo] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [msg, setMsg] = useState("");
  const [confirmados, setConfirmados] = useState({});   // nombre del archivo -> servicioId elegido

  const leer = async () => {
    if (!archivo) return;
    setLeyendo(true);
    setMsg("");
    setPrevio(null);
    setConfirmados({});
    try {
      const fd = new FormData();
      fd.append("file", archivo);
      const { data } = await api.post("/admin/services/clasificacion/preview", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setPrevio(data);
    } catch (e) {
      setMsg(e?.response?.data?.error || "No se pudo leer el archivo");
    } finally {
      setLeyendo(false);
    }
  };

  const aplicar = async () => {
    if (!previo) return;
    setAplicando(true);
    setMsg("");
    try {
      const cambios = [];
      for (const i of previo.items) {
        if (i.estado === "listo") cambios.push({ servicioId: i.servicioId, grupo: i.grupo, zona: i.zona });
        else if (i.estado === "sin_match" && confirmados[i.nombre]) {
          cambios.push({ servicioId: confirmados[i.nombre], grupo: i.grupo, zona: i.zona });
        }
      }
      if (!cambios.length) { setMsg("No hay nada para aplicar."); return; }
      const { data } = await api.post("/admin/services/clasificacion/aplicar", { cambios });
      setMsg(`Listo: se clasificaron ${data.aplicados} servicio${data.aplicados === 1 ? "" : "s"}.`);
      setPrevio(null);
      setArchivo(null);
      onAplicado?.();
    } catch (e) {
      setMsg(e?.response?.data?.error || "No se pudo aplicar");
    } finally {
      setAplicando(false);
    }
  };

  const sinMatch = previo?.items?.filter((i) => i.estado === "sin_match") || [];
  const aConfirmar = sinMatch.filter((i) => i.sugerencia);
  const confirmadosN = Object.keys(confirmados).length;

  return (
    <div className="clasif-import">
      <div className="clasif-import-fila">
        <input
          type="file" accept=".xlsx,.xls" aria-label="Planilla de servicios"
          onChange={(e) => { setArchivo(e.target.files?.[0] || null); setPrevio(null); setMsg(""); }}
        />
        <button className="btn" onClick={leer} disabled={!archivo || leyendo}>
          {leyendo ? "Leyendo…" : "Ver qué cambiaría"}
        </button>
      </div>

      {msg && <div className="state">{msg}</div>}

      {previo && (
        <div className="clasif-previo">
          <div className="clasif-resumen">
            <strong>{previo.total}</strong> servicios en la planilla ·{" "}
            <strong>{previo.resumen.listo}</strong> para clasificar ·{" "}
            {previo.resumen.igual > 0 && <>{previo.resumen.igual} ya estaban igual · </>}
            <strong>{previo.resumen.sinMatch}</strong> sin encontrar
            {previo.resumen.ambiguo > 0 && <> · {previo.resumen.ambiguo} con nombre repetido</>}
          </div>
          <div className="muted clasif-grupos">Grupos: {previo.grupos.join(" · ")}</div>

          {aConfirmar.length > 0 && (
            <>
              <div className="muted clasif-aviso">
                Estos no los encontré por nombre. Te muestro el más parecido, pero <strong>no los aplico si no los confirmás vos</strong>:
              </div>
              <div className="table like clasif-dudosos">
                {aConfirmar.map((i) => (
                  <div key={i.nombre} className="t-row">
                    <div style={{ flex: 5, minWidth: 0 }}>
                      <div className="truncate">{i.nombre}</div>
                      <div className="muted clasif-sug">se parece a: {i.sugerencia.name} <span className="muted">#{i.sugerencia.id}</span></div>
                    </div>
                    <div style={{ width: 130, textAlign: "right" }}>
                      <button
                        className={`pill ${confirmados[i.nombre] ? "" : "pill--ghost"}`}
                        onClick={() => setConfirmados((c) => {
                          const n = { ...c };
                          if (n[i.nombre]) delete n[i.nombre]; else n[i.nombre] = i.sugerencia.id;
                          return n;
                        })}
                      >
                        {confirmados[i.nombre] ? "Confirmado" : "Es el mismo"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="actions-row clasif-acciones">
            <button className="btn primary" onClick={aplicar} disabled={aplicando}>
              {aplicando ? "Aplicando…" : `Aplicar ${previo.resumen.listo + confirmadosN} servicios`}
            </button>
            <button className="btn ghost" onClick={() => setPrevio(null)} disabled={aplicando}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ServiceProductsSection() {
  // Dos formas de cargar lo mismo: eligiendo el servicio (lo de siempre) o
  // eligiendo el insumo y marcando a qué servicios va, que es mucho más rápido
  // cuando un insumo nuevo tiene que entrar en decenas de servicios.
  const [vista, setVista] = useState("porServicio");

  return (
    <section className="srv-card" aria-labelledby="sp-heading">
      <h3 id="sp-heading">Servicio ↔ Productos</h3>

      <div className="sp-tabs" role="tablist" aria-label="Forma de asignar">
        <button
          type="button" role="tab" aria-selected={vista === "porServicio"}
          className={`btn ${vista === "porServicio" ? "primary" : "ghost"}`}
          onClick={() => setVista("porServicio")}
        >
          Por servicio
        </button>
        <button
          type="button" role="tab" aria-selected={vista === "porInsumo"}
          className={`btn ${vista === "porInsumo" ? "primary" : "ghost"}`}
          onClick={() => setVista("porInsumo")}
        >
          Por insumo
        </button>
        <span className="muted sp-tabs-hint">
          {vista === "porServicio"
            ? "Elegís un servicio y marcás los insumos que lleva."
            : "Elegís un insumo y marcás todos los servicios que lo llevan."}
        </span>
      </div>

      {vista === "porServicio" ? <AsignarPorServicio /> : <AsignarPorInsumo />}
    </section>
  );
}

/* Elegís un servicio y marcás sus insumos. */
function AsignarPorServicio() {
  const [step, setStep] = useState("pick");
  const [service, setService] = useState(null);

  const [qSrv, setQSrv] = useState("");
  const qSrvDeb = useDebounced(qSrv, 300);
  const [srvResults, setSrvResults] = useState([]);
  const [srvLoading, setSrvLoading] = useState(false);
  const [srvMsg, setSrvMsg] = useState("");

  const [q, setQ] = useState("");
  const qDeb = useDebounced(q, 300);
  const [categoria, setCategoria] = useState("todas");
  const [estado, setEstado] = useState("todos");
  const [cats, setCats] = useState([]);
  const [allRows, setAllRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [original, setOriginal] = useState(new Set());
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
      const { data } = await api.get("/admin/services", { params: { q: term, limit: 50 } });
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
      const [{ data: products }, current] = await Promise.all([
        api.get("/admin/products", { params: { q: "", limit: 500 } }),
        api.get(`/admin/sp/assignments/${service.id}`),
      ]);
      setAllRows(Array.isArray(products) ? products : []);
      const ids = new Set((current.data?.productIds || []).map(String));
      setSelected(ids);
      setOriginal(new Set(ids));
    } catch {
      setAssignMsg("Error al cargar datos");
    }
  }, [service]);

  useEffect(() => {
    api.get("/catalog/categories")
      .then(({ data }) => setCats(Array.isArray(data) ? data : []))
      .catch(() => setCats([]));
  }, []);

  useEffect(() => { searchServices(); }, [searchServices]);
  useEffect(() => { loadProductsAndSelection(); }, [loadProductsAndSelection]);

  // Texto + categoría + estado: los tres filtros se combinan y los botones de
  // asignación masiva trabajan sobre lo que quede a la vista.
  const rows = useMemo(() => {
    const term = norm(String(qDeb || "").trim());
    return allRows.filter((p) => {
      if (categoria !== "todas" && String(p?.categoryId ?? "") !== String(categoria)) return false;
      if (estado === "asignados" && !selected.has(String(p.id))) return false;
      if (estado === "sinAsignar" && selected.has(String(p.id))) return false;
      if (!term) return true;
      return norm(String(p?.name ?? "")).includes(term)
        || String(p?.id ?? "").includes(term)
        || norm(String(p?.code ?? "")).includes(term);
    });
  }, [allRows, qDeb, categoria, estado, selected]);

  const toggle = (id) => {
    setSelected((prev) => {
      const s = new Set(prev);
      const k = String(id);
      if (s.has(k)) s.delete(k); else s.add(k);
      return s;
    });
  };

  const marcarTodos = () => setSelected((prev) => {
    const s = new Set(prev);
    for (const p of rows) s.add(String(p.id));
    return s;
  });
  const desmarcarTodos = () => setSelected((prev) => {
    const s = new Set(prev);
    for (const p of rows) s.delete(String(p.id));
    return s;
  });

  const hayFiltro = String(qDeb || "").trim().length > 0 || categoria !== "todas" || estado !== "todos";
  const visiblesMarcados = rows.filter((p) => selected.has(String(p.id))).length;
  const todosMarcados = rows.length > 0 && visiblesMarcados === rows.length;
  const sinGuardar = selected.size !== original.size
    || [...selected].some((id) => !original.has(id));
  const nombreCategoria = cats.find((c) => String(c.id) === String(categoria))?.name;

  const save = async () => {
    if (!service) return;
    setSaving(true);
    setAssignMsg("");
    try {
      const res = await api.put(`/admin/sp/assignments/${service.id}`, {
        productIds: Array.from(selected),
      });
      const added = Number(res?.data?.added ?? 0);
      const removed = Number(res?.data?.removed ?? 0);
      setOriginal(new Set(selected));
      setAssignMsg(
        added || removed
          ? `Guardado: ${added} asignado${added === 1 ? "" : "s"}, ${removed} quitado${removed === 1 ? "" : "s"}.`
          : "Guardado. No hubo cambios."
      );
    } catch {
      setAssignMsg("No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  if (step === "pick") {
    return (
      <>
        <div className="toolbar">
          <input
            className="input" value={qSrv} onChange={(e) => setQSrv(e.target.value)}
            placeholder="Buscar servicio (mín. 2 letras)…" aria-label="Buscar servicio"
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
                <div className="truncate">{s.name} <span className="muted">#{s.id}</span></div>
                <button className="pill" onClick={() => { setService({ id: s.id, name: s.name }); setStep("manage"); }}>
                  Elegir
                </button>
              </div>
            ))
          )}
        </div>
      </>
    );
  }

  if (!service) return null;

  return (
    <>
      <div className="section-header">
        <div className="muted">
          Servicio seleccionado: <strong>{service.name}</strong> (#{service.id})
        </div>
        <div className="actions-row">
          <button className="btn ghost" onClick={() => setStep("pick")}>Cambiar servicio</button>
          <button className="btn primary" onClick={save} disabled={saving || !sinGuardar}>
            {saving ? "Guardando…" : sinGuardar ? "Guardar asignaciones" : "Sin cambios"}
          </button>
        </div>
        {assignMsg && <div className="state">{assignMsg}</div>}
      </div>

      <ReglaDelServicio servicio={service} onAplicada={loadProductsAndSelection} />

      <div className="toolbar sp-filtros">
        <input
          className="input" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Filtrar insumos (ID, nombre o código)…" aria-label="Filtrar insumos"
        />
        <select className="input" value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoría">
          <option value="todas">Todas las categorías</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input" value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Estado">
          <option value="todos">Todos</option>
          <option value="asignados">Sólo los asignados</option>
          <option value="sinAsignar">Sólo los que faltan</option>
        </select>
      </div>

      <div className="sp-acciones">
        <button type="button" className="btn primary" onClick={marcarTodos} disabled={rows.length === 0 || todosMarcados}>
          {categoria !== "todas" && !String(qDeb).trim() && estado === "todos"
            ? `Asignar toda la categoría ${nombreCategoria || ""} (${rows.length})`
            : hayFiltro
              ? `Asignar ${rows.length} insumo${rows.length === 1 ? "" : "s"} a la vista`
              : `Asignar todos los insumos (${rows.length})`}
        </button>
        <button type="button" className="btn ghost" onClick={desmarcarTodos} disabled={visiblesMarcados === 0}>
          {hayFiltro ? "Quitar los que se ven" : "Quitar todos"}
        </button>
        <span className="muted sp-contador">
          {visiblesMarcados} de {rows.length} a la vista · <strong>{selected.size}</strong> asignados en total
        </span>
      </div>

      <div className="muted sp-aviso">
        {sinGuardar
          ? <strong>Tenés cambios sin guardar: tocá “Guardar asignaciones”.</strong>
          : "Los cambios se aplican cuando tocás “Guardar asignaciones”."}
      </div>

      <div className="table like">
        <div className="t-head">
          <div style={{ flex: 4 }}>Producto</div>
          <div style={{ flex: 2 }}>Código</div>
          <div style={{ flex: 2, textAlign: "right" }}>Precio</div>
          <div style={{ width: 120, textAlign: "right" }}>Asignado</div>
        </div>

        {rows.length === 0 ? (
          <div className="state">Ningún insumo coincide con el filtro</div>
        ) : rows.map((p) => (
          <label key={p.id} className="t-row" style={{ cursor: "pointer" }}>
            <div style={{ flex: 4, minWidth: 0 }}>
              <div className="truncate">{p.name} <span className="muted">#{p.id}</span></div>
            </div>
            <div style={{ flex: 2 }}>{p.code ?? "—"}</div>
            <div style={{ flex: 2, textAlign: "right" }}>{p.price == null ? "—" : money(p.price)}</div>
            <div style={{ width: 120, textAlign: "right" }}>
              <input
                type="checkbox" checked={selected.has(String(p.id))}
                onChange={() => toggle(p.id)} aria-label={`Asignar ${p.name}`}
              />
            </div>
          </label>
        ))}
      </div>
    </>
  );
}

/* La regla del servicio: en vez de tildar insumo por insumo, se dice si lleva
   limpieza y/o descartables y la lista se arma sola. */
function ReglaDelServicio({ servicio, onAplicada }) {
  const [limpieza, setLimpieza] = useState(null);
  const [descartables, setDescartables] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");
  const [disponible, setDisponible] = useState(true);

  useEffect(() => {
    let vivo = true;
    api.get(`/admin/servicio-grupos/${servicio.id}`)
      .then(({ data }) => {
        if (!vivo) return;
        setLimpieza(data?.limpieza ?? null);
        setDescartables(data?.descartables ?? null);
        setDisponible(true);
        setMsg("");
      })
      .catch((e) => {
        if (!vivo) return;
        // En Pazar no aplica: la sección sigue funcionando como siempre.
        setDisponible(e?.response?.status !== 403);
        setMsg("");
      });
    return () => { vivo = false; };
  }, [servicio.id]);

  if (!disponible) return null;

  const aplicar = async (l, d) => {
    setGuardando(true);
    setMsg("");
    try {
      const { data } = await api.put(`/admin/servicio-grupos/${servicio.id}`, { limpieza: l, descartables: d });
      setLimpieza(l);
      setDescartables(d);
      const ag = Number(data?.agregados ?? 0);
      const qu = Number(data?.quitados ?? 0);
      setMsg(ag || qu
        ? `Listo: ${ag} insumo${ag === 1 ? "" : "s"} agregado${ag === 1 ? "" : "s"} y ${qu} quitado${qu === 1 ? "" : "s"}.`
        : "Listo. La lista ya estaba así.");
      onAplicada?.();
    } catch (e) {
      setMsg(e?.response?.data?.error || "No se pudo aplicar la regla");
    } finally {
      setGuardando(false);
    }
  };

  const sinDefinir = limpieza == null && descartables == null;
  const opciones = [
    { id: "ambos", label: "Limpieza y descartables", l: true, d: true },
    { id: "limpieza", label: "Sólo limpieza", l: true, d: false },
    { id: "descartables", label: "Sólo descartables", l: false, d: true },
    { id: "ninguno", label: "Ninguno de los dos", l: false, d: false },
  ];
  const actual = sinDefinir ? null : opciones.find((o) => o.l === !!limpieza && o.d === !!descartables)?.id;

  return (
    <div className="regla-servicio">
      <div className="regla-titulo">
        ¿Qué le corresponde a este servicio?
        {sinDefinir && <span className="regla-pendiente">sin definir</span>}
      </div>
      <div className="regla-opciones">
        {opciones.map((o) => (
          <button
            key={o.id} type="button"
            className={`btn ${actual === o.id ? "primary" : "ghost"}`}
            onClick={() => aplicar(o.l, o.d)}
            disabled={guardando}
            aria-pressed={actual === o.id}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="muted regla-nota">
        {msg || (sinDefinir
          ? "Mientras no elijas, la lista de abajo queda como está."
          : "La lista de abajo se arma sola con esta regla. Abajo podés hacer ajustes puntuales.")}
      </div>
    </div>
  );
}

/* Elegís un insumo y marcás todos los servicios que lo llevan. */
const SERVICIOS_POR_PAGINA = 50;

function AsignarPorInsumo() {
  const [producto, setProducto] = useState(null);

  const [qProd, setQProd] = useState("");
  const qProdDeb = useDebounced(qProd, 300);
  const [productos, setProductos] = useState([]);
  const [prodMsg, setProdMsg] = useState("");

  const [servicios, setServicios] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [original, setOriginal] = useState(new Set());
  const [qSrv, setQSrv] = useState("");
  const qSrvDeb = useDebounced(qSrv, 300);
  const [estado, setEstado] = useState("todos");
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(false);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let vivo = true;
    api.get("/admin/products", { params: { q: String(qProdDeb || "").trim(), limit: 500 } })
      .then(({ data }) => { if (vivo) { setProductos(Array.isArray(data) ? data : []); setProdMsg(""); } })
      .catch(() => { if (vivo) setProdMsg("No se pudieron cargar los insumos"); });
    return () => { vivo = false; };
  }, [qProdDeb]);

  const elegirProducto = async (p) => {
    setCargando(true);
    setMsg("");
    try {
      const { data } = await api.get(`/admin/sp/by-product/${p.id}`);
      setServicios(Array.isArray(data?.servicios) ? data.servicios : []);
      const ids = new Set((data?.serviceIds || []).map(String));
      setSelected(ids);
      setOriginal(new Set(ids));
      setProducto({ id: p.id, name: p.name, code: p.code });
      setQSrv("");
      setEstado("todos");
      setPagina(1);
    } catch {
      setMsg("No se pudo cargar a qué servicios va el insumo");
    } finally {
      setCargando(false);
    }
  };

  const filtrados = useMemo(() => {
    const term = norm(String(qSrvDeb || "").trim());
    return servicios.filter((s) => {
      if (estado === "asignados" && !selected.has(String(s.id))) return false;
      if (estado === "sinAsignar" && selected.has(String(s.id))) return false;
      if (!term) return true;
      return norm(String(s.name ?? "")).includes(term) || String(s.id ?? "").includes(term);
    });
  }, [servicios, qSrvDeb, estado, selected]);

  const paginas = Math.max(1, Math.ceil(filtrados.length / SERVICIOS_POR_PAGINA));
  const paginaActual = Math.min(pagina, paginas);
  const desde = (paginaActual - 1) * SERVICIOS_POR_PAGINA;
  const visibles = filtrados.slice(desde, desde + SERVICIOS_POR_PAGINA);

  // Los botones masivos aplican a TODO lo filtrado, no sólo a la página a la vista.
  const marcarFiltrados = () => setSelected((prev) => {
    const s = new Set(prev);
    for (const x of filtrados) s.add(String(x.id));
    return s;
  });
  const desmarcarFiltrados = () => setSelected((prev) => {
    const s = new Set(prev);
    for (const x of filtrados) s.delete(String(x.id));
    return s;
  });
  const toggle = (id) => setSelected((prev) => {
    const s = new Set(prev);
    const k = String(id);
    if (s.has(k)) s.delete(k); else s.add(k);
    return s;
  });

  const buscarServicio = (texto) => { setQSrv(texto); setPagina(1); };
  const cambiarEstado = (v) => { setEstado(v); setPagina(1); };

  const hayFiltro = String(qSrvDeb || "").trim().length > 0 || estado !== "todos";
  const marcadosFiltrados = filtrados.filter((s) => selected.has(String(s.id))).length;
  const sinGuardar = selected.size !== original.size || [...selected].some((id) => !original.has(id));

  const save = async () => {
    if (!producto) return;
    setSaving(true);
    setMsg("");
    try {
      const { data } = await api.put(`/admin/sp/by-product/${producto.id}`, {
        serviceIds: Array.from(selected),
      });
      const added = Number(data?.added ?? 0);
      const removed = Number(data?.removed ?? 0);
      setOriginal(new Set(selected));
      setMsg(added || removed
        ? `Guardado: se agregó a ${added} servicio${added === 1 ? "" : "s"} y se quitó de ${removed}.`
        : "Guardado. No hubo cambios.");
    } catch {
      setMsg("No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  if (!producto) {
    return (
      <>
        <div className="toolbar">
          <input
            className="input" value={qProd} onChange={(e) => setQProd(e.target.value)}
            placeholder="Buscar insumo por nombre, código o ID…" aria-label="Buscar insumo"
          />
        </div>
        {prodMsg && <div className="state">{prodMsg}</div>}
        {cargando && <div className="state">Cargando servicios…</div>}
        <div className="list">
          {productos.length === 0 ? (
            <div className="state">Sin resultados</div>
          ) : productos.map((p) => (
            <div key={p.id} className="list-row">
              <div className="truncate">
                {p.name} <span className="muted">#{p.id}{p.code ? ` · ${p.code}` : ""}</span>
              </div>
              <button className="pill" onClick={() => elegirProducto(p)} disabled={cargando}>Elegir</button>
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="section-header">
        <div className="muted">
          Insumo seleccionado: <strong>{producto.name}</strong> (#{producto.id})
        </div>
        <div className="actions-row">
          <button className="btn ghost" onClick={() => setProducto(null)}>Cambiar insumo</button>
          <button className="btn primary" onClick={save} disabled={saving || !sinGuardar}>
            {saving ? "Guardando…" : sinGuardar ? "Guardar servicios" : "Sin cambios"}
          </button>
        </div>
        {msg && <div className="state">{msg}</div>}
      </div>

      <div className="toolbar sp-filtros">
        <input
          className="input" value={qSrv} onChange={(e) => buscarServicio(e.target.value)}
          placeholder="Filtrar servicios por nombre o número…" aria-label="Filtrar servicios"
        />
        <select className="input" value={estado} onChange={(e) => cambiarEstado(e.target.value)} aria-label="Estado del servicio">
          <option value="todos">Todos</option>
          <option value="asignados">Sólo los que lo llevan</option>
          <option value="sinAsignar">Sólo los que no lo llevan</option>
        </select>
      </div>

      <div className="sp-acciones">
        <button type="button" className="btn primary" onClick={marcarFiltrados}
          disabled={filtrados.length === 0 || marcadosFiltrados === filtrados.length}>
          {hayFiltro
            ? `Asignar a ${filtrados.length} servicio${filtrados.length === 1 ? "" : "s"} filtrado${filtrados.length === 1 ? "" : "s"}`
            : `Asignar a los ${filtrados.length} servicios`}
        </button>
        <button type="button" className="btn ghost" onClick={desmarcarFiltrados} disabled={marcadosFiltrados === 0}>
          {hayFiltro ? "Quitar de los filtrados" : "Quitar de todos"}
        </button>
        <span className="muted sp-contador">
          {marcadosFiltrados} de {filtrados.length} filtrados · <strong>{selected.size}</strong> servicios en total
        </span>
      </div>

      <div className="muted sp-aviso">
        {sinGuardar
          ? <strong>Tenés cambios sin guardar: tocá “Guardar servicios”.</strong>
          : "Los cambios se aplican cuando tocás “Guardar servicios”."}
      </div>

      <div className="table like">
        <div className="t-head">
          <div style={{ flex: 6 }}>Servicio</div>
          <div style={{ width: 120, textAlign: "right" }}>Lo lleva</div>
        </div>

        {visibles.length === 0 ? (
          <div className="state">Ningún servicio coincide con el filtro</div>
        ) : visibles.map((s) => (
          <label key={s.id} className="t-row" style={{ cursor: "pointer" }}>
            <div style={{ flex: 6, minWidth: 0 }}>
              <div className="truncate">{s.name} <span className="muted">#{s.id}</span></div>
            </div>
            <div style={{ width: 120, textAlign: "right" }}>
              <input
                type="checkbox" checked={selected.has(String(s.id))}
                onChange={() => toggle(s.id)} aria-label={`Asignar a ${s.name}`}
              />
            </div>
          </label>
        ))}
      </div>

      {filtrados.length > SERVICIOS_POR_PAGINA && (
        <div className="sp-paginado">
          <button className="btn ghost" onClick={() => setPagina((p) => Math.max(1, p - 1))}
            disabled={paginaActual <= 1} aria-label="Página anterior">‹ Anterior</button>
          <span className="muted">
            Mostrando {desde + 1}–{Math.min(desde + SERVICIOS_POR_PAGINA, filtrados.length)} de {filtrados.length}
            {" · "}Página {paginaActual} de {paginas}
          </span>
          <button className="btn ghost" onClick={() => setPagina((p) => Math.min(paginas, p + 1))}
            disabled={paginaActual >= paginas} aria-label="Página siguiente">Siguiente ›</button>
        </div>
      )}
    </>
  );
}

/* Se define una sola vez: qué insumo es de limpieza y cuál descartable.
   Después cada servicio sólo dice si lleva uno, el otro, los dos o ninguno. */
function GruposInsumosSection() {
  const [productos, setProductos] = useState([]);
  const [cats, setCats] = useState([]);
  const [limpieza, setLimpieza] = useState(new Set());
  const [descartables, setDescartables] = useState(new Set());
  const [inicial, setInicial] = useState({ limpieza: new Set(), descartables: new Set() });
  const [q, setQ] = useState("");
  const qDeb = useDebounced(q, 300);
  const [categoria, setCategoria] = useState("todas");
  const [estado, setEstado] = useState("todos");
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [{ data: prods }, { data: cs }, { data: gs }] = await Promise.all([
        api.get("/admin/products", { params: { q: "", limit: 500 } }),
        api.get("/catalog/categories"),
        api.get("/admin/insumo-grupos"),
      ]);
      setProductos(Array.isArray(prods) ? prods : []);
      setCats(Array.isArray(cs) ? cs : []);
      const l = new Set((gs?.grupos?.limpieza || []).map(String));
      const d = new Set((gs?.grupos?.descartables || []).map(String));
      setLimpieza(l);
      setDescartables(d);
      setInicial({ limpieza: new Set(l), descartables: new Set(d) });
      setMsg("");
    } catch (e) {
      setMsg(e?.response?.data?.error || "No se pudieron cargar los insumos");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const enAlgunGrupo = (id) => limpieza.has(String(id)) || descartables.has(String(id));

  const filas = useMemo(() => {
    const term = norm(String(qDeb || "").trim());
    return productos.filter((p) => {
      if (categoria !== "todas" && String(p?.categoryId ?? "") !== String(categoria)) return false;
      if (estado === "sinGrupo" && enAlgunGrupo(p.id)) return false;
      if (estado === "conGrupo" && !enAlgunGrupo(p.id)) return false;
      if (!term) return true;
      return norm(String(p?.name ?? "")).includes(term)
        || String(p?.id ?? "").includes(term)
        || norm(String(p?.code ?? "")).includes(term);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productos, qDeb, categoria, estado, limpieza, descartables]);

  const alternar = (grupo, id) => {
    const setear = grupo === "limpieza" ? setLimpieza : setDescartables;
    setear((prev) => {
      const s = new Set(prev);
      const k = String(id);
      if (s.has(k)) s.delete(k); else s.add(k);
      return s;
    });
  };

  const marcarVisibles = (grupo) => {
    const setear = grupo === "limpieza" ? setLimpieza : setDescartables;
    setear((prev) => {
      const s = new Set(prev);
      for (const p of filas) s.add(String(p.id));
      return s;
    });
  };
  const desmarcarVisibles = (grupo) => {
    const setear = grupo === "limpieza" ? setLimpieza : setDescartables;
    setear((prev) => {
      const s = new Set(prev);
      for (const p of filas) s.delete(String(p.id));
      return s;
    });
  };

  const distintos = (a, b) => a.size !== b.size || [...a].some((x) => !b.has(x));
  const sinGuardar = distintos(limpieza, inicial.limpieza) || distintos(descartables, inicial.descartables);
  const sinGrupo = productos.filter((p) => !enAlgunGrupo(p.id)).length;

  const guardar = async () => {
    setGuardando(true);
    setMsg("");
    try {
      // Se guarda grupo por grupo; el servidor rehace los servicios marcados.
      const r1 = await api.put("/admin/insumo-grupos/limpieza", { productIds: [...limpieza] });
      const r2 = await api.put("/admin/insumo-grupos/descartables", { productIds: [...descartables] });
      setInicial({ limpieza: new Set(limpieza), descartables: new Set(descartables) });
      const tocados = Number(r2?.data?.recalculo?.servicios ?? r1?.data?.recalculo?.servicios ?? 0);
      setMsg(tocados
        ? `Guardado. Se actualizaron los insumos de ${tocados} servicio${tocados === 1 ? "" : "s"} ya marcado${tocados === 1 ? "" : "s"}.`
        : "Guardado. Todavía no hay servicios marcados, así que no cambió ninguno.");
    } catch (e) {
      setMsg(e?.response?.data?.error || "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <section className="srv-card" aria-labelledby="gi-heading">
      <h3 id="gi-heading">Grupos de insumos</h3>

      <p className="muted gi-intro">
        Marcá una sola vez qué insumos son de <strong>limpieza</strong> y cuáles <strong>descartables</strong>.
        Después, en cada servicio alcanza con decir si lleva uno, el otro, los dos o ninguno, y la lista se arma sola.
        Un insumo puede estar en los dos grupos, o en ninguno.
      </p>

      {cargando ? <div className="state">Cargando…</div> : (
        <>
          <div className="section-header">
            <div className="muted">
              <strong>{limpieza.size}</strong> de limpieza · <strong>{descartables.size}</strong> descartables
              {sinGrupo > 0 && <> · <strong>{sinGrupo}</strong> sin grupo</>}
            </div>
            <div className="actions-row">
              <button className="btn primary" onClick={guardar} disabled={guardando || !sinGuardar}>
                {guardando ? "Guardando…" : sinGuardar ? "Guardar grupos" : "Sin cambios"}
              </button>
            </div>
            {msg && <div className="state">{msg}</div>}
          </div>

          <div className="toolbar sp-filtros">
            <input
              className="input" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar insumo (nombre, código o ID)…" aria-label="Buscar insumo"
            />
            <select className="input" value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoría">
              <option value="todas">Todas las categorías</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="input" value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Estado del insumo">
              <option value="todos">Todos</option>
              <option value="sinGrupo">Sólo los que no tienen grupo</option>
              <option value="conGrupo">Sólo los que ya tienen</option>
            </select>
          </div>

          <div className="sp-acciones">
            <span className="muted">Con lo que se ve ({filas.length}):</span>
            <button type="button" className="btn ghost" onClick={() => marcarVisibles("limpieza")} disabled={!filas.length}>
              Todos a limpieza
            </button>
            <button type="button" className="btn ghost" onClick={() => desmarcarVisibles("limpieza")} disabled={!filas.length}>
              Sacar de limpieza
            </button>
            <button type="button" className="btn ghost" onClick={() => marcarVisibles("descartables")} disabled={!filas.length}>
              Todos a descartables
            </button>
            <button type="button" className="btn ghost" onClick={() => desmarcarVisibles("descartables")} disabled={!filas.length}>
              Sacar de descartables
            </button>
          </div>

          <div className="muted sp-aviso">
            {sinGuardar
              ? <strong>Tenés cambios sin guardar: tocá “Guardar grupos”.</strong>
              : "Al guardar se rehacen los insumos de todos los servicios ya marcados."}
          </div>

          <div className="table like">
            <div className="t-head">
              <div style={{ flex: 4 }}>Insumo</div>
              <div style={{ flex: 2 }}>Código</div>
              <div style={{ width: 110, textAlign: "center" }}>Limpieza</div>
              <div style={{ width: 130, textAlign: "center" }}>Descartable</div>
            </div>

            {filas.length === 0 ? (
              <div className="state">Ningún insumo coincide con el filtro</div>
            ) : filas.map((p) => (
              <div key={p.id} className="t-row">
                <div style={{ flex: 4, minWidth: 0 }}>
                  <div className="truncate">{p.name} <span className="muted">#{p.id}</span></div>
                </div>
                <div style={{ flex: 2 }}>{p.code ?? "—"}</div>
                <div style={{ width: 110, textAlign: "center" }}>
                  <input
                    type="checkbox" checked={limpieza.has(String(p.id))}
                    onChange={() => alternar("limpieza", p.id)}
                    aria-label={`${p.name} es de limpieza`}
                  />
                </div>
                <div style={{ width: 130, textAlign: "center" }}>
                  <input
                    type="checkbox" checked={descartables.has(String(p.id))}
                    onChange={() => alternar("descartables", p.id)}
                    aria-label={`${p.name} es descartable`}
                  />
                </div>
              </div>
            ))}
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

function FlexxusMatchSection() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const qDeb = useDebounced(q, 300);
  const [estado, setEstado] = useState("todos");

  const ESTADO_LABELS = {
    ok: { label: "OK", color: "#166534", bg: "#dcfce7" },
    pendiente_flexxus: { label: "Esperando datos de Flexxus", color: "#475569", bg: "#f1f5f9" },
    nombre_no_coincide: { label: "Nombre no coincide", color: "#7c3aed", bg: "#f3e8ff" },
    stock_no_coincide: { label: "Stock no coincide", color: "#b45309", bg: "#fef3c7" },
    no_encontrado: { label: "Ya no existe en Kazaro", color: "#6b7280", bg: "#f3f4f6" },
  };

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const { data } = await api.get("/admin/flexxus/match", {
        params: { q: String(qDeb || "").trim(), estado },
      });
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || "No se pudo cargar el matcheo");
    } finally {
      setLoading(false);
    }
  }, [qDeb, estado]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    setErr("");
    setMsg("");
    try {
      const { data } = await api.post("/admin/flexxus/match/refresh");
      const summary = (data?.summary || [])
        .map((s) => `${ESTADO_LABELS[s.estado]?.label || s.estado}: ${s.total}`)
        .join(" · ");
      setMsg(`Matcheo actualizado (${data?.total ?? 0} códigos). ${summary}`);
      await load();
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || "No se pudo actualizar el matcheo");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section className="srv-card" aria-labelledby="flexxus-heading">
      <div className="section-header">
        <h3 id="flexxus-heading">Flexxus — matcheo de stock (Kazaro)</h3>
        <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "#6b7280" }}>
          Lista los productos de Kazaro con su código y stock actuales, listos para comparar contra Flexxus cuando exista la API
          (columnas flexxus_sku / flexxus_name / flexxus_stock, hoy vacías). Se actualiza solo cada 3hs (lun-vie, 8 a 20hs) — el
          botón sirve para forzar una actualización al toque. Pazar va a tener su propio cuadro más adelante.
        </p>
      </div>

      <div className="toolbar">
        <input
          className="input"
          placeholder="Buscar por código o nombre…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Buscar en el matcheo"
        />
        <select
          className="select"
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
          aria-label="Filtrar por estado"
        >
          <option value="todos">— Todos los estados —</option>
          {Object.entries(ESTADO_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        <button className="btn primary" onClick={refresh} disabled={refreshing}>
          {refreshing ? "Actualizando…" : "Actualizar matcheo"}
        </button>
      </div>

      {(msg || err) && (
        <div className={`state ${err ? "error" : "success"}`} role={err ? "alert" : "status"}>
          {err || msg}
        </div>
      )}

      {loading ? (
        <div className="state">Cargando…</div>
      ) : rows.length === 0 ? (
        <div className="state">Sin resultados. Probá "Actualizar matcheo" si es la primera vez.</div>
      ) : (
        <div className="table like" role="table" aria-label="Matcheo de stock Kazaro vs Flexxus">
          <div className="t-head" role="row">
            <div style={{ flex: 2 }}>Código</div>
            <div style={{ flex: 3 }}>Kazaro (app)</div>
            <div style={{ flex: 3 }}>Flexxus</div>
            <div style={{ flex: 2 }}>Estado</div>
          </div>

          {rows.map((r) => {
            const est = ESTADO_LABELS[r.estado] || { label: r.estado, color: "#374151", bg: "#f3f4f6" };
            return (
              <div key={r.id} className="t-row" role="row">
                <div style={{ flex: 2, fontWeight: 600 }}>{r.code}</div>
                <div style={{ flex: 3, minWidth: 0 }}>
                  {r.product_name ? (
                    <>
                      <div className="truncate">{r.product_name}</div>
                      <div className="muted">Stock: {r.app_stock ?? "—"}</div>
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </div>
                <div style={{ flex: 3, minWidth: 0 }}>
                  {r.flexxus_name || r.flexxus_stock != null ? (
                    <>
                      <div className="truncate">{r.flexxus_name || "—"}</div>
                      <div className="muted">Stock: {r.flexxus_stock ?? "—"}</div>
                    </>
                  ) : (
                    <span className="muted">Sin datos todavía</span>
                  )}
                </div>
                <div style={{ flex: 2 }}>
                  <span
                    className="pill"
                    style={{ background: est.bg, color: est.color, cursor: "default" }}
                  >
                    {est.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
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
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  // Filtros. desde/hasta son días argentinos; el backend los convierte al
  // rango UTC correcto (el día argentino arranca a las 03:00 UTC).
  const [q, setQ] = useState("");
  const [servicioId, setServicioId] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [servicios, setServicios] = useState([]);
  const [page, setPage] = useState(1);
  const LIMIT = 50;

  const [abiertos, setAbiertos] = useState(() => new Set());

  const [selectedOrder, setSelectedOrder] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState("");

  const load = useCallback(async () => {
    setErr("");
    setLoading(true);
    try {
      const { data } = await api.get("/admin/pedidos", {
        params: {
          q: q.trim() || undefined,
          servicioId: servicioId || undefined,
          desde: desde || undefined,
          hasta: hasta || undefined,
          page,
          limit: LIMIT,
        },
        withCredentials: true,
      });
      setOrders(Array.isArray(data?.pedidos) ? data.pedidos : []);
      setTotal(Number(data?.total || 0));
    } catch (e) {
      console.error("No se pudieron cargar los pedidos", e);
      setErr("No se pudieron cargar los pedidos");
      setOrders([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [q, servicioId, desde, hasta, page]);

  useEffect(() => {
    let vivo = true;
    api.get("/admin/pedidos/servicios", { withCredentials: true })
      .then(({ data }) => { if (vivo) setServicios(Array.isArray(data) ? data : []); })
      .catch(() => { if (vivo) setServicios([]); });
    return () => { vivo = false; };
  }, []);

  const limpiarFiltros = () => {
    setQ(""); setServicioId(""); setDesde(""); setHasta(""); setPage(1);
  };

  const toggleDetalle = (id) => {
    setAbiertos((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  };

  const exportarCsv = () => {
    const cab = ["Pedido", "Fecha y hora", "Servicio", "Solicitante", "Estado",
                 "Codigo", "Insumo", "Cantidad pedida", "Devuelto", "Cantidad neta",
                 "Precio unitario", "Subtotal", "Total del pedido"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    // Los importes y cantidades van SIN comillas y con coma decimal, para que
    // Excel en español los lea como números (con punto los toma como miles).
    const filas = [cab.map(esc).join(";")];
    for (const p of orders) {
      const base = [p.numero, p.fechaAr, p.servicio?.nombre ?? "(sin servicio)", p.solicitante, p.estado].map(esc);
      if (!p.items?.length) {
        filas.push([...base, "", "", "", "", "", "", "", csvNumber(p.total)].join(";"));
      } else {
        for (const i of p.items) {
          filas.push([
            ...base,
            esc(i.codigo ?? ""),
            esc(i.nombre),
            csvNumber(i.cantidadOriginal ?? i.cantidad),
            csvNumber(i.devuelto ?? 0),
            csvNumber(i.cantidad),
            csvNumber(i.precio),
            csvNumber(i.subtotal),
            csvNumber(p.total),
          ].join(";"));
        }
      }
    }
    const blob = new Blob(["﻿" + filas.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pedidos_${desde || "inicio"}_a_${hasta || "hoy"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
const onDeleteOrder = useCallback(async (o) => {
    if (!window.confirm(`¿Eliminar el pedido #${String(o.id).padStart(7, "0")}? Se ocultará del listado y los reportes (recuperable).`)) return;
    try {
      await api.delete(`/admin/orders/${o.id}`, { withCredentials: true });
      setOrders((prev) => prev.filter((x) => x.id !== o.id));
    } catch (e) {
      alert("No se pudo eliminar el pedido");
      console.error("delete order error:", e);
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

  // La fecha ya viene formateada en hora argentina desde el backend (campo
  // fechaAr). Antes acá se reparseaba asumiendo que la base guardaba hora
  // local y se le sumaban 3 horas, el mismo error que tenían los remitos.

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
      <div className="section-header">
        <h3 id="orders-heading">Pedidos</h3>

        <div className="toolbar">
          <input
            className="input"
            placeholder="Buscar por servicio, insumo, código o nota…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            onKeyDown={(e) => { if (e.key === "Enter") load(); }}
            aria-label="Buscar pedidos"
          />

          <select
            className="select"
            value={servicioId}
            onChange={(e) => { setServicioId(e.target.value); setPage(1); }}
            aria-label="Filtrar por servicio"
          >
            <option value="">— Todos los servicios —</option>
            {servicios.map((s) => (
              <option key={s.id} value={String(s.id)}>{s.nombre} ({s.pedidos})</option>
            ))}
          </select>

          <label className="select-row" style={{ minWidth: 0 }}>
            <span className="muted">Desde</span>
            <input type="date" className="select" value={desde}
              onChange={(e) => { setDesde(e.target.value); setPage(1); }} />
          </label>

          <label className="select-row" style={{ minWidth: 0 }}>
            <span className="muted">Hasta</span>
            <input type="date" className="select" value={hasta}
              onChange={(e) => { setHasta(e.target.value); setPage(1); }} />
          </label>

          <button className="btn" type="button" onClick={load} disabled={loading}>
            {loading ? "Buscando…" : "Buscar"}
          </button>
          <button className="btn ghost" type="button" onClick={limpiarFiltros}>
            Limpiar filtros
          </button>
          <button className="btn" type="button" onClick={exportarCsv} disabled={!orders.length}>
            Exportar CSV
          </button>
        </div>

        <div className="hint">
          {loading ? "Cargando…" : `${total} pedido${total === 1 ? "" : "s"}`}
          {total > LIMIT && ` · mostrando ${orders.length} (página ${page} de ${Math.ceil(total / LIMIT)})`}
        </div>
      </div>

      {err && <div className="state error">{err}</div>}

      <div className="table like">
        <div className="t-head">
          <div style={{ width: 34 }} />
          <div style={{ width: 88 }}>Pedido</div>
          <div style={{ width: 140 }}>Fecha y hora</div>
          <div style={{ flex: 2.6 }}>Servicio</div>
          <div style={{ flex: 1.2 }}>Solicitante</div>
          <div style={{ width: 70, textAlign: "right" }}>Ítems</div>
          <div style={{ width: 110, textAlign: "right" }}>Total</div>
          <div style={{ width: 190 }} />
        </div>

        {!loading && !orders.length && (
          <div className="t-row"><div className="muted">No hay pedidos con esos filtros.</div></div>
        )}

        {orders.map((o) => (
          <Fragment key={o.id}>
            <div className="t-row">
              <div style={{ width: 34 }}>
                <button
                  className="pill"
                  style={{ padding: "2px 8px" }}
                  onClick={() => toggleDetalle(o.id)}
                  aria-expanded={abiertos.has(o.id)}
                  aria-label={abiertos.has(o.id) ? "Ocultar insumos" : "Ver insumos"}
                  title={abiertos.has(o.id) ? "Ocultar insumos" : "Ver insumos"}
                >
                  {abiertos.has(o.id) ? "−" : "+"}
                </button>
              </div>
              <div style={{ width: 88, fontVariantNumeric: "tabular-nums" }}>{o.numero}</div>
              <div style={{ width: 140, fontVariantNumeric: "tabular-nums" }}>{o.fechaAr}</div>
              {/* El nombre del servicio se muestra completo: los nombres son largos
                  y antes se cortaban con "…" al forzarlos a una sola línea. */}
              <div style={{ flex: 2.6 }} className="servicio-cell" title={o.servicio?.nombre || ""}>
                {o.servicio?.nombre || <span className="muted">Sin servicio ({o.rol || "—"})</span>}
              </div>
              <div style={{ flex: 1.2 }} className="servicio-cell">{o.solicitante || "—"}</div>
              <div style={{ width: 70, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {o.cantidadItems}
              </div>
              <div style={{ width: 110, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {o.total == null ? "—" : money(o.total)}
                {o.tuvoDevolucion && (
                  <div title={`Tuvo devolución: se descontaron ${money(o.montoDevuelto)} del total pedido (${money(o.totalOriginal)})`}
                    style={{ fontSize: "0.7rem", color: "#b45309", fontWeight: 600 }}>
                    ↩ con devolución
                  </div>
                )}
              </div>
              <div style={{ width: 190, display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <button
                  className="pill"
                  onClick={() => onPreviewRemito(o)}
                  disabled={previewLoading && selectedOrder?.id === o.id}
                >
                  {previewLoading && selectedOrder?.id === o.id ? "Cargando…" : "Ver remito"}
                </button>
                <button className="pill danger" onClick={() => onDeleteOrder(o)}>
                  Eliminar
                </button>
              </div>
            </div>

            {abiertos.has(o.id) && (
              <div className="t-row" style={{ display: "block", background: "#f8fafc" }}>
                <div style={{ padding: "2px 0 6px 34px" }}>
                  <div className="t-head" style={{ padding: "6px 0", background: "transparent", borderBottom: "1px solid #e2e8f0" }}>
                    <div style={{ width: 110 }}>Código</div>
                    <div style={{ flex: 2 }}>Insumo</div>
                    <div style={{ width: 80, textAlign: "right" }}>Cantidad</div>
                    <div style={{ width: 110, textAlign: "right" }}>Precio unit.</div>
                    <div style={{ width: 120, textAlign: "right" }}>Subtotal</div>
                  </div>
                  {o.items.map((i, idx) => (
                    <div key={idx} style={{ display: "flex", gap: "0.5rem", padding: "6px 0", fontSize: "0.88rem" }}>
                      <div style={{ width: 110, fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: "0.8rem" }}>
                        {i.codigo || <span className="muted">—</span>}
                      </div>
                      <div style={{ flex: 2 }} className="truncate" title={i.nombre}>
                        {i.nombre}
                        {i.devuelto > 0 && (
                          <span style={{ marginLeft: 6, fontSize: "0.72rem", color: "#b45309", fontWeight: 600 }}>
                            ↩ devueltos {i.devuelto} de {i.cantidadOriginal}
                          </span>
                        )}
                      </div>
                      <div style={{ width: 80, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{i.cantidad}</div>
                      <div style={{ width: 110, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(i.precio)}</div>
                      <div style={{ width: 120, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(i.subtotal)}</div>
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: "0.5rem", padding: "8px 0 2px", borderTop: "1px solid #e2e8f0", fontWeight: 500 }}>
                    <div style={{ flex: 1 }}>{o.nota ? <span className="muted">Nota: {o.nota}</span> : null}</div>
                    <div style={{ width: 120, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(o.total)}</div>
                  </div>
                </div>
              </div>
            )}
          </Fragment>
        ))}

      </div>

      {total > LIMIT && (
        <div className="actions-row" style={{ justifyContent: "center", gap: 10, marginTop: 10 }}>
          <button className="btn ghost" type="button" disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}>
            ← Anterior
          </button>
          <span className="muted">Página {page} de {Math.ceil(total / LIMIT)}</span>
          <button className="btn ghost" type="button" disabled={page >= Math.ceil(total / LIMIT) || loading}
            onClick={() => setPage((p) => p + 1)}>
            Siguiente →
          </button>
        </div>
      )}

      {(selectedOrder || previewErr) && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="section-header">
            {selectedOrder ? (
              <div className="muted">
                Remito del pedido{" "}
                <strong>#{selectedOrder.numero ?? String(selectedOrder.id).padStart(7, "0")}</strong>
                {" — "}<strong>{selectedOrder.fechaAr}</strong>
                {selectedOrder.servicio?.nombre && <> — <strong>{selectedOrder.servicio.nombre}</strong></>}
                {selectedOrder.solicitante && <> — {selectedOrder.solicitante}</>}
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

  // Buscador y paginado: con cientos de servicios, la lista completa era
  // imposible de recorrer.
  const [q, setQ] = useState("");
  const [pagina, setPagina] = useState(1);
  const POR_PAGINA = 20;

  const filtrados = useMemo(() => {
    const t = norm(q);
    if (!t) return services;
    const digitos = t.replace(/\D/g, "");
    // Por nombre, sin importar acentos ni mayúsculas; y por número de id.
    return services.filter((s) => norm(s.name).includes(t) || (digitos && String(s.id).includes(digitos)));
  }, [services, q]);

  const paginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaActual = Math.min(pagina, paginas);
  const visibles = filtrados.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);

  // Volver a la primera página se hace en el momento en que corresponde: al
  // buscar y al recargar la lista. Con un useEffect que mirara services.length,
  // el reinicio llegaba tarde y podía pisar un clic en "Siguiente" hecho justo
  // cuando terminaba de cargar la lista.
  const buscar = (texto) => { setQ(texto); setPagina(1); };

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErr("");
    setMsg("");
    try {
      const { data } = await api.get("/admin/services-all");
      setServices(Array.isArray(data) ? data : []);
      setPagina(1);
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
  const editService = async (s) => {
    const nuevo = window.prompt("Nuevo nombre del servicio:", s.name || "");
    if (nuevo === null) return;
    const name = nuevo.trim();
    if (!name) { alert("El nombre no puede estar vacío"); return; }
    setErr(""); setMsg("");
    try {
      await api.put(`/admin/services/${s.id}`, { name });
      setMsg("Servicio actualizado.");
      await loadAll();
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudo actualizar el servicio");
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

        <label className="btn" style={{ cursor: "pointer" }}>
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

      {/* Buscar dentro de los servicios ya cargados: responde al instante. */}
      <div className="toolbar" style={{ gap: 10, marginTop: 10 }}>
        <input
          className="input"
          type="search"
          style={{ flex: 1, minWidth: 220, maxWidth: 420 }}
          placeholder="Buscar servicio por nombre o número…"
          value={q}
          onChange={(e) => buscar(e.target.value)}
          aria-label="Buscar servicio"
        />
        <span className="muted" style={{ fontSize: "0.84rem" }}>
          {q.trim()
            ? `${filtrados.length} de ${services.length} servicios`
            : `${services.length} servicio${services.length === 1 ? "" : "s"}`}
        </span>
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

          {visibles.length === 0 ? (
            <div className="t-row">
              <div style={{ flex: 1 }}>—</div>
              <div style={{ flex: 6 }}>
                {q.trim() ? `Ningún servicio coincide con “${q.trim()}”` : "Sin servicios"}
              </div>
            </div>
          ) : (
            visibles.map((s) => (
              <div key={String(s.id)} className="t-row">
                <div style={{ flex: 2 }} className="mono">
                  {s.id}
                </div>
                <div style={{ flex: 6 }}>{s.name}</div>

                <div style={{ width: 200, display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button
                    className="pill"
                    onClick={() => editService(s)}
                    aria-label={`Editar servicio ${s.name}`}
                  >
                    Editar
                  </button>
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

          {paginas > 1 && (
            <div className="t-row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <span className="muted" style={{ fontSize: "0.84rem" }}>
                Mostrando {(paginaActual - 1) * POR_PAGINA + 1}–
                {Math.min(paginaActual * POR_PAGINA, filtrados.length)} de {filtrados.length}
              </span>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button type="button" className="pill" onClick={() => setPagina((p) => Math.max(1, p - 1))}
                  disabled={paginaActual === 1} aria-label="Página anterior">‹ Anterior</button>
                <span className="muted" style={{ fontSize: "0.84rem" }}>
                  Página {paginaActual} de {paginas}
                </span>
                <button type="button" className="pill" onClick={() => setPagina((p) => Math.min(paginas, p + 1))}
                  disabled={paginaActual === paginas} aria-label="Página siguiente">Siguiente ›</button>
              </span>
            </div>
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

  const niceCurrency = (n) => (n == null ? "—" : formatMoney(n));
  const niceNum = (n) => (n == null ? "—" : formatNumber(n));
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

    // Texto entre comillas; números sin comillas y con coma decimal, para que
    // Excel en español no los lea como separador de miles.
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const dataRows = vista === "resumen"
      ? rows.map(r => [esc(r.nombre||"—"), esc(r.codigo||"—"), esc(r.campo), csvNumber(r.total_cambios??0), csvNumber(r.valor_inicial??0), csvNumber(r.valor_final??0), csvNumber(r.total_aumentos??0), csvNumber(r.total_bajas??0), csvNumber(r.variacion_neta??0), esc(r.primer_cambio||"—"), esc(r.ultimo_cambio||"—")])
      : rows.map(r => [esc(r.fecha), esc(r.product_name||"—"), esc(r.product_code||"—"), esc(r.campo), esc(r.tipo), csvNumber(r.valor_anterior??0), csvNumber(r.valor_nuevo??0), csvNumber(r.diferencia??0), esc(r.usuario||"—")]);

    const csv = [headers.map(esc), ...dataRows].map(row => row.join(";")).join("\n");
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
                    <div style={{ fontSize:"0.78rem", color:"#4b5563" }}>{r.product_code || "—"}</div>
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
                    <div style={{ fontSize:"0.78rem", color:"#4b5563" }}>{r.codigo || "—"}</div>
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
        <p style={{ fontSize:"0.78rem", color:"#4b5563", marginTop:"0.75rem", textAlign:"right" }}>
          {rows.length} registro{rows.length !== 1 ? "s" : ""} mostrado{rows.length !== 1 ? "s" : ""}
        </p>
      )}
    </section>
  );
}

// Navegación del panel. Los items con `id` cambian de sección acá dentro; los
// que tienen `to` llevan a una página aparte. Los ids son los mismos de antes
// para no romper el deep-link con ?tab=.
const NAV_GROUPS = [
  {
    title: "Inventario",
    items: [
      { id: "products",      label: "Productos" },
      { id: "stockCritico",  label: "Stock crítico" },
      { id: "incomingStock", label: "Ingresos programados" },
      { id: "flexxus",       label: "Flexxus" },
    ],
  },
  {
    title: "Servicios",
    items: [
      { id: "services",        label: "Asignar servicios" },
      { id: "createService",   label: "Crear servicio" },
      { id: "serviceProducts", label: "Servicio ↔ Productos" },
      { id: "insumoGrupos",    label: "Grupos de insumos" },
      { id: "clasificar",      label: "Clasificar servicios" },
      { id: "massReassign",    label: "Reasignación masiva" },
    ],
  },
  {
    title: "Operación",
    items: [
      { id: "orders",    label: "Pedidos" },
      { id: "control",   label: "Control de pedidos" },
      { id: "historial", label: "Historial" },
      { to: "/admin/budgets", icon: "budgets", label: "Presupuestos" },
      { to: "/reports",       icon: "reports", label: "Informes" },
    ],
  },
  {
    title: "Accesos",
    items: [
      { id: "employees", label: "Empleados" },
      { id: "twofa",     label: "Seguridad" },
    ],
  },
];

// Secciones que no se están usando y se sacaron del menú (15/09/2026).
// El código de cada una queda intacto: para volver a mostrarlas, alcanza con
// borrarlas de esta lista. Mientras tanto siguen alcanzables a mano, con
// ?tab=<id> en la dirección, por si hace falta entrar una vez.
const NAV_OCULTOS = new Set(["stockCritico", "incomingStock", "historial", "twofa"]);

const NAV_VISIBLE = NAV_GROUPS
  .map((g) => ({ ...g, items: g.items.filter((i) => !i.id || !NAV_OCULTOS.has(i.id)) }))
  .filter((g) => g.items.length > 0);

const NAV_ICONS = {
  products:        ["M21 8 12 3 3 8v8l9 5 9-5Z", "M3 8l9 5 9-5M12 13v8"],
  stockCritico:    ["M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z", "M12 9v4M12 17h.01"],
  incomingStock:   ["M3 7h11v9H3zM14 10h4l3 3v3h-7z", "M7 20a2 2 0 1 1 0-4 2 2 0 0 1 0 4M17 20a2 2 0 1 1 0-4 2 2 0 0 1 0 4"],
  flexxus:         ["M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3"],
  services:        ["M2.5 20a6.5 6.5 0 0 1 13 0M17 11h5M19.5 8.5V14", "M9 4.8a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4"],
  createService:   ["M12 5v14M5 12h14"],
  serviceProducts: ["M4 6h7M4 12h7M4 18h7M15 6h5M15 12h5M15 18h5"],
  insumoGrupos: ["M4 7h16M4 12h10M4 17h6", "M18 14l2 2 3-3"],
  clasificar: ["M4 5h16M4 12h16M4 19h16", "M9 5v14"],
  massReassign:    ["M4 8h13l-3-3M20 16H7l3 3"],
  orders:          ["M9 4h6v3H9zM7 5H5v15h14V5h-2M9 12h6M9 16h4"],
  historial:       ["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 4v4h4M12 7v5l3 2"],
  budgets:         ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z", "M14 3v5h5M9 13h6M9 17h4"],
  reports:         ["M4 20V10M10 20V4M16 20v-7M22 20H2"],
  employees:       ["M3 5h18v14H3z", "M9 8.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4M5.8 16.5a3.6 3.6 0 0 1 6.4 0M15 10h4M15 14h3"],
  twofa:           ["M4 10h16v10H4z", "M8 10V7a4 4 0 0 1 8 0v3"],
};

function NavIcon({ name }) {
  const paths = NAV_ICONS[name] || [];
  return (
    <svg className="admin-side-ico" viewBox="0 0 24 24" aria-hidden="true">
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

// Control de pausa de mails (para pruebas). La pausa se reanuda sola al vencer.
function MailPauseControl() {
  const [estado, setEstado] = useState({ paused: false, minutosRestantes: 0 });
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/mail-pause");
      setEstado(data || { paused: false, minutosRestantes: 0 });
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => {
    cargar();
    // Refresca cada 30s para que el contador y el auto-reanudado se reflejen.
    const t = setInterval(cargar, 30000);
    return () => clearInterval(t);
  }, [cargar]);

  const pausar = async (minutos) => {
    setBusy(true);
    try { const { data } = await api.post("/admin/mail-pause", { minutos }); setEstado(data); }
    catch (e) { alert(e?.response?.data?.error || "No se pudo pausar"); }
    finally { setBusy(false); }
  };

  const reanudar = async () => {
    setBusy(true);
    try { const { data } = await api.post("/admin/mail-resume"); setEstado(data); }
    catch { alert("No se pudo reanudar"); }
    finally { setBusy(false); }
  };

  if (estado.paused) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 999, padding: "4px 6px 4px 14px" }}>
        <span style={{ fontSize: "0.85rem", color: "#92400e", fontWeight: 600 }}>
            Mails en pausa · {estado.minutosRestantes} min
        </span>
        <button type="button" className="pill" onClick={reanudar} disabled={busy}
          style={{ background: "#16a34a", borderColor: "#15803d", color: "#fff" }}>
          Reanudar
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>Pausar mails:</span>
      {[["30 min", 30], ["2 h", 120], ["4 h", 240]].map(([lbl, min]) => (
        <button key={min} type="button" className="pill pill--ghost" onClick={() => pausar(min)} disabled={busy}>
          {lbl}
        </button>
      ))}
    </div>
  );
}

export default function AdminPanel() {
  const nav = useNavigate();
  const { role } = useParams();
  const base = `/app/${role}`;
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
      <header className="page-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2>Panel de administración</h2>
        <MailPauseControl />
      </header>

      <div className="admin-shell">
        <nav className="admin-side" aria-label="Secciones de administración">
          {NAV_VISIBLE.map((grupo) => (
            <div className="admin-side-group" key={grupo.title}>
              <p className="admin-side-title">{grupo.title}</p>
              <ul>
                {grupo.items.map((item) =>
                  item.to ? (
                    <li key={item.to}>
                      {/* Presupuestos e Informes siguen siendo páginas aparte */}
                      <a
                        className="admin-side-link"
                        href={`${base}${item.to}`}
                        onClick={(e) => { e.preventDefault(); nav(`${base}${item.to}`); }}
                      >
                        <NavIcon name={item.icon} />
                        <span>{item.label}</span>
                      </a>
                    </li>
                  ) : (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`admin-side-link ${tab === item.id ? "is-active" : ""}`}
                        onClick={() => setTab(item.id)}
                        aria-current={tab === item.id ? "page" : undefined}
                      >
                        <NavIcon name={item.id} />
                        <span>{item.label}</span>
                      </button>
                    </li>
                  )
                )}
              </ul>
            </div>
          ))}
        </nav>

        <div className="admin-content">
          {tab === "stockCritico" && <StockCriticoSection />}
          {tab === "products" && <ProductsSection />}
          {tab === "services" && <AssignServicesSection />}
          {tab === "createService" && <CreateServiceSection />}
          {tab === "serviceProducts" && <ServiceProductsSection />}
          {tab === "insumoGrupos" && <GruposInsumosSection />}
          {tab === "clasificar" && <ClasificarServiciosSection />}
          {tab === "budgets" && <ServiceBudgetsSection />}
          {tab === "incomingStock" && <IncomingStockSection />}
          {tab === "massReassign" && <MassReassignServicesSection />}
          {tab === "orders" && <OrdersSection />}
          {tab === "control" && <ControlPedidosSection />}
          {tab === "historial" && <ProductHistorialSection />}
          {tab === "employees" && <EmployeesSection />}
          {tab === "twofa" && <TwoFactorSection />}
          {tab === "flexxus" && <FlexxusMatchSection />}
        </div>
      </div>
    </div>
  );
}
