"""Revisión canción por canción de la sincronía de la hoja con la letra (client/public/sync_points.json).

Por canción mide:
- cantado ubicado: qué parte de las palabras que se cantan quedó puesta sobre un renglón de la hoja
- renglones saltados: renglones de letra que quedan entre dos que se iluminan, avanzando, y nunca se iluminan
- adelantos: veces que la banda pasa al renglón siguiente antes de que termine la última palabra del anterior
- parpadeos: dos renglones distintos a menos de 0,4 s
- de dónde salen los tiempos: el karaoke (lo que se pinta), Whisper o LRCLIB

Uso:  python sync_audit.py   (imprime de la peor a la mejor)
"""
import json
import sys

from chordcheck import ROOT

sys.path.insert(0, str(ROOT))
from lyrics_sync import norm, sheet_lyric_lines  # noqa: E402


def audit(points, content, words):
    order = [k for k, _ in sheet_lyric_lines(content)]
    lit = [p[1] for p in points]
    lit_set = set(lit)
    skipped = set()
    for a, b in zip(lit, lit[1:]):
        if b > a:
            between = [x for x in order if a < x < b]
            if len(between) <= 3:  # un salto largo es otra sección (un solo, una parte no cantada)
                skipped |= {x for x in between if x not in lit_set}
    early = sum(1 for p, q in zip(points, points[1:])
                if len(p) > 2 and q[1] != p[1] and q[0] < p[2][-1][1] - 0.05)
    flicker = sum(1 for p, q in zip(points, points[1:]) if q[1] != p[1] and q[0] - p[0] < 0.4)
    sung = sum(1 for line in words for w, _ in line if norm(w))
    placed = sum(len(p[2]) for p in points if len(p) > 2)
    return {'ubicado': placed / sung if sung else None, 'saltados': len(skipped), 'adelantos': early,
            'parpadeos': flicker, 'puntos': len(points)}


if __name__ == '__main__':
    pre = json.loads((ROOT / 'client/public/preloaded_songs.json').read_text(encoding='utf-8'))
    sync = json.loads((ROOT / 'client/public/sync_points.json').read_text(encoding='utf-8'))
    karaoke = json.loads((ROOT / 'karaoke_lyrics.json').read_text(encoding='utf-8'))
    aligned = json.loads((ROOT / 'aligned_lyrics.json').read_text(encoding='utf-8'))
    rows = []
    # La misma elección que lyrics_sync.py: el karaoke, salvo donde sus subtítulos fallaron y Whisper alineó
    karaoke = {url: k for url, k in karaoke.items() if k.get('amontonadas', 0) <= 0.10 or not aligned.get(url, {}).get('lrc')}
    for url, points in sync.items():
        src = 'karaoke' if url in karaoke else 'whisper' if aligned.get(url, {}).get('lrc') else 'lrclib'
        words = (karaoke.get(url) or aligned.get(url) or {}).get('words', [])
        r = audit(points, pre[url]['content'], words)
        bad = (1 - (r['ubicado'] or 0)) * 4 + r['saltados'] + r['adelantos'] + r['parpadeos']
        rows.append((bad, url, src, r))
    rows.sort(key=lambda x: -x[0])
    for bad, url, src, r in rows:
        name = url.split('/')[-2] if url.endswith('/') else url.split('/')[-1]
        ub = f"{r['ubicado']:4.0%}" if r['ubicado'] is not None else '  — '
        print(f"{name[:30]:30} {src:7} cantado ubicado {ub} | saltados {r['saltados']:2} | adelantos {r['adelantos']:2} | "
              f"parpadeos {r['parpadeos']:2} | puntos {r['puntos']}")
