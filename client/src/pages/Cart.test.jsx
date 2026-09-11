import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../api/client", () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ user: { nombre: "Eugenia", apellido: "Alvarez", username: "eugenia.alvarez" } }) }));

let carrito = [];
vi.mock("../hooks/useCart", () => ({
  useCart: () => ({
    items: carrito,
    add: vi.fn(), update: vi.fn(), remove: vi.fn(), clear: vi.fn(),
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
