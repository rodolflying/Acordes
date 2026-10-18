"""
lyrics_sync.py — Tiempos de cada línea de la letra para que la hoja siga al video de verdad.

Descarga la letra con tiempos (LRC) de LRCLIB y ubica cada línea en la hoja de acordes
precargada. Genera client/public/sync_points.json:
    { "<url de la canción>": [[segundo, línea de la hoja], ...] }
La app usa esos puntos para avanzar línea a línea; sin ellos la hoja avanza en proporción
al video.

aligned_lyrics.json trae, para las canciones con video Karaoke, la misma letra de LRCLIB con los
tiempos de tu video (y el de cada palabra, que va como tercer elemento del punto: [[columna en la
hoja, segundo], ...], para que cada acorde entre justo cuando se canta su sílaba): Whisper ubicó cada línea en la voz guía (experiments/chord_check/align_lyrics.py).
Así la hoja calza aunque el video tenga otra intro u otra edición del tema. Si ahí "lrc" es null, la
letra de LRCLIB es de otra versión y la canción se queda con el avance proporcional al video.
sync_offsets.json corrige, en las demás, un video corrido en bloque respecto de la letra de LRCLIB:
    { "<url de la canción>": {"segundos": 1.2, ...} }   (positivo: en el video se canta después)
Lo genera experiments/chord_check/offsets.py midiendo la voz guía de tus karaokes.

Uso:
    python lyrics_sync.py      # también lo corre preload_chords.py al final
"""

import difflib
import html
import json
import re
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
PUBLIC = ROOT / 'client' / 'public'
CACHE_FILE = ROOT / 'lrclib_cache.json'  # respuestas de LRCLIB, para no repetir descargas
OFFSETS_FILE = ROOT / 'sync_offsets.json'  # desfase medido de cada video respecto de la letra
ALIGNED_FILE = ROOT / 'aligned_lyrics.json'  # la letra con los tiempos reales de tu video

SECTION = re.compile(r'^(intro|coro|estribillo|verso|puente|solo|final|outro|chorus|verse|bridge|'
                     r'pre ?coro|pre ?chorus|interludio|interlude|first part|second part|parte|tab|riff)\b')


