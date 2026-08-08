-- Paramètres fiscaux et sociaux versionnés pour la micro-BIC vente en métropole.
-- Les valeurs sont des données légales immuables ; l'application ne transmet
-- aucune déclaration et les montants calculés restent des estimations internes.

create type public.fiscal_activity_category as enum ('micro_bic_goods');
create type public.cfp_category as enum ('commercial', 'artisan');
create type public.fiscal_evaluation_status as enum (
  'not-evaluated-historically',
  'evaluated',
  'profile-or-rule-unavailable',
  'acre-cap-unmodeled',
  'mixed-fiscal-version-period'
);

create table public.fiscal_social_rule_versions (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null,
  activity_category public.fiscal_activity_category not null,
  social_contribution_basis_points integer not null,
  cfp_commercial_basis_points integer not null,
  cfp_artisan_basis_points integer not null,
  versement_liberatoire_basis_points integer not null,
  income_tax_abatement_basis_points integer not null,
  micro_turnover_ceiling_cents bigint not null,
  vat_franchise_base_ceiling_cents bigint not null,
  vat_franchise_tolerance_ceiling_cents bigint not null,
  source_label text not null,
  source_checked_on date not null,
  created_at timestamptz not null default now(),
  constraint fiscal_social_rules_category_effective_key unique (activity_category, effective_from),
  constraint fiscal_social_rules_rates_valid check (
    social_contribution_basis_points between 0 and 10000
    and cfp_commercial_basis_points between 0 and 10000
    and cfp_artisan_basis_points between 0 and 10000
    and versement_liberatoire_basis_points between 0 and 10000
    and income_tax_abatement_basis_points between 0 and 10000
  ),
  constraint fiscal_social_rules_ceilings_valid check (
    micro_turnover_ceiling_cents > 0
    and vat_franchise_base_ceiling_cents > 0
    and vat_franchise_tolerance_ceiling_cents >= vat_franchise_base_ceiling_cents
  ),
  constraint fiscal_social_rules_source_present check (char_length(btrim(source_label)) between 2 and 500)
);

create table public.acre_rule_versions (
  id uuid primary key default gen_random_uuid(),
  activity_started_from date not null unique,
  paid_fraction_basis_points integer not null,
  duration_quarters_after_start integer not null,
  rate_rounding_increment_basis_points integer not null,
  source_label text not null,
  source_checked_on date not null,
  created_at timestamptz not null default now(),
  constraint acre_rules_fraction_valid check (paid_fraction_basis_points between 0 and 10000),
  constraint acre_rules_duration_valid check (duration_quarters_after_start >= 0),
  constraint acre_rules_rounding_valid check (rate_rounding_increment_basis_points > 0 and rate_rounding_increment_basis_points <= 10000),
  constraint acre_rules_source_present check (char_length(btrim(source_label)) between 2 and 500)
);

create table public.business_fiscal_profiles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  effective_from date not null,
  cfp_category public.cfp_category not null,
  has_acre boolean not null,
  versement_liberatoire boolean not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint business_fiscal_profiles_effective_key unique (business_id, effective_from),
  constraint business_fiscal_profiles_id_business_key unique (id, business_id)
);

create index business_fiscal_profiles_resolution_idx
  on public.business_fiscal_profiles(business_id, effective_from desc);

create function public.prevent_fiscal_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'fiscal version is immutable' using errcode = '55000';
end;
$$;

create trigger fiscal_social_rule_versions_immutable
before update or delete on public.fiscal_social_rule_versions
for each row execute function public.prevent_fiscal_version_mutation();
create trigger acre_rule_versions_immutable
before update or delete on public.acre_rule_versions
for each row execute function public.prevent_fiscal_version_mutation();
create trigger business_fiscal_profiles_immutable
before update or delete on public.business_fiscal_profiles
for each row execute function public.prevent_fiscal_version_mutation();

revoke all on function public.prevent_fiscal_version_mutation() from public;

alter table public.fiscal_social_rule_versions enable row level security;
alter table public.acre_rule_versions enable row level security;
alter table public.business_fiscal_profiles enable row level security;

