create extension if not exists pg_cron;

alter table public.recurring_expense_templates
  add column auto_generate boolean not null default true;

alter table public.expenses
  add column recurring_template_id uuid,
  add column recurring_due_on date,
  add constraint expenses_recurring_template_business_fk
    foreign key (recurring_template_id, business_id)
    references public.recurring_expense_templates(id, business_id)
    on delete restrict,
  add constraint expenses_recurring_occurrence_complete
    check ((recurring_template_id is null) = (recurring_due_on is null));

create unique index expenses_recurring_occurrence_key
  on public.expenses(business_id, recurring_template_id, recurring_due_on)
  where recurring_template_id is not null;

create index expenses_recurring_drafts_idx
  on public.expenses(business_id, status, recurring_template_id)
  where status = 'draft' and recurring_template_id is not null;

create or replace function public.protect_expense_mutations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'expense is immutable' using errcode = '55000';
    end if;
    return old;
  end if;

  if old.status = 'cancelled' then
    raise exception 'expense is immutable' using errcode = '55000';
  end if;

  if old.status = 'validated' and (
    new.status <> 'cancelled'
    or new.business_id <> old.business_id
    or new.reference <> old.reference
    or new.purchased_on <> old.purchased_on
    or new.due_on is distinct from old.due_on
    or new.supplier_id is distinct from old.supplier_id
    or new.category <> old.category
    or new.subcategory is distinct from old.subcategory
    or new.nature <> old.nature
    or new.cost_behavior <> old.cost_behavior
    or new.description <> old.description
    or new.external_reference is distinct from old.external_reference
    or new.total_amount_cents <> old.total_amount_cents
    or new.professional_share_basis_points <> old.professional_share_basis_points
    or new.notes is distinct from old.notes
    or new.validated_at <> old.validated_at
    or new.recurring_template_id is distinct from old.recurring_template_id
    or new.recurring_due_on is distinct from old.recurring_due_on
  ) then
    raise exception 'expense is immutable' using errcode = '55000';
  end if;

  return new;
end
$$;

