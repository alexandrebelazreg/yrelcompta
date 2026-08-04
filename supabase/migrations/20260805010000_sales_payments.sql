-- Ventes, encaissements et remboursements YrelCompta.
-- Les montants sont des entiers en centimes d'euro. Toutes les écritures
-- applicatives passent par les RPC SECURITY DEFINER de cette migration.

create type public.sale_status as enum ('draft', 'validated', 'cancelled');
create type public.sale_channel as enum ('direct', 'market', 'instagram', 'etsy', 'website', 'shopify', 'retailer', 'other');
create type public.payment_method as enum ('cash', 'card', 'bank_transfer', 'paypal', 'stripe', 'sumup', 'etsy', 'cheque', 'other');
create type public.refund_kind as enum ('customer_refund', 'correction');

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  reference text not null,
  ordered_on date not null,
  channel public.sale_channel not null,
  customer_name text,
  notes text,
  status public.sale_status not null default 'draft',
  subtotal_cents bigint not null,
  shipping_cents bigint not null default 0,
  discount_cents bigint not null default 0,
  total_cents bigint not null,
  currency text not null default 'EUR',
  created_by uuid references auth.users(id) on delete set null,
  validated_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_business_reference_key unique (business_id, reference),
  constraint sales_id_business_key unique (id, business_id),
  constraint sales_reference_length check (char_length(reference) between 10 and 40),
  constraint sales_customer_name_length check (customer_name is null or char_length(customer_name) <= 160),
  constraint sales_notes_length check (notes is null or char_length(notes) <= 2000),
  constraint sales_amounts_non_negative check (subtotal_cents >= 0 and shipping_cents >= 0 and discount_cents >= 0 and total_cents >= 0),
  constraint sales_discount_limit check (discount_cents <= subtotal_cents + shipping_cents),
  constraint sales_total_consistent check (total_cents = subtotal_cents + shipping_cents - discount_cents),
  constraint sales_currency_eur check (currency = 'EUR'),
  constraint sales_status_dates_consistent check (
    (status = 'draft' and validated_at is null and cancelled_at is null and cancellation_reason is null)
    or (status = 'validated' and validated_at is not null and cancelled_at is null and cancellation_reason is null)
    or (status = 'cancelled' and validated_at is not null and cancelled_at is not null and char_length(btrim(cancellation_reason)) between 2 and 500)
  )
);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  sale_id uuid not null,
  description text not null,
  quantity integer not null,
  unit_price_cents bigint not null,
  line_total_cents bigint generated always as (quantity::bigint * unit_price_cents) stored,
  position smallint not null,
  created_at timestamptz not null default now(),
  constraint sale_items_sale_position_key unique (sale_id, position),
  constraint sale_items_sale_business_fk foreign key (sale_id, business_id) references public.sales(id, business_id) on delete cascade,
  constraint sale_items_description_not_blank check (char_length(btrim(description)) between 1 and 300),
  constraint sale_items_quantity_range check (quantity between 1 and 999),
  constraint sale_items_unit_price_non_negative check (unit_price_cents >= 0),
  constraint sale_items_position_positive check (position > 0)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  sale_id uuid not null,
  received_on date not null,
  bank_deposited_on date,
  gross_amount_cents bigint not null,
  platform_fee_cents bigint not null default 0,
  net_deposit_cents bigint generated always as (gross_amount_cents - platform_fee_cents) stored,
  method public.payment_method not null,
  external_reference text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint payments_id_business_sale_key unique (id, business_id, sale_id),
  constraint payments_sale_business_fk foreign key (sale_id, business_id) references public.sales(id, business_id) on delete restrict,
  constraint payments_gross_positive check (gross_amount_cents > 0),
  constraint payments_fee_valid check (platform_fee_cents >= 0 and platform_fee_cents <= gross_amount_cents),
  constraint payments_bank_date_valid check (bank_deposited_on is null or bank_deposited_on >= received_on),
  constraint payments_external_reference_length check (external_reference is null or char_length(external_reference) <= 200),
  constraint payments_notes_length check (notes is null or char_length(notes) <= 2000)
);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  sale_id uuid not null,
  payment_id uuid not null,
  refunded_on date not null,
  amount_cents bigint not null,
  kind public.refund_kind not null,
  reason text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint refunds_payment_business_sale_fk foreign key (payment_id, business_id, sale_id) references public.payments(id, business_id, sale_id) on delete restrict,
  constraint refunds_sale_business_fk foreign key (sale_id, business_id) references public.sales(id, business_id) on delete restrict,
  constraint refunds_amount_positive check (amount_cents > 0),
  constraint refunds_reason_not_blank check (char_length(btrim(reason)) between 2 and 500)
);

