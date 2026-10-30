-- 화면이 바로 읽는 계산 완료 Journey. buildJourney가 붙기 전에는 데모 fixture를 넣고,
-- 나중에는 같은 행의 payload만 다시 계산해 저장한다.
create table public.journeys (
    owner_id uuid primary key references public.profiles(id) on delete cascade,
    payload jsonb not null check (jsonb_typeof(payload) = 'object'),
    updated_at timestamptz not null default now()
);

alter table public.journeys enable row level security;

create policy "본인 여행" on public.journeys
    for all to authenticated
    using ((select auth.uid()) = owner_id)
    with check ((select auth.uid()) = owner_id);

grant select, insert, update, delete on public.journeys to authenticated;

-- 저장소 public/에 있던 데모 전용 이미지와 출처 파일. 개인 업로드는 기존 비공개 photos 버킷을 쓴다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('demo-assets', 'demo-assets', true, 1048576, array['image/webp', 'application/json'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