revoke all on table public.fiscal_social_rule_versions from anon, authenticated;
revoke all on table public.acre_rule_versions from anon, authenticated;
revoke all on table public.business_fiscal_profiles from anon, authenticated;
grant select on table public.fiscal_social_rule_versions to authenticated;
grant select on table public.acre_rule_versions to authenticated;
grant select on table public.business_fiscal_profiles to authenticated;

create policy fiscal_social_rule_versions_select_authenticated
on public.fiscal_social_rule_versions for select to authenticated using (true);
create policy acre_rule_versions_select_authenticated
on public.acre_rule_versions for select to authenticated using (true);
create policy business_fiscal_profiles_select_member
on public.business_fiscal_profiles for select to authenticated
using (public.is_business_member(business_id));

-- Les nouvelles versions légales sont exclusivement ajoutées par migration.
insert into public.fiscal_social_rule_versions (
  effective_from, activity_category, social_contribution_basis_points,
  cfp_commercial_basis_points, cfp_artisan_basis_points,
  versement_liberatoire_basis_points, income_tax_abatement_basis_points,
  micro_turnover_ceiling_cents, vat_franchise_base_ceiling_cents,
  vat_franchise_tolerance_ceiling_cents, source_label, source_checked_on
) values (
  date '2026-01-01', 'micro_bic_goods', 1230, 10, 30, 100, 7100,
  20310000, 8500000, 9350000,
  'Règles officielles 2026 — micro-entreprise, vente de marchandises, France métropolitaine',
  date '2026-08-08'
);

insert into public.acre_rule_versions (
  activity_started_from, paid_fraction_basis_points,
  duration_quarters_after_start, rate_rounding_increment_basis_points,
  source_label, source_checked_on
) values
  (date '0001-01-01', 5000, 3, 10, 'ACRE — créations antérieures au 1er juillet 2026', date '2026-08-08'),
  (date '2026-07-01', 7500, 3, 10, 'ACRE — créations à compter du 1er juillet 2026', date '2026-08-08');

create function public.create_business_fiscal_profile(
  p_business_id uuid,
  p_effective_from date,
  p_cfp_category public.cfp_category,
  p_has_acre boolean,
  p_versement_liberatoire boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  today_paris date := (now() at time zone 'Europe/Paris')::date;
  settings public.business_settings;
  previous public.business_fiscal_profiles;
  profile_id uuid := gen_random_uuid();
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not public.is_business_owner(p_business_id) then raise exception 'owner access required' using errcode = '42501'; end if;
  if p_effective_from is null or p_cfp_category is null or p_has_acre is null or p_versement_liberatoire is null then
    raise exception 'fiscal profile values required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text || ':fiscal-profile', 0));
  select * into settings from public.business_settings where business_id = p_business_id for update;
  if not found or settings.activity_started_on is null then
    raise exception 'activity start required' using errcode = '23514';
  end if;

  select * into previous from public.business_fiscal_profiles
  where business_id = p_business_id order by effective_from desc limit 1;

  if not found then
    if p_effective_from <> settings.activity_started_on then
      raise exception 'first fiscal profile must start with activity' using errcode = '23514';
    end if;
  else
    if p_effective_from <= previous.effective_from then
      raise exception 'fiscal profile effective date must increase' using errcode = '23514';
    end if;
    if extract(month from p_effective_from) <> 1 or extract(day from p_effective_from) <> 1 then
      raise exception 'later fiscal profile must start on January 1' using errcode = '23514';
    end if;
    if p_effective_from <= today_paris then
      raise exception 'later fiscal profile must be future' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.turnover_declarations
      where business_id = p_business_id and period_end >= p_effective_from
    ) then
      raise exception 'fiscal profile date overlaps an existing declaration' using errcode = '55000';
    end if;
  end if;

  insert into public.business_fiscal_profiles (
    id, business_id, effective_from, cfp_category, has_acre,
    versement_liberatoire, created_by
  ) values (
    profile_id, p_business_id, p_effective_from, p_cfp_category, p_has_acre,
    p_versement_liberatoire, actor
  );

  insert into public.audit_logs (business_id, user_id, action_type, entity_name, entity_id, new_data)
  values (p_business_id, actor, 'configured', 'business_fiscal_profile', profile_id,
    pg_catalog.jsonb_build_object(
      'effective_from', p_effective_from,
      'cfp_category', p_cfp_category,
      'has_acre', p_has_acre,
      'versement_liberatoire', p_versement_liberatoire
    ));
  return profile_id;
