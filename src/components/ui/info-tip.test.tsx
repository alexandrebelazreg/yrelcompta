import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InfoTip } from "./info-tip";

describe("InfoTip", () => {
  it("rend une divulgation native utilisable au clavier et au tactile", () => {
    const html = renderToStaticMarkup(<InfoTip label="Comprendre la métrique">Explication complète</InfoTip>);

    expect(html).toContain('<details class="info-tip">');
    expect(html).toContain('<summary aria-label="Comprendre la métrique">i</summary>');
  });

  it("conserve le contenu explicatif dans le DOM", () => {
    const html = renderToStaticMarkup(<InfoTip label="Informations">Texte réglementaire conservé</InfoTip>);

    expect(html).toContain('<div class="info-tip-panel">Texte réglementaire conservé</div>');
    expect(html).not.toContain("title=");
  });

  it("reste accessible sans dépendre exclusivement du survol", () => {
    const styles = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

    expect(styles).toContain(".info-tip[open] > .info-tip-panel");
    expect(styles).toContain(".info-tip:focus-within > .info-tip-panel");
    expect(styles).toContain("@media (hover: hover)");
  });
});
