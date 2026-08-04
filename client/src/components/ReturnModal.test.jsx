import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../api/client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
import { api } from "../api/client";
import ReturnModal from "./ReturnModal";

const items = [
  { productId: 5, name: "Guantes de nitrilo", code: "GN-1", pedido: 8, devuelto: 3, disponible: 5 },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: { items } });
  api.post.mockResolvedValue({ data: { ok: true } });
});

describe("ReturnModal", () => {
  it("muestra los ítems devolvibles del pedido", async () => {
    render(<ReturnModal order={{ id: 74 }} onClose={() => {}} onDone={() => {}} />);
    expect(await screen.findByText("Guantes de nitrilo")).toBeInTheDocument();
    expect(screen.getByText(/Disponible/)).toBeInTheDocument();
  });

  it("exige un motivo antes de enviar", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ReturnModal order={{ id: 74 }} onClose={() => {}} onDone={() => {}} />);
    await screen.findByText("Guantes de nitrilo");
    fireEvent.change(screen.getByLabelText("Cantidad a devolver"), { target: { value: "2" } });
    await user.click(screen.getByRole("button", { name: /Devolver/i }));
    expect(await screen.findByText(/Elegí un motivo/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("clampea la cantidad al máximo devolvible", async () => {
    render(<ReturnModal order={{ id: 74 }} onClose={() => {}} onDone={() => {}} />);
    await screen.findByText("Guantes de nitrilo");
    const input = screen.getByLabelText("Cantidad a devolver");
    fireEvent.change(input, { target: { value: "99" } });
    expect(input).toHaveValue(5); // disponible = 5
  });

  it("envía la devolución con la cantidad y el motivo elegidos", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ReturnModal order={{ id: 74 }} onClose={() => {}} onDone={() => {}} />);
    await screen.findByText("Guantes de nitrilo");
    fireEvent.change(screen.getByLabelText("Cantidad a devolver"), { target: { value: "2" } });
    await user.click(screen.getByRole("button", { name: "Sobrante" }));
    await user.click(screen.getByRole("button", { name: /Devolver/i }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/orders/returns", {
        pedidoId: 74, productoId: 5, cantidad: 2, motivo: "Sobrante",
      })
    );
  });
});