create function public.generate_recurring_expense_occurrence(
  p_template_id uuid,
  p_business_id uuid,
  p_source text,
  p_actor uuid,
  p_purchased_on date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  template public.recurring_expense_templates;
  occurrence_due_on date;
  effective_purchased_on date;
  calculated_next_due_on date;
  expense_id uuid;
  new_expense_id uuid := gen_random_uuid();
  expense_reference text;
  inserted boolean := false;
begin
  if p_source is null or p_source not in ('recurring_auto', 'recurring_manual') then
    raise exception 'invalid recurring generation source' using errcode = '22023';
  end if;

  if p_source = 'recurring_manual' and p_actor is null then
    raise exception 'manual recurring generation requires an actor' using errcode = '42501';
  end if;

  select *
  into template
  from public.recurring_expense_templates
  where id = p_template_id
    and business_id = p_business_id
  for update;

  if not found then
    raise exception 'active template not found' using errcode = 'P0002';
  end if;

  if not template.is_active then
    raise exception 'active template not found' using errcode = 'P0002';
  end if;

  if p_source = 'recurring_auto' and not template.auto_generate then
    raise exception 'automatic generation is disabled' using errcode = '55000';
  end if;

  if p_source = 'recurring_manual' then
    select id
    into expense_id
    from public.expenses
    where business_id = p_business_id
      and recurring_template_id = p_template_id
      and purchased_on = p_purchased_on
    order by recurring_due_on desc
    limit 1;

    if expense_id is not null then
      return expense_id;
    end if;
  end if;

  occurrence_due_on := template.next_due_on;
  effective_purchased_on := case
    when p_source = 'recurring_auto' then occurrence_due_on
    else coalesce(p_purchased_on, occurrence_due_on)
  end;
  calculated_next_due_on := case template.frequency
    when 'monthly' then (occurrence_due_on + interval '1 month')::date
    when 'quarterly' then (occurrence_due_on + interval '3 months')::date
    else (occurrence_due_on + interval '1 year')::date
  end;
  expense_reference := 'D-' || to_char(effective_purchased_on, 'YYYYMMDD') || '-' || upper(substr(replace(new_expense_id::text, '-', ''), 1, 12));

  insert into public.expenses(
    id,
    business_id,
    reference,
    purchased_on,
    due_on,
    supplier_id,
    category,
    subcategory,
    nature,
    cost_behavior,
    description,
    external_reference,
    total_amount_cents,
    professional_share_basis_points,
    notes,
    status,
    created_by,
    recurring_template_id,
    recurring_due_on
  ) values (
    new_expense_id,
    p_business_id,
    expense_reference,
    effective_purchased_on,
    null,
    template.supplier_id,
    template.category,
    template.subcategory,
    template.nature,
    template.cost_behavior,
    template.description,
    null,
    template.estimated_amount_cents,
    template.professional_share_basis_points,
    template.notes,
    'draft',
    p_actor,
    p_template_id,
    occurrence_due_on
  )
  on conflict (business_id, recurring_template_id, recurring_due_on)
    where recurring_template_id is not null
  do nothing
  returning id into expense_id;

  inserted := expense_id is not null;

  if not inserted then
    select id, purchased_on
    into expense_id, effective_purchased_on
    from public.expenses
    where business_id = p_business_id
      and recurring_template_id = p_template_id
      and recurring_due_on = occurrence_due_on;
  end if;

  update public.recurring_expense_templates
  set last_generated_on = effective_purchased_on,
      next_due_on = calculated_next_due_on
  where id = p_template_id
    and business_id = p_business_id;

  if inserted then
    insert into public.audit_logs(
      business_id,
      user_id,
      action_type,
      entity_name,
      entity_id,
      new_data
    ) values (
      p_business_id,
      p_actor,
      'generated',
      'recurring_expense_template',
      p_template_id,
      jsonb_build_object(
        'source', p_source,
        'expense_id', expense_id,
        'recurring_due_on', occurrence_due_on
      )
    );
  end if;

  return expense_id;
end
$$;

revoke all on function public.generate_recurring_expense_occurrence(uuid, uuid, text, uuid, date) from public;
revoke all on function public.generate_recurring_expense_occurrence(uuid, uuid, text, uuid, date) from anon;
revoke all on function public.generate_recurring_expense_occurrence(uuid, uuid, text, uuid, date) from authenticated;

create function public.generate_due_recurring_expenses()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_date date := (now() at time zone 'Europe/Paris')::date;
  candidate record;
  current_due_on date;
  current_is_active boolean;
  current_auto_generate boolean;
  generated_for_template integer;
  generated_total integer := 0;
begin
  for candidate in
    select id, business_id
    from public.recurring_expense_templates
    where is_active = true
      and auto_generate = true
      and next_due_on <= run_date
    order by next_due_on, id
    for update skip locked
  loop
    generated_for_template := 0;

    while generated_for_template < 24 loop
      select next_due_on, is_active, auto_generate
      into current_due_on, current_is_active, current_auto_generate
      from public.recurring_expense_templates
      where id = candidate.id
        and business_id = candidate.business_id;

      exit when not current_is_active
        or not current_auto_generate
        or current_due_on > run_date;

      perform public.generate_recurring_expense_occurrence(
        candidate.id,
        candidate.business_id,
        'recurring_auto',
        null,
        current_due_on
      );
      generated_for_template := generated_for_template + 1;
      generated_total := generated_total + 1;
    end loop;
  end loop;

  return generated_total;
end
$$;

revoke all on function public.generate_due_recurring_expenses() from public;
revoke all on function public.generate_due_recurring_expenses() from anon;
revoke all on function public.generate_due_recurring_expenses() from authenticated;

create or replace function public.create_expense_from_recurring_template(
  p_template_id uuid,
  p_business_id uuid,
  p_purchased_on date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.assert_expense_manager(p_business_id);
begin
  return public.generate_recurring_expense_occurrence(
    p_template_id,
    p_business_id,
    'recurring_manual',
    actor,
    p_purchased_on
  );
end
$$;

revoke all on function public.create_expense_from_recurring_template(uuid, uuid, date) from public;
revoke all on function public.create_expense_from_recurring_template(uuid, uuid, date) from anon;
grant execute on function public.create_expense_from_recurring_template(uuid, uuid, date) to authenticated;

create function public.create_recurring_expense_template(
  p_business_id uuid,
  p_supplier_id uuid,
  p_category public.expense_category,
  p_subcategory text,
  p_nature public.expense_nature,
  p_cost_behavior public.expense_cost_behavior,
  p_description text,
  p_estimated_amount_cents bigint,
  p_professional_share_basis_points integer,
  p_frequency public.recurrence_frequency,
  p_next_due_on date,
  p_notes text,
  p_auto_generate boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.assert_expense_manager(p_business_id);
  new_template_id uuid := gen_random_uuid();
begin
  insert into public.recurring_expense_templates(
    id,
    business_id,
    supplier_id,
    category,
    subcategory,
    nature,
    cost_behavior,
    description,
    estimated_amount_cents,
    professional_share_basis_points,
    frequency,
    next_due_on,
    notes,
    auto_generate,
    created_by
  ) values (
    new_template_id,
    p_business_id,
    p_supplier_id,
    p_category,
    nullif(btrim(p_subcategory), ''),
    p_nature,
    p_cost_behavior,
    btrim(p_description),
    p_estimated_amount_cents,
    p_professional_share_basis_points,
    p_frequency,
    p_next_due_on,
    nullif(btrim(p_notes), ''),
    p_auto_generate,
    actor
  );

  insert into public.audit_logs(business_id, user_id, action_type, entity_name, entity_id, new_data)
  values (
    p_business_id,
    actor,
    'created',
    'recurring_expense_template',
    new_template_id,
    jsonb_build_object('description', btrim(p_description), 'auto_generate', p_auto_generate)
  );

  return new_template_id;
end
$$;

create function public.update_recurring_expense_template(
  p_template_id uuid,
  p_business_id uuid,
  p_supplier_id uuid,
  p_category public.expense_category,
  p_subcategory text,
  p_nature public.expense_nature,
  p_cost_behavior public.expense_cost_behavior,
  p_description text,
  p_estimated_amount_cents bigint,
  p_professional_share_basis_points integer,
  p_frequency public.recurrence_frequency,
  p_next_due_on date,
  p_notes text,
  p_is_active boolean,
  p_auto_generate boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.assert_expense_manager(p_business_id);
begin
  update public.recurring_expense_templates
  set supplier_id = p_supplier_id,
      category = p_category,
      subcategory = nullif(btrim(p_subcategory), ''),
      nature = p_nature,
      cost_behavior = p_cost_behavior,
      description = btrim(p_description),
      estimated_amount_cents = p_estimated_amount_cents,
      professional_share_basis_points = p_professional_share_basis_points,
      frequency = p_frequency,
      next_due_on = p_next_due_on,
      notes = nullif(btrim(p_notes), ''),
      is_active = p_is_active,
      auto_generate = p_auto_generate
  where id = p_template_id
    and business_id = p_business_id;

  if not found then
    raise exception 'template not found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs(business_id, user_id, action_type, entity_name, entity_id, new_data)
  values (
    p_business_id,
    actor,
    'updated',
    'recurring_expense_template',
    p_template_id,
    jsonb_build_object('is_active', p_is_active, 'auto_generate', p_auto_generate)
  );
end
$$;

revoke all on function public.create_recurring_expense_template(uuid, uuid, public.expense_category, text, public.expense_nature, public.expense_cost_behavior, text, bigint, integer, public.recurrence_frequency, date, text, boolean) from public;
revoke all on function public.create_recurring_expense_template(uuid, uuid, public.expense_category, text, public.expense_nature, public.expense_cost_behavior, text, bigint, integer, public.recurrence_frequency, date, text, boolean) from anon;
grant execute on function public.create_recurring_expense_template(uuid, uuid, public.expense_category, text, public.expense_nature, public.expense_cost_behavior, text, bigint, integer, public.recurrence_frequency, date, text, boolean) to authenticated;

revoke all on function public.update_recurring_expense_template(uuid, uuid, uuid, public.expense_category, text, public.expense_nature, public.expense_cost_behavior, text, bigint, integer, public.recurrence_frequency, date, text, boolean, boolean) from public;
revoke all on function public.update_recurring_expense_template(uuid, uuid, uuid, public.expense_category, text, public.expense_nature, public.expense_cost_behavior, text, bigint, integer, public.recurrence_frequency, date, text, boolean, boolean) from anon;
grant execute on function public.update_recurring_expense_template(uuid, uuid, uuid, public.expense_category, text, public.expense_nature, public.expense_cost_behavior, text, bigint, integer, public.recurrence_frequency, date, text, boolean, boolean) to authenticated;

select cron.schedule(
  'yrelcompta-generate-recurring-expenses',
  '15 4 * * *',
  'select public.generate_due_recurring_expenses();'
);
