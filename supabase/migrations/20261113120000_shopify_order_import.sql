-- Import des commandes Shopify en ventes YrelCompta.
--
-- Une commande payée devient une vente du canal « shopify ». Les lignes sont reliées aux produits
-- de l'application (lien mémorisé, sinon SKU identique). Quand tout est fiable (produits reliés,
-- totaux cohérents, euros, sans TVA), la vente est validée et l'encaissement enregistré ;
-- sinon elle reste en brouillon « à compléter ». Une vente validée n'est jamais modifiée :
-- annulations et remboursements Shopify sont signalés pour être traités par l'utilisatrice.
--
-- Les ventes passent par les RPC existantes (create_sale_draft, update_sale_draft, validate_sale,
-- record_payment) : mêmes contrôles, snapshots de coût et journal d'audit que dans l'application.
-- Les tables restent en lecture seule sous RLS.

create table public.shopify_order_imports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  connection_id uuid references public.shopify_connections(id) on delete set null,
  shopify_order_gid text not null,
  order_name text not null,
  ordered_on date not null,
  currency text not null,
  total_cents bigint not null,
  sale_id uuid,
  status text not null default 'waiting_payment',
  attention text[] not null default '{}',
  unlinked_items jsonb not null default '[]'::jsonb,
  -- Commande normalisée, sans donnée cliente : permet de relancer l'import après une liaison de produit.
  order_snapshot jsonb not null,
  last_error_code text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shopify_order_imports_order_key unique (business_id, shopify_order_gid),
  constraint shopify_order_imports_sale_fk foreign key (sale_id, business_id) references public.sales(id, business_id) on delete set null (sale_id),
  constraint shopify_order_imports_gid check (shopify_order_gid ~ '^gid://shopify/Order/[0-9]+$'),
  constraint shopify_order_imports_name check (char_length(order_name) between 1 and 100),
  constraint shopify_order_imports_currency check (currency ~ '^[A-Z]{3}$'),
  constraint shopify_order_imports_total check (total_cents between 0 and 9000000000000),
  constraint shopify_order_imports_status check (status in ('validated', 'draft_incomplete', 'waiting_payment', 'needs_review', 'cancelled', 'ignored')),
  constraint shopify_order_imports_error_code check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]{2,80}$')
);
create index shopify_order_imports_business_idx on public.shopify_order_imports(business_id, ordered_on desc);
create trigger shopify_order_imports_set_updated_at before update on public.shopify_order_imports for each row execute function public.set_updated_at();

create table public.shopify_product_links (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  shopify_product_gid text not null,
  shopify_variant_gid text,
  shopify_title text not null,
  shopify_sku text,
  product_id uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shopify_product_links_product_fk foreign key (product_id, business_id) references public.products(id, business_id) on delete restrict,
  constraint shopify_product_links_product_gid check (shopify_product_gid ~ '^gid://shopify/Product/[0-9]+$'),
  constraint shopify_product_links_variant_gid check (shopify_variant_gid is null or shopify_variant_gid ~ '^gid://shopify/ProductVariant/[0-9]+$'),
  constraint shopify_product_links_title check (char_length(shopify_title) between 1 and 300),
  constraint shopify_product_links_sku check (shopify_sku is null or char_length(shopify_sku) <= 100)
);
create unique index shopify_product_links_variant_key on public.shopify_product_links(business_id, shopify_variant_gid) where shopify_variant_gid is not null;
create unique index shopify_product_links_product_key on public.shopify_product_links(business_id, shopify_product_gid) where shopify_variant_gid is null;
create trigger shopify_product_links_set_updated_at before update on public.shopify_product_links for each row execute function public.set_updated_at();

alter table public.shopify_order_imports enable row level security;
alter table public.shopify_product_links enable row level security;
revoke all on table public.shopify_order_imports, public.shopify_product_links from anon, authenticated;
grant select on table public.shopify_order_imports, public.shopify_product_links to authenticated;
create policy shopify_order_imports_select_member on public.shopify_order_imports for select to authenticated using (public.is_business_member(business_id));
create policy shopify_product_links_select_member on public.shopify_product_links for select to authenticated using (public.is_business_member(business_id));

