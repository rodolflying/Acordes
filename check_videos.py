"""
check_videos.py — Revisa en YouTube los videos de tus pistas y anota los que ya no se pueden ver.

Un video que YouTube bajó o dejó privado, o que pide confirmar edad (no se reproduce dentro de otra
página), deja un reproductor roto en la hoja. generate_backing_tracks (preload_chords.py) salta los
que quedan anotados en unavailable_videos.json.

Uso:
    python check_videos.py      # y después python preload_chords.py (o Actualizar-Acordes)
"""

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).parent
OUT = ROOT / 'unavailable_videos.json'
REASONS = {  # lo que dice yt-dlp -> por qué no se puede ver
    'Sign in to confirm your age': 'pide confirmar edad',
    'Private video': 'privado',
    'removed': 'eliminado',
    'unavailable': 'no disponible',
}


def check(video_id):
    """Por qué no se puede ver el video, o None si se puede (o si YouTube no respondió claro)."""
    r = subprocess.run(['yt-dlp', '--simulate', '--no-warnings', '--print', 'id',
                        f'https://www.youtube.com/watch?v={video_id}'], capture_output=True, text=True, timeout=60)
    if r.returncode == 0:
        return None
    return next((why for text, why in REASONS.items() if text in r.stderr), None)


def main():
    tracks = json.loads((ROOT / 'client' / 'public' / 'backing_tracks.json').read_text(encoding='utf-8'))['backing_tracks']
    ids = sorted({t['id'] for versions in tracks.values() for t in versions.values()})
    out = {}
    for i, video_id in enumerate(ids, 1):
        why = check(video_id)
        if why:
            out[video_id] = why
            print(f'[{i}/{len(ids)}] {video_id}: {why}', flush=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'{len(out)} de {len(ids)} videos no se pueden ver; anotados en {OUT.name}')


if __name__ == '__main__':
    main()
