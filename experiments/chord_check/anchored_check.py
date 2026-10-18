"""Revisión de acordes anclada a la letra: cada acorde de la hoja se evalúa justo cuando suena.

La versión anterior (batch.py) recorría los acordes de la hoja en orden buscando dónde calzaba cada
uno: como las hojas escriben un coro una vez y se canta varias, el recorrido se estiraba y medía mal.
Ahora el tiempo de cada acorde sale de la letra alineada con tu video (sync_points.json): el segundo
en que se canta la línea y, con Whisper, el de la palabra que va debajo del acorde. Cada aparición de
un acorde se compara con lo que suena en ese momento.

Por canción: el tono que suena respecto de la hoja, qué parte del tiempo coincide la hoja con lo que
suena, y por acorde escrito cuántas veces calza, qué suena cuando no calza y si la tercera dice
mayor o menor. Solo se evalúan los acordes de la hoja original, no los que agregó complete_chords.

Uso:  python anchored_check.py [palabras de la URL ...]   ->  results_anchored.json
"""
import html
import json
import re
import sys
from collections import Counter

import numpy as np

from chordcheck import HOP, NAMES, ROOT, SCRATCH, SR, TRIAD_NAMES, TRIADS, parse_chord, sharp, template
import batch

FRAME = HOP / SR
OUT = SCRATCH / 'results_anchored.json'
FIT = 0.92         # el acorde escrito "coincide" si explica al menos el 92% de lo que explica la mejor tríada
MAX_EVENT = 4.0    # s: un acorde se evalúa a lo más 4 s después de entrar


def interpolate(x, xs, ys):
    return float(np.interp(x, xs, ys))


def sheet_lines(content):
    """Por línea: largo, acordes originales [(columna, nombre, acorde)] y si es solo de acordes."""
    out = []
    for raw in content.split('\n'):
        col, chords, letters = 0, [], 0
        for part in re.split(r'(<span class="chord[^"]*"[^>]*>.*?</span>)', raw):
            m = re.fullmatch(r'<span class="(chord[^"]*)"[^>]*>(.*?)</span>', part)
            plain = html.unescape(re.sub(r'<[^>]+>', '', part))
            if m:
                name = sharp(plain.strip())
                c = parse_chord(name)
                if c and 'chord-added' not in m.group(1):
                    chords.append((col + len(plain) - len(plain.lstrip()), name, c))
            else:
                letters += sum(1 for ch in plain if not ch.isspace())
            col += len(plain)
        out.append({'length': col, 'chords': chords, 'chords_only': bool(chords) and letters <= 12})
    return out


def events_of(points, lines):
    """[(segundo, nombre, acorde)] de cada acorde escrito sobre una línea cantada, como en la app."""
    events = []
    merged = []  # dos frases cantadas en una misma línea de la hoja: una sola pasada (igual que la app)
    for p in points:
        prev = merged[-1] if merged else None
        anchors = p[2] if len(p) > 2 else []
        if prev and prev[1] == p[1] and len(prev) > 2 and prev[2] and anchors and anchors[0][0] > prev[2][-1][0]:
            prev[2] = prev[2] + anchors
        else:
            merged.append([p[0], p[1]] + ([list(anchors)] if anchors else []))
    points = merged
    for j, p in enumerate(points):
        t, line = p[0], p[1]
        anchors = p[2] if len(p) > 2 else []
        nxt = points[j + 1][0] if j + 1 < len(points) else t + 6
        above = line - 1 if line > 0 and lines[line - 1]['chords_only'] else None
        length = max(lines[line]['length'], 1)
        dur = min(nxt - t, 0.15 * length + 1.5)
        cols, times = [0], [t]
        for c, s in anchors:
            if c > cols[-1] and s > times[-1] and s < nxt:
                cols.append(c); times.append(s)
        end = min(max(t + dur, times[-1] + 0.5), nxt)
        cols.append(max(length, cols[-1] + 1)); times.append(max(end, times[-1] + 0.01))
        written = (lines[above]['chords'] if above is not None else []) + lines[line]['chords']
        events += [(interpolate(col, cols, times), name, c) for col, name, c in written]
    events.sort(key=lambda e: e[0])
    return events


def triad_of(c):
    """El acorde reducido a su tríada para compararlo de igual a igual con las 24 tríadas (un D7M(9) tiene
    5 notas y "perdía" contra una tríada simple). Los acordes sin tercera (A5, D4) quedan como None:
    calzan si lo que suena tiene la misma raíz, sea mayor o menor."""
    root, ivs, _ = c
    if 3 in ivs and 4 not in ivs:
        return (root, frozenset({0, 3, 7}), None)
    if 4 in ivs:
        return (root, frozenset({0, 4, 7}), None)
    return None


