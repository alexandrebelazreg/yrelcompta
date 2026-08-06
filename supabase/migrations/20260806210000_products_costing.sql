-- Catalogue produits et estimation courante du coût de fabrication.
-- Les rôles applicatifs lisent les tables sous RLS ; toutes les écritures
-- passent par les RPC SECURITY DEFINER contrôlées ci-dessous.

create type public.material_unit as enum ('piece','gram','centimeter','milliliter');
create type public.product_category as enum ('necklace','bracelet','earrings','ring','accessory','other');

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  name text not null,
  internal_reference text,
  supplier_id uuid,
  unit public.material_unit not null,
  package_quantity_milliunits bigint not null,
  package_cost_cents bigint not null,
  notes text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint materials_id_business_key unique(id,business_id),
  constraint materials_supplier_business_fk foreign key(supplier_id,business_id) references public.suppliers(id,business_id) on delete restrict,
  constraint materials_name_length check(char_length(btrim(name)) between 1 and 160),
  constraint materials_reference_length check(internal_reference is null or char_length(internal_reference) between 1 and 80),
  constraint materials_notes_length check(notes is null or char_length(notes)<=2000),
  constraint materials_quantity_range check(package_quantity_milliunits between 1 and 9000000000000000),
  constraint materials_cost_range check(package_cost_cents between 1 and 9000000000000)
);
create unique index materials_business_reference_key on public.materials(business_id,lower(internal_reference)) where internal_reference is not null;

create table public.costing_settings (
  business_id uuid primary key references public.businesses(id) on delete restrict,
  labor_hourly_rate_cents bigint not null default 0,
  default_packaging_cost_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint costing_settings_amounts check(labor_hourly_rate_cents between 0 and 9000000000000 and default_packaging_cost_cents between 0 and 9000000000000)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  name text not null,
  sku text,
  category public.product_category not null,
  sale_price_cents bigint not null default 0,
  labor_minutes integer not null default 0,
  packaging_cost_cents bigint,
  material_loss_basis_points integer not null default 0,
  notes text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_id_business_key unique(id,business_id),
  constraint products_name_length check(char_length(btrim(name)) between 1 and 160),
  constraint products_sku_length check(sku is null or char_length(sku) between 1 and 80),
  constraint products_notes_length check(notes is null or char_length(notes)<=2000),
  constraint products_sale_price_range check(sale_price_cents between 0 and 9000000000000),
  constraint products_labor_minutes_range check(labor_minutes between 0 and 10080),
  constraint products_packaging_range check(packaging_cost_cents is null or packaging_cost_cents between 0 and 9000000000000),
  constraint products_loss_range check(material_loss_basis_points between 0 and 10000)
);
create unique index products_business_sku_key on public.products(business_id,lower(sku)) where sku is not null;

create table public.product_materials (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  product_id uuid not null,
  material_id uuid not null,
  quantity_milliunits bigint not null,
  position smallint not null,
  created_at timestamptz not null default now(),
  constraint product_materials_product_business_fk foreign key(product_id,business_id) references public.products(id,business_id) on delete restrict,
  constraint product_materials_material_business_fk foreign key(material_id,business_id) references public.materials(id,business_id) on delete restrict,
  constraint product_materials_material_unique unique(product_id,material_id),
  constraint product_materials_position_unique unique(product_id,position),
  constraint product_materials_quantity_range check(quantity_milliunits between 1 and 9000000000000000),
  constraint product_materials_position_positive check(position between 1 and 32767)
);

create index materials_business_name_idx on public.materials(business_id,is_active desc,name);
create index products_business_name_idx on public.products(business_id,is_active desc,name);
create index product_materials_business_product_idx on public.product_materials(business_id,product_id,position);
create trigger materials_set_updated_at before update on public.materials for each row execute function public.set_updated_at();
create trigger costing_settings_set_updated_at before update on public.costing_settings for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();

