-- Synchronisation des commandes Shopify par l'API, sans dépendre des webhooks.
-- Sur l'offre Basic, une app marchande peut ne pas obtenir les webhooks de commandes ;
-- une tâche planifiée relit alors les commandes créées ou modifiées depuis la dernière synchronisation.
-- Aucune signature de fonction existante ne change.

alter table public.shopify_connections
  add column orders_synced_through timestamptz,
  add column last_sync_at timestamptz,
  add column last_sync_error_code text,
  add column last_webhook_error text;
alter table public.shopify_connections add constraint shopify_connections_sync_error_code check (last_sync_error_code is null or last_sync_error_code ~ '^[A-Z0-9_]{2,80}$');
alter table public.shopify_connections add constraint shopify_connections_webhook_error check (last_webhook_error is null or char_length(last_webhook_error) <= 300);

-- Connexions à synchroniser (tâche planifiée, côté serveur uniquement).
create function public.list_shopify_sync_connections()
returns table(connection_id uuid, business_id uuid, orders_synced_through timestamptz)
language sql stable security definer set search_path = '' as $$
  select id, business_id, orders_synced_through from public.shopify_connections order by last_sync_at nulls first
$$;

create function public.mark_shopify_orders_synced(p_connection_id uuid, p_synced_through timestamptz, p_error_code text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_error_code is not null and p_error_code !~ '^[A-Z0-9_]{2,80}$' then raise exception 'invalid error code' using errcode = '22023'; end if;
  update public.shopify_connections set
    orders_synced_through = greatest(coalesce(orders_synced_through, p_synced_through), coalesce(p_synced_through, orders_synced_through)),
    last_sync_at = now(),
    last_sync_error_code = p_error_code
  where id = p_connection_id;
  if not found then raise exception 'shopify connection not found' using errcode = 'P0002'; end if;
end $$;

-- Message renvoyé par Shopify lors du refus d'un webhook, affiché pour comprendre la cause.
create function public.record_shopify_webhook_error(p_connection_id uuid, p_business_id uuid, p_message text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.shopify_connections set last_webhook_error = nullif(left(btrim(coalesce(p_message, '')), 300), '')
  where id = p_connection_id and business_id = p_business_id;
end $$;

-- État de synchronisation lisible par les membres de l'entreprise.
create function public.get_shopify_sync_status(p_business_id uuid)
returns table(last_sync_at timestamptz, orders_synced_through timestamptz, last_sync_error_code text, last_webhook_error text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then raise exception 'shopify access denied' using errcode = '42501'; end if;
  return query select c.last_sync_at, c.orders_synced_through, c.last_sync_error_code, c.last_webhook_error from public.shopify_connections c where c.business_id = p_business_id;
end $$;

revoke all on function public.list_shopify_sync_connections(), public.mark_shopify_orders_synced(uuid, timestamptz, text), public.record_shopify_webhook_error(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.list_shopify_sync_connections(), public.mark_shopify_orders_synced(uuid, timestamptz, text), public.record_shopify_webhook_error(uuid, uuid, text) to service_role;
revoke all on function public.get_shopify_sync_status(uuid) from public, anon;
grant execute on function public.get_shopify_sync_status(uuid) to authenticated;

comment on column public.shopify_connections.orders_synced_through is 'Date de modification Shopify jusqu’à laquelle les commandes ont été importées par l’API.';
