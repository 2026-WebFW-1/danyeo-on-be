-- 공유 데모 계정은 자기 UUID 폴더의 데모 자산만 다시 시드할 수 있다.
-- demo-assets는 public 버킷이라 파일 URL 조회 자체에는 SELECT 정책이 필요 없지만,
-- upsert는 기존 객체 확인을 위해 SELECT 권한도 필요하다.
create policy "데모 자산 읽기" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'demo-assets'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and exists (
            select 1 from public.profiles
            where id = (select auth.uid()) and provider = 'demo'
        )
    );

create policy "데모 자산 올리기" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'demo-assets'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and exists (
            select 1 from public.profiles
            where id = (select auth.uid()) and provider = 'demo'
        )
    );

create policy "데모 자산 바꾸기" on storage.objects
    for update to authenticated
    using (
        bucket_id = 'demo-assets'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and exists (
            select 1 from public.profiles
            where id = (select auth.uid()) and provider = 'demo'
        )
    )
    with check (
        bucket_id = 'demo-assets'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and exists (
            select 1 from public.profiles
            where id = (select auth.uid()) and provider = 'demo'
        )
    );

create policy "데모 자산 지우기" on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'demo-assets'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and exists (
            select 1 from public.profiles
            where id = (select auth.uid()) and provider = 'demo'
        )
    );
