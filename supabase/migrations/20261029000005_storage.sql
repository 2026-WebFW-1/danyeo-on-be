-- 사진 파일. 경로는 <사용자 uuid>/full/<사진 ID>.webp, <사용자 uuid>/thumb/<사진 ID>.webp
-- 본인만 볼 수 있어서 화면에는 서명 URL(createSignedUrl)로 띄운다
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 1048576, array['image/webp', 'image/jpeg'])
on conflict (id) do nothing;

create policy "본인 폴더 사진 읽기" on storage.objects
    for select to authenticated
    using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "본인 폴더 사진 올리기" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "본인 폴더 사진 바꾸기" on storage.objects
    for update to authenticated
    using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
    with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "본인 폴더 사진 지우기" on storage.objects
    for delete to authenticated
    using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
