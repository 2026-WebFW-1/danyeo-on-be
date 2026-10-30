-- 사진별 글은 날짜별 posts와 분리한다. 기존 my_data() 응답 계약은 유지한다.
create table public.photo_notes (
  photo_id varchar(40) primary key references public.photos(id) on delete cascade,
  title varchar(200) not null check (length(trim(title)) > 0),
  body text not null check (length(body) between 1 and 10000),
  tags text[] not null default '{}',
  source jsonb not null default '{}'::jsonb check (jsonb_typeof(source) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.photo_notes enable row level security;
revoke all on public.photo_notes from anon;
grant select, insert, update, delete on public.photo_notes to authenticated;

create policy photo_notes_owner on public.photo_notes
  for all to authenticated
  using (exists (select 1 from public.photos p
    where p.id = photo_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.photos p
    where p.id = photo_id and p.owner_id = (select auth.uid())));

comment on table public.photo_notes is '사진 ID로 연결하는 제목·본문·태그. source는 데모 글의 출처와 원문을 보존한다.';
