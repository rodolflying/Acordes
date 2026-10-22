"""Fuente en YouTube para hacer el karaoke de cada canción del setlist que todavía no tiene: la misma búsqueda que
la wishlist de Karaokes ("Artista - Título"), pero mirando 5 resultados y prefiriendo el audio oficial de estudio.
Marca las dudosas (en vivo, cover, karaoke, muy cortas o largas). Escribe karaoke_sources.json; no procesa nada."""
import json
import re
from pathlib import Path

import yt_dlp

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'client' / 'public'
BAD = re.compile(r'\b(live|en vivo|vivo|cover|karaoke|instrumental|lyrics?|letra|remix|acoustic|ac[uú]stico|sped up|slowed|8d|reacci[oó]n|reaction|tutorial|guitar)\b', re.I)


def score(entry, artist, title):
    name = f"{entry.get('title', '')} {entry.get('channel') or entry.get('uploader') or ''}"
    s = 0
    channel = (entry.get('channel') or entry.get('uploader') or '').lower()
    if channel.endswith('- topic') or 'vevo' in channel or artist.lower().split()[0] in channel:
        s += 3  # canal oficial o audio de "Topic"
    if title.lower().split()[0] in (entry.get('title') or '').lower():
        s += 2
    if BAD.search(entry.get('title') or ''):
        s -= 4
    d = entry.get('duration') or 0
    if not 100 <= d <= 600:
        s -= 3
    return s


def main():
    seed = json.loads((PUBLIC / 'listas_iniciales.json').read_text(encoding='utf-8'))['listas'][0]['canciones']
    tracks = json.loads((PUBLIC / 'backing_tracks.json').read_text(encoding='utf-8'))['backing_tracks']
    enriched = json.loads((PUBLIC / 'enriched_songs.json').read_text(encoding='utf-8'))['songs']
    todo = [u for u in seed if u not in tracks]
    out = []
    with yt_dlp.YoutubeDL({'quiet': True, 'extract_flat': True, 'skip_download': True}) as ydl:
        for url in todo:
            artist, title = enriched[url]['artist'], enriched[url]['title']
            entries = [e for e in ydl.extract_info(f'ytsearch5:{artist} - {title}', download=False).get('entries', []) if e]
            best = max(entries, key=lambda e: score(e, artist, title)) if entries else None
            row = {'url_hoja': url, 'artista': artist, 'titulo': title}
            if best:
                row.update(youtube=f"https://www.youtube.com/watch?v={best['id']}", video=best.get('title'),
                           canal=best.get('channel') or best.get('uploader'), duracion=best.get('duration'),
                           puntaje=score(best, artist, title))
            row['revisar'] = not best or row['puntaje'] < 3
            out.append(row)
            print(f"{'??' if row['revisar'] else 'ok'} | {artist} - {title} | {row.get('video')} | {row.get('canal')} | {row.get('duracion')}", flush=True)
    (Path(__file__).parent / 'karaoke_sources.json').write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f"{len(out)} canciones | a revisar: {sum(r['revisar'] for r in out)}")


if __name__ == '__main__':
    main()
