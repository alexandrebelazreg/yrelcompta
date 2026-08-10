-- Fondation Shopify V1 : connexion, secrets Vault, webhooks et déduplication.
-- Aucun événement reçu ici ne produit d'écriture comptable.

create extension if not exists supabase_vault with schema vault;

create type public.shopify_connection_status as enum ('webhooks_partial', 'connected', 'error');
create type public.shopify_webhook_processing_status as enum ('pending', 'processed', 'ignored', 'error');

create table public.shopify_connections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  shop_domain text not null,
  client_id text not null,
  client_secret_vault_id uuid not null,
  access_token_vault_id uuid not null,
  access_token_expires_at timestamptz not null,
  shopify_shop_gid text not null,
  shop_name text not null,
  shop_currency text not null,
  granted_scopes text[] not null default '{}',
  connection_status public.shopify_connection_status not null default 'webhooks_partial',
  last_verified_at timestamptz,
  last_error_code text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shopify_connections_business_key unique (business_id),
  constraint shopify_connections_shop_domain_key unique (shop_domain),
  constraint shopify_connections_id_business_key unique (id, business_id),
  constraint shopify_connections_domain check (
    shop_domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$'
  ),
  constraint shopify_connections_client_id check (char_length(btrim(client_id)) between 3 and 200),
  constraint shopify_connections_shop_gid check (shopify_shop_gid ~ '^gid://shopify/Shop/[0-9]+$'),
  constraint shopify_connections_shop_name check (char_length(btrim(shop_name)) between 1 and 200),
  constraint shopify_connections_currency check (shop_currency ~ '^[A-Z]{3}$'),
  constraint shopify_connections_scopes check (
    array_position(granted_scopes, null) is null
    and cardinality(granted_scopes) <= 100
  ),
  constraint shopify_connections_error_code check (
    last_error_code is null or last_error_code ~ '^[A-Z0-9_]{2,80}$'
  )
);

create table public.shopify_webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  business_id uuid not null,
  topic text not null,
  shopify_subscription_gid text not null,
  uri text not null,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint shopify_webhook_subscriptions_connection_fk
    foreign key (connection_id, business_id)
    references public.shopify_connections(id, business_id)
    on delete cascade,
  constraint shopify_webhook_subscriptions_topic_key unique (connection_id, topic),
  constraint shopify_webhook_subscriptions_gid_key unique (connection_id, shopify_subscription_gid),
  constraint shopify_webhook_subscriptions_topic check (
    topic in ('ORDERS_CREATE', 'ORDERS_UPDATED', 'ORDERS_PAID', 'ORDERS_CANCELLED', 'REFUNDS_CREATE')
  ),
  constraint shopify_webhook_subscriptions_gid check (
    shopify_subscription_gid ~ '^gid://shopify/WebhookSubscription/[0-9]+$'
  ),
  constraint shopify_webhook_subscriptions_uri check (
    uri ~ '^(https://[A-Za-z0-9.-]+|http://localhost(:[0-9]+)?)/api/integrations/shopify/webhook$'
  )
);

create table public.shopify_webhook_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  connection_id uuid references public.shopify_connections(id) on delete set null,
  webhook_id text not null,
  event_id text,
  topic text not null,
  api_version text,
  triggered_at timestamptz,
  shopify_order_gid text,
  shopify_resource_id text,
  payload_sha256 text not null,
  processing_status public.shopify_webhook_processing_status not null default 'pending',
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error_code text,
  constraint shopify_webhook_events_delivery_key unique (connection_id, webhook_id),
  constraint shopify_webhook_events_webhook_id check (char_length(webhook_id) between 1 and 200),
  constraint shopify_webhook_events_event_id check (event_id is null or char_length(event_id) <= 200),
  constraint shopify_webhook_events_topic check (
    topic in ('ORDERS_CREATE', 'ORDERS_UPDATED', 'ORDERS_PAID', 'ORDERS_CANCELLED', 'REFUNDS_CREATE')
  ),
  constraint shopify_webhook_events_api_version check (api_version is null or api_version ~ '^[0-9]{4}-[0-9]{2}$'),
  constraint shopify_webhook_events_payload_hash check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint shopify_webhook_events_order_gid check (
    shopify_order_gid is null or shopify_order_gid ~ '^gid://shopify/Order/[0-9]+$'
  ),
  constraint shopify_webhook_events_resource_id check (
    shopify_resource_id is null or char_length(shopify_resource_id) <= 200
  ),
  constraint shopify_webhook_events_error_code check (
    last_error_code is null or last_error_code ~ '^[A-Z0-9_]{2,80}$'
  )
);

