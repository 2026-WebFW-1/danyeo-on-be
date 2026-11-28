-- 내 데이터를 한 번에 지우는 함수와, 지운 뒤 옛 Journey 저장을 거절하는 판 번호(#12).
-- 프론트엔드에서 테이블을 차례로 지우면 일부만 지워진 채 남을 수 있어서, 함수 하나(한 트랜잭션)에서 지운다.
-- Journey 는 프론트엔드가 사진을 읽고 20초쯤 계산한 뒤 저장한다. 지우기 전에 사진을 읽은 계산이 지운 뒤에
-- 저장하면 사진 없는 여행이 되살아나서, 계산을 시작할 때 읽은 판 번호가 지금과 다르면 저장을 거절한다.

-- 지울 때마다 1 오른다. 사용자가 직접 고치지 못하게 컬럼 권한은 주지 않는다(profiles 는 name · picture 만 고칠 수 있다)
alter table public.profiles add column data_epoch bigint not null default 0;

-- 이 Journey 를 계산할 때 읽은 판 번호. 보내지 않으면(null) 확인하지 않는다(판 번호를 모르는 프론트엔드)
alter table public.journeys add column data_epoch bigint;

-- 저장하려는 Journey 의 판 번호가 지금과 다르면 거절한다.
-- profiles 행을 for share 로 읽어서, 지우는 중인 delete_my_data 가 끝날 때까지 기다린 뒤 비교한다.
-- 행 잠금은 사용자의 컬럼 권한 · RLS 에 따라 달라지지 않게 definer 로 둔다. 읽는 행은 저장하려는 Journey 의 주인뿐이다
create function public.check_journey_epoch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_epoch bigint;
begin
    if new.data_epoch is null then
        return new;
    end if;

    select p.data_epoch into current_epoch
    from public.profiles p
    where p.id = new.owner_id
    for share;

    if new.data_epoch is distinct from current_epoch then
        raise exception using
            errcode = 'P0001',
            message = 'stale_journey',
            detail = format('data_epoch %s, 지금 %s', new.data_epoch, current_epoch);
    end if;
    return new;
end;
$$;

revoke execute on function public.check_journey_epoch() from public, anon, authenticated;

create trigger check_journey_epoch
    before insert or update on public.journeys
    for each row execute function public.check_journey_epoch();

-- 로그인한 사용자의 글 · 보정 · 사진 · Journey 를 모두 지우고 새 판 번호를 돌려준다.
-- 자식 행(post_photos · post_tags · correction_photos · photo_notes)은 cascade 로 같이 지워진다.
-- photos 버킷의 이미지는 트랜잭션 밖이라 프론트엔드가 이어서 지운다.
-- data_epoch 는 사용자에게 update 권한이 없어서 definer 로 두고, 모든 문장을 auth.uid() 로 거른다
create function public.delete_my_data()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
    uid uuid := (select auth.uid());
    new_epoch bigint;
begin
    if uid is null then
        raise exception using errcode = '42501', message = 'not_authenticated';
    end if;

    -- 판 번호를 먼저 올려 profiles 행을 잠근다. 끝날 때까지 다른 Journey 저장은 트리거에서 기다린다
    update public.profiles
    set data_epoch = data_epoch + 1
    where id = uid
    returning data_epoch into new_epoch;

    delete from public.posts where owner_id = uid;
    delete from public.corrections where owner_id = uid;
    delete from public.photos where owner_id = uid;
    delete from public.journeys where owner_id = uid;

    return new_epoch;
end;
$$;

revoke execute on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;
