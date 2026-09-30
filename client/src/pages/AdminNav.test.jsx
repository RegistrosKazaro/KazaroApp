// El menú del panel tiene que ser de enlaces de verdad: así cada sección se
// puede abrir en otra pestaña (Ctrl+clic) y trabajar en dos a la vez.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("../api/client", () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ user: { roles: ["admin"], username: "admin" }, loading: false }) }));

import { api } from "../api/client";
import AdminPanel from "./AdminPanel";

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: [] });
});

const abrir = async (entrada = "/app/admin/admin?tab=products") => {
  render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes><Route path="/app/:role/admin" element={<AdminPanel />} /></Routes>
    </MemoryRouter>
  );
  return await screen.findByRole("heading", { name: "Panel de administración" });
};

describe("Menú del panel de administración", () => {
  it("cada sección es un enlace con su dirección propia", async () => {
    await abrir();
    expect(screen.getByRole("link", { name: /Servicio ↔ Productos/ }))
      .toHaveAttribute("href", "/app/admin/admin?tab=serviceProducts");
    expect(screen.getByRole("link", { name: /Asignar servicios/ }))
      .toHaveAttribute("href", "/app/admin/admin?tab=services");
    expect(screen.getByRole("link", { name: /Rubros de insumos/ }))
      .toHaveAttribute("href", "/app/admin/admin?tab=insumoGrupos");
  });

  it("un clic normal cambia de sección sin recargar", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    await user.click(screen.getByRole("link", { name: /Servicio ↔ Productos/ }));
    expect(await screen.findByRole("heading", { name: "Servicio ↔ Productos" })).toBeInTheDocument();
  });

  it("con Ctrl la app no interviene: la abre el navegador en otra pestaña", async () => {
    const user = userEvent.setup({ delay: null });
    await abrir();
    const enlace = screen.getByRole("link", { name: /Rubros de insumos/ });
    await user.keyboard("{Control>}");
    await user.click(enlace);
    await user.keyboard("{/Control}");
    // La sección no cambió: sigue en Productos, y el navegador se encarga del resto.
    expect(screen.queryByRole("heading", { name: "Rubros de insumos" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Productos" })).toBeInTheDocument();
  });

  it("la dirección manda: si se abre con ?tab=, arranca en esa sección", async () => {
    await abrir("/app/admin/admin?tab=insumoGrupos");
    expect(await screen.findByRole("heading", { name: "Rubros de insumos" })).toBeInTheDocument();
  });
});