end;
$$;

revoke all on function public.create_business_fiscal_profile(uuid, date, public.cfp_category, boolean, boolean) from public;
grant execute on function public.create_business_fiscal_profile(uuid, date, public.cfp_category, boolean, boolean) to authenticated;

create or replace function public.set_business_activity_started_on(
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
  if exists (select 1 from public.turnover_declarations where business_id = p_business_id)
    or exists (select 1 from public.business_fiscal_profiles where business_id = p_business_id) then
    raise exception 'activity start locked by declarations or fiscal profiles' using errcode = '55000';
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

create function public.acre_period_end(
  p_activity_started_on date,
  p_duration_quarters_after_start integer
)
returns date
language sql
immutable
set search_path = ''
as $$
  select (
    pg_catalog.date_trunc('quarter', p_activity_started_on)::date
    + pg_catalog.make_interval(months => 3 * (p_duration_quarters_after_start + 1))
    - interval '1 day'
  )::date
$$;

create function public.round_fiscal_amount(
  p_turnover_cents bigint,
  p_rate_basis_points integer
)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_turnover_cents < 0 or p_rate_basis_points < 0 then
    raise exception 'invalid fiscal calculation input' using errcode = '22023';
  end if;
  return (p_turnover_cents * p_rate_basis_points + 5000) / 10000;
end;
$$;

create function public.theoretical_acre_social_rate(
  p_normal_rate_basis_points integer,
  p_paid_fraction_basis_points integer,
  p_rounding_increment_basis_points integer
)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  rounding_divisor bigint;
begin
  if p_normal_rate_basis_points < 0 or p_paid_fraction_basis_points < 0
    or p_rounding_increment_basis_points <= 0 then
    raise exception 'invalid theoretical ACRE rate input' using errcode = '22023';
  end if;
  rounding_divisor := 10000::bigint * p_rounding_increment_basis_points;
  return (
    (p_normal_rate_basis_points::bigint * p_paid_fraction_basis_points + rounding_divisor - 1)
    / rounding_divisor
    * p_rounding_increment_basis_points
  )::integer;
end;
$$;

create function public.get_fiscal_reserve_snapshot(
  p_business_id uuid,
  p_period_start date,
  p_period_end date,
  p_turnover_cents bigint
)
returns table (
  evaluation_status public.fiscal_evaluation_status,
  fiscal_profile_id uuid,
  fiscal_rule_version_id uuid,
  acre_rule_version_id uuid,
  social_rate_basis_points integer,
  cfp_rate_basis_points integer,
  versement_liberatoire_basis_points integer,
  acre_applied boolean,
  estimated_social_contributions_cents bigint,
  estimated_cfp_cents bigint,
  estimated_income_tax_cents bigint,
  estimated_total_reserve_cents bigint
)
language plpgsql
stable
set search_path = ''
as $$
declare
  settings public.business_settings;
  profile public.business_fiscal_profiles;
  legal_rule public.fiscal_social_rule_versions;
  acre_rule public.acre_rule_versions;
  acre_ends_on date;
  profile_found boolean;
  legal_rule_found boolean;
begin
  if p_business_id is null or p_period_start is null or p_period_end is null
    or p_period_start > p_period_end or p_turnover_cents is null or p_turnover_cents < 0 then
    raise exception 'invalid fiscal snapshot input' using errcode = '22023';
  end if;

  evaluation_status := 'profile-or-rule-unavailable';

  select * into settings from public.business_settings where business_id = p_business_id;
  if not found or settings.activity_started_on is null then return next; return; end if;

  select * into profile from public.business_fiscal_profiles
  where business_id = p_business_id and effective_from <= p_period_start
  order by effective_from desc limit 1;
  profile_found := found;

  select * into legal_rule from public.fiscal_social_rule_versions
  where activity_category = 'micro_bic_goods' and effective_from <= p_period_start
  order by effective_from desc limit 1;
  legal_rule_found := found;

  if exists (
    select 1 from public.business_fiscal_profiles
    where business_id = p_business_id
      and effective_from > p_period_start and effective_from <= p_period_end
  ) or exists (
    select 1 from public.fiscal_social_rule_versions
    where activity_category = 'micro_bic_goods'
      and effective_from > p_period_start and effective_from <= p_period_end
  ) then
    evaluation_status := 'mixed-fiscal-version-period';
    return next;
    return;
  end if;

  if not profile_found or not legal_rule_found then return next; return; end if;

  if profile.has_acre then
    select * into acre_rule from public.acre_rule_versions
    where activity_started_from <= settings.activity_started_on
    order by activity_started_from desc limit 1;
    if not found then return next; return; end if;
    acre_ends_on := public.acre_period_end(settings.activity_started_on, acre_rule.duration_quarters_after_start);
    if p_period_start <= acre_ends_on and p_period_end >= settings.activity_started_on then
      evaluation_status := 'acre-cap-unmodeled';
      return next;
      return;
    end if;
  end if;

  evaluation_status := 'evaluated';
  fiscal_profile_id := profile.id;
  fiscal_rule_version_id := legal_rule.id;
  acre_rule_version_id := null;
  if profile.has_acre then acre_rule_version_id := acre_rule.id; end if;
  social_rate_basis_points := legal_rule.social_contribution_basis_points;
  acre_applied := false;

  cfp_rate_basis_points := case profile.cfp_category
    when 'commercial' then legal_rule.cfp_commercial_basis_points
    else legal_rule.cfp_artisan_basis_points
  end;
  versement_liberatoire_basis_points := case when profile.versement_liberatoire
    then legal_rule.versement_liberatoire_basis_points else 0 end;
  estimated_social_contributions_cents := public.round_fiscal_amount(p_turnover_cents, social_rate_basis_points);
  estimated_cfp_cents := public.round_fiscal_amount(p_turnover_cents, cfp_rate_basis_points);
  estimated_income_tax_cents := public.round_fiscal_amount(p_turnover_cents, versement_liberatoire_basis_points);
  estimated_total_reserve_cents := estimated_social_contributions_cents + estimated_cfp_cents + estimated_income_tax_cents;
  return next;
end;
$$;

revoke all on function public.acre_period_end(date, integer) from public;
revoke all on function public.round_fiscal_amount(bigint, integer) from public;
revoke all on function public.theoretical_acre_social_rate(integer, integer, integer) from public;
revoke all on function public.get_fiscal_reserve_snapshot(uuid, date, date, bigint) from public;

alter table public.turnover_declarations
  add column fiscal_evaluated boolean not null default false,
  add column fiscal_evaluation_status public.fiscal_evaluation_status not null default 'not-evaluated-historically',
  add column fiscal_profile_id uuid,
  add column fiscal_rule_version_id uuid references public.fiscal_social_rule_versions(id) on delete restrict,
  add column acre_rule_version_id uuid references public.acre_rule_versions(id) on delete restrict,
  add column social_rate_basis_points_snapshot integer,
  add column cfp_rate_basis_points_snapshot integer,
  add column versement_liberatoire_basis_points_snapshot integer,
  add column acre_applied_snapshot boolean,
  add column estimated_social_contributions_cents bigint,
  add column estimated_cfp_cents bigint,
  add column estimated_income_tax_cents bigint,
  add column estimated_total_reserve_cents bigint,
  add constraint turnover_declarations_fiscal_profile_fk
    foreign key (fiscal_profile_id, business_id)
    references public.business_fiscal_profiles(id, business_id) on delete restrict,
  add constraint turnover_declarations_fiscal_snapshot_consistent check (
    (
      fiscal_evaluated = false
      and fiscal_evaluation_status <> 'evaluated'
      and fiscal_profile_id is null
      and fiscal_rule_version_id is null
      and acre_rule_version_id is null
      and social_rate_basis_points_snapshot is null
      and cfp_rate_basis_points_snapshot is null
      and versement_liberatoire_basis_points_snapshot is null
      and acre_applied_snapshot is null
      and estimated_social_contributions_cents is null
      and estimated_cfp_cents is null
      and estimated_income_tax_cents is null
      and estimated_total_reserve_cents is null
    ) or (
      fiscal_evaluated = true
      and fiscal_evaluation_status = 'evaluated'
      and fiscal_profile_id is not null
      and fiscal_rule_version_id is not null
      and social_rate_basis_points_snapshot between 0 and 10000
      and cfp_rate_basis_points_snapshot between 0 and 10000
      and versement_liberatoire_basis_points_snapshot between 0 and 10000
      and acre_applied_snapshot is not null
      and (acre_applied_snapshot = false or acre_rule_version_id is not null)
      and estimated_social_contributions_cents >= 0
      and estimated_cfp_cents >= 0
      and estimated_income_tax_cents >= 0
      and estimated_total_reserve_cents = estimated_social_contributions_cents + estimated_cfp_cents + estimated_income_tax_cents
    )
  );

create or replace function public.record_turnover_declaration(
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
  fiscal_snapshot record;
  fiscal_is_evaluated boolean := false;
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

  select * into fiscal_snapshot
  from public.get_fiscal_reserve_snapshot(p_business_id, p_period_start, p_period_end, p_declared_turnover_cents);
  fiscal_is_evaluated := found and fiscal_snapshot.evaluation_status = 'evaluated';

  insert into public.turnover_declarations (
    id, business_id, period_start, period_end, due_on, declaration_period_snapshot, vat_regime_snapshot,
    revision_no, previous_declaration_id, calculation_status, suggested_turnover_cents,
    gross_receipts_snapshot_cents, customer_refunds_snapshot_cents, payment_count_snapshot, refund_count_snapshot,
    declared_turnover_cents, submitted_on, external_reference, adjustment_reason, created_by,
    fiscal_evaluated, fiscal_evaluation_status, fiscal_profile_id, fiscal_rule_version_id, acre_rule_version_id,
    social_rate_basis_points_snapshot, cfp_rate_basis_points_snapshot,
    versement_liberatoire_basis_points_snapshot, acre_applied_snapshot,
    estimated_social_contributions_cents, estimated_cfp_cents,
    estimated_income_tax_cents, estimated_total_reserve_cents
  ) values (
    declaration_id, p_business_id, p_period_start, p_period_end, expected_due, settings.declaration_period, settings.vat_regime,
    1, null, calc_status, suggested, gross_receipts, customer_refunds, payment_count, refund_count,
    p_declared_turnover_cents, p_submitted_on, nullif(btrim(p_external_reference), ''), reason, actor,
    fiscal_is_evaluated, fiscal_snapshot.evaluation_status,
    case when fiscal_is_evaluated then fiscal_snapshot.fiscal_profile_id else null end,
    case when fiscal_is_evaluated then fiscal_snapshot.fiscal_rule_version_id else null end,
    case when fiscal_is_evaluated then fiscal_snapshot.acre_rule_version_id else null end,
    case when fiscal_is_evaluated then fiscal_snapshot.social_rate_basis_points else null end,
    case when fiscal_is_evaluated then fiscal_snapshot.cfp_rate_basis_points else null end,
    case when fiscal_is_evaluated then fiscal_snapshot.versement_liberatoire_basis_points else null end,
    case when fiscal_is_evaluated then fiscal_snapshot.acre_applied else null end,
    case when fiscal_is_evaluated then fiscal_snapshot.estimated_social_contributions_cents else null end,
    case when fiscal_is_evaluated then fiscal_snapshot.estimated_cfp_cents else null end,
    case when fiscal_is_evaluated then fiscal_snapshot.estimated_income_tax_cents else null end,
    case when fiscal_is_evaluated then fiscal_snapshot.estimated_total_reserve_cents else null end
  );

  insert into public.audit_logs (business_id, user_id, action_type, entity_name, entity_id, new_data)
  values (p_business_id, actor, 'recorded', 'turnover_declaration', declaration_id,
    pg_catalog.jsonb_build_object('period_start', p_period_start, 'period_end', p_period_end, 'revision_no', 1));
  return declaration_id;
end;
$$;

create or replace function public.revise_turnover_declaration(
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
  fiscal_snapshot record;
  fiscal_is_evaluated boolean := false;
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
  order by revision_no desc limit 1 for update;
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

  select * into fiscal_snapshot
  from public.get_fiscal_reserve_snapshot(p_business_id, p_period_start, p_period_end, p_declared_turnover_cents);
  fiscal_is_evaluated := found and fiscal_snapshot.evaluation_status = 'evaluated';

  insert into public.turnover_declarations (
    id, business_id, period_start, period_end, due_on, declaration_period_snapshot, vat_regime_snapshot,
    revision_no, previous_declaration_id, calculation_status, suggested_turnover_cents,
    gross_receipts_snapshot_cents, customer_refunds_snapshot_cents, payment_count_snapshot, refund_count_snapshot,
    declared_turnover_cents, submitted_on, external_reference, adjustment_reason, created_by,
    fiscal_evaluated, fiscal_evaluation_status, fiscal_profile_id, fiscal_rule_version_id, acre_rule_version_id,
    social_rate_basis_points_snapshot, cfp_rate_basis_points_snapshot,
    versement_liberatoire_basis_points_snapshot, acre_applied_snapshot,
    estimated_social_contributions_cents, estimated_cfp_cents,
    estimated_income_tax_cents, estimated_total_reserve_cents
  ) values (
    declaration_id, p_business_id, p_period_start, p_period_end, expected_due, settings.declaration_period, settings.vat_regime,
    previous.revision_no + 1, previous.id, calc_status, suggested, gross_receipts, customer_refunds, payment_count, refund_count,
    p_declared_turnover_cents, p_submitted_on, nullif(btrim(p_external_reference), ''), reason, actor,
    fiscal_is_evaluated, fiscal_snapshot.evaluation_status,
    case when fiscal_is_evaluated then fiscal_snapshot.fiscal_profile_id else null end,
    case when fiscal_is_evaluated then fiscal_snapshot.fiscal_rule_version_id else null end,
    case when fiscal_is_evaluated then fiscal_snapshot.acre_rule_version_id else null end,
    case when fiscal_is_evaluated then fiscal_snapshot.social_rate_basis_points else null end,
    case when fiscal_is_evaluated then fiscal_snapshot.cfp_rate_basis_points else null end,
    case when fiscal_is_evaluated then fiscal_snapshot.versement_liberatoire_basis_points else null end,
    case when fiscal_is_evaluated then fiscal_snapshot.acre_applied else null end,
    case when fiscal_is_evaluated then fiscal_snapshot.estimated_social_contributions_cents else null end,
    case when fiscal_is_evaluated then fiscal_snapshot.estimated_cfp_cents else null end,
    case when fiscal_is_evaluated then fiscal_snapshot.estimated_income_tax_cents else null end,
    case when fiscal_is_evaluated then fiscal_snapshot.estimated_total_reserve_cents else null end
  );

  insert into public.audit_logs (business_id, user_id, action_type, entity_name, entity_id, new_data)
  values (p_business_id, actor, 'corrected', 'turnover_declaration', declaration_id,
    pg_catalog.jsonb_build_object('period_start', p_period_start, 'period_end', p_period_end, 'revision_no', previous.revision_no + 1));
  return declaration_id;
end;
$$;

comment on table public.fiscal_social_rule_versions is 'Versions immuables des règles micro-BIC vente métropole, ajoutées uniquement par migration.';
comment on table public.acre_rule_versions is 'Versions immuables des règles ACRE résolues selon la date de début d’activité.';
comment on table public.business_fiscal_profiles is 'Choix fiscaux et sociaux versionnés par entreprise, créés uniquement par RPC propriétaire.';
comment on column public.turnover_declarations.fiscal_evaluated is 'Indique qu’une estimation fiscale complète a été figée lors de cette révision.';
