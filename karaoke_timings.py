"""
karaoke_timings.py — La letra con los tiempos exactos de tus karaokes, sacados del proyecto Karaokes.

Cada video Karaoke se generó con un subtitles.ass: la letra oficial con el inicio de cada línea y la
duración de cada palabra, que es justo lo que se pinta sobre el video. Este paso lo lee de la carpeta del
proyecto (Google Drive: Mi unidad/Karaokes/outputs/<canción>) para cada canción con pista, así la hoja se
mueve a la par de lo que se pinta en el video. Las tres versiones (Karaoke, Instrumental y Backtrack)
salen de la misma grabación, con los mismos tiempos.

Genera karaoke_lyrics.json, con el mismo formato que aligned_lyrics.json:
    { url: {"video": id, "lrc": "[mm:ss.xx] línea ...", "words": [[[palabra, segundo], ...], ...], "carpeta": ...} }
lyrics_sync.py lo usa antes que la alineación con Whisper y que LRCLIB.

Uso:
    python karaoke_timings.py      # también lo corre preload_chords.py antes de los tiempos de letra
Necesita Google Drive abierto (o la variable OUTPUT_DIR apuntando a las salidas de Karaokes).
"""

import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).parent
KARAOKES = ROOT.parent / 'Karaokes'
OUT = ROOT / 'karaoke_lyrics.json'


def outputs_dir():
    """Dónde guarda Karaokes cada canción: la misma búsqueda que su config.py."""
    if os.environ.get('OUTPUT_DIR'):
        return Path(os.environ['OUTPUT_DIR'])
    for drive in 'GDCEF':
        path = Path(f'{drive}:/Mi unidad/Karaokes/outputs')
        if path.exists():
            return path
    return KARAOKES / 'outputs'


def parse_ass(text):
    """Líneas de un subtitles.ass de Karaokes: [(inicio, [(palabra, segundo), ...])].

    Cada línea es un "Dialogue" con su inicio, y cada palabra va precedida de {\\kfN}: N centésimas desde
    que empieza a pintarse hasta la siguiente. Un {\\kfN} sin palabra es una pausa.
    """
    lines = []
    for raw in text.splitlines():
        m = re.match(r'Dialogue:\s*\d+,(\d+):(\d+):(\d+(?:\.\d+)?),[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,(.*)$', raw)
        if not m:
            continue
        start = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
        t, words = start, []
        for duration, word in re.findall(r'\{[^}]*?\\k[fo]?(\d+)[^}]*\}([^{]*)', m.group(4)):
            word = word.replace('\\N', ' ').strip()
            if word:
                words.append((word, round(t, 2)))
            t += int(duration) / 100
        if words:
            lines.append((round(start, 2), words))
    return lines


def to_lrc(lines):
    return '\n'.join(f'[{int(start // 60):02d}:{start % 60:05.2f}] ' + ' '.join(w for w, _ in words)
                     for start, words in lines)


def main():
    tracks_path = ROOT / 'client' / 'public' / 'backing_tracks.json'
    state_path = KARAOKES / 'data' / 'youtube_upload_state.json'
    base = outputs_dir()
    if not tracks_path.exists() or not state_path.exists() or not base.exists():
        print(f"Tiempos de tus karaokes: no encontré las salidas de Karaokes en {base} (¿Google Drive abierto?); "
              f"se usan los de antes")
        return
    tracks = json.loads(tracks_path.read_text(encoding='utf-8'))['backing_tracks']
    uploads = json.loads(state_path.read_text(encoding='utf-8')).get('uploads', {})
    folder_of = {v['video_id']: k.rsplit('/', 1)[0] for k, v in uploads.items() if v.get('video_id') and '/' in k}

    out, missing = {}, []
    for url, versions in sorted(tracks.items()):
        video = next((versions[v]['id'] for v in ('Karaoke', 'Instrumental', 'Backtrack') if v in versions), None)
        folder = folder_of.get(video)
        ass = base / folder / 'subtitles.ass' if folder else None
        if not ass or not ass.exists():
            missing.append(url)
            continue
        lines = parse_ass(ass.read_text(encoding='utf-8', errors='replace'))
        if len(lines) < 4:
            missing.append(url)
            continue
        # Qué parte de las palabras salen amontonadas (varias en una décima de segundo): tramos donde los
        # subtítulos del karaoke fallaron (Fuego, Virtual Insanity); con muchas, lyrics_sync.py prefiere Whisper
        gaps = [b - a for _, words in lines for (_, a), (_, b) in zip(words, words[1:])]
        out[url] = {'video': video, 'carpeta': folder, 'lrc': to_lrc(lines),
                    'words': [[[w, t] for w, t in words] for _, words in lines],
                    'amontonadas': round(sum(g < 0.08 for g in gaps) / max(len(gaps), 1), 3)}
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f"Tiempos de tus karaokes: {len(out)} de {len(tracks)} canciones con pista"
          + (f" (sin subtitles.ass: {len(missing)})" if missing else ''))


if __name__ == '__main__':
    main()
