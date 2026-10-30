// 기본은 미리보기. --apply일 때만 공개 데모 파일과 비어 있는 사진 키를 보완한다.
// SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY 필요. service_role은 사용하지 않는다.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const front = resolve(root, '../danyeo-on');
const cache = join(tmpdir(), 'danyeo-photo-coverage');
const plan = JSON.parse(await readFile(join(root, 'data/demo-photo-coverage.json'), 'utf8'));
const apply = process.argv.includes('--apply');
const { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key } = process.env;
assert.ok(url && key, 'Supabase 주소와 publishable 키가 필요합니다.');

async function request(path, { token, method = 'GET', body, binary = false, headers = {} } = {}) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: { apikey: key, ...(token && { Authorization: `Bearer ${token}` }),
        ...(body && { 'Content-Type': binary ? 'image/webp' : 'application/json' }), ...headers },
      body: body ? (binary ? body : JSON.stringify(body)) : undefined,
      signal: AbortSignal.timeout(45000),
    });
    const text = await response.text();
    if (response.ok) return text ? JSON.parse(text) : null;
    if (attempt === 3 || ![429, 500, 502, 503, 504].includes(response.status)) {
      throw new Error(`${method} ${path}: ${response.status} ${text.slice(0, 250)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
}

async function workers(items, action) {
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < items.length) await action(items[next++]);
  }));
}

const withoutPhotoKeys = (data) => ({ ...data, photos: data.photos.map(({ fileKey: _, ...photo }) => photo) });
const formatJson = (value, original) => `${JSON.stringify(value, null, 2)}\n`.replaceAll('\n', original.includes('\r\n') ? '\r\n' : '\n');
for (const persona of ['seojin', 'edge']) {
  const seedPath = join(front, `src/data/seed/${persona}.json`);
  const seedText = await readFile(seedPath, 'utf8');
  const seed = JSON.parse(seedText);
  const auth = await request('/auth/v1/token?grant_type=password', {
    method: 'POST', body: { email: seed.user.email, password: 'demo1234' },
  });
  const token = auth.access_token;
  const uid = auth.user.id;
  const before = await request('/rest/v1/rpc/my_data', { token, method: 'POST', body: {} });
  assert.equal(before.user.provider, 'demo');
  const rows = plan.assignments.filter((row) => row.persona === persona);
  const assets = plan.assets.filter((asset) => rows.some((row) => row.asset === asset.filename));
  const originalById = new Map(before.photos.map((photo) => [photo.id, photo]));
  for (const row of rows) {
    assert.ok(originalById.has(row.photoId), `사진 ID를 찾을 수 없습니다: ${row.photoId}`);
    const expected = `demo:${uid}/${persona}/${row.asset}`;
    assert.ok(originalById.get(row.photoId).fileKey === null || originalById.get(row.photoId).fileKey === expected,
      `다른 이미지가 연결되어 있어 덮어쓰지 않습니다: ${row.photoId}`);
  }
  console.log(`${persona}: ${rows.length} links, ${assets.length} images (${apply ? 'apply' : 'preview'})`);
  if (!apply) continue;
  const backup = join(cache, 'backups', `${Date.now()}-${persona}`);
  await mkdir(backup, { recursive: true });
  await writeFile(join(backup, 'my-data.json'), `${JSON.stringify(before, null, 2)}\n`);
  await writeFile(join(backup, 'seed.json'), await readFile(seedPath));
  const remoteJourney = await request('/rest/v1/journeys?select=payload,updated_at', { token });
  await writeFile(join(backup, 'journey.json'), `${JSON.stringify(remoteJourney, null, 2)}\n`);

  let completed = 0;
  await workers(assets, async (asset) => {
    for (const size of ['full', 'thumb']) {
      const buffer = await readFile(join(cache, size, asset.filename));
      assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
      assert.equal(buffer.toString('ascii', 8, 12), 'WEBP');
      await request(`/storage/v1/object/demo-assets/${uid}/${persona}/${size}/${asset.filename}`, {
        token, method: 'POST', body: buffer, binary: true, headers: { 'x-upsert': 'true' },
      });
    }
    completed += 1;
    if (completed % 25 === 0) console.log(`${persona}: uploaded ${completed}/${assets.length}`);
  });
  const credits = { notice: plan.notice, assets: assets.map(({ fullPath: _, thumbPath: __, ...asset }) => asset), assignments: rows };
  await request(`/storage/v1/object/demo-assets/${uid}/${persona}/coverage-credits.json`, {
    token, method: 'POST', body: credits, headers: { 'x-upsert': 'true' },
  });
  await workers(rows, async (row) => {
    const fileKey = `demo:${uid}/${persona}/${row.asset}`;
    await request(`/rest/v1/photos?id=eq.${encodeURIComponent(row.photoId)}&owner_id=eq.${uid}&file_key=is.null`, {
      token, method: 'PATCH', body: { file_key: fileKey },
    });
  });

  const after = await request('/rest/v1/rpc/my_data', { token, method: 'POST', body: {} });
  assert.deepEqual(withoutPhotoKeys(after), withoutPhotoKeys(before), '키 이외의 사진/글/보정/사용자 정보가 바뀌었습니다.');
  const afterById = new Map(after.photos.map((photo) => [photo.id, photo]));
  for (const row of rows) assert.equal(afterById.get(row.photoId).fileKey, `demo:${uid}/${persona}/${row.asset}`);
  // Storage에만 있는 새 이미지는 seed에서도 demo: 키로 가리켜 로컬 404를 막는다.
  for (const row of rows) {
    const photo = seed.photos.find((photo) => photo.id === row.photoId);
    assert.ok(photo);
    const expected = `demo:${uid}/${persona}/${row.asset}`;
    assert.ok(photo.fileKey === null || photo.fileKey === `public:/photos/${row.asset}` || photo.fileKey === expected);
    photo.fileKey = expected;
  }
  await writeFile(seedPath, formatJson(seed, seedText));
  // 기존 여행 묶음은 유지하고, 대표 사진이 비어 있는 지점만 보완한다.
  const journeyPath = join(front, `src/data/fixtures/${persona}.journey.json`);
  const journeyText = await readFile(journeyPath, 'utf8');
  const journey = JSON.parse(journeyText);
  await writeFile(join(backup, 'fixture.json'), await readFile(journeyPath));
  const byId = new Map(seed.photos.map((photo) => [photo.id, photo]));
  for (const stop of journey.stops) {
    const managed = rows.find((row) => stop.coverFileKey === `public:/photos/${row.asset}`);
    if (managed) stop.coverFileKey = `demo:${uid}/${persona}/${managed.asset}`;
    if (!stop.coverFileKey) stop.coverFileKey = stop.photoIds.map((id) => byId.get(id)?.fileKey).find(Boolean) ?? null;
  }
  if (JSON.stringify(journey) !== JSON.stringify(JSON.parse(journeyText))) {
    await writeFile(journeyPath, formatJson(journey, journeyText));
  }
  if (remoteJourney.length) {
    const originalPayload = structuredClone(remoteJourney[0].payload);
    const payload = remoteJourney[0].payload;
    let changed = false;
    for (const stop of payload.stops) {
      if (!stop.coverFileKey) {
        const cover = stop.photoIds.map((id) => afterById.get(id)?.fileKey).find(Boolean);
        if (cover) { stop.coverFileKey = cover; changed = true; }
      }
    }
    if (changed) {
      const updated = await request(`/rest/v1/journeys?owner_id=eq.${uid}&updated_at=eq.${encodeURIComponent(remoteJourney[0].updated_at)}`, {
        token, method: 'PATCH', body: { payload, updated_at: new Date().toISOString() }, headers: { Prefer: 'return=representation' },
      });
      assert.equal(updated.length, 1, 'Journey가 동시에 수정되어 덮어쓰지 않았습니다.');
    }
    const verified = await request('/rest/v1/journeys?select=payload', { token });
    const withoutCovers = (value) => ({ ...value, stops: value.stops.map(({ coverFileKey: _, ...stop }) => stop) });
    assert.deepEqual(withoutCovers(verified[0].payload), withoutCovers(originalPayload), '여행 묶음이 바뀌었습니다.');
  }
  console.log(`${persona}: verified ${after.photos.filter((photo) => photo.fileKey).length}/${after.photos.length} photos; backup ${backup}`);
}
