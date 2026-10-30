"""기존 데모 사진 ID/시각/GPS를 유지하며 공개 도시 사진으로 빈 이미지 키를 보완한다.

사용: py -3.14 scripts/prepare-photo-coverage.py
생성물은 임시 폴더에 캐시하고, 최종 연결/저작권 목록만 data/에 남긴다.
"""
import argparse
import concurrent.futures
import hashlib
import html
import io
import json
import math
import re
import tempfile
import time
from pathlib import Path

import requests
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
FRONT = ROOT.parent / 'danyeo-on'
CACHE = Path(tempfile.gettempdir()) / 'danyeo-photo-coverage'
API = 'https://commons.wikimedia.org/w/api.php'
HEADERS = {'User-Agent': 'DanyeoOnPhotoCoverage/1.0 (https://github.com/2026-WebFW-1/danyeo-on)'}
ENGLISH = {'서울': 'Seoul', '부산': 'Busan', '후쿠오카': 'Fukuoka', '이스탄불': 'Istanbul', '방콕': 'Bangkok', '치앙마이': 'Chiang Mai', '싱가포르': 'Singapore', '도쿄': 'Tokyo', '호놀룰루': 'Honolulu', '도하': 'Doha'}
DEMO_IDS = {'seojin': 'd0000000-0000-4000-8000-000000000001', 'edge': 'd0000000-0000-4000-8000-000000000002'}
UNSUITABLE = re.compile(r'\b(toilet|toilets|urinal|bathroom|software|terminal error|screenshot|conference|politician|portrait|protest)\b', re.I)


def get(url, **kwargs):
    for attempt in range(4):
        response = requests.get(url, headers=HEADERS, timeout=35, **kwargs)
        if response.status_code not in (429, 502, 503, 504):
            response.raise_for_status()
            if url == API and response.json().get('error'):
                if attempt == 3:
                    raise RuntimeError(f'Commons API: {response.json()["error"]}')
                time.sleep(2 ** (attempt + 1))
                continue
            return response
        time.sleep(2 ** (attempt + 1))
    response.raise_for_status()


def clean(value):
    return html.unescape(re.sub('<[^>]+>', '', value or '')).strip()


def candidates(city, target):
    path = CACHE / f'{ENGLISH[city].replace(" ", "-")}-sources.json'
    rows = [row for row in json.loads(path.read_text('utf-8')) if not UNSUITABLE.search(row['title'])] if path.exists() else []
    if len(rows) >= target:
        return rows
    rows = []
    for offset in range(0, 800, 50):
        payload = get(API, params={
            'action': 'query', 'format': 'json', 'generator': 'search',
            'gsrsearch': f'{ENGLISH[city]} filetype:bitmap', 'gsrnamespace': 6,
            'gsrlimit': 50, 'gsroffset': offset, 'prop': 'imageinfo',
            'iiprop': 'url|size|mime|extmetadata', 'iiurlwidth': 1280,
            'iiextmetadatafilter': 'LicenseShortName|LicenseUrl|Artist|ImageDescription',
        }).json()
        for page in payload.get('query', {}).get('pages', {}).values():
            info = page.get('imageinfo', [{}])[0]
            meta = info.get('extmetadata', {})
            license_name = meta.get('LicenseShortName', {}).get('value', '')
            author = clean(meta.get('Artist', {}).get('value', ''))
            if UNSUITABLE.search(page['title']):
                continue
            if not (license_name.startswith('CC BY') or license_name in ('CC0', 'CC0 1.0', 'Public domain')):
                continue
            if license_name.startswith('CC BY') and not author:
                continue
            if info.get('mime') != 'image/jpeg' or min(info.get('width', 0), info.get('height', 0)) < 700:
                continue
            if not 0.5 <= info['width'] / info['height'] <= 2.4:
                continue
            if re.search(r'\b(map|flag|logo|diagram|drawing|portrait|painting|postcard|plan|collage|war|military|soldier|protest|18\d\d|19\d\d)\b', page['title'], re.I):
                continue
            rows.append({'title': page['title'], 'city': city, 'sourceUrl': info['descriptionurl'],
                         'downloadUrl': info.get('thumburl', info['url']), 'author': author,
                         'license': license_name, 'licenseUrl': meta.get('LicenseUrl', {}).get('value', '')})
        rows = list({row['sourceUrl']: row for row in rows}.values())
        path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding='utf-8')
        if len(rows) >= target + 20 or 'continue' not in payload:
            break
        time.sleep(0.3)
    return rows


def prepare(source):
    digest = hashlib.sha256(source['sourceUrl'].encode()).hexdigest()[:16]
    paths = {size: CACHE / size / f'commons-{digest}.webp' for size in ('full', 'thumb')}
    if not all(path.exists() for path in paths.values()):
        data = get(source['downloadUrl']).content
        with Image.open(io.BytesIO(data)) as original:
            image = ImageOps.exif_transpose(original).convert('RGB')
            for size, edge in [('full', 2048), ('thumb', 400)]:
                resized = image.copy()
                resized.thumbnail((edge, edge), Image.Resampling.LANCZOS)
                for quality in (82, 74, 66, 58, 48):
                    output = io.BytesIO()
                    resized.save(output, 'WEBP', quality=quality, method=4)
                    if output.tell() <= 500_000:
                        break
                paths[size].write_bytes(output.getvalue())
    return {**source, 'filename': paths['full'].name,
            'fullPath': str(paths['full']), 'thumbPath': str(paths['thumb']),
            'changes': 'Resized and re-encoded as WebP; original EXIF removed. Attached capture time/GPS are synthetic demo metadata.'}


