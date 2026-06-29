// client/src/pages/TwoFactorSection.jsx
import { useState } from "react";
import { api } from "../api/client";

export default function TwoFactorSection() {
  const [qr, setQr] = useState(null);
  const [secret, setSecret] = useState(null);
  const [code, setCode] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const startSetup = async () => {
    setErr(""); setMsg(""); setLoading(true);
    try {
      const { data } = await api.post("/auth/2fa/setup");
      setQr(data.qr);
      setSecret(data.secret);
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudo iniciar la configuración");
    } finally {
      setLoading(false);
    }
  };

  const confirmEnable = async () => {
    setErr(""); setMsg(""); setLoading(true);
    try {
      await api.post("/auth/2fa/enable", { token: code.trim() });
      setEnabled(true);
      setQr(null);
      setSecret(null);
      setCode("");
      setMsg("2FA activado correctamente. La próxima vez que inicies sesión te pedirá el código.");
    } catch (e) {
      setErr(e?.response?.data?.error || "Código inválido");
    } finally {
      setLoading(false);
    }
  };

  const disable = async () => {
    if (!confirm("¿Desactivar la verificación en dos pasos?")) return;
    setErr(""); setMsg(""); setLoading(true);
    try {
      await api.post("/auth/2fa/disable");
      setEnabled(false);
      setQr(null);
      setMsg("2FA desactivado.");
    } catch (e) {
      setErr(e?.response?.data?.error || "No se pudo desactivar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="srv-card" aria-labelledby="twofa-heading">
      <div className="section-header">
        <h3 id="twofa-heading">Verificación en dos pasos (2FA)</h3>
        <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "#6b7280" }}>
          Agregá una capa extra de seguridad. Necesitás una app como Google Authenticator o Authy.
        </p>
      </div>

      {(msg || err) && (
        <div className={`state ${err ? "error" : "success"}`} role={err ? "alert" : "status"}>
          {err || msg}
        </div>
      )}

      {!qr && !enabled && (
        <button className="btn primary" onClick={startSetup} disabled={loading}>
          {loading ? "Generando…" : "Activar 2FA"}
        </button>
      )}

      {qr && (
        <div className="card" style={{ marginTop: 12 }}>
          <p style={{ marginTop: 0 }}>1. Escaneá este código QR con tu app de autenticación:</p>
          <img src={qr} alt="Código QR para 2FA" style={{ width: 200, height: 200, display: "block", margin: "0 auto 12px" }} />
          {secret && (
            <p style={{ fontSize: "0.8rem", color: "#6b7280", textAlign: "center" }}>
              ¿No podés escanear? Ingresá esta clave manualmente:<br />
              <code style={{ fontSize: "0.9rem", wordBreak: "break-all" }}>{secret}</code>
            </p>
          )}
          <p style={{ marginBottom: 6 }}>2. Ingresá el código de 6 dígitos que aparece en la app:</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              className="input"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              inputMode="numeric"
              style={{ width: 140, letterSpacing: "0.3em", textAlign: "center" }}
            />
            <button className="btn primary" onClick={confirmEnable} disabled={loading || code.length !== 6}>
              {loading ? "Verificando…" : "Confirmar y activar"}
            </button>
          </div>
        </div>
      )}

      {enabled && (
        <div style={{ marginTop: 12 }}>
          <p style={{ color: "#16a34a", fontWeight: 600 }}>✓ 2FA está activo en tu cuenta.</p>
          <button className="btn ghost" onClick={disable} disabled={loading}>
            Desactivar 2FA
          </button>
        </div>
      )}
    </section>
  );
}