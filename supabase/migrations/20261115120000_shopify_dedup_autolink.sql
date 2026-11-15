-- Commandes Shopify : pas de vente en double, et rattachement automatique des produits créés ensuite.
--
-- 1. Avant de créer une vente, l'import cherche une vente existante qui porte déjà le numéro de la commande
--    (dans la note, ex. « Commande Shopify #1007 », ou en référence d'encaissement) et qui n'est liée à aucun
--    autre import. S'il en trouve une, il s'y rattache sans jamais la modifier ; s'il en trouve plusieurs,
--    il ne crée rien et signale un doublon possible.
-- 2. Une ligne Shopify se rattache aussi à un produit de même nom (titre complet, sinon sans la variante).
-- 3. Dès qu'un produit est créé ou modifié (nom, SKU, activation), les brouillons Shopify en attente
--    qui le concernent sont relancés, à la fin de la transaction (recette déjà enregistrée).

-- Ventes existantes portant le numéro de commande, hors ventes annulées et ventes déjà liées à un autre import.
create function public.find_existing_shopify_sale(p_business_id uuid, p_order_name text, p_import_id uuid, out found_sale_id uuid, out match_count integer)
language plpgsql stable security definer set search_path = '' as $$
declare pattern text;
begin
  pattern := '(^|[^0-9A-Za-z])' || regexp_replace(btrim(p_order_name), '([.^$|?*+(){}\[\]\\])', '\\\1', 'g') || '([^0-9]|$)';
  select count(*)::integer, (array_agg(s.id order by s.created_at))[1] into match_count, found_sale_id
  from public.sales s
  where s.business_id = p_business_id
    and s.status <> 'cancelled'
    and not exists (select 1 from public.shopify_order_imports i where i.sale_id = s.id and i.id <> p_import_id)
    and (coalesce(s.notes, '') ~ pattern
      or exists (select 1 from public.payments p where p.sale_id = s.id and p.business_id = s.business_id and btrim(coalesce(p.external_reference, '')) = btrim(p_order_name)));
  if match_count <> 1 then found_sale_id := null; end if;
end $$;

-- Produit de l'application pour une ligne Shopify : lien de la variante, lien du produit, SKU, puis nom.
drop function public.resolve_shopify_line_product(uuid, text, text, text);
create function public.resolve_shopify_line_product(p_business_id uuid, p_product_gid text, p_variant_gid text, p_sku text, p_title text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  found uuid;
  base_title text := btrim(split_part(coalesce(p_title, ''), ' — ', 1));
begin
  if p_variant_gid is not null then
    select l.product_id into found from public.shopify_product_links l join public.products p on p.id = l.product_id and p.business_id = l.business_id
    where l.business_id = p_business_id and l.shopify_variant_gid = p_variant_gid and p.is_active;
    if found is not null then return found; end if;
  end if;
  if p_product_gid is not null then
    select l.product_id into found from public.shopify_product_links l join public.products p on p.id = l.product_id and p.business_id = l.business_id
    where l.business_id = p_business_id and l.shopify_product_gid = p_product_gid and l.shopify_variant_gid is null and p.is_active;
    if found is not null then return found; end if;
  end if;
  -- SKU, titre complet puis titre sans la variante : uniquement si un seul produit actif correspond.
  if nullif(btrim(coalesce(p_sku, '')), '') is not null then
    select min(p.id::text)::uuid into found from public.products p
    where p.business_id = p_business_id and p.is_active and lower(p.sku) = lower(btrim(p_sku))
    having count(*) = 1;
    if found is not null then return found; end if;
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is not null then
    select min(p.id::text)::uuid into found from public.products p
    where p.business_id = p_business_id and p.is_active and lower(btrim(p.name)) = lower(btrim(p_title))
    having count(*) = 1;
    if found is not null then return found; end if;
  end if;
  if base_title <> '' and base_title <> btrim(coalesce(p_title, '')) then
    select min(p.id::text)::uuid into found from public.products p
    where p.business_id = p_business_id and p.is_active and lower(btrim(p.name)) = lower(base_title)
    having count(*) = 1;
    if found is not null then return found; end if;
  end if;
  return null;
end $$;

create or replace function public.shopify_apply_order(p_business_id uuid, p_connection_id uuid, p_order jsonb, p_customer_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  imp public.shopify_order_imports;
  existing public.sales;
  line jsonb;
  product uuid;
  items jsonb := '[]'::jsonb;
  unlinked jsonb := '[]'::jsonb;
  flags text[] := '{}';
  subtotal numeric := 0;
  shipping bigint;
  discount bigint;
  total bigint;
  received bigint;
  fee bigint;
  sale uuid;
  final_status text;
  financial text := p_order->>'financial_status';
  match_sale uuid;
  matches integer;
  matched boolean;
begin
  if actor is null or not public.can_manage_business(p_business_id) then raise exception 'shopify import access denied' using errcode = '42501'; end if;
  if jsonb_typeof(p_order) <> 'object'
    or coalesce(p_order->>'gid', '') !~ '^gid://shopify/Order/[0-9]+$'
    or char_length(coalesce(p_order->>'name', '')) not between 1 and 100
    or coalesce(p_order->>'ordered_on', '') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(p_order->>'currency', '') !~ '^[A-Z]{3}$'
    or jsonb_typeof(p_order->'lines') <> 'array' or jsonb_array_length(p_order->'lines') > 200
    or coalesce(p_order->>'shipping_cents', '') !~ '^[0-9]{1,13}$'
    or coalesce(p_order->>'discount_cents', '') !~ '^[0-9]{1,13}$'
    or coalesce(p_order->>'total_cents', '') !~ '^[0-9]{1,13}$'
    or coalesce(p_order->>'received_cents', '') !~ '^[0-9]{1,13}$'
    or coalesce(p_order->>'refunded_cents', '') !~ '^[0-9]{1,13}$'
    or coalesce(p_order->>'tax_cents', '') !~ '^[0-9]{1,13}$'
    or coalesce(p_order->>'fee_cents', '') !~ '^[0-9]{1,13}$'
    or coalesce(p_order->>'payment_method', '') not in ('cash', 'card', 'bank_transfer', 'paypal', 'stripe', 'sumup', 'etsy', 'cheque', 'other')
    or coalesce(p_order->>'payment_on', '') !~ '^\d{4}-\d{2}-\d{2}$'
    or char_length(coalesce(p_customer_name, '')) > 160
  then raise exception 'invalid shopify order' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_order->'lines') l
    where char_length(coalesce(l->>'title', '')) not between 1 and 300
      or coalesce(l->>'quantity', '') !~ '^[1-9][0-9]{0,2}$'
      or coalesce(l->>'unit_price_cents', '') !~ '^[0-9]{1,13}$'
      or (l->>'product_gid' is not null and l->>'product_gid' !~ '^gid://shopify/Product/[0-9]+$')
      or (l->>'variant_gid' is not null and l->>'variant_gid' !~ '^gid://shopify/ProductVariant/[0-9]+$')
      or char_length(coalesce(l->>'sku', '')) > 100)
  then raise exception 'invalid shopify order line' using errcode = '22023'; end if;

  insert into public.shopify_order_imports(business_id, connection_id, shopify_order_gid, order_name, ordered_on, currency, total_cents, order_snapshot)
  values (p_business_id, p_connection_id, p_order->>'gid', p_order->>'name', (p_order->>'ordered_on')::date, p_order->>'currency', (p_order->>'total_cents')::bigint, p_order)
  on conflict (business_id, shopify_order_gid) do update set
    connection_id = coalesce(excluded.connection_id, public.shopify_order_imports.connection_id),
    order_name = excluded.order_name, ordered_on = excluded.ordered_on, currency = excluded.currency,
    total_cents = excluded.total_cents, order_snapshot = excluded.order_snapshot;
  select * into imp from public.shopify_order_imports where business_id = p_business_id and shopify_order_gid = p_order->>'gid' for update;

  -- Une vente portant déjà ce numéro de commande (saisie à la main, par Claude…) : on s'y rattache, sans doublon.
  if imp.sale_id is null then
    select f.found_sale_id, f.match_count into match_sale, matches from public.find_existing_shopify_sale(p_business_id, p_order->>'name', imp.id) f;
    if matches > 1 then
      update public.shopify_order_imports set status = 'needs_review', attention = array['possible_duplicate'], processed_at = now(), last_error_code = null where id = imp.id;
      return imp.id;
    elsif match_sale is not null then
      update public.shopify_order_imports set sale_id = match_sale, attention = array(select distinct unnest(attention || array['matched_existing_sale'])) where id = imp.id;
      select * into imp from public.shopify_order_imports where id = imp.id;
    end if;
  end if;
  matched := 'matched_existing_sale' = any(imp.attention);
  if imp.sale_id is not null then select * into existing from public.sales where id = imp.sale_id and business_id = p_business_id for update; end if;

  shipping := (p_order->>'shipping_cents')::bigint;
  discount := (p_order->>'discount_cents')::bigint;
  total := (p_order->>'total_cents')::bigint;
  received := (p_order->>'received_cents')::bigint;
  fee := (p_order->>'fee_cents')::bigint;

  -- Commandes de test, non payées ou annulées : aucune vente nouvelle.
  if (p_order->>'test')::boolean is true then
    update public.shopify_order_imports set status = 'ignored', processed_at = now(), last_error_code = null where id = imp.id;
    return imp.id;
  end if;
  if (p_order->>'cancelled')::boolean is true then
    if existing.id is not null and existing.status = 'draft' and not matched then
      perform public.delete_sale_draft(existing.id, p_business_id);
      update public.shopify_order_imports set sale_id = null, status = 'cancelled', attention = '{}', processed_at = now(), last_error_code = null where id = imp.id;
    elsif existing.id is not null then
      update public.shopify_order_imports set attention = array(select distinct unnest(imp.attention || array['order_cancelled'])), processed_at = now(), last_error_code = null where id = imp.id;
    else
      update public.shopify_order_imports set status = 'cancelled', processed_at = now(), last_error_code = null where id = imp.id;
    end if;
    return imp.id;
  end if;
  if financial not in ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED') then
    if existing.id is null then update public.shopify_order_imports set status = 'waiting_payment', processed_at = now(), last_error_code = null where id = imp.id; end if;
    return imp.id;
  end if;

  if (p_order->>'refunded_cents')::bigint > 0 then flags := array_append(flags, 'refund_to_record'); end if;

  -- Une vente validée, ou une vente existante à laquelle la commande a été rattachée, n'est jamais modifiée :
  -- seuls le statut et les signalements de l'import sont mis à jour.
  if existing.id is not null and (existing.status <> 'draft' or matched) then
    update public.shopify_order_imports set
      status = case existing.status when 'validated' then 'validated' when 'cancelled' then 'cancelled' else 'needs_review' end,
      attention = array(select distinct unnest(imp.attention || flags)),
      unlinked_items = case when matched then '[]'::jsonb else unlinked_items end,
      processed_at = now(), last_error_code = null
    where id = imp.id;
    return imp.id;
  end if;

  if p_order->>'currency' <> 'EUR' then
    update public.shopify_order_imports set status = 'needs_review', attention = array['currency'], processed_at = now(), last_error_code = null where id = imp.id;
    return imp.id;
  end if;

  for line in select value from jsonb_array_elements(p_order->'lines') loop
    product := public.resolve_shopify_line_product(p_business_id, line->>'product_gid', line->>'variant_gid', line->>'sku', line->>'title');
    items := items || jsonb_build_object('description', left(line->>'title', 300), 'quantity', (line->>'quantity')::integer, 'unit_price_cents', (line->>'unit_price_cents')::bigint, 'product_id', product);
    subtotal := subtotal + (line->>'quantity')::numeric * (line->>'unit_price_cents')::numeric;
    if product is null then
      unlinked := unlinked || jsonb_build_object('title', line->>'title', 'sku', line->>'sku', 'product_gid', line->>'product_gid', 'variant_gid', line->>'variant_gid');
    end if;
  end loop;
  if jsonb_array_length(items) = 0 then
    update public.shopify_order_imports set status = 'needs_review', attention = array['no_lines'], processed_at = now(), last_error_code = null where id = imp.id;
    return imp.id;
  end if;
  if jsonb_array_length(unlinked) > 0 then flags := array_append(flags, 'unlinked_products'); end if;
  if (p_order->>'tax_cents')::bigint > 0 then flags := array_append(flags, 'tax_present'); end if;
  if subtotal + shipping - discount <> total then flags := array_append(flags, 'total_mismatch'); end if;
  -- La remise ne peut pas dépasser le total avant remise : elle est ramenée à ce plafond et signalée.
  if discount::numeric > subtotal + shipping then discount := (subtotal + shipping)::bigint; flags := array_append(flags, 'total_mismatch'); end if;

  if existing.id is null then
    sale := public.create_sale_draft(p_business_id, (p_order->>'ordered_on')::date, 'shopify', p_customer_name, 'Commande Shopify ' || (p_order->>'name'), shipping, discount, items);
  else
    sale := existing.id;
    perform public.update_sale_draft(sale, p_business_id, (p_order->>'ordered_on')::date, 'shopify', coalesce(p_customer_name, existing.customer_name), existing.notes, shipping, discount, items);
  end if;

  if not (flags && array['unlinked_products', 'tax_present', 'total_mismatch']) then
    perform public.validate_sale(sale, p_business_id);
    received := least(received, (select total_cents from public.sales where id = sale));
    if received > 0 then
      perform public.record_payment(sale, p_business_id, (p_order->>'payment_on')::date, null, received, least(fee, received), (p_order->>'payment_method')::public.payment_method, left(p_order->>'name', 200), 'Encaissement Shopify');
    end if;
    final_status := 'validated';
  else
    final_status := 'draft_incomplete';
  end if;

  update public.shopify_order_imports set sale_id = sale, status = final_status, attention = flags, unlinked_items = unlinked, processed_at = now(), last_error_code = null where id = imp.id;
  return imp.id;
end $$;

-- Relance des brouillons Shopify en attente dès qu'un produit correspondant existe (fin de transaction).
create function public.shopify_relink_on_product_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare pending record;
begin
  if not new.is_active or auth.uid() is null or not public.can_manage_business(new.business_id) then return null; end if;
  for pending in
    select i.connection_id, i.order_snapshot from public.shopify_order_imports i
    where i.business_id = new.business_id and i.status = 'draft_incomplete' and not ('matched_existing_sale' = any(i.attention))
      and exists (select 1 from jsonb_array_elements(i.unlinked_items) u
        where (new.sku is not null and lower(btrim(coalesce(u->>'sku', ''))) = lower(btrim(new.sku)))
          or lower(btrim(coalesce(u->>'title', ''))) = lower(btrim(new.name))
          or lower(btrim(split_part(coalesce(u->>'title', ''), ' — ', 1))) = lower(btrim(new.name)))
  loop
    -- Au mieux : un échec de relance ne doit jamais empêcher l'enregistrement du produit.
    begin
      perform public.shopify_apply_order(new.business_id, pending.connection_id, pending.order_snapshot, null);
    exception when others then
      raise warning 'Relance Shopify ignorée (%)', sqlstate;
    end;
  end loop;
  return null;
end $$;

create constraint trigger products_shopify_relink
  after insert or update of name, sku, is_active on public.products
  deferrable initially deferred
  for each row execute function public.shopify_relink_on_product_change();

-- Rattrapage : les commandes déjà reçues sans vente sont rattachées à la vente existante qui porte leur numéro.
do $$
declare
  pending record;
  result record;
  sale_status public.sale_status;
begin
  for pending in select id, business_id, order_name from public.shopify_order_imports where sale_id is null and status in ('draft_incomplete', 'waiting_payment', 'needs_review') loop
    select * into result from public.find_existing_shopify_sale(pending.business_id, pending.order_name, pending.id);
    if result.found_sale_id is not null then
      select status into sale_status from public.sales where id = result.found_sale_id;
      update public.shopify_order_imports set
        sale_id = result.found_sale_id,
        status = case sale_status when 'validated' then 'validated' else 'needs_review' end,
        attention = array['matched_existing_sale'],
        unlinked_items = '[]'::jsonb
      where id = pending.id;
    end if;
  end loop;
end $$;

revoke all on function public.find_existing_shopify_sale(uuid, text, uuid), public.resolve_shopify_line_product(uuid, text, text, text, text), public.shopify_apply_order(uuid, uuid, jsonb, text), public.shopify_relink_on_product_change() from public, anon, authenticated;
