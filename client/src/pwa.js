// Que la app instalada no se quede con una versión vieja.
//
// Con autoUpdate el service worker nuevo se instala y toma el control solo,
// pero la pantalla que ya está abierta sigue mostrando el JS y el CSS que
// cargó al abrirse. En el navegador no se nota, porque la pestaña se cierra y
// se vuelve a abrir. El PWA de la pantalla de inicio sí: iOS lo suspende y lo
// revive sin recargar, así que se queda días atrás (reportado 22/10/2026,
// mismo deploy viéndose distinto en Safari y en el ícono).
//
// El service worker busca la versión nueva al abrir la app, así que esta
// recarga cae en el arranque, no en el medio de algo.

/**
 * Recarga una vez cuando un service worker nuevo toma el control.
 *
 * @param {Navigator} nav
 * @param {{ reload: () => void }} ventana  dónde recargar (separado para poder probarlo)
 * @returns {boolean} si quedó escuchando
 */
export function recargarCuandoHayaVersionNueva(nav = navigator, ventana = window.location) {
  const sw = nav?.serviceWorker;
  // Sin controlador es la primera visita: el worker reclama la página al
  // instalarse y recargar ahí sería un parpadeo al pedo.
  if (!sw?.controller || typeof sw.addEventListener !== "function") return false;

  let recargando = false;
  sw.addEventListener("controllerchange", () => {
    if (recargando) return;      // el evento puede llegar más de una vez
    recargando = true;
    ventana.reload();
  });
  return true;
}
