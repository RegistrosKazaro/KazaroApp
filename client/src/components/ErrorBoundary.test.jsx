import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, Link } from "react-router-dom";
import ErrorBoundary from "./ErrorBoundary";

function Rompe() { throw new Error("Cannot access 'pad7' before initialization"); }

describe("ErrorBoundary", () => {
  it("si una pantalla falla muestra un aviso en vez de dejarla en blanco", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<MemoryRouter><ErrorBoundary><Rompe /></ErrorBoundary></MemoryRouter>);
    expect(screen.getByRole("alert")).toHaveTextContent("Esta pantalla tuvo un problema");
    expect(screen.getByRole("button", { name: "Recargar" })).toBeInTheDocument();
  });

  it("sin errores no se nota", () => {
    render(<MemoryRouter><ErrorBoundary><p>Mis pedidos</p></ErrorBoundary></MemoryRouter>);
    expect(screen.getByText("Mis pedidos")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("al ir a otra pantalla se limpia el error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup({ delay: null });
    render(
      <MemoryRouter initialEntries={["/rota"]}>
        <Link to="/sana">ir</Link>
        <ErrorBoundary>
          <Routes>
            <Route path="/rota" element={<Rompe />} />
            <Route path="/sana" element={<p>Todo bien</p>} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByText("ir"));
    expect(screen.getByText("Todo bien")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