def norm(s: str) -> str:
    s = unicodedata.normalize('NFD', s.lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return ' '.join(re.sub(r'[^a-z0-9 ]+', ' ', s).split())


def sheet_lyric_lines(content: str) -> list[tuple[int, str]]:
    """Líneas de letra de la hoja: [(índice de línea, texto normalizado)], sin acordes ni títulos de sección."""
    lyrics = []
    for i, line in enumerate(content.split('\n')):
        no_chords = re.sub(r'<span class="chord">.*?</span>', '', line)
        text = norm(html.unescape(re.sub(r'<[^>]+>', '', no_chords)))
        if len(text.split()) >= 2 and not SECTION.match(text):
            lyrics.append((i, text))
    return lyrics


def parse_lrc(lrc: str) -> list[tuple[float, str]]:
    """'[01:02.50] texto' → [(62.5, 'texto')], sin las líneas vacías."""
    lines = []
    for line in lrc.splitlines():
        m = re.match(r'\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)', line)
        if m and norm(m.group(3)):
            lines.append((int(m.group(1)) * 60 + float(m.group(2)), norm(m.group(3))))
    return lines


def similarity(a: str, b: str) -> float:
    """Parecido entre una línea cantada y una de la hoja, de 0 a 1.

    Además del parecido del texto, cuenta como igual cuando todas (o casi todas) las palabras
    de una están en la otra: la hoja a veces junta dos líneas cantadas en una, o parte una en dos.
    """
    ratio = difflib.SequenceMatcher(None, a, b).ratio()
    wa, wb = set(a.split()), set(b.split())
    if min(len(wa), len(wb)) < 4:  # con menos palabras distintas ("ey ey ey", "con la tuya") cualquier línea "contiene" a la otra
        return ratio
    shorter, longer = (wa, wb) if len(wa) <= len(wb) else (wb, wa)
    contained = len(shorter & longer) / len(shorter)
    return max(ratio, contained if contained >= 0.8 else 0)


def align(lrc: list[tuple[float, str]], lyrics: list[tuple[int, str]],
          min_score: float = 0.6, skip_cost: float = 0.05, back_cost: float = 1.2,
          with_index: bool = False) -> list[list]:
    """Para cada línea con tiempo, la línea de la hoja donde está escrita: [[segundo, línea], ...].

    Alinea la canción entera de una vez (programación dinámica), como una partitura con
    repeticiones: cada línea que calza suma su parecido; avanzar a la línea siguiente de la
    hoja es gratis, saltarse líneas cuesta un poco por línea y volver atrás cuesta caro. Así
    se vuelve a un coro escrito una vez solo cuando calzan varias líneas seguidas, nunca por
    una frase suelta que se parece, y entre dos lugares parecidos gana el más cercano. Las
    líneas cantadas que no aparecen en la hoja se saltan.
    """
    m = len(lyrics)
    NONE = float('-inf')
    best = [NONE] * m    # mejor puntaje con la última línea calzada en la posición k de la hoja
    trail = [None] * m   # cómo se llegó: (línea cantada, k, trail anterior)
    for i, (_, text) in enumerate(lrc):
        sims = [similarity(text, s) for _, s in lyrics]
        # Mejor punto de partida para cada k: empezar ahí, venir de antes (saltándose líneas)
        # o volver desde más adelante; se calcula con máximos acumulados en ambos sentidos
        prefix, prefix_k = [NONE] * m, [None] * m   # max sobre p < k de best[p] + skip_cost * p
        run, run_k = NONE, None
        for k in range(m):
            prefix[k], prefix_k[k] = run, run_k
            if best[k] + skip_cost * k > run:
                run, run_k = best[k] + skip_cost * k, k
        suffix, suffix_k = [NONE] * m, [None] * m   # max sobre p > k de best[p]
        run, run_k = NONE, None
        for k in range(m - 1, -1, -1):
            suffix[k], suffix_k[k] = run, run_k
            if best[k] > run:
                run, run_k = best[k], k
        new_best, new_trail = best[:], trail[:]      # saltarse la línea cantada no cambia nada
        for k in range(m):
            if sims[k] < min_score:
                continue
            options = [(-skip_cost * k, None),                                   # empezar acá
                       (best[k], k),                                             # la misma línea otra vez
                       (prefix[k] - skip_cost * (k - 1), prefix_k[k]),           # venir de antes
                       (suffix[k] - back_cost, suffix_k[k])]                     # volver atrás
            value, prev = max((o for o in options if o[0] != NONE), key=lambda o: o[0])
            if value + sims[k] > new_best[k]:
                new_best[k] = value + sims[k]
                new_trail[k] = (i, k, trail[prev] if prev is not None else None)
        best, trail = new_best, new_trail

    if not lrc or max(best, default=NONE) == NONE:
        return []
    node, points = trail[max(range(m), key=lambda k: best[k])], []
    while node:
        i, k, node = node
        points.append([round(lrc[i][0], 2), lyrics[k][0]] + ([i] if with_index else []))
    return points[::-1]


def sung_words(lrc_text: str, words: list) -> list:
    """Las palabras con tiempo de aligned_lyrics.json, una lista por línea de parse_lrc(lrc_text)."""
    out = []
    for line, line_words in zip(lrc_text.splitlines(), words):
        m = re.match(r'\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)', line)
        if m and norm(m.group(3)):  # las mismas líneas que se queda parse_lrc
            out.append(line_words)
    return out


def word_anchors(sheet_line: str, words: list) -> list[list]:
    """[[columna, segundo], ...]: dónde está escrita en la hoja cada palabra cantada y cuándo se canta.

    Un acorde va escrito sobre una sílaba: con esto la app sabe en qué segundo entra, aunque la
    línea no se cante a velocidad pareja.
    """
    text = html.unescape(re.sub(r'<[^>]+>', '', sheet_line))
    written = [(m.start(), norm(m.group()).split()[0]) for m in re.finditer(r'\S+', text) if norm(m.group())]
    sung = [(norm(w).split()[0], t) for w, t in words if norm(w)]
    matcher = difflib.SequenceMatcher(None, [w for _, w in written], [w for w, _ in sung], autojunk=False)
    anchors = []
    for a, b, size in matcher.get_matching_blocks():
        for j in range(size):
            col, t = written[a + j][0], sung[b + j][1]
            if not anchors or t > anchors[-1][1]:  # siempre hacia adelante
                anchors.append([col, round(t, 2)])
    return anchors


def _get_json(url: str):
    req = urllib.request.Request(url, headers={'User-Agent': 'Acordes/1.0 (hobby project)'})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode('utf-8'))
    except Exception:
        return None


