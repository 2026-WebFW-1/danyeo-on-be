# 데모 이미지 연결 보완

`photos.file_name`은 원본 이름이고 `file_key`는 실제 표시 이미지의 공통 키다.
기존 seed의 빈 키를 도시별 공개 사진으로 보완한다. 사진 ID·가상 촬영 시각·좌표·카메라 정보·보정·글·여행 묶음은 유지한다.
표시 사진의 실제 촬영 정보와 seed 메타데이터는 일치하지 않는 합성 데모다.

## 준비

Python의 `requests`, `Pillow`와 Node가 필요하다.

```powershell
py -3.14 scripts/prepare-photo-coverage.py
# 기존 공개 여행 사진을 재사용하려면:
py -3.14 scripts/prepare-photo-coverage.py --samples-root <프론트-저장소-경로>
```

- Wikimedia Commons에서 해당 도시의 JPEG 사진을 찾고 CC BY·CC BY-SA·CC0·Public domain 자료만 고른다.
- 원저작자·원본 페이지·라이선스·변경 내용을 `data/demo-photo-coverage.json`에 기록한다.
- WebP `full`(긴 변 최대 2048px)과 `thumb`(최대 400px)을 만든다. EXIF는 제거한다.
- 생성된 파일은 OS 임시 폴더 `danyeo-photo-coverage/{full,thumb}`에 캐시한다.
- 기존 키는 유지한다. 위치 없는 사진은 같은 날짜의 가장 가까운 촬영 시각을 이미지 선택에만 참고하고, 근거가 없으면 null로 남긴다. GPS를 채우거나 여행 묶음을 바꾸지 않는다.
- 이미지가 부족하면 같은 도시 내에서 재사용할 수 있다. 실제 연결과 중복 여부는 manifest에서 확인한다.

## 적용

프로젝트 주소와 publishable 키는 환경변수 또는 git에서 제외된 `.env.local`로 제공한다.
기본 실행은 미리보기이며, `--apply`가 있어야 원격 파일과 데이터를 변경한다.

```powershell
node --env-file=.env.local scripts/apply-photo-coverage.mjs
node --env-file=.env.local scripts/apply-photo-coverage.mjs --apply
node scripts/build-seed.mjs
node --env-file=.env.local scripts/verify.mjs
```

- 데모 계정으로 로그인해 각 계정의 RLS·Storage 정책 안에서 작업한다.
- 파일을 먼저 업로드한 뒤 `file_key is null`인 기존 사진만 연결한다. 재실행 시 이미 같은 키면 허용하고 다른 키면 중단한다.
- `demo-assets/<uuid>/<persona>/{full,thumb}/commons-<해시>.webp`로 저장한다.
- 계정별 `coverage-credits.json`에 저작권과 사진 ID 연결 목록을 함께 업로드한다. 기존 `credits.json`은 유지한다.
- 적용 전 `my_data`, Journey, seed, fixture를 OS 임시 폴더의 `danyeo-photo-coverage/backups`에 백업한다.
- 적용 후 사진 키를 제외한 사용자·사진·보정·글이 같은지 확인한다. Journey는 비어 있던 대표 사진 키만 보완하고 묶음이 그대로인지 확인한다.
- 새 이미지의 프론트 seed 키는 `demo:<uuid>/<persona>/<filename>`이다. 기존 로컬 `public:` 키는 유지하고 `build-seed.mjs`가 Supabase의 `demo:` 형식으로 변환한다. FE의 `usePhoto`는 두 형식을 모두 지원해야 한다. 재생성한 seed SQL은 신규 DB용이며 운영 DB에 다시 전체 실행하지 않는다.

라이선스의 출처·저작자·라이선스 표시는 이미지를 재배포하는 화면/산출물에도 제공해야 한다. 이미지별 ShareAlike 조건은 해당 이미지에 유지한다.
