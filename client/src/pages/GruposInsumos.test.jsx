// Grupos de insumos (limpieza / descartables) y la regla por servicio.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api/client", () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ user: { roles: ["admin"], username: "admin" }, loading: false }) }));

import { api } from "../api/client";
import AdminPanel from "./AdminPanel";

const PRODUCTOS = [
  { id: 10, name: "LAVANDINA", code: "004", price: 100, categoryId: 2 },
  { id: 11, name: "DETERGENTE", code: "007", price: 200, categoryId: 2 },
  { id: 12, name: "PAPEL HIGIENICO", code: "900", price: 50, categoryId: 9 },
];
const CATEGORIAS = [{ id: 2, name: "Liquidos", count: 2 }, { id: 9, name: "Papel", count: 1 }];

let grupos = { limpieza: ["10"], descartables: [] };
let reglaServicio = { limpieza: null, descartables: null };

beforeEach(() => {
  vi.clearAllMocks();
  grupos = { limpieza: ["10"], descartables: [] };
  reglaServicio = { limpieza: null, descartables: null };
  api.get.mockImplementation((url) => {
    if (url.includes("/catalog/categories")) return Promise.resolve({ data: CATEGORIAS });
    if (url.includes("/admin/insumo-grupos")) return Promise.resolve({ data: { ok: true, grupos } });
    if (url.includes("/admin/servicio-grupos/")) {
      return Promise.resolve({ data: { ok: true, servicio: { id: 36, name: "HOSPITAL" }, ...reglaServicio, excepciones: [] } });
    }
    if (url.includes("/admin/products")) return Promise.resolve({ data: PRODUCTOS });
    if (url.includes("/admin/services")) return Promise.resolve({ data: [{ id: 36, name: "HOSPITAL EVA PERON" }] });
    if (url.includes("/admin/sp/assignments/")) return Promise.resolve({ data: { productIds: ["10"] } });
    return Promise.resolve({ data: [] });
  });
  api.put.mockResolvedValue({ data: { ok: true, agregados: 2, quitados: 0, recalculo: { servicios: 4 } } });
});

const abrirGrupos = async () => {
  render(<MemoryRouter initialEntries={["/app/admin?tab=insumoGrupos"]}><AdminPanel /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Grupos de insumos" });
  await screen.findByLabelText("LAVANDINA es de limpieza");
};

describe("Grupos de insumos", () => {
  it("muestra lo ya marcado y cuántos quedan sin grupo", async () => {
    await abrirGrupos();
    expect(screen.getByLabelText("LAVANDINA es de limpieza")).toBeChecked();
    expect(screen.getByLabelText("DETERGENTE es de limpieza")).not.toBeChecked();
    const resumen = screen.getByText(/sin grupo/).closest(".muted");
    expect(resumen.textContent.replace(/\s+/g, " ")).toBe("1 de limpieza · 0 descartables · 2 sin grupo");
  });

  it("un insumo puede estar en los dos grupos", async () => {
    const user = userEvent.setup({ delay: null });
    await abrirGrupos();
    await user.click(screen.getByLabelText("LAVANDINA es descartable"));
    expect(screen.getByLabelText("LAVANDINA es de limpieza")).toBeChecked();
    expect(screen.getByLabelText("LAVANDINA es descartable")).toBeChecked();
  });

  it("manda los dos grupos al guardar y avisa cuántos servicios se rehicieron", async () => {
    const user = userEvent.setup({ delay: null });
    await abrirGrupos();
    await user.click(screen.getByLabelText("DETERGENTE es de limpieza"));
    await user.click(screen.getByLabelText("PAPEL HIGIENICO es descartable"));
    await user.click(screen.getByRole("button", { name: "Guardar grupos" }));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
    const limpieza = api.put.mock.calls.find((c) => c[0].endsWith("/limpieza"));
    const desc = api.put.mock.calls.find((c) => c[0].endsWith("/descartables"));
    expect(limpieza[1].productIds.map(String).sort()).toEqual(["10", "11"]);
    expect(desc[1].productIds.map(String)).toEqual(["12"]);
    expect(await screen.findByText(/Se actualizaron los insumos de 4 servicios/)).toBeInTheDocument();
  });

  it("el botón de una categoría entera sólo toca lo que se ve", async () => {
    const user = userEvent.setup({ delay: null });
    await abrirGrupos();
    await user.selectOptions(screen.getByLabelText("Categoría"), "9");
    await user.click(screen.getByRole("button", { name: "Todos a descartables" }));
    await user.click(screen.getByRole("button", { name: "Guardar grupos" }));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
    const desc = api.put.mock.calls.find((c) => c[0].endsWith("/descartables"));
    expect(desc[1].productIds.map(String)).toEqual(["12"]);   // no arrastra los de Liquidos
  });
});

describe("Regla del servicio", () => {
  const abrirServicio = async (user) => {
    render(<MemoryRouter initialEntries={["/app/admin?tab=serviceProducts"]}><AdminPanel /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Servicio ↔ Productos" });
    await user.type(screen.getByLabelText("Buscar servicio"), "hospital");
    await user.click(await screen.findByRole("button", { name: "Elegir" }));
    await screen.findByText("¿Qué le corresponde a este servicio?");
  };

  it("un servicio sin definir lo dice y no cambia nada solo", async () => {
    const user = userEvent.setup({ delay: null });
    await abrirServicio(user);
    expect(screen.getByText("sin definir")).toBeInTheDocument();
    expect(screen.getByText(/Mientras no elijas, la lista de abajo queda como está/)).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("elegir una combinación la manda y avisa qué cambió", async () => {
    const user = userEvent.setup({ delay: null });
    await abrirServicio(user);
    await user.click(screen.getByRole("button", { name: "Sólo limpieza" }));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    const [url, body] = api.put.mock.calls[0];
    expect(url).toBe("/admin/servicio-grupos/36");
    expect(body).toEqual({ limpieza: true, descartables: false });
    expect(await screen.findByText(/2 insumos agregados y 0 quitados/)).toBeInTheDocument();
  });

  it("si el servicio ya tiene regla, queda marcada la opción que corresponde", async () => {
    reglaServicio = { limpieza: true, descartables: true };
    const user = userEvent.setup({ delay: null });
    await abrirServicio(user);
    expect(screen.getByRole("button", { name: "Limpieza y descartables" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Sólo limpieza" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("sin definir")).not.toBeInTheDocument();
  });

  it("en Pazar la regla no aparece y la pantalla sigue andando", async () => {
    api.get.mockImplementation((url) => {
      if (url.includes("/admin/servicio-grupos/")) return Promise.reject({ response: { status: 403 } });
      if (url.includes("/catalog/categories")) return Promise.resolve({ data: CATEGORIAS });
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

    const tabla = await screen.findByLabelText("Filtrar insumos");
    expect(tabla).toBeInTheDocument();
    expect(screen.queryByText("¿Qué le corresponde a este servicio?")).not.toBeInTheDocument();
  });
});
