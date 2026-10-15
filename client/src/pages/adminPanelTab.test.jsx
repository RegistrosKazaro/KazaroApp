// La solapa del panel no se escribe en la dirección.
//
// Antes, moverse entre secciones dejaba ?tab=control en la barra. No era una
// vulnerabilidad —el permiso lo decide el rol, que el servidor lee de la base
// en cada pedido— pero no aporta nada tenerlo a la vista.
//
// Se sigue LEYENDO al entrar, y eso no se puede sacar: los ítems del menú son
// enlaces de verdad para poder abrir una sección en otra pestaña, y hay
// secciones fuera del menú (NAV_OCULTOS) que no tienen otra puerta.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

vi.mock("../api/client", () => ({
  api: { get: vi.fn().mockResolvedValue({ data: [] }), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", roles: ["admin"], empresaId: 1 }, loading: false }),
}));

import AdminPanel from "./AdminPanel";

/** Espía la dirección actual, que es lo que se quiere mirar. */
function Direccion({ alCambiar }) {
  const loc = useLocation();
  alCambiar(loc.pathname + loc.search);
  return null;
}

const montar = (entrada) => {
  const vistas = [];
  render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route path="/app/:role/admin" element={
          <>
            <Direccion alCambiar={(d) => vistas.push(d)} />
            <AdminPanel />
          </>
        } />
        <Route path="*" element={<div>fuera</div>} />
      </Routes>
    </MemoryRouter>
  );
  return vistas;
};

beforeEach(() => vi.clearAllMocks());

describe("La solapa del panel y la dirección", () => {
  it("entrar al panel no agrega ?tab= a la dirección", async () => {
    const vistas = montar("/app/administrativo/admin");
    await waitFor(() => expect(vistas.length).toBeGreaterThan(0));
    expect(vistas.at(-1)).toBe("/app/administrativo/admin");
    expect(vistas.some((d) => d.includes("tab="))).toBe(false);
  });

  it("cambiar de sección tampoco la ensucia", async () => {
    const user = userEvent.setup({ delay: null });
    const vistas = montar("/app/administrativo/admin");
    await waitFor(() => expect(vistas.length).toBeGreaterThan(0));

    // Los ítems del menú son enlaces; un clic simple cambia la sección sin navegar.
    const enlaces = await screen.findAllByRole("link");
    const servicios = enlaces.find((a) => /Servicios/i.test(a.textContent || ""));
    if (servicios) await user.click(servicios);

    expect(vistas.at(-1)).toBe("/app/administrativo/admin");
    expect(vistas.some((d) => d.includes("tab="))).toBe(false);
  });

  it("pero si llega con ?tab= lo respeta: hay secciones que no tienen otra puerta", async () => {
    const vistas = montar("/app/administrativo/admin?tab=historial");
    await waitFor(() => expect(vistas.length).toBeGreaterThan(0));
    // No lo borra de la dirección (rompería abrir en otra pestaña) ni lo ignora.
    expect(vistas.at(-1)).toContain("tab=historial");
  });

  it("los enlaces del menú siguen llevando el tab, para abrir en otra pestaña", async () => {
    montar("/app/administrativo/admin");
    const enlaces = await screen.findAllByRole("link");
    const conTab = enlaces.filter((a) => (a.getAttribute("href") || "").includes("?tab="));
    expect(conTab.length).toBeGreaterThan(0);
  });
});
