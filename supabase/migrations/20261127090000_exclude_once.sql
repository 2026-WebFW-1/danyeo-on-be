-- 같은 사진의 exclude 보정은 한 사람에 하나만 둔다.
-- 두 탭이 같은 사진을 각각 빼면 exclude 가 두 개 저장돼서, 하나를 지워도 사진이 돌아오지 않았다.
-- type 은 corrections 에, 사진은 correction_photos 에 있어 유니크 제약 하나로는 막을 수 없다.
-- 그래서 add_correction 이 사진마다 잠근 뒤 이미 있는지 보고, 있으면 넣지 않고 그 보정의 ID 를 돌려준다.

-- 이미 중복된 exclude 는 먼저 저장된 것만 남긴다. 사진 연결은 cascade 로 같이 지워진다
delete from public.corrections c
using (
    select
        co.id,
        row_number() over (partition by co.owner_id, cp.photo_id order by co.created_at, co.id) as n
    from public.corrections co
    join public.correction_photos cp on cp.correction_id = co.id
    where co.type = 'exclude'
) d
where c.id = d.id and d.n > 1;

-- 돌려주는 타입이 void 에서 varchar 로 바뀌어서 지우고 다시 만든다
drop function public.add_correction(jsonb);

-- 보정 하나를 seed 의 corrections 모양 그대로 저장하고, 저장된 보정의 ID 를 돌려준다.
-- 보통은 보낸 ID 그대로다. 이미 뺀 사진의 exclude 면 넣지 않고 있던 보정의 ID 를 돌려준다
create function public.add_correction(correction jsonb)
returns varchar
language plpgsql
security invoker
set search_path = ''
as $$
declare
    photo_ids jsonb := case correction ->> 'type'
        when 'rename' then jsonb_build_array(correction -> 'anchorPhotoId')
        when 'exclude' then jsonb_build_array(correction -> 'photoId')
        when 'mode' then jsonb_build_array(correction -> 'fromPhotoId')
        when 'split' then jsonb_build_array(correction -> 'beforePhotoId')
        else correction -> 'photoIds'
    end;
    existing_id varchar;
begin
    if jsonb_typeof(photo_ids) is distinct from 'array' or jsonb_array_length(photo_ids) = 0 then
        raise exception '보정이 가리키는 사진이 없어요: %', correction ->> 'id' using errcode = '22023';
    end if;

    if correction ->> 'type' = 'exclude' then
        -- 같은 사진을 빼는 요청이 동시에 와도 하나씩 지나가게 트랜잭션이 끝날 때까지 잠근다.
        -- 뒤 요청은 앞 요청이 커밋된 뒤에 아래 조회를 해서, 앞에서 넣은 보정을 본다
        perform pg_advisory_xact_lock(
            hashtextextended('exclude:' || (select auth.uid())::text || ':' || (correction ->> 'photoId'), 0)
        );

        select co.id into existing_id
        from public.corrections co
        join public.correction_photos cp on cp.correction_id = co.id
        where co.type = 'exclude'
            and co.owner_id = (select auth.uid())
            and cp.photo_id = correction ->> 'photoId'
        order by co.created_at, co.id
        limit 1;

        if existing_id is not null then
            return existing_id;
        end if;
    end if;

    insert into public.corrections (id, type, name, mode)
    values (correction ->> 'id', correction ->> 'type', correction ->> 'name', correction ->> 'mode');

    insert into public.correction_photos (correction_id, photo_id, seq)
    select correction ->> 'id', e.value #>> '{}', e.ordinality - 1
    from jsonb_array_elements(photo_ids) with ordinality e;

    return correction ->> 'id';
end;
$$;

revoke execute on function public.add_correction(jsonb) from public, anon;
grant execute on function public.add_correction(jsonb) to authenticated;
