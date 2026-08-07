-- Facturation commerciale V1 de YrelCompta.
-- Cette migration crée des snapshots immuables et une numérotation métier
-- transactionnelle. Elle ne transmet aucun document et ne calcule aucun taux de TVA.

create type public.billing_document_kind as enum ('invoice', 'credit_note');
create type public.billing_customer_kind as enum ('individual', 'professional');
create type public.billing_operation_category as enum ('goods', 'services', 'mixed');

create table public.invoice_settings (
  business_id uuid primary key references public.businesses(id) on delete restrict,
  issuer_legal_name text not null,
  issuer_trade_name text,
  issuer_siret text not null,
  issuer_address text not null,
  issuer_email text,
  issuer_phone text,
  issuer_registration_details text,
  vat_exemption_mention text not null,
  default_payment_terms text,
  default_early_payment_discount_terms text,
  default_late_penalty_terms text,
  default_recovery_indemnity_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_settings_legal_name check (char_length(btrim(issuer_legal_name)) between 2 and 200),
  constraint invoice_settings_trade_name check (issuer_trade_name is null or char_length(btrim(issuer_trade_name)) between 1 and 200),
  constraint invoice_settings_siret check (issuer_siret ~ '^[0-9]{14}$'),
  constraint invoice_settings_address check (char_length(btrim(issuer_address)) between 5 and 1000),
  constraint invoice_settings_email check (issuer_email is null or char_length(issuer_email) between 3 and 254),
  constraint invoice_settings_phone check (issuer_phone is null or char_length(issuer_phone) <= 50),
  constraint invoice_settings_registration check (issuer_registration_details is null or char_length(issuer_registration_details) <= 500),
  constraint invoice_settings_vat_mention check (char_length(btrim(vat_exemption_mention)) between 2 and 500),
  constraint invoice_settings_terms_lengths check (
    char_length(coalesce(default_payment_terms, '')) <= 1000
    and char_length(coalesce(default_early_payment_discount_terms, '')) <= 1000
    and char_length(coalesce(default_late_penalty_terms, '')) <= 1000
    and char_length(coalesce(default_recovery_indemnity_text, '')) <= 1000
  )
);

create trigger invoice_settings_set_updated_at before update on public.invoice_settings
for each row execute function public.set_updated_at();

create table public.billing_number_counters (
  business_id uuid not null references public.businesses(id) on delete restrict,
  document_kind public.billing_document_kind not null,
  series_year integer not null,
  last_value bigint not null,
  primary key (business_id, document_kind, series_year),
  constraint billing_number_counters_year check (series_year between 2000 and 9999),
  constraint billing_number_counters_value check (last_value > 0)
);

alter table public.refunds
  add constraint refunds_id_business_sale_key
  unique (id, business_id, sale_id);