create index shopify_webhook_events_business_received_idx
  on public.shopify_webhook_events(business_id, received_at desc);
create index shopify_webhook_events_pending_idx
  on public.shopify_webhook_events(processing_status, received_at)
  where processing_status = 'pending';

create trigger shopify_connections_set_updated_at
before update on public.shopify_connections
for each row execute function public.set_updated_at();

alter table public.shopify_connections enable row level security;
alter table public.shopify_webhook_subscriptions enable row level security;
alter table public.shopify_webhook_events enable row level security;

revoke all on table public.shopify_connections from public, anon, authenticated;
revoke all on table public.shopify_webhook_subscriptions from public, anon, authenticated;
revoke all on table public.shopify_webhook_events from public, anon, authenticated;
revoke all on table vault.secrets from public, anon, authenticated;
revoke all on table vault.decrypted_secrets from public, anon, authenticated;

create function public.get_shopify_connection_status(p_business_id uuid)
returns table (
  id uuid,
  shop_domain text,
  shop_name text,
  shop_currency text,
  client_id_hint text,
  connection_status public.shopify_connection_status,
  granted_scopes text[],
  last_verified_at timestamptz,
  webhook_count integer,
  expected_webhook_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_expense_manager(p_business_id);

  return query
  select
    c.id,
    c.shop_domain,
    c.shop_name,
    c.shop_currency,
    '••••' || right(c.client_id, 4),
    c.connection_status,
    c.granted_scopes,
    c.last_verified_at,
    count(s.id)::integer,
    5
  from public.shopify_connections c
  left join public.shopify_webhook_subscriptions s
    on s.connection_id = c.id
    and s.business_id = c.business_id
  where c.business_id = p_business_id
  group by c.id;
end
$$;

revoke all on function public.get_shopify_connection_status(uuid) from public, anon;
grant execute on function public.get_shopify_connection_status(uuid) to authenticated;

create function public.upsert_shopify_connection(
  p_business_id uuid,
  p_shop_domain text,
  p_client_id text,
  p_client_secret text,
  p_access_token text,
  p_access_token_expires_at timestamptz,
  p_shopify_shop_gid text,
  p_shop_name text,
  p_shop_currency text,
  p_granted_scopes text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.assert_expense_manager(p_business_id);
  existing public.shopify_connections;
  connection_id uuid := gen_random_uuid();
  client_secret_id uuid;
  access_token_id uuid;
  audit_action text := 'shopify_connected';
begin
  if p_shop_domain is null
    or p_shop_domain !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$'
    or p_client_id is null
    or char_length(btrim(p_client_id)) not between 3 and 200
    or p_client_secret is null
    or char_length(p_client_secret) < 8
    or p_access_token is null
    or char_length(p_access_token) < 8
    or p_access_token_expires_at <= now()
    or p_shop_currency <> 'EUR'
    or not (p_granted_scopes @> array['read_orders', 'read_products']::text[])
  then
    raise exception 'invalid shopify connection' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.shopify_connections
    where shop_domain = p_shop_domain and business_id <> p_business_id
  ) then
    raise exception 'shopify domain already connected' using errcode = '23505';
  end if;

  select * into existing
  from public.shopify_connections
  where business_id = p_business_id
  for update;

  if found then
    connection_id := existing.id;
    client_secret_id := existing.client_secret_vault_id;
    access_token_id := existing.access_token_vault_id;
    perform vault.update_secret(client_secret_id, p_client_secret);
    perform vault.update_secret(access_token_id, p_access_token);
    audit_action := 'shopify_credentials_rotated';

    update public.shopify_connections
    set shop_domain = p_shop_domain,
        client_id = btrim(p_client_id),
        access_token_expires_at = p_access_token_expires_at,
        shopify_shop_gid = p_shopify_shop_gid,
        shop_name = btrim(p_shop_name),
        shop_currency = p_shop_currency,
        granted_scopes = p_granted_scopes,
        connection_status = 'webhooks_partial',
        last_verified_at = now(),
        last_error_code = null
    where id = connection_id and business_id = p_business_id;
  else
    client_secret_id := vault.create_secret(
      p_client_secret,
      'shopify-client-secret-' || connection_id::text,
      'Client Secret Shopify chiffré pour une connexion YrelCompta'
    );
    access_token_id := vault.create_secret(
      p_access_token,
      'shopify-access-token-' || connection_id::text,
      'Token Shopify temporaire chiffré pour une connexion YrelCompta'
    );

    insert into public.shopify_connections(
      id, business_id, shop_domain, client_id,
      client_secret_vault_id, access_token_vault_id, access_token_expires_at,
      shopify_shop_gid, shop_name, shop_currency, granted_scopes,
      connection_status, last_verified_at, created_by
    ) values (
      connection_id, p_business_id, p_shop_domain, btrim(p_client_id),
      client_secret_id, access_token_id, p_access_token_expires_at,
      p_shopify_shop_gid, btrim(p_shop_name), p_shop_currency, p_granted_scopes,
      'webhooks_partial', now(), actor
    );
  end if;

  insert into public.audit_logs(
    business_id, user_id, action_type, entity_name, entity_id, new_data
  ) values (
    p_business_id,
    actor,
    audit_action,
    'shopify_connection',
    connection_id,
    jsonb_build_object('shop_domain', p_shop_domain, 'connection_status', 'webhooks_partial')
  );

  return connection_id;
end
$$;

revoke all on function public.upsert_shopify_connection(uuid, text, text, text, text, timestamptz, text, text, text, text[]) from public, anon;
grant execute on function public.upsert_shopify_connection(uuid, text, text, text, text, timestamptz, text, text, text, text[]) to authenticated;

create function public.replace_shopify_webhook_subscriptions(
  p_connection_id uuid,
  p_business_id uuid,
  p_subscriptions jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.assert_expense_manager(p_business_id);
  item jsonb;
  item_topic text;
  item_gid text;
  item_uri text;
  subscription_count integer;
begin
  perform 1
  from public.shopify_connections
  where id = p_connection_id and business_id = p_business_id
  for update;
  if not found then
    raise exception 'shopify connection not found' using errcode = 'P0002';
  end if;

  if jsonb_typeof(p_subscriptions) <> 'array' or jsonb_array_length(p_subscriptions) > 5 then
    raise exception 'invalid shopify webhook subscriptions' using errcode = '22023';
  end if;

  delete from public.shopify_webhook_subscriptions
  where connection_id = p_connection_id and business_id = p_business_id;

  for item in select value from jsonb_array_elements(p_subscriptions)
  loop
    item_topic := item ->> 'topic';
    item_gid := item ->> 'shopify_subscription_gid';
    item_uri := item ->> 'uri';

    if item_topic not in ('ORDERS_CREATE', 'ORDERS_UPDATED', 'ORDERS_PAID', 'ORDERS_CANCELLED', 'REFUNDS_CREATE')
      or item_gid !~ '^gid://shopify/WebhookSubscription/[0-9]+$'
      or item_uri !~ '^(https://[A-Za-z0-9.-]+|http://localhost(:[0-9]+)?)/api/integrations/shopify/webhook$'
    then
      raise exception 'invalid shopify webhook subscription' using errcode = '22023';
    end if;

    insert into public.shopify_webhook_subscriptions(
      connection_id, business_id, topic, shopify_subscription_gid, uri, verified_at
    ) values (
      p_connection_id, p_business_id, item_topic, item_gid, item_uri, now()
    );
  end loop;

  select count(*)::integer into subscription_count
  from public.shopify_webhook_subscriptions
  where connection_id = p_connection_id and business_id = p_business_id;

  update public.shopify_connections
  set connection_status = case when subscription_count = 5 then 'connected' else 'webhooks_partial' end,
      last_verified_at = now(),
      last_error_code = case when subscription_count = 5 then null else 'WEBHOOKS_PARTIAL' end
  where id = p_connection_id and business_id = p_business_id;

  insert into public.audit_logs(
    business_id, user_id, action_type, entity_name, entity_id, new_data
  ) values (
    p_business_id,
    actor,
    'shopify_webhooks_reconciled',
    'shopify_connection',
    p_connection_id,
    jsonb_build_object('active_webhook_count', subscription_count, 'expected_webhook_count', 5)
  );

  return subscription_count;
end
$$;

revoke all on function public.replace_shopify_webhook_subscriptions(uuid, uuid, jsonb) from public, anon;
grant execute on function public.replace_shopify_webhook_subscriptions(uuid, uuid, jsonb) to authenticated;

create function public.mark_shopify_connection_verified(
  p_connection_id uuid,
  p_business_id uuid,
  p_granted_scopes text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_expense_manager(p_business_id);

  if not (p_granted_scopes @> array['read_orders', 'read_products']::text[]) then
    raise exception 'missing required shopify scopes' using errcode = '22023';
  end if;

  update public.shopify_connections
  set granted_scopes = p_granted_scopes,
      last_verified_at = now(),
      last_error_code = null
  where id = p_connection_id and business_id = p_business_id;
  if not found then
    raise exception 'shopify connection not found' using errcode = 'P0002';
  end if;
end
$$;

revoke all on function public.mark_shopify_connection_verified(uuid, uuid, text[]) from public, anon;
grant execute on function public.mark_shopify_connection_verified(uuid, uuid, text[]) to authenticated;

create function public.disconnect_shopify_connection(
  p_connection_id uuid,
  p_business_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.assert_expense_manager(p_business_id);
  connection public.shopify_connections;
begin
  select * into connection
  from public.shopify_connections
  where id = p_connection_id and business_id = p_business_id
  for update;
  if not found then
    raise exception 'shopify connection not found' using errcode = 'P0002';
  end if;

  delete from public.shopify_connections
  where id = p_connection_id and business_id = p_business_id;

  delete from vault.secrets
  where id in (connection.client_secret_vault_id, connection.access_token_vault_id);

  insert into public.audit_logs(
    business_id, user_id, action_type, entity_name, entity_id, old_data
  ) values (
    p_business_id,
    actor,
    'shopify_disconnected',
    'shopify_connection',
    p_connection_id,
    jsonb_build_object('shop_domain', connection.shop_domain)
  );
end
$$;

revoke all on function public.disconnect_shopify_connection(uuid, uuid) from public, anon;
grant execute on function public.disconnect_shopify_connection(uuid, uuid) to authenticated;

create function public.get_shopify_backend_credentials(p_connection_id uuid)
returns table (
  connection_id uuid,
  business_id uuid,
  shop_domain text,
  client_id text,
  client_secret text,
  access_token text,
  access_token_expires_at timestamptz,
  granted_scopes text[]
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    c.id,
    c.business_id,
    c.shop_domain,
    c.client_id,
    cs.decrypted_secret,
    at.decrypted_secret,
    c.access_token_expires_at,
    c.granted_scopes
  from public.shopify_connections c
  join vault.decrypted_secrets cs on cs.id = c.client_secret_vault_id
  join vault.decrypted_secrets at on at.id = c.access_token_vault_id
  where c.id = p_connection_id
$$;

create function public.get_shopify_backend_credentials_by_domain(p_shop_domain text)
returns table (
  connection_id uuid,
  business_id uuid,
  shop_domain text,
  client_id text,
  client_secret text,
  access_token text,
  access_token_expires_at timestamptz,
  granted_scopes text[]
)
language sql
security definer
set search_path = ''
stable
as $$
  select *
  from public.get_shopify_backend_credentials(
    (select c.id from public.shopify_connections c where c.shop_domain = p_shop_domain)
  )
$$;

create function public.get_shopify_backend_webhook_subscriptions(p_connection_id uuid)
returns table (topic text, shopify_subscription_gid text, uri text)
language sql
security definer
set search_path = ''
stable
as $$
  select s.topic, s.shopify_subscription_gid, s.uri
  from public.shopify_webhook_subscriptions s
  where s.connection_id = p_connection_id
  order by s.topic
$$;

create function public.cache_shopify_access_token(
  p_connection_id uuid,
  p_access_token text,
  p_access_token_expires_at timestamptz,
  p_granted_scopes text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection public.shopify_connections;
begin
  if p_access_token is null
    or char_length(p_access_token) < 8
    or p_access_token_expires_at <= now()
    or not (p_granted_scopes @> array['read_orders', 'read_products']::text[])
  then
    raise exception 'invalid shopify access token' using errcode = '22023';
  end if;

  select * into connection
  from public.shopify_connections
  where id = p_connection_id
  for update;
  if not found then
    raise exception 'shopify connection not found' using errcode = 'P0002';
  end if;

  perform vault.update_secret(connection.access_token_vault_id, p_access_token);
  update public.shopify_connections
  set access_token_expires_at = p_access_token_expires_at,
      granted_scopes = p_granted_scopes,
      last_error_code = null
  where id = p_connection_id;
end
$$;

create function public.record_shopify_webhook_event(
  p_connection_id uuid,
  p_business_id uuid,
  p_webhook_id text,
  p_event_id text,
  p_topic text,
  p_api_version text,
  p_triggered_at timestamptz,
  p_shopify_order_gid text,
  p_shopify_resource_id text,
  p_payload_sha256 text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_id uuid;
begin
  if not exists (
    select 1 from public.shopify_connections
    where id = p_connection_id and business_id = p_business_id
  ) then
    raise exception 'shopify connection not found' using errcode = 'P0002';
  end if;

  insert into public.shopify_webhook_events(
    business_id, connection_id, webhook_id, event_id, topic, api_version,
    triggered_at, shopify_order_gid, shopify_resource_id, payload_sha256
  ) values (
    p_business_id, p_connection_id, p_webhook_id, nullif(p_event_id, ''), p_topic,
    nullif(p_api_version, ''), p_triggered_at, p_shopify_order_gid,
    p_shopify_resource_id, p_payload_sha256
  )
  on conflict (connection_id, webhook_id) do nothing
  returning id into inserted_id;

  return inserted_id is not null;
end
$$;

revoke all on function public.get_shopify_backend_credentials(uuid) from public, anon, authenticated;
revoke all on function public.get_shopify_backend_credentials_by_domain(text) from public, anon, authenticated;
revoke all on function public.get_shopify_backend_webhook_subscriptions(uuid) from public, anon, authenticated;
revoke all on function public.cache_shopify_access_token(uuid, text, timestamptz, text[]) from public, anon, authenticated;
revoke all on function public.record_shopify_webhook_event(uuid, uuid, text, text, text, text, timestamptz, text, text, text) from public, anon, authenticated;

grant execute on function public.get_shopify_backend_credentials(uuid) to service_role;
grant execute on function public.get_shopify_backend_credentials_by_domain(text) to service_role;
grant execute on function public.get_shopify_backend_webhook_subscriptions(uuid) to service_role;
grant execute on function public.cache_shopify_access_token(uuid, text, timestamptz, text[]) to service_role;
grant execute on function public.record_shopify_webhook_event(uuid, uuid, text, text, text, text, timestamptz, text, text, text) to service_role;
