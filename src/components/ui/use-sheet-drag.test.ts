import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { projectMomentum, rubberband, shouldDismissSheet } from "./use-sheet-drag";

describe("geste de fermeture des feuilles", () => {
  it("projette l’élan comme le défilement iOS", () => {
    expect(projectMomentum(0)).toBe(0);
    expect(projectMomentum(1000)).toBeCloseTo(499, 0);
    expect(projectMomentum(-1000)).toBeCloseTo(-499, 0);
  });

  it("ferme sur un geste lent mais long, ou court mais rapide", () => {
    expect(shouldDismissSheet(320, 0, 600)).toBe(true);
    expect(shouldDismissSheet(60, 900, 600)).toBe(true);
  });

  it("revient en place sur un petit geste ou un geste qui remonte", () => {
    expect(shouldDismissSheet(80, 50, 600)).toBe(false);
    expect(shouldDismissSheet(400, -500, 600)).toBe(false);
  });

  it("résiste progressivement au-delà de la limite", () => {
    expect(Math.abs(rubberband(-100, 600))).toBeLessThan(100);
    expect(Math.abs(rubberband(-400, 600))).toBeLessThan(Math.abs(rubberband(-400, 600) * 2));
    expect(Math.abs(rubberband(-400, 600))).toBeGreaterThan(Math.abs(rubberband(-100, 600)));
  });
});

describe("notifications de succès", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it("remplace les messages de succès permanents par une notification temporaire", () => {
    for (const page of ["src/app/(app)/ventes/[id]/page.tsx", "src/app/(app)/produits/[id]/page.tsx", "src/app/(app)/depenses/fournisseurs/page.tsx"]) {
      const source = read(page);
      expect(source).toContain("<FlashToast message=");
      expect(source).not.toContain('className="form-message success"');
    }
  });

  it("annonce la notification et nettoie l’URL", () => {
    const toast = read("src/components/ui/flash-toast.tsx");
    expect(toast).toContain('role="status"');
    expect(toast).toContain('searchParams.delete("message")');
    expect(toast).toContain("replaceState");
  });
});
