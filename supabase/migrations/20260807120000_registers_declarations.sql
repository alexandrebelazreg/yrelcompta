-- Registres réglementaires et historique immuable des déclarations YrelCompta.
-- Cette migration doit être relue avant application. Elle ne transmet aucune
-- déclaration à l'Urssaf et ne calcule aucun impôt, cotisation ou TVA.

alter table public.business_settings
  add column activity_started_on date;

create type public.declaration_calculation_status as enum (
  'available',
  'vat-unmodeled',
  'refund-review-required'
);

create table public.turnover_declarations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  due_on date not null,
  declaration_period_snapshot public.declaration_period not null,
  vat_regime_snapshot public.vat_regime not null,
  revision_no integer not null,
  previous_declaration_id uuid references public.turnover_declarations(id) on delete restrict,
  calculation_status public.declaration_calculation_status not null,
  suggested_turnover_cents bigint,
  gross_receipts_snapshot_cents bigint not null,
  customer_refunds_snapshot_cents bigint not null,
  payment_count_snapshot integer not null,
  refund_count_snapshot integer not null,
  declared_turnover_cents bigint not null,
  submitted_on date not null,
  external_reference text,
  adjustment_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint turnover_declarations_business_period_revision_key unique (business_id, period_start, period_end, revision_no),
  constraint turnover_declarations_id_business_key unique (id, business_id),
  constraint turnover_declarations_period_valid check (period_start <= period_end and due_on > period_end),
  constraint turnover_declarations_submitted_after_period check (submitted_on > period_end),
  constraint turnover_declarations_revision_positive check (revision_no > 0),
  constraint turnover_declarations_revision_chain check (
    (revision_no = 1 and previous_declaration_id is null)
    or (revision_no > 1 and previous_declaration_id is not null)
  ),
  constraint turnover_declarations_amounts_non_negative check (
    gross_receipts_snapshot_cents >= 0
    and customer_refunds_snapshot_cents >= 0
    and declared_turnover_cents >= 0
    and (suggested_turnover_cents is null or suggested_turnover_cents >= 0)
  ),
  constraint turnover_declarations_counts_non_negative check (payment_count_snapshot >= 0 and refund_count_snapshot >= 0),
  constraint turnover_declarations_suggestion_status check (
    (calculation_status = 'available' and suggested_turnover_cents is not null)
    or (calculation_status <> 'available' and suggested_turnover_cents is null)
  ),
  constraint turnover_declarations_external_reference_length check (
    external_reference is null or char_length(external_reference) <= 200
  ),
  constraint turnover_declarations_adjustment_reason_length check (
    adjustment_reason is null or char_length(btrim(adjustment_reason)) between 2 and 1000
  ),
  constraint turnover_declarations_adjustment_required check (
    (suggested_turnover_cents is not null and declared_turnover_cents = suggested_turnover_cents)
    or coalesce(char_length(btrim(adjustment_reason)), 0) between 2 and 1000
  ),
  constraint turnover_declarations_correction_reason check (
    revision_no = 1 or coalesce(char_length(btrim(adjustment_reason)), 0) between 2 and 1000
  )
);

create index turnover_declarations_business_period_idx
  on public.turnover_declarations(business_id, period_start, period_end, revision_no desc);
create index turnover_declarations_previous_idx
  on public.turnover_declarations(previous_declaration_id)
  where previous_declaration_id is not null;

create function public.prevent_turnover_declaration_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'turnover declaration is immutable' using errcode = '55000';
end;
$$;

create trigger turnover_declarations_immutable
before update or delete on public.turnover_declarations
for each row execute function public.prevent_turnover_declaration_mutation();

revoke all on function public.prevent_turnover_declaration_mutation() from public;

alter table public.turnover_declarations enable row level security;
revoke all on table public.turnover_declarations from anon, authenticated;
grant select on table public.turnover_declarations to authenticated;
create policy turnover_declarations_select_member
on public.turnover_declarations for select to authenticated
using (public.is_business_member(business_id));