create index sales_business_ordered_idx on public.sales(business_id, ordered_on desc);
create index sales_business_status_ordered_idx on public.sales(business_id, status, ordered_on desc);
create index payments_business_received_idx on public.payments(business_id, received_on desc);
create index payments_sale_received_idx on public.payments(sale_id, received_on);
create index refunds_business_refunded_idx on public.refunds(business_id, refunded_on desc);
create index refunds_payment_refunded_idx on public.refunds(payment_id, refunded_on);

create trigger sales_set_updated_at before update on public.sales
for each row execute function public.set_updated_at();

create function public.can_manage_business(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.business_members
    where business_id = target_business_id
      and user_id = auth.uid()
      and role in ('owner', 'member')
  );
$$;

revoke all on function public.can_manage_business(uuid) from public;
grant execute on function public.can_manage_business(uuid) to authenticated;

-- Défense en profondeur : les lignes d'une vente validée sont figées et les
-- écritures financières ne peuvent jamais être corrigées par UPDATE/DELETE.
create function public.protect_sale_mutations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'sale is immutable' using errcode = '55000'; end if;
    return old;
  end if;
  if old.status = 'cancelled' then raise exception 'sale is immutable' using errcode = '55000'; end if;
  if old.status = 'validated' then
    if new.status <> 'cancelled'
      or new.business_id <> old.business_id or new.reference <> old.reference
      or new.ordered_on <> old.ordered_on or new.channel <> old.channel
      or new.customer_name is distinct from old.customer_name or new.notes is distinct from old.notes
      or new.subtotal_cents <> old.subtotal_cents or new.shipping_cents <> old.shipping_cents
      or new.discount_cents <> old.discount_cents or new.total_cents <> old.total_cents
      or new.currency <> old.currency or new.validated_at <> old.validated_at
    then raise exception 'sale is immutable' using errcode = '55000'; end if;
  end if;
  return new;
end;
$$;

create function public.protect_sale_item_mutations()
returns trigger
language plpgsql
set search_path = ''
as $$
declare current_status public.sale_status; target_sale_id uuid;
begin
  target_sale_id := case when tg_op = 'DELETE' then old.sale_id else new.sale_id end;
  select status into current_status from public.sales where id = target_sale_id;
  -- Lors d'un ON DELETE CASCADE, la ligne parente a déjà disparu. Les suppressions
  -- directes trouvent toujours la vente grâce à la clé étrangère.
  if current_status is null and tg_op = 'DELETE' then return old; end if;
  if current_status is distinct from 'draft' then raise exception 'sale items are immutable' using errcode = '55000'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create function public.prevent_financial_record_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'financial record is immutable' using errcode = '55000'; end;
$$;

create trigger sales_protect before update or delete on public.sales for each row execute function public.protect_sale_mutations();
create trigger sale_items_protect before update or delete on public.sale_items for each row execute function public.protect_sale_item_mutations();
create trigger payments_immutable before update or delete on public.payments for each row execute function public.prevent_financial_record_mutation();
create trigger refunds_immutable before update or delete on public.refunds for each row execute function public.prevent_financial_record_mutation();

revoke all on function public.protect_sale_mutations() from public;
revoke all on function public.protect_sale_item_mutations() from public;
revoke all on function public.prevent_financial_record_mutation() from public;

alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;

revoke all on table public.sales, public.sale_items, public.payments, public.refunds from anon, authenticated;
grant select on table public.sales, public.sale_items, public.payments, public.refunds to authenticated;

create policy "sales_select_member" on public.sales for select to authenticated using (public.is_business_member(business_id));
create policy "sale_items_select_member" on public.sale_items for select to authenticated using (public.is_business_member(business_id));
create policy "payments_select_member" on public.payments for select to authenticated using (public.is_business_member(business_id));
create policy "refunds_select_member" on public.refunds for select to authenticated using (public.is_business_member(business_id));

-- Valide strictement le tableau JSON de lignes et retourne son sous-total.
create function public.sale_items_subtotal(p_items jsonb)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare item jsonb; subtotal bigint := 0; quantity_value integer; price_value bigint; description_value text;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 200 then
    raise exception 'invalid sale items' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) <> 'object'
      or not (item ?& array['description','quantity','unit_price_cents'])
      or (select count(*) from jsonb_object_keys(item)) <> 3
      or jsonb_typeof(item->'description') <> 'string'
      or jsonb_typeof(item->'quantity') <> 'number'
      or jsonb_typeof(item->'unit_price_cents') <> 'number'
      or (item->>'quantity') !~ '^\d+$'
      or (item->>'unit_price_cents') !~ '^\d+$'
    then raise exception 'invalid sale item' using errcode = '22023'; end if;
    description_value := btrim(item->>'description');
    quantity_value := (item->>'quantity')::integer;
    price_value := (item->>'unit_price_cents')::bigint;
    if char_length(description_value) not between 1 and 300 or quantity_value not between 1 and 999 or price_value < 0 then
      raise exception 'invalid sale item values' using errcode = '22023';
    end if;
    subtotal := subtotal + quantity_value::bigint * price_value;
  end loop;
  return subtotal;
end;
$$;
revoke all on function public.sale_items_subtotal(jsonb) from public;

create function public.create_sale_draft(
  p_business_id uuid, p_ordered_on date, p_channel public.sale_channel,
  p_customer_name text, p_notes text, p_shipping_cents bigint,
  p_discount_cents bigint, p_items jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); new_id uuid := gen_random_uuid(); subtotal bigint; total bigint; item jsonb; item_position smallint := 0; new_reference text;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not public.can_manage_business(p_business_id) then raise exception 'business access denied' using errcode = '42501'; end if;
  if p_ordered_on is null or p_channel is null or p_shipping_cents < 0 or p_discount_cents < 0 then raise exception 'invalid sale values' using errcode = '22023'; end if;
  if char_length(coalesce(p_customer_name, '')) > 160 or char_length(coalesce(p_notes, '')) > 2000 then raise exception 'sale text too long' using errcode = '22023'; end if;
  subtotal := public.sale_items_subtotal(p_items);
  if p_discount_cents > subtotal + p_shipping_cents then raise exception 'discount exceeds total' using errcode = '22023'; end if;
  total := subtotal + p_shipping_cents - p_discount_cents;
  new_reference := 'V-' || to_char(p_ordered_on, 'YYYYMMDD') || '-' || upper(substr(replace(new_id::text, '-', ''), 1, 12));
  insert into public.sales (id, business_id, reference, ordered_on, channel, customer_name, notes, subtotal_cents, shipping_cents, discount_cents, total_cents, created_by)
  values (new_id, p_business_id, new_reference, p_ordered_on, p_channel, nullif(btrim(p_customer_name), ''), nullif(btrim(p_notes), ''), subtotal, p_shipping_cents, p_discount_cents, total, actor);
  for item in select value from jsonb_array_elements(p_items) loop
    item_position := item_position + 1;
    insert into public.sale_items (business_id, sale_id, description, quantity, unit_price_cents, position)
    values (p_business_id, new_id, btrim(item->>'description'), (item->>'quantity')::integer, (item->>'unit_price_cents')::bigint, item_position);
  end loop;
  insert into public.audit_logs (business_id, user_id, action_type, entity_name, entity_id, new_data)
  values (p_business_id, actor, 'created', 'sale', new_id, jsonb_build_object('reference', new_reference, 'status', 'draft', 'total_cents', total));
  return new_id;
