// Depósito: dar de baja lo que quedó pendiente de un pedido.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api/client", () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ user: { roles: ["deposito"], username: "deposito" }, loading: false }) }));

import { api } from "../api/client";
import Deposito from "./Deposito";

// Un pedido ya despachado y su tarjeta de pendiente, como las arma el servidor.
const PEDIDO = {
  id: 1035, key: "1035", displayId: "0001035", empleadoNombre: "Barcena, Nicolas",
  servicioNombre: "HOSPITAL EVA PERON", fecha: "2026-09-08 12:00:00", total: 1000, status: "open",
  items: [{ productId: 1, nombre: "LAMPAZO", cantidad: 5, precio: 200 }],
};
const PENDIENTE = {
  ...PEDIDO, key: "1035-pendiente", esPendiente: true, pedidoOrigenId: 1035, total: 900,
  items: [
    { productId: 10, nombre: "093 BOLSA NEGRA", cantidad: 8, pendiente: 8, precio: 100 },
    { productId: 11, nombre: "SPARSAN Q", cantidad: 1, pendiente: 1, precio: 100 },
  ],
};

let pedidos;

beforeEach(() => {
  vi.clearAllMocks();
  pedidos = [PEDIDO, PENDIENTE];
  api.get.mockImplementation((url) => {
    if (url.includes("/deposito/orders")) return Promise.resolve({ data: pedidos });
    return Promise.resolve({ data: [] });
  });
  api.put.mockResolvedValue({ data: { ok: true, estado: "eliminado", unidades: 9, lineas: 2 } });
});

const abrir = async () => {
  render(<MemoryRouter><Deposito /></MemoryRouter>);
  await screen.findAllByText(/#0001035/);
};
const filaPendiente = () => screen.getByText("pendiente", { selector: ".dep-badge-pendiente" }).closest("tr");

describe("Depósito — borrar lo pendiente", () => {
  it("la tarjeta del pendiente tiene el botón y la del pedido no", async () => {
    await abrir();
    expect(within(filaPendiente()).getByRole("button", { name: "Borrar lo pendiente del pedido 0001035" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Borrar lo pendiente/ })).toHaveLength(1);
  });

  it("antes de borrar muestra qué insumos y cuántas unidades se dan de baja", async () => {
    const user = userEvent.setup({ delay: null });
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    await abrir();
    await user.click(within(filaPendiente()).getByRole("button", { name: "Borrar lo pendiente del pedido 0001035" }));

    const texto = confirmar.mock.calls[0][0];
    expect(texto).toContain("#0001035");
    expect(texto).toContain("8 × 093 BOLSA NEGRA");
    expect(texto).toContain("1 × SPARSAN Q");
    expect(texto).toContain("Total: 9 unidades");
    expect(texto).toMatch(/el stock tampoco/);
  });

  it("si se cancela el aviso no se borra nada", async () => {
    const user = userEvent.setup({ delay: null });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await abrir();
    await user.click(within(filaPendiente()).getByRole("button", { name: "Borrar lo pendiente del pedido 0001035" }));
    expect(api.put).not.toHaveBeenCalled();
  });

  it("al confirmar llama a la acción del pendiente y saca la tarjeta", async () => {
    const user = userEvent.setup({ delay: null });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await abrir();
    await user.click(within(filaPendiente()).getByRole("button", { name: "Borrar lo pendiente del pedido 0001035" }));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0][0]).toBe("/deposito/orders/1035/pendiente/cancel");
    expect(await screen.findByText(/Pendiente del pedido #0001035 borrado \(9 unidades\)/)).toBeInTheDocument();
    expect(screen.queryByText("pendiente", { selector: ".dep-badge-pendiente" })).not.toBeInTheDocument();
    // El pedido original sigue en la lista.
    expect(screen.getByText("#0001035")).toBeInTheDocument();
  });

  it("si el servidor no deja, muestra el motivo y la tarjeta queda", async () => {
    const user = userEvent.setup({ delay: null });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.put.mockRejectedValue({ response: { data: { error: "Este pendiente ya está listo para retirar" } } });
    await abrir();
    await user.click(within(filaPendiente()).getByRole("button", { name: "Borrar lo pendiente del pedido 0001035" }));

    expect(await screen.findByText("Este pendiente ya está listo para retirar")).toBeInTheDocument();
    expect(filaPendiente()).toBeInTheDocument();
  });
});
