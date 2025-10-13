// client/src/pages/MassReassignServicesSection.jsx
import { useEffect, useState, useCallback, useMemo } from "react";
import { api } from "../api/client";

/**
 * Reasignación masiva de servicios entre dos supervisores (A ↔ B)
 * - UI de dos paneles con búsqueda y selección múltiple
 * - Mover seleccionados → / ←
 * - Intercambiar todos (swap)
 * - Exclusividad: si el servicio ya está en el destino, se omite (sin duplicar)
 */
export default function MassReassignServicesSection() {
  const [supervisors, setSupervisors] = useState([]);
  const [leftSup, setLeftSup] = useState("");   // supervisor origen
  const [rightSup, setRightSup] = useState(""); // supervisor destino

  const [left, setLeft] = useState([]);   // asignaciones de origen
  const [right, setRight] = useState([]); // asignaciones de destino

  const [qLeft, setQLeft] = useState("");
  const [qRight, setQRight] = useState("");

  const [selLeft, setSelLeft] = useState(new Set());
  const [selRight, setSelRight] = useState(new Set());

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  /* ============ helpers ============ */
  const loadSupervisors = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/supervisors");
      setSupervisors(data || []);
    } catch {
      setSupervisors([]);
    }
  }, []);

  const listAssignments = useCallback(async (EmpleadoID) => {
    if (!EmpleadoID) return [];
    try {
      const { data } = await api.get("/admin/assignments", { params: { EmpleadoID } });
      return (data || []).map(a => ({
        pivotId: a.id ?? null,
        EmpleadoID: String(a.EmpleadoID ?? EmpleadoID),
        ServicioID: String(a.ServicioID),
        name: a.service_name || a.name || `Servicio #${a.ServicioID}`,
      }));
    } catch {
      return [];
    }
  }, []);

  const refreshSides = useCallback(async (leftId, rightId) => {
    setMsg("");
    setBusy(true);
    try {
      const [L, R] = await Promise.all([
        listAssignments(leftId),
        listAssignments(rightId),
      ]);
      setLeft(L);
      setRight(R);
      setSelLeft(new Set());
      setSelRight(new Set());
    } finally {
      setBusy(false);
    }
  }, [listAssignments]);

  useEffect(() => { loadSupervisors(); }, [loadSupervisors]);
  useEffect(() => { if (leftSup || rightSup) refreshSides(leftSup, rightSup); }, [leftSup, rightSup, refreshSides]);

  /* ============ filtros ============ */
  const leftFiltered = useMemo(() => {
    const k = qLeft.trim().toLowerCase();
    if (!k) return left;
    return left.filter(i => String(i.name).toLowerCase().includes(k));
  }, [left, qLeft]);

  const rightFiltered = useMemo(() => {
    const k = qRight.trim().toLowerCase();
    if (!k) return right;
    return right.filter(i => String(i.name).toLowerCase().includes(k));
  }, [right, qRight]);

  /* ============ API helpers ============ */
  async function deleteAssignment(EmpleadoID, ServicioID, pivotId) {
    try {
      if (pivotId) {
        await api.delete(`/admin/assignments/${pivotId}`);
      } else {
        await api.delete(`/admin/assignments/by-key`, { params: { EmpleadoID, ServicioID } });
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.response?.data?.error || e.message };
    }
  }

  async function createAssignment(EmpleadoID, ServicioID) {
    try {
      await api.post("/admin/assignments", { EmpleadoID: String(EmpleadoID), ServicioID: String(ServicioID) });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.response?.data?.error || e.message };
    }
  }

  /* ============ acciones ============ */
  const move = async (dir) => {
    // dir: "L2R" | "R2L"
    const fromSup = dir === "L2R" ? leftSup : rightSup;
    const toSup   = dir === "L2R" ? rightSup : leftSup;
    const from    = dir === "L2R" ? left : right;
    const to      = dir === "L2R" ? right : left;
    const sel     = dir === "L2R" ? selLeft : selRight;

    if (!fromSup || !toSup) return;
    if (sel.size === 0) { setMsg("Seleccioná al menos un servicio."); return; }

    setBusy(true);
    setMsg("");

    // exclusividad: omitimos los que ya están en destino
    const toSet = new Set(to.map(i => i.ServicioID));

    let ok = 0, skipped = 0, fail = 0;
    for (const ServicioID of sel) {
      if (toSet.has(String(ServicioID))) { skipped++; continue; }

      const fromItem = from.find(i => String(i.ServicioID) === String(ServicioID));
      const del = await deleteAssignment(fromSup, ServicioID, fromItem?.pivotId);
      if (!del.ok) { fail++; continue; }

      const add = await createAssignment(toSup, ServicioID);
      if (!add.ok) { fail++; continue; }

      ok++;
    }

    await refreshSides(leftSup, rightSup);
    setMsg(`Movidos: ${ok} • Omitidos: ${skipped} • Errores: ${fail}`);
  };

  const moveLeftToRight = () => move("L2R");
  const moveRightToLeft = () => move("R2L");

  const swapAll = async () => {
    if (!leftSup || !rightSup) return;
    if (!confirm("¿Intercambiar todos los servicios entre ambos supervisores?\nSe mantendrá exclusividad (si un servicio está en ambos, quedará en el panel derecho).")) {
      return;
    }
    setBusy(true); setMsg("");

    const L = await listAssignments(leftSup);
    const R = await listAssignments(rightSup);
    const setL = new Set(L.map(i => i.ServicioID));
    const setR = new Set(R.map(i => i.ServicioID));

    const inter = new Set([...setL].filter(x => setR.has(x)));
    const onlyL = [...setL].filter(x => !setR.has(x)); // van a la derecha
    const onlyR = [...setR].filter(x => !setL.has(x)); // van a la izquierda

    let ok = 0, fail = 0;

    // 1) Remover de L los onlyL + inter
    for (const id of [...onlyL, ...inter]) {
      const item = L.find(i => String(i.ServicioID) === String(id));
      const res = await deleteAssignment(leftSup, id, item?.pivotId);
      if (res.ok) ok++; else fail++;
    }

    // 2) Remover de R los onlyR
    for (const id of onlyR) {
      const item = R.find(i => String(i.ServicioID) === String(id));
      const res = await deleteAssignment(rightSup, id, item?.pivotId);
      if (res.ok) ok++; else fail++;
    }

    // 3) Agregar a L los que eran de R (onlyR)
    for (const id of onlyR) {
      const res = await createAssignment(leftSup, id);
      if (res.ok) ok++; else fail++;
    }

    // 4) Agregar a R los que eran de L (onlyL)
    for (const id of onlyL) {
      const res = await createAssignment(rightSup, id);
      if (res.ok) ok++; else fail++;
    }

    await refreshSides(leftSup, rightSup);
    setMsg(`Intercambio completo. Operaciones OK: ${ok} • Errores: ${fail}`);
  };

  const invertSides = () => {
    if (!leftSup && !rightSup) return;
    const L = leftSup; const R = rightSup;
    setLeftSup(R); setRightSup(L);
  };

  /* ============ UI ============ */
  const toggleSelLeft  = (id) => setSelLeft(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelRight = (id) => setSelRight(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectAllLeft  = () => setSelLeft(new Set(leftFiltered.map(i => i.ServicioID)));
  const clearLeft      = () => setSelLeft(new Set());
  const selectAllRight = () => setSelRight(new Set(rightFiltered.map(i => i.ServicioID)));
  const clearRight     = () => setSelRight(new Set());

  return (
    <section className="card">
      <h2>Reasignación masiva de servicios</h2>
      {msg && <div className="alert">{msg}</div>}

      <div className="transfer">
        {/* Panel izquierdo (origen) */}
        <div className="transfer-panel" aria-label="Supervisor origen">
          <div className="transfer-header">
            <select className="input" value={leftSup} onChange={(e)=>setLeftSup(e.target.value)}>
              <option value="">– Origen: elegir supervisor –</option>
              {supervisors.map(s => <option key={s.id} value={s.id}>{s.username || `Supervisor #${s.id}`}</option>)}
            </select>
            <input
              className="input"
              placeholder="Buscar…"
              value={qLeft}
              onChange={(e)=>setQLeft(e.target.value)}
            />
          </div>

          <div className="transfer-tools">
            <button className="btn" onClick={selectAllLeft}  disabled={!leftSup || busy}>Seleccionar todo</button>
            <button className="btn" onClick={clearLeft}      disabled={!leftSup || busy}>Limpiar</button>
          </div>

          <div className="transfer-list" role="listbox" aria-multiselectable="true">
            {leftFiltered.map(i => (
              <label key={i.ServicioID} className={`assign-item ${selLeft.has(i.ServicioID) ? "assigned" : ""}`}>
                <input
                  type="checkbox"
                  checked={selLeft.has(i.ServicioID)}
                  onChange={()=>toggleSelLeft(i.ServicioID)}
                />
                <div className="assign-content">
                  <div className="assign-title">{i.name}</div>
                </div>
              </label>
            ))}
            {!leftSup && <div className="hint">Elegí un supervisor de origen.</div>}
            {leftSup && leftFiltered.length === 0 && <div className="hint">Sin resultados.</div>}
          </div>
        </div>

        {/* Acciones centrales */}
        <div className="transfer-actions" aria-label="Acciones de reasignación">
          <button className="btn" onClick={invertSides} disabled={busy}>↔️ Invertir lados</button>
          <button className="btn primary" onClick={moveLeftToRight} disabled={!leftSup || !rightSup || busy || selLeft.size===0}>Mover →</button>
          <button className="btn primary" onClick={moveRightToLeft} disabled={!leftSup || !rightSup || busy || selRight.size===0}>← Mover</button>
          <button className="btn tonal"   onClick={swapAll}       disabled={!leftSup || !rightSup || busy}>Intercambiar todos</button>
        </div>

        {/* Panel derecho (destino) */}
        <div className="transfer-panel" aria-label="Supervisor destino">
          <div className="transfer-header">
            <select className="input" value={rightSup} onChange={(e)=>setRightSup(e.target.value)}>
              <option value="">– Destino: elegir supervisor –</option>
              {supervisors.map(s => <option key={s.id} value={s.id}>{s.username || `Supervisor #${s.id}`}</option>)}
            </select>
            <input
              className="input"
              placeholder="Buscar…"
              value={qRight}
              onChange={(e)=>setQRight(e.target.value)}
            />
          </div>

          <div className="transfer-tools">
            <button className="btn" onClick={selectAllRight} disabled={!rightSup || busy}>Seleccionar todo</button>
            <button className="btn" onClick={clearRight}     disabled={!rightSup || busy}>Limpiar</button>
          </div>

          <div className="transfer-list" role="listbox" aria-multiselectable="true">
            {rightFiltered.map(i => (
              <label key={i.ServicioID} className={`assign-item ${selRight.has(i.ServicioID) ? "assigned" : ""}`}>
                <input
                  type="checkbox"
                  checked={selRight.has(i.ServicioID)}
                  onChange={()=>toggleSelRight(i.ServicioID)}
                />
                <div className="assign-content">
                  <div className="assign-title">{i.name}</div>
                </div>
              </label>
            ))}
            {!rightSup && <div className="hint">Elegí un supervisor de destino.</div>}
            {rightSup && rightFiltered.length === 0 && <div className="hint">Sin resultados.</div>}
          </div>
        </div>
      </div>
    </section>
  );
}