alter table public.materials enable row level security;
alter table public.costing_settings enable row level security;
alter table public.products enable row level security;
alter table public.product_materials enable row level security;
grant select on table public.materials,public.costing_settings,public.products,public.product_materials to authenticated;
revoke insert,update,delete on table public.materials,public.costing_settings,public.products,public.product_materials from authenticated,anon;
create policy materials_select_member on public.materials for select to authenticated using(public.is_business_member(business_id));
create policy costing_settings_select_member on public.costing_settings for select to authenticated using(public.is_business_member(business_id));
create policy products_select_member on public.products for select to authenticated using(public.is_business_member(business_id));
create policy product_materials_select_member on public.product_materials for select to authenticated using(public.is_business_member(business_id));

create function public.assert_product_manager(p_business_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if actor is null or not public.can_manage_business(p_business_id) then raise exception 'business access denied' using errcode='42501'; end if;
  return actor;
end $$;

create function public.get_costing_settings(p_business_id uuid) returns table(labor_hourly_rate_cents bigint,default_packaging_cost_cents bigint) language plpgsql stable security definer set search_path='' as $$
begin
  perform public.assert_product_manager(p_business_id);
  return query select coalesce(s.labor_hourly_rate_cents,0),coalesce(s.default_packaging_cost_cents,0) from (select 1) x left join public.costing_settings s on s.business_id=p_business_id;
end $$;

create function public.update_costing_settings(p_business_id uuid,p_labor_hourly_rate_cents bigint,p_default_packaging_cost_cents bigint) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_product_manager(p_business_id);
begin
  if p_labor_hourly_rate_cents not between 0 and 9000000000000 or p_default_packaging_cost_cents not between 0 and 9000000000000 then raise exception 'invalid costing settings' using errcode='22023'; end if;
  insert into public.costing_settings(business_id,labor_hourly_rate_cents,default_packaging_cost_cents,updated_by) values(p_business_id,p_labor_hourly_rate_cents,p_default_packaging_cost_cents,actor)
  on conflict(business_id) do update set labor_hourly_rate_cents=excluded.labor_hourly_rate_cents,default_packaging_cost_cents=excluded.default_packaging_cost_cents,updated_by=actor;
  insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,new_data) values(p_business_id,actor,'updated','costing_settings',p_business_id,jsonb_build_object('configured',true));
end $$;

create function public.create_material(p_business_id uuid,p_name text,p_internal_reference text,p_supplier_id uuid,p_unit public.material_unit,p_package_quantity_milliunits bigint,p_package_cost_cents bigint,p_notes text) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_product_manager(p_business_id); nid uuid:=gen_random_uuid();
begin
  insert into public.materials(id,business_id,name,internal_reference,supplier_id,unit,package_quantity_milliunits,package_cost_cents,notes,created_by) values(nid,p_business_id,btrim(p_name),nullif(btrim(p_internal_reference),''),p_supplier_id,p_unit,p_package_quantity_milliunits,p_package_cost_cents,nullif(btrim(p_notes),''),actor);
  insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,new_data) values(p_business_id,actor,'created','material',nid,jsonb_build_object('name',btrim(p_name)));
  return nid;
end $$;
create function public.update_material(p_material_id uuid,p_business_id uuid,p_name text,p_internal_reference text,p_supplier_id uuid,p_unit public.material_unit,p_package_quantity_milliunits bigint,p_package_cost_cents bigint,p_notes text,p_is_active boolean) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_product_manager(p_business_id); current_unit public.material_unit;
begin
  select unit into current_unit from public.materials where id=p_material_id and business_id=p_business_id for update;
  if not found then raise exception 'material not found' using errcode='P0002'; end if;
  if current_unit<>p_unit and exists(select 1 from public.product_materials where material_id=p_material_id and business_id=p_business_id) then raise exception 'material unit is immutable once used' using errcode='55000'; end if;
  update public.materials set name=btrim(p_name),internal_reference=nullif(btrim(p_internal_reference),''),supplier_id=p_supplier_id,unit=p_unit,package_quantity_milliunits=p_package_quantity_milliunits,package_cost_cents=p_package_cost_cents,notes=nullif(btrim(p_notes),''),is_active=p_is_active where id=p_material_id and business_id=p_business_id;
  insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,new_data) values(p_business_id,actor,'updated','material',p_material_id,jsonb_build_object('name',btrim(p_name),'is_active',p_is_active));
