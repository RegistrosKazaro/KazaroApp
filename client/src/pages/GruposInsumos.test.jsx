// Rubros de insumos (un rubro por insumo) y la regla por servicio.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api/client", () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ user: { roles: ["admin"], username: "admin" }, loading: false }) }));

import { api } from "../api/client";
import AdminPanel from "./AdminPanel";

const RUBROS = [
  { id: 1, nombre: "Limpieza", criterio: "Lo que usa el operario para limpiar", porServicio: 1, productos: 1, servicios: 2 },
  { id: 2, nombre: "Descartables", criterio: "Lo que se repone", porServicio: 1, productos: 0, servicios: 1 },
  { id: 5, nombre: "Uniformes y EPP", criterio: "Ropa", porServicio: 0, productos: 0, servicios: 0 },
];
const PRODUCTOS = [
  { id: 10, name: "LAVANDINA", code: "004", categoryName: "Liquidos", activo: 1, rubroId: 1, sugeridoId: null },
  { id: 11, name: "DETERGENTE", code: "007", categoryName: "Liquidos", activo: 1, rubroId: null, sugeridoId: 1 },
  { id: 12, name: "PAPEL HIGIENICO", code: "900", categoryName: "Papel", activo: 1, rubroId: null, sugeridoId: 2 },
  { id: 13, name: "EMBUDO", code: "1480", categoryName: "Varios", activo: 1, rubroId: null, sugeridoId: null },
];

let reglaServicio;

beforeEach(() => {
  vi.clearAllMocks();
  reglaServicio = { definido: false, rubros: [] };
  api.get.mockImplementation((url) => {
    if (url === "/admin/rubros") return Promise.resolve({ data: { ok: true, rubros: RUBROS, productos: PRODUCTOS } });
    if (url.includes("/admin/servicio-rubros/")) {
      return Promise.resolve({ data: { ok: true, servicio: { id: 36, name: "HOSPITAL" }, ...reglaServicio, disponibles: RUBROS.filter((r) => r.porServicio), excepciones: [] } });
    }
    if (url.includes("/catalog/categories")) return Promise.resolve({ data: [] });
    if (url.includes("/admin/products")) return Promise.resolve({ data: PRODUCTOS });
    if (url.includes("/admin/services")) return Promise.resolve({ data: [{ id: 36, name: "HOSPITAL EVA PERON" }] });
    if (url.includes("/admin/sp/assignments/")) return Promise.resolve({ data: { productIds: ["10"] } });
    return Promise.resolve({ data: [] });
  });
  api.put.mockResolvedValue({ data: { ok: true, agregados: 2, quitados: 0, recalculo: { servicios: 4 } } });
});

