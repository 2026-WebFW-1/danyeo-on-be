# danyeo-on - Supabase

[danyeo-on](https://github.com/2026-WebFW-1/danyeo-on) 프론트엔드에 계정·사진 메타데이터·보정 기록·글·사진 파일을 제공하는 Supabase 구성입니다. 지점·여행은 저장하지 않고 프론트엔드가 사진으로 계산합니다. 처음엔 Spring Boot 서버로 시작했다가 서버를 직접 운영하지 않으려고 Supabase로 옮겼습니다.

- 대시보드: https://supabase.com/dashboard/project/decjgajlzbqwolhkfkym (조직 `danyeo-on`, 서울 리전)
- 테이블 관계와 설계 이유: [ERD](docs/ERD.md)
- 주소·키·DB 비밀번호는 `.env.local`에 둡니다. git에 올리지 않습니다. 프론트엔드에는 주소와 publishable 키만 있으면 되고, DB 비밀번호는 마이그레이션을 올리는 사람만 필요합니다.

## 프론트엔드가 부르는 함수

- **여러 테이블을 한 번에 바꾸는 것만 함수(RPC)로 둔다.** 전부 seed JSON 모양을 그대로 주고받아서, 프론트엔드 `services/`는 목 JSON 대신 이 함수를 부르면 됩니다. 지우기는 테이블에 바로 `delete`합니다.

  | 함수                        | 하는 일                                                   |
  | --------------------------- | --------------------------------------------------------- |
  | `my_data()`                 | `{ user, photos, corrections, posts }`를 seed 모양으로    |
  | `save_photos(photos)`       | 여러 장 저장. 이미 있는 사진은 건너뛰고 새로 저장한 ID만 |
  | `add_correction(correction)`| 보정 하나 저장                                            |
  | `save_post(post)`           | 글 저장. 같은 ID면 태그·사진까지 통째로 바꿈              |

- **사진 파일은 비공개 버킷 `photos`.** 경로는 `<uuid>/full/<사진 ID>.webp`, `<uuid>/thumb/<사진 ID>.webp`이고 본인 폴더만 읽고 쓸 수 있어 화면에는 서명 URL로 띄웁니다. 데모 사진은 지금처럼 프론트엔드 `public/`에 있습니다(`fileKey`가 `public:`).

## 데모 계정

`seojin@demo.local`, `edge@demo.local`, `empty@demo.local` / 비밀번호 `demo1234`. seed JSON과 같은 데이터가 들어 있습니다.

## 바꾸고 올리기

Supabase CLI는 설치 없이 `npx supabase`로 씁니다.

```bash
npx supabase login
npx supabase link --project-ref decjgajlzbqwolhkfkym   # DB 비밀번호는 .env.local
npx supabase migration new <설명>                      # supabase/migrations/ 에 새 SQL
npx supabase db push --linked
```

- 스키마는 마이그레이션으로만 바꿉니다. 이미 올린 마이그레이션 파일은 고치지 않습니다.
- 로컬 Supabase(Docker)는 쓰지 않아서 `--linked`를 꼭 붙입니다. `db diff`와 VS Code Supabase 확장의 Connect는 Docker로 띄운 로컬 DB가 있어야 동작합니다.
- `supabase/seed.sql`은 `node scripts/build-seed.mjs`로 프론트엔드의 `src/data/seed/*.json`에서 만듭니다. 빈 DB에 한 번 넣는 용도라 두 번 넣으면 ID가 겹쳐 실패합니다.
- `node --env-file=.env.local scripts/verify.mjs`: 데모 계정으로 로그인해 `my_data()`가 seed JSON과 같은지, 남의 데이터가 막히는지, 쓰기 함수가 되는지 확인합니다. `empty` 계정에 쓰고 지웁니다.
