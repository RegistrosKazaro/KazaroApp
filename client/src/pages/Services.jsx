// client/src/pages/Services.jsx
import { useEffect, useState } from "react";
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

  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(services.length / PER_PAGE));
  const start = (page - 1) * PER_PAGE;
  const pageItems = services.slice(start, start + PER_PAGE);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
    if (page < 1) setPage(1);
  }, [services.length, page, pageCount]);

  const getId = (r) => {
    const v =
      r?.id ??
      r?.servicioId ?? r?.servicioID ??
      r?.ServicioID ?? r?.ServiciosID ??
      r?.service_id ?? r?.servicio_id ??
      r?.ServiceID ??
      r?.Servicios?.id ?? r?.Servicio?.id ?? r?.servicio?.id ??
      r?.service?.id;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const getName = (r) => {
    const v =
      r?.name ?? r?.nombre ??
      r?.ServicioNombre ?? r?.servicioNombre ??
      r?.service_name ?? r?.ServiceName ??
      r?.descripcion ?? r?.Descripcion ??
      r?.Servicios?.ServicioNombre ?? r?.Servicio?.ServicioNombre ??
      r?.servicio?.name ?? r?.service?.name ?? r?.Servicios?.name;
    const s = (v ?? "").toString().trim();
    return s || undefined;
  };

  
  useEffect(() => {
    if (loadingUser) return;
    if (!user) {
      nav("/login", { replace: true });
      return;
    }
    const roles = (user?.roles || []).map((r) => String(r).toLowerCase());
    if (!roles.some((r) => r.includes("super"))) {
      nav("/app/administrativo/products", { replace: true });
    }
  }, [user, loadingUser, nav]);

  
  useEffect(() => {
    if (loadingUser) return;
    if (!user) return;

    let alive = true;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        let rows = [];

        
        try {
          const r = await api.get("/services/dev/services-by-username", {
            params: { username: user.username },
            withCredentials: false,
          });
          rows = Array.isArray(r.data?.rows) ? r.data.rows : [];
        } catch (e) {
          console.debug("[services] dev by username falló", e);
        }

        
        if (!rows.length && user?.id != null) {
          try {
            const r = await api.get("/services/dev/services-by-id", {
              params: { userId: user.id },
              withCredentials: false,
            });
            rows = Array.isArray(r.data?.rows) ? r.data.rows : [];
          } catch (e) {
            console.debug("[services] dev by id falló", e);
          }
        }


        if (!rows.length) {
          try {
            const r = await api.get("/services/my", { withCredentials: true });
            const d = Array.isArray(r.data) ? r.data : (r.data?.rows || []);
            rows = Array.isArray(d) ? d : [];
          } catch (e) {
            console.debug("[services] /services/my falló", e);
          }
        }

        
        if (!rows.length) {
          try {
            const r = await api.get("/auth/my-services", { withCredentials: true });
            rows = Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.rows) ? r.data.rows : []);
          } catch (e) {
            console.debug("[services] /auth/my-services falló", e);
          }
        }

        
        const mapped = (rows || [])
          .map((r) => {
            const id = getId(r);
            const name = getName(r);
            return id != null && name ? { id, name } : null;
          })
          .filter(Boolean);

        const seen = new Set();
        const unique = mapped.filter((r) => {
          if (seen.has(r.id)) return false;
          seen.add(r.id);
          return true;
        });

        if (!alive) return;
        setServices(unique);
        
        setPage(1);

        if (unique.length && !service?.id) {
          setService({ id: unique[0].id, name: unique[0].name });
        }

        setLoading(false);
      } catch (e) {
        console.debug("[services] error inesperado", e);
        if (!alive) return;
        setErr("No se pudieron cargar tus servicios.");
        setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [user, loadingUser, setService, service?.id]);

  const handlePick = (it) => setService({ id: it.id, name: it.name });
  const goNext = () => {
    if (!service?.id) return;
    nav("/app/supervisor/products");
  };

  const goFirst = () => setPage(1);
  const goPrev  = () => setPage((p) => Math.max(1, p - 1));
  const goNextP = () => setPage((p) => Math.min(pageCount, p + 1));
  const goLast  = () => setPage(pageCount);

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
          <div className="services-grid">
            {pageItems.map((it) => {
              const selected = Number(service?.id) === Number(it.id);
              return (
                <button
                  key={String(it.id)}
                  className={`service-card${selected ? " selected" : ""}`}
                  onClick={() => handlePick(it)}
                  title={it.name}
                >
                  <div>{it.name}</div>
                  {selected && <small>Seleccionado</small>}
                </button>
              );
            })}
          </div>

          {/* Paginador */}
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, opacity: 0.8 }}>
              Mostrando {start + 1}-{Math.min(start + PER_PAGE, services.length)} de {services.length}
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <button className="pill pill--primary" onClick={goFirst} disabled={page === 1}>&laquo;</button>
              <button className="pill pill--primary" onClick={goPrev} disabled={page === 1}>Anterior</button>
              <span style={{ padding: "4px 8px", fontSize: 16, color: "black" }}>
                Página {page} / {pageCount}
              </span>
              <button className="pill pill--primary" onClick={goNextP} disabled={page === pageCount}>Siguiente</button>
              <button className="pill pill--primary" onClick={goLast} disabled={page === pageCount}>&raquo;</button>
            </div>
          </div>

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
    </div>
  );
}
