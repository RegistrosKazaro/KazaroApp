import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE_URL =
  (typeof import.meta !== "undefined" && import.meta?.env?.VITE_API_URL) ||
  "http://localhost:4000";

const apiFetch = async (path, opts = {}) => {
  // Leer el token CSRF de la cookie
  const csrf = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("csrf_token="))
    ?.split("=")[1] ?? "";

  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": csrf,
      ...(opts.headers ?? {}),
    },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
};

// ── Roles disponibles en el sistema ──────────────────────────
const ROLES_CONOCIDOS = [
  { id: 1, nombre: "Admin" },
  { id: 2, nombre: "Administrativo" },
  { id: 3, nombre: "Encargado" },
  { id: 4, nombre: "Supervisor" },
  { id: 5, nombre: "Deposito" },
];

// ── Formulario vacío por defecto ──────────────────────────────
const EMPTY_FORM = {
  nombre: "",
  apellido: "",
  email: "",
  username: "",
  password: "",
  isActive: true,
  rolIds: [],
};

function badge(emp) {
  if (!emp.isActive) return { label: "Inactivo", color: "#b91c1c", bg: "#fee2e2" };
  if (emp.passwordPendiente) return { label: "Sin hash", color: "#92400e", bg: "#fef3c7" };
  if (!emp.tieneHash && !emp.tienePlain) return { label: "Sin clave", color: "#7c3aed", bg: "#ede9fe" };
  return { label: "OK", color: "#166534", bg: "#dcfce7" };
}

