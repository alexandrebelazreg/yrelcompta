import Link from "next/link";
import { ReceiptDropzone } from "@/components/expenses/receipt-dropzone";
import { ConfirmSubmitButton } from "@/components/sales/confirm-submit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { FlashToast } from "@/components/ui/flash-toast";
import { InfoTip } from "@/components/ui/info-tip";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { deleteInboxDocumentAction } from "@/lib/expenses/inbox-actions";
import { listInboxDocuments, signDocumentUrl, type InboxDocument } from "@/lib/expenses/inbox-queries";
import { formatFrenchDate } from "@/lib/utils/format";

export default async function ReceiptInboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [query, { context }] = await Promise.all([searchParams, getAuthenticatedContext()]);
  if (!context.business) return null;
  let documents: Array<InboxDocument & { signedUrl: string | null }> = [];
  let unavailable = false;
  try {
    documents = await Promise.all((await listInboxDocuments(context.business.id)).map(async (document) => ({ ...document, signedUrl: await signDocumentUrl(document.storagePath) })));
  } catch {
    unavailable = true;
  }
  const error = typeof query.erreur === "string" ? query.erreur : undefined;
  const message = query.message === "supprime" ? "Le justificatif a été supprimé." : undefined;

  return <>
    <Link className="back-link" href="/documents">← Documents</Link>
    <header className="page-header">
      <div>
        <div className="info-line"><h1>Déposer des justificatifs</h1><InfoTip label="À propos de la boîte de réception">Les fichiers restent privés. Claude, via le connecteur, ou vous-même les rattachez ensuite à une ou plusieurs dépenses.</InfoTip></div>
        <p>Déposez toutes vos factures et confirmations de commande d’un coup : elles attendent ici d’être rattachées à leurs dépenses.</p>
      </div>
    </header>
    {message && <FlashToast message={message}/>}
    {error && <p className="form-message">{error}</p>}
    <ReceiptDropzone businessId={context.business.id}/>
    <section className="history-section">
      <div className="section-heading"><h2>À rattacher{documents.length > 0 ? ` (${documents.length})` : ""}</h2></div>
      {unavailable ? <p className="form-message">La boîte de réception est momentanément indisponible.</p>
        : documents.length === 0 ? <EmptyState title="Aucun justificatif en attente" description="Tous les fichiers déposés sont rattachés à une dépense."/>
        : documents.map((document) => <article className="document-row" key={document.id}>
          <div>
            <strong>{document.originalName}</strong>
            <span>{document.mimeType === "application/pdf" ? "PDF" : "Image"} · {Math.ceil(document.sizeBytes / 1024)} Ko · déposé le {formatFrenchDate(document.createdAt.slice(0, 10))}</span>
          </div>
          <div className="receipt-inbox-actions">
            {document.signedUrl && <a className="table-action-link" href={document.signedUrl} target="_blank" rel="noreferrer">Ouvrir</a>}
            <form action={deleteInboxDocumentAction}>
              <input type="hidden" name="documentId" value={document.id}/>
              <ConfirmSubmitButton danger message="Supprimer définitivement ce fichier déposé ?">Supprimer</ConfirmSubmitButton>
            </form>
          </div>
        </article>)}
    </section>
  </>;
}
