// 데모용 글. 사진의 실제 EXIF/사실을 추론한 기록이 아니다.
// 원문은 별도 보존하고 현재 데모의 날짜와 맞는 글만 표시용으로 사용한다.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const front = resolve(process.argv[2] ?? '../danyeo-on');
const prototype = resolve(process.argv[3] ?? '../my-journey/mock/db.json');
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const coverage = read(join(root, 'data/demo-photo-coverage.json'));
const sourcePosts = read(prototype).journeys.flatMap((j) => j.posts.map((p) => ({
  journeyId: j.id, id: p.id, stopId: p.stopId, date: p.date,
  title: p.title, sub: p.sub, heading: p.heading, big: p.big,
  body: p.body, story: p.story, photos: p.photos, tags: p.tags,
})));
const edits = read(join(root, 'data/photo-writing-editorial.json'));
const notes = [];
const postBodies = [];
const addedPosts = [];
const stamp = '2026-10-31T12:00:00+09:00';
const cityNames = { gangneung: '강릉', busan: '부산', gyeongju: '경주', jeonju: '전주', yeosu: '여수', suncheon: '순천', sokcho: '속초', tokyo: '도쿄', bangkok: '방콕', danang: '다낭', vancouver: '밴쿠버', banff: '밴프', toronto: '토론토', newyork: '뉴욕', osaka: '오사카', paris: '파리', london: '런던', barcelona: '바르셀로나', istanbul: '이스탄불', sydney: '시드니', sapporo: '삿포로', kyoto: '교토', fukuoka: '후쿠오카' };
const credits = Object.values(read(join(front, 'public/photos/credits.json'))).flat();
const assets = new Map([...coverage.assets.map((a) => [a.filename, a]), ...credits.map((a) => [basename(a.file), a])]);
const assignments = new Map(coverage.assignments.map((a) => [a.photoId, a]));

for (const persona of ['seojin', 'edge']) {
  const seed = read(join(front, `src/data/seed/${persona}.json`));
  const journey = read(join(front, `src/data/fixtures/${persona}.journey.json`));
  for (const p of seed.photos) {
    const file = p.fileKey ? basename(p.fileKey) : null;
    const asset = assets.get(file);
    const assignment = assignments.get(p.id);
    const city = assignment?.city ?? cityNames[file?.split('-')[0]] ?? '여행';
    const originals = sourcePosts.filter((s) => s.photos.some((f) => basename(f, '.jpg') === basename(file ?? '', '.webp')));
    const override = edits.photos[file];
    const rule = edits.sceneRules.find((r) => new RegExp(r.pattern, 'i').test(asset?.title ?? ''));
    let title, body, tags, kind;
    if (!file) {
      title = '아직 연결하지 못한 사진';
      body = '사진 파일은 아직 연결하지 못했다. 촬영 정보만 먼저 남겨 둔다.';
      tags = ['사진미연결']; kind = 'missing-image';
    } else if (override) {
      ({ title, body, tags = [city] } = override); kind = 'edited-demo';
      if (override.sourcePostId) {
        const original = sourcePosts.find((s) => s.id === override.sourcePostId);
        assert.ok(original && originals.includes(original), `원문 사진 연결: ${file}`);
        body = override.paragraphs ? override.paragraphs.map((i) => original.body[i]).join('\n\n') : original.body.join('\n\n');
        if (override.includeStory) body += `\n\n${original.story}`;
        kind = 'prototype';
      }
    } else if (rule) {
      title = rule.title.replaceAll('{city}', city);
      body = rule.body.replaceAll('{city}', city);
      tags = [city, ...rule.tags]; kind = 'authored-demo';
    } else {
      const index = parseInt(p.id.slice(-4), 16) % edits.walkNotes.length;
      const walk = edits.walkNotes[index];
      title = walk.title.replaceAll('{city}', city);
      body = walk.body.replaceAll('{city}', city);
      tags = [city, '산책']; kind = 'authored-demo';
    }
    // 여름 런던/9월 파리에 겨울 시안의 해 지는 시간·크리스마스를 붙이지 않는다.
    const seasonal = edits.personaOverrides[`${persona}/${file}`];
    if (seasonal) { ({ title, body, tags } = seasonal); kind = 'adapted-prototype'; }
    assert.ok(title && body && body.length <= 10000 && title.length <= 200, p.id);
    notes.push({ persona, photoId: p.id, title, body, tags, updatedAt: stamp,
      source: { kind, asset: file, assetTitle: asset?.title ?? null,
        sourcePostIds: originals.map((s) => `${s.journeyId}/${s.id}`),
        editorial: originals, notice: '합성 데모용 글. 원문 날짜는 현재 사진의 촬영일과 다를 수 있다.' } });
  }
  for (const p of seed.posts.filter((p) => Object.hasOwn(edits.postBodies, p.id))) {
    const body = edits.postBodies[p.id];
    assert.ok(body, `기존 글 본문이 없습니다: ${p.id}`);
    postBodies.push({ persona, id: p.id, body, updatedAt: stamp });
  }
  // 현재 Chapter 사진에 연결된 날짜별 글이 없으면 보충한다. 기존 글 연결은 건드리지 않는다.
  const chapters = journey.stops.filter((s) => s.chapter && !s.transit);
  for (const stop of chapters) {
    for (const photoId of stop.photoIds) {
      const photo = seed.photos.find((p) => p.id === photoId);
      assert.ok(photo);
      if (seed.posts.some((p) => !p.id.startsWith(`post_${persona}_chapter_`) && p.photoIds.includes(photoId))) continue;
      const note = notes.find((n) => n.photoId === photoId && n.persona === persona);
      addedPosts.push({ persona, id: `post_${persona}_chapter_${photoId.slice(2)}`, ownerId: seed.user.id,
        date: photo.takenAt.slice(0, 10), title: note.title, body: note.body,
        tags: note.tags, photoIds: [photoId], updatedAt: stamp });
    }
  }
}
assert.equal(notes.length, 596);
assert.equal(postBodies.length, Object.keys(edits.postBodies).length, '기존 글 ID가 seed에서 누락됐습니다.');
assert.equal(new Set(notes.map((n) => n.photoId)).size, notes.length);
const output = { notice: '직접 작성한 합성 데모 글. sourcePosts와 notes.source.editorial은 Chapter 02 시안 원문을 보존한다. 원문 날짜·계절은 표시용 데모 글과 구별한다.', sourcePosts, notes, postBodies, addedPosts };
writeFileSync(join(root, 'data/demo-photo-writing.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(`사진 글 ${notes.length}, 기존 글 본문 ${postBodies.length}, Chapter 보충 글 ${addedPosts.length}, 시안 원문 ${sourcePosts.length}`);
