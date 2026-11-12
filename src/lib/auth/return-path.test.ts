import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./return-path";

describe("chemin de retour après connexion", () => {
  it("accepte les pages internes et conserve la requête", () => {
    expect(safeReturnPath("/oauth/consent?authorization_id=abc-123")).toBe("/oauth/consent?authorization_id=abc-123");
    expect(safeReturnPath("/produits/matieres")).toBe("/produits/matieres");
  });

  it("refuse les redirections vers un autre site", () => {
    for (const value of ["https://evil.example", "//evil.example", "/\\evil.example", "/%5Cevil", " /produits", "javascript:alert(1)"]) {
      expect(safeReturnPath(value)).toBeNull();
    }
  });

  it("refuse les chemins inconnus ou absents", () => {
    expect(safeReturnPath("/api/mcp")).toBeNull();
    expect(safeReturnPath("/oauth/consentement")).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
    expect(safeReturnPath("")).toBeNull();
  });
});
