// client/src/pages/CompanySelect.jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useEmpresa } from "../hooks/useEmpresa";
import isoBadges from "../assets/normasiso.png";
import WavesBackground from "../components/WavesBackground";
import "../styles/login.css";

const ArrowIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ShieldIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 2 4 5v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V5l-8-3Z" stroke="#94a3b8" strokeWidth="1.8" strokeLinejoin="round" />
  </svg>
);

export default function CompanySelect() {
  const nav = useNavigate();
  const { setEmpresa } = useEmpresa();

  const [empresas, setEmpresas] = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    api
      .get("/auth/empresas")
      .then((res) => setEmpresas(res?.data?.empresas ?? []))
      .catch(() => setEmpresas([
        { id: 1, slug: "kazaro", nombre: "Kazaro" },
        { id: 2, slug: "pazar",  nombre: "Pazar"  },
      ]))
      .finally(() => setLoading(false));
  }, []);

  function handleSelect(emp) {
    setEmpresa(emp);
    nav("/login");
  }

  return (
    <div className="login-bg">
      <WavesBackground />
      <div className="login-container">
        <div className="login-card">

          <div className="login-icon-badge" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>

          <div className="login-header-text">
            <h1 className="login-title">Bienvenido</h1>
            <p className="login-subtitle">Seleccioná tu empresa para continuar</p>
          </div>

          {loading && <p style={{ textAlign: "center", color: "#6b7280", margin: "8px 0 16px" }}>Cargando…</p>}

          {!loading && (
            <div className="company-list">
              {empresas.map((emp) => (
                <button
                  key={emp.id}
                  className={`company-btn company-btn-${emp.slug === "pazar" ? "pazar" : "kazaro"}`}
                  onClick={() => handleSelect(emp)}
                >
                  {emp.nombre}
                  <ArrowIcon />
                </button>
              ))}
            </div>
          )}

          <div className="login-secure-footer">
            <ShieldIcon />
            <span>Conexión segura</span>
          </div>

        </div>
      </div>

      <img src={isoBadges} className="iso-badges" alt="Certificaciones ISO" />
    </div>
  );
}