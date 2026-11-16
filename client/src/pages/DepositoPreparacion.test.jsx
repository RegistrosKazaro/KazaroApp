// Depósito: desde la solapa Pedidos, el jefe ve quién está preparando cada
// pedido con la pistola, y no lo cierra a ciegas a medio preparar.
//
// Cerrar a medio preparar cobra lo PEDIDO: lo que el preparador no juntó
// pasa a pendiente recién cuando él aprieta "Terminé".
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api/client", () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ user: { roles: ["deposito"], username: "deposito" }, loading: false }) }));

import { api } from "../api/client";
import Deposito from "./Deposito";

const pedido = (id, servicio, preparacion) => ({
  id, key: String(id), displayId: String(id).padStart(7, "0"), tipo: "insumos",
  empleadoNombre: "Velez, Yohana", servicioNombre: servicio,
  fecha: "2026-11-16 10:00:00", total: 100, status: "preparing",
  items: [{ productId: id, nombre: "LAMPAZO", cantidad: 10, precio: 10 }],
  preparacion,
});
const PEDIDOS = [
  pedido(2001, "ESCUELA A", { preparador: "Juan Perez", terminada: false, preparadas: 3, pedidas: 10 }),
  pedido(2002, "ESCUELA B", { preparador: "Ana Diaz", terminada: true, preparadas: 10, pedidas: 10 }),
  pedido(2003, "ESCUELA C", null),
];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.get.mockImplementation((url) =>
    Promise.resolve({ data: url.includes("/deposito/orders") ? PEDIDOS : [] }));
  api.put.mockResolvedValue({ data: { ok: true } });
});

const enPreparacion = async (user) => {
  render(<MemoryRouter><Deposito /></MemoryRouter>);
  await user.click(await screen.findByRole("button", { name: "En preparación" }));
  return (await screen.findByText("#0002001")).closest("tr");
};

describe("Depósito — preparación vista desde Pedidos", () => {
  it("dice quién lo está preparando y cuánto lleva", async () => {
    const user = userEvent.setup({ delay: null });
    const fila = await enPreparacion(user);
    expect(within(fila).getByText(/Preparando Juan Perez \(3\/10\)/)).toBeInTheDocument();
  });

  it("dice cuándo el preparador ya terminó y se puede cerrar", async () => {
    const user = userEvent.setup({ delay: null });
    await enPreparacion(user);
    const fila = screen.getByText("#0002002").closest("tr");
    expect(within(fila).getByText(/Preparado por Ana Diaz: listo para cerrar/)).toBeInTheDocument();
  });

  it("a medio preparar, pregunta antes de cerrar; si dice que no, no cierra", async () => {
    const user = userEvent.setup({ delay: null });
    const fila = await enPreparacion(user);
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);

    await user.click(within(fila).getByRole("button", { name: "Cerrar pedido" }));

    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(confirmar.mock.calls[0][0]).toMatch(/Juan Perez todavía lo está preparando \(3 de 10/);
    expect(confirmar.mock.calls[0][0]).toMatch(/se le cobra al servicio todo lo pedido/);
    expect(api.put).not.toHaveBeenCalled();
  });

  it("si el preparador ya terminó, o nadie lo prepara, cierra sin preguntar", async () => {
    const user = userEvent.setup({ delay: null });
    await enPreparacion(user);
    const confirmar = vi.spyOn(window, "confirm");

    await user.click(within(screen.getByText("#0002002").closest("tr")).getByRole("button", { name: "Cerrar pedido" }));
    await user.click(within(screen.getByText("#0002003").closest("tr")).getByRole("button", { name: "Cerrar pedido" }));

    expect(confirmar).not.toHaveBeenCalled();
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
  });
});
