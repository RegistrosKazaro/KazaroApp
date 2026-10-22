// Que la app instalada se actualice sola.
//
// Lo delicado no es recargar: es NO recargar cuando no corresponde. Un
// parpadeo en la primera visita, o dos recargas seguidas, es peor que la
// versión vieja.
import { describe, it, expect, vi } from "vitest";
import { recargarCuandoHayaVersionNueva } from "./pwa";

/** Un navegador de mentira con un service worker al que se le puede avisar. */
function navegador({ conControlador = true } = {}) {
  const oyentes = {};
  return {
    serviceWorker: {
      controller: conControlador ? {} : null,
      addEventListener: (evento, fn) => { (oyentes[evento] ||= []).push(fn); },
      // simula que entró un worker nuevo y tomó el control
      cambiaElWorker: () => { for (const fn of oyentes.controllerchange ?? []) fn(); },
    },
  };
}

describe("Actualización de la app instalada", () => {
  it("recarga cuando entra una versión nueva", () => {
    const nav = navegador();
    const ventana = { reload: vi.fn() };
    expect(recargarCuandoHayaVersionNueva(nav, ventana)).toBe(true);

    nav.serviceWorker.cambiaElWorker();
    expect(ventana.reload).toHaveBeenCalledTimes(1);
  });

  it("recarga una sola vez aunque el aviso llegue repetido", () => {
    const nav = navegador();
    const ventana = { reload: vi.fn() };
    recargarCuandoHayaVersionNueva(nav, ventana);

    nav.serviceWorker.cambiaElWorker();
    nav.serviceWorker.cambiaElWorker();
    nav.serviceWorker.cambiaElWorker();
    expect(ventana.reload).toHaveBeenCalledTimes(1);
  });

  it("en la primera visita no recarga: el worker recién se instala", () => {
    // Sin controlador previo, el worker reclama la página apenas se instala.
    // Recargar ahí es un parpadeo que no arregla nada.
    const nav = navegador({ conControlador: false });
    const ventana = { reload: vi.fn() };
    expect(recargarCuandoHayaVersionNueva(nav, ventana)).toBe(false);

    nav.serviceWorker.cambiaElWorker();
    expect(ventana.reload).not.toHaveBeenCalled();
  });

  it("en un navegador sin service worker no rompe nada", () => {
    const ventana = { reload: vi.fn() };
    expect(recargarCuandoHayaVersionNueva({}, ventana)).toBe(false);
    expect(recargarCuandoHayaVersionNueva(undefined, ventana)).toBe(false);
    expect(ventana.reload).not.toHaveBeenCalled();
  });
});
