// Clasificar servicios: se crean los grupos y las zonas, y cada servicio
// elige el suyo de esas listas.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api/client", () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ user: { roles: ["admin"], username: "admin" }, loading: false }) }));

import { api } from "../api/client";
import AdminPanel from "./AdminPanel";

const SERVICIOS = [
  { id: 36, name: "HOSPITAL EVA PERON", grupo: "MINISTERIO DE SALUD", zona: "CBA" },
  { id: 37, name: "SUPER MAMI 7", grupo: "SUPERMERCADOS", zona: "RIO IV" },
  { id: 38, name: "CLUB TALLERES", grupo: null, zona: null },
];
const GRUPOS = [{ nombre: "MINISTERIO DE SALUD", usados: 1 }, { nombre: "SUPERMERCADOS", usados: 1 }];
const ZONAS = [{ nombre: "CBA", usados: 1 }, { nombre: "RIO IV", usados: 1 }];

let grupos, zonas;

beforeEach(() => {
  vi.clearAllMocks();
  grupos = [...GRUPOS];
  zonas = [...ZONAS];
  api.get.mockImplementation((url) => {
    if (url.includes("/admin/services/clasificacion")) {
      return Promise.resolve({ data: { ok: true, servicios: SERVICIOS, grupos, zonas } });
    }
    return Promise.resolve({ data: [] });
  });
  api.post.mockResolvedValue({ data: { ok: true, grupos, zonas } });
  api.put.mockResolvedValue({ data: { ok: true } });
  api.delete.mockResolvedValue({ data: { ok: true, grupos, zonas } });
});

const abrir = async () => {
  render(<MemoryRouter initialEntries={["/app/admin?tab=clasificar"]}><AdminPanel /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Clasificar servicios" });
  await screen.findByText("HOSPITAL EVA PERON");
};
const panelGrupos = () => screen.getByText("Grupos").closest(".cl-catalogo");
const panelZonas = () => screen.getByText("Zonas").closest(".cl-catalogo");

describe("Clasificar — crear grupos y zonas", () => {
  it("lista los grupos y las zonas con cuántos servicios los usan", async () => {
    await abrir();
    const g = panelGrupos();
    expect(within(g).getByText("MINISTERIO DE SALUD")).toBeInTheDocument();
    expect(within(g).getByRole("button", { name: /^MINISTERIO DE SALUD/ }).textContent).toContain("1");
    expect(within(panelZonas()).getByText("RIO IV")).toBeInTheDocument();
  });

  it("crea un grupo nuevo", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    const g = panelGrupos();
    await user.type(within(g).getByLabelText("Nombre del grupo nuevo"), "COOPERATIVAS");
    await user.click(within(g).getByRole("button", { name: "Agregar" }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0][0]).toBe("/admin/clasificacion/grupo");
    expect(api.post.mock.calls[0][1]).toEqual({ nombre: "COOPERATIVAS" });
  });

  it("crea una zona con Enter", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    await user.type(within(panelZonas()).getByLabelText("Nombre de la zona nuevo"), "UNION{Enter}");

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0][0]).toBe("/admin/clasificacion/zona");
    expect(api.post.mock.calls[0][1]).toEqual({ nombre: "UNION" });
  });

  it("avisa cuántos servicios quedan sueltos antes de borrar", async () => {
    const user = userEvent.setup({ delay: null });
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    await abrir();
    await user.click(within(panelGrupos()).getByRole("button", { name: "Borrar SUPERMERCADOS" }));

    expect(confirmar.mock.calls[0][0]).toMatch(/lo usan 1 servicio, que van a quedar sin grupo/);
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/admin/clasificacion/grupo/SUPERMERCADOS"));
  });

  it("si cancelás, no borra", async () => {
    const user = userEvent.setup({ delay: null });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await abrir();
    await user.click(within(panelGrupos()).getByRole("button", { name: "Borrar SUPERMERCADOS" }));
    expect(api.delete).not.toHaveBeenCalled();
  });

  it("renombrar arrastra a los servicios que lo usaban", async () => {
    const user = userEvent.setup({ delay: null });
    vi.spyOn(window, "prompt").mockReturnValue("SUPERMERCADOS Y KIOSCOS");
    await abrir();
    await user.click(within(panelGrupos()).getByRole("button", { name: /^SUPERMERCADOS/ }));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0][0]).toBe("/admin/clasificacion/grupo/SUPERMERCADOS");
    expect(api.put.mock.calls[0][1]).toEqual({ nombre: "SUPERMERCADOS Y KIOSCOS" });
  });
});

