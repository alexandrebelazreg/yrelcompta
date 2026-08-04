import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "YrelCompta", template: "%s · YrelCompta" },
  description: "La gestion simple de votre micro-entreprise de bijoux.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
