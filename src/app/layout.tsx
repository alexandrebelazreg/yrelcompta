import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "YrelCompta", template: "%s · YrelCompta" },
  description: "La gestion simple de votre micro-entreprise de bijoux.",
};

export const viewport: Viewport = { viewportFit: "cover", themeColor: [{ media: "(prefers-color-scheme: light)", color: "#fcfaf8" }, { media: "(prefers-color-scheme: dark)", color: "#191517" }] };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
