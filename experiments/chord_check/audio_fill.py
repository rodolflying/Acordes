"""Acordes desde el audio para las líneas que la hoja deja sin acordes (paso 3 de complete_chords.py).

Para cada línea de letra con su tiempo en tu video (letra alineada con Whisper o LRCLIB + desfase),
reconoce qué acordes suenan mientras se canta, eligiendo solo entre los que ya usa la canción y en el
tono que suena (transposición medida en results.json). Eso es mucho más confiable que reconocer a
ciegas: el reconocedor solo decide cuál de 4-8 acordes conocidos suena, no cuál de 24.

Autoevaluación: antes de llenar nada, el reconocedor "adivina" las líneas que sí traen acordes en la
hoja y se compara con lo escrito. Solo se usa en las canciones donde acierta (MIN_F1).
"""
import json
import sys
from pathlib import Path

import librosa
import numpy as np

from chordcheck import HOP, ROOT, SCRATCH, SR, parse_chord, sharp, template
import batch

sys.path.insert(0, str(ROOT))
from lyrics_sync import align as align_lyrics, parse_lrc, sheet_lyric_lines  # noqa: E402

MIN_F1 = 0.75        # acierto mínimo en las líneas que sí traen acordes
MIN_CHECKED = 6      # líneas para poder evaluar
MIN_SEGMENT = 0.6    # s: un acorde más corto que esto es ruido
FRAME = HOP / SR


def line_times(url, content):
    """{línea de la hoja: segundo en tu video en que se empieza a cantar} (la primera vez)."""
    enriched = json.loads((ROOT / 'client/public/enriched_songs.json').read_text(encoding='utf-8'))['songs']
    aligned = json.loads((ROOT / 'aligned_lyrics.json').read_text(encoding='utf-8')) if (ROOT / 'aligned_lyrics.json').exists() else {}
    if (ROOT / 'karaoke_lyrics.json').exists():  # lo que pinta tu video karaoke manda
        aligned = {**aligned, **json.loads((ROOT / 'karaoke_lyrics.json').read_text(encoding='utf-8'))}
    offsets = json.loads((ROOT / 'sync_offsets.json').read_text(encoding='utf-8')) if (ROOT / 'sync_offsets.json').exists() else {}
    cache = json.loads((ROOT / 'lrclib_cache.json').read_text(encoding='utf-8'))
    song = enriched.get(url, {})
    lrc = aligned[url]['lrc'] if url in aligned else cache.get(f"{song.get('artist')}|{song.get('title')}")
    if not lrc:
        return {}
    shift = 0 if url in aligned else offsets.get(url, {}).get('segundos', 0)
    points = align_lyrics(parse_lrc(lrc), sheet_lyric_lines(content))
    starts = sorted(t + shift for t, _ in points)
    out = {}
    for t, line in points:
        if line not in out:
            later = [s for s in starts if s > t + shift + 0.05]
            out[line] = (t + shift, later[0] if later else t + shift + 6)
    return out


class Listener:
    """Reconoce, en una ventana del video, cuál de los acordes de la canción suena."""

    def __init__(self, video, k, vocab):
        C, voiced, times, _, _ = batch.chroma_for_video(video)
        self.C, self.voiced = C, voiced
        self.vocab = vocab  # [(nombre en la hoja, acorde)]
        self.T = np.array([template(c, k) for _, c in vocab])

    def hear(self, start, end):
        """[(inicio, nombre)] de los acordes que suenan entre start y end (s)."""
        a, b = max(int(start / FRAME), 0), min(int(end / FRAME), self.C.shape[1])
        if b - a < 4 or self.voiced[a:b].mean() < 0.5:
            return []
        S = self.T @ self.C[:, a:b]
        P = np.exp(18 * S)
        P /= P.sum(axis=0, keepdims=True)
        path = librosa.sequence.viterbi(P, librosa.sequence.transition_loop(len(self.vocab), 0.97))
        segs, s0 = [], 0
        for i in range(1, len(path) + 1):
            if i == len(path) or path[i] != path[s0]:
                if (i - s0) * FRAME >= MIN_SEGMENT:
                    name = self.vocab[path[s0]][0]
                    if not segs or segs[-1][1] != name:
                        segs.append((start + (s0 - 0) * FRAME, name))
                s0 = i
        return segs


