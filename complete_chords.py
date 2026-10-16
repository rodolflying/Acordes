"""
complete_chords.py — Completa los acordes que las hojas escriben una sola vez ("igual que arriba").

Muchas hojas ponen acordes solo la primera vez que aparece un verso o un coro y después dejan la letra
sola (El Tesoro tiene acordes en 11 de sus 25 líneas, igual en las 4 versiones de LaCuerda). Este paso
agrega una línea de acordes sobre cada línea de letra que no tiene, de lo más seguro a lo menos:

1. Bloque repetido: un bloque de letra sin acordes copia los del bloque anterior con el mismo rótulo
   ("(A)", "Coro:") o con la misma cantidad de líneas y letra parecida. Las columnas se ajustan al
   largo de cada línea.
2. Línea repetida: una línea idéntica a otra anterior que sí tiene acordes copia los suyos.
3. Audio (opcional): con el análisis de tu video (experiments/chord_check), los acordes que suenan
   mientras se canta la línea, elegidos solo entre los que ya usa la canción. Se usa únicamente en
   las canciones donde, probado contra las líneas que sí traen acordes, el audio acierta.

Los acordes agregados llevan la clase "chord-added" (se ven distintos y dicen de dónde salieron).
La hoja original queda en "content_original" de preloaded_songs.json.

Uso:
    python complete_chords.py      # también lo corre preload_chords.py antes de los tiempos de letra
"""

import difflib
import html
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).parent
PUBLIC = ROOT / 'client' / 'public'

CHORD_SPAN = re.compile(r'<span class="chord[^"]*"[^>]*>(.*?)</span>')
TAG = re.compile(r'<[^>]+>')
INLINE_LABEL = re.compile(r'^\s*(\(\s*[A-Da-d1-4]\s*\)|\[\s*[A-Da-d1-4]\s*\]|[A-Da-d1-4]\))\s*')
SECTION_WORDS = {'intro': 'intro', 'coro': 'coro', 'estribillo': 'coro', 'chorus': 'coro', 'refrao': 'coro',
                 'refrão': 'coro', 'verso': 'verso', 'verse': 'verso', 'estrofa': 'verso', 'puente': 'puente',
                 'bridge': 'puente', 'precoro': 'precoro', 'prechorus': 'precoro', 'pre': 'precoro',
                 'solo': 'solo', 'final': 'final', 'outro': 'final', 'interludio': 'interludio', 'cambio': 'cambio'}
ADDED = {
    'bloque': 'Agregado por Acordes: esta parte se repite como más arriba',
    'linea': 'Agregado por Acordes: esta línea se repite como más arriba',
    'audio': 'Agregado por Acordes: oído en tu video',
}