end $$;
create function public.archive_material(p_material_id uuid,p_business_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_product_manager(p_business_id);
begin
  update public.materials set is_active=false where id=p_material_id and business_id=p_business_id;
  if not found then raise exception 'material not found' using errcode='P0002'; end if;
  insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id) values(p_business_id,actor,'archived','material',p_material_id);
end $$;

create function public.create_product(p_business_id uuid,p_name text,p_sku text,p_category public.product_category,p_sale_price_cents bigint,p_labor_minutes integer,p_packaging_cost_cents bigint,p_material_loss_basis_points integer,p_notes text) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_product_manager(p_business_id); nid uuid:=gen_random_uuid();
begin
  insert into public.products(id,business_id,name,sku,category,sale_price_cents,labor_minutes,packaging_cost_cents,material_loss_basis_points,notes,created_by) values(nid,p_business_id,btrim(p_name),nullif(btrim(p_sku),''),p_category,p_sale_price_cents,p_labor_minutes,p_packaging_cost_cents,p_material_loss_basis_points,nullif(btrim(p_notes),''),actor);
  insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,new_data) values(p_business_id,actor,'created','product',nid,jsonb_build_object('name',btrim(p_name)));
  return nid;
end $$;
create function public.update_product(p_product_id uuid,p_business_id uuid,p_name text,p_sku text,p_category public.product_category,p_sale_price_cents bigint,p_labor_minutes integer,p_packaging_cost_cents bigint,p_material_loss_basis_points integer,p_notes text,p_is_active boolean) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_product_manager(p_business_id);
begin
  update public.products set name=btrim(p_name),sku=nullif(btrim(p_sku),''),category=p_category,sale_price_cents=p_sale_price_cents,labor_minutes=p_labor_minutes,packaging_cost_cents=p_packaging_cost_cents,material_loss_basis_points=p_material_loss_basis_points,notes=nullif(btrim(p_notes),''),is_active=p_is_active where id=p_product_id and business_id=p_business_id;
  if not found then raise exception 'product not found' using errcode='P0002'; end if;
  insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,new_data) values(p_business_id,actor,'updated','product',p_product_id,jsonb_build_object('name',btrim(p_name),'is_active',p_is_active));
end $$;
create function public.archive_product(p_product_id uuid,p_business_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_product_manager(p_business_id);
begin
  update public.products set is_active=false where id=p_product_id and business_id=p_business_id;
  if not found then raise exception 'product not found' using errcode='P0002'; end if;
  insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id) values(p_business_id,actor,'archived','product',p_product_id);
end $$;

