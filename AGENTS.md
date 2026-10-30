# 작업 지침

- 코드 리뷰의 제목과 본문, 작업 설명, PR 피드백은 한국어로 작성한다.
- 리뷰는 이번 변경으로 새로 생기거나 악화된 실제 동작 오류와 보안 문제를 대상으로 한다.
- 문제를 지적할 때는 발생 조건, 영향, 코드 근거를 짧고 구체적으로 설명한다.
- 포맷이나 취향 차이는 리뷰에서 제외하고, 실행하지 않은 검증을 통과했다고 쓰지 않는다.

## Supabase

- 스키마는 `supabase/migrations/`의 새 migration으로만 변경하며, 이미 적용된 migration은 수정하지 않는다.
- 노출 스키마의 테이블에는 RLS를 켜고 실제 소유권 조건을 정책에 포함한다.
- `service_role`과 secret key를 프런트엔드나 Git에 넣지 않는다.
- seed 변경 뒤에는 `node scripts/build-seed.mjs`로 `supabase/seed.sql`을 다시 만든다.
- 원격 데이터 검증은 `node --env-file=.env.local scripts/verify.mjs`를 사용한다. 실행하지 못했다면 그 사실을 명시한다.
