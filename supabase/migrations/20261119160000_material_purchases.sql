-- Historique d'achats par matière.
-- Une matière peut être achetée plusieurs fois, chez plusieurs fournisseurs. Le lot de la fiche
-- (package_quantity_milliunits / package_cost_cents), lu par tous les calculs de coût, devient le
-- reflet de l'achat compté dont le coût unitaire est le PLUS ÉLEVÉ (ni le dernier, ni la moyenne).
-- Il n'est plus saisi à la main dès qu'un historique existe. Chaque matière garde au moins un achat
-- compté ; le lot existant est repris comme premier achat, marqué « reprise de la fiche » (source sheet).

create table public.material_purchases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  material_id uuid not null,
  purchased_on date not null,
  supplier_id uuid,
  order_reference text,
  quantity_milliunits bigint not null,
  total_cost_cents bigint not null,
  expense_id uuid,
  excluded boolean not null default false,
  source text not null default 'purchase',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint material_purchases_material_fk foreign key (material_id,business_id) references public.materials(id,business_id) on delete restrict,
  constraint material_purchases_supplier_fk foreign key (supplier_id,business_id) references public.suppliers(id,business_id) on delete restrict,
  constraint material_purchases_expense_fk foreign key (expense_id,business_id) references public.expenses(id,business_id) on delete set null (expense_id),
  constraint material_purchases_quantity_range check (quantity_milliunits between 1 and 9000000000000000),
  constraint material_purchases_cost_range check (total_cost_cents between 1 and 9000000000000),
  constraint material_purchases_reference_length check (order_reference is null or char_length(btrim(order_reference)) between 1 and 200),
  constraint material_purchases_source check (source in ('purchase','sheet')),
  constraint material_purchases_date_range check (purchased_on >= date '2000-01-01')
);
create index material_purchases_material_idx on public.material_purchases(business_id,material_id,purchased_on desc);
create trigger material_purchases_set_updated_at before update on public.material_purchases for each row execute function public.set_updated_at();

alter table public.material_purchases enable row level security;
grant select on table public.material_purchases to authenticated;
revoke insert,update,delete on table public.material_purchases from authenticated,anon;
create policy material_purchases_select_member on public.material_purchases for select to authenticated using (public.is_business_member(business_id));

-- Recalcule le lot de la fiche : l'achat compté au coût unitaire le plus élevé (à égalité, le plus récent).
create function public.refresh_material_reference_lot(p_material_id uuid,p_business_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare q bigint; c bigint;
begin
  select quantity_milliunits,total_cost_cents into q,c from public.material_purchases
  where material_id=p_material_id and business_id=p_business_id and not excluded
  order by total_cost_cents::numeric/quantity_milliunits desc, purchased_on desc, created_at desc limit 1;
  if not found then return; end if;
  perform set_config('yrelcompta.material_lot_refresh','on',true);
  update public.materials set package_quantity_milliunits=q,package_cost_cents=c
  where id=p_material_id and business_id=p_business_id and (package_quantity_milliunits<>q or package_cost_cents<>c);
  perform set_config('yrelcompta.material_lot_refresh','off',true);
end $$;

create function public.material_purchases_refresh_lot() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op in ('UPDATE','DELETE') then perform public.refresh_material_reference_lot(old.material_id,old.business_id); end if;
  if tg_op in ('INSERT','UPDATE') and (tg_op='INSERT' or new.material_id<>old.material_id) then perform public.refresh_material_reference_lot(new.material_id,new.business_id); end if;
  return null;
end $$;
create trigger material_purchases_refresh_lot after insert or update or delete on public.material_purchases for each row execute function public.material_purchases_refresh_lot();

-- Le lot d'une matière qui a un historique ne se modifie plus à la main.
create function public.protect_material_reference_lot() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.package_quantity_milliunits is distinct from old.package_quantity_milliunits or new.package_cost_cents is distinct from old.package_cost_cents)
     and current_setting('yrelcompta.material_lot_refresh',true) is distinct from 'on'
     and exists(select 1 from public.material_purchases p where p.material_id=old.id and p.business_id=old.business_id) then
    raise exception 'material lot comes from purchases' using errcode='55000';
  end if;
  return new;
end $$;
create trigger materials_protect_reference_lot before update of package_quantity_milliunits,package_cost_cents on public.materials for each row execute function public.protect_material_reference_lot();

-- Toute nouvelle matière reçoit son lot de création comme premier achat (« reprise de la fiche »).
create function public.seed_material_sheet_purchase() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.material_purchases(business_id,material_id,purchased_on,supplier_id,quantity_milliunits,total_cost_cents,source,created_by)
  values(new.business_id,new.id,(now() at time zone 'Europe/Paris')::date,new.supplier_id,new.package_quantity_milliunits,new.package_cost_cents,'sheet',new.created_by);
  return null;
end $$;
create trigger materials_seed_sheet_purchase after insert on public.materials for each row execute function public.seed_material_sheet_purchase();

