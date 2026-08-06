-- Snapshots historiques des coûts produits sur les ventes.
-- Cette migration ne reconstitue volontairement aucun coût antérieur.

alter table public.sale_items
  add column product_id uuid,
  add column product_name_snapshot text,
  add column product_sku_snapshot text,
  add column unit_raw_materials_cost_cents bigint,
  add column unit_material_loss_cost_cents bigint,
  add column unit_labor_cost_cents bigint,
  add column unit_packaging_cost_cents bigint,
  add column unit_manufacturing_cost_cents bigint,
  add column line_manufacturing_cost_cents bigint generated always as (
    case when unit_manufacturing_cost_cents is null then null
      else (quantity::numeric * unit_manufacturing_cost_cents::numeric)::bigint end
  ) stored,
  add column line_margin_before_discount_cents bigint generated always as (
    case when unit_manufacturing_cost_cents is null then null
      else ((quantity::numeric * unit_price_cents::numeric)
        - (quantity::numeric * unit_manufacturing_cost_cents::numeric))::bigint end
  ) stored,
  add constraint sale_items_product_business_fk
    foreign key (product_id, business_id)
    references public.products(id, business_id) on delete restrict,
  add constraint sale_items_snapshot_consistent check (
    (
      product_name_snapshot is null
      and product_sku_snapshot is null
      and unit_raw_materials_cost_cents is null
      and unit_material_loss_cost_cents is null
      and unit_labor_cost_cents is null
      and unit_packaging_cost_cents is null
      and unit_manufacturing_cost_cents is null
    )
    or
    (
      product_id is not null
      and product_name_snapshot is not null
      and char_length(btrim(product_name_snapshot)) between 1 and 160
      and (product_sku_snapshot is null or char_length(product_sku_snapshot) between 1 and 80)
      and unit_raw_materials_cost_cents >= 0
      and unit_raw_materials_cost_cents is not null
      and unit_material_loss_cost_cents >= 0
      and unit_material_loss_cost_cents is not null
      and unit_labor_cost_cents >= 0
      and unit_labor_cost_cents is not null
      and unit_packaging_cost_cents >= 0
      and unit_packaging_cost_cents is not null
      and unit_manufacturing_cost_cents >= 0
      and unit_manufacturing_cost_cents is not null
      and unit_manufacturing_cost_cents::numeric =
        unit_raw_materials_cost_cents::numeric
        + unit_material_loss_cost_cents::numeric
        + unit_labor_cost_cents::numeric
        + unit_packaging_cost_cents::numeric
    )
  );

create index sale_items_business_product_sale_idx
  on public.sale_items(business_id, product_id, sale_id);

alter table public.sales
  add column manufacturing_cost_cents bigint,
  add column manufacturing_margin_cents bigint,
  add column costing_complete boolean not null default false,
  add constraint sales_manufacturing_snapshot_consistent check (
    (
      costing_complete = false
      and manufacturing_cost_cents is null
      and manufacturing_margin_cents is null
    )
    or
    (
      costing_complete = true
      and manufacturing_cost_cents is not null
      and manufacturing_cost_cents >= 0
      and manufacturing_margin_cents is not null
      and manufacturing_margin_cents::numeric =
        subtotal_cents::numeric
        - discount_cents::numeric
        - manufacturing_cost_cents::numeric
    )
  );