def fetch_synced_lyrics(artist: str, title: str, cache: dict) -> str | None:
    """Letra con tiempos (texto LRC) de LRCLIB; si no hay coincidencia exacta, prueba con la búsqueda."""
    key = f'{artist}|{title}'
    if key in cache:
        return cache[key]
    params = urllib.parse.urlencode({'artist_name': artist, 'track_name': title})
    found = _get_json(f'https://lrclib.net/api/get?{params}') or {}
    lrc = found.get('syncedLyrics')
    if not lrc:
        results = _get_json(f'https://lrclib.net/api/search?{params}') or []
        lrc = next((r['syncedLyrics'] for r in results if r.get('syncedLyrics')), None)
    time.sleep(0.3)  # amable con la API
    if lrc:  # solo se guardan los aciertos: las que faltan se reintentan la próxima vez
        cache[key] = lrc
    return lrc


def generate_sync_points():
    print("Generando tiempos de letra (LRCLIB)...")
    preloaded = json.loads((PUBLIC / 'preloaded_songs.json').read_text(encoding='utf-8'))
    enriched = json.loads((PUBLIC / 'enriched_songs.json').read_text(encoding='utf-8'))['songs']
    tracks_path = PUBLIC / 'backing_tracks.json'
    tracks = json.loads(tracks_path.read_text(encoding='utf-8'))['backing_tracks'] if tracks_path.exists() else {}
    cache = json.loads(CACHE_FILE.read_text(encoding='utf-8')) if CACHE_FILE.exists() else {}
    offsets = json.loads(OFFSETS_FILE.read_text(encoding='utf-8')) if OFFSETS_FILE.exists() else {}
    aligned = json.loads(ALIGNED_FILE.read_text(encoding='utf-8')) if ALIGNED_FILE.exists() else {}

    # Solo importa en canciones con video: pistas de Karaokes o videos vinculados a mano
    urls = set(tracks) | {url for url, e in enriched.items() if e.get('youtube_video')}
    sync_points, sin_letra = {}, []
    for url in sorted(urls):
        song, sheet = enriched.get(url), preloaded.get(url)
        if not song or not sheet or not sheet.get('content'):
            continue
        if url in aligned and aligned[url]['lrc'] is None:  # la letra de LRCLIB es de otra versión del tema
            sin_letra.append(f"{song['title']} — {song['artist']} (letra de otra versión)")
            continue
        lrc_text = aligned[url]['lrc'] if url in aligned else fetch_synced_lyrics(song['artist'], song['title'], cache)
        lrc = parse_lrc(lrc_text) if lrc_text else []
        points = align(lrc, sheet_lyric_lines(sheet['content']), with_index=True) if lrc else []
        # Una letra que casi no calza con la hoja es otra versión (u otra canción): mejor el modo aproximado
        if len(points) >= 8 and len(points) >= 0.5 * len(lrc):
            shift = 0 if url in aligned else offsets.get(url, {}).get('segundos', 0)
            words = sung_words(lrc_text, aligned[url].get('words', [])) if url in aligned else []
            sheet_lines = sheet['content'].split('\n')
            sync_points[url] = []
            for t, line, i in points:
                anchors = word_anchors(sheet_lines[line], words[i]) if i < len(words) and words[i] else []
                sync_points[url].append([round(t + shift, 2), line] + ([anchors] if anchors else []))
        else:
            sin_letra.append(f"{song['title']} — {song['artist']}")

    CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False), encoding='utf-8')
    (PUBLIC / 'sync_points.json').write_text(json.dumps(sync_points, ensure_ascii=False), encoding='utf-8')
    print(f"Se generó sync_points.json: {len(sync_points)} de {len(urls)} canciones con video sincronizadas línea a línea"
          f" ({sum(url in aligned for url in sync_points)} con los tiempos de tu video,"
          f" {sum(url in offsets and url not in aligned for url in sync_points)} con desfase corregido en bloque)")
    if sin_letra:
        print("  Sin letra con tiempos (quedan en modo aproximado): " + ', '.join(sin_letra))


if __name__ == '__main__':
    generate_sync_points()
