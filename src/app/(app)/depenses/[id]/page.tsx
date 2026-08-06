import Link from "next/link";
import { notFound } from "next/navigation";
import { ExpenseStatusBadge } from "@/components/expenses/status-badge";
import {
  CancelExpenseForm,
  ExpensePaymentForm,
  ExpenseRefundForm,
} from "@/components/expenses/financial-forms";
import { ConfirmSubmitButton } from "@/components/sales/confirm-submit-button";
import {
  deleteDraftExpenseDocumentAction,
  deleteExpenseDraftAction,
  uploadExpenseDocumentAction,
  validateExpenseAction,
} from "@/lib/expenses/actions";
import {
  calculateExpenseFinancials,
  getRefundableAmount,
} from "@/lib/expenses/calculations";
import {
  documentKindLabels,
  expenseCategoryLabels,
  expenseCostBehaviorLabels,
  expenseNatureLabels,
  expensePaymentMethodLabels,
  expenseRefundKindLabels,
} from "@/lib/expenses/labels";
import { getExpense } from "@/lib/expenses/queries";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { formatEuroCents } from "@/lib/sales/calculations";
import { formatFrenchDate } from "@/lib/utils/format";
const messages: Record<string, string> = {
  creee: "Le brouillon a été créé.",
  modifiee: "Le brouillon a été modifié.",
  validee: "La dépense est validée et désormais figée.",
  paiement: "Le paiement définitif a été enregistré.",
  remboursement: "Le remboursement définitif a été enregistré.",
  annulee: "La dépense a été annulée.",
  document: "Le justificatif privé a été joint.",
  "document-supprime": "Le justificatif du brouillon a été supprimé.",
};
export default async function ExpensePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const q = await searchParams;
  const { context } = await getAuthenticatedContext();
  if (!context.business) return null;
  const e = await getExpense(context.business.id, id);
  if (!e) notFound();
  const f = calculateExpenseFinancials(e);
  const message =
    typeof q.message === "string" ? messages[q.message] : undefined;
  const error = typeof q.erreur === "string" ? q.erreur : undefined;
  return (
    <>
      <Link className="back-link" href="/depenses">
        ← Toutes les dépenses
      </Link>
      <header className="page-header">
        <div>
          <p className="eyebrow">Dépense</p>
          <h1>{e.reference}</h1>
          <p>
            {formatFrenchDate(e.purchased_on)} ·{" "}
            {e.suppliers?.name ?? "Sans fournisseur"}
          </p>
        </div>
        <ExpenseStatusBadge status={e.status} />
      </header>
      {message && <p className="form-message success">{message}</p>}
      {error && <p className="form-message">{error}</p>}
      {e.status === "draft" && (
        <section className="sale-actions">
          <Link className="secondary-link" href={`/depenses/${e.id}/modifier`}>
            Modifier
          </Link>
          <form action={validateExpenseAction}>
            <input type="hidden" name="expenseId" value={e.id} />
            <ConfirmSubmitButton message="La validation fige définitivement cette dépense. Confirmer ?">
              Valider définitivement
            </ConfirmSubmitButton>
          </form>
          <form action={deleteExpenseDraftAction}>
            <input type="hidden" name="expenseId" value={e.id} />
            <ConfirmSubmitButton
              danger
              message="Supprimer définitivement ce brouillon ?"
            >
              Supprimer
            </ConfirmSubmitButton>
          </form>
        </section>
      )}
      <section className="sale-detail-grid">
        <article className="card">
          <h2>Informations</h2>
          <dl className="detail-list">
            <D t="Description" v={e.description} />
            <D t="Catégorie" v={expenseCategoryLabels[e.category]} />
            <D t="Nature" v={expenseNatureLabels[e.nature]} />
            <D
              t="Comportement"
              v={expenseCostBehaviorLabels[e.cost_behavior]}
            />
            <D
              t="Échéance"
              v={e.due_on ? formatFrenchDate(e.due_on) : "Non renseignée"}
            />
            <D
              t="Référence fournisseur"
              v={e.external_reference ?? "Non renseignée"}
            />
          </dl>
        </article>
        <article className="card">
          <h2>Résumé financier</h2>
          <dl className="detail-list">
            <D t="Total" v={formatEuroCents(f.totalCents)} />
            <D
              t="Part professionnelle pour le suivi interne"
              v={`${e.professional_share_basis_points / 100} % · ${formatEuroCents(f.businessCents)}`}
            />
            <D t="Payé brut" v={formatEuroCents(f.grossPaidCents)} />
            <D
              t="Payé professionnel"
              v={formatEuroCents(f.businessPaidCents)}
            />
            <D t="Remboursé" v={formatEuroCents(f.grossRefundedCents)} />
            <D t="Décaissement net" v={formatEuroCents(f.netCashCents)} />
            <D t="Reste à payer" v={formatEuroCents(f.remainingCents)} />
          </dl>
        </article>
      </section>
      <section className="history-section">
        <div className="section-heading">
          <h2>Paiements et remboursements</h2>
          {e.status === "validated" && f.remainingCents > 0 && (
            <details>
              <summary className="button">Ajouter un paiement</summary>
              <ExpensePaymentForm
                expenseId={e.id}
                remainingCents={f.remainingCents}
              />
            </details>
          )}
        </div>
        {e.expense_payments.length === 0 ? (
          <p className="history-empty">Aucun paiement.</p>
        ) : (
          e.expense_payments.map((p) => {
            const available = getRefundableAmount(p);
            return (
              <article className="payment-card" key={p.id}>
                <header>
                  <div>
                    <strong>{formatEuroCents(p.amount_cents)}</strong>
                    <span>
                      {formatFrenchDate(p.paid_on)} ·{" "}
                      {expensePaymentMethodLabels[p.method]}
                    </span>
                  </div>
                  <strong>
                    Part professionnelle{" "}
                    {formatEuroCents(p.business_amount_cents)}
                  </strong>
                </header>
                {p.expense_refunds.map((r) => (
                  <div className="refund-row" key={r.id}>
                    <span>
                      {expenseRefundKindLabels[r.kind]} ·{" "}
                      {formatFrenchDate(r.received_on)}
                    </span>
                    <strong>− {formatEuroCents(r.amount_cents)}</strong>
                    <small>{r.reason}</small>
                  </div>
                ))}
                {e.status === "validated" && available > 0 && (
                  <details className="action-panel">
                    <summary className="secondary-link">
                      Ajouter un remboursement
                    </summary>
                    <ExpenseRefundForm
                      expenseId={e.id}
                      paymentId={p.id}
                      paidOn={p.paid_on}
                      availableCents={available}
                    />
                  </details>
                )}
              </article>
            );
          })
        )}
      </section>
      <section className="history-section">
        <div className="section-heading">
          <h2>Justificatifs privés</h2>
        </div>
        {e.status !== "cancelled" && (
          <form
            action={uploadExpenseDocumentAction}
            className="compact-form upload-form"
          >
            <input type="hidden" name="expenseId" value={e.id} />
            <div className="field">
              <label htmlFor="kind">Type</label>
              <select className="input" id="kind" name="kind">
                {Object.entries(documentKindLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="file">Fichier privé (10 Mo maximum)</label>
              <input
                className="input"
                id="file"
                name="file"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
                required
              />
            </div>
            <button className="button" type="submit">
              Joindre
            </button>
          </form>
        )}
        {e.expense_documents.length === 0 ? (
          <p className="history-empty">Aucun justificatif.</p>
        ) : (
          e.expense_documents.map(
            (l) =>
              l.documents && (
                <article className="document-row" key={l.id}>
                  <div>
                    <strong>{l.documents.original_name}</strong>
                    <span>
                      {documentKindLabels[l.documents.kind]} ·{" "}
                      {Math.ceil(l.documents.size_bytes / 1024)} Ko
                    </span>
                  </div>
                  {e.status === "draft" && (
                    <form action={deleteDraftExpenseDocumentAction}>
                      <input type="hidden" name="expenseId" value={e.id} />
                      <input
                        type="hidden"
                        name="documentId"
                        value={l.documents.id}
                      />
                      <ConfirmSubmitButton
                        danger
                        message="Retirer définitivement ce justificatif ?"
                      >
                        Retirer
                      </ConfirmSubmitButton>
                    </form>
                  )}
                </article>
              ),
          )
        )}
      </section>
      {e.status === "validated" && f.netCashCents === 0 && (
        <details className="cancellation-panel">
          <summary className="secondary-link danger-text">
            Annuler la dépense
          </summary>
          <CancelExpenseForm expenseId={e.id} />
        </details>
      )}
    </>
  );
}
function D({ t, v }: { t: string; v: string }) {
  return (
    <div>
      <dt>{t}</dt>
      <dd>{v}</dd>
    </div>
  );
}
