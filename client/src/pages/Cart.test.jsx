import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../api/client", () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ user: { nombre: "Eugenia", apellido: "Alvarez", username: "eugenia.alvarez" } }) }));

let carrito = [];
let actualizado = [];
vi.mock("../hooks/useCart", () => ({
  useCart: () => ({
    items: carrito,
    add: vi.fn(), update: (id, q) => actualizado.push([id, q]), remove: vi.fn(), clear: vi.fn(),
    total: carrito.reduce((s, it) => s + it.price * it.qty, 0),
    service: { id: 36, name: "SERVICIO DE PRUEBA" },
  }),
}));

import { api } from "../api/client";
import Cart from "./Cart";

// Presupuesto de $1.000 con tope del 100%: cualquier carrito de más de $1.000 lo supera.
beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((url) =>
    Promise.resolve({ data: url.includes("/budget") ? { budget: 1000, maxPct: 100 } : [] })
  );
});

function renderCart() {
  return render(
    <MemoryRouter initialEntries={["/app/supervisor/cart"]}>
      <Routes><Route path="/app/:role/cart" element={<Cart />} /></Routes>
    </MemoryRouter>
  );
}

describe("Cart — presupuesto y uniformes", () => {
  it("un pedido de uniformes se puede enviar aunque supere el presupuesto", async () => {
    carrito = [{ productId: 1, name: "CAMISA", price: 25000, qty: 4, categoryName: "Uniformes" }];
    renderCart();
    expect(await screen.findByText(/no cuenta para el presupuesto/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar pedido" })).toBeEnabled();
  });

  it("un pedido de insumos que supera el presupuesto sigue bloqueado", async () => {
    carrito = [{ productId: 2, name: "BOLSA", price: 5000, qty: 1, categoryName: "Limpieza" }];
    renderCart();
    const boton = await screen.findByRole("button", { name: /Excede 100% del presupuesto/i });
    expect(boton).toBeDisabled();
  });

  it("un pedido de insumos dentro del presupuesto se puede enviar", async () => {
    carrito = [{ productId: 2, name: "BOLSA", price: 100, qty: 2, categoryName: "Limpieza" }];
    renderCart();
    expect(await screen.findByText("20.00%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar pedido" })).toBeEnabled();
  });
});

describe("Cart — editar la cantidad", () => {
  // El carrito real guarda la cantidad; acá se simula para ver qué queda.
  function montarConCarrito(inicial, stock) {
    carrito = [{ productId: 1, name: "BOLSA NEGRA", price: 100, qty: inicial, stock, categoryName: "Limpieza" }];
    actualizado = [];
    return renderCart();
  }

  it("deja borrar todo el número para escribir otro", async () => {
    const user = userEvent.setup({ delay: null });
    montarConCarrito(4);
    const campo = await screen.findByLabelText("Cantidad de BOLSA NEGRA");
    await user.clear(campo);
    expect(campo).toHaveValue(null);          // queda vacío, no salta a 1
    await user.type(campo, "25");
    expect(campo).toHaveValue(25);
    expect(actualizado.at(-1)).toEqual([1, 25]);
  });

  it("si se deja vacío y se sale, vuelve la cantidad anterior", async () => {
    const user = userEvent.setup({ delay: null });
    montarConCarrito(4);
    const campo = await screen.findByLabelText("Cantidad de BOLSA NEGRA");
    await user.clear(campo);
    await user.tab();
    expect(campo).toHaveValue(4);
  });

  it("no deja pasarse del stock disponible", async () => {
    const user = userEvent.setup({ delay: null });
    montarConCarrito(1, 10);
    const campo = await screen.findByLabelText("Cantidad de BOLSA NEGRA");
    await user.clear(campo);
    await user.type(campo, "99");
    expect(campo).toHaveValue(10);
    expect(actualizado.at(-1)).toEqual([1, 10]);
  });
});