create function public.validate_product_recipe(p_business_id uuid,p_lines jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
  if p_lines is null or jsonb_typeof(p_lines)<>'array' then raise exception 'recipe must be an array' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_lines) l where coalesce(l->>'material_id','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or coalesce(l->>'quantity_milliunits','')!~'^[1-9][0-9]*$' or coalesce(l->>'position','')!~'^[1-9][0-9]*$') then raise exception 'invalid recipe line' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_lines) l where (l->>'quantity_milliunits')::numeric>9000000000000000 or (l->>'position')::numeric>32767) then raise exception 'recipe line out of range' using errcode='22003'; end if;
  if exists(select l->>'material_id' from jsonb_array_elements(p_lines) l group by 1 having count(*)>1) or exists(select l->>'position' from jsonb_array_elements(p_lines) l group by 1 having count(*)>1) then raise exception 'duplicate recipe line' using errcode='23505'; end if;
  if exists(select 1 from jsonb_array_elements(p_lines) l where not exists(select 1 from public.materials m where m.id=(l->>'material_id')::uuid and m.business_id=p_business_id)) then raise exception 'cross-business material denied' using errcode='42501'; end if;
end $$;

create function public.replace_product_recipe(p_product_id uuid,p_business_id uuid,p_lines jsonb) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_product_manager(p_business_id);
begin
  perform 1 from public.products where id=p_product_id and business_id=p_business_id for update;
  if not found then raise exception 'product not found' using errcode='P0002'; end if;
  perform public.validate_product_recipe(p_business_id,p_lines);
  delete from public.product_materials where product_id=p_product_id and business_id=p_business_id;
  insert into public.product_materials(business_id,product_id,material_id,quantity_milliunits,position) select p_business_id,p_product_id,(l->>'material_id')::uuid,(l->>'quantity_milliunits')::bigint,(l->>'position')::smallint from jsonb_array_elements(p_lines) l;
  insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,new_data) values(p_business_id,actor,'updated','product_recipe',p_product_id,jsonb_build_object('line_count',jsonb_array_length(p_lines)));
end $$;

create function public.save_product_with_recipe(p_product_id uuid,p_business_id uuid,p_name text,p_sku text,p_category public.product_category,p_sale_price_cents bigint,p_labor_minutes integer,p_packaging_cost_cents bigint,p_material_loss_basis_points integer,p_notes text,p_is_active boolean,p_lines jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_product_manager(p_business_id); saved_id uuid:=coalesce(p_product_id,gen_random_uuid());
begin
  -- Cette validation complète précède strictement toute écriture produit ou recette.
  perform public.validate_product_recipe(p_business_id,p_lines);
  if p_product_id is null then
    insert into public.products(id,business_id,name,sku,category,sale_price_cents,labor_minutes,packaging_cost_cents,material_loss_basis_points,notes,is_active,created_by) values(saved_id,p_business_id,btrim(p_name),nullif(btrim(p_sku),''),p_category,p_sale_price_cents,p_labor_minutes,p_packaging_cost_cents,p_material_loss_basis_points,nullif(btrim(p_notes),''),true,actor);
    insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,new_data) values(p_business_id,actor,'created','product',saved_id,jsonb_build_object('name',btrim(p_name)));
  else
    update public.products set name=btrim(p_name),sku=nullif(btrim(p_sku),''),category=p_category,sale_price_cents=p_sale_price_cents,labor_minutes=p_labor_minutes,packaging_cost_cents=p_packaging_cost_cents,material_loss_basis_points=p_material_loss_basis_points,notes=nullif(btrim(p_notes),''),is_active=p_is_active where id=p_product_id and business_id=p_business_id;
    if not found then raise exception 'product not found' using errcode='P0002'; end if;
    insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,new_data) values(p_business_id,actor,'updated','product',saved_id,jsonb_build_object('name',btrim(p_name),'is_active',p_is_active));
  end if;
  delete from public.product_materials where product_id=saved_id and business_id=p_business_id;
  insert into public.product_materials(business_id,product_id,material_id,quantity_milliunits,position) select p_business_id,saved_id,(l->>'material_id')::uuid,(l->>'quantity_milliunits')::bigint,(l->>'position')::smallint from jsonb_array_elements(p_lines) l;
  insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,new_data) values(p_business_id,actor,'updated','product_recipe',saved_id,jsonb_build_object('line_count',jsonb_array_length(p_lines)));
  return saved_id;
end $$;

