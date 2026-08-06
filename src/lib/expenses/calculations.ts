import type { ExpenseFinancialSummary, ExpenseStatus, ExpenseTotals } from "@/types/expenses";

export type ExpenseTotalsSource = { status: ExpenseStatus; total_amount_cents: number; business_amount_cents: number; document_count?: number; expense_payments: Array<{ amount_cents:number; business_amount_cents:number; expense_refunds:Array<{ amount_cents:number; business_amount_cents:number }> }> };

function exactInteger(value:number,label:string):bigint {
  if(!Number.isSafeInteger(value))throw new Error(`${label} hors de la plage sûre`);
  return BigInt(value);
}
function safeNumber(value:bigint,label:string):number {
  const result=Number(value);
  if(!Number.isSafeInteger(result))throw new Error(`${label} trop élevé`);
  return result;
}
function roundPositiveRatio(numerator:bigint,denominator:bigint):bigint {
  if(numerator<BigInt(0)||denominator<=BigInt(0))throw new Error("Rapport invalide");
  return (numerator+denominator/BigInt(2))/denominator;
}
export function calculateProfessionalAmount(totalCents:number,basisPoints:number):number {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0 || !Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000) throw new Error("Part professionnelle invalide");
  return safeNumber(roundPositiveRatio(exactInteger(totalCents,"Montant")*BigInt(basisPoints),BigInt(10000)),"Montant professionnel");
}
export function calculateCumulativeProfessionalAllocation(previousGrossCents:number,previousBusinessCents:number,newGrossCents:number,basisPoints:number):number {
  const previousGross=exactInteger(previousGrossCents,"Brut déjà payé");const previousBusiness=exactInteger(previousBusinessCents,"Professionnel déjà payé");const newGross=exactInteger(newGrossCents,"Nouveau paiement");
  if(previousGross<BigInt(0)||previousBusiness<BigInt(0)||newGross<=BigInt(0)||!Number.isInteger(basisPoints)||basisPoints<0||basisPoints>10000)throw new Error("Montant de paiement invalide");
  const allocation=roundPositiveRatio((previousGross+newGross)*BigInt(basisPoints),BigInt(10000))-previousBusiness;
  if(allocation<BigInt(0)||allocation>newGross)throw new Error("Allocation professionnelle incohérente");
  return safeNumber(allocation,"Allocation professionnelle");
}
export function calculateCumulativeRefundAllocation(paymentGrossCents:number,paymentBusinessCents:number,previousRefundGrossCents:number,previousRefundBusinessCents:number,newRefundGrossCents:number):number {
  const paymentGross=exactInteger(paymentGrossCents,"Paiement brut");const paymentBusiness=exactInteger(paymentBusinessCents,"Paiement professionnel");const previousGross=exactInteger(previousRefundGrossCents,"Brut déjà remboursé");const previousBusiness=exactInteger(previousRefundBusinessCents,"Professionnel déjà remboursé");const newGross=exactInteger(newRefundGrossCents,"Nouveau remboursement");
  if(paymentGross<=BigInt(0)||paymentBusiness<BigInt(0)||paymentBusiness>paymentGross||previousGross<BigInt(0)||previousBusiness<BigInt(0)||newGross<=BigInt(0)||previousGross+newGross>paymentGross)throw new Error("Remboursement invalide");
  const allocation=roundPositiveRatio((previousGross+newGross)*paymentBusiness,paymentGross)-previousBusiness;
  if(allocation<BigInt(0)||allocation>newGross||previousBusiness+allocation>paymentBusiness)throw new Error("Allocation de remboursement incohérente");
  return safeNumber(allocation,"Allocation de remboursement");
}
export function calculateExpenseFinancials(expense:ExpenseTotalsSource):ExpenseFinancialSummary {
  const grossPaidCents=expense.expense_payments.reduce((s,p)=>s+p.amount_cents,0);
  const businessPaidCents=expense.expense_payments.reduce((s,p)=>s+p.business_amount_cents,0);
  const grossRefundedCents=expense.expense_payments.reduce((s,p)=>s+p.expense_refunds.reduce((r,x)=>r+x.amount_cents,0),0);
  const businessRefundedCents=expense.expense_payments.reduce((s,p)=>s+p.expense_refunds.reduce((r,x)=>r+x.business_amount_cents,0),0);
  return { totalCents:expense.total_amount_cents,businessCents:expense.business_amount_cents,grossPaidCents,businessPaidCents,grossRefundedCents,businessRefundedCents,netCashCents:grossPaidCents-grossRefundedCents,netBusinessCents:businessPaidCents-businessRefundedCents,remainingCents:expense.status==="cancelled"?0:Math.max(0,expense.total_amount_cents-grossPaidCents) };
}
export function calculateExpenseTotals(expenses:ExpenseTotalsSource[]):ExpenseTotals {
  return expenses.reduce<ExpenseTotals>((t,e)=>{const f=calculateExpenseFinancials(e);if(e.status==="validated"){t.validatedExpensesCents+=e.business_amount_cents;t.remainingCents+=f.remainingCents;if((e.document_count??0)===0)t.missingDocuments++;}t.totalCents+=f.totalCents;t.businessCents+=f.businessCents;t.grossPaidCents+=f.grossPaidCents;t.businessPaidCents+=f.businessPaidCents;t.grossRefundedCents+=f.grossRefundedCents;t.businessRefundedCents+=f.businessRefundedCents;t.netCashCents+=f.netCashCents;t.netBusinessCents+=f.netBusinessCents;return t;},{validatedExpensesCents:0,missingDocuments:0,totalCents:0,businessCents:0,grossPaidCents:0,businessPaidCents:0,grossRefundedCents:0,businessRefundedCents:0,netCashCents:0,netBusinessCents:0,remainingCents:0});
}
export function getRefundableAmount(payment:{amount_cents:number;expense_refunds:Array<{amount_cents:number}>}):number { return payment.amount_cents-payment.expense_refunds.reduce((s,r)=>s+r.amount_cents,0); }
export function assertRefundWithinPayment(payment:{amount_cents:number;expense_refunds:Array<{amount_cents:number}>},amount:number):void { if(amount<=0||amount>getRefundableAmount(payment))throw new Error("Remboursement supérieur au montant disponible"); }
export function calculateMonthlyNetExpenses(payments:Array<{paid_on:string;business_amount_cents:number}>,refunds:Array<{received_on:string;business_amount_cents:number}>,start:string,end:string):number { return payments.filter(p=>p.paid_on>=start&&p.paid_on<end).reduce((s,p)=>s+p.business_amount_cents,0)-refunds.filter(r=>r.received_on>=start&&r.received_on<end).reduce((s,r)=>s+r.business_amount_cents,0); }
export function getParisMonthBounds(date=new Date()):{start:string;end:string}{const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit"}).formatToParts(date);const y=Number(parts.find(p=>p.type==="year")?.value);const m=Number(parts.find(p=>p.type==="month")?.value);const ny=m===12?y+1:y;const nm=m===12?1:m+1;return{start:`${y}-${String(m).padStart(2,"0")}-01`,end:`${ny}-${String(nm).padStart(2,"0")}-01`};}
