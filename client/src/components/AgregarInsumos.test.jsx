// Agregar insumos desde el carrito, sin volver al catálogo.
//
// Nació para "Repetir este pedido": Yohana repite el pedido del mes pasado de
// una escuela y le suma lo que falta. Lo que se vigila es que lo agregado
// llegue de verdad al carrito, que no ofrezca nada fuera del servicio, y que
// respete las mismas dos reglas que el catálogo: sin stock no se pide, y los
// uniformes no se mezclan con insumos.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../api/client", () => ({ api: { get: vi.fn() } }));

import { api } from "../api/client";
import AgregarInsumos from "./AgregarInsumos";

const CATEGORIAS = [{ id: 9, name: "Varios" }, { id: 3, name: "Bolsa" }, { id: 20, name: "Uniformes" }];
const PRODUCTOS = [
  { id: 58, name: "PAÑO AMARILLO - BALERINA (X UN)", code: "058", price: 288, stock: 4734, categoryId: 9 },
  { id: 8, name: "BOLSA NEGRA 50*60*25 RESIDUO", code: "008", price: 37.24, stock: 6000, categoryId: 3 },
  { id: 77, name: "TRAPO AGOTADO", code: "077", price: 100, stock: 0, categoryId: 9 },
  { id: 300, name: "PANTALON AMBO - T0 (XS)", code: "300", price: 9000, stock: 50, categoryId: 20 },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((url, cfg) => {
    if (url === "/catalog/categories") return Promise.resolve({ data: CATEGORIAS });
    const q = String(cfg?.params?.q || "").toLowerCase();
    return Promise.resolve({ data: PRODUCTOS.filter((p) => p.name.toLowerCase().includes(q.slice(0, 3))) });
  });
});

const abrirYBuscar = async (user, texto, props = {}) => {
  const onAdd = vi.fn();
  render(<AgregarInsumos serviceId={198} cartItems={[]} onAdd={onAdd} {...props} />);
  await user.click(screen.getByRole("button", { name: /Agregar insumos/ }));
  await user.type(screen.getByLabelText("Buscar insumo para agregar"), texto);
  return onAdd;
};

describe("Agregar insumos al pedido", () => {
  it("busca sólo dentro de los insumos del servicio", async () => {
    const user = userEvent.setup();
    await abrirYBuscar(user, "paño");

    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/catalog/products", {
      params: { catId: "__all__", q: "paño", serviceId: 198 },
    }));
  });

  it("al tocar un resultado lo agrega con cantidad 1 y su categoría", async () => {
    const user = userEvent.setup();
    const onAdd = await abrirYBuscar(user, "paño");

    await user.click(await screen.findByRole("option", { name: /PAÑO AMARILLO/ }));

    expect(onAdd).toHaveBeenCalledWith({
      productId: 58, name: "PAÑO AMARILLO - BALERINA (X UN)", price: 288, qty: 1,
      stock: 4734, categoryName: "Varios",
    });
    expect(screen.getByRole("status")).toHaveTextContent(/Agregado: PAÑO AMARILLO/);
  });

  it("lo que ya está en el pedido se marca y suma uno más", async () => {
    const user = userEvent.setup();
    const onAdd = await abrirYBuscar(user, "bol", {
      cartItems: [{ productId: 8, name: "BOLSA NEGRA 50*60*25 RESIDUO", qty: 3, categoryName: "" }],
    });

    const opcion = await screen.findByRole("option", { name: /BOLSA NEGRA/ });
    expect(opcion).toHaveTextContent(/ya en el pedido \(3\)/);
    await user.click(opcion);

    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ productId: 8, qty: 1 }));
    expect(screen.getByRole("status")).toHaveTextContent(/Se sumó 1 más/);
  });

  it("lo que no tiene stock no se puede agregar", async () => {
    const user = userEvent.setup();
    const onAdd = await abrirYBuscar(user, "tra");

    const opcion = await screen.findByRole("option", { name: /TRAPO AGOTADO/ });
    expect(opcion).toBeDisabled();
    expect(opcion).toHaveTextContent(/Sin stock/);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("no mezcla uniformes con insumos, y lo dice en rojo", async () => {
    const user = userEvent.setup();
    const onAdd = await abrirYBuscar(user, "pan", {
      cartItems: [{ productId: 58, name: "PAÑO AMARILLO", qty: 1, categoryName: "Varios" }],
    });

    await user.click(await screen.findByRole("option", { name: /PANTALON AMBO/ }));

    expect(onAdd).not.toHaveBeenCalled();
    const aviso = screen.getByRole("status");
    expect(aviso).toHaveTextContent(/uniformes se piden por separado/);
    expect(aviso.style.color).toBe("rgb(185, 28, 28)");
  });

  it("sin servicio elegido el botón está apagado y dice por qué", () => {
    render(<AgregarInsumos serviceId={null} cartItems={[]} onAdd={vi.fn()} disabled />);
    const boton = screen.getByRole("button", { name: /Agregar insumos/ });
    expect(boton).toBeDisabled();
    expect(boton).toHaveAttribute("title", "Elegí un servicio primero");
  });

  it("si no encuentra nada, lo dice en vez de quedar en blanco", async () => {
    api.get.mockImplementation((url) =>
      Promise.resolve({ data: url === "/catalog/categories" ? CATEGORIAS : [] }));
    const user = userEvent.setup();
    await abrirYBuscar(user, "xyz");

    expect(await screen.findByText(/No se encontró “xyz” entre los insumos de este servicio/)).toBeInTheDocument();
  });
});