def norm(s):
    s = unicodedata.normalize('NFD', s.lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return ' '.join(re.sub(r'[^a-z0-9 ]+', ' ', s).split())


class Line:
    """Una línea de la hoja: su HTML, su texto, sus acordes [(columna, nombre)] y qué es."""

    def __init__(self, raw):
        self.raw = raw
        self.chords = []
        col, text = 0, []
        for part in re.split(r'(<span class="chord[^"]*"[^>]*>.*?</span>)', raw):
            m = CHORD_SPAN.fullmatch(part)
            plain = html.unescape(TAG.sub('', part))
            if m and plain.strip():
                self.chords.append((col + len(plain) - len(plain.lstrip()), plain.strip()))
            col += len(plain)
            text.append(plain)
        self.text = ''.join(text)
        outside = CHORD_SPAN.sub('', raw)
        self.letters = sum(1 for c in html.unescape(TAG.sub('', outside)) if not c.isspace())
        self.words = norm(html.unescape(TAG.sub('', outside))).split()

    @property
    def blank(self):
        return not self.text.strip()

    @property
    def chord_only(self):
        return bool(self.chords) and self.letters <= 10

    @property
    def tab(self):
        t = self.text.strip()
        return t.count('-') >= 8 or bool(re.match(r'^[A-Ga-g1-6]\s*[|/:]', t))

    @property
    def label(self):
        """Rótulo de sección si la línea es solo eso ("Coro:", "(B)", "[Verso 2]")."""
        if self.chords or self.tab or len(self.words) > 4:
            return None
        t = self.text.strip()
        if re.fullmatch(r'[\(\[]\s*[A-Da-d1-4]\s*[\)\]]:?', t):
            return t.strip('()[]: ').lower()
        first = self.words[0] if self.words else ''
        return SECTION_WORDS.get(first) if t.endswith(':') or t[:1] in '([' or first in SECTION_WORDS else None

    @property
    def lyric(self):
        # Dos palabras de verdad: "P.M  .  .  ." (palm mute bajo una tablatura) no es letra
        return not self.chord_only and not self.tab and self.label is None and sum(len(w) >= 2 for w in self.words) >= 2


def inline_label(text):
    m = INLINE_LABEL.match(text)
    return (m.group(1).strip('()[] ').lower(), m.end()) if m else (None, 0)


def similarity(a, b):
    return difflib.SequenceMatcher(None, a, b).ratio()


def chord_line_html(chords, how):
    """Una línea de acordes agregados con cada nombre en su columna."""
    out, col = [], 0
    for c, name in chords:
        c = max(c, col + (1 if col else 0))
        out.append(' ' * (c - col))
        out.append(f'<span class="chord chord-added" title="{ADDED[how]}">{html.escape(name)}</span>')
        col = c + len(name)
    return ''.join(out)


def move_chords(chords, src_text, dst_text):
    """Los acordes de una línea de letra puestos sobre otra: misma posición relativa en la letra."""
    s0 = len(src_text) - len(src_text.lstrip())
    d0 = len(dst_text) - len(dst_text.lstrip())
    s_len = max(len(src_text.strip()), 1)
    d_len = max(len(dst_text.strip()), 1)
    return [(d0 + round(max(c - s0, 0) * d_len / s_len), name) for c, name in chords]


def blocks_of(lines):
    """Bloques de letra seguidos: [{'label', 'lyrics': [índices], 'chords_of': {letra: línea de acordes}}]."""
    blocks, current, pending = [], None, None
    for i, line in enumerate(lines):
        if line.lyric:
            above = i - 1 if i > 0 and lines[i - 1].chord_only else None
            if current is None:
                own, _ = inline_label(line.text)
                current = {'label': own or pending, 'lyrics': [], 'chords_of': {}}
                blocks.append(current)
                pending = None
            current['lyrics'].append(i)
            if above is not None:
                current['chords_of'][i] = above
        elif line.chord_only:
            if not (i + 1 < len(lines) and lines[i + 1].lyric):
                current = None  # acordes sueltos (intro, solo): cortan el bloque
        else:
            current = None
            if line.label is not None:
                pending = line.label
            elif not line.blank:
                pending = None
    return blocks


def lyric_words(line):
    """La letra de la línea, normalizada y sin el rótulo con que empieza ("(A)Te bañaré" -> "te banare")."""
    _, end = inline_label(line.text)
    return norm(line.text[end:])


def complete(content, audio=None):
    """Hoja con los acordes que faltaban. Devuelve (contenido, {forma: líneas agregadas})."""
    raws = content.split('\n')
    lines = [Line(r) for r in raws]
    has_chords = {i for i, l in enumerate(lines) if l.lyric and ((i > 0 and lines[i - 1].chord_only) or l.chords)}
    added = {}  # línea de letra -> (acordes, forma)
    blocks = blocks_of(lines)

    # 1. Bloques repetidos
    for b, target in enumerate(blocks):
        missing = [i for i in target['lyrics'] if i not in has_chords]
        if not missing:
            continue
        best = None
        for source in reversed(blocks[:b]):  # a igual parecido, el más cercano: suele ser el mismo pasaje
            if len(source['lyrics']) != len(target['lyrics']) or not all(i in source['chords_of'] for i in source['lyrics']):
                continue
            pairs = list(zip(source['lyrics'], target['lyrics']))
            sims = [similarity(lyric_words(lines[s]), lyric_words(lines[t])) for s, t in pairs]
            same_label = target['label'] is not None and target['label'] == source['label']
            identical = sum(x >= 0.95 for x in sims)
            first_words = sum(lyric_words(lines[s]).split()[:1] == lyric_words(lines[t]).split()[:1] for s, t in pairs) / len(pairs)
            if same_label or sum(sims) / len(sims) >= 0.55 or (identical >= 1 and first_words >= 0.75):
                score = 2 * same_label + sum(sims) / len(sims) + 0.5 * identical
                if best is None or score > best[0]:
                    best = (score, pairs, source)
        if best:
            _, pairs, source = best
            for s, t in pairs:
                if t in missing:
                    above = lines[source['chords_of'][s]]
                    added[t] = (move_chords(above.chords, lines[s].text, lines[t].text), 'bloque')

    listen = audio(lines) if audio else None  # línea -> acordes oídos en el video, o None

    # 2. Líneas repetidas (también de las que acaban de recibir acordes). Una misma línea puede
    # cantarse sobre acordes distintos ("Todo el universo..." con F#m G y después con D Bm): decide el
    # audio si lo hay y si no, la aparición más cercana, que suele ser el mismo pasaje
    def chords_over(j):
        if j in added:
            return added[j][0]
        return lines[j - 1].chords if j > 0 and lines[j - 1].chord_only and not lines[j].chords else None

    for i, line in enumerate(lines):
        if not line.lyric or i in has_chords or i in added:
            continue
        options = [move_chords(chords_over(j), lines[j].text, line.text) for j in range(i - 1, -1, -1)
                   if lines[j].lyric and chords_over(j) and lyric_words(lines[j]) == lyric_words(line)]
        if options:
            heard = {n for _, n in (listen(i) or [])} if listen else set()
            added[i] = (max(options, key=lambda o: sum(n in heard for _, n in o) / len(o)), 'linea')

    # 3. Audio
    if listen:
        for i, line in enumerate(lines):
            if line.lyric and i not in has_chords and i not in added and not line.chords:
                chords = listen(i)
                if chords:
                    added[i] = (chords, 'audio')

    out, stats = [], {'bloque': 0, 'linea': 0, 'audio': 0}
    for i, raw in enumerate(raws):
        if i in added and added[i][0]:
            out.append(chord_line_html(*added[i]))
            stats[added[i][1]] += 1
        out.append(raw)
    return '\n'.join(out), stats


def audio_source():
    """El paso 3 (audio), si en este computador está el análisis de tus videos (experiments/chord_check)."""
    try:
        sys.path.insert(0, str(ROOT / 'experiments' / 'chord_check'))
        from audio_fill import audio_for
        return audio_for
    except Exception as e:  # sin el análisis o sin sus librerías: solo los pasos 1 y 2
        print(f"  (sin el paso del audio: {e})")
        return None


def main(use_audio=True):
    audio_for = audio_source() if use_audio else None
    path = PUBLIC / 'preloaded_songs.json'
    preloaded = json.loads(path.read_text(encoding='utf-8'))
    totals, songs = {'bloque': 0, 'linea': 0, 'audio': 0}, 0
    for url, sheet in preloaded.items():
        original = sheet.get('content_original', sheet.get('content'))
        if not original:
            continue
        content, stats = complete(original, audio_for(url) if audio_for else None)
        if content != original:
            sheet['content_original'] = original
            sheet['content'] = content
            sheet['added_chords'] = stats
            songs += 1
            for k in totals:
                totals[k] += stats[k]
        else:
            sheet.pop('content_original', None)
            sheet.pop('added_chords', None)
            sheet['content'] = original
    path.write_text(json.dumps(preloaded, ensure_ascii=False), encoding='utf-8')
    print(f"Acordes completados en {songs} canciones: {totals['bloque']} líneas por bloque repetido, "
          f"{totals['linea']} por línea repetida y {totals['audio']} desde el audio")


if __name__ == '__main__':
    main()