def vocabulary(lines):
    """Los acordes de la hoja, una vez cada uno: [(nombre, acorde)], identificados por sus notas."""
    seen, out = set(), []
    for line in lines:
        for _, name in line.chords:
            c = parse_chord(sharp(name))
            if c and (c[0], c[1]) not in seen:
                seen.add((c[0], c[1]))
                out.append((name, c))
    return out


def same(a, b):
    ca, cb = parse_chord(sharp(a)), parse_chord(sharp(b))
    return bool(ca and cb and ca[0] == cb[0] and ca[1] == cb[1])


def place(segs, text, start, dur):
    """Los acordes oídos puestos sobre la letra: la columna según cuándo entran al cantar la línea."""
    indent = len(text) - len(text.lstrip())
    length = max(len(text.rstrip()) - indent, 1)
    out, col = [], -2
    for t, name in segs[:4]:
        c = indent + round(min(max((t - start) / dur, 0), 0.95) * length)
        c = max(c, col + 2) if out else c
        out.append((c, name))
        col = c + len(name)
    return out


def audio_for(url):
    """Paso 3 de complete_chords para una canción: prepare(lines) -> listen(línea) -> [(columna, nombre)].

    prepare devuelve None si la canción no tiene análisis de audio o si el audio no acierta lo
    suficiente en las líneas que la hoja sí trae con acordes.
    """
    results = json.loads((SCRATCH / 'results.json').read_text(encoding='utf-8'))
    r = results.get(url)
    if not r or r.get('estado') != 'ok' or not (SCRATCH / 'audio' / 'cache' / f"{r['video']}.npz").exists():
        return None

    def prepare(lines):
        content = '\n'.join(l.raw for l in lines)
        times = line_times(url, content)
        vocab = vocabulary(lines)
        if len(vocab) < 2 or not times:
            return None
        ear = Listener(r['video'], r['transposicion'], vocab)

        def heard(i):
            t, nxt = times[i]
            d = min(nxt - t, 0.15 * max(len(lines[i].text.strip()), 1) + 1.5)
            return ear.hear(t - 0.3, t + d), t, d

        # Autoevaluación en las líneas que traen acordes en la hoja
        scores = []
        for i in times:
            if i > 0 and lines[i - 1].chord_only and lines[i].lyric:
                got = [n for _, n in heard(i)[0]]
                written = [n for _, n in lines[i - 1].chords]
                if got and written:
                    hit_w = sum(any(same(w, h) for h in got) for w in written) / len(written)
                    hit_h = sum(any(same(h, w) for w in written) for h in got) / len(got)
                    scores.append(2 * hit_w * hit_h / (hit_w + hit_h) if hit_w + hit_h else 0)
        prepare.f1, prepare.checked = (float(np.mean(scores)) if scores else 0.0), len(scores)
        if len(scores) < MIN_CHECKED or prepare.f1 < MIN_F1:
            return None

        def listen(i):
            if i not in times:
                return None
            segs, t, d = heard(i)
            return place(segs, lines[i].text, t, d) if segs else None

        return listen

    return prepare


if __name__ == '__main__':
    # Cuánto acierta el audio en cada canción, sin escribir nada
    from complete_chords import Line
    pre = json.loads((ROOT / 'client/public/preloaded_songs.json').read_text(encoding='utf-8'))
    for url in json.loads((SCRATCH / 'results.json').read_text(encoding='utf-8')):
        prepare = audio_for(url)
        sheet = pre.get(url, {})
        content = sheet.get('content_original', sheet.get('content'))
        if not prepare or not content:
            continue
        listen = prepare([Line(r) for r in content.split('\n')])
        print(f"{getattr(prepare, 'f1', 0):4.0%} en {getattr(prepare, 'checked', 0):3} líneas | "
              f"{'se usa' if listen else 'no se usa'} | {url}", flush=True)
