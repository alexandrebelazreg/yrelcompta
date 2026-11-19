import { McpToolError } from "./protocol";

/** Vérifie que le contenu correspond au type annoncé (signature des premiers octets). */
export function matchesMimeSignature(bytes: Uint8Array, mimeType: string): boolean {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  switch (mimeType) {
    case "application/pdf": return ascii(0, 5) === "%PDF-";
    case "image/jpeg": return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png": return bytes[0] === 0x89 && ascii(1, 4) === "PNG";
    case "image/webp": return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    case "image/heic": case "image/heif": return ascii(4, 8) === "ftyp";
    default: return false;
  }
}

export function decodeInlineFile(base64: string): Uint8Array {
  const clean = base64.replace(/^data:[^;,]+;base64,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 !== 0) throw new McpToolError("Le contenu n’est pas un base64 valide.");
  return new Uint8Array(Buffer.from(clean, "base64"));
}
