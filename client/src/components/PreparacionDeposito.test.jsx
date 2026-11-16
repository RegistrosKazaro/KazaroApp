// Preparación con pistola lectora.
//
// La pistola es un teclado: escribe el código en el campo enfocado y manda
// Enter. Todo lo que se prueba acá es desde ese punto de vista: que el Enter
// dispare el escaneo, que el campo quede vacío para el siguiente, y que cuando
// el código está mal se vea un cartel y no se sume nada.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { api } from "../api/client";
import PreparacionDeposito from "./PreparacionDeposito";

const PREPARADORES = [
  { id: 1, nombre: "Carlos Gomez", activo: 1 },
  { id: 2, nombre: "Luis Reyna", activo: 1 },
];

const COLA = [
  { id: 1351, servicio: "REFINERIA DEL CENTRO S.A", preparadorId: 1, preparador: "Carlos Gomez",
    lineas: 3, unidadesPedidas: 20, unidadesPreparadas: 5, lineasCompletas: 1, terminadaAt: null },
  { id: 1352, servicio: "HOSPITAL EVA PERON", preparadorId: 2, preparador: "Luis Reyna",
    lineas: 2, unidadesPedidas: 8, unidadesPreparadas: 8, lineasCompletas: 2, terminadaAt: "2026-10-14 10:00:00" },
];

const DETALLE = {
  pedido: { id: 1351, status: "preparing", servicio: "REFINERIA DEL CENTRO S.A",
            preparadorId: 1, preparador: "Carlos Gomez", terminadaAt: null },
  lineas: [
    { productoId: 10, nombre: "DETERGENTE KAZARO X 10 LTS", codigo: "100000033",
      codigoBarra: "7790001234567", pedida: 5, preparada: 3 },
    { productoId: 20, nombre: "GUANTE ALGODON MOTEADO", codigo: "036",
      codigoBarra: "7790009876543", pedida: 10, preparada: 10 },
    { productoId: 30, nombre: "LAVANDINA A GRANEL", codigo: "077",
      codigoBarra: null, pedida: 5, preparada: 0 },
  ],
  avance: { lineas: 3, lineasCompletas: 1, unidadesPedidas: 20, unidadesPreparadas: 13, completo: false },
};

const ASIGNABLES = [
  { id: 1400, servicio: "MIN SALUD - ADICCIONES", lineas: 7, unidades: 31 },
  { id: 1401, servicio: "CLUB ATLETICO BELGRANO", lineas: 2, unidades: 4 },
];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.get.mockImplementation((url) => {
    if (url === "/deposito/preparadores") return Promise.resolve({ data: { preparadores: PREPARADORES } });
    if (url === "/deposito/preparacion/asignables") return Promise.resolve({ data: { pedidos: ASIGNABLES } });
    if (url === "/deposito/preparacion") return Promise.resolve({ data: { pedidos: COLA } });
    if (url.includes("/picking")) return Promise.resolve({ data: structuredClone(DETALLE) });
    return Promise.resolve({ data: {} });
  });
  api.put.mockResolvedValue({ data: { ok: true } });
  api.post.mockResolvedValue({ data: { ok: true } });
});

/** Abre el pedido 1351 y devuelve el campo de escaneo. */
const abrirPedido = async (user) => {
  render(<PreparacionDeposito />);
  const fila = await screen.findByText("#0001351");
  await user.click(screen.getAllByRole("button", { name: "Preparar" })[0]);
  await screen.findByLabelText(/Escaneá el insumo/);
  expect(fila).toBeTruthy();
  return screen.getByLabelText(/Escaneá el insumo/);
};