create table public.billing_documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  sale_id uuid not null,
  kind public.billing_document_kind not null,
  number text not null,
  issued_on date not null,
  supply_on date not null,
  original_invoice_id uuid,
  linked_refund_id uuid,
  operation_category public.billing_operation_category not null,
  buyer_kind public.billing_customer_kind not null,
  buyer_name text not null,
  buyer_address text,
  buyer_address_omitted boolean not null default false,
  buyer_billing_address text,
  buyer_delivery_address text,
  buyer_email text,
  buyer_siren text,
  buyer_vat_number text,
  purchase_order_reference text,
  issuer_legal_name_snapshot text not null,
  issuer_trade_name_snapshot text,
  issuer_siret_snapshot text not null,
  issuer_siren_snapshot text not null,
  issuer_address_snapshot text not null,
  issuer_email_snapshot text,
  issuer_phone_snapshot text,
  issuer_registration_details_snapshot text,
  vat_regime_snapshot public.vat_regime not null,
  vat_exemption_mention_snapshot text not null,
  subtotal_excl_tax_cents bigint not null,
  shipping_excl_tax_cents bigint not null,
  discount_excl_tax_cents bigint not null,
  total_excl_tax_cents bigint not null,
  vat_cents bigint not null,
  total_incl_tax_cents bigint not null,
  payment_due_on date not null,
  payment_terms_snapshot text,
  early_payment_discount_terms_snapshot text,
  late_penalty_terms_snapshot text,
  recovery_indemnity_snapshot text,
  credit_reason text,
  render_version smallint not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint billing_documents_id_business_key unique (id, business_id),
  constraint billing_documents_id_business_sale_key unique (id, business_id, sale_id),
  constraint billing_documents_business_number_key unique (business_id, number),
  constraint billing_documents_sale_business_fk foreign key (sale_id, business_id) references public.sales(id, business_id) on delete restrict,
  constraint billing_documents_original_business_fk foreign key (original_invoice_id, business_id) references public.billing_documents(id, business_id) on delete restrict,
  constraint billing_documents_refund_business_sale_fk foreign key (linked_refund_id, business_id, sale_id) references public.refunds(id, business_id, sale_id) on delete restrict,
  constraint billing_documents_number_format check (
    (kind = 'invoice' and number ~ '^FAC-[0-9]{4}-[0-9]{6,}$')
    or (kind = 'credit_note' and number ~ '^AV-[0-9]{4}-[0-9]{6,}$')
  ),
  constraint billing_documents_supply_date check (supply_on <= issued_on),
  constraint billing_documents_payment_due check (payment_due_on >= issued_on),
  constraint billing_documents_kind_consistency check (
    (kind = 'invoice' and original_invoice_id is null and linked_refund_id is null and credit_reason is null)
    or (kind = 'credit_note' and original_invoice_id is not null and char_length(btrim(coalesce(credit_reason, ''))) between 2 and 500)
  ),
  constraint billing_documents_linked_refund_kind check (linked_refund_id is null or kind = 'credit_note'),
  constraint billing_documents_buyer_name check (char_length(btrim(buyer_name)) between 1 and 200),
  constraint billing_documents_buyer_address check (
    (buyer_kind = 'professional' and buyer_address_omitted = false and char_length(btrim(coalesce(buyer_address, ''))) between 5 and 1000)
    or (buyer_kind = 'individual' and buyer_address_omitted = true and buyer_address is null)
    or (buyer_kind = 'individual' and buyer_address_omitted = false and char_length(btrim(coalesce(buyer_address, ''))) between 5 and 1000)
  ),
  constraint billing_documents_buyer_siren check (
    (buyer_kind = 'individual' and (buyer_siren is null or buyer_siren ~ '^[0-9]{9}$'))
    or (buyer_kind = 'professional' and buyer_siren is not null and buyer_siren ~ '^[0-9]{9}$')
  ),
  constraint billing_documents_buyer_email check (buyer_email is null or char_length(buyer_email) between 3 and 254),
  constraint billing_documents_buyer_text_lengths check (
    char_length(coalesce(buyer_billing_address, '')) <= 1000
    and char_length(coalesce(buyer_delivery_address, '')) <= 1000
    and char_length(coalesce(buyer_vat_number, '')) <= 50
    and char_length(coalesce(purchase_order_reference, '')) <= 200
  ),
  constraint billing_documents_issuer_identity check (
    char_length(btrim(issuer_legal_name_snapshot)) between 2 and 200
    and issuer_siret_snapshot ~ '^[0-9]{14}$'
    and issuer_siren_snapshot ~ '^[0-9]{9}$'
    and issuer_siren_snapshot = substring(issuer_siret_snapshot from 1 for 9)
    and char_length(btrim(issuer_address_snapshot)) between 5 and 1000
  ),
  constraint billing_documents_amounts_non_negative check (
    subtotal_excl_tax_cents >= 0 and shipping_excl_tax_cents >= 0
    and discount_excl_tax_cents >= 0 and total_excl_tax_cents >= 0
    and vat_cents >= 0 and total_incl_tax_cents >= 0
  ),
  constraint billing_documents_totals_consistent check (
    total_excl_tax_cents = subtotal_excl_tax_cents + shipping_excl_tax_cents - discount_excl_tax_cents
    and total_incl_tax_cents = total_excl_tax_cents + vat_cents
  ),
  constraint billing_documents_render_version check (render_version > 0)
);

create unique index billing_documents_one_invoice_per_sale_idx
  on public.billing_documents(business_id, sale_id) where kind = 'invoice';
create unique index billing_documents_linked_refund_unique_idx
  on public.billing_documents(business_id, linked_refund_id) where linked_refund_id is not null;
create index billing_documents_business_issued_idx
  on public.billing_documents(business_id, issued_on desc, created_at desc, id desc);
