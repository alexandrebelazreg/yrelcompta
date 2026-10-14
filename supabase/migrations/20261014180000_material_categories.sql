-- Catégories de matières propres à chaque entreprise (ex. « Chaîne principale » → préfixe CP).
-- Le préfixe sert à pré-remplir la référence interne des matières de la catégorie.
-- Lecture sous RLS ; toutes les écritures passent par les RPC SECURITY DEFINER ci-dessous.

create table public.material_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  name text not null,
  reference_prefix text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint material_categories_id_business_key unique(id,business_id),
  constraint material_categories_name_length check(name = btrim(name) and char_length(name) between 1 and 60),
  constraint material_categories_prefix_format check(reference_prefix ~ '^[A-Z0-9]{1,10}$')
);
create unique index material_categories_business_name_key on public.material_categories(business_id,lower(name));
create unique index material_categories_business_prefix_key on public.material_categories(business_id,reference_prefix);
create trigger material_categories_set_updated_at before update on public.material_categories for each row execute function public.set_updated_at();

alter table public.material_categories enable row level security;
revoke all on table public.material_categories from anon,authenticated;
grant select on table public.material_categories to authenticated;
create policy material_categories_select_member on public.material_categories for select to authenticated using(public.is_business_member(business_id));

alter table public.materials add column category_id uuid;
alter table public.materials add constraint materials_category_business_fk foreign key(category_id,business_id) references public.material_categories(id,business_id) on delete restrict;
create index materials_business_category_idx on public.materials(business_id,category_id);

-- Normalise un préfixe saisi : majuscules, sans espaces ni séparateurs.
create function public.normalize_reference_prefix(p_prefix text) returns text language sql immutable set search_path='' as $$
  select upper(regexp_replace(coalesce(p_prefix,''),'[^A-Za-z0-9]','','g'))
$$;

-- Catégorie choisie ou créée à la volée ; une catégorie de même nom est réutilisée.
create function public.resolve_material_category(p_business_id uuid,p_category_id uuid,p_new_category_name text,p_new_category_prefix text) returns uuid language plpgsql security definer set search_path='' as $$
declare cleaned text:=regexp_replace(btrim(coalesce(p_new_category_name,'')),'\s+',' ','g'); prefix text:=public.normalize_reference_prefix(p_new_category_prefix); existing uuid; nid uuid:=gen_random_uuid();
begin
  if cleaned='' then return p_category_id; end if;
  if p_category_id is not null then raise exception 'ambiguous material category' using errcode='22023'; end if;
  select id into existing from public.material_categories where business_id=p_business_id and lower(name)=lower(cleaned);
  if existing is not null then return existing; end if;
  if char_length(cleaned)>60 or prefix !~ '^[A-Z0-9]{1,10}$' then raise exception 'invalid material category' using errcode='22023'; end if;
  insert into public.material_categories(id,business_id,name,reference_prefix,created_by) values(nid,p_business_id,cleaned,prefix,auth.uid());
  insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,new_data) values(p_business_id,auth.uid(),'created','material_category',nid,jsonb_build_object('name',cleaned,'reference_prefix',prefix));
  return nid;
end $$;

create function public.update_material_category(p_category_id uuid,p_business_id uuid,p_name text,p_reference_prefix text) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_product_manager(p_business_id); cleaned text:=regexp_replace(btrim(coalesce(p_name,'')),'\s+',' ','g'); prefix text:=public.normalize_reference_prefix(p_reference_prefix);
begin
  if char_length(cleaned) not between 1 and 60 or prefix !~ '^[A-Z0-9]{1,10}$' then raise exception 'invalid material category' using errcode='22023'; end if;
  update public.material_categories set name=cleaned,reference_prefix=prefix where id=p_category_id and business_id=p_business_id;
  if not found then raise exception 'material category not found' using errcode='P0002'; end if;
  insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,new_data) values(p_business_id,actor,'updated','material_category',p_category_id,jsonb_build_object('name',cleaned,'reference_prefix',prefix));
end $$;