describe("Clasificar — elegir en cada servicio", () => {
  it("cada servicio tiene un desplegable con los grupos creados", async () => {
    await abrir();
    const sel = screen.getByLabelText("Grupo de CLUB TALLERES");
    const opciones = [...sel.options].map((o) => o.textContent);
    expect(opciones).toEqual(["— sin grupo —", "MINISTERIO DE SALUD", "SUPERMERCADOS"]);
    expect(screen.getByLabelText("Grupo de HOSPITAL EVA PERON")).toHaveValue("MINISTERIO DE SALUD");
  });

  it("elegir un grupo lo guarda", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    await user.selectOptions(screen.getByLabelText("Grupo de CLUB TALLERES"), "SUPERMERCADOS");

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0][0]).toBe("/admin/services/38/clasificacion");
    expect(api.put.mock.calls[0][1]).toEqual({ grupo: "SUPERMERCADOS" });
  });

  it("sin grupos creados, el desplegable lo dice y no deja elegir", async () => {
    grupos = [];
    await abrir();
    const sel = screen.getByLabelText("Grupo de CLUB TALLERES");
    expect(sel).toBeDisabled();
    expect(sel.options[0].textContent).toBe("— creá un grupo primero —");
  });

  it("marca los servicios que todavía no tienen grupo", async () => {
    await abrir();
    const fila = screen.getByText("CLUB TALLERES").closest(".t-row");
    expect(fila).toHaveClass("cl-pendiente");
    expect(screen.getByText("HOSPITAL EVA PERON").closest(".t-row")).not.toHaveClass("cl-pendiente");
  });

  it("muestra cuánto falta clasificar", async () => {
    await abrir();
    expect(document.querySelector(".cl-avance-texto").textContent.replace(/\s+/g, " "))
      .toBe("2 de 3 con grupo · 67%");
  });

  it("filtra los que no tienen grupo", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    await user.selectOptions(screen.getByLabelText("Filtrar por grupo"), "sinGrupo");
    expect(screen.getByText("CLUB TALLERES")).toBeInTheDocument();
    expect(screen.queryByText("SUPER MAMI 7")).not.toBeInTheDocument();
  });
});

describe("Clasificar — accesibilidad", () => {
  it("lo que falta clasificar se dice con texto, no sólo con color", async () => {
    await abrir();
    const fila = screen.getByText("CLUB TALLERES").closest(".t-row");
    expect(within(fila).getByText("falta clasificar")).toBeInTheDocument();
    // Los que ya tienen grupo no lo llevan.
    const ok = screen.getByText("HOSPITAL EVA PERON").closest(".t-row");
    expect(within(ok).queryByText("falta clasificar")).not.toBeInTheDocument();
  });

  it("el avance se anuncia como barra de progreso", async () => {
    await abrir();
    const barra = screen.getByRole("progressbar", { name: "Servicios con grupo asignado" });
    expect(barra).toHaveAttribute("aria-valuenow", "2");
    expect(barra).toHaveAttribute("aria-valuemax", "3");
  });

  it("el número de cada etiqueta dice qué cuenta", async () => {
    await abrir();
    const chip = within(panelGrupos()).getByRole("button", { name: /^MINISTERIO DE SALUD/ });
    expect(chip.textContent).toContain("servicios:");
  });

  it("los errores se anuncian solos", async () => {
    const user = userEvent.setup({ delay: null });
    api.post.mockRejectedValue({ response: { data: { error: "Ese grupo ya existe" } } });
    await abrir();
    await user.type(within(panelGrupos()).getByLabelText("Nombre del grupo nuevo"), "PRIVADOS");
    await user.click(within(panelGrupos()).getByRole("button", { name: "Agregar" }));

    const alerta = await screen.findByRole("alert");
    expect(within(alerta).getByText("Ese grupo ya existe")).toBeInTheDocument();
  });
});

describe("Clasificar — en tanda", () => {
  it("pone el grupo elegido a todos los filtrados sin tocar la zona", async () => {
    const user = userEvent.setup({ delay: null });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await abrir();

    await user.selectOptions(screen.getByLabelText("Filtrar por grupo"), "sinGrupo");
    await user.selectOptions(screen.getByLabelText("Valor para todos los filtrados"), "SUPERMERCADOS");
    await user.click(screen.getByRole("button", { name: "Aplicar" }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe("/admin/services/clasificacion/aplicar");
    expect(body.cambios).toEqual([{ servicioId: "38", grupo: "SUPERMERCADOS" }]);
  });

  it("se puede cambiar a zona y usa la lista de zonas", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    await user.selectOptions(screen.getByLabelText("Qué asignar en tanda"), "zona");
    const sel = screen.getByLabelText("Valor para todos los filtrados");
    expect([...sel.options].map((o) => o.textContent)).toEqual(["elegí…", "CBA", "RIO IV"]);
  });
});