create function public.get_product_costing(p_product_id uuid,p_business_id uuid) returns table(raw_materials_cents bigint,material_loss_cents bigint,labor_cents bigint,packaging_cents bigint,manufacturing_cost_cents bigint,gross_margin_cents bigint) language plpgsql stable security definer set search_path='' as $$
declare p public.products; raw_exact numeric; raw_rounded numeric; hourly bigint; default_packaging bigint; loss_rounded numeric; labor_rounded numeric; packaging bigint; total numeric;
begin
  perform public.assert_product_manager(p_business_id);
  select * into p from public.products where id=p_product_id and business_id=p_business_id;
  if not found then raise exception 'product not found' using errcode='P0002'; end if;
  select coalesce(sum((m.package_cost_cents::numeric*pm.quantity_milliunits::numeric)/nullif(m.package_quantity_milliunits::numeric,0)),0) into raw_exact from public.product_materials pm join public.materials m on m.id=pm.material_id and m.business_id=pm.business_id where pm.product_id=p_product_id and pm.business_id=p_business_id;
  raw_rounded:=round(raw_exact);
  select coalesce(s.labor_hourly_rate_cents,0),coalesce(s.default_packaging_cost_cents,0) into hourly,default_packaging from (select 1) x left join public.costing_settings s on s.business_id=p_business_id;
  loss_rounded:=round((raw_rounded*p.material_loss_basis_points::numeric)/10000::numeric);
  labor_rounded:=round((p.labor_minutes::numeric*hourly::numeric)/60::numeric);
  packaging:=coalesce(p.packaging_cost_cents,default_packaging);
  total:=raw_rounded+loss_rounded+labor_rounded+packaging::numeric;
  if raw_rounded<0 or loss_rounded<0 or labor_rounded<0 or total<0 or total>9223372036854775807 then raise exception 'cost overflow' using errcode='22003'; end if;
  return query select raw_rounded::bigint,loss_rounded::bigint,labor_rounded::bigint,packaging,total::bigint,(p.sale_price_cents::numeric-total)::bigint;
end $$;

revoke all on function public.assert_product_manager(uuid),public.validate_product_recipe(uuid,jsonb),public.get_costing_settings(uuid),public.update_costing_settings(uuid,bigint,bigint),public.create_material(uuid,text,text,uuid,public.material_unit,bigint,bigint,text),public.update_material(uuid,uuid,text,text,uuid,public.material_unit,bigint,bigint,text,boolean),public.archive_material(uuid,uuid),public.create_product(uuid,text,text,public.product_category,bigint,integer,bigint,integer,text),public.update_product(uuid,uuid,text,text,public.product_category,bigint,integer,bigint,integer,text,boolean),public.archive_product(uuid,uuid),public.replace_product_recipe(uuid,uuid,jsonb),public.save_product_with_recipe(uuid,uuid,text,text,public.product_category,bigint,integer,bigint,integer,text,boolean,jsonb),public.get_product_costing(uuid,uuid) from public;
grant execute on function public.get_costing_settings(uuid),public.update_costing_settings(uuid,bigint,bigint),public.create_material(uuid,text,text,uuid,public.material_unit,bigint,bigint,text),public.update_material(uuid,uuid,text,text,uuid,public.material_unit,bigint,bigint,text,boolean),public.archive_material(uuid,uuid),public.create_product(uuid,text,text,public.product_category,bigint,integer,bigint,integer,text),public.update_product(uuid,uuid,text,text,public.product_category,bigint,integer,bigint,integer,text,boolean),public.archive_product(uuid,uuid),public.replace_product_recipe(uuid,uuid,jsonb),public.save_product_with_recipe(uuid,uuid,text,text,public.product_category,bigint,integer,bigint,integer,text,boolean,jsonb),public.get_product_costing(uuid,uuid) to authenticated;

comment on table public.materials is 'Lots de référence des matières, quantités en milli-unités et coûts TTC en centimes.';
comment on table public.products is 'Bijoux et accessoires avec paramètres internes de coût de fabrication estimé.';
comment on table public.product_materials is 'Recettes courantes modifiables ; elles ne figent pas un coût historique.';
