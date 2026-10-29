-- 프론트엔드가 목 JSON(src/data/seed/<인물>.json)과 같은 모양으로 읽고 쓰게 하는 함수들.
-- 전부 security invoker 라 RLS 가 그대로 걸린다. 여러 테이블을 한 번에 바꾸는 것만 함수로 두고,
-- 지우기는 테이블에 바로 delete 한다(자식 행은 cascade).

-- 로그인한 사용자의 { user, photos, corrections, posts }
create function public.my_data()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
    select jsonb_build_object(
        'user', (
            select jsonb_build_object(
                'id', p.id,
                'email', auth.jwt() ->> 'email',
                'name', p.name,
                'picture', p.picture,
                'provider', p.provider,
                'createdAt', p.created_at
            )
            from public.profiles p
            where p.id = (select auth.uid())
        ),
        'photos', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', ph.id,
                'ownerId', ph.owner_id,
                'fileName', ph.file_name,
                'takenAt', ph.taken_at,
                'offset', ph.utc_offset,
                'timeUncertain', ph.utc_offset is null,
                'lat', ph.lat,
                'lng', ph.lng,
                'camera', case
                    when ph.camera_id is null and num_nonnulls(ph.focal, ph.aperture, ph.shutter, ph.iso) = 0 then null
                    else jsonb_build_object(
                        'make', c.make,
                        'model', c.model,
                        'focal', ph.focal,
                        'aperture', ph.aperture,
                        'shutter', ph.shutter,
                        'iso', ph.iso
                    )
                end,
                'fileKey', ph.file_key,
                'uploadedAt', ph.uploaded_at
            ) order by ph.taken_at nulls last, ph.id)
            from public.photos ph
            left join public.cameras c on c.id = ph.camera_id
            where ph.owner_id = (select auth.uid())
        ), '[]'::jsonb),
        'corrections', coalesce((
            select jsonb_agg(
                jsonb_build_object('id', co.id, 'ownerId', co.owner_id, 'type', co.type, 'createdAt', co.created_at)
                || case co.type
                    when 'rename' then jsonb_build_object('anchorPhotoId', ids.v ->> 0, 'name', co.name)
                    when 'exclude' then jsonb_build_object('photoId', ids.v ->> 0)
                    when 'mode' then jsonb_build_object('fromPhotoId', ids.v ->> 0, 'mode', co.mode)
                    when 'split' then jsonb_build_object('beforePhotoId', ids.v ->> 0)
                    else jsonb_build_object('photoIds', coalesce(ids.v, '[]'::jsonb))
                end
                order by co.created_at, co.id
            )
            from public.corrections co
            cross join lateral (
                select jsonb_agg(cp.photo_id order by cp.seq) as v
                from public.correction_photos cp
                where cp.correction_id = co.id
            ) ids
            where co.owner_id = (select auth.uid())
        ), '[]'::jsonb),
        'posts', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', po.id,
                'ownerId', po.owner_id,
                'date', po.post_date,
                'title', po.title,
                'body', po.body,
                'tags', coalesce((select jsonb_agg(t.tag order by t.tag) from public.post_tags t where t.post_id = po.id), '[]'::jsonb),
                'photoIds', coalesce((select jsonb_agg(pp.photo_id order by pp.seq) from public.post_photos pp where pp.post_id = po.id), '[]'::jsonb),
                'updatedAt', po.updated_at
            ) order by po.post_date, po.id)
            from public.posts po
            where po.owner_id = (select auth.uid())
        ), '[]'::jsonb)
    );
$$;

-- 사진 여러 장을 seed 의 photos 모양 그대로 저장한다. 이미 있는 사진은 건너뛰고, 새로 저장한 ID 만 돌려준다
create function public.save_photos(photos jsonb)
returns setof varchar
language plpgsql
security invoker
set search_path = ''
as $$
begin
    insert into public.cameras (make, model)
    select distinct p -> 'camera' ->> 'make', p -> 'camera' ->> 'model'
    from jsonb_array_elements(photos) p
    where p -> 'camera' ->> 'make' is not null and p -> 'camera' ->> 'model' is not null
    on conflict (make, model) do nothing;

    return query
    insert into public.photos (
        id, camera_id, file_name, taken_at, utc_offset, lat, lng,
        focal, aperture, shutter, iso, file_key, uploaded_at
    )
    select
        p ->> 'id',
        c.id,
        p ->> 'fileName',
        (p ->> 'takenAt')::timestamp,
        p ->> 'offset',
        (p ->> 'lat')::double precision,
        (p ->> 'lng')::double precision,
        (p -> 'camera' ->> 'focal')::double precision,
        (p -> 'camera' ->> 'aperture')::double precision,
        (p -> 'camera' ->> 'shutter')::double precision,
        (p -> 'camera' ->> 'iso')::integer,
        p ->> 'fileKey',
        coalesce((p ->> 'uploadedAt')::timestamptz, now())
    from jsonb_array_elements(photos) p
    left join public.cameras c
        on c.make = p -> 'camera' ->> 'make' and c.model = p -> 'camera' ->> 'model'
    on conflict do nothing
    returning id;
end;
$$;

-- 보정 하나를 seed 의 corrections 모양 그대로 저장한다
create function public.add_correction(correction jsonb)
returns void
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
begin
    if jsonb_typeof(photo_ids) is distinct from 'array' or jsonb_array_length(photo_ids) = 0 then
        raise exception '보정이 가리키는 사진이 없어요: %', correction ->> 'id' using errcode = '22023';
    end if;

    insert into public.corrections (id, type, name, mode)
    values (correction ->> 'id', correction ->> 'type', correction ->> 'name', correction ->> 'mode');

    insert into public.correction_photos (correction_id, photo_id, seq)
    select correction ->> 'id', e.value #>> '{}', e.ordinality - 1
    from jsonb_array_elements(photo_ids) with ordinality e;
end;
$$;

-- 글 하나를 seed 의 posts 모양 그대로 저장한다. 같은 ID 가 있으면 내용·태그·사진을 통째로 바꾼다
create function public.save_post(post jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
    insert into public.posts (id, post_date, title, body)
    values (post ->> 'id', (post ->> 'date')::date, post ->> 'title', coalesce(post ->> 'body', ''))
    on conflict (id) do update
        set post_date = excluded.post_date,
            title = excluded.title,
            body = excluded.body,
            updated_at = now();

    delete from public.post_tags where post_id = post ->> 'id';
    insert into public.post_tags (post_id, tag)
    select distinct post ->> 'id', t.value
    from jsonb_array_elements_text(coalesce(post -> 'tags', '[]'::jsonb)) t;

    delete from public.post_photos where post_id = post ->> 'id';
    insert into public.post_photos (post_id, photo_id, seq)
    select post ->> 'id', e.value #>> '{}', e.ordinality - 1
    from jsonb_array_elements(coalesce(post -> 'photoIds', '[]'::jsonb)) with ordinality e;
end;
$$;

revoke execute on function public.my_data(), public.save_photos(jsonb), public.add_correction(jsonb), public.save_post(jsonb)
    from public, anon;
grant execute on function public.my_data(), public.save_photos(jsonb), public.add_correction(jsonb), public.save_post(jsonb)
    to authenticated;
