import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const styles = readFileSync(join(root, "src/app/globals.css"), "utf8");
const shell = readFileSync(join(root, "src/components/layout/app-shell.tsx"), "utf8");
const navigation = readFileSync(join(root, "src/components/layout/navigation.tsx"), "utf8");
const dashboard = readFileSync(join(root, "src/app/(app)/tableau-de-bord/page.tsx"), "utf8");
const sales = readFileSync(join(root, "src/app/(app)/ventes/page.tsx"), "utf8");
const expenses = readFileSync(join(root, "src/app/(app)/depenses/page.tsx"), "utf8");
const products = readFileSync(join(root, "src/app/(app)/produits/page.tsx"), "utf8");
const documents = readFileSync(join(root, "src/app/(app)/documents/page.tsx"), "utf8");
const materials = readFileSync(join(root, "src/app/(app)/produits/matieres/page.tsx"), "utf8");
const suppliers = readFileSync(join(root, "src/app/(app)/depenses/fournisseurs/page.tsx"), "utf8");
const recurrences = readFileSync(join(root, "src/app/(app)/depenses/recurrences/page.tsx"), "utf8");
const recurringForm = readFileSync(join(root, "src/components/expenses/recurring-form.tsx"), "utf8");
const dashboardQueries = readFileSync(join(root, "src/lib/dashboard/queries.ts"), "utf8");
const home = readFileSync(join(root, "src/app/page.tsx"), "utf8");
const settings = readFileSync(join(root, "src/app/(app)/parametres/page.tsx"), "utf8");
const shopifySettings = readFileSync(join(root, "src/app/(app)/parametres/shopify/page.tsx"), "utf8");
const shopifyUi = readFileSync(join(root, "src/components/shopify/shopify-settings.tsx"), "utf8");

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

  it("compacte le tableau de bord et la liste des ventes", () => {
    expect(dashboard).toContain("<MetricCard");
    expect(dashboard).not.toContain('className="dashboard-note"');
    expect(sales).toContain('className="register-table sales-table"');
    expect(sales).toContain('className="sale-mobile-context"');
    expect(sales).not.toContain('className="sale-card"');
  });

  it("présente les dépenses sous forme de lignes compactes", () => {
    expect(expenses).toContain('className="register-table compact-table expense-table"');
    for (const heading of ["Référence", "Fournisseur", "Description", "Montant", "Payé", "Remboursé", "Reste", "Justificatifs"]) {
      expect(expenses).toContain(`<th>${heading}</th>`);
    }
    expect(expenses).toContain('href={`/depenses/${expense.id}`}');
    expect(expenses).not.toContain('className="sale-card"');
  });

  it("présente les produits sous forme de lignes comparables", () => {
    expect(products).toContain('className="register-table compact-table product-table"');
    for (const heading of ["Produit", "SKU", "Catégorie", "État", "Prix de vente", "Coût de fabrication", "Marge estimée"]) {
      expect(products).toContain(`<th>${heading}</th>`);
    }
    expect(products).toContain('href={`/produits/${product.id}`}');
    expect(products).toContain('product-status-${product.is_active ? "active" : "archived"}');
    expect(products).not.toContain('className="product-grid"');
  });

  it("sépare les documents en tableaux compacts sans perdre leurs actions", () => {
    expect(documents).toContain('className="register-table compact-table billing-document-table"');
    expect(documents).toContain('className="register-table compact-table supplier-document-table"');
    expect(documents).toContain('className="register-table compact-table missing-document-table"');
    for (const heading of ["Numéro", "Cliente", "Vente", "Total", "Fichier", "Dépense", "Fournisseur", "Taille", "Action"]) {
      expect(documents).toContain(`<th>${heading}</th>`);
    }
    expect(documents).toContain('href={`/factures/${document.id}`}');
    expect(documents).toContain('href={`/depenses/${document.expenseId}`}');
    expect(documents).not.toContain('className="document-grid"');
  });

  it("compacte les matières sans perdre leurs formulaires ni l’archivage conditionnel", () => {
    expect(materials).toContain('className="register-table compact-table management-table material-table"');
    for (const heading of ["Matière", "Référence", "Unité", "Quantité du lot", "Coût du lot", "Coût indicatif / unité", "Fournisseur", "État", "Actions"]) {
      expect(materials).toContain(`<th>${heading}</th>`);
    }
    expect(materials).toContain("<MaterialForm material={material} suppliers={suppliers}/>");
    expect(materials).toContain("material.is_active && <form action={archiveMaterialAction}");
    expect(materials).not.toContain('className="management-list"');
  });

  it("compacte les fournisseurs en conservant recherche, modification et archivage", () => {
    expect(suppliers).toContain('className="register-table compact-table management-table supplier-table"');
    for (const heading of ["Fournisseur", "État", "Dépenses", "Total validé", "Dernière dépense", "Localisation", "Immatriculation", "Actions"]) {
      expect(suppliers).toContain(`<th>${heading}</th>`);
    }
    expect(suppliers).toContain('name="recherche"');
    expect(suppliers).toContain("<SupplierForm supplier={supplier}/>");
    expect(suppliers).toContain("supplier.is_active && <form action={archiveSupplierAction}");
    expect(suppliers).not.toContain('className="management-list"');
  });

  it("compacte les charges récurrentes et conserve les actions manuelles", () => {
    expect(recurrences).toContain('className="register-table compact-table management-table recurring-table"');
    for (const heading of ["Charge", "Fournisseur", "Fréquence", "Montant prévu", "Prochaine échéance", "Automatique", "État", "Actions"]) {
      expect(recurrences).toContain(`<th>${heading}</th>`);
    }
    expect(recurrences).toContain("<RecurringForm template={template} suppliers={suppliers}/>");
    expect(recurrences).toContain("template.is_active && <>");
    expect(recurrences).toContain("createExpenseFromTemplateAction");
    expect(recurrences).toContain("Générer maintenant");
    expect(recurrences).toContain('name="recurringDueOn" value={template.next_due_on}');
    expect(recurrences).toContain('name="purchasedOn" type="date" defaultValue={today} required');
    expect(recurrences).toContain("archiveRecurringAction");
    expect(recurrences).toContain('template.auto_generate ? "Auto" : "Manuel"');
    expect(recurrences).not.toContain('className="management-list"');
  });

  it("rend la création automatique accessible dans le formulaire", () => {
    expect(recurringForm).toContain('name="autoGenerate"');
    expect(recurringForm).toContain("template?.auto_generate ?? true");
    expect(recurringForm).toContain("Création automatique");
    expect(recurringForm).toContain("À l’échéance, YrelCompta crée automatiquement un brouillon de dépense. Vous gardez la validation définitive.");
  });

  it("signale les brouillons récurrents dans les dépenses et le tableau de bord", () => {
    expect(expenses).toContain("expense.recurring_template_id");
    expect(expenses).toContain("Récurrente");
    expect(dashboard).toContain("Charges récurrentes à vérifier");
    expect(dashboard).toContain("recurringDraftCount > 0");
    expect(dashboardQueries).toContain('.eq("status", "draft")');
    expect(dashboardQueries).toContain('.not("recurring_template_id", "is", null)');
  });

  it("présente les fonctionnalités publiques comme disponibles", () => {
    expect(home).toContain("Les essentiels réunis au même endroit");
    for (const feature of ["Ventes", "Dépenses", "Documents", "Registres"]) expect(home).toContain(`["${feature}",`);
    expect(home).not.toContain("Bientôt dans votre espace");
    expect(home).not.toContain("Fonctionnalité à venir");
  });

  it("intègre Shopify aux paramètres avec une présentation compacte et responsive", () => {
    expect(settings).toContain('href="/parametres/shopify"');
    expect(settings).toContain("Configurer Shopify");
    expect(shopifySettings).toContain("<ConnectedShopify status={status}/>");
    expect(shopifyUi).toContain("<InfoTip");
    expect(shopifyUi).toContain('type="password"');
    expect(shopifyUi).toContain("Tester la connexion");
    expect(shopifyUi).toContain("Vérifier les webhooks");
    expect(shopifyUi).toContain("Remplacer les identifiants");
    expect(shopifyUi).toContain("Déconnecter Shopify");
    expect(styles).toContain(".shopify-status-grid");
    expect(styles).toContain("@media (max-width: 420px) {\n  .shopify-status-grid { grid-template-columns: 1fr; }");
  });
});
