// 프론트엔드 저장소의 src/data/seed/<인물>.json 으로 supabase/seed.sql 을 만든다.
// 사용: node scripts/build-seed.mjs [프론트엔드 저장소 경로]  (기본 ../danyeo-on)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const frontRoot = resolve(process.argv[2] ?? '../danyeo-on');
const seedDir = join(frontRoot, 'src/data/seed');
const outFile = resolve('supabase/seed.sql');

// 데모 계정은 uuid 를 고정해 두어야 시드를 다시 넣어도 같은 사람이 된다
const PERSONAS = [
  { key: 'seojin', uuid: 'd0000000-0000-4000-8000-000000000001' },
  { key: 'edge', uuid: 'd0000000-0000-4000-8000-000000000002' },
  { key: 'empty', uuid: 'd0000000-0000-4000-8000-000000000003' },
];
const DEMO_PASSWORD = 'demo1234';

const lit = (v) => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return `'${String(v).replaceAll("'", "''")}'`;
};
const json = (v) => `${lit(JSON.stringify(v))}::jsonb`;
const values = (rows) => rows.map((r) => `  (${r.map(lit).join(', ')})`).join(',\n');

const out = [
  '-- scripts/build-seed.mjs 가 만든 파일이다. 손으로 고치지 말고 스크립트를 다시 돌린다.',
  `-- 데모 계정 비밀번호는 전부 ${DEMO_PASSWORD}`,
  '',
];

for (const { key, uuid } of PERSONAS) {
  const seed = JSON.parse(readFileSync(join(seedDir, `${key}.json`), 'utf8'));
  const { user, photos, corrections, posts } = seed;
  out.push(`-- ${key}: 사진 ${photos.length}장, 보정 ${corrections.length}개, 글 ${posts.length}개`);

  // 프로필은 auth.users 트리거가 만든다
  out.push(`insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000', ${lit(uuid)}, 'authenticated', 'authenticated',
  ${lit(user.email)}, extensions.crypt(${lit(DEMO_PASSWORD)}, extensions.gen_salt('bf')), now(),
  ${json({ provider: 'email', providers: ['email'], danyeo_provider: 'demo' })},
  ${json({ name: user.name })},
  ${lit(user.createdAt)}, ${lit(user.createdAt)}, '', '', '', ''
);
insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
values (
  ${lit(uuid)}, ${lit(uuid)}, ${lit(uuid)}, 'email',
  ${json({ sub: uuid, email: user.email, email_verified: true })},
  now(), ${lit(user.createdAt)}, ${lit(user.createdAt)}
);`);

  const cams = [...new Map(photos.filter((p) => p.camera).map((p) => [`${p.camera.make}\u0000${p.camera.model}`, p.camera])).values()];
  if (cams.length) {
    out.push(`insert into public.cameras (make, model) values\n${values(cams.map((c) => [c.make, c.model]))}\non conflict (make, model) do nothing;`);
  }

  if (photos.length) {
    const rows = photos.map((p) => `  (${[
      lit(p.id), lit(uuid),
      p.camera ? `(select id from public.cameras where make = ${lit(p.camera.make)} and model = ${lit(p.camera.model)})` : 'null',
      lit(p.fileName), lit(p.takenAt), lit(p.offset), lit(p.lat), lit(p.lng),
      lit(p.camera?.focal), lit(p.camera?.aperture), lit(p.camera?.shutter), lit(p.camera?.iso),
      lit(p.fileKey), lit(p.uploadedAt),
    ].join(', ')})`);
    out.push(`insert into public.photos (id, owner_id, camera_id, file_name, taken_at, utc_offset, lat, lng, focal, aperture, shutter, iso, file_key, uploaded_at) values\n${rows.join(',\n')};`);
  }

  const photoIdsOf = (c) => ({
    rename: [c.anchorPhotoId],
    exclude: [c.photoId],
    mode: [c.fromPhotoId],
    split: [c.beforePhotoId],
  })[c.type] ?? c.photoIds;

  if (corrections.length) {
    out.push(`insert into public.corrections (id, owner_id, type, name, mode, created_at) values\n${values(corrections.map((c) => [c.id, uuid, c.type, c.name, c.mode, c.createdAt]))};`);
    const links = corrections.flatMap((c) => photoIdsOf(c).map((pid, seq) => [c.id, pid, seq]));
    out.push(`insert into public.correction_photos (correction_id, photo_id, seq) values\n${values(links)};`);
  }

  if (posts.length) {
    out.push(`insert into public.posts (id, owner_id, post_date, title, body, updated_at) values\n${values(posts.map((p) => [p.id, uuid, p.date, p.title, p.body ?? '', p.updatedAt]))};`);
    const photoLinks = posts.flatMap((p) => p.photoIds.map((pid, seq) => [p.id, pid, seq]));
    if (photoLinks.length) out.push(`insert into public.post_photos (post_id, photo_id, seq) values\n${values(photoLinks)};`);
    const tags = posts.flatMap((p) => [...new Set(p.tags)].map((t) => [p.id, t]));
    if (tags.length) out.push(`insert into public.post_tags (post_id, tag) values\n${values(tags)};`);
  }
  out.push('');
}

writeFileSync(outFile, out.join('\n\n'));
console.log(`${outFile} 를 만들었어요.`);