-- Les paramètres sensibles ne sont plus modifiables directement : les futures
-- mutations doivent elles aussi passer par une RPC contrôlée.
revoke insert, update, delete on table public.business_settings from anon, authenticated;
grant select on table public.business_settings to authenticated;

create function public.get_declaration_period_details(
  p_activity_started_on date,
  p_declaration_period public.declaration_period,
  p_period_start date
)
returns table(period_end date, due_on date)
language plpgsql
immutable
set search_path = ''
as $$
declare
  first_period_end date;
  calculated_end date;
begin
  if p_activity_started_on is null or p_period_start is null then
    raise exception 'activity date and period start required' using errcode = '22023';
  end if;

  if p_declaration_period = 'monthly' then
    first_period_end := (pg_catalog.date_trunc('month', p_activity_started_on)::date + interval '4 months - 1 day')::date;
  else
    first_period_end := (pg_catalog.date_trunc('quarter', p_activity_started_on)::date + interval '6 months - 1 day')::date;
  end if;

  if p_period_start = p_activity_started_on then
    calculated_end := first_period_end;
  elsif p_period_start <= first_period_end then
    raise exception 'invalid declaration period start' using errcode = '22023';
  elsif p_declaration_period = 'monthly' then
    if p_period_start <> pg_catalog.date_trunc('month', p_period_start)::date then
      raise exception 'invalid monthly period start' using errcode = '22023';
    end if;
    calculated_end := (pg_catalog.date_trunc('month', p_period_start)::date + interval '1 month - 1 day')::date;
  else
    if p_period_start <> pg_catalog.date_trunc('quarter', p_period_start)::date then
      raise exception 'invalid quarterly period start' using errcode = '22023';
    end if;
    calculated_end := (pg_catalog.date_trunc('quarter', p_period_start)::date + interval '3 months - 1 day')::date;
  end if;

  period_end := calculated_end;
  due_on := (pg_catalog.date_trunc('month', calculated_end)::date + interval '2 months - 1 day')::date;
  return next;
end;
$$;

revoke all on function public.get_declaration_period_details(date, public.declaration_period, date) from public;

create function public.set_business_activity_started_on(
  p_business_id uuid,
  p_activity_started_on date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  today_paris date := (now() at time zone 'Europe/Paris')::date;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.is_business_owner(p_business_id) then
    raise exception 'owner access required' using errcode = '42501';
  end if;
  if p_activity_started_on is null or p_activity_started_on > today_paris then
    raise exception 'invalid activity start date' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text || ':activity-start', 0));
  if exists (select 1 from public.turnover_declarations where business_id = p_business_id) then
    raise exception 'activity start locked by declarations' using errcode = '55000';
  end if;

  update public.business_settings
  set activity_started_on = p_activity_started_on
  where business_id = p_business_id;
  if not found then
    raise exception 'business settings not found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (business_id, user_id, action_type, entity_name, entity_id, new_data)
  values (p_business_id, actor, 'configured', 'business_activity_start', p_business_id, '{"activity_started_on_configured":true}'::jsonb);
end;
$$;

revoke all on function public.set_business_activity_started_on(uuid, date) from public;
grant execute on function public.set_business_activity_started_on(uuid, date) to authenticated;

