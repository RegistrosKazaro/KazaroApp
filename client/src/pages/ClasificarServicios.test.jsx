// Clasificar servicios: grupo y zona, importados de la planilla y editables a mano.
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

const PREVIO = {
  ok: true,
  total: 4,
  resumen: { listo: 2, igual: 1, sinMatch: 1, ambiguo: 0 },
  grupos: ["SUPERMERCADOS", "CLUBES Y PREDIOS"],
  items: [
    { nombre: "SUPER MAMI 7", grupo: "SUPERMERCADOS", zona: "RIO IV", estado: "listo", servicioId: "37" },
    { nombre: "CLUB TALLERES", grupo: "CLUBES Y PREDIOS", zona: "CBA", estado: "listo", servicioId: "38" },
    { nombre: "HOSPITAL EVA PERON", grupo: "MINISTERIO DE SALUD", zona: "CBA", estado: "igual", servicioId: "36" },
    {
      nombre: "SUPERMERCADO RUFINO - URCA - ADMINISTRATIVOS", grupo: "SUPERMERCADOS", zona: "CBA",
      estado: "sin_match", sugerencia: { id: "99", name: "SUPERMERCADO RUFINO - URCA", parecido: 0.86 },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((url) => {
    if (url.includes("/admin/services/clasificacion")) {
      return Promise.resolve({ data: { ok: true, servicios: SERVICIOS, grupos: ["MINISTERIO DE SALUD", "SUPERMERCADOS"], zonas: ["CBA", "RIO IV"] } });
    }
    return Promise.resolve({ data: [] });
  });
  api.post.mockResolvedValue({ data: PREVIO });
  api.put.mockResolvedValue({ data: { ok: true } });
});

const abrir = async () => {
  render(<MemoryRouter initialEntries={["/app/admin?tab=clasificar"]}><AdminPanel /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Clasificar servicios" });
  await screen.findByText("HOSPITAL EVA PERON");
};

describe("Clasificar servicios — la lista", () => {
  it("muestra el grupo y la zona de cada servicio y cuántos faltan", async () => {
    await abrir();
    expect(screen.getByLabelText("Grupo de HOSPITAL EVA PERON")).toHaveValue("MINISTERIO DE SALUD");
    expect(screen.getByLabelText("Zona de SUPER MAMI 7")).toHaveValue("RIO IV");
    expect(screen.getByLabelText("Grupo de CLUB TALLERES")).toHaveValue("");
    expect(document.querySelector(".sp-contador").textContent.replace(/\s+/g, " "))
      .toBe("3 de 3 servicios · 1 sin grupo");
  });

  it("filtra por grupo", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    await user.selectOptions(screen.getByLabelText("Filtrar por grupo"), "SUPERMERCADOS");
    expect(screen.getByText("SUPER MAMI 7")).toBeInTheDocument();
    expect(screen.queryByText("HOSPITAL EVA PERON")).not.toBeInTheDocument();
  });

  it("filtra los que todavía no tienen grupo", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    await user.selectOptions(screen.getByLabelText("Filtrar por grupo"), "sinGrupo");
    expect(screen.getByText("CLUB TALLERES")).toBeInTheDocument();
    expect(screen.queryByText("SUPER MAMI 7")).not.toBeInTheDocument();
  });

  it("cambiar el grupo de una fila lo guarda al salir del campo", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    const campo = screen.getByLabelText("Grupo de CLUB TALLERES");
    await user.type(campo, "SUPERMERCADOS");
    expect(api.put).not.toHaveBeenCalled();   // todavía no: se guarda al salir
    await user.tab();

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0][0]).toBe("/admin/services/38/clasificacion");
    expect(api.put.mock.calls[0][1]).toEqual({ grupo: "SUPERMERCADOS" });
  });

  it("se puede escribir un grupo que todavía no existe", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    const campo = screen.getByLabelText("Grupo de CLUB TALLERES");
    await user.type(campo, "COOPERATIVAS{Enter}");

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0][1]).toEqual({ grupo: "COOPERATIVAS" });
  });

  it("salir sin cambiar nada no guarda", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    await user.click(screen.getByLabelText("Grupo de HOSPITAL EVA PERON"));
    await user.tab();
    expect(api.put).not.toHaveBeenCalled();
  });
});

describe("Clasificar servicios — en tanda", () => {
  it("pone el grupo a todos los filtrados sin tocarles la zona", async () => {
    const user = userEvent.setup({ delay: null });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await abrir();

    await user.selectOptions(screen.getByLabelText("Filtrar por grupo"), "sinGrupo");
    await user.type(screen.getByLabelText("Grupo para todos los filtrados"), "CLUBES Y PREDIOS");
    await user.click(screen.getByRole("button", { name: "Poner grupo" }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe("/admin/services/clasificacion/aplicar");
    expect(body.cambios).toEqual([{ servicioId: "38", grupo: "CLUBES Y PREDIOS" }]);
    expect(body.cambios[0]).not.toHaveProperty("zona");
  });

  it("si cancelás el aviso no manda nada", async () => {
    const user = userEvent.setup({ delay: null });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await abrir();

    await user.type(screen.getByLabelText("Zona para todos los filtrados"), "CBA");
    await user.click(screen.getByRole("button", { name: "Poner zona" }));
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe("Clasificar servicios — importar la planilla", () => {
  const subirArchivo = async (user) => {
    const archivo = new File(["x"], "servicios.xlsx", { type: "application/vnd.ms-excel" });
    await user.upload(screen.getByLabelText("Planilla de servicios"), archivo);
    await user.click(screen.getByRole("button", { name: "Ver qué cambiaría" }));
    await screen.findByText(/servicios en la planilla/);
  };

  it("muestra el previo sin aplicar nada", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    await subirArchivo(user);

    expect(api.post.mock.calls[0][0]).toBe("/admin/services/clasificacion/preview");
    expect(screen.getByText(/Grupos: SUPERMERCADOS · CLUBES Y PREDIOS/)).toBeInTheDocument();
    // El previo no aplica: sólo se llamó al preview.
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Aplicar 2 servicios" })).toBeInTheDocument();
  });

  it("los que no encontró no se aplican si no los confirmás", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    await subirArchivo(user);

    await user.click(screen.getByRole("button", { name: "Aplicar 2 servicios" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    const cambios = api.post.mock.calls[1][1].cambios;
    expect(cambios.map((c) => c.servicioId).sort()).toEqual(["37", "38"]);   // el dudoso queda afuera
  });

  it("al confirmar una sugerencia, esa también entra", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    await subirArchivo(user);

    expect(screen.getByText(/se parece a: SUPERMERCADO RUFINO - URCA/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Es el mismo" }));
    await user.click(screen.getByRole("button", { name: "Aplicar 3 servicios" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    const cambios = api.post.mock.calls[1][1].cambios;
    expect(cambios.map((c) => c.servicioId).sort()).toEqual(["37", "38", "99"]);
    expect(cambios.find((c) => c.servicioId === "99")).toEqual({ servicioId: "99", grupo: "SUPERMERCADOS", zona: "CBA" });
  });
});
