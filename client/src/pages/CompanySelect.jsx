// client/src/pages/CompanySelect.jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useEmpresa } from "../hooks/useEmpresa";
import logo from "../assets/LogoVertFull.png";
import isoBadges from "../assets/normasiso.png";
import "../styles/login.css";

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
      <div className="login-container">
        <div className="login-card">

          <div className="login-logo-wrap">
            <img src={logo} className="brand-logo" alt="Sistema" />
          </div>

          <div className="login-header-text">
            <h1 className="login-title">Seleccioná tu empresa</h1>
            <p className="login-subtitle">para continuar</p>
          </div>

          {loading && <p style={{ textAlign: "center", color: "#6b7280", margin: "8px 0 16px" }}>Cargando…</p>}

          {!loading && (
            <div className="company-list">
              {empresas.map((emp) => (
                <button
                  key={emp.id}
                  className="company-btn"
                  onClick={() => handleSelect(emp)}
                >
                  {emp.nombre}
                </button>
              ))}
            </div>
          )}

        </div>
      </div>

      <img src={isoBadges} className="iso-badges" alt="Certificaciones ISO" />
    </div>
  );
}