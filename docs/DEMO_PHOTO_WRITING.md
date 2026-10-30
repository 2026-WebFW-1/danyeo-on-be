# 데모 사진별 글

`photo_notes`에 서진 333개·하람 263개의 제목, 본문, 태그를 넣었다. 이미지가 없는 하람 사진 2개는 장면을 만들지 않고 미연결 안내만 둔다. 글은 직접 작성한 합성 데모이며 실제 사진 촬영자의 일기가 아니다. 추가 수집한 일상 사진에는 짧은 산책 메모를 사용하므로 일부 문구는 반복된다.

기존 `posts` 16개는 ID·제목·날짜·태그·사진 연결을 유지하고 빈 본문만 채웠다. Chapter에 속하지만 글이 없던 사진은 촬영일에 맞춰 7개(밴쿠버 1, 런던 4, 파리 2)를 추가했다. 현재 날짜별 글은 서진 14개, 하람 9개다. 사진 메타데이터·보정·Journey는 그대로다.

## 02 시안 원문

`my-journey/mock/db.json`의 글 27개를 `data/demo-photo-writing.json`의 `sourcePosts`에 보존했다. 기존 이미지 이름(`vancouver-3.jpg` ↔ `vancouver-3.webp`)으로 연결되며 같은 이미지를 쓴 글이 여러 개면 모두 남긴다. 매칭된 사진 92개에는 `photo_notes.source.editorial`에도 원문이 들어 있다.

- `title`, `body`, `tags`: 현재 데모에서 표시할 글. 기존 문장을 사용할 수 있는 경우 원문을 유지했다.
- `source.kind`: `prototype`(원문 사용), `adapted-prototype`(날짜·계절에 맞게 조정), `edited-demo`/`authored-demo`(직접 작성), `missing-image`.
- `source.editorial[]`: 원래 `title`, `sub`, `heading`, `big`, `body`(문단 배열), `story`(줄바꿈 메모), `tags`, `date`, `photos`, 출처 ID. 원문 날짜는 현재 사진 날짜와 다를 수 있다.

원본 시안의 밴프 설경·겨울 런던·크리스마스 파리를 현재 여름/9월 사진에 그대로 표시하지 않는다. 밴쿠버 마지막 날의 “다음은 토론토”도 현재 다음 여행인 밴프와 달라 표시 본문에서 제외하고 원문에만 보존했다. 시안에만 있는 제주 글은 현재 데모에 제주 여행을 새로 만들지 않고 재료 파일에 보존한다.

## 프론트에서 조회

사진 글은 날짜별 `posts`와 별개다. 기존 `my_data()`와 `save_post()`의 계약은 유지했다. RLS는 부모 사진의 소유자를 확인하며 익명 접근은 차단한다.

```js
// 로그인한 supabase 클라이언트. 전체 목록보다 필요한 사진 ID들을 묶어서 요청한다.
const { data, error } = await supabase
  .from('photo_notes')
  .select('photo_id,title,body,tags')
  .in('photo_id', photoIds);
if (error) throw error;
const notesById = new Map(data.map((note) => [note.photo_id, note]));
```

02의 부제·메모까지 필요한 경우에만 `source`를 함께 조회한다. 이 PR은 데이터 준비 범위이며 화면/훅 연결은 포함하지 않는다. 사진 파일 이름이나 `file_key`를 글 제목으로 바꾸지 않는다. 조회 대상 사진이 없으면 요청을 생략한다.

## 재현과 적용

두 저장소의 사진 연결 보완(FE #95, BE #4)을 먼저 반영해야 한다. 빈 DB에는 새 migration까지 적용한 뒤 `supabase/seed.sql`을 넣는다. 운영 중인 DB에 seed 전체를 다시 넣지 않는다.

```bash
# 재료 수정 또는 원본 시안 재수집. FE/원본 경로는 선택 인자
node scripts/build-photo-writing.mjs ../danyeo-on ../my-journey/mock/db.json

# 새 migration 적용 후, 기본은 미리보기
node --env-file=.env.local scripts/apply-photo-writing.mjs
node --env-file=.env.local scripts/apply-photo-writing.mjs --apply
node scripts/build-seed.mjs
node --env-file=.env.local scripts/verify.mjs
```

환경변수는 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`만 쓴다. demo 계정으로 로그인하며 service role은 필요 없다. `--front=<경로>`로 적용할 FE 저장소를 지정할 수 있다. 모든 계정의 충돌을 먼저 검사하고 변경 전 데이터를 OS 임시 폴더 `danyeo-photo-writing/backup-*`에 백업한다. 기존 사진 글 또는 날짜별 본문이 달라져 있으면 덮어쓰지 않고 중단한다. 중간 실패 후에는 같은 계획으로 재실행할 수 있다. 성공한 계정의 로컬 seed도 원격 결과에 맞춘다.

이 스크립트는 최초 채우기용이다. 글을 다시 편집하려면 사용자 변경과 충돌을 확인하고 별도 변경 계획을 만든다. 날짜별 글을 596개로 늘리지 않는다.