-- Produit de l'application pour une ligne Shopify : lien de la variante, lien du produit, puis SKU identique.
create function public.resolve_shopify_line_product(p_business_id uuid, p_product_gid text, p_variant_gid text, p_sku text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare found uuid;
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
  if nullif(btrim(coalesce(p_sku, '')), '') is not null then
    select p.id into found from public.products p
    where p.business_id = p_business_id and p.is_active and lower(p.sku) = lower(btrim(p_sku))
      and (select count(*) from public.products q where q.business_id = p_business_id and q.is_active and lower(q.sku) = lower(btrim(p_sku))) = 1;
    if found is not null then return found; end if;
  end if;
  return null;
end $$;

-- Cœur de l'import, exécuté avec l'identité courante (auth.uid()) : n'est jamais exposé directement.
create function public.shopify_apply_order(p_business_id uuid, p_connection_id uuid, p_order jsonb, p_customer_name text)
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
    if existing.id is not null and existing.status = 'draft' then
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

  -- Une vente déjà validée n'est jamais modifiée : seuls les signalements sont mis à jour.
  if existing.id is not null and existing.status <> 'draft' then
    update public.shopify_order_imports set attention = array(select distinct unnest(imp.attention || flags)), processed_at = now(), last_error_code = null where id = imp.id;
    return imp.id;
  end if;

  if p_order->>'currency' <> 'EUR' then
    update public.shopify_order_imports set status = 'needs_review', attention = array['currency'], processed_at = now(), last_error_code = null where id = imp.id;
    return imp.id;
  end if;

  for line in select value from jsonb_array_elements(p_order->'lines') loop
    product := public.resolve_shopify_line_product(p_business_id, line->>'product_gid', line->>'variant_gid', line->>'sku');
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

-- Appel serveur (webhook ou import de l'historique) : agit au nom de la personne qui a connecté Shopify,
-- ou de l'utilisatrice qui lance l'import, après vérification de son appartenance à l'entreprise.
create function public.shopify_import_order(p_connection_id uuid, p_actor uuid, p_order jsonb, p_customer_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  connection public.shopify_connections;
  actor uuid;
begin
  select * into connection from public.shopify_connections where id = p_connection_id;
  if not found then raise exception 'shopify connection not found' using errcode = 'P0002'; end if;
  actor := coalesce(p_actor, connection.created_by, (select user_id from public.business_members where business_id = connection.business_id and role = 'owner' order by created_at limit 1));
  perform public.assert_shopify_actor_manager(connection.business_id, actor);
  -- Identité de l'acteur pour la durée de la transaction : les RPC de vente appliquent leurs contrôles habituels
  -- et le journal d'audit attribue l'écriture à la synchronisation Shopify.
  perform set_config('request.jwt.claim.sub', actor::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', actor, 'role', 'authenticated', 'client_id', 'shopify-sync')::text, true);
  return public.shopify_apply_order(connection.business_id, connection.id, p_order, nullif(btrim(coalesce(p_customer_name, '')), ''));
end $$;

create function public.mark_shopify_webhook_event(p_connection_id uuid, p_webhook_id text, p_status public.shopify_webhook_processing_status, p_error_code text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_error_code is not null and p_error_code !~ '^[A-Z0-9_]{2,80}$' then raise exception 'invalid error code' using errcode = '22023'; end if;
  update public.shopify_webhook_events set processing_status = p_status, processed_at = now(), last_error_code = p_error_code
  where connection_id = p_connection_id and webhook_id = p_webhook_id;
end $$;

-- Liaison d'un produit Shopify à un produit de l'application, puis relance des commandes concernées.
create function public.link_shopify_product(p_business_id uuid, p_shopify_product_gid text, p_shopify_variant_gid text, p_shopify_title text, p_shopify_sku text, p_product_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  pending record;
  relaunched integer := 0;
begin
  if actor is null or not public.can_manage_business(p_business_id) then raise exception 'shopify link access denied' using errcode = '42501'; end if;
  if coalesce(p_shopify_product_gid, '') !~ '^gid://shopify/Product/[0-9]+$'
    or (p_shopify_variant_gid is not null and p_shopify_variant_gid !~ '^gid://shopify/ProductVariant/[0-9]+$')
    or char_length(coalesce(btrim(p_shopify_title), '')) not between 1 and 300
    or char_length(coalesce(p_shopify_sku, '')) > 100
  then raise exception 'invalid shopify product link' using errcode = '22023'; end if;
  if not exists (select 1 from public.products where id = p_product_id and business_id = p_business_id and is_active) then raise exception 'product not found' using errcode = 'P0002'; end if;

  if p_shopify_variant_gid is not null then
    insert into public.shopify_product_links(business_id, shopify_product_gid, shopify_variant_gid, shopify_title, shopify_sku, product_id, created_by)
    values (p_business_id, p_shopify_product_gid, p_shopify_variant_gid, btrim(p_shopify_title), nullif(btrim(coalesce(p_shopify_sku, '')), ''), p_product_id, actor)
    on conflict (business_id, shopify_variant_gid) where shopify_variant_gid is not null do update set product_id = excluded.product_id, shopify_title = excluded.shopify_title, shopify_sku = excluded.shopify_sku;
  else
    insert into public.shopify_product_links(business_id, shopify_product_gid, shopify_variant_gid, shopify_title, shopify_sku, product_id, created_by)
    values (p_business_id, p_shopify_product_gid, null, btrim(p_shopify_title), nullif(btrim(coalesce(p_shopify_sku, '')), ''), p_product_id, actor)
    on conflict (business_id, shopify_product_gid) where shopify_variant_gid is null do update set product_id = excluded.product_id, shopify_title = excluded.shopify_title, shopify_sku = excluded.shopify_sku;
  end if;
  insert into public.audit_logs(business_id, user_id, action_type, entity_name, entity_id, new_data)
  values (p_business_id, actor, 'linked', 'shopify_product', p_product_id, jsonb_build_object('shopify_product_gid', p_shopify_product_gid, 'shopify_variant_gid', p_shopify_variant_gid));

  for pending in
    select i.connection_id, i.order_snapshot from public.shopify_order_imports i
    where i.business_id = p_business_id and i.status = 'draft_incomplete'
      and exists (select 1 from jsonb_array_elements(i.unlinked_items) u where u->>'product_gid' = p_shopify_product_gid)
  loop
    perform public.shopify_apply_order(p_business_id, pending.connection_id, pending.order_snapshot, null);
    relaunched := relaunched + 1;
  end loop;
  return relaunched;
end $$;

-- Relance manuelle d'une commande (après correction d'un produit, d'un SKU…), avec l'identité de l'utilisatrice.
create function public.reprocess_shopify_order_import(p_import_id uuid, p_business_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare imp public.shopify_order_imports;
begin
  if auth.uid() is null or not public.can_manage_business(p_business_id) then raise exception 'shopify import access denied' using errcode = '42501'; end if;
  select * into imp from public.shopify_order_imports where id = p_import_id and business_id = p_business_id;
  if not found then raise exception 'shopify import not found' using errcode = 'P0002'; end if;
  perform public.shopify_apply_order(p_business_id, imp.connection_id, imp.order_snapshot, null);
end $$;

-- Signalement traité (remboursement enregistré, annulation confirmée…).
create function public.dismiss_shopify_import_attention(p_import_id uuid, p_business_id uuid, p_flag text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null or not public.can_manage_business(p_business_id) then raise exception 'shopify import access denied' using errcode = '42501'; end if;
  if p_flag not in ('refund_to_record', 'order_cancelled') then raise exception 'invalid attention flag' using errcode = '22023'; end if;
  update public.shopify_order_imports set attention = array_remove(attention, p_flag) where id = p_import_id and business_id = p_business_id;
  if not found then raise exception 'shopify import not found' using errcode = 'P0002'; end if;
  insert into public.audit_logs(business_id, user_id, action_type, entity_name, entity_id, new_data)
  values (p_business_id, actor, 'resolved', 'shopify_order_import', p_import_id, jsonb_build_object('flag', p_flag));
end $$;

revoke all on function public.resolve_shopify_line_product(uuid, text, text, text), public.shopify_apply_order(uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.shopify_import_order(uuid, uuid, jsonb, text), public.mark_shopify_webhook_event(uuid, text, public.shopify_webhook_processing_status, text) from public, anon, authenticated;
grant execute on function public.shopify_import_order(uuid, uuid, jsonb, text), public.mark_shopify_webhook_event(uuid, text, public.shopify_webhook_processing_status, text) to service_role;
revoke all on function public.link_shopify_product(uuid, text, text, text, text, uuid), public.reprocess_shopify_order_import(uuid, uuid), public.dismiss_shopify_import_attention(uuid, uuid, text) from public, anon;
grant execute on function public.link_shopify_product(uuid, text, text, text, text, uuid), public.reprocess_shopify_order_import(uuid, uuid), public.dismiss_shopify_import_attention(uuid, uuid, text) to authenticated;

comment on table public.shopify_order_imports is 'Commandes Shopify reçues et vente YrelCompta associée ; instantané sans donnée cliente.';
comment on table public.shopify_product_links is 'Liens mémorisés entre produits (ou variantes) Shopify et produits YrelCompta.';
