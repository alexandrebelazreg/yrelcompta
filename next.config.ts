import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // La règle métier reste 10 Mio par fichier. Cette limite de transport
    // couvre uniquement l'enveloppe multipart de la Server Action.
    serverActions: { bodySizeLimit: "16mb" },
  },
};

export default nextConfig;
