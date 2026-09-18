// Depósito: pedidos de uniformes por un lado y de insumos por otro.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api/client", () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ user: { roles: ["deposito"], username: "deposito" }, loading: false }) }));

import { api } from "../api/client";
import Deposito from "./Deposito";

const pedido = (id, tipo, servicio) => ({
  id, key: String(id), displayId: String(id).padStart(7, "0"), tipo,
  empleadoNombre: "Barcena, Nicolas", servicioNombre: servicio,
  fecha: "2026-09-18 12:00:00", total: 100, status: "open",
  items: [{ productId: id, nombre: tipo === "uniformes" ? "CAMISA" : "LAMPAZO", cantidad: 1, precio: 100 }],
});
const PEDIDOS = [
  pedido(1001, "insumos", "HOSPITAL EVA PERON"),
  pedido(1002, "insumos", "SUPER MAMI 7"),
  pedido(1003, "uniformes", "CLUB TALLERES"),
  // Sin tipo (servidor sin actualizar): cuenta como insumos.
  { ...pedido(1004, undefined, "EPEC BELL VILLE"), tipo: undefined },
];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.get.mockImplementation((url) =>
    Promise.resolve({ data: url.includes("/deposito/orders") ? PEDIDOS : [] }));
});

const abrir = async () => {
  render(<MemoryRouter><Deposito /></MemoryRouter>);
  await screen.findByRole("group", { name: "Tipo de pedido" });
  await screen.findByText("#0001001");
};

describe("Depósito — uniformes e insumos separados", () => {
  it("arranca en insumos y no muestra los uniformes", async () => {
    await abrir();
    expect(screen.getByRole("button", { name: /Insumos/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("#0001001")).toBeInTheDocument();
    expect(screen.getByText("#0001004")).toBeInTheDocument();
    expect(screen.queryByText("#0001003")).not.toBeInTheDocument();
  });

  it("cada botón dice cuántos pedidos hay", async () => {
    await abrir();
    expect(screen.getByRole("button", { name: /Insumos/ }).textContent).toBe("Insumos3");
    expect(screen.getByRole("button", { name: /Uniformes/ }).textContent).toBe("Uniformes1");
  });

  it("al pasar a uniformes muestra sólo esos", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    await user.click(screen.getByRole("button", { name: /Uniformes/ }));
    expect(screen.getByText("#0001003")).toBeInTheDocument();
    expect(screen.queryByText("#0001001")).not.toBeInTheDocument();
    expect(screen.getByText(/1 de 1 pedido de uniformes/)).toBeInTheDocument();
  });

  it("el filtro de servicio sólo ofrece los del tipo elegido", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    const opciones = () => [...screen.getByRole("combobox", { name: "Servicio" }).options].map((o) => o.textContent);
    expect(opciones()).not.toContain("CLUB TALLERES");
    await user.click(screen.getByRole("button", { name: /Uniformes/ }));
    expect(opciones()).toEqual(["Todos los servicios", "CLUB TALLERES"]);
  });

  it("recuerda la última elección", async () => {
    localStorage.setItem("deposito.tipo", "uniformes");
    render(<MemoryRouter><Deposito /></MemoryRouter>);
    expect(await screen.findByText("#0001003")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Uniformes/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("#0001001")).not.toBeInTheDocument();
  });
});
