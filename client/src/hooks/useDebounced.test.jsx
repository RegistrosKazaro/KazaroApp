import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useDebounced from "./useDebounced";

describe("useDebounced", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("devuelve el valor recién después del delay", () => {
    const { result, rerender } = renderHook(({ v }) => useDebounced(v, 300), {
      initialProps: { v: "a" },
    });
    expect(result.current).toBe("a");

    rerender({ v: "b" });
    expect(result.current).toBe("a"); // todavía no pasó el delay

    act(() => vi.advanceTimersByTime(299));
    expect(result.current).toBe("a");

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe("b");
  });

  it("reinicia el timer si el valor cambia antes del delay", () => {
    const { result, rerender } = renderHook(({ v }) => useDebounced(v, 300), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    act(() => vi.advanceTimersByTime(200));
    rerender({ v: "c" });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe("a"); // se reinició, aún no llegó a 300 desde "c"
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe("c");
  });
});