create function public.record_turnover_declaration(
  p_business_id uuid,
  p_period_start date,
  p_period_end date,
  p_declared_turnover_cents bigint,
  p_submitted_on date,
  p_external_reference text,
  p_adjustment_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  settings public.business_settings;
  expected_end date;
  expected_due date;
  today_paris date := (now() at time zone 'Europe/Paris')::date;
  gross_receipts bigint;
  customer_refunds bigint;
  payment_count integer;
  refund_count integer;
  calc_status public.declaration_calculation_status;
  suggested bigint;
  reason text := nullif(btrim(p_adjustment_reason), '');
  declaration_id uuid := gen_random_uuid();
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not public.can_manage_business(p_business_id) then raise exception 'business access denied' using errcode = '42501'; end if;
  if p_declared_turnover_cents is null or p_declared_turnover_cents < 0 then raise exception 'invalid declared turnover' using errcode = '22023'; end if;
  if p_submitted_on is null or p_submitted_on > today_paris then raise exception 'invalid submitted date' using errcode = '22023'; end if;
  if p_submitted_on <= p_period_end then raise exception 'declaration submitted before period end' using errcode = '22023'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text || ':' || p_period_start::text || ':' || p_period_end::text, 0));
  select * into settings from public.business_settings where business_id = p_business_id for update;
  if not found or settings.activity_started_on is null then raise exception 'activity start required' using errcode = '23514'; end if;

  select d.period_end, d.due_on into expected_end, expected_due
  from public.get_declaration_period_details(settings.activity_started_on, settings.declaration_period, p_period_start) d;
  if expected_end <> p_period_end then raise exception 'invalid declaration period' using errcode = '22023'; end if;
  if p_period_end >= today_paris then raise exception 'declaration period not ended' using errcode = '22023'; end if;
  if exists (
    select 1 from public.turnover_declarations
    where business_id = p_business_id and period_start = p_period_start and period_end = p_period_end
  ) then raise exception 'declaration already recorded' using errcode = '23505'; end if;

  select coalesce(sum(gross_amount_cents), 0), count(*)::integer
  into gross_receipts, payment_count
  from public.payments
  where business_id = p_business_id and received_on between p_period_start and p_period_end;

  select coalesce(sum(amount_cents), 0), count(*)::integer
  into customer_refunds, refund_count
  from public.refunds
  where business_id = p_business_id and refunded_on between p_period_start and p_period_end;

  if refund_count > 0 then
    calc_status := 'refund-review-required'; suggested := null;
  elsif settings.vat_regime = 'liable' then
    calc_status := 'vat-unmodeled'; suggested := null;
  else
    calc_status := 'available'; suggested := gross_receipts;
  end if;

  if (suggested is null or p_declared_turnover_cents <> suggested) and reason is null then
    raise exception 'adjustment reason required' using errcode = '23514';
  end if;

  insert into public.turnover_declarations (
    id, business_id, period_start, period_end, due_on, declaration_period_snapshot, vat_regime_snapshot,
    revision_no, previous_declaration_id, calculation_status, suggested_turnover_cents,
    gross_receipts_snapshot_cents, customer_refunds_snapshot_cents, payment_count_snapshot, refund_count_snapshot,
    declared_turnover_cents, submitted_on, external_reference, adjustment_reason, created_by
  ) values (
    declaration_id, p_business_id, p_period_start, p_period_end, expected_due, settings.declaration_period, settings.vat_regime,
    1, null, calc_status, suggested, gross_receipts, customer_refunds, payment_count, refund_count,
    p_declared_turnover_cents, p_submitted_on, nullif(btrim(p_external_reference), ''), reason, actor
  );

  insert into public.audit_logs (business_id, user_id, action_type, entity_name, entity_id, new_data)
  values (p_business_id, actor, 'recorded', 'turnover_declaration', declaration_id,
    jsonb_build_object('period_start', p_period_start, 'period_end', p_period_end, 'revision_no', 1));
  return declaration_id;
end;
$$;

