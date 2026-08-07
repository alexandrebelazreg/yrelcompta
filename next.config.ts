import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/factures/*/pdf": [
      "./node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff",
      "./node_modules/@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff",
    ],
  },
  experimental: {
    // La règle métier reste 10 Mio par fichier. Cette limite de transport
    // couvre uniquement l'enveloppe multipart de la Server Action.
    serverActions: { bodySizeLimit: "16mb" },
  },
};

export default nextConfig;
