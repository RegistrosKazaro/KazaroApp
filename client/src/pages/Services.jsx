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

  const [q, setQ] = useState("");

  const roles = useMemo(() => (user?.roles || []).map((r) => String(r).toLowerCase()), [user]);
  const isAdmin = roles.includes("admin");
  const isSupervisor = roles.includes("supervisor");

  // Permitir esta pantalla a supervisor **o** admin. Redirigir solo si no es ninguno.
  useEffect(() => {
    if (loadingUser) return;
    if (!user) {
      nav("/login", { replace: true });
      return;
    }
    if (!isSupervisor && !isAdmin) {
      nav("/app/administrativo/products", { replace: true });
    }
  }, [user, loadingUser, nav, isSupervisor, isAdmin]);

  // Carga de datos:
  // - Admin: /admin/services?q=...  (muestra Asignado / Disponible)
  // - Supervisor: /supervisor/services (sus servicios)
  useEffect(() => {
    if (loadingUser || !user) return;

    let alive = true;
    (async () => {
      setLoading(true);
      setErr("");

      try {
        let rows = [];
        if (isAdmin) {
          const r = await api.get("/admin/services", { params: { q: String(q || "").trim(), limit: 50 } });
          rows = Array.isArray(r.data) ? r.data : [];
        } else {
          const r = await api.get("/supervisor/services", { withCredentials: true });
          rows = Array.isArray(r.data) ? r.data : [];
        }

        if (!alive) return;
        setServices(rows);

        // auto-seleccionar el primero si no hay ninguno elegido (solo para supervisor)
        if (!isAdmin && rows.length && !service?.id) {
          setService({ id: rows[0].id, name: rows[0].name });
        }

        setLoading(false);
      } catch (e) {
        console.error("[services] error:", e);
        if (!alive) return;
        setErr("No se pudieron cargar los servicios.");
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [user, loadingUser, isAdmin, q, setService, service?.id]);

  // Filtrado por nombre o ID (sobre lo que ya trajo el endpoint)
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
    <div className="catalog" style={{ maxWidth: 920, marginInline: "auto" }}>
      <h2>{isAdmin ? "Servicios (Administrador)" : "Seleccioná tu servicio"}</h2>

      {err && <div className="state error">{err}</div>}

      {loading ? (
        <div className="state">Cargando servicios…</div>
      ) : (
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
              placeholder={isAdmin ? "Buscá servicios para asignar… (nombre o ID)" : "Nombre o ID del servicio…"}
              autoComplete="off"
              style={{ flex: 1, maxWidth: 420 }}
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
              {isAdmin
                ? "No hay resultados. Escribí arriba para buscar."
                : `No hay servicios que coincidan con “${q}”.`}
              {q && (
                <div style={{ marginTop: 8 }}>
                  <button className="pill pill--primary" onClick={() => setQ("")}>
                    Ver todos
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="services-grid">
                {pageItems.map((it) => {
                  const selected = Number(service?.id) === Number(it.id);

                  // ¿Está asignado?
                  const isAssigned =
                    isAdmin
                      ? (Number(it?.is_assigned) === 1 || !!it?.isAssigned)
                      : true; // en supervisor, todos los que ve están asignados a él

                  return (
                    <button
                      key={String(it.id)}
                      className={`service-card${selected ? " selected" : ""}`}
                      onClick={() => !isAdmin && handlePick(it)}
                      title={it.name}
                      disabled={isAdmin && isAssigned} // en admin, deshabilito si ya está asignado
                    >
                      <div className="service-card__row">
                        <div className="service-card__name">{it.name}</div>

                        {/* 👉 PILL sin nombre del supervisor */}
                        {isAssigned ? (
                          <span className="pill pill--assigned">
                            <strong>Asignado</strong>
                          </span>
                        ) : (
                          <span className="pill pill--free">Disponible</span>
                        )}
                      </div>

                      {!isAdmin && selected && <small>Seleccionado</small>}
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
                  Mostrando {start + 1}-{Math.min(start + PER_PAGE, filtered.length)} de {filtered.length}
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
                  <button className="pill pill--primary" onClick={goNextP} disabled={page === pageCount}>
                    Siguiente
                  </button>
                  <button className="pill pill--primary" onClick={goLast} disabled={page === pageCount}>
                    &raquo;
                  </button>
                </div>
              </div>
            </>
          )}

          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            {!isAdmin && (
              <>
                <button className="btn" onClick={() => nav("/role-select")}>
                  Cambiar modo (Administrativo / Supervisor)
                </button>
                <button className="btn" disabled={!service?.id} onClick={goNext}>
                  Continuar al catálogo
                </button>
              </>
            )}
            {isAdmin && (
              <button className="btn" onClick={() => nav("/app/administrativo/products")}>
                Ir a Productos (Admin)
              </button>
            )}
          </div>
        </>
      )}

      {/* Estilos mínimos para los pills — podés moverlos a services.css */}
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
        .pill--free {
          background: #ecfeff;
          color: #0369a1;
          border: 1px solid #bae6fd;
        }
        .pill--primary {
          background: #ecfeff;
          color: #0369a1;
          border: 1px solid #bae6fd;
        }
      `}</style>
    </div>
  );
}
