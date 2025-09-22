// client/src/pages/SupervisorServicios.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { useCart } from "../hooks/useCart";

export default function SupervisorServicios() {
  const nav = useNavigate();
  const { user } = useAuth();
  const { service, setService } = useCart();

  const isSupervisor = useMemo(
    () => (user?.roles || []).some(r => String(r).toLowerCase() === "supervisor"),
    [user]
  );

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!user) return;
    let alive = true;

    const fetchServices = async () => {
      setLoading(true);
      setErr("");
      try {
        let rows = [];

        // 1) endpoint principal
        try {
          const r1 = await api.get("/auth/my-services");
          rows = Array.isArray(r1.data) ? r1.data : [];
        } catch (err) {
          // evitar warning de var sin usar
          void err;
        }

        // 2) fallback a /services/my si existe
        if (!rows.length) {
          try {
            const r2 = await api.get("/services/my");
            rows = Array.isArray(r2.data) ? r2.data : [];
          } catch (err) {
            void err;
          }
        }

        if (!alive) return;
        setItems(rows);

        if (rows.length && !service?.id) {
          setService({ id: rows[0].id, name: rows[0].name });
        }
      } catch (e) {
        if (!alive) return;
        console.error("[services] fetch error:", e);
        setErr("No se pudieron cargar los servicios.");
      } finally {
        if (alive) setLoading(false);
      }
    };

    fetchServices();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!user) {
    return (
      <div className="page" style={{ padding: 16 }}>
        <h2>Iniciá sesión</h2>
      </div>
    );
  }
  if (!isSupervisor) {
    return (
      <div className="page" style={{ padding: 16 }}>
        <h2>No tenés acceso a esta sección.</h2>
      </div>
    );
  }

  const selectService = (it) => {
    setService({ id: it.id, name: it.name });
    nav("/"); // ajustá si tu catálogo vive en otra ruta
  };

  return (
    <div className="page" style={{ padding: 16 }}>
      <h2>Elegí tu servicio</h2>

      {loading && <p>Cargando servicios…</p>}
      {err && <p style={{ color: "crimson" }}>{err}</p>}

      {!loading && !err && (
        items.length ? (
          <div
            style={{
              marginTop: 12,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 16
            }}
          >
            {items.map((it) => {
              const selected = Number(service?.id) === Number(it.id);
              return (
                <div
                  key={String(it.id)}
                  style={{
                    border: selected ? "2px solid #2c7" : "1px solid #ddd",
                    borderRadius: 12,
                    padding: 16,
                    background: selected ? "#f6fffa" : "#fff",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.06)"
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>
                    {it.name}
                  </div>
                  <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
                    ID: {String(it.id)}
                  </div>
                  <button
                    className="btn"
                    onClick={() => selectService(it)}
                    style={{
                      cursor: "pointer",
                      border: "none",
                      borderRadius: 8,
                      padding: "8px 12px",
                      background: selected ? "#19a974" : "#111827",
                      color: "#fff"
                    }}
                  >
                    {selected ? "Seleccionado" : "Seleccionar"}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p>No tenés servicios asignados.</p>
        )
      )}
    </div>
  );
}