create index billing_documents_original_idx
  on public.billing_documents(original_invoice_id) where original_invoice_id is not null;

create table public.billing_document_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  billing_document_id uuid not null,
  description text not null,
  quantity integer not null,
  unit_price_excl_tax_cents bigint not null,
  line_total_excl_tax_cents bigint not null,
  position smallint not null,
  created_at timestamptz not null default now(),
  constraint billing_document_items_document_position_key unique (billing_document_id, position),
  constraint billing_document_items_document_business_fk foreign key (billing_document_id, business_id) references public.billing_documents(id, business_id) on delete restrict,
  constraint billing_document_items_description check (char_length(btrim(description)) between 1 and 600),
  constraint billing_document_items_quantity check (quantity between 1 and 999),
  constraint billing_document_items_amounts check (
    unit_price_excl_tax_cents >= 0
    and line_total_excl_tax_cents = quantity::bigint * unit_price_excl_tax_cents
  ),
  constraint billing_document_items_position check (position > 0)
);

create function public.prevent_billing_record_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'billing record is immutable' using errcode = '55000';
end;
$$;

create trigger billing_documents_immutable before update or delete on public.billing_documents
for each row execute function public.prevent_billing_record_mutation();
create trigger billing_document_items_immutable before update or delete on public.billing_document_items
for each row execute function public.prevent_billing_record_mutation();
revoke all on function public.prevent_billing_record_mutation() from public;

alter table public.invoice_settings enable row level security;
alter table public.billing_number_counters enable row level security;
alter table public.billing_documents enable row level security;
alter table public.billing_document_items enable row level security;

revoke all on table public.invoice_settings from anon, authenticated;
revoke all on table public.billing_number_counters from anon, authenticated;
revoke all on table public.billing_documents from anon, authenticated;
revoke all on table public.billing_document_items from anon, authenticated;
grant select on table public.invoice_settings to authenticated;
grant select on table public.billing_documents to authenticated;
grant select on table public.billing_document_items to authenticated;

create policy invoice_settings_select_member on public.invoice_settings for select to authenticated
using (public.is_business_member(business_id));
create policy billing_documents_select_member on public.billing_documents for select to authenticated
using (public.is_business_member(business_id));
create policy billing_document_items_select_member on public.billing_document_items for select to authenticated
using (public.is_business_member(business_id));

create function public.save_invoice_settings(
  p_business_id uuid,
  p_issuer_legal_name text,
  p_issuer_trade_name text,
  p_issuer_siret text,
  p_issuer_address text,
  p_issuer_email text,
  p_issuer_phone text,
  p_issuer_registration_details text,
  p_vat_exemption_mention text,
  p_default_payment_terms text,
  p_default_early_payment_discount_terms text,
  p_default_late_penalty_terms text,
  p_default_recovery_indemnity_text text
)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not public.is_business_owner(p_business_id) then raise exception 'owner access required' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_issuer_legal_name, ''))) not between 2 and 200
    or coalesce(p_issuer_siret, '') !~ '^[0-9]{14}$'
    or char_length(btrim(coalesce(p_issuer_address, ''))) not between 5 and 1000
    or char_length(btrim(coalesce(p_vat_exemption_mention, ''))) not between 2 and 500
  then raise exception 'invalid invoice settings' using errcode = '22023'; end if;

  insert into public.invoice_settings (
    business_id, issuer_legal_name, issuer_trade_name, issuer_siret, issuer_address,
    issuer_email, issuer_phone, issuer_registration_details, vat_exemption_mention,
    default_payment_terms, default_early_payment_discount_terms,
    default_late_penalty_terms, default_recovery_indemnity_text
  ) values (
    p_business_id, btrim(p_issuer_legal_name), nullif(btrim(p_issuer_trade_name), ''), p_issuer_siret, btrim(p_issuer_address),
    nullif(btrim(p_issuer_email), ''), nullif(btrim(p_issuer_phone), ''), nullif(btrim(p_issuer_registration_details), ''), btrim(p_vat_exemption_mention),
    nullif(btrim(p_default_payment_terms), ''), nullif(btrim(p_default_early_payment_discount_terms), ''),
    nullif(btrim(p_default_late_penalty_terms), ''), nullif(btrim(p_default_recovery_indemnity_text), '')
  ) on conflict (business_id) do update set
    issuer_legal_name = excluded.issuer_legal_name,
    issuer_trade_name = excluded.issuer_trade_name,
    issuer_siret = excluded.issuer_siret,
    issuer_address = excluded.issuer_address,
    issuer_email = excluded.issuer_email,
    issuer_phone = excluded.issuer_phone,
    issuer_registration_details = excluded.issuer_registration_details,
    vat_exemption_mention = excluded.vat_exemption_mention,
    default_payment_terms = excluded.default_payment_terms,
    default_early_payment_discount_terms = excluded.default_early_payment_discount_terms,
    default_late_penalty_terms = excluded.default_late_penalty_terms,
    default_recovery_indemnity_text = excluded.default_recovery_indemnity_text;

  insert into public.audit_logs (business_id, user_id, action_type, entity_name, entity_id, new_data)
  values (p_business_id, actor, 'configured', 'invoice_settings', p_business_id, '{"invoice_settings_updated":true}'::jsonb);
