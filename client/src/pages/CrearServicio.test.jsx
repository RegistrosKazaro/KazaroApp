// Buscador y paginado de la sección "Crear servicio" del panel admin.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api/client", () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ user: { roles: ["admin"], username: "admin" }, loading: false }) }));

import { api } from "../api/client";
import AdminPanel from "./AdminPanel";

// 47 servicios: obliga a paginar (20 por página) y deja probar la búsqueda.
const SERVICIOS = [
  { id: 101, name: "HOSPITAL EVA PERON - STA. ROSA" },
  { id: 102, name: "SUPER MAMI 7 - ALTA GRACIA" },
  { id: 103, name: "UNIÓN DE EDUCADORES (UEPC)" },
  ...Array.from({ length: 44 }, (_, i) => ({ id: 200 + i, name: `SERVICIO DE PRUEBA ${i + 1}` })),
];

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((url) => {
    if (url.includes("/admin/services-all")) return Promise.resolve({ data: SERVICIOS });
    return Promise.resolve({ data: [] });
  });
});

const abrir = async () => {
  render(<MemoryRouter initialEntries={["/app/admin?tab=createService"]}><AdminPanel /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Crear servicio" });
  return screen.getByRole("heading", { name: "Crear servicio" }).closest("section");
};
const filas = (sec) => within(sec).getAllByText(/HOSPITAL|SUPER MAMI|UNIÓN|SERVICIO DE PRUEBA/);

describe("Crear servicio — buscar y paginar", () => {
  it("muestra 20 por página y cuántos hay en total", async () => {
    const sec = await abrir();
    expect(filas(sec).length).toBe(20);
    expect(within(sec).getByText("47 servicios")).toBeInTheDocument();
    expect(within(sec).getByText(/Mostrando 1–20 de 47/)).toBeInTheDocument();
    expect(within(sec).getByText(/Página 1 de 3/)).toBeInTheDocument();
  });

  it("pasa a la página siguiente", async () => {
    const user = userEvent.setup({ delay: null });
    const sec = await abrir();
    await user.click(within(sec).getByRole("button", { name: "Página siguiente" }));
    expect(within(sec).getByText(/Mostrando 21–40 de 47/)).toBeInTheDocument();
    await user.click(within(sec).getByRole("button", { name: "Página siguiente" }));
    expect(within(sec).getByText(/Mostrando 41–47 de 47/)).toBeInTheDocument();
    expect(within(sec).getByRole("button", { name: "Página siguiente" })).toBeDisabled();
  });

  it("busca por nombre sin importar acentos ni mayúsculas", async () => {
    const user = userEvent.setup({ delay: null });
    const sec = await abrir();
    await user.type(within(sec).getByLabelText("Buscar servicio"), "union");
    expect(filas(sec).length).toBe(1);
    expect(within(sec).getByText("UNIÓN DE EDUCADORES (UEPC)")).toBeInTheDocument();
    expect(within(sec).getByText("1 de 47 servicios")).toBeInTheDocument();
  });

  it("busca por número de servicio", async () => {
    const user = userEvent.setup({ delay: null });
    const sec = await abrir();
    await user.type(within(sec).getByLabelText("Buscar servicio"), "102");
    expect(within(sec).getByText("SUPER MAMI 7 - ALTA GRACIA")).toBeInTheDocument();
    expect(filas(sec).length).toBe(1);
  });

  it("si la búsqueda no encuentra nada, lo dice", async () => {
    const user = userEvent.setup({ delay: null });
    const sec = await abrir();
    await user.type(within(sec).getByLabelText("Buscar servicio"), "zzzz");
    expect(within(sec).getByText(/Ningún servicio coincide con “zzzz”/)).toBeInTheDocument();
  });

  it("buscar desde una página lejana vuelve a la primera y muestra resultados", async () => {
    const user = userEvent.setup({ delay: null });
    const sec = await abrir();
    await user.click(within(sec).getByRole("button", { name: "Página siguiente" }));
    await user.click(within(sec).getByRole("button", { name: "Página siguiente" }));
    expect(within(sec).getByText(/Página 3 de 3/)).toBeInTheDocument();
    await user.type(within(sec).getByLabelText("Buscar servicio"), "hospital");
    expect(within(sec).getByText("HOSPITAL EVA PERON - STA. ROSA")).toBeInTheDocument();
  });
});
