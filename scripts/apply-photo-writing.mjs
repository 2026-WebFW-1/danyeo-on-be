// 기본 미리보기. --apply: 공개 데모 계정의 빈 글만 채우고 사진별 글을 추가한다.
// 재실행해도 사용자가 수정한 글은 덮어쓰지 않는다. 충돌하면 쓰기 전에 중단한다.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const front = resolve(process.argv.find((arg) => arg.startsWith('--front='))?.slice(8) ?? '../danyeo-on');
const plan = JSON.parse(await readFile(join(root, 'data/demo-photo-writing.json'), 'utf8'));
const { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key } = process.env;
const apply = process.argv.includes('--apply');
assert.ok(url && key, 'Supabase 환경변수가 필요합니다.');
async function request(path, { token, method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${url}${path}`, { method, headers: {
    apikey: key, 'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }), ...headers,
  }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(45000) });
  const text = await res.text();
  assert.ok(res.ok, `${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
const noteRow = (n) => ({ photo_id: n.photoId, title: n.title, body: n.body, tags: n.tags, source: n.source, updated_at: n.updatedAt });
const content = ({ updated_at: _, ...n }) => n;
const stablePost = ({ body: _, updatedAt: __, ...p }) => p;
const postContent = (p) => ({ ...p, tags: [...p.tags].sort() });
const runs = [];
// 양쪽 계정 모두 검사한 다음 쓰기를 시작한다.
for (const persona of ['seojin', 'edge']) {
  const seedPath = join(front, `src/data/seed/${persona}.json`);
  const seedText = await readFile(seedPath, 'utf8');
  const seed = JSON.parse(seedText);
  const auth = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: seed.user.email, password: 'demo1234' } });
  const token = auth.access_token;
  const before = await request('/rest/v1/rpc/my_data', { token, method: 'POST', body: {} });
  assert.equal(before.user.provider, 'demo');
  const journey = await request('/rest/v1/journeys?select=payload,updated_at', { token });
  const existingNotes = await request('/rest/v1/photo_notes?select=*', { token });
  const notes = plan.notes.filter((n) => n.persona === persona).map(noteRow);
  assert.deepEqual(notes.map((n) => n.photo_id).sort(), before.photos.map((p) => p.id).sort());
  for (const n of existingNotes) {
    assert.deepEqual(content(n), content(notes.find((p) => p.photo_id === n.photo_id)), `수정된 사진 글을 덮어쓰지 않습니다: ${n.photo_id}`);
  }
  const bodies = plan.postBodies.filter((p) => p.persona === persona);
  for (const p of bodies) {
    const existing = before.posts.find((e) => e.id === p.id);
    assert.ok(existing && (existing.body === '' || existing.body === p.body), `수정된 글을 덮어쓰지 않습니다: ${p.id}`);
    const local = seed.posts.find((e) => e.id === p.id);
    assert.ok(local && (local.body === '' || local.body === p.body), `수정된 로컬 글: ${p.id}`);
    assert.deepEqual({ ...stablePost(existing), ownerId: local.ownerId }, stablePost(local), `기존 글 구조가 다릅니다: ${p.id}`);
  }
  const additions = plan.addedPosts.filter((p) => p.persona === persona).map(({ persona: _, ...p }) => p);
  for (const p of additions) {
    const existing = before.posts.find((e) => e.id === p.id);
    if (existing) {
      assert.deepEqual(postContent({ ...existing, ownerId: p.ownerId, updatedAt: p.updatedAt }), postContent(p), `보충 글 충돌: ${p.id}`);
    }
  }
  console.log(`${persona}: 사진 글 ${notes.length}, 빈 본문 ${bodies.filter((p) => before.posts.find((e) => e.id === p.id).body === '').length}, 보충 글 ${additions.filter((p) => !before.posts.some((e) => e.id === p.id)).length} (${apply ? 'apply' : 'preview'})`);
  runs.push({ persona, token, before, journey, existingNotes, notes, bodies, additions, seed, seedPath, seedText });
}
if (!apply) process.exit(0);
const backup = join(tmpdir(), 'danyeo-photo-writing', `backup-${Date.now()}`);
await mkdir(backup, { recursive: true });
for (const run of runs) {
  const { persona, token, before, journey, existingNotes, notes, bodies, additions, seed, seedPath, seedText } = run;
  await writeFile(join(backup, `${persona}.json`), JSON.stringify({ data: before, journey, notes: existingNotes, seed }, null, 2));
  const missing = notes.filter((n) => !existingNotes.some((e) => e.photo_id === n.photo_id));
  for (let i = 0; i < missing.length; i += 50) {
    await request('/rest/v1/photo_notes?on_conflict=photo_id', { token, method: 'POST', body: missing.slice(i, i + 50), headers: { Prefer: 'resolution=ignore-duplicates' } });
  }
  for (const p of bodies) {
    await request(`/rest/v1/posts?id=eq.${p.id}&body=eq.`, { token, method: 'PATCH', body: { body: p.body, updated_at: p.updatedAt } });
  }
  for (const p of additions.filter((p) => !before.posts.some((e) => e.id === p.id))) {
    await request('/rest/v1/rpc/save_post', { token, method: 'POST', body: { post: p } });
  }
  const after = await request('/rest/v1/rpc/my_data', { token, method: 'POST', body: {} });
  const afterNotes = await request('/rest/v1/photo_notes?select=*', { token });
  const sort = (a, b) => a.photo_id.localeCompare(b.photo_id);
  assert.deepEqual(afterNotes.map(content).sort(sort), notes.map(content).sort(sort));
  for (const name of ['user', 'photos', 'corrections']) assert.deepEqual(after[name], before[name], `${name} 변경`);
  assert.deepEqual(await request('/rest/v1/journeys?select=payload,updated_at', { token }), journey, '여행 데이터 변경');
  assert.equal(after.posts.length, before.posts.length + additions.filter((p) => !before.posts.some((e) => e.id === p.id)).length);
  for (const p of before.posts) assert.deepEqual(stablePost(after.posts.find((e) => e.id === p.id)), stablePost(p));
  for (const p of bodies) assert.equal(after.posts.find((e) => e.id === p.id).body, p.body);
  for (const p of additions) {
    const actual = after.posts.find((e) => e.id === p.id);
    assert.deepEqual(postContent({ ...actual, ownerId: p.ownerId, updatedAt: p.updatedAt }), postContent(p));
  }
  for (const p of bodies) Object.assign(seed.posts.find((e) => e.id === p.id), { body: p.body, updatedAt: p.updatedAt });
  for (const p of additions) {
    const updatedAt = after.posts.find((e) => e.id === p.id).updatedAt;
    const local = seed.posts.find((e) => e.id === p.id);
    if (local) Object.assign(local, { updatedAt });
    else seed.posts.push({ ...p, updatedAt });
  }
  await writeFile(seedPath, `${JSON.stringify(seed, null, 2)}\n`.replaceAll('\n', seedText.includes('\r\n') ? '\r\n' : '\n'));
  console.log(`${persona}: 원격 글/사진/여행 검증 및 로컬 seed 반영 완료`);
}
console.log(`백업: ${backup}`);