describe("Preparación del depósito", () => {
  it("el jefe ve toda la cola con quién tiene cada pedido", async () => {
    render(<PreparacionDeposito />);
    const fila = (await screen.findByText("#0001351")).closest("tr");
    expect(within(fila).getByText("REFINERIA DEL CENTRO S.A")).toBeTruthy();
    expect(within(fila).getByText("Carlos Gomez")).toBeTruthy();

    const otra = screen.getByText("#0001352").closest("tr");
    expect(within(otra).getByText("Luis Reyna")).toBeTruthy();
  });

  it("el operario no manda a quién pedir: lo decide el servidor por su sesión", async () => {
    // Si la pantalla mandara el preparadorId, con cambiarlo veria la cola de otro.
    render(<PreparacionDeposito modo="operario" />);
    await screen.findByText("#0001351");
    expect(api.get).toHaveBeenCalledWith("/deposito/preparacion");
    const conParams = api.get.mock.calls.filter(([u, cfg]) => u === "/deposito/preparacion" && cfg);
    expect(conParams).toHaveLength(0);
  });

  it("el operario no ve nada del jefe ni elige quién es", async () => {
    render(<PreparacionDeposito modo="operario" />);
    await screen.findByText("#0001351");
    expect(screen.queryByText("Asignar un pedido")).toBeNull();
    expect(screen.queryByRole("button", { name: "Desasignar" })).toBeNull();
    expect(screen.queryByLabelText("¿Quién prepara?")).toBeNull();
    expect(screen.getByText("Mis pedidos para preparar")).toBeTruthy();
    // Y no se pide la lista de preparadores: no le sirve para nada.
    expect(api.get).not.toHaveBeenCalledWith("/deposito/preparadores");
  });

  it("el operario tampoco ve de quién es cada pedido: todos son suyos", async () => {
    render(<PreparacionDeposito modo="operario" />);
    await screen.findByText("#0001351");
    expect(screen.queryByText("Carlos Gomez")).toBeNull();
    expect(screen.queryByText("Preparador")).toBeNull();
  });

  it("muestra las líneas con lo pedido y lo que ya se separó", async () => {
    const user = userEvent.setup();
    await abrirPedido(user);
    expect(screen.getByText("DETERGENTE KAZARO X 10 LTS")).toBeTruthy();
    expect(screen.getByLabelText("Preparado de DETERGENTE KAZARO X 10 LTS").value).toBe("3");
    expect(screen.getByText("13")).toBeTruthy();
    expect(screen.getByText("de 20 unidades")).toBeTruthy();
  });

  it("sólo marca 'a mano' lo que no tiene ningún código para leer", async () => {
    // Las etiquetas de acá llevan el código del artículo: la lavandina no
    // tiene código de barras del envase, pero tiene el suyo y se escanea.
    // Antes decía 'cargar a mano' en TODAS las líneas.
    const conUnoSinCodigo = structuredClone(DETALLE);
    conUnoSinCodigo.lineas.push({ productoId: 40, nombre: "TRAPO SUELTO", codigo: null,
      codigoBarra: null, pedida: 2, preparada: 0 });
    api.get.mockImplementation((url) => {
      if (url === "/deposito/preparacion") return Promise.resolve({ data: { pedidos: COLA } });
      if (url.includes("/picking")) return Promise.resolve({ data: conUnoSinCodigo });
      return Promise.resolve({ data: { pedidos: [], preparadores: PREPARADORES } });
    });
    const user = userEvent.setup();
    await abrirPedido(user);

    const lavandina = screen.getByText("LAVANDINA A GRANEL").closest("tr");
    expect(within(lavandina).queryByText(/a mano/)).toBeNull();
    const trapo = screen.getByText("TRAPO SUELTO").closest("tr");
    expect(within(trapo).getByText(/a mano/)).toBeTruthy();
  });

  it("un disparo de la pistola suma uno y deja el campo listo para el siguiente", async () => {
    const user = userEvent.setup();
    const campo = await abrirPedido(user);

    api.post.mockResolvedValueOnce({ data: {
      ok: true,
      insumo: { id: 10, nombre: "DETERGENTE KAZARO X 10 LTS" },
      linea: { productoId: 10, nombre: "DETERGENTE KAZARO X 10 LTS", pedida: 5, preparada: 4 },
      avance: { lineas: 3, lineasCompletas: 1, unidadesPedidas: 20, unidadesPreparadas: 14, completo: false },
    }});

    await user.type(campo, "7790001234567{Enter}");

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/deposito/orders/1351/picking/escanear",
                                            { codigoBarra: "7790001234567" });
    });
    expect(campo.value).toBe("");
    await waitFor(() => {
      expect(screen.getByLabelText("Preparado de DETERGENTE KAZARO X 10 LTS").value).toBe("4");
    });
    await waitFor(() => expect(screen.getByText("14")).toBeTruthy());
  });

  it("si el insumo no está en el pedido, lo dice y no suma nada", async () => {
    const user = userEvent.setup();
    const campo = await abrirPedido(user);

    api.post.mockResolvedValueOnce({ data: {
      ok: false, motivo: "no_esta",
      error: '"ESCOBILLON TRADICIONAL" no está en este pedido. Fijate si lo agarraste del estante de al lado.',
      avance: DETALLE.avance,
    }});

    await user.type(campo, "7790000000000{Enter}");

    const cartel = await screen.findByRole("status");
    expect(cartel.textContent).toMatch(/no está en este pedido/);
    expect(screen.getByLabelText("Preparado de DETERGENTE KAZARO X 10 LTS").value).toBe("3");
  });

  it("la pistola manda espacios y el campo vacío no dispara nada", async () => {
    const user = userEvent.setup();
    const campo = await abrirPedido(user);
    await user.type(campo, "   {Enter}");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("lo que se escribe a mano se guarda solo al salir del campo, sin botón", async () => {
    const user = userEvent.setup();
    await abrirPedido(user);

    api.put.mockResolvedValueOnce({ data: {
      ok: true,
      lineas: DETALLE.lineas.map((l) => (l.productoId === 30 ? { ...l, preparada: 5 } : l)),
      avance: { ...DETALLE.avance, unidadesPreparadas: 18 },
    }});

    const campo = screen.getByLabelText("Preparado de LAVANDINA A GRANEL");
    await user.clear(campo);
    await user.type(campo, "5");
    expect(screen.queryByRole("button", { name: "Guardar cantidades" })).toBeNull();
    await user.tab();   // sale del campo

    await waitFor(() => {
      const [url, body] = api.put.mock.calls.at(-1);
      expect(url).toBe("/deposito/orders/1351/picking");
      // Sólo la línea que cambió: no se reenvían las demás.
      expect(body.items).toEqual([{ productoId: 30, cantidadPreparada: 5 }]);
    });
  });

  it("terminar completo no pregunta nada", async () => {
    const user = userEvent.setup();
    api.get.mockImplementation((url) => {
      if (url === "/deposito/preparadores") return Promise.resolve({ data: { preparadores: PREPARADORES } });
      if (url === "/deposito/preparacion") return Promise.resolve({ data: { pedidos: COLA } });
      return Promise.resolve({ data: { ...structuredClone(DETALLE),
        avance: { ...DETALLE.avance, unidadesPreparadas: 20, lineasCompletas: 3, completo: true } } });
    });
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);

    await abrirPedido(user);
    await user.click(screen.getByRole("button", { name: /Terminé, está completo/ }));

    expect(confirmar).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith("/deposito/orders/1351/picking/terminar");
    });
    confirmar.mockRestore();
  });

  it("terminar incompleto avisa cuánto falta antes de mandar", async () => {
    const user = userEvent.setup();
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    await abrirPedido(user);

    await user.click(screen.getByRole("button", { name: /Terminé \(incompleto\)/ }));

    expect(confirmar).toHaveBeenCalledWith(expect.stringContaining("13 de 20"));
    // Y avisa qué pasa con lo que falta, que es lo que el preparador necesita saber.
    expect(confirmar).toHaveBeenCalledWith(expect.stringContaining("7 que faltan"));
    expect(confirmar).toHaveBeenCalledWith(expect.stringContaining("PENDIENTES"));
    expect(api.put).not.toHaveBeenCalled();   // dijo que no
    confirmar.mockRestore();
  });

  it("el jefe elige el pedido de una lista, con el nombre del servicio", async () => {
    const user = userEvent.setup();
    api.put.mockResolvedValueOnce({ data: { ok: true, preparador: "Carlos Gomez" } });
    render(<PreparacionDeposito />);
    await screen.findByText("#0001351");

    const lista = await screen.findByLabelText(/Pedido a asignar/);
    // Se reconoce por el servicio, no por el número suelto.
    expect(within(lista).getByText(/#0001400 · MIN SALUD - ADICCIONES/)).toBeTruthy();

    await user.selectOptions(lista, "1400");
    await user.selectOptions(screen.getByLabelText("Preparador"), "1");
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith("/deposito/orders/1400/asignar", { preparadorId: 1 });
    });
  });

  it("al asignar, el pedido desaparece de los pendientes y se recarga la cola", async () => {
    const user = userEvent.setup();
    api.put.mockResolvedValueOnce({ data: { ok: true, preparador: "Carlos Gomez" } });
    render(<PreparacionDeposito />);
    await screen.findByText("#0001351");

    await user.selectOptions(await screen.findByLabelText(/Pedido a asignar/), "1400");
    await user.selectOptions(screen.getByLabelText("Preparador"), "1");
    const antes = api.get.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(antes));
    const urls = api.get.mock.calls.slice(antes).map(([u]) => u);
    expect(urls).toContain("/deposito/preparacion/asignables");
    expect(urls).toContain("/deposito/preparacion");
  });

  // Un pedido recién confirmado en la solapa Pedidos no aparecía para asignar
  // hasta salir y volver a entrar: la lista se cargaba una sola vez.
  it("Actualizar también recarga los pedidos para asignar", async () => {
    const user = userEvent.setup();
    render(<PreparacionDeposito />);
    await screen.findByText("#0001351");
    const antes = api.get.mock.calls.filter(([u]) => u === "/deposito/preparacion/asignables").length;

    await user.click(screen.getByRole("button", { name: "Actualizar" }));

    await waitFor(() => {
      const ahora = api.get.mock.calls.filter(([u]) => u === "/deposito/preparacion/asignables").length;
      expect(ahora).toBeGreaterThan(antes);
    });
  });

  it("si no hay nadie con rol Picking, le dice al jefe qué hacer", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/deposito/preparadores") return Promise.resolve({ data: { preparadores: [] } });
      if (url === "/deposito/preparacion/asignables") return Promise.resolve({ data: { pedidos: ASIGNABLES } });
      return Promise.resolve({ data: { pedidos: COLA } });
    });
    render(<PreparacionDeposito />);
    expect(await screen.findByText(/Creá el usuario del operario/)).toBeTruthy();
  });

  it("el pedido terminado se ve distinto y el jefe lo puede devolver", async () => {
    const user = userEvent.setup();
    render(<PreparacionDeposito />);
    await screen.findByText("#0001352");
    expect(screen.getByText(/terminado/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Devolver" }));
    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith("/deposito/orders/1352/picking/reabrir");
    });
  });

  it("sin pedidos asignados le dice al operario qué hacer", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/deposito/preparadores") return Promise.resolve({ data: { preparadores: PREPARADORES } });
      return Promise.resolve({ data: { pedidos: [] } });
    });
    render(<PreparacionDeposito modo="operario" />);
    expect(await screen.findByText(/Cuando el jefe te asigne uno, aparece acá solo/)).toBeTruthy();
  });
});

