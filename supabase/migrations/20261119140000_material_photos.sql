-- Photo par matière : une vignette privée par fiche ({entreprise}/{matière}/{photo}.{ext}),
-- affichée par liens signés temporaires dans la liste des matières et le choix des recettes.

create function public.is_valid_material_photo_path(p_name text) returns boolean language sql immutable set search_path='' as $$
  select coalesce(array_length(storage.foldername(p_name),1),0)=2
    and p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(webp|jpg|png)$'
$$;
revoke all on function public.is_valid_material_photo_path(text) from public;
grant execute on function public.is_valid_material_photo_path(text) to authenticated;

alter table public.materials add column photo_path text;
alter table public.materials add constraint materials_photo_path_valid check (
  photo_path is null or (public.is_valid_material_photo_path(photo_path) and split_part(photo_path,'/',1)=business_id::text and split_part(photo_path,'/',2)=id::text)
);

-- Dans les règles ci-dessous, « name » est qualifié (objects.name) : materials et businesses ont
-- leur propre colonne name, qui serait sinon prise à la place du chemin du fichier.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('material-photos','material-photos',false,1048576,array['image/webp','image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy material_photos_storage_select on storage.objects for select to authenticated using (
  bucket_id='material-photos' and public.is_valid_material_photo_path(objects.name)
  and exists(select 1 from public.businesses b where b.id::text=(storage.foldername(objects.name))[1] and public.is_business_member(b.id))
);
create policy material_photos_storage_insert on storage.objects for insert to authenticated with check (
  bucket_id='material-photos' and public.is_valid_material_photo_path(objects.name)
  and exists(select 1 from public.materials m where m.business_id::text=(storage.foldername(objects.name))[1] and m.id::text=(storage.foldername(objects.name))[2] and public.can_manage_business(m.business_id))
);
-- La photo en cours d'une fiche ne peut pas être effacée : il faut d'abord la remplacer ou la retirer.
create policy material_photos_storage_delete on storage.objects for delete to authenticated using (
  bucket_id='material-photos' and public.is_valid_material_photo_path(objects.name)
  and exists(select 1 from public.businesses b where b.id::text=(storage.foldername(objects.name))[1] and public.can_manage_business(b.id))
  and not exists(select 1 from public.materials m where m.photo_path=objects.name)
);

-- Remplace (ou retire, avec null) la photo d'une matière, active ou archivée.
-- Renvoie le chemin de l'ancienne photo, à effacer du Storage, ou null.
create function public.set_material_photo(p_material_id uuid,p_business_id uuid,p_photo_path text) returns text language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_product_manager(p_business_id); previous text;
begin
  select photo_path into previous from public.materials where id=p_material_id and business_id=p_business_id for update;
  if not found then raise exception 'material not found' using errcode='P0002'; end if;
  if p_photo_path is not null and (not public.is_valid_material_photo_path(p_photo_path) or split_part(p_photo_path,'/',1)<>p_business_id::text or split_part(p_photo_path,'/',2)<>p_material_id::text) then
    raise exception 'invalid photo path' using errcode='22023';
  end if;
  if p_photo_path is not distinct from previous then return null; end if;
  update public.materials set photo_path=p_photo_path where id=p_material_id and business_id=p_business_id;
  insert into public.audit_logs(business_id,user_id,action_type,entity_name,entity_id,new_data)
  values(p_business_id,actor,case when p_photo_path is null then 'photo_removed' else 'photo_set' end,'material',p_material_id,jsonb_build_object('photo',p_photo_path is not null));
  return previous;
end $$;
revoke all on function public.set_material_photo(uuid,uuid,text) from public,anon;
grant execute on function public.set_material_photo(uuid,uuid,text) to authenticated;

comment on column public.materials.photo_path is 'Vignette privée de la matière (bucket material-photos), jamais exposée par lien public.';
