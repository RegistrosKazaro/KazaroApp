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
  await screen.findByPlaceholderText(/Escaneá el insumo/);
  expect(fila).toBeTruthy();
  return screen.getByPlaceholderText(/Escaneá el insumo/);
};

describe("Preparación del depósito", () => {
  it("el jefe ve toda la cola con quién tiene cada pedido", async () => {
    render(<PreparacionDeposito />);
    await screen.findByText("#0001351");
    expect(screen.getByText(/REFINERIA DEL CENTRO S\.A · Carlos Gomez/)).toBeTruthy();
    expect(screen.getByText(/HOSPITAL EVA PERON · Luis Reyna/)).toBeTruthy();
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
    expect(screen.queryByText(/· Carlos Gomez/)).toBeNull();
  });

  it("muestra las líneas con lo pedido y lo que ya se separó", async () => {
    const user = userEvent.setup();
    await abrirPedido(user);
    expect(screen.getByText("DETERGENTE KAZARO X 10 LTS")).toBeTruthy();
    expect(screen.getByLabelText("Preparado de DETERGENTE KAZARO X 10 LTS").value).toBe("3");
    expect(screen.getByText("13 / 20")).toBeTruthy();
  });

  it("marca el insumo que no tiene código de barras", async () => {
    const user = userEvent.setup();
    await abrirPedido(user);
    // La lavandina a granel no tiene etiqueta: va a mano.
    expect(screen.getByText(/a mano/)).toBeTruthy();
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
    expect(screen.getByText("14 / 20")).toBeTruthy();
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

  it("las cantidades se pueden escribir a mano y guardar", async () => {
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
    await user.click(screen.getByRole("button", { name: "Guardar cantidades" }));

    await waitFor(() => {
      const [url, body] = api.put.mock.calls.at(-1);
      expect(url).toBe("/deposito/orders/1351/picking");
      expect(body.items).toContainEqual({ productoId: 30, cantidadPreparada: 5 });
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
    expect(api.put).not.toHaveBeenCalled();   // dijo que no
    confirmar.mockRestore();
  });

  it("el jefe elige el pedido de una lista, con el nombre del servicio", async () => {
    const user = userEvent.setup();
    api.put.mockResolvedValueOnce({ data: { ok: true, preparador: "Carlos Gomez" } });
    render(<PreparacionDeposito />);
    await screen.findByText("#0001351");

    const lista = await screen.findByLabelText("Pedido a asignar");
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

    await user.selectOptions(await screen.findByLabelText("Pedido a asignar"), "1400");
    await user.selectOptions(screen.getByLabelText("Preparador"), "1");
    const antes = api.get.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(antes));
    const urls = api.get.mock.calls.slice(antes).map(([u]) => u);
    expect(urls).toContain("/deposito/preparacion/asignables");
    expect(urls).toContain("/deposito/preparacion");
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
    expect(await screen.findByText(/Pedile al jefe que te asigne/)).toBeTruthy();
  });
});
