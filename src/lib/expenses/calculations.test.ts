import { describe,expect,it } from "vitest";
import { assertRefundWithinPayment,calculateExpenseFinancials,calculateExpenseTotals,calculateMonthlyNetExpenses,calculateProfessionalAmount,getParisMonthBounds,type ExpenseTotalsSource } from "./calculations";
const expense=(status:ExpenseTotalsSource["status"],total=10000,paid=0,refunded=0):ExpenseTotalsSource=>({status,total_amount_cents:total,business_amount_cents:total,document_count:0,expense_payments:paid?[{amount_cents:paid,business_amount_cents:paid,expense_refunds:refunded?[{amount_cents:refunded,business_amount_cents:refunded}]:[]}]:[]});
describe("calculs des dépenses",()=>{
 it("exclut le brouillon du reste global",()=>expect(calculateExpenseTotals([expense("draft")]).remainingCents).toBe(0));
 it("compte 100 € validés non payés",()=>expect(calculateExpenseTotals([expense("validated")]).remainingCents).toBe(10000));
 it("laisse 60 € après un paiement de 40 €",()=>expect(calculateExpenseTotals([expense("validated",10000,4000)]).remainingCents).toBe(6000));
 it("ne recrée pas le reste après un remboursement",()=>expect(calculateExpenseTotals([expense("validated",10000,4000,2000)]).remainingCents).toBe(6000));
 it("exclut une dépense annulée",()=>expect(calculateExpenseTotals([expense("cancelled")]).remainingCents).toBe(0));
 it("ramène un paiement complet à zéro",()=>expect(calculateExpenseFinancials(expense("validated",10000,10000)).remainingCents).toBe(0));
 it("refuse un remboursement cumulé supérieur au paiement",()=>expect(()=>assertRefundWithinPayment({amount_cents:4000,expense_refunds:[{amount_cents:3000}]},1001)).toThrow());
 it("calcule 50 % et arrondit au centime supérieur à partir d'un demi-centime",()=>{expect(calculateProfessionalAmount(10000,5000)).toBe(5000);expect(calculateProfessionalAmount(1,5000)).toBe(1);});
 it("calcule le net mensuel et sépare les remboursements hors période",()=>expect(calculateMonthlyNetExpenses([{paid_on:"2026-08-05",business_amount_cents:5000}],[{received_on:"2026-08-10",business_amount_cents:1000},{received_on:"2026-09-01",business_amount_cents:2000}],"2026-08-01","2026-09-01")).toBe(4000));
 it("agrège plus de 1 000 dépenses",()=>expect(calculateExpenseTotals(Array.from({length:1005},()=>expense("validated",100))).validatedExpensesCents).toBe(100500));
 it("détermine le mois à Paris près de minuit été et hiver",()=>{expect(getParisMonthBounds(new Date("2026-07-31T22:30:00Z"))).toEqual({start:"2026-08-01",end:"2026-09-01"});expect(getParisMonthBounds(new Date("2025-12-31T23:30:00Z"))).toEqual({start:"2026-01-01",end:"2026-02-01"});});
});