const abrirRubros = async () => {
  render(<MemoryRouter initialEntries={["/app/admin?tab=insumoGrupos"]}><AdminPanel /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Rubros de insumos" });
  await screen.findByLabelText("Rubro de DETERGENTE");
};

describe("Rubros de insumos", () => {
  it("muestra cada rubro con su criterio y el avance", async () => {
    await abrirRubros();
    const fichas = screen.getByRole("list", { name: "Rubros" });
    expect(within(fichas).getByText("Lo que usa el operario para limpiar")).toBeInTheDocument();
    expect(within(fichas).getByText("fuera de la regla")).toBeInTheDocument();
    expect(screen.getByText(/1 de 4 insumos clasificados/)).toBeInTheDocument();
  });

  it("arranca mostrando sólo lo que falta clasificar", async () => {
    await abrirRubros();
    expect(screen.queryByLabelText("Rubro de LAVANDINA")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Rubro de EMBUDO")).toBeInTheDocument();
  });

  it("la sugerencia no cuenta hasta aceptarla", async () => {
    const user = userEvent.setup({ delay: null });
    await abrirRubros();
    expect(screen.getByLabelText("Rubro de DETERGENTE")).toHaveValue("");
    expect(screen.queryByText(/cambio.* sin guardar/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Aceptar Limpieza para DETERGENTE" }));
    expect(screen.getByText("1 cambio sin guardar")).toBeInTheDocument();
  });

  it("aceptar las sugerencias de la lista y guardar manda un rubro por insumo", async () => {
    const user = userEvent.setup({ delay: null });
    await abrirRubros();
    await user.click(screen.getByRole("button", { name: /Aceptar las sugerencias que se ven \(2\)/ }));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    const [url, body] = api.put.mock.calls[0];
    expect(url).toBe("/admin/rubros-productos");
    expect(body.asignaciones).toEqual(expect.arrayContaining([
      { productId: "11", rubroId: 1 },
      { productId: "12", rubroId: 2 },
    ]));
    expect(body.asignaciones).toHaveLength(2);   // el embudo sin sugerencia no se toca
    expect(await screen.findByText(/Se actualizó lo que pueden pedir 4 servicios/)).toBeInTheDocument();
  });

  it("pasa varios elegidos a un rubro de una vez", async () => {
    const user = userEvent.setup({ delay: null });
    await abrirRubros();
    await user.click(screen.getByLabelText("Elegir EMBUDO"));
    await user.click(screen.getByLabelText("Elegir DETERGENTE"));
    await user.selectOptions(screen.getByLabelText("Rubro para los elegidos"), "2");
    await user.click(screen.getByRole("button", { name: "Aplicar a 2" }));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0][1].asignaciones).toEqual(expect.arrayContaining([
      { productId: "13", rubroId: 2 },
      { productId: "11", rubroId: 2 },
    ]));
  });

  it("descartar vuelve todo a como estaba", async () => {
    const user = userEvent.setup({ delay: null });
    await abrirRubros();
    await user.selectOptions(screen.getByLabelText("Rubro de EMBUDO"), "1");
    expect(screen.getByText("1 cambio sin guardar")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Descartar" }));
    expect(screen.queryByText(/sin guardar/)).not.toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("crear un rubro manda nombre, criterio y si entra en la regla", async () => {
    const user = userEvent.setup({ delay: null });
    api.post.mockResolvedValue({ data: { ok: true, id: 9 } });
    await abrirRubros();
    await user.click(screen.getByRole("button", { name: "+ Nuevo rubro" }));
    await user.type(screen.getByLabelText("Nombre"), "Pileta");
    await user.type(screen.getByLabelText("Criterio: qué entra en este rubro"), "Alguicida y cloro de pileta");
    await user.click(screen.getByRole("button", { name: "Crear rubro" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/rubros",
      { nombre: "Pileta", criterio: "Alguicida y cloro de pileta", porServicio: true }));
  });

  it("borrar avisa cuántos insumos y servicios afecta", async () => {
    const user = userEvent.setup({ delay: null });
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    await abrirRubros();
    await user.click(screen.getByRole("button", { name: "Borrar Limpieza" }));
    expect(confirmar.mock.calls[0][0]).toMatch(/1 insumo van a quedar sin clasificar y 2 servicios lo tienen elegido/);
    expect(api.delete).not.toHaveBeenCalled();
    confirmar.mockRestore();
  });

  it("en Pazar avisa que no aplica", async () => {
    api.get.mockImplementation(() => Promise.reject({ response: { status: 403 } }));
    render(<MemoryRouter initialEntries={["/app/admin?tab=insumoGrupos"]}><AdminPanel /></MemoryRouter>);
    expect(await screen.findByText("Los rubros de insumos son sólo de Kazaro.")).toBeInTheDocument();
  });
});

describe("Regla del servicio", () => {
  const abrirServicio = async (user) => {
    render(<MemoryRouter initialEntries={["/app/admin?tab=serviceProducts"]}><AdminPanel /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Servicio ↔ Productos" });
    await user.type(screen.getByLabelText("Buscar servicio"), "hospital");
    await user.click(await screen.findByRole("button", { name: "Elegir" }));
    await screen.findByText("¿Qué rubros lleva este servicio?");
  };

  it("un servicio sin definir lo dice y no cambia nada solo", async () => {
    const user = userEvent.setup({ delay: null });
    await abrirServicio(user);
    expect(screen.getByText("sin definir")).toBeInTheDocument();
    expect(screen.getByText(/Mientras no apliques, la lista de abajo queda como está/)).toBeInTheDocument();
    // Uniformes y EPP no se ofrece: no depende del servicio.
    expect(screen.queryByRole("button", { name: "Uniformes y EPP" })).not.toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("elegir rubros y aplicar los manda y avisa qué cambió", async () => {
    const user = userEvent.setup({ delay: null });
    await abrirServicio(user);
    await user.click(screen.getByRole("button", { name: "Limpieza" }));
    await user.click(screen.getByRole("button", { name: "Descartables" }));
    await user.click(screen.getByRole("button", { name: "Aplicar" }));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    const [url, body] = api.put.mock.calls[0];
    expect(url).toBe("/admin/servicio-rubros/36");
    expect(body.rubros.sort()).toEqual([1, 2]);
    expect(await screen.findByText(/2 insumos agregados y 0 quitados/)).toBeInTheDocument();
  });

  it("si ya tiene regla, sus rubros aparecen prendidos", async () => {
    reglaServicio = { definido: true, rubros: [2] };
    const user = userEvent.setup({ delay: null });
    await abrirServicio(user);
    expect(screen.getByRole("button", { name: "Descartables" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Limpieza" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("sin definir")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aplicar" })).toBeDisabled();   // sin cambios
  });

  it("en Pazar la regla no aparece y la pantalla sigue andando", async () => {
    api.get.mockImplementation((url) => {
      if (url.includes("/admin/servicio-rubros/")) return Promise.reject({ response: { status: 403 } });
      if (url.includes("/catalog/categories")) return Promise.resolve({ data: [] });
      if (url.includes("/admin/products")) return Promise.resolve({ data: PRODUCTOS });
      if (url.includes("/admin/services")) return Promise.resolve({ data: [{ id: 36, name: "HOSPITAL EVA PERON" }] });
      if (url.includes("/admin/sp/assignments/")) return Promise.resolve({ data: { productIds: [] } });
      return Promise.resolve({ data: [] });
    });
    const user = userEvent.setup({ delay: null });
    render(<MemoryRouter initialEntries={["/app/admin?tab=serviceProducts"]}><AdminPanel /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Servicio ↔ Productos" });
    await user.type(screen.getByLabelText("Buscar servicio"), "hospital");
    await user.click(await screen.findByRole("button", { name: "Elegir" }));

    expect(await screen.findByLabelText("Filtrar insumos")).toBeInTheDocument();
    expect(screen.queryByText("¿Qué rubros lleva este servicio?")).not.toBeInTheDocument();
  });
});
