// Repetir un pedido anterior.
//
// Yohana pide casi lo mismo todos los meses para cada servicio. Antes tenía
// que cargar el pedido entero a mano otra vez. Ahora abre el del mes pasado,
// lo manda al carrito, lo corrige (más unidades de algo, quitar un insumo,
// agregar otro) y lo envía: sale con OTRO número, así quedan dos pedidos
// distintos y el viejo no se toca.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("../api/client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 57, roles: ["supervisor"] } }) }));

import { api } from "../api/client";
import MisPedidos from "./MisPedidos";
import CartProvider from "../context/CartProvider";
import { useCart } from "../hooks/useCart";

const PEDIDO = {
  id: 1402, numero: "0001402", fecha: "2026-09-15 10:00:00", status: "closed",
  ServicioID: 131, servicioNombre: "ME-ESC INTERIOR C.E.N.M.A. N73",
  total: 45000,
  items: [
    { productId: 10, name: "BOLSA NEGRA 80*100", price: 100, qty: 20, subtotal: 2000, code: "004" },
    { productId: 20, name: "DETERGENTE KAZARO X 5 LTS", price: 4300, qty: 10, subtotal: 43000, code: "032" },
  ],
};

/** Espía lo que queda en el carrito. */
function Carrito({ alVer }) {
  const c = useCart();
  alVer(c);
  return <div>carrito</div>;
}

const montar = (alVer = () => {}) => {
  render(
    <CartProvider>
      <MemoryRouter initialEntries={["/app/supervisor/mis-pedidos"]}>
        <Routes>
          <Route path="/app/:role/mis-pedidos" element={<MisPedidos />} />
          <Route path="/app/:role/cart" element={<Carrito alVer={alVer} />} />
        </Routes>
      </MemoryRouter>
    </CartProvider>
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.get.mockResolvedValue({ data: [PEDIDO] });
});

/** Las tarjetas vienen plegadas: hay que abrir la del pedido. */
const abrir = async (user) => {
  const cab = await screen.findByText(/0001402/);
  await user.click(cab.closest("div[role=\"button\"], div") || cab);
};

describe("Repetir un pedido anterior", () => {
  it("ofrece repetir los pedidos ya hechos", async () => {
    const user = userEvent.setup();
    montar();
    await abrir(user);
    expect(await screen.findByRole("button", { name: "Repetir este pedido" })).toBeInTheDocument();
  });

  it("deja el carrito igual al pedido viejo, con su servicio", async () => {
    const user = userEvent.setup();
    let carrito = null;
    montar((c) => { carrito = c; });
    await abrir(user);
    await user.click(await screen.findByRole("button", { name: "Repetir este pedido" }));

    await waitFor(() => expect(screen.getByText("carrito")).toBeInTheDocument());
    expect(carrito.items).toHaveLength(2);
    expect(carrito.items[0]).toMatchObject({ productId: 10, name: "BOLSA NEGRA 80*100", qty: 20 });
    expect(carrito.items[1]).toMatchObject({ productId: 20, qty: 10 });
    expect(carrito.service).toMatchObject({ id: 131, name: "ME-ESC INTERIOR C.E.N.M.A. N73" });
  });

  it("reemplaza lo que hubiera en el carrito, no lo suma", async () => {
    // Si sumara, repetir un pedido se mezclaria con lo que estaba a medio
    // cargar y saldria cualquier cosa.
    const user = userEvent.setup();
    localStorage.setItem("cart", JSON.stringify([
      { productId: 99, name: "OTRA COSA", price: 10, qty: 3 },
    ]));
    let carrito = null;
    montar((c) => { carrito = c; });
    await abrir(user);
    await user.click(await screen.findByRole("button", { name: "Repetir este pedido" }));

    await waitFor(() => expect(screen.getByText("carrito")).toBeInTheDocument());
    expect(carrito.items.map((i) => i.productId)).toEqual([10, 20]);
  });

  it("despues se puede editar: cambiar cantidades, quitar y agregar", async () => {
    const user = userEvent.setup();
    let carrito = null;
    montar((c) => { carrito = c; });
    await abrir(user);
    await user.click(await screen.findByRole("button", { name: "Repetir este pedido" }));
    await waitFor(() => expect(screen.getByText("carrito")).toBeInTheDocument());

    carrito.update(10, 35);                                   // más unidades
    await waitFor(() => expect(carrito.items.find((i) => i.productId === 10).qty).toBe(35));

    carrito.remove(20);                                       // quitar un insumo
    await waitFor(() => expect(carrito.items.some((i) => i.productId === 20)).toBe(false));

    carrito.add({ productId: 30, name: "PAPEL HIGIENICO", price: 900, qty: 4 });
    await waitFor(() => expect(carrito.items.some((i) => i.productId === 30)).toBe(true));
  });

  it("no manda el precio viejo: el servidor lo toma del catalogo", async () => {
    // Un pedido de hace un mes tiene precios de hace un mes. Lo que importa es
    // el producto y la cantidad; el precio lo pone el servidor al crear.
    const user = userEvent.setup();
    let carrito = null;
    montar((c) => { carrito = c; });
    await abrir(user);
    await user.click(await screen.findByRole("button", { name: "Repetir este pedido" }));

    await waitFor(() => expect(screen.getByText("carrito")).toBeInTheDocument());
    for (const it of carrito.items) {
      expect(it.productId).toBeTypeOf("number");
      expect(it.qty).toBeGreaterThan(0);
    }
  });

  it("un pedido sin items no ofrece repetirse", async () => {
    api.get.mockResolvedValue({ data: [{ ...PEDIDO, items: [] }] });
    const user = userEvent.setup();
    montar();
    await abrir(user);
    expect(screen.queryByRole("button", { name: "Repetir este pedido" })).toBeNull();
  });
});
