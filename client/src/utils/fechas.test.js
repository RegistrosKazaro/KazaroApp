import { describe, it, expect } from "vitest";
import { msDeFechaDb, formatoFechaHoraAr, diasDesdeFechaDb } from "./fechas";

describe("fechas de la base", () => {
  it("un valor plano de la base es UTC y se muestra en hora argentina", () => {
    // 15:00 UTC = 12:00 en Argentina (UTC-3)
    expect(formatoFechaHoraAr("2026-09-18 15:00:00")).toBe("18/09/2026, 12:00");
  });

  it("de madrugada UTC todavía es el día anterior en Argentina", () => {
    expect(formatoFechaHoraAr("2026-09-18 02:30:00")).toBe("17/09/2026, 23:30");
  });

  it("respeta los valores que ya traen zona", () => {
    expect(formatoFechaHoraAr("2026-05-14T17:21:13.731Z")).toBe("14/05/2026, 14:21");
    expect(formatoFechaHoraAr("2026-09-18T12:00:00-03:00")).toBe("18/09/2026, 12:00");
  });

  it("plano y con Z dan el mismo instante", () => {
    expect(msDeFechaDb("2026-09-18 15:00:00")).toBe(msDeFechaDb("2026-09-18T15:00:00Z"));
  });

  it("vacío o ilegible no rompe", () => {
    expect(Number.isNaN(msDeFechaDb(null))).toBe(true);
    expect(formatoFechaHoraAr("")).toBe("");
    expect(formatoFechaHoraAr("cualquier cosa")).toBe("cualquier cosa");
    expect(diasDesdeFechaDb(undefined)).toBe(0);
  });

  it("cuenta los días desde la fecha real, no 3 horas corrida", () => {
    const ahora = Date.parse("2026-09-20T15:00:00Z");
    expect(diasDesdeFechaDb("2026-09-18 15:00:00", ahora)).toBe(2);
  });
});
