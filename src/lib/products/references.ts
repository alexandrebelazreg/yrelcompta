const STOP_WORDS = new Set(["de", "du", "des", "la", "le", "les", "l", "d", "en", "et", "a", "au", "aux", "pour"]);

/** Préfixe stocké : majuscules et chiffres uniquement, 10 caractères au plus. */
export function normalizeReferencePrefix(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
}

/** Propose un préfixe depuis le nom : « Chaîne principale » → CP, « Perles » → PER. */
export function suggestReferencePrefix(name: string): string {
  const words = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word && !STOP_WORDS.has(word));
  if (words.length === 0) return "";
  if (words.length === 1) return normalizeReferencePrefix(words[0].slice(0, 3));
  return normalizeReferencePrefix(words.slice(0, 4).map((word) => word[0]).join(""));
}

/** Prochaine référence libre pour un préfixe : CP-001, puis CP-002… */
export function suggestNextReference(prefix: string, existingReferences: Array<string | null>): string {
  if (!prefix) return "";
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, "i");
  const highest = existingReferences.reduce((max, reference) => {
    const match = reference?.trim().match(pattern);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `${prefix}-${String(highest + 1).padStart(3, "0")}`;
}
