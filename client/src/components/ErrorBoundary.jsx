// Si una pantalla falla al dibujarse, React la desmonta entera y queda la
// página en blanco, sin ningún indicio. Esto la reemplaza por un aviso con
// cómo seguir, y guarda el error en la consola para poder diagnosticarlo.
import { Component } from "react";
import { useLocation } from "react-router-dom";

class Barrera extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[pantalla] error al dibujar:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={{
        maxWidth: 520, margin: "64px auto", padding: "24px 28px", borderRadius: 14,
        border: "1px solid #fecaca", background: "#fff", color: "#0f172a",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      }}>
        <h2 style={{ margin: "0 0 8px", fontSize: "1.15rem" }}>Esta pantalla tuvo un problema</h2>
        <p style={{ margin: "0 0 16px", color: "#334155", lineHeight: 1.5 }}>
          No se perdió nada de lo que ya estaba guardado. Probá recargar; si vuelve a pasar,
          avisá qué estabas haciendo.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => window.location.reload()} style={{
            padding: "8px 16px", borderRadius: 8, border: "1px solid #1d4ed8",
            background: "#1d4ed8", color: "#fff", font: "inherit", cursor: "pointer",
          }}>
            Recargar
          </button>
          <button type="button" onClick={() => { window.location.href = "/"; }} style={{
            padding: "8px 16px", borderRadius: 8, border: "1px solid #cbd5e1",
            background: "#fff", color: "#0f172a", font: "inherit", cursor: "pointer",
          }}>
            Ir al inicio
          </button>
        </div>
      </div>
    );
  }
}

/** Al cambiar de pantalla se limpia el error: la barrera no queda "trabada". */
export default function ErrorBoundary({ children }) {
  const location = useLocation();
  return <Barrera key={location.pathname}>{children}</Barrera>;
}
