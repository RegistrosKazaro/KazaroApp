// Leer códigos con la cámara, como respaldo de la pistola.
//
// Lo que más importa acá no es que lea, sino que APAGUE la cámara al cerrar:
// una cámara que queda prendida deja la luz encendida, come batería y además
// es un celular grabando sin que nadie lo sepa.
//
// Y lo segundo: que mirando una etiqueta quieta no sume veinte veces. El
// detector lee muchas veces por segundo.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// El decodificador por software (el de iPhone) no se puede correr en jsdom:
// lo que importa probar es que el componente lo use y que lo que devuelve
// pase por las mismas reglas de conteo.
const leidosPorSoftware = vi.fn(async () => [{ text: "100000777" }]);
vi.mock("zxing-wasm/reader", () => ({
  readBarcodes: (...args) => leidosPorSoftware(...args),
  prepareZXingModule: vi.fn(),
}));
vi.mock("zxing-wasm/reader/zxing_reader.wasm?url", () => ({ default: "/zxing_reader.wasm" }));

import EscanerCamara, { hayCamara } from "./EscanerCamara";

let detectado = [];
let tracks = [];

function montarApis({ permiso = true, soporta = true } = {}) {
  tracks = [{ stop: vi.fn() }];
  if (soporta) {
    window.BarcodeDetector = class {
      constructor() {}
      async detect() { return detectado; }
    };
  } else {
    delete window.BarcodeDetector;
  }
  navigator.mediaDevices = {
    getUserMedia: permiso
      ? vi.fn().mockResolvedValue({ getTracks: () => tracks })
      : vi.fn().mockRejectedValue(Object.assign(new Error("no"), { name: "NotAllowedError" })),
  };
  // jsdom no implementa play()
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  // Ni canvas, ni las medidas del video, que el camino de software necesita.
  for (const [prop, valor] of [["videoWidth", 960], ["videoHeight", 720]]) {
    Object.defineProperty(window.HTMLVideoElement.prototype, prop, {
      configurable: true, get: () => valor,
    });
  }
  window.HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 960, height: 720 })),
  }));
}