-- Point de calcul unique. Il reste inaccessible aux rôles applicatifs et
-- travaille en numeric jusqu'au contrôle final de la plage bigint.
create function public.calculate_product_costing_internal(
  p_product_id uuid,
  p_business_id uuid
)
returns table(
  raw_materials_cents bigint,
  material_loss_cents bigint,
  labor_cents bigint,
  packaging_cents bigint,
  manufacturing_cost_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  product_record public.products;
  raw_exact numeric;
  raw_rounded numeric;
  hourly_rate numeric;
  default_packaging numeric;
  loss_rounded numeric;
  labor_rounded numeric;
  packaging numeric;
  total numeric;
begin
  if auth.uid() is null or not public.can_manage_business(p_business_id) then
    raise exception 'PRODUCT_BUSINESS_FORBIDDEN' using errcode = '42501';
  end if;

  select p.* into product_record
  from public.products p
  where p.id = p_product_id and p.business_id = p_business_id;

  if not found then
    if exists (select 1 from public.products p where p.id = p_product_id) then
      raise exception 'PRODUCT_BUSINESS_FORBIDDEN' using errcode = '42501';
    end if;
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(sum(
    (m.package_cost_cents::numeric * pm.quantity_milliunits::numeric)
      / nullif(m.package_quantity_milliunits::numeric, 0)
  ), 0)
  into raw_exact
  from public.product_materials pm
  join public.materials m
    on m.id = pm.material_id and m.business_id = pm.business_id
  where pm.product_id = p_product_id and pm.business_id = p_business_id;

  raw_rounded := round(raw_exact);

  select
    coalesce(settings.labor_hourly_rate_cents, 0)::numeric,
    coalesce(settings.default_packaging_cost_cents, 0)::numeric
  into hourly_rate, default_packaging
  from (select 1) seed
  left join public.costing_settings settings
    on settings.business_id = p_business_id;

  loss_rounded := round(
    raw_rounded * product_record.material_loss_basis_points::numeric / 10000::numeric
  );
  labor_rounded := round(
    product_record.labor_minutes::numeric * hourly_rate / 60::numeric
  );
  packaging := coalesce(product_record.packaging_cost_cents::numeric, default_packaging);
  total := raw_rounded + loss_rounded + labor_rounded + packaging;

  if raw_rounded < 0 or loss_rounded < 0 or labor_rounded < 0 or packaging < 0
    or raw_rounded > 9223372036854775807::numeric
    or loss_rounded > 9223372036854775807::numeric
    or labor_rounded > 9223372036854775807::numeric
    or packaging > 9223372036854775807::numeric
    or total < 0 or total > 9223372036854775807::numeric
  then
    raise exception 'MONETARY_OVERFLOW' using errcode = '22003';
  end if;

  return query select
    raw_rounded::bigint,
    loss_rounded::bigint,
    labor_rounded::bigint,
    packaging::bigint,
    total::bigint;
exception
  when division_by_zero then
    raise exception 'PRODUCT_COSTING_FAILED' using errcode = '22012';
end;
$$;

revoke all on function public.calculate_product_costing_internal(uuid, uuid) from public;
revoke all on function public.calculate_product_costing_internal(uuid, uuid) from authenticated;

create or replace function public.get_product_costing(
  p_product_id uuid,
  p_business_id uuid
)
returns table(
  raw_materials_cents bigint,
  material_loss_cents bigint,
  labor_cents bigint,
  packaging_cents bigint,
  manufacturing_cost_cents bigint,
  gross_margin_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare product_price bigint;
begin
  perform public.assert_product_manager(p_business_id);
  select sale_price_cents into product_price
  from public.products
  where id = p_product_id and business_id = p_business_id;

  if not found then
    if exists (select 1 from public.products where id = p_product_id) then
      raise exception 'PRODUCT_BUSINESS_FORBIDDEN' using errcode = '42501';
    end if;
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
  select
    cost.raw_materials_cents,
    cost.material_loss_cents,
    cost.labor_cents,
    cost.packaging_cents,
    cost.manufacturing_cost_cents,
    (product_price::numeric - cost.manufacturing_cost_cents::numeric)::bigint
  from public.calculate_product_costing_internal(p_product_id, p_business_id) cost;
end;
$$;

revoke all on function public.get_product_costing(uuid, uuid) from public;
grant execute on function public.get_product_costing(uuid, uuid) to authenticated;

-- Accepte product_id absent ou nul, refuse toute autre propriété et protège
-- les multiplications/additions par des calculs numeric avant conversion.
create or replace function public.sale_items_subtotal(p_items jsonb)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
  subtotal numeric := 0;
  quantity_value numeric;
  price_value numeric;
  description_value text;
  product_value text;
begin
  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) < 1
    or jsonb_array_length(p_items) > 200
  then
    raise exception 'INVALID_SALE_ITEMS' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) <> 'object'
      or not (item ?& array['description', 'quantity', 'unit_price_cents'])
      or exists (
        select 1 from jsonb_object_keys(item) as keys(key)
        where key not in ('description', 'quantity', 'unit_price_cents', 'product_id')
      )
      or jsonb_typeof(item->'description') <> 'string'
      or jsonb_typeof(item->'quantity') <> 'number'
      or jsonb_typeof(item->'unit_price_cents') <> 'number'
      or (item->>'quantity') !~ '^\d+$'
      or (item->>'unit_price_cents') !~ '^\d+$'
      or (item ? 'product_id' and jsonb_typeof(item->'product_id') not in ('string', 'null'))
    then
      raise exception 'INVALID_SALE_ITEM' using errcode = '22023';
    end if;

    description_value := btrim(item->>'description');
    quantity_value := (item->>'quantity')::numeric;
    price_value := (item->>'unit_price_cents')::numeric;
    product_value := item->>'product_id';

    if char_length(description_value) not between 1 and 300
      or quantity_value not between 1 and 999
      or price_value < 0 or price_value > 9223372036854775807::numeric
      or (product_value is not null and product_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    then
      raise exception 'INVALID_SALE_ITEM_VALUES' using errcode = '22023';
    end if;

    subtotal := subtotal + quantity_value * price_value;
    if subtotal > 9223372036854775807::numeric then
      raise exception 'MONETARY_OVERFLOW' using errcode = '22003';
    end if;
  end loop;

  return subtotal::bigint;
end;
$$;

revoke all on function public.sale_items_subtotal(jsonb) from public;

create function public.assert_sale_item_products(p_business_id uuid, p_items jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where nullif(item->>'product_id', '') is not null
      and exists (
        select 1 from public.products product
        where product.id = (item->>'product_id')::uuid
          and product.business_id <> p_business_id
      )
  ) then
    raise exception 'PRODUCT_BUSINESS_FORBIDDEN' using errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where nullif(item->>'product_id', '') is not null
      and not exists (
        select 1 from public.products product
        where product.id = (item->>'product_id')::uuid
          and product.business_id = p_business_id
      )
  ) then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.assert_sale_item_products(uuid, jsonb) from public;
