import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const pages = {
  matières: read("src/app/(app)/produits/matieres/page.tsx"),
  fournisseurs: read("src/app/(app)/depenses/fournisseurs/page.tsx"),
  récurrences: read("src/app/(app)/depenses/recurrences/page.tsx"),
};

describe("modification dans une fenêtre centrée", () => {
  for (const [name, source] of Object.entries(pages)) {
    it(`ouvre le formulaire de modification des ${name} dans une fenêtre`, () => {
      expect(source).toContain("<EditDialog title={`Modifier ");
      expect(source).not.toContain('<summary className="table-action-link">Modifier</summary>');
    });
  }

  it("utilise une fenêtre modale native refermable", () => {
    const dialog = read("src/components/ui/edit-dialog.tsx");
    expect(dialog).toContain("showModal()");
    expect(dialog).toContain('aria-label="Fermer"');
  });
});
