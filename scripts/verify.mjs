// 올린 프로젝트에 데모 계정으로 로그인해서 확인한다.
//  1. my_data() 가 프론트엔드 seed JSON 과 같은지
//  2. 남의 데이터가 안 보이는지, 로그인 없이 막히는지
//  3. 쓰기 함수(save_photos·add_correction·save_post)가 되는지 — empty 계정에 쓰고 지운다
//  4. delete_my_data 가 한 번에 지우고, 지우기 전 판 번호로 저장하는 Journey 를 거절하는지(#12) — empty 계정
// 사용: node --env-file=.env.local scripts/verify.mjs [프론트엔드 저장소 경로]
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key } = process.env;
const seedDir = join(resolve(process.argv[2] ?? '../danyeo-on'), 'src/data/seed');
const PASSWORD = 'demo1234';
const writing = JSON.parse(readFileSync(resolve(import.meta.dirname, '../data/demo-photo-writing.json'), 'utf8'));

async function call(path, { token, method = 'GET', body, headers } = {}) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: key,
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...headers,
    },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function signIn(email) {
  const { status, data } = await call('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password: PASSWORD },
  });
  assert.equal(status, 200, `${email} 로그인 실패: ${JSON.stringify(data)}`);
  return { token: data.access_token, uid: data.user.id };
}

// 시각은 표기가 달라도 같은 순간이면 같다고 본다. ownerId 는 seed 의 u_xxx 대신 uuid 다
const sameInstant = (a, b) => a === b || new Date(a).getTime() === new Date(b).getTime();
function migrateFileKey(fileKey, uid, persona) {
  if (!fileKey?.startsWith('public:/photos/')) return fileKey;
  const fileName = fileKey.slice(fileKey.lastIndexOf('/') + 1);
  return `demo:${uid}/${persona}/${fileName}`;
}
function normalize(seed, uid, persona) {
  const byId = (a, b) => a.id.localeCompare(b.id);
  const photos = seed.photos
    .map(({ ...p }) => ({
      ...p,
      ownerId: uid,
      fileKey: migrateFileKey(p.fileKey, uid, persona),
    }))
    .sort(byId);
  const corrections = seed.corrections.map((c) => ({ ...c, ownerId: uid })).sort(byId);
  const posts = seed.posts.map((p) => ({ ...p, ownerId: uid, tags: [...p.tags].sort() })).sort(byId);
  return { photos, corrections, posts };
}
function compare(actual, expected, path = '') {
  if (typeof expected === 'string' && /^\d{4}-\d{2}-\d{2}T.*[+-]\d{2}:\d{2}$/.test(expected)) {
    assert.ok(sameInstant(actual, expected), `${path}: ${actual} != ${expected}`);
  } else if (expected && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual ?? {}).sort(), Object.keys(expected).sort(), `${path} 키가 달라요`);
    for (const k of Object.keys(expected)) compare(actual[k], expected[k], `${path}.${k}`);
  } else {
    assert.equal(actual, expected, path);
  }
}

