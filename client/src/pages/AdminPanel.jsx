// client/src/pages/AdminPanel.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import "../styles/catalog.css";

export default function AdminPanel() {
  const nav = useNavigate();
  const { user, loading } = useAuth();

  const [orders, setOrders] = useState([]);
  const [services, setServices] = useState([]);
  const [supervisors, setSupervisors] = useState([]);
  const [selectedSupervisor, setSelectedSupervisor] = useState("");
  const [myAssignments, setMyAssignments] = useState([]);

  // SOLO admin
  const isAdmin = useMemo(() => {
    const roles = (user?.roles || []).map(r => String(r).toLowerCase());
    return roles.includes("admin");
  }, [user]);

  // Carga inicial: listas base
  useEffect(() => {
    if (loading) return;
    if (!user) return nav("/login", { replace: true });
    if (!isAdmin) return nav("/role-select", { replace: true });

    (async () => {
      const [o, s, sp] = await Promise.all([
        api.get("/admin/orders"),
        api.get("/admin/services"),
        api.get("/admin/supervisors"),
      ]);
      setOrders(o.data || []);
      setServices(s.data || []);
      setSupervisors(sp.data || []);
    })();
  }, [loading, user, isAdmin, nav]);

  // Cargar asignaciones del supervisor seleccionado
  useEffect(() => {
    (async () => {
      if (!selectedSupervisor) { setMyAssignments([]); return; }
      const a = await api.get("/admin/assignments", {
        params: { EmpleadoID: selectedSupervisor },
      });
      setMyAssignments(a.data || []);
    })();
  }, [selectedSupervisor]);

  async function onDeleteOrder(id) {
    if (!confirm("¿Eliminar pedido completo?")) return;
    await api.delete(`/admin/orders/${id}`);
    const o = await api.get("/admin/orders");
    setOrders(o.data || []);
  }

  async function onUpdateOrderTotal(id) {
    const val = prompt("Nuevo total (número):");
    if (!val) return;
    await api.put(`/admin/orders/${id}/price`, { newPrice: Number(val) });
    const o = await api.get("/admin/orders");
    setOrders(o.data || []);
  }

  // Asignar servicio al supervisor seleccionado
  async function onAssign(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const EmpleadoID = fd.get("supervisor");
    const ServicioID = fd.get("service");
    if (!EmpleadoID || !ServicioID) return;

    try {
      await api.post("/admin/assignments", { EmpleadoID, ServicioID });
      e.currentTarget.reset();
      setSelectedSupervisor(String(EmpleadoID)); // mantiene selección
      const a = await api.get("/admin/assignments", { params: { EmpleadoID } });
      setMyAssignments(a.data || []);
    } catch (err) {
      alert("No se pudo asignar el servicio. Revisá la consola del servidor.");
      console.error(err);
    }
  }

  async function onRemoveAssignment(pivotId) {
    await api.delete(`/admin/assignments/${pivotId}`);
    if (!selectedSupervisor) return;
    const a = await api.get("/admin/assignments", { params: { EmpleadoID: selectedSupervisor } });
    setMyAssignments(a.data || []);
  }

  // Reasignar servicio a otro supervisor (exclusivo por servicio)
  async function onReassign(a, toEmpleadoID) {
    if (!toEmpleadoID) return;
    await api.patch("/admin/assignments/reassign", {
      ServicioID: a.ServicioID,
      toEmpleadoID
    });
    if (!selectedSupervisor) return;
    const mine = await api.get("/admin/assignments", { params: { EmpleadoID: selectedSupervisor } });
    setMyAssignments(mine.data || []);
  }

  // Deshabilitar en el combo los servicios ya asignados a este supervisor
  const assignedServiceIds = new Set(myAssignments.map(a => a.ServicioID));

  return (
    <div className="page" style={{ padding: 16 }}>
      <h1 className="title">Panel Administrativo</h1>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Asignar / Reasignar servicios</h2>

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
          <form onSubmit={onAssign} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
            <select
              name="supervisor"
              required
              value={selectedSupervisor}
              onChange={(e) => setSelectedSupervisor(e.target.value)}
            >
              <option value="" disabled>Supervisor…</option>
              {supervisors.map(s => (
                <option key={s.id} value={s.id}>
                  {s.username || s.Email || `#${s.id}`}
                </option>
              ))}
            </select>

            <select name="service" required defaultValue="">
              <option value="" disabled>Servicio…</option>
              {services.map(s => (
                <option
                  key={s.id}
                  value={s.id}
                  disabled={selectedSupervisor && assignedServiceIds.has(s.id)}
                  title={assignedServiceIds.has(s.id) ? "Ya asignado a este supervisor" : ""}
                >
                  {s.name}{assignedServiceIds.has(s.id) ? " (ya asignado)" : ""}
                </option>
              ))}
            </select>

            <button type="submit" disabled={!selectedSupervisor}>Asignar</button>
          </form>
        </div>

        {selectedSupervisor ? (
          <>
            <h3>Servicios asignados</h3>
            <ul>
              {myAssignments.map(a => (
                <li key={a.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ minWidth: 260 }}>{a.service_name}</span>

                  {/* a.id es el id de la tabla pivote supervisor_services */}
                  <button onClick={() => onRemoveAssignment(a.id)}>Quitar</button>

                  <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <span>Reasignar a:</span>
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const toEmpleadoID = e.target.value;
                        if (toEmpleadoID) onReassign(a, toEmpleadoID);
                        e.target.value = "";
                      }}
                    >
                      <option value="" disabled>Elegí supervisor…</option>
                      {supervisors
                        .filter(s => String(s.id) !== String(selectedSupervisor))
                        .map(s => (
                          <option key={s.id} value={s.id}>
                            {s.username || s.Email || `#${s.id}`}
                          </option>
                        ))}
                    </select>
                  </div>
                </li>
              ))}
              {!myAssignments.length && <li style={{ opacity: 0.7 }}>— Sin servicios asignados —</li>}
            </ul>
          </>
        ) : (
          <p style={{ opacity: 0.8 }}>Seleccioná un supervisor para ver y gestionar sus servicios.</p>
        )}
      </section>

      <section className="card">
        <h2>Pedidos</h2>
        <div className="table">
          <div className="thead">
            <div>ID</div><div>Empleado</div><div>Rol</div><div>Total</div><div>Fecha</div><div>Acciones</div>
          </div>
          <div className="tbody">
            {orders.map(o => (
              <div key={o.id} className="tr">
                <div>{o.id}</div>
                <div>{o.empleadoId}</div>
                <div>{o.rol}</div>
                <div>${o.total}</div>
                <div>{o.fecha?.slice(0, 19)?.replace("T", " ")}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => onUpdateOrderTotal(o.id)}>Modificar total</button>
                  <button onClick={() => onDeleteOrder(o.id)}>Eliminar</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
