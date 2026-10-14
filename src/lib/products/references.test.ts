import { describe, expect, it } from "vitest";
import { normalizeReferencePrefix, suggestNextReference, suggestReferencePrefix } from "./references";

describe("références de matières", () => {
  it("propose un préfixe depuis le nom de catégorie", () => {
    expect(suggestReferencePrefix("Chaîne principale")).toBe("CP");
    expect(suggestReferencePrefix("Chaîne secondaire")).toBe("CS");
    expect(suggestReferencePrefix("Fermoir de sécurité")).toBe("FS");
    expect(suggestReferencePrefix("Perles")).toBe("PER");
    expect(suggestReferencePrefix("  ")).toBe("");
  });

  it("normalise un préfixe saisi", () => {
    expect(normalizeReferencePrefix(" cp-é ")).toBe("CPE");
    expect(normalizeReferencePrefix("abcdefghijkl")).toBe("ABCDEFGHIJ");
  });

  it("propose le prochain numéro libre du préfixe", () => {
    expect(suggestNextReference("CP", [])).toBe("CP-001");
    expect(suggestNextReference("CP", ["CP-001", "cp-007", "CS-020", "CP-ancien", null])).toBe("CP-008");
    expect(suggestNextReference("", ["CP-001"])).toBe("");
  });
});
