import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // La règle métier reste 10 Mio par fichier. Les 2 Mio supplémentaires
    // couvrent uniquement l'enveloppe multipart de la Server Action.
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