end; $$;

create function public.update_sale_draft(
  p_sale_id uuid, p_business_id uuid, p_ordered_on date, p_channel public.sale_channel,
  p_customer_name text, p_notes text, p_shipping_cents bigint,
  p_discount_cents bigint, p_items jsonb
)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); existing public.sales; subtotal bigint; total bigint; item jsonb; item_position smallint := 0; old_snapshot jsonb;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not public.can_manage_business(p_business_id) then raise exception 'business access denied' using errcode = '42501'; end if;
  select * into existing from public.sales where id = p_sale_id and business_id = p_business_id for update;
  if not found then raise exception 'sale not found' using errcode = 'P0002'; end if;
  if existing.status <> 'draft' then raise exception 'draft required' using errcode = '55000'; end if;
  if p_ordered_on is null or p_channel is null or p_shipping_cents < 0 or p_discount_cents < 0 then raise exception 'invalid sale values' using errcode = '22023'; end if;
  if char_length(coalesce(p_customer_name, '')) > 160 or char_length(coalesce(p_notes, '')) > 2000 then raise exception 'sale text too long' using errcode = '22023'; end if;
  subtotal := public.sale_items_subtotal(p_items);
  if p_discount_cents > subtotal + p_shipping_cents then raise exception 'discount exceeds total' using errcode = '22023'; end if;
  total := subtotal + p_shipping_cents - p_discount_cents;
  old_snapshot := jsonb_build_object('ordered_on', existing.ordered_on, 'channel', existing.channel, 'total_cents', existing.total_cents);
  delete from public.sale_items where sale_id = p_sale_id;
  update public.sales set ordered_on = p_ordered_on, channel = p_channel, customer_name = nullif(btrim(p_customer_name), ''), notes = nullif(btrim(p_notes), ''), subtotal_cents = subtotal, shipping_cents = p_shipping_cents, discount_cents = p_discount_cents, total_cents = total where id = p_sale_id;
  for item in select value from jsonb_array_elements(p_items) loop
    item_position := item_position + 1;
    insert into public.sale_items (business_id, sale_id, description, quantity, unit_price_cents, position)
    values (p_business_id, p_sale_id, btrim(item->>'description'), (item->>'quantity')::integer, (item->>'unit_price_cents')::bigint, item_position);
  end loop;
  insert into public.audit_logs (business_id, user_id, action_type, entity_name, entity_id, old_data, new_data)
  values (p_business_id, actor, 'updated', 'sale', p_sale_id, old_snapshot, jsonb_build_object('ordered_on', p_ordered_on, 'channel', p_channel, 'total_cents', total));
end; $$;

create function public.delete_sale_draft(p_sale_id uuid, p_business_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); existing public.sales;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not public.can_manage_business(p_business_id) then raise exception 'business access denied' using errcode = '42501'; end if;
  select * into existing from public.sales where id = p_sale_id and business_id = p_business_id for update;
  if not found then raise exception 'sale not found' using errcode = 'P0002'; end if;
  if existing.status <> 'draft' then raise exception 'draft required' using errcode = '55000'; end if;
  insert into public.audit_logs (business_id, user_id, action_type, entity_name, entity_id, old_data)
  values (p_business_id, actor, 'deleted', 'sale', p_sale_id, jsonb_build_object('reference', existing.reference, 'total_cents', existing.total_cents));
  delete from public.sales where id = p_sale_id;
end; $$;