drop function public.create_material(uuid,text,text,uuid,text,text,public.material_unit,bigint,bigint,text);
drop function public.update_material(uuid,uuid,text,text,uuid,text,text,public.material_unit,bigint,bigint,text,boolean);

create function public.create_material(p_business_id uuid,p_name text,p_internal_reference text,p_category_id uuid,p_new_category_name text,p_new_category_prefix text,p_supplier_id uuid,p_new_supplier_name text,p_color text,p_unit public.material_unit,p_package_quantity_milliunits bigint,p_package_cost_cents bigint,p_notes text) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_product_manager(p_business_id); nid uuid:=gen_random_uuid(); category uuid; supplier uuid; final_color text;
begin
  category:=public.resolve_material_category(p_business_id,p_category_id,p_new_category_name,p_new_category_prefix);
  supplier:=public.resolve_material_supplier(p_business_id,p_supplier_id,p_new_supplier_name);
  final_color:=public.canonical_material_color(p_business_id,p_color);
  insert into public.materials(id,business_id,name,internal_reference,category_id,supplier_id,color,unit,package_quantity_milliunits,package_cost_cents,notes,created_by) values(nid,p_business_id,btrim(p_name),nullif(btrim(p_internal_reference),''),category,supplier,final_color,p_unit,p_package_quantity_milliunits,p_package_cost_cents,nullif(btrim(p_notes),''),actor);
  insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,new_data) values(p_business_id,actor,'created','material',nid,jsonb_build_object('name',btrim(p_name)));
  return nid;
end $$;

create function public.update_material(p_material_id uuid,p_business_id uuid,p_name text,p_internal_reference text,p_category_id uuid,p_new_category_name text,p_new_category_prefix text,p_supplier_id uuid,p_new_supplier_name text,p_color text,p_unit public.material_unit,p_package_quantity_milliunits bigint,p_package_cost_cents bigint,p_notes text,p_is_active boolean) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_product_manager(p_business_id); current_unit public.material_unit; category uuid; supplier uuid; final_color text;
begin
  select unit into current_unit from public.materials where id=p_material_id and business_id=p_business_id for update;
  if not found then raise exception 'material not found' using errcode='P0002'; end if;
  if current_unit<>p_unit and exists(select 1 from public.product_materials where material_id=p_material_id and business_id=p_business_id) then raise exception 'material unit is immutable once used' using errcode='55000'; end if;
  category:=public.resolve_material_category(p_business_id,p_category_id,p_new_category_name,p_new_category_prefix);
  supplier:=public.resolve_material_supplier(p_business_id,p_supplier_id,p_new_supplier_name);
  final_color:=public.canonical_material_color(p_business_id,p_color);
  update public.materials set name=btrim(p_name),internal_reference=nullif(btrim(p_internal_reference),''),category_id=category,supplier_id=supplier,color=final_color,unit=p_unit,package_quantity_milliunits=p_package_quantity_milliunits,package_cost_cents=p_package_cost_cents,notes=nullif(btrim(p_notes),''),is_active=p_is_active where id=p_material_id and business_id=p_business_id;
  insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,new_data) values(p_business_id,actor,'updated','material',p_material_id,jsonb_build_object('name',btrim(p_name),'is_active',p_is_active));
end $$;

revoke all on function public.normalize_reference_prefix(text),public.resolve_material_category(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.update_material_category(uuid,uuid,text,text),public.create_material(uuid,text,text,uuid,text,text,uuid,text,text,public.material_unit,bigint,bigint,text),public.update_material(uuid,uuid,text,text,uuid,text,text,uuid,text,text,public.material_unit,bigint,bigint,text,boolean) from public,anon;
grant execute on function public.update_material_category(uuid,uuid,text,text),public.create_material(uuid,text,text,uuid,text,text,uuid,text,text,public.material_unit,bigint,bigint,text),public.update_material(uuid,uuid,text,text,uuid,text,text,uuid,text,text,public.material_unit,bigint,bigint,text,boolean) to authenticated;

comment on table public.material_categories is 'Catégories de matières par entreprise ; le préfixe pré-remplit la référence interne (ex. CP-001).';
