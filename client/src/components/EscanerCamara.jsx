// client/src/components/EscanerCamara.jsx
//
// Leer códigos con la cámara del celular, como respaldo de la pistola.
//
// Usa BarcodeDetector, que ya viene en el navegador de Android: no agrega
// ninguna librería y decodifica con el hardware del equipo, que es bastante
// más rápido que hacerlo por software. iPhone no lo tiene, por eso el botón
// sólo aparece donde funciona (ver `hayCamara`).
//
// shortcut: sin soporte para iPhone/Safari, que no trae BarcodeDetector. Si
// algún día entran equipos de Apple, hay que sumar una librería que decodifique
// por software (unos 200 KB) y cargarla sólo en esos equipos.
import { useCallback, useEffect, useRef, useState } from "react";

/** Los que pegan en las etiquetas de acá, más los EAN de los envases. */
const FORMATOS = ["code_128", "code_39", "ean_13", "ean_8", "itf", "upc_a", "upc_e", "qr_code"];

/** Si el equipo no puede, el botón no se muestra: mejor que uno que no anda. */
export const hayCamara = () =>
  typeof window !== "undefined" &&
  "BarcodeDetector" in window &&
  !!navigator?.mediaDevices?.getUserMedia;

// Mirando una etiqueta quieta, el detector la lee muchas veces por segundo.
// Sin esto, un solo insumo sumaría veinte.
const ESPERA_MISMO_CODIGO = 1200;

export default function EscanerCamara({ onCodigo, onCerrar }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const ultimoRef = useRef({ codigo: null, cuando: 0 });
  const vivoRef = useRef(true);
  const [err, setErr] = useState("");
  const [ultimo, setUltimo] = useState(null);

  const cerrar = useCallback(() => {
    vivoRef.current = false;
    // Apagar la cámara a mano: si no, la luz queda prendida y come batería.
    for (const t of streamRef.current?.getTracks() ?? []) t.stop();
    streamRef.current = null;
    onCerrar?.();
  }, [onCerrar]);

  useEffect(() => {
    vivoRef.current = true;
    let detector;
    let timer;

    (async () => {
      try {
        detector = new window.BarcodeDetector({ formats: FORMATOS });
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },   // la de atrás, no la selfie
          audio: false,
        });
        if (!vivoRef.current) { for (const t of stream.getTracks()) t.stop(); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        let mirando = false;
        timer = setInterval(async () => {
          if (!vivoRef.current || mirando || !videoRef.current) return;
          mirando = true;
          try {
            const [hallado] = await detector.detect(videoRef.current);
            const codigo = String(hallado?.rawValue ?? "").trim();
            if (codigo) {
              const ahora = Date.now();
              const r = ultimoRef.current;
              const repetido = r.codigo === codigo && ahora - r.cuando < ESPERA_MISMO_CODIGO;
              if (!repetido) {
                ultimoRef.current = { codigo, cuando: ahora };
                setUltimo(codigo);
                navigator.vibrate?.(60);   // sin mirar la pantalla, el golpecito avisa
                onCodigo(codigo);
              }
            }
          } catch { /* un cuadro borroso no es un error */ }
          mirando = false;
        }, 200);
      } catch (e) {
        setErr(e?.name === "NotAllowedError"
          ? "No diste permiso para usar la cámara. Habilitala desde el candado de la barra de direcciones."
          : "No se pudo abrir la cámara. Probá con la pistola.");
      }
    })();

    return () => {
      vivoRef.current = false;
      clearInterval(timer);
      for (const t of streamRef.current?.getTracks() ?? []) t.stop();
      streamRef.current = null;
    };
  }, [onCodigo]);

  return (
    <div className="state deposito-state" style={{ padding: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <strong style={{ flex: 1 }}>Apuntá al código del insumo</strong>
        <button type="button" className="pill pill--ghost" onClick={cerrar}>
          Cerrar cámara
        </button>
      </div>

      {err ? (
        <div className="state error deposito-state">{err}</div>
      ) : (
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Cámara para escanear"
          style={{ width: "100%", maxHeight: 280, objectFit: "cover",
                   borderRadius: 8, background: "#000" }}
        />
      )}

      {ultimo && <div className="deposito-footnote">Último leído: {ultimo}</div>}
      <div className="deposito-footnote">
        Para varias unidades del mismo insumo conviene escanear una vez y escribir la cantidad.
      </div>
    </div>
  );
}