create function public.revise_turnover_declaration(
  p_business_id uuid,
  p_period_start date,
  p_period_end date,
  p_declared_turnover_cents bigint,
  p_submitted_on date,
  p_external_reference text,
  p_adjustment_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  settings public.business_settings;
  previous public.turnover_declarations;
  expected_end date;
  expected_due date;
  today_paris date := (now() at time zone 'Europe/Paris')::date;
  gross_receipts bigint;
  customer_refunds bigint;
  payment_count integer;
  refund_count integer;
  calc_status public.declaration_calculation_status;
  suggested bigint;
  reason text := nullif(btrim(p_adjustment_reason), '');
  declaration_id uuid := gen_random_uuid();
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not public.can_manage_business(p_business_id) then raise exception 'business access denied' using errcode = '42501'; end if;
  if p_declared_turnover_cents is null or p_declared_turnover_cents < 0 then raise exception 'invalid declared turnover' using errcode = '22023'; end if;
  if p_submitted_on is null or p_submitted_on > today_paris then raise exception 'invalid submitted date' using errcode = '22023'; end if;
  if p_submitted_on <= p_period_end then raise exception 'declaration submitted before period end' using errcode = '22023'; end if;
  if reason is null then raise exception 'correction reason required' using errcode = '23514'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text || ':' || p_period_start::text || ':' || p_period_end::text, 0));
  select * into settings from public.business_settings where business_id = p_business_id for update;
  if not found or settings.activity_started_on is null then raise exception 'activity start required' using errcode = '23514'; end if;

  select d.period_end, d.due_on into expected_end, expected_due
  from public.get_declaration_period_details(settings.activity_started_on, settings.declaration_period, p_period_start) d;
  if expected_end <> p_period_end then raise exception 'invalid declaration period' using errcode = '22023'; end if;
  if p_period_end >= today_paris then raise exception 'declaration period not ended' using errcode = '22023'; end if;

  select * into previous
  from public.turnover_declarations
  where business_id = p_business_id and period_start = p_period_start and period_end = p_period_end
  order by revision_no desc
  limit 1
  for update;
  if not found then raise exception 'declaration not found' using errcode = 'P0002'; end if;

  select coalesce(sum(gross_amount_cents), 0), count(*)::integer
  into gross_receipts, payment_count
  from public.payments
  where business_id = p_business_id and received_on between p_period_start and p_period_end;

  select coalesce(sum(amount_cents), 0), count(*)::integer
  into customer_refunds, refund_count
  from public.refunds
  where business_id = p_business_id and refunded_on between p_period_start and p_period_end;

  if refund_count > 0 then
    calc_status := 'refund-review-required'; suggested := null;
  elsif settings.vat_regime = 'liable' then
    calc_status := 'vat-unmodeled'; suggested := null;
  else
    calc_status := 'available'; suggested := gross_receipts;
  end if;

  insert into public.turnover_declarations (
    id, business_id, period_start, period_end, due_on, declaration_period_snapshot, vat_regime_snapshot,
    revision_no, previous_declaration_id, calculation_status, suggested_turnover_cents,
    gross_receipts_snapshot_cents, customer_refunds_snapshot_cents, payment_count_snapshot, refund_count_snapshot,
    declared_turnover_cents, submitted_on, external_reference, adjustment_reason, created_by
  ) values (
    declaration_id, p_business_id, p_period_start, p_period_end, expected_due, settings.declaration_period, settings.vat_regime,
    previous.revision_no + 1, previous.id, calc_status, suggested, gross_receipts, customer_refunds, payment_count, refund_count,
    p_declared_turnover_cents, p_submitted_on, nullif(btrim(p_external_reference), ''), reason, actor
  );

  insert into public.audit_logs (business_id, user_id, action_type, entity_name, entity_id, new_data)
  values (p_business_id, actor, 'corrected', 'turnover_declaration', declaration_id,
    jsonb_build_object('period_start', p_period_start, 'period_end', p_period_end, 'revision_no', previous.revision_no + 1));
  return declaration_id;
end;
$$;

revoke all on function public.record_turnover_declaration(uuid, date, date, bigint, date, text, text) from public;
revoke all on function public.revise_turnover_declaration(uuid, date, date, bigint, date, text, text) from public;
grant execute on function public.record_turnover_declaration(uuid, date, date, bigint, date, text, text) to authenticated;
grant execute on function public.revise_turnover_declaration(uuid, date, date, bigint, date, text, text) to authenticated;

comment on column public.business_settings.activity_started_on is 'Date légale de début d’activité, indépendante de la date technique de création de l’entreprise.';
comment on table public.turnover_declarations is 'Historique immuable des déclarations enregistrées dans YrelCompta. Une correction ajoute une révision.';
comment on function public.record_turnover_declaration(uuid, date, date, bigint, date, text, text) is 'Enregistre dans YrelCompta une première révision sans transmettre de déclaration à l’Urssaf.';
comment on function public.revise_turnover_declaration(uuid, date, date, bigint, date, text, text) is 'Ajoute une correction immuable et conserve toutes les révisions précédentes.';