def distance(photo, stop):
    return (photo['lat'] - stop['lat']) ** 2 + (math.cos(math.radians(photo['lat'])) * (photo['lng'] - stop['lng'])) ** 2


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--samples-root', type=Path, help='이미 확보한 travelSamples.json이 있는 프론트 저장소 경로')
    args = parser.parse_args()
    samples_root = args.samples_root.resolve() if args.samples_root else FRONT
    for size in ('full', 'thumb'):
        (CACHE / size).mkdir(parents=True, exist_ok=True)
    sample_file = samples_root / 'src/data/fixtures/travelSamples.json'
    samples = json.loads(sample_file.read_text('utf-8'))['photos'] if sample_file.exists() else []
    manifest_path = ROOT / 'data/demo-photo-coverage.json'
    previous = json.loads(manifest_path.read_text('utf-8')) if manifest_path.exists() else {'assignments': [], 'assets': []}
    previous_rows = {(row['persona'], row['photoId']): row for row in previous['assignments']}
    groups, assignments = {}, []
    for persona in ('seojin', 'edge'):
        seed = json.loads((FRONT / f'src/data/seed/{persona}.json').read_text('utf-8'))
        journey = json.loads((FRONT / f'src/data/fixtures/{persona}.journey.json').read_text('utf-8'))
        stops = [*journey['stops'], journey['home']]
        for photo in seed['photos']:
            if photo['fileKey'] is not None:
                prior = previous_rows.get((persona, photo['id']))
                if prior and photo['fileKey'] in (f'public:/photos/{prior["asset"]}', f'demo:{DEMO_IDS[persona]}/{persona}/{prior["asset"]}'):
                    assignments.append(prior)
                continue
            anchor = photo
            inferred = photo['lat'] is None
            if inferred:
                # GPS 누락은 그대로 보존한다. 같은 날짜의 가장 가까운 시각 사진은 이미지 선택에만 쓴다.
                nearby = [p for p in seed['photos'] if p['lat'] is not None and p['takenAt'] and photo['takenAt'] and p['takenAt'][:10] == photo['takenAt'][:10]]
                if not nearby:
                    print(f'KEEP NULL (no reliable city): {persona}/{photo["id"]}', flush=True)
                    continue
                anchor = min(nearby, key=lambda p: abs(int(p['takenAt'][11:13]) * 60 + int(p['takenAt'][14:16]) - int(photo['takenAt'][11:13]) * 60 - int(photo['takenAt'][14:16])))
            city = min(stops, key=lambda stop: distance(anchor, stop))['city']
            row = {'persona': persona, 'photoId': photo['id'], 'city': city, 'inferredImageCity': inferred}
            groups.setdefault(city, []).append(row)
            assignments.append(row)
    retained = {row['asset'] for row in assignments}
    assets = [prepare(asset) for asset in previous['assets'] if asset['filename'] in retained]
    for city, rows in groups.items():
        pool = []
        for sample in samples:
            if len(pool) >= len(rows):
                break
            if sample['city'] != city:
                continue
            full = samples_root / 'public' / sample['fullUrl'].lstrip('/')
            thumb = samples_root / 'public' / sample['thumbUrl'].lstrip('/')
            if full.exists() and thumb.exists():
                # 공개 시연 자료의 합성 EXIF는 Storage 표시용 파일에서는 제거한다.
                source = {key: sample[key] for key in ('title', 'sourceUrl', 'author', 'license', 'licenseUrl')}
                source.update(city=city, downloadUrl=sample['downloadUrl'])
                digest = hashlib.sha256(source['sourceUrl'].encode()).hexdigest()[:16]
                paths = {}
                for size, local in [('full', full), ('thumb', thumb)]:
                    dest = CACHE / size / f'commons-{digest}.webp'
                    with Image.open(local) as image:
                        image.convert('RGB').save(dest, 'WEBP', quality=82, method=4)
                    paths[f'{size}Path'] = str(dest)
                pool.append({**source, **paths, 'filename': f'commons-{digest}.webp', 'changes': 'Resized to WebP; synthetic source EXIF removed. Capture time/GPS in database are synthetic demo metadata.'})
        missing = max(0, len(rows) - len(pool))
        print(f'{city}: {len(rows)} rows, {len(pool)} existing sources, downloading up to {missing}', flush=True)
        if missing:
            seen = {p['sourceUrl'] for p in pool}
            sources = [s for s in candidates(city, missing + 25) if s['sourceUrl'] not in seen]
            with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
                pending = list(executor.map(safe_prepare, sources[:missing + 20]))
                pool.extend(item for item in pending if item)
        if not pool:
            raise ValueError(f'{city}: 확보한 사진이 없음')
        for index, row in enumerate(rows):
            source = pool[index % len(pool)]
            row['asset'] = source['filename']
        used = {r['asset'] for r in rows}
        assets.extend(p for p in pool if p['filename'] in used)
        print(f'{city}: {len(rows)} linked to {len(used)} images', flush=True)
    assets = list({a['filename']: a for a in assets}.values())
    # 캐시의 절대 경로는 저장소에 넣지 않는다. 적용 스크립트는 filename으로 캐시를 찾는다.
    assets = [{k: v for k, v in asset.items() if k not in ('fullPath', 'thumbPath')} for asset in assets]
    manifest = {'notice': 'Existing photo IDs, synthetic dates/GPS, corrections and posts are preserved. Missing GPS is not filled. Image-city inference applies only to image selection.', 'assignments': assignments, 'assets': assets}
    (ROOT / 'data').mkdir(exist_ok=True)
    (ROOT / 'data/demo-photo-coverage.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'DONE: {len(assignments)} photos, {len(assets)} assets', flush=True)


def safe_prepare(source):
    try:
        return prepare(source)
    except Exception as error:
        print(f'SKIP {source["title"]}: {str(error)[:120]}', flush=True)
        return None


if __name__ == '__main__':
    main()
