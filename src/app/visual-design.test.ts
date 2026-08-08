import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const styles = readFileSync(join(root, "src/app/globals.css"), "utf8");
const shell = readFileSync(join(root, "src/components/layout/app-shell.tsx"), "utf8");
const navigation = readFileSync(join(root, "src/components/layout/navigation.tsx"), "utf8");

describe("identité visuelle Poudré chic", () => {
  it("déclare la palette sémantique et les dimensions communes", () => {
    expect(styles).toContain("--color-bg: #fcfaf8");
    expect(styles).toContain("--color-brand: #a65f78");
    expect(styles).toContain("--color-lavender: #e9e3f4");
    expect(styles).toContain("--color-sage: #dceadd");
    expect(styles).toContain("--color-peach: #f8e3d7");
    expect(styles).toContain("--color-focus-ring: #914c66");
    expect(styles).toContain("--color-warning-border: #ead4b4");
    expect(styles).toContain("--color-danger-hover: #843740");
    expect(styles).toContain("--radius-card: 14px");
    expect(styles).toContain("--radius-control: 10px");
  });

  it("conserve une hiérarchie applicative compacte et un focus visible", () => {
    expect(styles).toMatch(/\.page-header h1 \{[^}]*font-size: 1\.75rem/);
    expect(styles).toMatch(/\.app-content \{[^}]*padding: 2rem/);
    expect(styles).toMatch(/:focus-visible \{[^}]*outline: 3px solid/);
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("ne neutralise pas le focus clavier des champs", () => {
    const pointerFocus = styles.match(/\.input:focus\s*\{([^}]*)\}/)?.[1];
    const keyboardFocus = styles.match(/\.input:focus-visible\s*\{([^}]*)\}/)?.[1];

    expect(pointerFocus).toBeDefined();
    expect(pointerFocus).not.toMatch(/outline\s*:\s*(?:0|none)/i);
    expect(keyboardFocus).toBeDefined();
    expect(keyboardFocus).toMatch(/outline:\s*3px solid var\(--color-focus-ring\)/);
    expect(keyboardFocus).toMatch(/outline-offset:\s*2px/);
  });

  it("maintient la navigation complète sur desktop et mobile", () => {
    for (const label of ["Tableau de bord", "Ventes", "Factures", "Dépenses", "Produits", "Documents", "Registres", "Paramètres"]) {
      expect(navigation).toContain(`"${label}"`);
    }
    expect(shell).toContain('className="sidebar"');
    expect(shell).toContain('className="mobile-header"');
    expect(shell).toContain('className="mobile-nav"');
    expect(shell).toContain("<Navigation />");
  });
});