/* ===== Revisión del 16/11/2026 ===== */

/** El detalle que devuelve el servidor, con lo que se le cambie encima. */
const detalleCon = (cambios = {}) => {
  const d = structuredClone(DETALLE);
  Object.assign(d.pedido, cambios.pedido || {});
  if (cambios.lineas) d.lineas = cambios.lineas(d.lineas);
  return d;
};

/** Monta la pantalla devolviendo ese detalle al abrir el pedido. */
const conDetalle = (detalle, extra = () => undefined) => {
  api.get.mockImplementation((url) => {
    const otro = extra(url);
    if (otro) return otro;
    if (url === "/deposito/preparadores") return Promise.resolve({ data: { preparadores: PREPARADORES } });
    if (url === "/deposito/preparacion/asignables") return Promise.resolve({ data: { pedidos: ASIGNABLES } });
    if (url === "/deposito/preparacion") return Promise.resolve({ data: { pedidos: COLA } });
    if (url.includes("/picking")) return Promise.resolve({ data: structuredClone(detalle) });
    return Promise.resolve({ data: {} });
  });
};

describe("Preparación — Completar después de escanear", () => {
  it("el jefe tiene 'Completar' en lo que falta, y manda la cantidad pedida", async () => {
    const user = userEvent.setup();
    await abrirPedido(user);
    api.put.mockResolvedValueOnce({ data: { ok: true, lineas: DETALLE.lineas, avance: DETALLE.avance } });

    // El guante ya está completo: no lleva botón.
    const guante = screen.getByText("GUANTE ALGODON MOTEADO").closest("tr");
    expect(within(guante).queryByRole("button", { name: /Completar/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Completar DETERGENTE KAZARO X 10 LTS" }));

    await waitFor(() => {
      const [url, body] = api.put.mock.calls.at(-1);
      expect(url).toBe("/deposito/orders/1351/picking");
      expect(body.items).toEqual([{ productoId: 10, cantidadPreparada: 5 }]);
    });
  });

  it("el operario no puede cargar ni completar lo que todavía no escaneó", async () => {
    conDetalle(detalleCon({ lineas: (ls) => ls.map((l) => ({ ...l, preparada: 0, escaneadoAt: null })) }));
    const user = userEvent.setup();
    render(<PreparacionDeposito modo="operario" />);
    await user.click((await screen.findAllByRole("button", { name: "Preparar" }))[0]);
    await screen.findByLabelText(/Escaneá el insumo/);

    expect(screen.getByLabelText("Preparado de LAVANDINA A GRANEL")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Completar/ })).toBeNull();
    expect(screen.getAllByText(/escaneá para cargar/).length).toBeGreaterThan(0);
  });

  it("al escanearlo, al operario le aparece 'Completar' en esa línea", async () => {
    conDetalle(detalleCon({ lineas: (ls) => ls.map((l) => ({ ...l, preparada: 0, escaneadoAt: null })) }));
    api.post.mockResolvedValueOnce({ data: {
      ok: true, insumo: { id: 30, nombre: "LAVANDINA A GRANEL" },
      linea: { productoId: 30, pedida: 5, preparada: 1, escaneadoAt: "2026-11-16 10:00:00" },
      avance: { ...DETALLE.avance, unidadesPreparadas: 1 },
    }});
    const user = userEvent.setup();
    render(<PreparacionDeposito modo="operario" />);
    await user.click((await screen.findAllByRole("button", { name: "Preparar" }))[0]);
    const campo = await screen.findByLabelText(/Escaneá el insumo/);

    await user.type(campo, "077{Enter}");

    expect(await screen.findByRole("button", { name: "Completar LAVANDINA A GRANEL" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Completar LAVANDINA A GRANEL" })).toHaveTextContent("faltan 4");
    expect(screen.getByLabelText("Preparado de LAVANDINA A GRANEL")).not.toBeDisabled();
    // Y los que no escaneó siguen trabados.
    expect(screen.queryByRole("button", { name: "Completar DETERGENTE KAZARO X 10 LTS" })).toBeNull();
  });

  it("si el servidor no acepta el Completar, queda su error y no se celebra", async () => {
    const user = userEvent.setup();
    await abrirPedido(user);
    api.put.mockResolvedValueOnce({ data: { ok: false, errores: ['Escaneá "DETERGENTE" antes de cargar la cantidad.'],
      lineas: DETALLE.lineas, avance: DETALLE.avance } });

    await user.click(screen.getByRole("button", { name: "Completar DETERGENTE KAZARO X 10 LTS" }));

    expect(await screen.findByText(/antes de cargar la cantidad/)).toBeTruthy();
    expect(screen.queryByText(/completo \(5\)/)).toBeNull();
  });
});

describe("Preparación — pedido terminado", () => {
  it("se abre para mirar: sin campo de escaneo, sin Completar, sin Terminé", async () => {
    conDetalle(detalleCon({ pedido: { terminadaAt: "2026-11-16 10:00:00" } }));
    const user = userEvent.setup();
    render(<PreparacionDeposito modo="operario" />);
    await user.click((await screen.findAllByRole("button", { name: "Preparar" }))[0]);

    expect(await screen.findByText(/Ya está terminado/)).toBeTruthy();
    expect(screen.queryByLabelText(/Escaneá el insumo/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Completar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Terminé/ })).toBeNull();
    expect(screen.getByLabelText("Preparado de LAVANDINA A GRANEL")).toBeDisabled();
    expect(screen.getByText(/pedile al jefe que te lo devuelva/)).toBeTruthy();
  });

  it("si se terminó o se cerró mientras lo tenía abierto, el escaneo lo dice y lo recarga", async () => {
    const user = userEvent.setup();
    const campo = await abrirPedido(user);
    api.post.mockResolvedValueOnce({ data: { ok: false, motivo: "cerrado",
      error: "Este pedido ya se cerró: no se puede seguir preparando.", avance: DETALLE.avance } });
    const abiertas = api.get.mock.calls.filter(([u]) => u.includes("/picking")).length;

    await user.type(campo, "077{Enter}");

    expect(await screen.findByText(/ya se cerró/)).toBeTruthy();
    await waitFor(() =>
      expect(api.get.mock.calls.filter(([u]) => u.includes("/picking")).length).toBe(abiertas + 1));
  });
});

describe("Preparación — que no se pierda nada", () => {
  it("Terminé espera a que llegue lo último que se tipeó", async () => {
    // Antes, lo tipeado sin apretar "Guardar" se perdía al terminar.
    const user = userEvent.setup();
    await abrirPedido(user);
    let soltar;
    api.put.mockImplementationOnce(() => new Promise((r) => { soltar = () => r({ data: {
      ok: true, lineas: DETALLE.lineas, avance: { ...DETALLE.avance, completo: true } } }); }));
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const campo = screen.getByLabelText("Preparado de LAVANDINA A GRANEL");
    await user.clear(campo);
    await user.type(campo, "5");
    await user.click(screen.getByRole("button", { name: /Terminé/ }));   // el blur dispara el guardado

    // Mientras el guardado no vuelve, no se mandó el Terminé.
    expect(api.put.mock.calls.some(([u]) => u.endsWith("/terminar"))).toBe(false);
    soltar();
    await waitFor(() => expect(api.put.mock.calls.at(-1)[0]).toBe("/deposito/orders/1351/picking/terminar"));
    const orden = api.put.mock.calls.map(([u]) => u);
    expect(orden.indexOf("/deposito/orders/1351/picking")).toBeLessThan(orden.indexOf("/deposito/orders/1351/picking/terminar"));
  });

  it("vaciar el campo y salir no guarda un cero: vuelve a lo que había", async () => {
    const user = userEvent.setup();
    await abrirPedido(user);
    const llamadas = api.put.mock.calls.length;
    const campo = screen.getByLabelText("Preparado de DETERGENTE KAZARO X 10 LTS");
    await user.clear(campo);
    await user.tab();
    expect(api.put.mock.calls.length).toBe(llamadas);
    expect(campo).toHaveValue("3");
  });
});

describe("Preparación — la lista", () => {
  it("se actualiza sola cada 30 segundos", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<PreparacionDeposito modo="operario" />);
      await screen.findByText("#0001351");
      const antes = api.get.mock.calls.filter(([u]) => u === "/deposito/preparacion").length;
      await vi.advanceTimersByTimeAsync(30000);
      await waitFor(() =>
        expect(api.get.mock.calls.filter(([u]) => u === "/deposito/preparacion").length).toBe(antes + 1));
    } finally {
      vi.useRealTimers();
    }
  });

  it("el jefe ve los pedidos En preparación sin dueño para asignar", async () => {
    conDetalle(DETALLE, (url) => url === "/deposito/preparacion/asignables"
      ? Promise.resolve({ data: { pedidos: [{ id: 1500, servicio: "UNC", lineas: 3, unidades: 9, enPreparacion: 1 }] } })
      : undefined);
    render(<PreparacionDeposito />);
    expect(await screen.findByRole("option", { name: /#0001500 \(en preparación\) · UNC/ })).toBeTruthy();
  });

  it("marca los pendientes en la lista", async () => {
    conDetalle(DETALLE, (url) => url === "/deposito/preparacion"
      ? Promise.resolve({ data: { pedidos: [{ ...COLA[0], esPendiente: true }] } })
      : undefined);
    render(<PreparacionDeposito />);
    const fila = (await screen.findByText("#0001351")).closest("tr");
    expect(within(fila).getByText("pendiente")).toBeTruthy();
  });
});
