// Mis pedidos: el buscador no puede dejar la pantalla en blanco.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api/client", () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ user: { roles: ["supervisor"], username: "supervisor" }, loading: false }) }));

import { api } from "../api/client";
import MisPedidos from "./MisPedidos";

const hoy = new Date().toISOString().slice(0, 10);
const PEDIDOS = [
  { id: 1028, fecha: `${hoy} 12:00:00`, status: "retirado", servicioNombre: "HOSPITAL EVA PERON", total: 100,
    items: [{ nombre: "BOLSA NEGRA", codigo: "004", cantidad: 2 }] },
  { id: 1053, fecha: `${hoy} 12:00:00`, status: "retirado", servicioNombre: "SUPER MAMI 7", total: 200,
    items: [{ nombre: "LAMPAZO", codigo: "007", cantidad: 1 }] },
  { id: 1171, fecha: `${hoy} 12:00:00`, status: "open", servicioNombre: "CLUB TALLERES", total: 50,
    items: [{ nombre: "LAVANDINA", codigo: "010", cantidad: 3 }] },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: PEDIDOS });
});

const abrirRetirados = async (user) => {
  render(<MemoryRouter><MisPedidos /></MemoryRouter>);
  await user.click(await screen.findByRole("button", { name: "Retirados" }));
  await screen.findByText("#0001028");
};
const buscador = () => screen.getByPlaceholderText(/Buscar por número de pedido/);

describe("Mis pedidos — hora", () => {
  it("muestra la hora argentina, no 3 horas de más", async () => {
    // La base guarda UTC: 15:00 UTC son las 12:00 en Argentina.
    api.get.mockResolvedValue({ data: [
      { id: 2001, fecha: "2026-09-18 15:00:00", status: "open", servicioNombre: "HOSPITAL", total: 1,
        items: [{ nombre: "LAMPAZO", cantidad: 1 }] },
    ] });
    const user = userEvent.setup({ delay: null });
    render(<MemoryRouter><MisPedidos /></MemoryRouter>);
    // "Todo" en la antigüedad, para que el test no dependa de la fecha de hoy.
    await user.selectOptions(await screen.findByRole("combobox"), "0");
    await screen.findByText("#0002001");
    expect(screen.getByText(/18\/09\/2026, 12:00/)).toBeInTheDocument();
    expect(screen.queryByText(/18\/09\/2026, 15:00/)).not.toBeInTheDocument();
  });
});

describe("Mis pedidos — buscador", () => {
  it("buscar por número no deja la pantalla en blanco y encuentra el pedido", async () => {
    const user = userEvent.setup({ delay: null });
    await abrirRetirados(user);
    await user.type(buscador(), "1053");
    expect(buscador()).toBeInTheDocument();
    expect(screen.getByText("#0001053")).toBeInTheDocument();
    expect(screen.queryByText("#0001028")).not.toBeInTheDocument();
  });

  it("encuentra con el número completo con ceros", async () => {
    const user = userEvent.setup({ delay: null });
    await abrirRetirados(user);
    await user.type(buscador(), "0001028");
    expect(screen.getByText("#0001028")).toBeInTheDocument();
    expect(screen.queryByText("#0001053")).not.toBeInTheDocument();
  });

  it("buscar por servicio o insumo sigue andando", async () => {
    const user = userEvent.setup({ delay: null });
    await abrirRetirados(user);
    await user.type(buscador(), "lampazo");
    expect(screen.getByText("#0001053")).toBeInTheDocument();
    expect(screen.queryByText("#0001028")).not.toBeInTheDocument();
  });

  it("también en la solapa de activos", async () => {
    const user = userEvent.setup({ delay: null });
    render(<MemoryRouter><MisPedidos /></MemoryRouter>);
    await screen.findByText("#0001171");
    await user.type(buscador(), "1171");
    expect(screen.getByText("#0001171")).toBeInTheDocument();
  });
});
