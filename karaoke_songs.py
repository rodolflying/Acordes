"""
karaoke_songs.py — Suma al repertorio las canciones que tienen karaoke subido (proyecto
Karaokes) pero no un marcador de acordes.

Cifra Club y LaCuerda arman sus URLs con el artista y el título, así que se prueba la URL
esperada (con algunas variantes del nombre) y se queda la que de verdad trae acordes. Las
encontradas se agregan a songs.json en una carpeta "Karaokes" (los marcadores de Chrome no se
tocan) y sus acordes van directo a la precarga.

Lo buscado se guarda en karaoke_songs.json (encontradas y no encontradas) para no repetirlo.

Uso:
    python karaoke_songs.py            # después de extract_bookmarks.py
    python karaoke_songs.py --retry    # vuelve a buscar las que no se encontraron
"""

import json
import re
import sys
import time
import unicodedata
from pathlib import Path

ROOT = Path(__file__).parent
STATE_FILE = ROOT.parent / 'Karaokes' / 'data' / 'youtube_upload_state.json'
CACHE_FILE = ROOT / 'karaoke_songs.json'
SONGS_FILE = ROOT / 'songs.json'
PUBLIC = ROOT / 'client' / 'public'
FOLDER = 'Karaokes'

CONTRACTIONS = {'t', 's', 'm', 're', 'll', 've', 'd'}  # "Don t" → "dont": el apóstrofo llega como espacio


def slug(text: str, sep: str) -> str:
    text = unicodedata.normalize('NFD', text.lower())
    text = ''.join(c for c in text if unicodedata.category(c) != 'Mn')
    words = re.sub(r'[^a-z0-9]+', ' ', text).split()
    joined = []
    for w in words:
        if w in CONTRACTIONS and joined:
            joined[-1] += w
        else:
            joined.append(w)
    return sep.join(joined)


def candidate_urls(artist: str, title: str) -> list[tuple[str, str, str]]:
    """(url, artista, título) posibles de la hoja de acordes, de la más probable a la menos."""
    words = artist.split()
    # Tus karaokes a veces juntan artistas ("Kidd Voodoo Mon Laferte"): el completo y luego el primero
    artists = [' '.join(words[:n]) for n in range(len(words), 0, -1)][:3]
    titles = [title]
    no_feat = re.split(r'\s+(?:ft|feat)\.?\s+', title, flags=re.IGNORECASE)[0]
    if no_feat != title:
        titles.append(no_feat)
    if slug(title, ' ').startswith(slug(artist, ' ') + ' '):  # "MILO J RARA VEZ" → "RARA VEZ"
        titles.append(title.split(None, len(words))[-1])
    pairs = [(a, t) for a in artists for t in titles]
    swapped = (title, artist)  # algunos karaokes vienen como "Título - Artista"
    cifraclub = [(f'https://www.cifraclub.com/{slug(a, "-")}/{slug(t, "-")}/', a, t) for a, t in pairs + [swapped]]
    lacuerda = [(f'https://acordes.lacuerda.net/{slug(a, "_")}/{slug(t, "_")}.shtml', a, t) for a, t in pairs[:3] + [swapped]]
    return cifraclub + lacuerda


def song_name(key: str, url: str) -> str:
    """Nombre para la tarjeta ("Título - Artista - Sitio") según la variante que encontró la hoja."""
    artist, _, title = key.partition(' - ')
    a, t = next(((a, t) for u, a, t in candidate_urls(artist, title) if u == url), (artist, title))
    pretty = lambda s: re.sub(r"\b(\w+) (t|s|m|re|ll|ve|d)\b", r"\1'\2", s)  # "I m Gone" → "I'm Gone"
    return f"{pretty(t)} - {pretty(a)} - {'Cifra Club' if 'cifraclub' in url else 'LaCuerda'}"


def uploaded_songs() -> dict[str, set[str]]:
    """Canciones con karaoke subido: {"Artista - Título": {ids de sus videos}}."""
    uploads = json.loads(STATE_FILE.read_text(encoding='utf-8')).get('uploads', {})
    songs = {}
    for key, info in uploads.items():
        if info.get('status') == 'uploaded' and info.get('video_id') and '/' in key:
            songs.setdefault(key.rsplit('/', 1)[0], set()).add(info['video_id'])
    return songs


def main(retry: bool = False):
    sys.path.append(str(ROOT / 'server'))
    from api import scrape_cifraclub, scrape_lacuerda

    cache = json.loads(CACHE_FILE.read_text(encoding='utf-8')) if CACHE_FILE.exists() else {}
    tracks_path = PUBLIC / 'backing_tracks.json'
    tracks = json.loads(tracks_path.read_text(encoding='utf-8'))['backing_tracks'] if tracks_path.exists() else {}
    matched_ids = {v['id'] for versions in tracks.values() for v in versions.values()}
    preloaded_path = PUBLIC / 'preloaded_songs.json'
    preloaded = json.loads(preloaded_path.read_text(encoding='utf-8')) if preloaded_path.exists() else {}

    print("Buscando acordes de canciones con karaoke y sin marcador...")
    for key, ids in sorted(uploaded_songs().items()):
        if key in cache and (cache[key] or not retry):
            continue
        if ids & matched_ids and key not in cache:  # ya calza con un marcador tuyo
            continue
        artist, _, title = key.partition(' - ')
        found = None
        for url, _, _ in candidate_urls(artist, title):
            res = (scrape_cifraclub if 'cifraclub' in url else scrape_lacuerda)(url)
            time.sleep(0.4)  # amable con los sitios
            if 'error' not in res and res.get('content'):
                found = {'url': url}
                preloaded[url] = res
                break
        cache[key] = found
        print(f"  {'✔' if found else '✘'} {key}{' -> ' + found['url'] if found else ''}")

    found = {v['url']: song_name(key, v['url']) for key, v in cache.items() if v}  # una vez cada hoja
    CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding='utf-8')
    preloaded_path.write_text(json.dumps(preloaded, ensure_ascii=False), encoding='utf-8')

    # Carpeta "Karaokes" en songs.json (se rehace en cada corrida: extract_bookmarks reescribe el archivo)
    songs = json.loads(SONGS_FILE.read_text(encoding='utf-8'))
    songs['children'] = [c for c in songs.get('children', []) if c.get('name') != FOLDER or c.get('type') != 'folder']
    songs['children'].append({
        'name': FOLDER, 'type': 'folder',
        'children': [{'name': name, 'type': 'url', 'url': url} for url, name in found.items()],
    })
    SONGS_FILE.write_text(json.dumps(songs, ensure_ascii=False, indent=4), encoding='utf-8')
    misses = sum(1 for v in cache.values() if not v)
    print(f"Canciones de karaoke con acordes en el repertorio: {len(found)} | sin hoja encontrada: {misses}")


if __name__ == '__main__':
    main(retry='--retry' in sys.argv)
