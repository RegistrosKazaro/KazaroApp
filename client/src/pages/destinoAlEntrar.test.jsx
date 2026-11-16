// A dónde cae cada uno al entrar.
//
// El login tenía su propia copia de esta decisión y sólo conocía al
// supervisor: el operario de Picking y el jefe de Depósito con un único rol
// iban al catálogo ("No hay productos") y no llegaban nunca a su pantalla.
// Ahora el login manda siempre a /roles y RoleSelect decide.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

let usuario = null;
const login = vi.fn();
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ user: usuario, loading: false, login }) }));
vi.mock("../hooks/useEmpresa", () => ({ useEmpresa: () => ({ empresa: { slug: "kazaro", nombre: "Kazaro" } }) }));
vi.mock("../components/WavesBackground", () => ({ default: () => null }));

import Login from "./Login";
import RoleSelect from "./RoleSelect";

function Donde() {
  return <div data-testid="donde">{useLocation().pathname}</div>;
}

const montar = (inicio) => render(
  <MemoryRouter initialEntries={[inicio]}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/roles" element={<RoleSelect />} />
      <Route path="*" element={<Donde />} />
    </Routes>
  </MemoryRouter>
);

beforeEach(() => {
  vi.clearAllMocks();
  usuario = null;
});

describe("A dónde va cada uno al entrar", () => {
  it("después del login va a /roles, que es la que decide", async () => {
    login.mockResolvedValue({ roles: ["Picking"] });
    const user = userEvent.setup();
    montar("/login");
    await user.type(screen.getByPlaceholderText("Tu usuario"), "operario");
    await user.type(screen.getByPlaceholderText("Tu contraseña"), "x");
    usuario = { roles: ["Picking"] };   // la sesión ya cargada al llegar a /roles
    await user.click(screen.getByRole("button", { name: "Ingresar" }));

    expect(await screen.findByTestId("donde")).toHaveTextContent("/app/picking/preparacion");
  });

  it.each([
    [["Picking"], "/app/picking/preparacion"],
    [["Deposito"], "/app/deposito"],
    [["Supervisor"], "/app/supervisor/services"],
    [["Administrativo"], "/app/administrativo/products"],
  ])("con un solo rol %j va directo a %s", async (roles, destino) => {
    usuario = { roles };
    montar("/roles");
    expect(await screen.findByTestId("donde")).toHaveTextContent(destino);
  });

  it("con más de un rol se queda a elegir", async () => {
    usuario = { roles: ["Supervisor", "Administrativo"] };
    montar("/roles");
    expect(screen.queryByTestId("donde")).toBeNull();
  });
});
