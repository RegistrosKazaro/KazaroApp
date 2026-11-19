// Sección "Pedidos Maralim" (19/11/2026): Ariel elige al entrar entre sus
// servicios comunes y los de Maralim. Un supervisor sin servicios Maralim
// sigue entrando directo, como siempre.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

let usuario = null;
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ user: usuario, loading: false }) }));
vi.mock("../api/client", () => ({ api: { get: vi.fn() } }));

import { api } from "../api/client";
import RoleSelect from "./RoleSelect";

function Donde() {
  const l = useLocation();
  return <div data-testid="donde">{l.pathname + l.search}</div>;
}

const montar = () => render(
  <MemoryRouter initialEntries={["/roles"]}>
    <Routes>
      <Route path="/roles" element={<RoleSelect />} />
      <Route path="*" element={<Donde />} />
    </Routes>
  </MemoryRouter>
);

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  usuario = { id: 9, roles: ["supervisor"] };
});

describe("Sección Pedidos Maralim", () => {
  it("un supervisor sin servicios Maralim entra directo, como antes", async () => {
    api.get.mockResolvedValue({ data: [] });
    montar();
    await waitFor(() => expect(screen.getByTestId("donde").textContent).toBe("/app/supervisor/services"));
  });

  it("con servicios Maralim elige entre Supervisor y Pedidos Maralim", async () => {
    api.get.mockResolvedValue({ data: [{ id: 501, name: "SERVICIO MARALIM" }] });
    const user = userEvent.setup();
    montar();

    expect(await screen.findByRole("button", { name: /Supervisor/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Pedidos Maralim/ }));

    expect(screen.getByTestId("donde").textContent).toBe("/app/supervisor/services?seccion=maralim");
    expect(sessionStorage.getItem("seccion"), "queda recordada al volver por el menú").toBe("maralim");
  });

  it("elegir Supervisor olvida la sección Maralim", async () => {
    sessionStorage.setItem("seccion", "maralim");
    api.get.mockResolvedValue({ data: [{ id: 501, name: "SERVICIO MARALIM" }] });
    const user = userEvent.setup();
    montar();
    await user.click(await screen.findByRole("button", { name: /^Supervisor/ }));
    expect(screen.getByTestId("donde").textContent).toBe("/app/supervisor/services");
    expect(sessionStorage.getItem("seccion")).toBeNull();
  });

  it("si no se puede consultar, entra como supervisor común", async () => {
    api.get.mockRejectedValue(new Error("sin red"));
    montar();
    await waitFor(() => expect(screen.getByTestId("donde").textContent).toBe("/app/supervisor/services"));
  });
});
