// StockDesdeExcel.jsx — Cargar el stock real desde el Excel de Flexxus.
//
// Primero SIEMPRE muestra la comparación sin escribir nada. El stock se pisa
// sólo al apretar Aplicar, y el anterior queda guardado en el log del servidor.
import { useState } from "react";
import { api } from "../api/client";
import { formatNumber } from "../utils/format";

function Dato({ t, v }) {
  return (
    <div style={{ padding: "6px 10px", borderRadius: 8, background: "#f1f5f9", minWidth: 110 }}>
      <div style={{ fontSize: ".72rem", color: "#64748b" }}>{t}</div>
      <div style={{ fontWeight: 700 }}>{formatNumber(v ?? 0)}</div>
    </div>
  );
}

export default function StockDesdeExcel() {
  const [archivo, setArchivo] = useState(null);
  const [previo, setPrevio] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  // Dejar un insumo en cero impide pedirlo. Por defecto no se bajan.
  const [incluirCeros, setIncluirCeros] = useState(false);

  async function enviar(aplicar) {
    if (!archivo) return;
    setCargando(true);
    setError("");
    setAviso("");
    try {
      const fd = new FormData();
      fd.append("file", archivo);
      const params = [aplicar ? "aplicar=1" : "", incluirCeros ? "ceros=1" : ""].filter(Boolean);
      const { data } = await api.post(
        `/admin/flexxus/stock/excel${params.length ? "?" + params.join("&") : ""}`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      setPrevio(data);
      if (data.aplicado) setAviso(`Listo: se actualizaron ${formatNumber(data.aplicados)} insumos.`);
    } catch (e) {
      const d = e?.response?.data;
      const extra = d?.avisos?.length ? " — " + d.avisos.join(", ") : "";
      setError((d?.error || e?.message || "No se pudo procesar el Excel") + extra);
    } finally {
      setCargando(false);
    }
  }

  function aplicar() {
    const n = previo?.cambios?.length ?? 0;
    if (!window.confirm(`Se va a pisar el stock de ${n} insumos con el del Excel. ¿Seguir?`)) return;
    enviar(true);
  }

  return (
    <div className="srv-card" style={{ marginBottom: 16 }}>
      <div className="section-header">
        <h3>Stock desde el Excel de Flexxus</h3>
        <p style={{ margin: "4px 0 0", fontSize: ".85rem", color: "#6b7280" }}>
          Subí el export. Primero se muestra la comparación sin tocar nada; el stock se pisa
          sólo si apretás Aplicar. Los uniformes quedan afuera, se manejan aparte.
        </p>
      </div>

      <div className="toolbar" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="file"
          accept=".xlsx,.xls"
          disabled={cargando}
          onChange={(e) => {
            setArchivo(e.target.files?.[0] || null);
            setPrevio(null);
            setAviso("");
            setError("");
          }}
        />
        <button type="button" className="pill" disabled={!archivo || cargando} onClick={() => enviar(false)}>
          {cargando ? "Leyendo…" : "Comparar"}
        </button>
        {previo && !previo.aplicado && (previo.cambios?.length ?? 0) > 0 && (
          <button
            type="button"
            disabled={cargando}
            onClick={aplicar}
            style={{
              background: "#047857", color: "#fff", border: "1px solid #047857",
              borderRadius: 10, padding: "8px 14px", fontWeight: 700, cursor: "pointer",
            }}
          >
            Aplicar a {formatNumber(previo.cambios.length)} insumos
          </button>
        )}
      </div>

      {error && <div className="state error">{error}</div>}
      {aviso && <div className="state">{aviso}</div>}

      {previo && (
        <>
          <div className="toolbar" style={{ gap: 8, flexWrap: "wrap" }}>
            <Dato t="Cruzan por código" v={previo.resumen?.matcheados} />
            <Dato t="Con stock distinto" v={previo.resumen?.conCambioStock} />
            <Dato t="Sólo en la app" v={previo.resumen?.soloEnApp} />
            <Dato t="Sólo en Flexxus" v={previo.resumen?.soloEnFlexxus} />
          </div>

          {previo.avisos?.length > 0 && (
            <div className="state error">El Excel vino raro: {previo.avisos.join(", ")}</div>
          )}

          {(previo.enCero?.length ?? 0) > 0 && (
            <div className="state" style={{ background: "#fee2e2", color: "#991b1b" }}>
              <strong>{previo.enCero.length} insumos quedarían en cero</strong> según el Excel.
              Un insumo en cero no se puede pedir: la app corta con “Sin stock”.
              {incluirCeros
                ? " Están incluidos en lo que se va a aplicar."
                : " Quedan afuera: el resto se aplica igual."}
              <label style={{ display: "block", marginTop: 8, fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={incluirCeros}
                  disabled={cargando}
                  onChange={(e) => { setIncluirCeros(e.target.checked); setPrevio(null); }}
                  style={{ marginRight: 6 }}
                />
                Bajarlos a cero igual (confirmé que no hay stock)
              </label>
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: "pointer" }}>Ver cuáles son</summary>
                <ul style={{ margin: "6px 0 0 18px", fontSize: ".85rem" }}>
                  {previo.enCero.map((c) => (
                    <li key={c.code}>
                      {c.code} — {c.nombre} (hoy: {formatNumber(c.app)})
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}

          <div style={{ maxHeight: 420, overflow: "auto", border: "1px solid #e5e7eb", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem" }}>
              <thead>
                <tr style={{ background: "#f8fafc", position: "sticky", top: 0 }}>
                  <th style={{ textAlign: "left", padding: 8 }}>Código</th>
                  <th style={{ textAlign: "left", padding: 8 }}>Insumo</th>
                  <th style={{ textAlign: "right", padding: 8 }}>App</th>
                  <th style={{ textAlign: "right", padding: 8 }}>Flexxus</th>
                  <th style={{ textAlign: "right", padding: 8 }}>Dif.</th>
                </tr>
              </thead>
              <tbody>
                {(previo.cambios ?? []).slice(0, 200).map((c) => (
                  <tr key={c.code} style={{ borderTop: "1px solid #eef2f7" }}>
                    <td style={{ padding: 8 }}>{c.code}</td>
                    <td style={{ padding: 8 }}>{c.nombre}</td>
                    <td style={{ padding: 8, textAlign: "right" }}>{formatNumber(c.app)}</td>
                    <td style={{ padding: 8, textAlign: "right" }}>{formatNumber(c.flexxus)}</td>
                    <td style={{ padding: 8, textAlign: "right", color: c.diff < 0 ? "#b91c1c" : "#166534" }}>
                      {c.diff > 0 ? "+" : ""}
                      {formatNumber(c.diff)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(previo.cambios?.length ?? 0) > 200 && (
            <p style={{ fontSize: ".8rem", color: "#6b7280" }}>
              Se muestran los 200 de mayor diferencia, de {formatNumber(previo.cambios.length)}.
              Aplicar los toca a todos.
            </p>
          )}
        </>
      )}
    </div>
  );
}