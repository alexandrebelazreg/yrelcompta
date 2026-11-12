-- Traçabilité des écritures faites par une application connectée (ex. Claude via le connecteur MCP).
-- Les jetons du serveur OAuth Supabase portent la revendication client_id : elle est recopiée
-- dans le journal d'audit à chaque insertion. Aucune signature de RPC ne change.

alter table public.audit_logs add column oauth_client_id text;
alter table public.audit_logs add constraint audit_logs_oauth_client_length check (oauth_client_id is null or char_length(oauth_client_id) between 1 and 200);

create function public.audit_logs_set_oauth_client() returns trigger language plpgsql set search_path='' as $$
begin
  new.oauth_client_id := nullif(left(coalesce(auth.jwt() ->> 'client_id', ''), 200), '');
  return new;
end $$;

revoke all on function public.audit_logs_set_oauth_client() from public,anon,authenticated;

create trigger audit_logs_set_oauth_client before insert on public.audit_logs for each row execute function public.audit_logs_set_oauth_client();

comment on column public.audit_logs.oauth_client_id is 'Application OAuth (ex. connecteur Claude) à l’origine de l’écriture ; vide pour une action faite dans YrelCompta.';