let passed = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`, ++passed && '');

for (const persona of ['seojin', 'edge', 'empty']) {
  const seed = JSON.parse(readFileSync(join(seedDir, `${persona}.json`), 'utf8'));
  const { token, uid } = await signIn(seed.user.email);
  const { status, data } = await call('/rest/v1/rpc/my_data', { token, method: 'POST', body: {} });
  assert.equal(status, 200, JSON.stringify(data));

  console.log(`${persona}`);
  compare(
    { id: data.user.id, email: data.user.email, name: data.user.name, provider: data.user.provider },
    { id: uid, email: seed.user.email, name: seed.user.name, provider: 'demo' },
    'user',
  );
  const actual = normalize(data, uid, persona);
  const expected = normalize(seed, uid, persona);
  for (const k of ['photos', 'corrections', 'posts']) {
    assert.equal(actual[k].length, expected[k].length, `${k} 개수`);
    compare(actual[k], expected[k], k);
  }
  ok(`my_data 가 seed 와 같아요 (사진 ${data.photos.length}, 보정 ${data.corrections.length}, 글 ${data.posts.length})`);
  const notes = await call('/rest/v1/photo_notes?select=*', { token });
  assert.equal(notes.status, 200);
  const expectedNotes = writing.notes.filter((n) => n.persona === persona).map((n) => ({
    photo_id: n.photoId, title: n.title, body: n.body, tags: n.tags, source: n.source, updated_at: n.updatedAt,
  }));
  const byPhoto = (a, b) => a.photo_id.localeCompare(b.photo_id);
  compare(notes.data.sort(byPhoto), expectedNotes.sort(byPhoto), 'photo_notes');
  ok(`사진별 글 ${notes.data.length}개가 원문/사진 연결 계획과 같아요`);
}

console.log('권한');
const seojin = await signIn('seojin@demo.local');
const edge = await signIn('edge@demo.local');
const others = await call(`/rest/v1/photos?select=id&owner_id=eq.${edge.uid}`, { token: seojin.token });
assert.equal(others.status, 200);
assert.equal(others.data.length, 0);
ok('seojin 으로 edge 사진을 조회하면 0장이에요');
const edgePhoto = writing.notes.find((n) => n.persona === 'edge').photoId;
const foreignNotes = await call(`/rest/v1/photo_notes?photo_id=eq.${edgePhoto}`, { token: seojin.token });
assert.equal(foreignNotes.status, 200);
assert.deepEqual(foreignNotes.data, []);
const deniedInsert = await call('/rest/v1/photo_notes', { token: seojin.token, method: 'POST',
  body: { photo_id: edgePhoto, title: '권한 검사', body: '저장되면 안 됩니다.' } });
assert.equal(deniedInsert.status, 403);
const deniedUpdate = await call(`/rest/v1/photo_notes?photo_id=eq.${edgePhoto}`, { token: seojin.token, method: 'PATCH', body: { title: '권한 검사' } });
assert.ok([200, 204].includes(deniedUpdate.status));
const edgeNote = await call(`/rest/v1/photo_notes?photo_id=eq.${edgePhoto}`, { token: edge.token });
assert.equal(edgeNote.data[0].title, writing.notes.find((n) => n.photoId === edgePhoto).title);
const anonNotes = await call('/rest/v1/photo_notes?select=photo_id');
assert.ok([401, 403].includes(anonNotes.status));
ok('사진별 글은 다른 계정 조회/추가/수정과 익명 조회가 막혀요');

const anon = await call('/rest/v1/rpc/my_data', { method: 'POST', body: {} });
assert.notEqual(anon.status, 200);
const anonPhotos = await call('/rest/v1/photos?select=id&limit=1');
assert.ok(anonPhotos.status !== 200 || anonPhotos.data.length === 0);
ok(`로그인 없이 my_data 는 ${anon.status}, photos 는 비어 있어요`);

const steal = await call('/rest/v1/rpc/add_correction', {
  token: seojin.token,
  method: 'POST',
  body: { correction: { id: 'c_verify_steal', type: 'exclude', photoId: (await call('/rest/v1/rpc/my_data', { token: edge.token, method: 'POST', body: {} })).data.photos[0].id } },
});
assert.notEqual(steal.status, 200);
ok(`남의 사진을 가리키는 보정은 거절돼요 (${steal.status})`);

console.log('쓰기 (empty 계정)');
const empty = await signIn('empty@demo.local');
const sample = JSON.parse(readFileSync(join(seedDir, 'seojin.json'), 'utf8')).photos.slice(0, 2)
  .map((p, i) => ({ ...p, id: `p_verify${i}`, ownerId: undefined }));
const saved = await call('/rest/v1/rpc/save_photos', { token: empty.token, method: 'POST', body: { photos: sample } });
assert.equal(saved.status, 200, JSON.stringify(saved.data));
assert.deepEqual(saved.data.sort(), ['p_verify0', 'p_verify1']);
const again = await call('/rest/v1/rpc/save_photos', { token: empty.token, method: 'POST', body: { photos: sample } });
assert.deepEqual(again.data, []);
ok('save_photos 로 2장 저장, 같은 사진을 다시 보내면 건너뛰어요');

const add = await call('/rest/v1/rpc/add_correction', {
  token: empty.token,
  method: 'POST',
  body: { correction: { id: 'c_verify_1', type: 'merge', photoIds: ['p_verify1', 'p_verify0'] } },
});
// 저장된 보정의 ID 를 돌려준다. 보통은 보낸 ID 그대로다
assert.equal(add.status, 200, JSON.stringify(add.data));
assert.equal(add.data, 'c_verify_1');
// 집 지정(home)은 사진 한 장을 photoIds 로 가리킨다
const home = await call('/rest/v1/rpc/add_correction', {
  token: empty.token,
  method: 'POST',
  body: { correction: { id: 'c_verify_2', type: 'home', photoIds: ['p_verify0'] } },
});
assert.equal(home.status, 200, JSON.stringify(home.data));
assert.equal(home.data, 'c_verify_2');
const post = { id: 'post_verify_1', date: '2024-03-04', title: '확인용', body: '본문', tags: ['b', 'a'], photoIds: ['p_verify0'] };
assert.equal((await call('/rest/v1/rpc/save_post', { token: empty.token, method: 'POST', body: { post } })).status, 204);
assert.equal((await call('/rest/v1/rpc/save_post', { token: empty.token, method: 'POST', body: { post: { ...post, title: '고친 제목', photoIds: ['p_verify1', 'p_verify0'] } } })).status, 204);
const after = (await call('/rest/v1/rpc/my_data', { token: empty.token, method: 'POST', body: {} })).data;
assert.deepEqual(after.corrections[0].photoIds, ['p_verify1', 'p_verify0']);
const savedHome = after.corrections.find((c) => c.id === 'c_verify_2');
assert.equal(savedHome.type, 'home');
assert.deepEqual(savedHome.photoIds, ['p_verify0']);
assert.equal(after.posts[0].title, '고친 제목');
assert.deepEqual(after.posts[0].tags, ['a', 'b']);
assert.deepEqual(after.posts[0].photoIds, ['p_verify1', 'p_verify0']);
ok('add_correction·save_post 결과가 my_data 에 seed 모양으로 나와요');

// 같은 사진의 exclude 는 하나만 저장되고, 뒤 요청은 있던 보정의 ID 를 받는다
const exclude = (id, photoId) => call('/rest/v1/rpc/add_correction', {
  token: empty.token,
  method: 'POST',
  body: { correction: { id, type: 'exclude', photoId } },
});
const first = await exclude('c_verify_3', 'p_verify0');
const second = await exclude('c_verify_4', 'p_verify0');
assert.equal(first.status, 200, JSON.stringify(first.data));
assert.equal(second.status, 200, JSON.stringify(second.data));
assert.deepEqual([first.data, second.data], ['c_verify_3', 'c_verify_3']);
// 두 탭이 같은 사진을 동시에 빼는 경우
const together = await Promise.all([exclude('c_verify_5', 'p_verify1'), exclude('c_verify_6', 'p_verify1')]);
for (const r of together) assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(together[0].data, together[1].data);
assert.ok(['c_verify_5', 'c_verify_6'].includes(together[0].data));
const excludes = (await call('/rest/v1/rpc/my_data', { token: empty.token, method: 'POST', body: {} })).data
  .corrections.filter((c) => c.type === 'exclude');
assert.deepEqual(
  excludes.map((c) => [c.id, c.photoId]).sort(),
  [['c_verify_3', 'p_verify0'], [together[0].data, 'p_verify1']].sort(),
);
ok('같은 사진을 두 번 빼도(차례로·동시에) exclude 는 하나예요');

// delete_my_data(#12): 위에서 넣은 사진 · 보정 · 글과 Journey 를 한 번에 지운다
const epochOf = async () =>
  (await call('/rest/v1/profiles?select=data_epoch', { token: empty.token })).data[0].data_epoch;
const saveJourney = (dataEpoch) => call('/rest/v1/journeys', {
  token: empty.token,
  method: 'POST',
  headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: { owner_id: empty.uid, payload: { stops: [] }, data_epoch: dataEpoch },
});
const journeysLeft = async () => (await call('/rest/v1/journeys?select=owner_id', { token: empty.token })).data;

const before = await epochOf();
const savedBefore = await saveJourney(before);
assert.equal(savedBefore.status, 201, JSON.stringify(savedBefore.data));
ok(`지금 판 번호(${before})로 Journey 를 저장할 수 있어요`);

const deleted = await call('/rest/v1/rpc/delete_my_data', { token: empty.token, method: 'POST', body: {} });
assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
assert.equal(deleted.data, before + 1);
assert.equal(await epochOf(), before + 1);
const cleared = (await call('/rest/v1/rpc/my_data', { token: empty.token, method: 'POST', body: {} })).data;
assert.equal(cleared.photos.length + cleared.corrections.length + cleared.posts.length, 0);
assert.deepEqual(await journeysLeft(), []);
ok('delete_my_data 로 사진 · 보정 · 글 · Journey 가 모두 지워지고 판 번호가 1 올라요');

const stale = await saveJourney(before);
assert.notEqual(stale.status, 201);
assert.equal(stale.data?.message, 'stale_journey', JSON.stringify(stale.data));
assert.deepEqual(await journeysLeft(), []);
ok(`지우기 전 판 번호로 저장하면 거절돼요 (${stale.status})`);

assert.equal((await saveJourney(before + 1)).status, 201);
assert.equal((await saveJourney(null)).status, 201);
ok('새 판 번호나 판 번호 없이(지금 배포된 프론트엔드)는 저장돼요');

const forbidden = await call(`/rest/v1/profiles?id=eq.${empty.uid}`, {
  token: empty.token,
  method: 'PATCH',
  body: { data_epoch: 0 },
});
assert.notEqual(forbidden.status, 204);
assert.equal(await epochOf(), before + 1);
ok(`판 번호는 사용자가 직접 바꿀 수 없어요 (${forbidden.status})`);

const anonDelete = await call('/rest/v1/rpc/delete_my_data', { method: 'POST', body: {} });
assert.notEqual(anonDelete.status, 200);
ok(`로그인 없이 delete_my_data 는 ${anonDelete.status}`);

assert.equal((await call('/rest/v1/rpc/delete_my_data', { token: empty.token, method: 'POST', body: {} })).status, 200);
assert.deepEqual(await journeysLeft(), []);
ok('지우고 나면 empty 계정이 다시 비어요');

console.log(`\n${passed}개 통과`);
