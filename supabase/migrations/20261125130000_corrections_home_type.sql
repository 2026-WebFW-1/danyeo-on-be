-- 집을 직접 지정하는 보정(home)을 받는다. { type: 'home', photoIds: [사진 ID] } 는 "이 사진을 찍은 곳이 집"이라는 뜻.
-- add_correction·my_data 는 else 분기가 photoIds 를 그대로 저장하고 돌려줘서 고치지 않는다(transit·merge 와 같은 경로)
alter table public.corrections
    drop constraint corrections_type_check,
    add constraint corrections_type_check
        check (type in ('rename', 'exclude', 'transit', 'mode', 'split', 'merge', 'home'));
