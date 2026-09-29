import { describe, expect, it } from "vitest";
import {
  diasDelPeriodo,
  elegirGranularidad,
  limitesDelPeriodo,
  periodoAnterior,
  periodoDeAtajo,
  periodoValido,
  sumarDias,
  variacionPorcentual,
} from "./periodos";

const HOY = "2026-09-29";

describe("sumarDias", () => {
  it("cruza fin de mes y de año", () => {
    expect(sumarDias("2026-03-01", -1)).toBe("2026-02-28");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("diasDelPeriodo", () => {
  it("cuenta ambos extremos", () => {
    expect(diasDelPeriodo({ inicio: "2026-09-23", fin: "2026-09-29" })).toBe(7);
    expect(diasDelPeriodo({ inicio: "2026-09-29", fin: "2026-09-29" })).toBe(1);
  });
});

describe("periodoDeAtajo", () => {
  it("últimos 7 y 30 días incluyen hoy", () => {
    expect(periodoDeAtajo("7d", HOY)).toEqual({ inicio: "2026-09-23", fin: HOY });
    expect(periodoDeAtajo("30d", HOY)).toEqual({ inicio: "2026-08-31", fin: HOY });
  });

  it("este mes va del 1 a hoy; mes pasado es el mes completo anterior", () => {
    expect(periodoDeAtajo("mes_actual", HOY)).toEqual({ inicio: "2026-09-01", fin: HOY });
    expect(periodoDeAtajo("mes_pasado", HOY)).toEqual({ inicio: "2026-08-01", fin: "2026-08-31" });
  });

  it("mes pasado en enero cruza al año anterior", () => {
    expect(periodoDeAtajo("mes_pasado", "2026-01-15")).toEqual({ inicio: "2025-12-01", fin: "2025-12-31" });
  });

  it("últimos 6 meses y último año arrancan el día 1 del mes correspondiente", () => {
    expect(periodoDeAtajo("6m", HOY)).toEqual({ inicio: "2026-04-01", fin: HOY });
    expect(periodoDeAtajo("1a", HOY)).toEqual({ inicio: "2025-10-01", fin: HOY });
  });

  it("personalizado no define fechas", () => {
    expect(periodoDeAtajo("personalizado", HOY)).toBeNull();
  });
});

describe("periodoAnterior", () => {
  it("tiene el mismo largo y termina el día antes del inicio", () => {
    expect(periodoAnterior({ inicio: "2026-09-23", fin: "2026-09-29" })).toEqual({
      inicio: "2026-09-16",
      fin: "2026-09-22",
    });
    expect(periodoAnterior({ inicio: "2026-08-01", fin: "2026-08-31" })).toEqual({
      inicio: "2026-07-01",
      fin: "2026-07-31",
    });
  });

  it("un solo día compara contra el día anterior", () => {
    expect(periodoAnterior({ inicio: HOY, fin: HOY })).toEqual({ inicio: "2026-09-28", fin: "2026-09-28" });
  });
});

describe("elegirGranularidad", () => {
  const desde = "2026-01-01";
  const conDias = (dias: number) => ({ inicio: desde, fin: sumarDias(desde, dias - 1) });

  it("un solo día es por día", () => {
    expect(elegirGranularidad(conDias(1))).toBe("dia");
  });

  it("hasta 31 días es por día, hasta 200 por semana, más por mes", () => {
    expect(elegirGranularidad(conDias(31))).toBe("dia");
    expect(elegirGranularidad(conDias(32))).toBe("semana");
    expect(elegirGranularidad(conDias(200))).toBe("semana");
    expect(elegirGranularidad(conDias(201))).toBe("mes");
  });
});

describe("limitesDelPeriodo", () => {
  it("va de la medianoche del inicio a la medianoche posterior al fin", () => {
    const { desde, hasta } = limitesDelPeriodo({ inicio: "2026-09-28", fin: "2026-09-29" });
    expect(new Date(hasta).getTime() - new Date(desde).getTime()).toBe(2 * 24 * 60 * 60 * 1000);
    expect(new Date(desde).getHours()).toBe(0);
  });
});

describe("variacionPorcentual", () => {
  it("da el % de cambio con dos decimales", () => {
    expect(variacionPorcentual(3484379.96, 2744574.56)).toBe(26.96);
    expect(variacionPorcentual(50, 100)).toBe(-50);
  });

  it("sin base de comparación (anterior 0) da null, no infinito ni NaN", () => {
    expect(variacionPorcentual(100, 0)).toBeNull();
    expect(variacionPorcentual(0, 0)).toBeNull();
  });
});

describe("periodoValido", () => {
  it("rechaza vacío o inicio posterior al fin", () => {
    expect(periodoValido({ inicio: "", fin: "2026-09-29" })).toBe(false);
    expect(periodoValido({ inicio: "2026-09-30", fin: "2026-09-29" })).toBe(false);
  });

  it("acepta inicio igual al fin", () => {
    expect(periodoValido({ inicio: HOY, fin: HOY })).toBe(true);
  });
});
