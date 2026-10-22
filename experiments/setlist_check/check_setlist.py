"""Prueba en seco del setlist: ¿existe la canción (Last.fm)?, ¿ya la tenemos?, ¿se puede scrapear su hoja?
No escribe nada en el proyecto; deja el resultado en setlist_result.json (scratchpad)."""
import json, re, sys, time, unicodedata, urllib.parse, urllib.request
from pathlib import Path

ACORDES = Path(r"C:\Users\usuario\Desktop\Software development\_WORK_\Acordes")
HERE = Path(__file__).parent
sys.path[:0] = [str(ACORDES), str(ACORDES / 'server'), str(HERE)]
from api import scrape_cifraclub, scrape_lacuerda
from karaoke_songs import candidate_urls
from enricher import LASTFM_API_KEY
from setlist import SETLIST


def fold(s):
    s = unicodedata.normalize('NFD', (s or '').lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    s = re.sub(r'\([^)]*\)', ' ', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    return ' '.join(w for w in s.split() if w not in {'the', 'los', 'las', 'la', 'el'})


def lastfm_search(artist, title):
    q = urllib.parse.urlencode({'method': 'track.search', 'track': title, 'artist': artist,
                                'api_key': LASTFM_API_KEY, 'format': 'json', 'limit': 5})
    req = urllib.request.Request(f'http://ws.audioscrobbler.com/2.0/?{q}', headers={'User-Agent': 'Acordes/1.0'})
    with urllib.request.urlopen(req, timeout=15) as r:
        tracks = json.loads(r.read().decode())['results']['trackmatches']['track']
    # Primero el que calza el artista; Last.fm a veces pone covers arriba
    fits = [t for t in tracks if fold(artist) in fold(t['artist']) or fold(t['artist']) in fold(artist)]
    return (fits or tracks or [None])[0]


def catalog():
    songs = json.loads((ACORDES / 'enriched_songs.json').read_text(encoding='utf-8'))['songs']
    tracks = json.loads((ACORDES / 'client/public/backing_tracks.json').read_text(encoding='utf-8'))['backing_tracks']
    return [{'url': u, 'artist': s.get('artist'), 'title': s.get('title'), 'source': s.get('source'),
             'videos': sorted(tracks.get(u, {}))} for u, s in songs.items()]


def in_catalog(cat, artist, title):
    a, t = fold(artist), fold(title)
    hits = []
    for s in cat:
        sa, st = fold(s['artist']), fold(s['title'])
        if not sa or not st or not (a == sa or a in sa or sa in a):
            continue
        if t == st or st.startswith(t + ' ') or t.startswith(st + ' '):
            hits.append(s)
    return hits


def chords_in(html):
    return len(re.findall(r'class="chord"', html or ''))


def find_sheet(names):
    seen = set()
    for artist, title in names:
        for url, _, _ in candidate_urls(artist, title):
            if url in seen:
                continue
            seen.add(url)
            try:
                res = (scrape_cifraclub if 'cifraclub' in url else scrape_lacuerda)(url)
            except Exception as e:
                res = {'error': str(e)}
            time.sleep(0.3)
            n = chords_in(res.get('content'))
            if 'error' not in res and n >= 4:
                return {'url': url, 'chords': n, 'tried': len(seen)}
    return {'url': None, 'tried': len(seen)}


def main():
    cat = catalog()
    out = []
    for raw, artist, title in SETLIST:
        row = {'raw': raw, 'artist': artist, 'title': title}
        try:
            lf = lastfm_search(artist, title)
        except Exception as e:
            lf, row['lastfm_error'] = None, str(e)
        row['lastfm'] = lf and {'artist': lf['artist'], 'title': lf['name'], 'listeners': int(lf['listeners'])}
        hits = in_catalog(cat, artist, title) or (lf and in_catalog(cat, lf['artist'], lf['name'])) or []
        row['have'] = [{k: h[k] for k in ('url', 'source', 'videos', 'title')} for h in hits]
        if not hits:
            names = [(artist, title)] + ([(lf['artist'], lf['name'])] if lf else [])
            row['sheet'] = find_sheet(names)
        out.append(row)
        mark = 'TENEMOS' if hits else ('NUEVA  ' if row.get('sheet', {}).get('url') else 'NO HOJA')
        lfs = f"{lf['artist']} - {lf['name']} ({int(lf['listeners']):,})" if lf else 'Last.fm: sin resultado'
        print(f"{mark} | {artist} - {title} | {lfs} | {row.get('sheet', {}).get('url') or (hits and hits[0]['url']) or ''}", flush=True)
    (HERE / 'setlist_result.json').write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')


if __name__ == '__main__':
    main()
