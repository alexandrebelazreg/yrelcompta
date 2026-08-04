-- Socle de données YrelCompta. Toutes les tables applicatives sont protégées par RLS.
create type public.business_role as enum ('owner', 'member', 'accountant');
create type public.declaration_period as enum ('monthly', 'quarterly');
create type public.vat_regime as enum ('franchise', 'liable');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_first_name_length check (char_length(first_name) <= 80),
  constraint profiles_last_name_length check (char_length(last_name) <= 80)
);

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  siret text,
  address text,
  main_activity text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint businesses_name_not_blank check (char_length(btrim(name)) between 2 and 120),
  constraint businesses_siret_format check (siret is null or siret ~ '^\d{14}$'),
  constraint businesses_address_length check (address is null or char_length(address) <= 300),
  constraint businesses_activity_not_blank check (char_length(btrim(main_activity)) between 2 and 160)
);

create table public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.business_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create table public.business_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  declaration_period public.declaration_period not null,
  vat_regime public.vat_regime not null,
  has_acre boolean not null default false,
  currency text not null default 'EUR',
  timezone text not null default 'Europe/Paris',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_settings_currency check (currency = 'EUR'),
  constraint business_settings_timezone check (timezone = 'Europe/Paris')
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  action_type text not null,
  entity_name text not null,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now(),
  constraint audit_logs_action_not_blank check (char_length(btrim(action_type)) between 1 and 80),
  constraint audit_logs_entity_not_blank check (char_length(btrim(entity_name)) between 1 and 80)
);

create index business_members_user_id_idx on public.business_members(user_id);
create index business_members_business_role_idx on public.business_members(business_id, role);
create index audit_logs_business_created_idx on public.audit_logs(business_id, created_at desc);
create index audit_logs_user_id_idx on public.audit_logs(user_id) where user_id is not null;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger businesses_set_updated_at before update on public.businesses
for each row execute function public.set_updated_at();
create trigger business_settings_set_updated_at before update on public.business_settings
for each row execute function public.set_updated_at();

-- Ces fonctions SECURITY DEFINER ne renvoient qu'un booléen d'appartenance.
-- Elles évitent la récursion RLS sur business_members, fixent un search_path vide
-- et ne sont exécutables que par les utilisateurs authentifiés.
create function public.is_business_member(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.business_members
    where business_id = target_business_id and user_id = auth.uid()
  );
$$;

create function public.is_business_owner(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.business_members
    where business_id = target_business_id and user_id = auth.uid() and role = 'owner'
  );
$$;

revoke all on function public.is_business_member(uuid) from public;
revoke all on function public.is_business_owner(uuid) from public;
grant execute on function public.is_business_member(uuid) to authenticated;
grant execute on function public.is_business_owner(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.business_settings enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles_select_own" on public.profiles for select to authenticated
using (id = auth.uid());
create policy "profiles_insert_own" on public.profiles for insert to authenticated
with check (id = auth.uid());
create policy "profiles_update_own" on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

create policy "businesses_select_member" on public.businesses for select to authenticated
using (public.is_business_member(id));
create policy "businesses_update_owner" on public.businesses for update to authenticated
using (public.is_business_owner(id)) with check (public.is_business_owner(id));

create policy "business_members_select_member" on public.business_members for select to authenticated
using (public.is_business_member(business_id));

create policy "business_settings_select_member" on public.business_settings for select to authenticated
using (public.is_business_member(business_id));
create policy "business_settings_update_owner" on public.business_settings for update to authenticated
using (public.is_business_owner(business_id)) with check (public.is_business_owner(business_id));

-- audit_logs est en lecture seule pour les rôles applicatifs. Aucune politique
-- INSERT, UPDATE ou DELETE n'est créée : les écritures sont réservées aux
-- fonctions SQL contrôlées et aux futurs triggers.
create policy "audit_logs_select_member" on public.audit_logs for select to authenticated
using (public.is_business_member(business_id));

-- L'onboarding est atomique. Le navigateur ne choisit jamais un business_id :
-- la fonction crée l'entreprise puis rattache exclusivement auth.uid() comme owner.
create function public.complete_onboarding(
  p_business_name text,
  p_first_name text,
  p_last_name text,
  p_siret text,
  p_address text,
  p_main_activity text,
  p_declaration_period public.declaration_period,
  p_vat_regime public.vat_regime,
  p_has_acre boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  new_business_id uuid;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(current_user_id::text, 0));
  if exists (select 1 from public.business_members where user_id = current_user_id) then
    raise exception 'onboarding already completed' using errcode = '23505';
  end if;

  insert into public.profiles (id, first_name, last_name)
  values (current_user_id, nullif(btrim(p_first_name), ''), nullif(btrim(p_last_name), ''))
  on conflict (id) do update set first_name = excluded.first_name, last_name = excluded.last_name;

  insert into public.businesses (name, siret, address, main_activity)
  values (btrim(p_business_name), nullif(btrim(p_siret), ''), nullif(btrim(p_address), ''), btrim(p_main_activity))
  returning id into new_business_id;

  insert into public.business_members (business_id, user_id, role)
  values (new_business_id, current_user_id, 'owner');

  insert into public.business_settings (business_id, declaration_period, vat_regime, has_acre)
  values (new_business_id, p_declaration_period, p_vat_regime, p_has_acre);

  insert into public.audit_logs (business_id, user_id, action_type, entity_name, entity_id, new_data)
  values (new_business_id, current_user_id, 'created', 'business', new_business_id, jsonb_build_object('name', btrim(p_business_name)));

  return new_business_id;
end;
$$;

revoke all on function public.complete_onboarding(text, text, text, text, text, text, public.declaration_period, public.vat_regime, boolean) from public;
grant execute on function public.complete_onboarding(text, text, text, text, text, text, public.declaration_period, public.vat_regime, boolean) to authenticated;

comment on table public.audit_logs is 'Journal en lecture seule pour les rôles applicatifs. Les insertions sont réservées aux fonctions SQL contrôlées et aux futurs triggers. Les écritures comptables inaltérables seront conçues dans une migration ultérieure.';
comment on function public.complete_onboarding(text, text, text, text, text, text, public.declaration_period, public.vat_regime, boolean) is 'Crée atomiquement le profil, l’entreprise, le propriétaire et ses paramètres sans accepter de business_id client.';