-- Reprise des lots existants (déjà au coût unitaire maximal selon l'utilisatrice).
insert into public.material_purchases(business_id,material_id,purchased_on,supplier_id,quantity_milliunits,total_cost_cents,source,created_by,created_at)
select business_id,id,(created_at at time zone 'Europe/Paris')::date,supplier_id,package_quantity_milliunits,package_cost_cents,'sheet',created_by,created_at from public.materials;

create function public.assert_material_has_counted_purchase(p_material_id uuid,p_business_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.material_purchases where material_id=p_material_id and business_id=p_business_id and not excluded) then
    raise exception 'at least one counted purchase required' using errcode='23514';
  end if;
end $$;

create function public.check_material_purchase_expense(p_business_id uuid,p_expense_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if p_expense_id is not null and not exists(select 1 from public.expenses where id=p_expense_id and business_id=p_business_id and status<>'cancelled') then
    raise exception 'expense not found' using errcode='P0002';
  end if;
end $$;

create function public.add_material_purchase(p_business_id uuid,p_material_id uuid,p_purchased_on date,p_supplier_id uuid,p_new_supplier_name text,p_order_reference text,p_quantity_milliunits bigint,p_total_cost_cents bigint,p_expense_id uuid,p_excluded boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_product_manager(p_business_id); nid uuid:=gen_random_uuid(); supplier uuid;
begin
  perform 1 from public.materials where id=p_material_id and business_id=p_business_id for update;
  if not found then raise exception 'material not found' using errcode='P0002'; end if;
  perform public.check_material_purchase_expense(p_business_id,p_expense_id);
  supplier:=public.resolve_material_supplier(p_business_id,p_supplier_id,p_new_supplier_name);
  insert into public.material_purchases(id,business_id,material_id,purchased_on,supplier_id,order_reference,quantity_milliunits,total_cost_cents,expense_id,excluded,source,created_by)
  values(nid,p_business_id,p_material_id,p_purchased_on,supplier,nullif(btrim(p_order_reference),''),p_quantity_milliunits,p_total_cost_cents,p_expense_id,coalesce(p_excluded,false),'purchase',actor);
  perform public.assert_material_has_counted_purchase(p_material_id,p_business_id);
  insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,new_data)
  values(p_business_id,actor,'created','material_purchase',nid,jsonb_build_object('material_id',p_material_id,'total_cost_cents',p_total_cost_cents,'quantity_milliunits',p_quantity_milliunits));
  return nid;
end $$;

create function public.update_material_purchase(p_purchase_id uuid,p_business_id uuid,p_purchased_on date,p_supplier_id uuid,p_new_supplier_name text,p_order_reference text,p_quantity_milliunits bigint,p_total_cost_cents bigint,p_expense_id uuid,p_excluded boolean) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_product_manager(p_business_id); material uuid; supplier uuid; previous jsonb;
begin
  select material_id,to_jsonb(p) into material,previous from public.material_purchases p where id=p_purchase_id and business_id=p_business_id;
  if material is null then raise exception 'purchase not found' using errcode='P0002'; end if;
  perform 1 from public.materials where id=material and business_id=p_business_id for update;
  perform 1 from public.material_purchases where id=p_purchase_id for update;
  perform public.check_material_purchase_expense(p_business_id,p_expense_id);
  supplier:=public.resolve_material_supplier(p_business_id,p_supplier_id,p_new_supplier_name);
  update public.material_purchases set purchased_on=p_purchased_on,supplier_id=supplier,order_reference=nullif(btrim(p_order_reference),''),
    quantity_milliunits=p_quantity_milliunits,total_cost_cents=p_total_cost_cents,expense_id=p_expense_id,excluded=coalesce(p_excluded,false)
  where id=p_purchase_id and business_id=p_business_id;
  perform public.assert_material_has_counted_purchase(material,p_business_id);
  insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,old_data,new_data)
  values(p_business_id,actor,'updated','material_purchase',p_purchase_id,previous-'created_by'-'business_id',jsonb_build_object('excluded',coalesce(p_excluded,false),'total_cost_cents',p_total_cost_cents,'quantity_milliunits',p_quantity_milliunits));
end $$;

create function public.delete_material_purchase(p_purchase_id uuid,p_business_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_product_manager(p_business_id); material uuid; previous jsonb;
begin
  select material_id,to_jsonb(p) into material,previous from public.material_purchases p where id=p_purchase_id and business_id=p_business_id;
  if material is null then raise exception 'purchase not found' using errcode='P0002'; end if;
  perform 1 from public.materials where id=material and business_id=p_business_id for update;
  delete from public.material_purchases where id=p_purchase_id and business_id=p_business_id;
  perform public.assert_material_has_counted_purchase(material,p_business_id);
  insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,old_data)
  values(p_business_id,actor,'deleted','material_purchase',p_purchase_id,previous-'created_by'-'business_id');
end $$;

revoke all on function public.refresh_material_reference_lot(uuid,uuid),public.material_purchases_refresh_lot(),public.protect_material_reference_lot(),public.seed_material_sheet_purchase(),public.assert_material_has_counted_purchase(uuid,uuid),public.check_material_purchase_expense(uuid,uuid) from public,anon,authenticated;
revoke all on function public.add_material_purchase(uuid,uuid,date,uuid,text,text,bigint,bigint,uuid,boolean),public.update_material_purchase(uuid,uuid,date,uuid,text,text,bigint,bigint,uuid,boolean),public.delete_material_purchase(uuid,uuid) from public,anon;
grant execute on function public.add_material_purchase(uuid,uuid,date,uuid,text,text,bigint,bigint,uuid,boolean),public.update_material_purchase(uuid,uuid,date,uuid,text,text,bigint,bigint,uuid,boolean),public.delete_material_purchase(uuid,uuid) to authenticated;

comment on table public.material_purchases is 'Historique d''achats par matière ; le lot de la fiche reflète l''achat compté au coût unitaire le plus élevé.';
