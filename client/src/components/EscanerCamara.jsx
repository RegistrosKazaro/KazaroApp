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
//
// Una espera fija no alcanza: si seguís apuntando, al vencer vuelve a contar.
// Lo que se espera de una lectora es que cuente UNA vez y no vuelva a contar
// ese mismo código hasta que salga de la vista. Así, para cargar tres
// unidades, se apunta tres veces.
const PERDERLO_PARA_CONTAR_DE_NUEVO = 700;   // ms sin verlo
// Cuántas veces seguidas hay que leer un código para darlo por bueno.
//
// Antes esto era un reloj: no aceptar otro código hasta que pasaran 2
// segundos desde el anterior. Mal: obligaba a sostener la cámara quieta
// esperando, y parecía que no leía (probado en el depósito, 16/10/2026).
//
// Confirmar por repetición es mejor para las dos cosas. Apuntar derecho a una
// etiqueta da lecturas estables y entra enseguida; pasar la cámara por encima
// de otra al moverse da una lectura suelta, que no alcanza. El tiempo que
// tarda es REACCIÓN, no espera: dos vueltas del detector, unos 400 ms.
const LECTURAS_PARA_CONFIRMAR = 2;

export default function EscanerCamara({ onCodigo, onCerrar }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const ultimoRef = useRef({ codigo: null, candidato: null, veces: 0, cuando: 0, perdidoDesde: null });
  const vivoRef = useRef(true);
  const [err, setErr] = useState("");
  const [ultimo, setUltimo] = useState(null);
  // true mientras el código leído sigue a la vista: ya se contó.
  const [esperando, setEsperando] = useState(false);

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
            const ahora = Date.now();
            const r = ultimoRef.current;

            if (!codigo) {
              // Nada a la vista. Cuando pasa el tiempo suficiente, el último
              // código se libera y se puede volver a contar.
              r.candidato = null;                    // lo que se estaba por confirmar se corta
              if (r.perdidoDesde == null) r.perdidoDesde = ahora;
              else if (ahora - r.perdidoDesde >= PERDERLO_PARA_CONTAR_DE_NUEVO && r.codigo) {
                ultimoRef.current = { ...r, codigo: null, perdidoDesde: null };
                setEsperando(false);
              }
            } else {
              r.perdidoDesde = null;                 // lo estamos viendo
              if (r.codigo === codigo) {
                setEsperando(true);                  // ya se contó; apartá la cámara
                r.candidato = null;
              } else {
                // Tiene que repetirse para darlo por bueno: una lectura suelta
                // al pasar la cámara por otra etiqueta no cuenta.
                r.veces = r.candidato === codigo ? r.veces + 1 : 1;
                r.candidato = codigo;
                if (r.veces >= LECTURAS_PARA_CONFIRMAR) {
                  ultimoRef.current = { codigo, candidato: null, veces: 0, cuando: ahora, perdidoDesde: null };
                  setUltimo(codigo);
                  setEsperando(true);
                  navigator.vibrate?.(60);   // sin mirar la pantalla, el golpecito avisa
                  onCodigo(codigo);
                }
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

      {ultimo && (
        <div className="deposito-footnote">
          Último leído: <strong>{ultimo}</strong>
          {esperando && " — apartá la cámara para contarlo de nuevo"}
        </div>
      )}
      <div className="deposito-footnote">
        Cada insumo se cuenta una sola vez por apuntada. Para varias unidades,
        apuntá otra vez o escribí la cantidad a mano.
      </div>
    </div>
  );
}
