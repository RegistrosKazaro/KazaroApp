// client/src/pages/Services.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { useCart } from "../hooks/useCart";
import "../styles/services.css";

const PER_PAGE = 15;

export default function ServicesPage() {
  const nav = useNavigate();
  const { user, loading: loadingUser } = useAuth();
  const { service, setService } = useCart();

  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // === Buscador ===
  const [q, setQ] = useState("");

  // 👉 Nombre a mostrar al lado de “Asignado”
  const assignedToName = useMemo(() => {
    // Intentamos armar "Nombre Apellido", sino fullName, sino username, sino "ID X"
    const composed =
      [user?.Nombre, user?.Apellido].filter(Boolean).join(" ").trim() ||
      user?.fullName ||
      user?.nombreCompleto ||
      user?.name;
    return composed || user?.username || `ID ${user?.id ?? ""}`;
  }, [user]);

  // Redirección si no es supervisor
  useEffect(() => {
    if (loadingUser) return;
    if (!user) {
      nav("/login", { replace: true });
      return;
    }
    const roles = (user?.roles || []).map((r) => String(r).toLowerCase());
    if (!roles.includes("supervisor")) {
      nav("/app/administrativo/products", { replace: true });
    }
  }, [user, loadingUser, nav]);

  // Cargar servicios del supervisor (asignados en la BD)
  useEffect(() => {
    if (loadingUser || !user) return;

    let alive = true;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const r = await api.get("/supervisor/services", { withCredentials: true });
        const rows = Array.isArray(r.data) ? r.data : [];

        if (!alive) return;

        setServices(rows);

        // auto-seleccionar el primero si no hay ninguno elegido
        if (rows.length && !service?.id) {
          setService({ id: rows[0].id, name: rows[0].name });
        }

        setLoading(false);
      } catch (e) {
        console.error("[services] error:", e);
        if (!alive) return;
        setErr("No se pudieron cargar tus servicios.");
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [user, loadingUser, setService, service?.id]);

  // Filtrado por nombre o ID
  const filtered = useMemo(() => {
    const term = String(q || "").trim().toLowerCase();
    if (!term) return services;
    return services.filter((it) => {
      const name = String(it?.name ?? "").toLowerCase();
      const idStr = String(it?.id ?? "").toLowerCase();
      return name.includes(term) || idStr.includes(term);
    });
  }, [q, services]);

  // Paginación
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const start = (page - 1) * PER_PAGE;
  const pageItems = filtered.slice(start, start + PER_PAGE);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
    if (page < 1) setPage(1);
  }, [filtered.length, page, pageCount]);

  useEffect(() => { setPage(1); }, [q]);

  const handlePick = (it) => setService({ id: it.id, name: it.name });
  const goNext = () => {
    if (!service?.id) return;
    nav("/app/supervisor/products");
  };

  const goFirst = () => setPage(1);
  const goPrev = () => setPage((p) => Math.max(1, p - 1));
  const goNextP = () => setPage((p) => Math.min(pageCount, p + 1));
  const goLast = () => setPage(pageCount);

  if (loadingUser) return <div className="state">Cargando…</div>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="catalog" style={{ maxWidth: 720, marginInline: "auto" }}>
      <h2>Seleccioná tu servicio</h2>

      {err && <div className="state error">{err}</div>}

      {loading ? (
        <div className="state">Cargando servicios…</div>
      ) : services.length ? (
        <>
          {/* Barra de búsqueda */}
          <div
            className="catalog-toolbar"
            style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}
          >
            <label htmlFor="serviceSearch" style={{ fontWeight: 700, color: "#000000" }}>
              Buscar
            </label>
            <input
              id="serviceSearch"
              className="input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nombre o ID del servicio…"
              autoComplete="off"
              style={{ flex: 1, maxWidth: 360 }}
            />
            {q && (
              <button
                type="button"
                className="pill pill--primary"
                onClick={() => setQ("")}
                aria-label="Limpiar búsqueda"
              >
                Limpiar
              </button>
            )}
          </div>

          {/* Resultados */}
          {filtered.length === 0 ? (
            <div className="state">
              No hay servicios que coincidan con “{q}”.
              <div style={{ marginTop: 8 }}>
                <button className="pill pill--primary" onClick={() => setQ("")}>
                  Ver todos
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="services-grid">
                {pageItems.map((it) => {
                  const selected = Number(service?.id) === Number(it.id);
                  // Si la API algún día devuelve assigned_to, lo usamos; si no, mostramos al usuario actual
                  const who = it.assigned_to || assignedToName;

                  return (
                    <button
                      key={String(it.id)}
                      className={`service-card${selected ? " selected" : ""}`}
                      onClick={() => handlePick(it)}
                      title={it.name}
                    >
                      <div className="service-card__row">
                        <div className="service-card__name">{it.name}</div>

                        {/* 👉 PILL: “Asignado a …” */}
                        <span className="pill pill--assigned" title={`Asignado a ${who}`}>
                          <strong>Asignado</strong>
                          <span className="pill__who">&nbsp;a {who}</span>
                        </span>
                      </div>

                      {selected && <small>Seleccionado</small>}
                    </button>
                  );
                })}
              </div>

              {/* Paginador */}
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: 12, opacity: 0.8 }}>
                  Mostrando {start + 1}-{Math.min(start + PER_PAGE, filtered.length)} de{" "}
                  {filtered.length}
                </span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button className="pill pill--primary" onClick={goFirst} disabled={page === 1}>
                    &laquo;
                  </button>
                  <button className="pill pill--primary" onClick={goPrev} disabled={page === 1}>
                    Anterior
                  </button>
                  <span style={{ padding: "4px 8px", fontSize: 16, color: "black" }}>
                    Página {page} / {pageCount}
                  </span>
                  <button
                    className="pill pill--primary"
                    onClick={goNextP}
                    disabled={page === pageCount}
                  >
                    Siguiente
                  </button>
                  <button
                    className="pill pill--primary"
                    onClick={goLast}
                    disabled={page === pageCount}
                  >
                    &raquo;
                  </button>
                </div>
              </div>
            </>
          )}

          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button className="btn" onClick={() => nav("/role-select")}>
              Cambiar modo (Administrativo / Supervisor)
            </button>
            <button className="btn" disabled={!service?.id} onClick={goNext}>
              Continuar al catálogo
            </button>
          </div>
        </>
      ) : (
        <div className="state">
          No tenés servicios asignados.
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
            (user.id={String(user?.id ?? "")} · user.username={String(user?.username ?? "")})
          </div>
        </div>
      )}

      {/* Estilos mínimos para el pill y fila — podés moverlos a services.css */}
      <style>{`
        .service-card__row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: .5rem;
        }
        .service-card__name {
          font-weight: 600;
          color: #0f172a;
          text-align: left;
        }
        .pill {
          border-radius: 999px;
          padding: .25rem .5rem;
          font-size: .75rem;
          line-height: 1;
          display: inline-flex;
          align-items: center;
          white-space: nowrap;
        }
        .pill--assigned {
          background: #eef2ff;
          color: #1d4ed8;
          border: 1px solid #c7d2fe;
        }
        .pill--primary {
          background: #ecfeff;
          color: #0369a1;
          border: 1px solid #bae6fd;
        }
        .pill__who { font-weight: 500; }
      `}</style>
    </div>
  );
}
  