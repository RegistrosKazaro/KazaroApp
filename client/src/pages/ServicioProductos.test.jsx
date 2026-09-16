// Sección "Servicio ↔ Productos": filtros por categoría/estado y la vista
// inversa (un insumo → muchos servicios).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api/client", () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ user: { roles: ["admin"], username: "admin" }, loading: false }) }));

import { api } from "../api/client";
import AdminPanel from "./AdminPanel";

const CATEGORIAS = [
  { id: 1, name: "Limpieza", count: 2 },
  { id: 2, name: "Uniformes", count: 1 },
];
const PRODUCTOS = [
  { id: 10, name: "BOLSA NEGRA", code: "004", price: 100, categoryId: 1 },
  { id: 11, name: "LAMPAZO", code: "007", price: 200, categoryId: 1 },
  { id: 12, name: "CAMISA", code: "900", price: 5000, categoryId: 2 },
];
// 60 servicios: obliga a paginar de a 50 en la vista por insumo.
const SERVICIOS = [
  { id: 36, name: "HOSPITAL EVA PERON" },
  { id: 37, name: "SUPER MAMI 7" },
  ...Array.from({ length: 58 }, (_, i) => ({ id: 200 + i, name: `SERVICIO ${i + 1}` })),
];

let asignadosDelServicio = ["10"];
let serviciosDelInsumo = ["36"];

beforeEach(() => {
  vi.clearAllMocks();
  asignadosDelServicio = ["10"];
  serviciosDelInsumo = ["36"];
  api.get.mockImplementation((url) => {
    if (url.includes("/catalog/categories")) return Promise.resolve({ data: CATEGORIAS });
    if (url.includes("/admin/products")) return Promise.resolve({ data: PRODUCTOS });
    if (url.includes("/admin/services")) return Promise.resolve({ data: [{ id: 36, name: "HOSPITAL EVA PERON" }] });
    if (url.includes("/admin/sp/assignments/")) return Promise.resolve({ data: { productIds: asignadosDelServicio } });
    if (url.includes("/admin/sp/by-product/")) {
      return Promise.resolve({ data: { producto: { id: 10, name: "BOLSA NEGRA" }, servicios: SERVICIOS, serviceIds: serviciosDelInsumo } });
    }
    return Promise.resolve({ data: [] });
  });
  api.put.mockResolvedValue({ data: { ok: true, added: 1, removed: 0 } });
});

const abrir = async () => {
  render(<MemoryRouter initialEntries={["/app/admin?tab=serviceProducts"]}><AdminPanel /></MemoryRouter>);
  return await screen.findByRole("heading", { name: "Servicio ↔ Productos" });
};

const irAPorInsumo = async (user) => {
  await user.click(screen.getByRole("tab", { name: "Por insumo" }));
  const fila = (await screen.findByText("BOLSA NEGRA")).closest(".list-row");
  await user.click(within(fila).getByRole("button", { name: "Elegir" }));
};

describe("Servicio ↔ Productos — por servicio", () => {
  const elegirServicio = async (user) => {
    await user.type(screen.getByLabelText("Buscar servicio"), "hospital");
    await user.click(await screen.findByRole("button", { name: "Elegir" }));
    await screen.findByLabelText("Filtrar insumos");
  };

  it("filtra los insumos por categoría", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    await elegirServicio(user);
    expect(screen.getByLabelText("Asignar CAMISA")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Categoría"), "1");
    expect(screen.queryByLabelText("Asignar CAMISA")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Asignar BOLSA NEGRA")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Asignar toda la categoría Limpieza \(2\)/ })).toBeInTheDocument();
  });

  it("muestra sólo los asignados o sólo los que faltan", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    await elegirServicio(user);

    await user.selectOptions(screen.getByLabelText("Estado"), "asignados");
    expect(screen.getByLabelText("Asignar BOLSA NEGRA")).toBeInTheDocument();
    expect(screen.queryByLabelText("Asignar LAMPAZO")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Estado"), "sinAsignar");
    expect(screen.queryByLabelText("Asignar BOLSA NEGRA")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Asignar LAMPAZO")).toBeInTheDocument();
  });

  it("asigna de una toda la categoría que se está viendo", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    await elegirServicio(user);
    await user.selectOptions(screen.getByLabelText("Categoría"), "1");
    await user.click(screen.getByRole("button", { name: /Asignar toda la categoría/ }));
    await user.click(screen.getByRole("button", { name: "Guardar asignaciones" }));

    const enviados = api.put.mock.calls[0][1].productIds.map(String).sort();
    expect(enviados).toEqual(["10", "11"]);       // no toca CAMISA, que es de otra categoría
  });

  it("avisa cuando hay cambios sin guardar y no deja guardar si no hay ninguno", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    await elegirServicio(user);
    expect(screen.getByRole("button", { name: "Sin cambios" })).toBeDisabled();

    await user.click(screen.getByLabelText("Asignar LAMPAZO"));
    expect(screen.getByText(/Tenés cambios sin guardar/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar asignaciones" })).toBeEnabled();
  });
});

describe("Servicio ↔ Productos — por insumo", () => {
  it("elegido el insumo, muestra los servicios y cuáles lo llevan", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    await irAPorInsumo(user);

    expect(await screen.findByText(/Insumo seleccionado/)).toBeInTheDocument();
    expect(screen.getByLabelText("Asignar a HOSPITAL EVA PERON")).toBeChecked();
    expect(screen.getByLabelText("Asignar a SUPER MAMI 7")).not.toBeChecked();
    expect(screen.getByText(/1 de 60 filtrados/)).toBeInTheDocument();
  });

  it("pagina de a 50 servicios", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    await irAPorInsumo(user);
    expect(await screen.findByText(/Mostrando 1–50 de 60/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(screen.getByText(/Mostrando 51–60 de 60/)).toBeInTheDocument();
  });

  it("asigna el insumo a todos los servicios filtrados de una, aunque no estén en pantalla", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    await irAPorInsumo(user);
    await screen.findByText(/Mostrando 1–50 de 60/);

    await user.click(screen.getByRole("button", { name: /Asignar a los 60 servicios/ }));
    await user.click(screen.getByRole("button", { name: "Guardar servicios" }));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    const [url, body] = api.put.mock.calls[0];
    expect(url).toBe("/admin/sp/by-product/10");
    expect(body.serviceIds).toHaveLength(60);      // los 60, no sólo los 50 visibles
  });

  it("el filtro por texto limita lo que toca el botón masivo", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    await irAPorInsumo(user);
    await user.type(screen.getByLabelText("Filtrar servicios"), "super mami");

    await user.click(await screen.findByRole("button", { name: "Asignar a 1 servicio filtrado" }));
    await user.click(screen.getByRole("button", { name: "Guardar servicios" }));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0][1].serviceIds.map(String).sort()).toEqual(["36", "37"]);
  });
});