export default function EmployeesSection() {
  const [employees, setEmployees]     = useState([]);
  const [roles, setRoles]             = useState(ROLES_CONOCIDOS);
  const [loading, setLoading]         = useState(false);
  const [err, setErr]                 = useState("");
  const [msg, setMsg]                 = useState("");
  const [q, setQ]                     = useState("");

  // Panel de edición / creación
  const [editing, setEditing]         = useState(null);  // null | { mode:"create"|"edit", emp }
  const [form, setForm]               = useState(EMPTY_FORM);
  const [saving, setSaving]           = useState(false);
  const [formErr, setFormErr]         = useState("");
  const [showPass, setShowPass]       = useState(false);
  const firstInputRef                 = useRef(null);

  // ── Cargar datos ──────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const [empData, rolesData] = await Promise.all([
        apiFetch("/api/admin/employees"),
        apiFetch("/api/admin/roles").catch(() => ({ roles: ROLES_CONOCIDOS })),
      ]);
      setEmployees(empData.employees ?? []);
      if (rolesData.roles?.length) setRoles(rolesData.roles);
    } catch (e) {
      setErr(e.message || "Error al cargar empleados");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (msg) { const t = setTimeout(() => setMsg(""), 4000); return () => clearTimeout(t); } }, [msg]);

  // ── Filtro de búsqueda ────────────────────────────────────
  const norm = (v) =>
    String(v ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const filtered = employees.filter((e) => {
    if (!q.trim()) return true;
    const s = norm(q);
    return (
      norm(e.nombre).includes(s) ||
      norm(e.apellido).includes(s) ||
      norm(e.email).includes(s) ||
      norm(e.username).includes(s) ||
      String(e.id).includes(s)
    );
  });

  // ── Abrir formulario ──────────────────────────────────────
  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditing({ mode: "create" });
    setFormErr("");
    setShowPass(false);
    setTimeout(() => firstInputRef.current?.focus(), 60);
  };

  const openEdit = (emp) => {
    setForm({
      nombre:   emp.nombre,
      apellido: emp.apellido,
      email:    emp.email,
      username: emp.username,
      password: "",
      isActive: emp.isActive,
      rolIds:   emp.roles.map((r) => r.id),
    });
    setEditing({ mode: "edit", emp });
    setFormErr("");
    setShowPass(false);
    setTimeout(() => firstInputRef.current?.focus(), 60);
  };

  const closePanel = () => { setEditing(null); setFormErr(""); };

  // ── Cambios de form ───────────────────────────────────────
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const toggleRol = (id) => {
    setForm((f) => {
      const ids = f.rolIds.includes(id)
        ? f.rolIds.filter((x) => x !== id)
        : [...f.rolIds, id];
      return { ...f, rolIds: ids };
    });
  };

  // ── Guardar ───────────────────────────────────────────────
  const handleSave = async () => {
    setFormErr("");
    const { nombre, apellido, email, username, password, isActive, rolIds } = form;

    if (!nombre.trim())    return setFormErr("El nombre es obligatorio");
    if (!apellido.trim())  return setFormErr("El apellido es obligatorio");
    if (!username.trim())  return setFormErr("El username es obligatorio");
    if (!email.trim())     return setFormErr("El email es obligatorio");
    if (editing.mode === "create" && !password.trim())
      return setFormErr("La contraseña es obligatoria para empleados nuevos");
    if (rolIds.length === 0)
      return setFormErr("Asigná al menos un rol");

    setSaving(true);
    try {
      const payload = { nombre, apellido, email, username, isActive, rolIds };
      if (password.trim()) payload.password = password.trim();

      if (editing.mode === "create") {
        await apiFetch("/api/admin/employees", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setMsg("✓ Empleado creado correctamente");
      } else {
        await apiFetch(`/api/admin/employees/${editing.emp.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        setMsg("✓ Empleado actualizado correctamente");
      }
      closePanel();
      await load();
    } catch (e) {
      setFormErr(e.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  // ── Desactivar ────────────────────────────────────────────
  const handleDeactivate = async (emp) => {
    if (!window.confirm(`¿Desactivar a ${emp.nombre} ${emp.apellido}?`)) return;
    try {
      await apiFetch(`/api/admin/employees/${emp.id}`, { method: "DELETE" });
      setMsg("Empleado desactivado");
      await load();
    } catch (e) {
      setErr(e.message || "Error al desactivar");
    }
  };

  // ── Render ────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

      {/* ── Cabecera ── */}
      <div className="srv-card">
        <div className="section-header">
          <h3>Gestión de Empleados</h3>
          <p className="muted">
            Creá, editá o corregí accesos de empleados. Los cambios de contraseña se hashean con
            Argon2id automáticamente.
          </p>
        </div>

        <div className="toolbar">
          <input
            className="input"
            style={{ flex: 1, minWidth: 200, maxWidth: 360 }}
            placeholder="Buscar por nombre, apellido, email o username…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn primary" onClick={openCreate}>
            + Nuevo empleado
          </button>
          <button className="btn ghost" onClick={load} disabled={loading}>
            {loading ? "Cargando…" : "↻ Recargar"}
          </button>
        </div>

        {err && <div className="state error">{err}</div>}
        {msg && <div className="state success">{msg}</div>}

        {/* ── Tabla de empleados ── */}
        <div className="table like">
          <div className="t-head" style={{ gridTemplateColumns: "3rem 1fr 1fr 1fr 1fr 7rem 6rem", display:"grid" }}>
            <span>ID</span>
            <span>Nombre</span>
            <span>Email / Username</span>
            <span>Roles</span>
            <span>Estado</span>
            <span style={{ textAlign: "right" }}>Acciones</span>
          </div>

          {loading && (
            <div className="hint" style={{ padding: "1.2rem", textAlign: "center" }}>
              Cargando empleados…
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="hint" style={{ padding: "1.2rem", textAlign: "center" }}>
              {q ? "Sin resultados para esa búsqueda" : "No hay empleados registrados"}
            </div>
          )}

          {filtered.map((emp) => {
            const b = badge(emp);
            return (
              <div
                key={emp.id}
                className="t-row"
                style={{
                  gridTemplateColumns: "3rem 1fr 1fr 1fr 1fr 7rem 6rem",
                  display: "grid",
                  alignItems: "center",
                  opacity: emp.isActive ? 1 : 0.55,
                }}
              >
                <span className="muted">{emp.id}</span>

                <span style={{ fontWeight: 600 }}>
                  {emp.apellido}, {emp.nombre}
                </span>

                <span>
                  <div className="truncate" style={{ fontSize: "0.82rem" }}>{emp.email}</div>
                  <div className="muted">{emp.username}</div>
                </span>

                <span>
                  {emp.roles.length > 0
                    ? emp.roles.map((r) => r.nombre).join(", ")
                    : <span className="muted">Sin rol</span>
                  }
                </span>

                <span>
                  <span
                    style={{
                      background: b.bg,
                      color: b.color,
                      borderRadius: 999,
                      padding: "0.2rem 0.6rem",
                      fontSize: "0.78rem",
                      fontWeight: 600,
                    }}
                  >
                    {b.label}
                  </span>
                </span>

                <span />

                <span style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end" }}>
                  <button
                    className="pill"
                    title="Editar empleado"
                    onClick={() => openEdit(emp)}
                  >
                    ✏️ Editar
                  </button>
                  {emp.isActive && (
                    <button
                      className="pill danger"
                      title="Desactivar empleado"
                      onClick={() => handleDeactivate(emp)}
                    >
                      ✕
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Panel de creación / edición ── */}
      {editing && (
        <div className="srv-card" style={{ borderTop: "3px solid #1d4ed8" }}>
          <div className="section-header">
            <h3 style={{ color: "#1d4ed8" }}>
              {editing.mode === "create"
                ? "Nuevo Empleado"
                : `Editar — ${editing.emp.nombre} ${editing.emp.apellido} (ID ${editing.emp.id})`}
            </h3>
            {editing.mode === "edit" && (
              <p className="muted" style={{ fontSize: "0.82rem" }}>
                Dejá la contraseña vacía si no querés cambiarla. Solo completala si querés
                establecer una nueva clave.
              </p>
            )}
          </div>

          {formErr && <div className="state error">{formErr}</div>}

          <div className="grid-3" style={{ gap: "0.75rem" }}>
            {/* Nombre */}
            <div className="select-row">
              <label className="muted">Nombre *</label>
              <input
                ref={firstInputRef}
                className="input"
                value={form.nombre}
                onChange={(e) => setField("nombre", e.target.value)}
                placeholder="Ej: Juan"
                autoComplete="off"
              />
            </div>

            {/* Apellido */}
            <div className="select-row">
              <label className="muted">Apellido *</label>
              <input
                className="input"
                value={form.apellido}
                onChange={(e) => setField("apellido", e.target.value)}
                placeholder="Ej: Pereyra"
                autoComplete="off"
              />
            </div>

            {/* Email */}
            <div className="select-row">
              <label className="muted">Email *</label>
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={(e) => setField("email", e.target.value)}
                placeholder="juan.pereyra@kazaro.com.ar"
                autoComplete="off"
              />
            </div>

            {/* Username */}
            <div className="select-row">
              <label className="muted">Username *</label>
              <input
                className="input"
                value={form.username}
                onChange={(e) => setField("username", e.target.value.toLowerCase().replace(/\s/g, "."))}
                placeholder="juan.pereyra"
                autoComplete="off"
              />
            </div>

            {/* Contraseña */}
            <div className="select-row">
              <label className="muted">
                Contraseña {editing.mode === "create" ? "*" : "(dejar vacío para no cambiar)"}
              </label>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <input
                  className="input"
                  type={showPass ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => setField("password", e.target.value)}
                  placeholder={editing.mode === "edit" ? "Nueva contraseña…" : "Contraseña…"}
                  autoComplete="new-password"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn ghost"
                  style={{ padding: "0.35rem 0.6rem", minWidth: "unset" }}
                  onClick={() => setShowPass((v) => !v)}
                  title={showPass ? "Ocultar" : "Mostrar"}
                >
                  {showPass ? "🙈" : "👁"}
                </button>
              </div>
            </div>

            {/* Estado activo */}
            <div className="select-row">
              <label className="muted">Estado</label>
              <select
                className="select"
                value={form.isActive ? "1" : "0"}
                onChange={(e) => setField("isActive", e.target.value === "1")}
              >
                <option value="1">Activo</option>
                <option value="0">Inactivo</option>
              </select>
            </div>
          </div>

          {/* Roles */}
          <div style={{ marginTop: "0.5rem" }}>
            <div className="muted" style={{ marginBottom: "0.4rem" }}>
              Roles * (podés asignar más de uno)
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
              {roles.map((r) => {
                const sel = form.rolIds.includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => toggleRol(r.id)}
                    style={{
                      border: "none",
                      borderRadius: 999,
                      padding: "0.35rem 0.9rem",
                      fontSize: "0.85rem",
                      fontWeight: 600,
                      cursor: "pointer",
                      background: sel ? "#1d4ed8" : "#e0edff",
                      color: sel ? "#fff" : "#1e3a8a",
                      boxShadow: sel ? "0 4px 12px rgba(29,78,216,0.35)" : "none",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {sel ? "✓ " : ""}{r.nombre}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Botones de acción */}
          <div className="actions-row">
            <button className="btn ghost" onClick={closePanel} disabled={saving}>
              Cancelar
            </button>
            <button className="btn primary" onClick={handleSave} disabled={saving}>
              {saving
                ? "Guardando…"
                : editing.mode === "create"
                ? "Crear empleado"
                : "Guardar cambios"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}