create function public.validate_sale(p_sale_id uuid, p_business_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); existing public.sales; computed_subtotal bigint; item_count bigint;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not public.can_manage_business(p_business_id) then raise exception 'business access denied' using errcode = '42501'; end if;
  select * into existing from public.sales where id = p_sale_id and business_id = p_business_id for update;
  if not found then raise exception 'sale not found' using errcode = 'P0002'; end if;
  if existing.status <> 'draft' then raise exception 'draft required' using errcode = '55000'; end if;
  select count(*), coalesce(sum(line_total_cents), 0) into item_count, computed_subtotal from public.sale_items where sale_id = p_sale_id;
  if item_count < 1 or existing.total_cents <= 0 or computed_subtotal <> existing.subtotal_cents or existing.total_cents <> computed_subtotal + existing.shipping_cents - existing.discount_cents then raise exception 'sale totals invalid' using errcode = '23514'; end if;
  update public.sales set status = 'validated', validated_at = now() where id = p_sale_id;
  insert into public.audit_logs (business_id, user_id, action_type, entity_name, entity_id, old_data, new_data)
  values (p_business_id, actor, 'validated', 'sale', p_sale_id, jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'validated', 'total_cents', existing.total_cents));
end; $$;

create function public.record_payment(
  p_sale_id uuid, p_business_id uuid, p_received_on date, p_bank_deposited_on date,
  p_gross_amount_cents bigint, p_platform_fee_cents bigint, p_method public.payment_method,
  p_external_reference text, p_notes text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); existing public.sales; paid bigint; new_id uuid := gen_random_uuid();
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not public.can_manage_business(p_business_id) then raise exception 'business access denied' using errcode = '42501'; end if;
  select * into existing from public.sales where id = p_sale_id and business_id = p_business_id for update;
  if not found then raise exception 'sale not found' using errcode = 'P0002'; end if;
  if existing.status <> 'validated' then raise exception 'validated sale required' using errcode = '55000'; end if;
  if p_received_on is null or p_gross_amount_cents <= 0 or p_platform_fee_cents < 0 or p_platform_fee_cents > p_gross_amount_cents or (p_bank_deposited_on is not null and p_bank_deposited_on < p_received_on) then raise exception 'invalid payment values' using errcode = '22023'; end if;
  if char_length(coalesce(p_external_reference, '')) > 200 or char_length(coalesce(p_notes, '')) > 2000 then raise exception 'payment text too long' using errcode = '22023'; end if;
  select coalesce(sum(gross_amount_cents), 0) into paid from public.payments where sale_id = p_sale_id;
  if paid + p_gross_amount_cents > existing.total_cents then raise exception 'payment exceeds sale total' using errcode = '23514'; end if;
  insert into public.payments (id, business_id, sale_id, received_on, bank_deposited_on, gross_amount_cents, platform_fee_cents, method, external_reference, notes, created_by)
  values (new_id, p_business_id, p_sale_id, p_received_on, p_bank_deposited_on, p_gross_amount_cents, p_platform_fee_cents, p_method, nullif(btrim(p_external_reference), ''), nullif(btrim(p_notes), ''), actor);
  insert into public.audit_logs (business_id, user_id, action_type, entity_name, entity_id, new_data)
  values (p_business_id, actor, 'created', 'payment', new_id, jsonb_build_object('sale_id', p_sale_id, 'gross_amount_cents', p_gross_amount_cents, 'platform_fee_cents', p_platform_fee_cents));
  return new_id;
end; $$;

create function public.record_refund(
  p_payment_id uuid, p_sale_id uuid, p_business_id uuid, p_refunded_on date,
  p_amount_cents bigint, p_kind public.refund_kind, p_reason text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); existing public.payments; refunded bigint; new_id uuid := gen_random_uuid();
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not public.can_manage_business(p_business_id) then raise exception 'business access denied' using errcode = '42501'; end if;
  select * into existing from public.payments where id = p_payment_id and business_id = p_business_id and sale_id = p_sale_id for update;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  if p_refunded_on is null or p_refunded_on < existing.received_on or p_amount_cents <= 0 or p_kind is null or char_length(btrim(coalesce(p_reason, ''))) not between 2 and 500 then raise exception 'invalid refund values' using errcode = '22023'; end if;
  select coalesce(sum(amount_cents), 0) into refunded from public.refunds where payment_id = p_payment_id;
  if refunded + p_amount_cents > existing.gross_amount_cents then raise exception 'refund exceeds available amount' using errcode = '23514'; end if;
  insert into public.refunds (id, business_id, sale_id, payment_id, refunded_on, amount_cents, kind, reason, created_by)
  values (new_id, p_business_id, p_sale_id, p_payment_id, p_refunded_on, p_amount_cents, p_kind, btrim(p_reason), actor);
  insert into public.audit_logs (business_id, user_id, action_type, entity_name, entity_id, new_data)
  values (p_business_id, actor, 'created', 'refund', new_id, jsonb_build_object('sale_id', p_sale_id, 'payment_id', p_payment_id, 'amount_cents', p_amount_cents, 'kind', p_kind));
  return new_id;
