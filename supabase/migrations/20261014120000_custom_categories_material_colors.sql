-- Catégories produit et couleurs de matière personnalisables par entreprise,
-- et création d'un fournisseur directement depuis le formulaire matière.
-- Les tables restent en lecture seule sous RLS : les écritures passent par
-- les RPC SECURITY DEFINER recréées ci-dessous.

-- 1. Catégories produit : l'enum figé devient un libellé libre par entreprise.
drop function public.create_product(uuid,text,text,public.product_category,bigint,integer,bigint,integer,text);
drop function public.update_product(uuid,uuid,text,text,public.product_category,bigint,integer,bigint,integer,text,boolean);
drop function public.save_product_with_recipe(uuid,uuid,text,text,public.product_category,bigint,integer,bigint,integer,text,boolean,jsonb);

alter table public.products alter column category type text using (case category::text
  when 'necklace' then 'Collier'
  when 'bracelet' then 'Bracelet'
  when 'earrings' then 'Boucles d’oreilles'
  when 'ring' then 'Bague'
  when 'accessory' then 'Accessoire'
  else 'Autre' end);
alter table public.products add constraint products_category_length check (category = btrim(category) and char_length(category) between 1 and 60);
drop type public.product_category;
create index products_business_category_idx on public.products(business_id,category);

-- 2. Couleur facultative des matières (Argent, Doré ou libellé créé par l'entreprise).
alter table public.materials add column color text;
alter table public.materials add constraint materials_color_length check (color is null or (color = btrim(color) and char_length(color) between 1 and 60));

-- Un libellé déjà utilisé par l'entreprise est réutilisé avec sa casse d'origine
-- pour éviter les doublons « doré » / « Doré ».
create function public.canonical_product_category(p_business_id uuid,p_category text) returns text language plpgsql stable security definer set search_path='' as $$
declare cleaned text:=regexp_replace(btrim(coalesce(p_category,'')),'\s+',' ','g'); existing text;
begin
  if char_length(cleaned) not between 1 and 60 then raise exception 'invalid product category' using errcode='22023'; end if;
  select category into existing from public.products where business_id=p_business_id and lower(category)=lower(cleaned) order by created_at limit 1;
  return coalesce(existing,cleaned);
end $$;

create function public.canonical_material_color(p_business_id uuid,p_color text) returns text language plpgsql stable security definer set search_path='' as $$
declare cleaned text:=regexp_replace(btrim(coalesce(p_color,'')),'\s+',' ','g'); existing text;
begin
  if cleaned='' then return null; end if;
  if char_length(cleaned)>60 then raise exception 'invalid material color' using errcode='22023'; end if;
  select color into existing from public.materials where business_id=p_business_id and lower(color)=lower(cleaned) order by created_at limit 1;
  return coalesce(existing,cleaned);
end $$;

-- Fournisseur choisi ou créé à la volée ; un fournisseur actif de même nom est réutilisé.
create function public.resolve_material_supplier(p_business_id uuid,p_supplier_id uuid,p_new_supplier_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare cleaned text:=regexp_replace(btrim(coalesce(p_new_supplier_name,'')),'\s+',' ','g'); existing uuid;
begin
  if cleaned='' then return p_supplier_id; end if;
  if p_supplier_id is not null then raise exception 'ambiguous supplier' using errcode='22023'; end if;
  if char_length(cleaned)>160 then raise exception 'invalid supplier name' using errcode='22023'; end if;
  select id into existing from public.suppliers where business_id=p_business_id and is_active and lower(btrim(name))=lower(cleaned) order by created_at limit 1;
  if existing is not null then return existing; end if;
  return public.create_supplier(p_business_id,cleaned,null,null,null,null,null,null,null,'FR',null,null);
end $$;

drop function public.create_material(uuid,text,text,uuid,public.material_unit,bigint,bigint,text);
drop function public.update_material(uuid,uuid,text,text,uuid,public.material_unit,bigint,bigint,text,boolean);

create function public.create_material(p_business_id uuid,p_name text,p_internal_reference text,p_supplier_id uuid,p_new_supplier_name text,p_color text,p_unit public.material_unit,p_package_quantity_milliunits bigint,p_package_cost_cents bigint,p_notes text) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_product_manager(p_business_id); nid uuid:=gen_random_uuid(); supplier uuid; final_color text;
begin
  supplier:=public.resolve_material_supplier(p_business_id,p_supplier_id,p_new_supplier_name);
  final_color:=public.canonical_material_color(p_business_id,p_color);
  insert into public.materials(id,business_id,name,internal_reference,supplier_id,color,unit,package_quantity_milliunits,package_cost_cents,notes,created_by) values(nid,p_business_id,btrim(p_name),nullif(btrim(p_internal_reference),''),supplier,final_color,p_unit,p_package_quantity_milliunits,p_package_cost_cents,nullif(btrim(p_notes),''),actor);
  insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,new_data) values(p_business_id,actor,'created','material',nid,jsonb_build_object('name',btrim(p_name)));
  return nid;
end $$;

create function public.update_material(p_material_id uuid,p_business_id uuid,p_name text,p_internal_reference text,p_supplier_id uuid,p_new_supplier_name text,p_color text,p_unit public.material_unit,p_package_quantity_milliunits bigint,p_package_cost_cents bigint,p_notes text,p_is_active boolean) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_product_manager(p_business_id); current_unit public.material_unit; supplier uuid; final_color text;
begin
  select unit into current_unit from public.materials where id=p_material_id and business_id=p_business_id for update;
  if not found then raise exception 'material not found' using errcode='P0002'; end if;
  if current_unit<>p_unit and exists(select 1 from public.product_materials where material_id=p_material_id and business_id=p_business_id) then raise exception 'material unit is immutable once used' using errcode='55000'; end if;
  supplier:=public.resolve_material_supplier(p_business_id,p_supplier_id,p_new_supplier_name);
  final_color:=public.canonical_material_color(p_business_id,p_color);
  update public.materials set name=btrim(p_name),internal_reference=nullif(btrim(p_internal_reference),''),supplier_id=supplier,color=final_color,unit=p_unit,package_quantity_milliunits=p_package_quantity_milliunits,package_cost_cents=p_package_cost_cents,notes=nullif(btrim(p_notes),''),is_active=p_is_active where id=p_material_id and business_id=p_business_id;
  insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,new_data) values(p_business_id,actor,'updated','material',p_material_id,jsonb_build_object('name',btrim(p_name),'is_active',p_is_active));
