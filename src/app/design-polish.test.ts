import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const styles = read("src/app/globals.css");

describe("finitions de l’interface", () => {
  it("propose un mode sombre fondé sur les mêmes tokens", () => {
    const dark = styles.match(/@media \(prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}/)?.[1];
    expect(dark).toBeDefined();
    for (const token of ["--color-bg", "--color-surface", "--color-text", "--color-brand", "--color-danger", "--color-danger-solid", "--color-chrome"]) {
      expect(dark).toContain(`${token}:`);
    }
    expect(read("src/app/layout.tsx")).toContain("prefers-color-scheme: dark");
  });

  it("n’utilise plus de couleurs codées en dur hors des tokens", () => {
    const afterRoot = styles.slice(styles.indexOf("}", styles.indexOf(":root")) + 1);
    const withoutDarkTokens = afterRoot.replace(/:root \{[^}]*\}/g, "");
    const hexes = withoutDarkTokens.match(/#[0-9a-fA-F]{3,6}\b/g) ?? [];
    expect(hexes.filter((hex) => hex.toLowerCase() !== "#fff")).toEqual([]);
    expect(withoutDarkTokens).not.toMatch(/:\s*white\s*[;}]/);
  });

  it("utilise la police système et un curseur adapté aux boutons désactivés", () => {
    expect(styles).not.toContain("font-family: Inter");
    expect(styles).toContain(".button:disabled { cursor: not-allowed;");
  });

  it("dessine la navigation avec des icônes SVG plutôt que des caractères", () => {
    for (const file of ["src/components/layout/navigation.tsx", "src/components/layout/mobile-tab-bar.tsx", "src/components/ui/empty-state.tsx"]) {
      const source = read(file);
      expect(source).toContain("<Icon name=");
      expect(source).not.toMatch(/[⌂↗↙◇◎▤▦▧⚙]/);
    }
  });

  it("garde la largeur des boutons pendant l’envoi", () => {
    expect(read("src/components/ui/submit-button.tsx")).toContain("<PendingLabel");
    expect(read("src/components/sales/confirm-submit-button.tsx")).toContain("<PendingLabel");
    expect(styles).toContain(".pending-label.is-pending .pending-label-text { visibility: hidden; }");
  });
});
