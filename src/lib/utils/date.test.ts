import { describe, expect, it } from "vitest";
import { formatDateInputInTimeZone, getTodayInParis } from "./date";

describe("dates de formulaire en Europe/Paris", () => {
  it("passe au 5 août à Paris alors que l'instant est encore le 4 août en UTC", () => {
    expect(getTodayInParis(new Date("2026-08-04T22:30:00.000Z"))).toBe("2026-08-05");
  });

  it("reste au 4 août avant minuit à Paris", () => {
    expect(getTodayInParis(new Date("2026-08-04T21:30:00.000Z"))).toBe("2026-08-04");
  });

  it("gère aussi le décalage horaire d'hiver", () => {
    expect(formatDateInputInTimeZone(new Date("2026-01-04T23:30:00.000Z"), "Europe/Paris")).toBe("2026-01-05");
  });
});
