// client/src/components/EscanerCamara.jsx
//
// Leer códigos con la cámara del celular, como respaldo de la pistola.
//
// En Android decodifica el equipo con BarcodeDetector: no cuesta nada y es
// bastante más rápido que hacerlo por software. Safari no lo trae, así que en
// iPhone se baja un decodificador (zxing-wasm, ~950 KB) la primera vez que se
// abre la cámara. Los dos exponen el mismo `detect(video)`, ver `crearDetector`.
import { useCallback, useEffect, useRef, useState } from "react";

/** Los que pegan en las etiquetas de acá, más los EAN de los envases. */
const FORMATOS = ["code_128", "code_39", "ean_13", "ean_8", "itf", "upc_a", "upc_e", "qr_code"];
/** Los mismos, con los nombres que usa zxing. */
const FORMATOS_ZXING = ["Code128", "Code39", "EAN13", "EAN8", "ITF", "UPCA", "UPCE", "QRCode"];

/** Sin cámara no hay botón: mejor que uno que no anda. */
export const hayCamara = () =>
  typeof window !== "undefined" && !!navigator?.mediaDevices?.getUserMedia;

/**
 * Un lector con la forma de BarcodeDetector: `detect(video)` → [{rawValue}].
 * Donde el equipo lo trae, se usa el del equipo; donde no, se baja el de
 * software, que no se carga nunca en los equipos que no lo necesitan.
 */
async function crearDetector() {
  if ("BarcodeDetector" in window) return new window.BarcodeDetector({ formats: FORMATOS });

  const [{ readBarcodes, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import("zxing-wasm/reader"),
    import("zxing-wasm/reader/zxing_reader.wasm?url"),
  ]);
  // Por defecto busca el .wasm al lado del .js, y empaquetado no está ahí.
  prepareZXingModule({ overrides: { locateFile: () => wasmUrl } });

  const lienzo = document.createElement("canvas");
  const pincel = lienzo.getContext("2d", { willReadFrequently: true });
  return {
    async detect(video) {
      const { videoWidth: ancho, videoHeight: alto } = video;
      if (!ancho || !alto) return [];            // todavía no llegó el primer cuadro
      lienzo.width = ancho;
      lienzo.height = alto;
      pincel.drawImage(video, 0, 0, ancho, alto);
      // Insistir con rotaciones e inversiones cuesta más que el cuadro entero,
      // y acá hay cinco por segundo: si este no salió, el próximo viene en
      // 200 ms. Barato y seguido le gana a caro y lento.
      const hallados = await readBarcodes(pincel.getImageData(0, 0, ancho, alto), {
        formats: FORMATOS_ZXING,
        tryHarder: false, tryRotate: false, tryInvert: false,
        maxNumberOfSymbols: 1,
      });
      return hallados.map((b) => ({ rawValue: b.text }));
    },
  };
}

// Mirando una etiqueta quieta, el detector la lee muchas veces por segundo.
//
// Una espera fija no alcanza: si seguís apuntando, al vencer vuelve a contar.
// Lo que se espera de una lectora es que cuente UNA vez y no vuelva a contar
// ese mismo código hasta que salga de la vista. Así, para cargar tres
// unidades, se apunta tres veces.
// Con 700 ms bastaba el pulso: el código se perdía un instante, se liberaba
// y volvía a contar solo. Hay que APARTAR la cámara a propósito.
const PERDERLO_PARA_CONTAR_DE_NUEVO = 2000;  // ms sin verlo
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
  // `onCodigo` se vuelve a crear en cada render del padre. Si entra como
  // dependencia del efecto, la cámara se apaga y se vuelve a abrir DESPUÉS DE
  // CADA ESCANEO: eso era el tironeo. Va por ref y el efecto corre una vez.
  const onCodigoRef = useRef(onCodigo);
  onCodigoRef.current = onCodigo;

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
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",             // la de atrás, no la selfie
            // Un cuadro grande no se lee mejor, pero cuesta mucho más
            // decodificarlo: a resolución completa el video se traba.
            width: { ideal: 960 }, height: { ideal: 720 }, frameRate: { ideal: 24 },
          },
          audio: false,
        });
        if (!vivoRef.current) { for (const t of stream.getTracks()) t.stop(); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        // Después de pedir la cámara: así el permiso se pregunta enseguida y,
        // en iPhone, el decodificador se baja mientras lo están aceptando.
        try {
          detector = await crearDetector();
        } catch {
          for (const t of stream.getTracks()) t.stop();   // no dejar la luz prendida
          streamRef.current = null;
          setErr("No se pudo cargar el lector de códigos. Probá con la pistola o cargá a mano.");
          return;
        }
        if (!vivoRef.current) return;

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
                r.candidato = null;   // ya se contó; apartá la cámara
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
                  onCodigoRef.current(codigo);
                }
              }
            }
          } catch { /* un cuadro borroso no es un error */ }
          mirando = false;
        }, 200);
      } catch (e) {
        setErr(e?.name === "NotAllowedError"
          ? "No diste permiso para usar la cámara. En Android se habilita desde el candado de la barra de direcciones; en iPhone, en Ajustes › Safari › Cámara."
          : "No se pudo abrir la cámara. Probá con la pistola.");
      }
    })();

    return () => {
      vivoRef.current = false;
      clearInterval(timer);
      for (const t of streamRef.current?.getTracks() ?? []) t.stop();
      streamRef.current = null;
    };
  }, []);

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

      <div className="deposito-footnote" style={{ minHeight: "2.4em" }}>
        {ultimo ? (
          <>Último leído: <strong>{ultimo}</strong>
            {esperando && " — apartá la cámara para contarlo de nuevo"}</>
        ) : "Apuntá al código y mantené el celular quieto un instante."}
      </div>
      <div className="deposito-footnote">
        Cada insumo se cuenta una sola vez por apuntada. Para varias unidades,
        apuntá otra vez o escribí la cantidad a mano.
      </div>
    </div>
  );
}