end;
$$;

create function public.issue_invoice(
  p_business_id uuid,
  p_sale_id uuid,
  p_supply_on date,
  p_operation_category public.billing_operation_category,
  p_buyer_kind public.billing_customer_kind,
  p_buyer_name text,
  p_buyer_address text,
  p_buyer_address_omitted boolean,
  p_buyer_billing_address text,
  p_buyer_delivery_address text,
  p_buyer_email text,
  p_buyer_siren text,
  p_buyer_vat_number text,
  p_purchase_order_reference text,
  p_payment_due_on date
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  today_paris date := (now() at time zone 'Europe/Paris')::date;
  sale_row public.sales;
  settings_row public.invoice_settings;
  business_row public.business_settings;
  document_id uuid := gen_random_uuid();
  next_value bigint;
  document_number text;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not public.can_manage_business(p_business_id) then raise exception 'business access denied' using errcode = '42501'; end if;

  select * into sale_row from public.sales where id = p_sale_id and business_id = p_business_id for update;
  if not found then raise exception 'sale not found' using errcode = 'P0002'; end if;
  if sale_row.status <> 'validated' then raise exception 'validated sale required' using errcode = '55000'; end if;
  if exists (select 1 from public.billing_documents where business_id = p_business_id and sale_id = p_sale_id and kind = 'invoice')
    then raise exception 'invoice already issued for sale' using errcode = '23505'; end if;

  select * into settings_row from public.invoice_settings where business_id = p_business_id;
  if not found then raise exception 'invoice settings required' using errcode = '23514'; end if;
  select * into business_row from public.business_settings where business_id = p_business_id;
  if not found then raise exception 'business settings required' using errcode = '23514'; end if;
  if business_row.vat_regime <> 'franchise' then raise exception 'VAT_INVOICING_NOT_SUPPORTED' using errcode = 'P0001'; end if;

  if p_supply_on is null or p_supply_on > today_paris then raise exception 'invalid supply date' using errcode = '22023'; end if;
  if p_payment_due_on is null or p_payment_due_on < today_paris then raise exception 'invalid payment due date' using errcode = '22023'; end if;
  if p_operation_category is null or p_buyer_kind is null or char_length(btrim(coalesce(p_buyer_name, ''))) not between 1 and 200
    then raise exception 'invalid buyer identity' using errcode = '22023'; end if;
  if p_buyer_kind = 'professional' and (coalesce(p_buyer_address_omitted, false) or char_length(btrim(coalesce(p_buyer_address, ''))) not between 5 and 1000)
    then raise exception 'professional buyer address required' using errcode = '22023'; end if;
  if p_buyer_kind = 'individual' and (
    (coalesce(p_buyer_address_omitted, false) and nullif(btrim(p_buyer_address), '') is not null)
    or (not coalesce(p_buyer_address_omitted, false) and char_length(btrim(coalesce(p_buyer_address, ''))) not between 5 and 1000)
  ) then raise exception 'invalid individual buyer address' using errcode = '22023'; end if;
  if p_buyer_kind = 'professional' and coalesce(p_buyer_siren, '') !~ '^[0-9]{9}$'
    then raise exception 'PROFESSIONAL_BUYER_SIREN_REQUIRED' using errcode = '23514'; end if;
  if p_buyer_kind = 'individual' and p_buyer_siren is not null and p_buyer_siren !~ '^[0-9]{9}$'
    then raise exception 'invalid buyer siren' using errcode = '22023'; end if;
  if p_buyer_kind = 'professional' and (
    settings_row.default_payment_terms is null
    or settings_row.default_early_payment_discount_terms is null
    or settings_row.default_late_penalty_terms is null
    or settings_row.default_recovery_indemnity_text is null
  ) then raise exception 'professional invoice terms required' using errcode = '23514'; end if;

  insert into public.billing_number_counters (business_id, document_kind, series_year, last_value)
  values (p_business_id, 'invoice', extract(year from today_paris)::integer, 1)
  on conflict (business_id, document_kind, series_year)
  do update set last_value = billing_number_counters.last_value + 1
  returning last_value into next_value;
  document_number := 'FAC-' || extract(year from today_paris)::integer::text || '-' || lpad(next_value::text, 6, '0');

  insert into public.billing_documents (
    id, business_id, sale_id, kind, number, issued_on, supply_on, operation_category,
    buyer_kind, buyer_name, buyer_address, buyer_address_omitted, buyer_billing_address,
    buyer_delivery_address, buyer_email, buyer_siren, buyer_vat_number, purchase_order_reference,
    issuer_legal_name_snapshot, issuer_trade_name_snapshot, issuer_siret_snapshot, issuer_siren_snapshot,
    issuer_address_snapshot, issuer_email_snapshot, issuer_phone_snapshot, issuer_registration_details_snapshot,
    vat_regime_snapshot, vat_exemption_mention_snapshot,
    subtotal_excl_tax_cents, shipping_excl_tax_cents, discount_excl_tax_cents,
    total_excl_tax_cents, vat_cents, total_incl_tax_cents, payment_due_on,
    payment_terms_snapshot, early_payment_discount_terms_snapshot, late_penalty_terms_snapshot,
    recovery_indemnity_snapshot, created_by
  ) values (
    document_id, p_business_id, p_sale_id, 'invoice', document_number, today_paris, p_supply_on, p_operation_category,
    p_buyer_kind, btrim(p_buyer_name), nullif(btrim(p_buyer_address), ''), coalesce(p_buyer_address_omitted, false),
    nullif(btrim(p_buyer_billing_address), ''), nullif(btrim(p_buyer_delivery_address), ''),
    nullif(btrim(p_buyer_email), ''), nullif(btrim(p_buyer_siren), ''), nullif(btrim(p_buyer_vat_number), ''), nullif(btrim(p_purchase_order_reference), ''),
    settings_row.issuer_legal_name, settings_row.issuer_trade_name, settings_row.issuer_siret, substring(settings_row.issuer_siret from 1 for 9),
    settings_row.issuer_address, settings_row.issuer_email, settings_row.issuer_phone, settings_row.issuer_registration_details,
    business_row.vat_regime, settings_row.vat_exemption_mention,
    sale_row.subtotal_cents, sale_row.shipping_cents, sale_row.discount_cents,
    sale_row.total_cents, 0, sale_row.total_cents, p_payment_due_on,
    case when p_buyer_kind = 'professional' then settings_row.default_payment_terms end,
    case when p_buyer_kind = 'professional' then settings_row.default_early_payment_discount_terms end,
    case when p_buyer_kind = 'professional' then settings_row.default_late_penalty_terms end,
    case when p_buyer_kind = 'professional' then settings_row.default_recovery_indemnity_text end,
    actor
  );

  insert into public.billing_document_items (
    business_id, billing_document_id, description, quantity,
    unit_price_excl_tax_cents, line_total_excl_tax_cents, position
  ) select p_business_id, document_id, description, quantity, unit_price_cents, line_total_cents, position
    from public.sale_items where sale_id = p_sale_id and business_id = p_business_id order by position;
  if not found then raise exception 'sale items required' using errcode = '23514'; end if;

  insert into public.audit_logs (business_id, user_id, action_type, entity_name, entity_id, new_data)
  values (p_business_id, actor, 'issued', 'billing_document', document_id,
    jsonb_build_object('kind', 'invoice', 'sale_id', p_sale_id, 'number', document_number));
  return document_id;
end;
$$;

create function public.issue_credit_note(
  p_business_id uuid,
  p_original_invoice_id uuid,
  p_amount_cents bigint,
  p_reason text,
  p_linked_refund_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  today_paris date := (now() at time zone 'Europe/Paris')::date;
  original public.billing_documents;
  refund_row public.refunds;
  already_credited bigint;
  document_id uuid := gen_random_uuid();
  next_value bigint;
  document_number text;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not public.can_manage_business(p_business_id) then raise exception 'business access denied' using errcode = '42501'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'credit amount must be positive' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 2 and 500 then raise exception 'credit reason required' using errcode = '22023'; end if;

  select * into original from public.billing_documents
  where id = p_original_invoice_id and business_id = p_business_id and kind = 'invoice' for update;
  if not found then raise exception 'original invoice not found' using errcode = 'P0002'; end if;
  select coalesce(sum(total_incl_tax_cents), 0) into already_credited
    from public.billing_documents where original_invoice_id = original.id and business_id = p_business_id and kind = 'credit_note';
  if already_credited + p_amount_cents > original.total_incl_tax_cents
    then raise exception 'credit exceeds invoice total' using errcode = '23514'; end if;

  if p_linked_refund_id is not null then
    select * into refund_row from public.refunds
      where id = p_linked_refund_id and business_id = p_business_id and sale_id = original.sale_id for update;
    if not found then raise exception 'linked refund does not match invoice sale' using errcode = '23514'; end if;
    if refund_row.amount_cents <> p_amount_cents then raise exception 'credit and refund amounts differ' using errcode = '23514'; end if;
    if exists (select 1 from public.billing_documents where business_id = p_business_id and linked_refund_id = p_linked_refund_id)
      then raise exception 'refund already linked to credit note' using errcode = '23505'; end if;
  end if;

  insert into public.billing_number_counters (business_id, document_kind, series_year, last_value)
  values (p_business_id, 'credit_note', extract(year from today_paris)::integer, 1)
  on conflict (business_id, document_kind, series_year)
  do update set last_value = billing_number_counters.last_value + 1
  returning last_value into next_value;
  document_number := 'AV-' || extract(year from today_paris)::integer::text || '-' || lpad(next_value::text, 6, '0');

  insert into public.billing_documents (
    id, business_id, sale_id, kind, number, issued_on, supply_on, original_invoice_id, linked_refund_id,
    operation_category, buyer_kind, buyer_name, buyer_address, buyer_address_omitted,
    buyer_billing_address, buyer_delivery_address, buyer_email, buyer_siren, buyer_vat_number, purchase_order_reference,
    issuer_legal_name_snapshot, issuer_trade_name_snapshot, issuer_siret_snapshot, issuer_siren_snapshot,
    issuer_address_snapshot, issuer_email_snapshot, issuer_phone_snapshot, issuer_registration_details_snapshot,
    vat_regime_snapshot, vat_exemption_mention_snapshot,
    subtotal_excl_tax_cents, shipping_excl_tax_cents, discount_excl_tax_cents,
    total_excl_tax_cents, vat_cents, total_incl_tax_cents, payment_due_on,
    payment_terms_snapshot, early_payment_discount_terms_snapshot, late_penalty_terms_snapshot,
    recovery_indemnity_snapshot, credit_reason, render_version, created_by
  ) values (
    document_id, p_business_id, original.sale_id, 'credit_note', document_number, today_paris, original.supply_on,
    original.id, p_linked_refund_id, original.operation_category, original.buyer_kind, original.buyer_name,
    original.buyer_address, original.buyer_address_omitted, original.buyer_billing_address,
    original.buyer_delivery_address, original.buyer_email, original.buyer_siren,
    original.buyer_vat_number, original.purchase_order_reference,
    original.issuer_legal_name_snapshot, original.issuer_trade_name_snapshot,
    original.issuer_siret_snapshot, original.issuer_siren_snapshot, original.issuer_address_snapshot,
    original.issuer_email_snapshot, original.issuer_phone_snapshot, original.issuer_registration_details_snapshot,
    original.vat_regime_snapshot, original.vat_exemption_mention_snapshot,
    p_amount_cents, 0, 0, p_amount_cents, 0, p_amount_cents, today_paris,
    original.payment_terms_snapshot, original.early_payment_discount_terms_snapshot,
    original.late_penalty_terms_snapshot, original.recovery_indemnity_snapshot,
    btrim(p_reason), original.render_version, actor
  );

  insert into public.billing_document_items (
    business_id, billing_document_id, description, quantity,
    unit_price_excl_tax_cents, line_total_excl_tax_cents, position
  ) values (p_business_id, document_id, 'Avoir — ' || btrim(p_reason), 1, p_amount_cents, p_amount_cents, 1);

  insert into public.audit_logs (business_id, user_id, action_type, entity_name, entity_id, new_data)
  values (p_business_id, actor, 'issued', 'billing_document', document_id,
    jsonb_build_object('kind', 'credit_note', 'sale_id', original.sale_id, 'number', document_number, 'original_invoice_id', original.id));
  return document_id;
end;
$$;

-- Remplacement ciblé : toutes les protections historiques sont conservées et
-- une vente facturée exige désormais un crédit intégral avant annulation.
create or replace function public.cancel_sale(p_sale_id uuid, p_business_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  existing public.sales;
  gross bigint;
  refunded bigint;
  invoice_row public.billing_documents;
  credited bigint;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not public.can_manage_business(p_business_id) then raise exception 'business access denied' using errcode = '42501'; end if;
  select * into existing from public.sales where id = p_sale_id and business_id = p_business_id for update;
  if not found then raise exception 'sale not found' using errcode = 'P0002'; end if;
  if existing.status <> 'validated' then raise exception 'validated sale required' using errcode = '55000'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 2 and 500 then raise exception 'cancellation reason required' using errcode = '22023'; end if;

  select * into invoice_row from public.billing_documents
    where business_id = p_business_id and sale_id = p_sale_id and kind = 'invoice' for update;
  if found then
    select coalesce(sum(total_incl_tax_cents), 0) into credited from public.billing_documents
      where business_id = p_business_id and original_invoice_id = invoice_row.id and kind = 'credit_note';
    if credited <> invoice_row.total_incl_tax_cents
      then raise exception 'BILLED_SALE_REQUIRES_FULL_CREDIT' using errcode = '23514'; end if;
  end if;

  select coalesce(sum(gross_amount_cents), 0) into gross from public.payments where sale_id = p_sale_id;
  select coalesce(sum(amount_cents), 0) into refunded from public.refunds where sale_id = p_sale_id;
  if gross - refunded <> 0 then raise exception 'sale has a non-zero net payment' using errcode = '23514'; end if;
  update public.sales set status = 'cancelled', cancelled_at = now(), cancellation_reason = btrim(p_reason) where id = p_sale_id;
  insert into public.audit_logs (business_id, user_id, action_type, entity_name, entity_id, old_data, new_data)
  values (p_business_id, actor, 'cancelled', 'sale', p_sale_id,
    jsonb_build_object('status', 'validated'), jsonb_build_object('status', 'cancelled', 'reason', btrim(p_reason)));
end;
$$;

revoke all on function public.save_invoice_settings(uuid, text, text, text, text, text, text, text, text, text, text, text, text) from public;
revoke all on function public.issue_invoice(uuid, uuid, date, public.billing_operation_category, public.billing_customer_kind, text, text, boolean, text, text, text, text, text, text, date) from public;
revoke all on function public.issue_credit_note(uuid, uuid, bigint, text, uuid) from public;
revoke all on function public.cancel_sale(uuid, uuid, text) from public;
grant execute on function public.save_invoice_settings(uuid, text, text, text, text, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.issue_invoice(uuid, uuid, date, public.billing_operation_category, public.billing_customer_kind, text, text, boolean, text, text, text, text, text, text, date) to authenticated;
grant execute on function public.issue_credit_note(uuid, uuid, bigint, text, uuid) to authenticated;
grant execute on function public.cancel_sale(uuid, uuid, text) to authenticated;

comment on table public.invoice_settings is 'Identité et clauses utilisées uniquement pour les futures factures.';
comment on table public.billing_documents is 'Factures et avoirs commerciaux immuables, générés depuis leurs snapshots.';
comment on table public.billing_document_items is 'Lignes immuables snapshotées à l’émission du document.';
comment on table public.billing_number_counters is 'Compteurs transactionnels internes par entreprise, type et année, sans séquence PostgreSQL.';
