import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261119160000_material_purchases.sql"), "utf8");
const sql = migration.replace(/\s+/g, " ");
const section = (start: string, end = "end $$;") => sql.slice(sql.indexOf(start), sql.indexOf(end, sql.indexOf(start)));

describe("historique d’achats des matières : migration", () => {
  it("stocke montants et quantités en entiers, isolés par entreprise", () => {
    expect(sql).toContain("quantity_milliunits bigint not null");
    expect(sql).toContain("total_cost_cents bigint not null");
    expect(sql).toContain("foreign key (material_id,business_id) references public.materials(id,business_id)");
    expect(sql).toContain("on delete set null (expense_id)");
    expect(sql).toContain("create policy material_purchases_select_member on public.material_purchases for select to authenticated using (public.is_business_member(business_id))");
    expect(sql).toContain("revoke insert,update,delete on table public.material_purchases from authenticated,anon");
  });

  it("retient le coût unitaire le plus élevé parmi les achats comptés", () => {
    const refresh = section("create function public.refresh_material_reference_lot(");
    expect(refresh).toContain("and not excluded order by total_cost_cents::numeric/quantity_milliunits desc, purchased_on desc");
    expect(refresh).toContain("update public.materials set package_quantity_milliunits=q,package_cost_cents=c");
  });

  it("interdit la modification manuelle du lot d’une matière qui a un historique", () => {
    const guard = section("create function public.protect_material_reference_lot(");
    expect(guard).toContain("current_setting('yrelcompta.material_lot_refresh',true) is distinct from 'on'");
    expect(guard).toContain("raise exception 'material lot comes from purchases'");
  });

  it("reprend les lots existants et ceux des nouvelles matières comme « reprise de la fiche »", () => {
    expect(sql).toContain("select business_id,id,(created_at at time zone 'Europe/Paris')::date,supplier_id,package_quantity_milliunits,package_cost_cents,'sheet',created_by,created_at from public.materials");
    expect(section("create function public.seed_material_sheet_purchase(")).toContain("'sheet'");
  });

  it("garde toujours au moins un achat compté et trace chaque écriture", () => {
    for (const name of ["add_material_purchase", "update_material_purchase", "delete_material_purchase"]) {
      const body = section(`create function public.${name}(`);
      expect(body, name).toContain("public.assert_product_manager(p_business_id)");
      expect(body, name).toContain("public.assert_material_has_counted_purchase(");
      expect(body, name).toContain("insert into public.audit_logs");
    }
  });

  it("n’expose pas les fonctions internes", () => {
    expect(sql).toContain("public.check_material_purchase_expense(uuid,uuid) from public,anon,authenticated;");
    expect(migration).not.toMatch(/to anon/i);
  });
});