beforeEach(() => {
  detectado = [];
  leidosPorSoftware.mockClear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  montarApis();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Deja correr el intervalo de detección unas cuantas vueltas. */
const mirar = async (vueltas = 1) => {
  for (let i = 0; i < vueltas; i += 1) {
    await act(async () => { await vi.advanceTimersByTimeAsync(210); });
  }
};

describe("Escáner por cámara", () => {
  it("se ofrece igual en un equipo sin BarcodeDetector, como el iPhone", () => {
    // Antes el botón se escondía en iPhone. Ahora ahí decodifica por software.
    montarApis({ soporta: false });
    expect(hayCamara()).toBe(true);
    montarApis({ soporta: true });
    expect(hayCamara()).toBe(true);
  });

  it("sin cámara en el equipo no se ofrece", () => {
    navigator.mediaDevices = {};
    expect(hayCamara()).toBe(false);
  });

  // El camino del iPhone: el decodificador por software, que entra por el
  // mismo `detect(video)` y por lo tanto cuenta con las mismas reglas.
  it("en iPhone lee con el decodificador por software", async () => {
    montarApis({ soporta: false });
    const onCodigo = vi.fn();
    render(<EscanerCamara onCodigo={onCodigo} onCerrar={vi.fn()} />);
    await waitFor(() => expect(leidosPorSoftware).toHaveBeenCalled());

    await mirar(3);   // tres vueltas mirando la MISMA etiqueta

    expect(onCodigo).toHaveBeenCalledTimes(1);
    expect(onCodigo).toHaveBeenCalledWith("100000777");
  });

  it("pide la cámara de atrás, no la de selfies", async () => {
    render(<EscanerCamara onCodigo={vi.fn()} onCerrar={vi.fn()} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    const [opciones] = navigator.mediaDevices.getUserMedia.mock.calls[0];
    expect(opciones.video.facingMode).toBe("environment");
    expect(opciones.audio).toBe(false);
  });

  it("al leer un código lo avisa una sola vez", async () => {
    const onCodigo = vi.fn();
    render(<EscanerCamara onCodigo={onCodigo} onCerrar={vi.fn()} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    detectado = [{ rawValue: "100000033" }];
    await mirar(3);   // tres vueltas mirando la MISMA etiqueta

    expect(onCodigo).toHaveBeenCalledTimes(1);
    expect(onCodigo).toHaveBeenCalledWith("100000033");
  });

  // Lo que el usuario vio en el depósito: apuntando quieto a una etiqueta
  // seguía sumando unidades. Una espera fija no alcanza, porque al vencer
  // vuelve a contar aunque nunca hayas movido la cámara.
  it("no vuelve a contar mientras la etiqueta siga a la vista", async () => {
    const onCodigo = vi.fn();
    render(<EscanerCamara onCodigo={onCodigo} onCerrar={vi.fn()} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    detectado = [{ rawValue: "100000033" }];
    await mirar(40);   // ocho segundos apuntando sin moverse

    expect(onCodigo).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/apartá la cámara para contarlo de nuevo/)).toBeInTheDocument();
  });

  it("apartando la cámara y volviendo, cuenta otra unidad", async () => {
    const onCodigo = vi.fn();
    render(<EscanerCamara onCodigo={onCodigo} onCerrar={vi.fn()} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    detectado = [{ rawValue: "100000033" }];
    await mirar(2);
    detectado = [];            // se aparta la cámara
    await mirar(12);           // más de 2 s sin verlo
    detectado = [{ rawValue: "100000033" }];
    await mirar(2);            // se vuelve a apuntar

    expect(onCodigo).toHaveBeenCalledTimes(2);
  });

  // La espera larga es para no tomar por error la etiqueta de al lado mientras
  // se mueve la cámara. Volver a apuntarle al MISMO insumo para cargar otra
  // unidad no tiene por qué esperar eso: es lo que más se usa.
  it("la espera larga no frena volver a contar el mismo insumo", async () => {
    const onCodigo = vi.fn();
    render(<EscanerCamara onCodigo={onCodigo} onCerrar={vi.fn()} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    detectado = [{ rawValue: "100000033" }];
    await mirar(2);
    detectado = [];
    await mirar(12);                      // se aparta a propósito
    detectado = [{ rawValue: "100000033" }];
    await mirar(2);                       // mismo insumo, sin esperar 2 segundos

    expect(onCodigo).toHaveBeenCalledTimes(2);
  });

  // El usuario reportó que "recién a la tercera vez lo acepta": era un reloj
  // de 2 segundos desde la lectura anterior, que obligaba a sostener la cámara
  // quieta esperando. Ahora lo que decide es la repetición, no el tiempo.
  it("apuntar derecho entra a la segunda lectura, sin esperar relojes", async () => {
    const onCodigo = vi.fn();
    render(<EscanerCamara onCodigo={onCodigo} onCerrar={vi.fn()} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    detectado = [{ rawValue: "111" }];
    await mirar(2);
    expect(onCodigo).toHaveBeenCalledTimes(1);

    // Y el siguiente insumo tampoco tiene que esperar: entra a la segunda.
    detectado = [];
    await mirar(12);
    detectado = [{ rawValue: "222" }];
    await mirar(2);
    expect(onCodigo).toHaveBeenCalledTimes(2);
  });

  it("un parpadeo de un cuadro no alcanza para contar dos veces", async () => {
    const onCodigo = vi.fn();
    render(<EscanerCamara onCodigo={onCodigo} onCerrar={vi.fn()} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    detectado = [{ rawValue: "100000033" }];
    await mirar(2);
    detectado = [];            // un solo cuadro borroso
    await mirar(1);
    detectado = [{ rawValue: "100000033" }];
    await mirar(2);

    expect(onCodigo).toHaveBeenCalledTimes(1);
  });

  it("otro insumo distinto entra sin tener que apartar la cámara", async () => {
    const onCodigo = vi.fn();
    render(<EscanerCamara onCodigo={onCodigo} onCerrar={vi.fn()} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    detectado = [{ rawValue: "111" }];
    await mirar(2);
    detectado = [{ rawValue: "222" }];
    await mirar(2);   // apuntar derecho a la otra etiqueta alcanza

    expect(onCodigo.mock.calls.map(([c]) => c)).toEqual(["111", "222"]);
  });

  it("una mala lectura de un cuadro no mete el insumo equivocado", async () => {
    // Cambiar de código en menos de medio segundo no es alguien moviendo la
    // cámara: es el detector equivocándose en un cuadro borroso. Meter el
    // insumo que no era en el pedido es peor que esperar un instante.
    const onCodigo = vi.fn();
    render(<EscanerCamara onCodigo={onCodigo} onCerrar={vi.fn()} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    detectado = [{ rawValue: "111" }];
    await mirar(2);
    detectado = [{ rawValue: "999" }];   // la etiqueta de al lado, de paso
    await mirar(1);                      // una sola lectura: no se confirma
    detectado = [];
    await mirar(1);

    expect(onCodigo.mock.calls.map(([c]) => c)).toEqual(["111"]);
  });

  it("apaga la cámara al cerrar", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onCerrar = vi.fn();
    render(<EscanerCamara onCodigo={vi.fn()} onCerrar={onCerrar} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Cerrar cámara" }));
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(onCerrar).toHaveBeenCalled();
  });

  it("y tambien al desmontarse, sin que nadie apriete nada", async () => {
    const { unmount } = render(<EscanerCamara onCodigo={vi.fn()} onCerrar={vi.fn()} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    unmount();
    expect(tracks[0].stop).toHaveBeenCalled();
  });

  it("si no dan permiso, lo explica en vez de quedarse en negro", async () => {
    montarApis({ permiso: false });
    render(<EscanerCamara onCodigo={vi.fn()} onCerrar={vi.fn()} />);
    expect(await screen.findByText(/No diste permiso para usar la cámara/)).toBeInTheDocument();
  });

  it("un cuadro borroso no rompe nada", async () => {
    const onCodigo = vi.fn();
    render(<EscanerCamara onCodigo={onCodigo} onCerrar={vi.fn()} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    detectado = [];                       // no leyó nada
    await mirar(2);
    detectado = [{ rawValue: "   " }];    // leyó basura
    await mirar(2);

    expect(onCodigo).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Cámara para escanear")).toBeInTheDocument();
  });
});
