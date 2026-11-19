-- Boîte de réception des justificatifs.
-- Les fichiers sont déposés sans dépense (chemin {entreprise}/inbox/{document}/{nom}),
-- puis rattachés à une ou plusieurs dépenses. Un même document peut justifier plusieurs
-- dépenses (commande saisie en plusieurs dépenses). Un rattachement à une dépense validée
-- reste définitif : seul un brouillon peut perdre un justificatif.

create function public.is_valid_inbox_document_path(p_name text) returns boolean language sql immutable set search_path='' as $$
  select array_length(storage.foldername(p_name),1)=3
    and p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/inbox/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[a-z0-9._-]{1,255}$'
    and p_name !~ '(^|/)\.\.(/|$)'
$$;
revoke all on function public.is_valid_inbox_document_path(text) from public;
grant execute on function public.is_valid_inbox_document_path(text) to authenticated;

-- Le type d'un document de la boîte de réception est choisi lors de son premier rattachement.
-- Toute autre modification des métadonnées reste interdite.
create or replace function public.prevent_document_mutation() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' and current_setting('yrelcompta.allow_document_delete',true)='on' then return old; end if;
  if tg_op='UPDATE' and current_setting('yrelcompta.allow_document_kind_update',true)='on' and (to_jsonb(new)-'kind')=(to_jsonb(old)-'kind') then return new; end if;
  raise exception 'document metadata is immutable' using errcode='55000';
end $$;
revoke all on function public.prevent_document_mutation() from public;

-- Stockage : dépôt dans la boîte de réception réservé aux gestionnaires de l'entreprise.
create policy receipt_inbox_storage_insert on storage.objects for insert to authenticated with check (
  bucket_id='expense-documents' and public.is_valid_inbox_document_path(name)
  and exists(select 1 from public.businesses b where b.id::text=(storage.foldername(name))[1] and public.can_manage_business(b.id))
);
-- Lecture de la boîte de réception par les membres de l'entreprise : nécessaire aussi pour
-- l'envoi (Storage relit l'objet créé) et pour effacer un fichier dont les métadonnées sont retirées.
create policy receipt_inbox_storage_select on storage.objects for select to authenticated using (
  bucket_id='expense-documents' and public.is_valid_inbox_document_path(name)
  and exists(select 1 from public.businesses b where b.id::text=(storage.foldername(name))[1] and public.is_business_member(b.id))
);
-- Lecture de tout document enregistré de l'entreprise, quel que soit son chemin : un document
-- rattaché à plusieurs dépenses doit rester lisible même si la dépense de son chemin disparaît.
create policy registered_documents_storage_select on storage.objects for select to authenticated using (
  bucket_id='expense-documents'
  and exists(select 1 from public.documents d where d.storage_bucket='expense-documents' and d.storage_path=name and public.is_business_member(d.business_id))
);
-- Suppression d'un fichier de la boîte de réception : seulement une fois ses métadonnées retirées
-- (ou pour nettoyer un dépôt dont l'enregistrement a échoué).
create policy receipt_inbox_storage_delete on storage.objects for delete to authenticated using (
  bucket_id='expense-documents' and public.is_valid_inbox_document_path(name)
  and exists(select 1 from public.businesses b where b.id::text=(storage.foldername(name))[1] and public.can_manage_business(b.id))
  and not exists(select 1 from public.documents d where d.storage_bucket='expense-documents' and d.storage_path=name)
);
-- Un fichier rattaché ailleurs ne doit plus pouvoir être effacé au motif que la dépense de son
-- chemin est un brouillon : la suppression exige désormais que ses métadonnées aient été retirées.
drop policy expense_documents_storage_delete on storage.objects;
create policy expense_documents_storage_delete on storage.objects for delete to authenticated using (
  bucket_id='expense-documents' and public.is_valid_expense_document_path(name)
  and exists(select 1 from public.expenses e where e.business_id::text=(storage.foldername(name))[1] and e.id::text=(storage.foldername(name))[2] and e.status<>'cancelled' and public.can_manage_business(e.business_id))
  and not exists(select 1 from public.documents d where d.storage_bucket='expense-documents' and d.storage_path=name)
);

create function public.register_inbox_document(p_document_id uuid,p_business_id uuid,p_storage_path text,p_original_name text,p_mime_type text,p_size_bytes bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_expense_manager(p_business_id);
begin
  if p_storage_path is distinct from p_business_id::text||'/inbox/'||p_document_id::text||'/'||regexp_replace(lower(p_original_name),'[^a-z0-9._-]+','-','g') or not public.is_valid_inbox_document_path(p_storage_path) then
    raise exception 'invalid storage path' using errcode='22023';
  end if;
  insert into public.documents(id,business_id,kind,storage_bucket,storage_path,original_name,mime_type,size_bytes,uploaded_by)
  values(p_document_id,p_business_id,'other','expense-documents',p_storage_path,p_original_name,p_mime_type,p_size_bytes,actor);
  insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,new_data)
  values(p_business_id,actor,'uploaded','document',p_document_id,jsonb_build_object('inbox',true));
  return p_document_id;
end $$;

-- Rattache un document (de la boîte de réception ou déjà rattaché) à une ou plusieurs dépenses
-- non annulées, y compris validées : le justificatif complète la dépense sans changer son montant.
create function public.attach_document_to_expenses(p_document_id uuid,p_business_id uuid,p_expense_ids uuid[],p_kind public.document_kind) returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_expense_manager(p_business_id); wanted uuid[]; found_count integer; added integer;
begin
  select array_agg(distinct x) into wanted from unnest(p_expense_ids) x where x is not null;
  if wanted is null or cardinality(wanted)>20 then raise exception 'between 1 and 20 expenses required' using errcode='22023'; end if;
  perform 1 from public.documents where id=p_document_id and business_id=p_business_id for update;
  if not found then raise exception 'document not found' using errcode='P0002'; end if;
  select count(*) into found_count from (select 1 from public.expenses where id=any(wanted) and business_id=p_business_id and status<>'cancelled' for share) e;
  if found_count<>cardinality(wanted) then raise exception 'expense not found' using errcode='P0002'; end if;
  if p_kind is not null and not exists(select 1 from public.expense_documents where document_id=p_document_id and business_id=p_business_id) then
    perform set_config('yrelcompta.allow_document_kind_update','on',true);
    update public.documents set kind=p_kind where id=p_document_id and business_id=p_business_id;
    perform set_config('yrelcompta.allow_document_kind_update','off',true);
  end if;
  insert into public.expense_documents(business_id,expense_id,document_id,attached_by)
  select p_business_id,x,p_document_id,actor from unnest(wanted) x
  on conflict (expense_id,document_id) do nothing;
  get diagnostics added=row_count;
  insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,new_data)
  values(p_business_id,actor,'attached','document',p_document_id,jsonb_build_object('expense_ids',to_jsonb(wanted),'added',added));
  return added;
