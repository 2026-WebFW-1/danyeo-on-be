-- 계정. 이메일·비밀번호는 Supabase Auth(auth.users)가 갖고, 여기엔 화면에 보일 정보만 둔다
create table public.profiles (
    id         uuid         primary key references auth.users (id) on delete cascade,
    name       varchar(100) not null,
    picture    varchar(1000),
    -- local | demo
    provider   varchar(10)  not null default 'local' check (provider in ('local', 'demo')),
    created_at timestamptz  not null default now()
);

alter table public.profiles enable row level security;

create policy "본인 프로필 읽기" on public.profiles
    for select to authenticated using ((select auth.uid()) = id);
create policy "본인 프로필 고치기" on public.profiles
    for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- provider 는 가입자가 바꾸면 안 되므로 이름·사진만 고칠 수 있게 한다
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (name, picture) on public.profiles to authenticated;

-- 가입하면 프로필을 만든다. provider 는 사용자가 못 고치는 app_metadata 에서 읽는다
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id, name, provider, created_at)
    values (
        new.id,
        left(coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1)), 100),
        coalesce(new.raw_app_meta_data ->> 'danyeo_provider', 'local'),
        new.created_at
    );
    return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