def check(url, content, points, video):
    lines = sheet_lines(content)
    events = events_of(points, lines)
    if len(events) < 8:
        return None
    C, voiced, _, _, _ = batch.chroma_for_video(video)
    triads = np.array([template(c) for c in TRIADS])
    windows = []
    for i, (t, name, c) in enumerate(events):
        end = min(events[i + 1][0] if i + 1 < len(events) else t + MAX_EVENT, t + MAX_EVENT)
        a, b = int(t / FRAME), int(end / FRAME)
        fr = np.arange(a, min(b, C.shape[1]))
        fr = fr[voiced[fr]] if len(fr) else fr
        if len(fr) >= 3:
            # Lo que suena mientras dura el acorde, promediado: un cuadro de transición o de ruido no
            # lo tumba (compararlo cuadro a cuadro castigaba al acorde correcto)
            mean = C[:, fr].mean(axis=1)
            windows.append((t, name, c, fr, mean / (np.linalg.norm(mean) + 1e-9)))
    if len(windows) < 8:
        return None
    # Tono: la transposición con la que la hoja, acorde por acorde, mejor explica lo que suena
    def fit(k):
        out = []
        for _, _, c, _, v in windows:
            scores = triads @ v
            core = triad_of(c)
            if core is None:  # sin tercera: vale la mejor tríada con su misma raíz
                same_root = [i for i in range(24) if i % 12 == (c[0] + k) % 12]
                out.append(float(scores[same_root].max() / (scores.max() + 1e-9)))
            else:
                out.append(float((template(core, k) @ v) / (scores.max() + 1e-9)))
        return out
    fits = {k: fit(k) for k in range(12)}
    k = max(fits, key=lambda k: np.sum([f * len(w[3]) for f, w in zip(fits[k], windows)]))
    per = fits[k]
    weights = np.array([len(w[3]) for w in windows], dtype=float)
    agree = float(np.sum(weights * (np.array(per) >= FIT)) / weights.sum())
    # Por acorde escrito
    by_name = {}
    for (t, name, c, fr, v), f in zip(windows, per):
        by_name.setdefault(name, {'c': c, 'n': 0, 'ok': 0, 'heard': Counter(), 'frames': []})
        d = by_name[name]
        d['n'] += 1
        d['frames'].extend(fr.tolist())
        if f >= FIT:
            d['ok'] += 1
        else:
            top = int(np.argmax(triads @ v))
            d['heard'][TRIAD_NAMES[(top % 12 - k) % 12 + (12 if top >= 12 else 0)]] += 1  # en el tono de la hoja
    chords = []
    for name, d in sorted(by_name.items(), key=lambda kv: -kv[1]['n']):
        root, ivs, _ = d['c']
        prof = C[:, d['frames']].mean(axis=1)
        maj3, min3 = prof[(root + k + 4) % 12], prof[(root + k + 3) % 12]
        third = 'menor' if min3 > maj3 * 1.5 else 'mayor' if maj3 > min3 * 1.5 else 'dudoso'
        quality = 'mayor' if 4 in ivs else 'menor' if 3 in ivs else None
        heard, times_heard = (d['heard'].most_common(1)[0] if d['heard'] else (None, 0))
        issue = None
        if d['n'] >= 3 and d['ok'] / d['n'] < 0.5:
            if quality and third not in ('dudoso', quality):
                issue = f"suena {NAMES[root]}{'m' if third == 'menor' else ''}"
            elif heard and times_heard >= 0.5 * (d['n'] - d['ok']):
                issue = f'suena {heard}'
        chords.append({'acorde': name, 'veces': d['n'], 'calza': d['ok'], 'suena_cuando_no': heard,
                       'tercera': third, 'problema': issue})
    anchored = sum(1 for p in points if len(p) > 2)
    return {'transposicion': k, 'coinciden': round(agree, 3), 'acordes_evaluados': len(windows),
            'lineas_con_palabras': anchored, 'lineas': len(points), 'acordes': chords}


if __name__ == '__main__':
    pre = json.loads((ROOT / 'client/public/preloaded_songs.json').read_text(encoding='utf-8'))
    sync = json.loads((ROOT / 'client/public/sync_points.json').read_text(encoding='utf-8'))
    old = json.loads((SCRATCH / 'results.json').read_text(encoding='utf-8'))
    out = {}
    filters = sys.argv[1:]
    for url, r in old.items():
        if r.get('estado') != 'ok' or url not in sync or (filters and not any(f in url for f in filters)):
            continue
        res = check(url, pre[url]['content'], sync[url], r['video'])
        if not res:
            continue
        out[url] = res
        flags = [f"{a['acorde']}: {a['problema']} ({a['veces'] - a['calza']}/{a['veces']})" for a in res['acordes'] if a['problema']]
        name = url.split('/')[-2] if url.endswith('/') else url.split('/')[-1]
        print(f"{name[:28]:28} coinciden {r['coinciden']:4.0%} -> {res['coinciden']:4.0%} | tono +{r['transposicion']} -> +{res['transposicion']} | "
              f"{res['lineas_con_palabras']}/{res['lineas']} líneas con palabras | {'; '.join(flags) or 'sin alertas'}", flush=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