end $$;

-- Retirer un justificatif d'un brouillon : le document n'est effacé que s'il n'est plus rattaché
-- nulle part et qu'il ne vient pas de la boîte de réception (il y retourne alors). Renvoie le
-- chemin du fichier à effacer, ou null s'il est conservé.
create or replace function public.delete_draft_expense_document(p_document_id uuid,p_expense_id uuid,p_business_id uuid) returns text language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_expense_manager(p_business_id); s public.expense_status; canonical_path text;
begin
  select status into s from public.expenses where id=p_expense_id and business_id=p_business_id for update;
  if s is distinct from 'draft' then raise exception 'draft required' using errcode='55000'; end if;
  select d.storage_path into canonical_path from public.documents d join public.expense_documents ed on ed.document_id=d.id and ed.business_id=d.business_id
    where d.id=p_document_id and ed.expense_id=p_expense_id and ed.business_id=p_business_id for update of d,ed;
  if canonical_path is null then raise exception 'document not found' using errcode='P0002'; end if;
  delete from public.expense_documents where document_id=p_document_id and expense_id=p_expense_id and business_id=p_business_id;
  if public.is_valid_inbox_document_path(canonical_path) or exists(select 1 from public.expense_documents where document_id=p_document_id and business_id=p_business_id) then
    insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,old_data)
    values(p_business_id,actor,'detached','document',p_document_id,jsonb_build_object('expense_id',p_expense_id));
    return null;
  end if;
  perform set_config('yrelcompta.allow_document_delete','on',true);
  delete from public.documents where id=p_document_id and business_id=p_business_id;
  perform set_config('yrelcompta.allow_document_delete','off',true);
  insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,old_data)
  values(p_business_id,actor,'deleted','document',p_document_id,jsonb_build_object('expense_id',p_expense_id));
  return canonical_path;
end $$;

-- Supprime un document de la boîte de réception qui n'est rattaché à aucune dépense.
create function public.delete_inbox_document(p_document_id uuid,p_business_id uuid) returns text language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_expense_manager(p_business_id); canonical_path text;
begin
  select storage_path into canonical_path from public.documents where id=p_document_id and business_id=p_business_id for update;
  if canonical_path is null or not public.is_valid_inbox_document_path(canonical_path) then raise exception 'document not found' using errcode='P0002'; end if;
  if exists(select 1 from public.expense_documents where document_id=p_document_id and business_id=p_business_id) then raise exception 'document is attached' using errcode='55000'; end if;
  perform set_config('yrelcompta.allow_document_delete','on',true);
  delete from public.documents where id=p_document_id and business_id=p_business_id;
  perform set_config('yrelcompta.allow_document_delete','off',true);
  insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,old_data)
  values(p_business_id,actor,'deleted','document',p_document_id,jsonb_build_object('inbox',true));
  return canonical_path;
end $$;

revoke all on function public.register_inbox_document(uuid,uuid,text,text,text,bigint),public.attach_document_to_expenses(uuid,uuid,uuid[],public.document_kind),public.delete_draft_expense_document(uuid,uuid,uuid),public.delete_inbox_document(uuid,uuid) from public,anon;
grant execute on function public.register_inbox_document(uuid,uuid,text,text,text,bigint),public.attach_document_to_expenses(uuid,uuid,uuid[],public.document_kind),public.delete_draft_expense_document(uuid,uuid,uuid),public.delete_inbox_document(uuid,uuid) to authenticated;

create index expense_documents_document_idx on public.expense_documents(business_id,document_id);

comment on function public.attach_document_to_expenses(uuid,uuid,uuid[],public.document_kind) is 'Rattache un justificatif à une ou plusieurs dépenses non annulées ; définitif sur une dépense validée.';