revoke all on function public.assert_sale_item_products(uuid, jsonb) from authenticated;

create or replace function public.create_sale_draft(
  p_business_id uuid, p_ordered_on date, p_channel public.sale_channel,
  p_customer_name text, p_notes text, p_shipping_cents bigint,
  p_discount_cents bigint, p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  new_id uuid := gen_random_uuid();
  subtotal bigint;
  total numeric;
  item jsonb;
  item_position smallint := 0;
  new_reference text;
begin
  if actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not public.can_manage_business(p_business_id) then raise exception 'BUSINESS_ACCESS_DENIED' using errcode = '42501'; end if;
  if p_ordered_on is null or p_channel is null or p_shipping_cents is null or p_discount_cents is null or p_shipping_cents < 0 or p_discount_cents < 0 then raise exception 'INVALID_SALE_VALUES' using errcode = '22023'; end if;
  if char_length(coalesce(p_customer_name, '')) > 160 or char_length(coalesce(p_notes, '')) > 2000 then raise exception 'SALE_TEXT_TOO_LONG' using errcode = '22023'; end if;

  subtotal := public.sale_items_subtotal(p_items);
  perform public.assert_sale_item_products(p_business_id, p_items);
  if p_discount_cents::numeric > subtotal::numeric + p_shipping_cents::numeric then raise exception 'DISCOUNT_EXCEEDS_TOTAL' using errcode = '22023'; end if;
  total := subtotal::numeric + p_shipping_cents::numeric - p_discount_cents::numeric;
  if total < 0 or total > 9223372036854775807::numeric then raise exception 'MONETARY_OVERFLOW' using errcode = '22003'; end if;

  new_reference := 'V-' || to_char(p_ordered_on, 'YYYYMMDD') || '-' || upper(substr(replace(new_id::text, '-', ''), 1, 12));
  insert into public.sales (id, business_id, reference, ordered_on, channel, customer_name, notes, subtotal_cents, shipping_cents, discount_cents, total_cents, created_by)
  values (new_id, p_business_id, new_reference, p_ordered_on, p_channel, nullif(btrim(p_customer_name), ''), nullif(btrim(p_notes), ''), subtotal, p_shipping_cents, p_discount_cents, total::bigint, actor);

  for item in select value from jsonb_array_elements(p_items) loop
    item_position := item_position + 1;
    insert into public.sale_items (business_id, sale_id, description, quantity, unit_price_cents, product_id, position)
    values (p_business_id, new_id, btrim(item->>'description'), (item->>'quantity')::integer, (item->>'unit_price_cents')::bigint, nullif(item->>'product_id', '')::uuid, item_position);
  end loop;

  insert into public.audit_logs (business_id, user_id, action_type, entity_name, entity_id, new_data)
  values (p_business_id, actor, 'created', 'sale', new_id, jsonb_build_object('status', 'draft'));
  return new_id;
end;
$$;

create or replace function public.update_sale_draft(
  p_sale_id uuid, p_business_id uuid, p_ordered_on date, p_channel public.sale_channel,
  p_customer_name text, p_notes text, p_shipping_cents bigint,
  p_discount_cents bigint, p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  existing public.sales;
  subtotal bigint;
  total numeric;
  item jsonb;
  item_position smallint := 0;
begin
  if actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not public.can_manage_business(p_business_id) then raise exception 'BUSINESS_ACCESS_DENIED' using errcode = '42501'; end if;
  select * into existing from public.sales where id = p_sale_id and business_id = p_business_id for update;
  if not found then raise exception 'SALE_NOT_FOUND' using errcode = 'P0002'; end if;
  if existing.status <> 'draft' then raise exception 'SALE_ALREADY_VALIDATED' using errcode = '55000'; end if;
  if p_ordered_on is null or p_channel is null or p_shipping_cents is null or p_discount_cents is null or p_shipping_cents < 0 or p_discount_cents < 0 then raise exception 'INVALID_SALE_VALUES' using errcode = '22023'; end if;
  if char_length(coalesce(p_customer_name, '')) > 160 or char_length(coalesce(p_notes, '')) > 2000 then raise exception 'SALE_TEXT_TOO_LONG' using errcode = '22023'; end if;

  subtotal := public.sale_items_subtotal(p_items);
  perform public.assert_sale_item_products(p_business_id, p_items);
  if p_discount_cents::numeric > subtotal::numeric + p_shipping_cents::numeric then raise exception 'DISCOUNT_EXCEEDS_TOTAL' using errcode = '22023'; end if;
  total := subtotal::numeric + p_shipping_cents::numeric - p_discount_cents::numeric;
  if total < 0 or total > 9223372036854775807::numeric then raise exception 'MONETARY_OVERFLOW' using errcode = '22003'; end if;

  delete from public.sale_items where sale_id = p_sale_id and business_id = p_business_id;
  update public.sales set
    ordered_on = p_ordered_on,
    channel = p_channel,
    customer_name = nullif(btrim(p_customer_name), ''),
    notes = nullif(btrim(p_notes), ''),
    subtotal_cents = subtotal,
    shipping_cents = p_shipping_cents,
    discount_cents = p_discount_cents,
    total_cents = total::bigint
  where id = p_sale_id and business_id = p_business_id;

  for item in select value from jsonb_array_elements(p_items) loop
    item_position := item_position + 1;
    insert into public.sale_items (business_id, sale_id, description, quantity, unit_price_cents, product_id, position)
    values (p_business_id, p_sale_id, btrim(item->>'description'), (item->>'quantity')::integer, (item->>'unit_price_cents')::bigint, nullif(item->>'product_id', '')::uuid, item_position);
  end loop;

  insert into public.audit_logs (business_id, user_id, action_type, entity_name, entity_id, new_data)
  values (p_business_id, actor, 'updated', 'sale', p_sale_id, jsonb_build_object('status', 'draft'));
end;
$$;

create or replace function public.validate_sale(p_sale_id uuid, p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  existing public.sales;
  computed_subtotal numeric;
  item_count bigint;
  linked_count bigint;
  snapshot_count bigint;
  total_cost numeric;
  margin numeric;
begin
  if actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not public.can_manage_business(p_business_id) then raise exception 'BUSINESS_ACCESS_DENIED' using errcode = '42501'; end if;

  select * into existing
  from public.sales
  where id = p_sale_id and business_id = p_business_id
  for update;

  if not found then raise exception 'SALE_NOT_FOUND' using errcode = 'P0002'; end if;
  if existing.status <> 'draft' then raise exception 'SALE_ALREADY_VALIDATED' using errcode = '55000'; end if;

  perform 1 from public.sale_items
  where sale_id = p_sale_id and business_id = p_business_id
  order by position
  for update;

  select count(*), coalesce(sum(line_total_cents::numeric), 0)
  into item_count, computed_subtotal
  from public.sale_items
  where sale_id = p_sale_id and business_id = p_business_id;

  if item_count < 1 or existing.total_cents <= 0
    or computed_subtotal <> existing.subtotal_cents::numeric
    or existing.total_cents::numeric <>
      computed_subtotal + existing.shipping_cents::numeric - existing.discount_cents::numeric
  then
    raise exception 'INVALID_SALE_TOTALS' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.sale_items
    where sale_id = p_sale_id and business_id = p_business_id
      and (
        product_name_snapshot is not null or product_sku_snapshot is not null
        or unit_raw_materials_cost_cents is not null
        or unit_material_loss_cost_cents is not null
        or unit_labor_cost_cents is not null
        or unit_packaging_cost_cents is not null
        or unit_manufacturing_cost_cents is not null
      )
  ) then
    raise exception 'INCONSISTENT_SNAPSHOT_DATA' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.sale_items item
    where item.sale_id = p_sale_id and item.business_id = p_business_id
      and item.product_id is not null
      and not exists (
        select 1 from public.products product
        where product.id = item.product_id and product.business_id = p_business_id
      )
  ) then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- MATERIALIZED garantit un unique calcul par produit. Toute l'instruction
  -- partage le même snapshot MVCC, y compris lorsqu'un produit apparaît
  -- sur plusieurs lignes.
  with target_products as materialized (
    select distinct product_id
    from public.sale_items
    where sale_id = p_sale_id and business_id = p_business_id
      and product_id is not null
  ), product_costs as materialized (
    select
      product.id,
      product.name,
      product.sku,
      cost.raw_materials_cents,
      cost.material_loss_cents,
      cost.labor_cents,
      cost.packaging_cents,
      cost.manufacturing_cost_cents
    from target_products target
    join public.products product
      on product.id = target.product_id and product.business_id = p_business_id
    cross join lateral public.calculate_product_costing_internal(product.id, p_business_id) cost
  )
  update public.sale_items item set
    product_name_snapshot = product_costs.name,
    product_sku_snapshot = product_costs.sku,
    unit_raw_materials_cost_cents = product_costs.raw_materials_cents,
    unit_material_loss_cost_cents = product_costs.material_loss_cents,
    unit_labor_cost_cents = product_costs.labor_cents,
    unit_packaging_cost_cents = product_costs.packaging_cents,
    unit_manufacturing_cost_cents = product_costs.manufacturing_cost_cents
  from product_costs
  where item.sale_id = p_sale_id
    and item.business_id = p_business_id
    and item.product_id = product_costs.id;

  select
    count(*) filter (where product_id is not null),
    count(*) filter (
      where product_id is not null
        and product_name_snapshot is not null
        and unit_raw_materials_cost_cents is not null
        and unit_material_loss_cost_cents is not null
        and unit_labor_cost_cents is not null
        and unit_packaging_cost_cents is not null
        and unit_manufacturing_cost_cents is not null
    ),
    coalesce(sum(line_manufacturing_cost_cents::numeric), 0)
  into linked_count, snapshot_count, total_cost
  from public.sale_items
  where sale_id = p_sale_id and business_id = p_business_id;

  if snapshot_count <> linked_count then
    raise exception 'PRODUCT_COSTING_FAILED' using errcode = '23514';
  end if;

  if linked_count = item_count then
    margin := existing.subtotal_cents::numeric
      - existing.discount_cents::numeric
      - total_cost;
    if total_cost < 0 or total_cost > 9223372036854775807::numeric
      or margin < -9223372036854775808::numeric
      or margin > 9223372036854775807::numeric
    then
      raise exception 'MONETARY_OVERFLOW' using errcode = '22003';
    end if;

    update public.sales set
      manufacturing_cost_cents = total_cost::bigint,
      manufacturing_margin_cents = margin::bigint,
      costing_complete = true,
      status = 'validated',
      validated_at = now()
    where id = p_sale_id and business_id = p_business_id;
  else
    update public.sales set
      manufacturing_cost_cents = null,
      manufacturing_margin_cents = null,
      costing_complete = false,
      status = 'validated',
      validated_at = now()
    where id = p_sale_id and business_id = p_business_id;
  end if;

  insert into public.audit_logs (business_id, user_id, action_type, entity_name, entity_id, old_data, new_data)
  values (
    p_business_id,
    actor,
    'validated',
    'sale',
    p_sale_id,
    jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', 'validated', 'costing_complete', linked_count = item_count)
  );
exception
  when numeric_value_out_of_range then
    raise exception 'MONETARY_OVERFLOW' using errcode = '22003';
end;
$$;

create or replace function public.protect_sale_mutations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'SALE_IMMUTABLE' using errcode = '55000'; end if;
    return old;
  end if;
  if old.status = 'cancelled' then raise exception 'SALE_IMMUTABLE' using errcode = '55000'; end if;
  if old.status = 'validated' then
    if new.status <> 'cancelled'
      or new.business_id <> old.business_id or new.reference <> old.reference
      or new.ordered_on <> old.ordered_on or new.channel <> old.channel
      or new.customer_name is distinct from old.customer_name or new.notes is distinct from old.notes
      or new.subtotal_cents <> old.subtotal_cents or new.shipping_cents <> old.shipping_cents
      or new.discount_cents <> old.discount_cents or new.total_cents <> old.total_cents
      or new.currency <> old.currency or new.validated_at <> old.validated_at
      or new.manufacturing_cost_cents is distinct from old.manufacturing_cost_cents
      or new.manufacturing_margin_cents is distinct from old.manufacturing_margin_cents
      or new.costing_complete is distinct from old.costing_complete
    then
      raise exception 'SALE_IMMUTABLE' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_sale_mutations() from public;
revoke all on function public.create_sale_draft(uuid, date, public.sale_channel, text, text, bigint, bigint, jsonb) from public;
revoke all on function public.update_sale_draft(uuid, uuid, date, public.sale_channel, text, text, bigint, bigint, jsonb) from public;
revoke all on function public.validate_sale(uuid, uuid) from public;
grant execute on function public.create_sale_draft(uuid, date, public.sale_channel, text, text, bigint, bigint, jsonb) to authenticated;
grant execute on function public.update_sale_draft(uuid, uuid, date, public.sale_channel, text, text, bigint, bigint, jsonb) to authenticated;
grant execute on function public.validate_sale(uuid, uuid) to authenticated;

comment on column public.sale_items.product_id is 'Produit courant associé au brouillon ; figé avec les snapshots lors de la validation.';
comment on column public.sale_items.unit_manufacturing_cost_cents is 'Coût de fabrication historique unitaire en centimes, jamais recalculé après validation.';
comment on column public.sales.manufacturing_margin_cents is 'Sous-total marchandises moins remise globale moins coût de fabrication ; livraison et frais commerciaux exclus.';
