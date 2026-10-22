"""La letra de una canción sacada de su hoja de acordes en Acordate, para cuando Genius trae otra canción
(Paramar -> "Paramaribo") o nada (B.Y.O.B.). Deja la letra de Genius como letra_genius_equivocada.txt y escribe
letra_original.txt en la carpeta de Karaokes; después hay que rehacer el karaoke (karaoke_batch.py --rehacer).

Uso: python letra_desde_hoja.py <url de la hoja> "<carpeta en Karaokes/outputs>" [--ver]   (--ver: solo muestra)
"""
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from karaoke_timings import outputs_dir

LABEL = re.compile(r'(coro|intro|estribillo|solo|final|puente|verso|pre-?coro|chorus|verse|bridge|outro|riff|interlude|repeat|x\d+)\W*', re.I)


def lyrics_from_sheet(url):
    pre = json.loads((ROOT / 'client' / 'public' / 'preloaded_songs.json').read_text(encoding='utf-8'))
    sheet = pre[url]
    content = sheet.get('content_original', sheet['content'])
    lines = []
    for raw in content.split('\n'):
        text = re.sub(r'<span class="chord[^"]*"[^>]*>.*?</span>', '', raw)  # sin acordes
        text = html.unescape(re.sub(r'<[^>]+>', '', text)).replace('​', '')
        text = re.sub(r'\s+', ' ', text).strip()
        if (not text or re.fullmatch(r'\[.*\]|\(.*\)', text) or LABEL.fullmatch(text)
                or re.search(r'[|-]{4,}', text) or re.fullmatch(r'[\W\d]+', text)):
            continue  # vacía, rótulo, tablatura o solo signos
        lines.append(text)
    return lines


if __name__ == '__main__':
    url, folder = sys.argv[1], sys.argv[2]
    lines = lyrics_from_sheet(url)
    print(f'{len(lines)} líneas')
    print('\n'.join(lines))
    if '--ver' not in sys.argv:
        d = outputs_dir() / folder
        old = d / 'letra_original.txt'
        if old.exists() and not (d / 'letra_genius_equivocada.txt').exists():
            old.rename(d / 'letra_genius_equivocada.txt')
        old.write_text('\n'.join(lines) + '\n', encoding='utf-8')
        print(f'-> {old}')