end $$;

create function public.save_product_with_recipe(p_product_id uuid,p_business_id uuid,p_name text,p_sku text,p_category text,p_sale_price_cents bigint,p_labor_minutes integer,p_packaging_cost_cents bigint,p_material_loss_basis_points integer,p_notes text,p_is_active boolean,p_lines jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_product_manager(p_business_id); saved_id uuid:=coalesce(p_product_id,gen_random_uuid()); final_category text;
begin
  -- Cette validation complète précède strictement toute écriture produit ou recette.
  perform public.validate_product_recipe(p_business_id,p_lines);
  final_category:=public.canonical_product_category(p_business_id,p_category);
  if p_product_id is null then
    insert into public.products(id,business_id,name,sku,category,sale_price_cents,labor_minutes,packaging_cost_cents,material_loss_basis_points,notes,is_active,created_by) values(saved_id,p_business_id,btrim(p_name),nullif(btrim(p_sku),''),final_category,p_sale_price_cents,p_labor_minutes,p_packaging_cost_cents,p_material_loss_basis_points,nullif(btrim(p_notes),''),true,actor);
    insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,new_data) values(p_business_id,actor,'created','product',saved_id,jsonb_build_object('name',btrim(p_name)));
  else
    update public.products set name=btrim(p_name),sku=nullif(btrim(p_sku),''),category=final_category,sale_price_cents=p_sale_price_cents,labor_minutes=p_labor_minutes,packaging_cost_cents=p_packaging_cost_cents,material_loss_basis_points=p_material_loss_basis_points,notes=nullif(btrim(p_notes),''),is_active=p_is_active where id=p_product_id and business_id=p_business_id;
    if not found then raise exception 'product not found' using errcode='P0002'; end if;
    insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,new_data) values(p_business_id,actor,'updated','product',saved_id,jsonb_build_object('name',btrim(p_name),'is_active',p_is_active));
  end if;
  delete from public.product_materials where product_id=saved_id and business_id=p_business_id;
  insert into public.product_materials(business_id,product_id,material_id,quantity_milliunits,position) select p_business_id,saved_id,(l->>'material_id')::uuid,(l->>'quantity_milliunits')::bigint,(l->>'position')::smallint from jsonb_array_elements(p_lines) l;
  insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,new_data) values(p_business_id,actor,'updated','product_recipe',saved_id,jsonb_build_object('line_count',jsonb_array_length(p_lines)));
  return saved_id;
end $$;

revoke all on function public.canonical_product_category(uuid,text),public.canonical_material_color(uuid,text),public.resolve_material_supplier(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.create_material(uuid,text,text,uuid,text,text,public.material_unit,bigint,bigint,text),public.update_material(uuid,uuid,text,text,uuid,text,text,public.material_unit,bigint,bigint,text,boolean),public.save_product_with_recipe(uuid,uuid,text,text,text,bigint,integer,bigint,integer,text,boolean,jsonb) from public,anon;
grant execute on function public.create_material(uuid,text,text,uuid,text,text,public.material_unit,bigint,bigint,text),public.update_material(uuid,uuid,text,text,uuid,text,text,public.material_unit,bigint,bigint,text,boolean),public.save_product_with_recipe(uuid,uuid,text,text,text,bigint,integer,bigint,integer,text,boolean,jsonb) to authenticated;

comment on column public.products.category is 'Libellé de catégorie propre à l’entreprise (Collier, Bracelet… ou catégorie créée).';
comment on column public.materials.color is 'Couleur facultative de la matière (Argent, Doré ou couleur créée par l’entreprise).';