end; $$;

create function public.cancel_sale(p_sale_id uuid, p_business_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); existing public.sales; gross bigint; refunded bigint;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not public.can_manage_business(p_business_id) then raise exception 'business access denied' using errcode = '42501'; end if;
  select * into existing from public.sales where id = p_sale_id and business_id = p_business_id for update;
  if not found then raise exception 'sale not found' using errcode = 'P0002'; end if;
  if existing.status <> 'validated' then raise exception 'validated sale required' using errcode = '55000'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 2 and 500 then raise exception 'cancellation reason required' using errcode = '22023'; end if;
  select coalesce(sum(gross_amount_cents), 0) into gross from public.payments where sale_id = p_sale_id;
  select coalesce(sum(amount_cents), 0) into refunded from public.refunds where sale_id = p_sale_id;
  if gross - refunded <> 0 then raise exception 'sale has a non-zero net payment' using errcode = '23514'; end if;
  update public.sales set status = 'cancelled', cancelled_at = now(), cancellation_reason = btrim(p_reason) where id = p_sale_id;
  insert into public.audit_logs (business_id, user_id, action_type, entity_name, entity_id, old_data, new_data)
  values (p_business_id, actor, 'cancelled', 'sale', p_sale_id, jsonb_build_object('status', 'validated'), jsonb_build_object('status', 'cancelled', 'reason', btrim(p_reason)));
end; $$;

revoke all on function public.create_sale_draft(uuid, date, public.sale_channel, text, text, bigint, bigint, jsonb) from public;
revoke all on function public.update_sale_draft(uuid, uuid, date, public.sale_channel, text, text, bigint, bigint, jsonb) from public;
revoke all on function public.delete_sale_draft(uuid, uuid) from public;
revoke all on function public.validate_sale(uuid, uuid) from public;
revoke all on function public.record_payment(uuid, uuid, date, date, bigint, bigint, public.payment_method, text, text) from public;
revoke all on function public.record_refund(uuid, uuid, uuid, date, bigint, public.refund_kind, text) from public;
revoke all on function public.cancel_sale(uuid, uuid, text) from public;

grant execute on function public.create_sale_draft(uuid, date, public.sale_channel, text, text, bigint, bigint, jsonb) to authenticated;
grant execute on function public.update_sale_draft(uuid, uuid, date, public.sale_channel, text, text, bigint, bigint, jsonb) to authenticated;
grant execute on function public.delete_sale_draft(uuid, uuid) to authenticated;
grant execute on function public.validate_sale(uuid, uuid) to authenticated;
grant execute on function public.record_payment(uuid, uuid, date, date, bigint, bigint, public.payment_method, text, text) to authenticated;
grant execute on function public.record_refund(uuid, uuid, uuid, date, bigint, public.refund_kind, text) to authenticated;
grant execute on function public.cancel_sale(uuid, uuid, text) to authenticated;

comment on table public.sales is 'Ventes YrelCompta. Les ventes validées sont immuables hors annulation contrôlée.';
comment on table public.payments is 'Encaissements bruts définitifs. Les commissions sont suivies séparément du chiffre d’affaires.';
comment on table public.refunds is 'Remboursements définitifs liés à un encaissement précis.';
