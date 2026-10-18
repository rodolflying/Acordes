"""
lyrics_sync.py — Tiempos de cada línea de la letra para que la hoja siga al video de verdad.

Descarga la letra con tiempos (LRC) de LRCLIB y ubica cada línea en la hoja de acordes
precargada. Genera client/public/sync_points.json:
    { "<url de la canción>": [[segundo, línea de la hoja], ...] }
La app usa esos puntos para avanzar línea a línea; sin ellos la hoja avanza en proporción
al video.

karaoke_lyrics.json trae la letra exacta que pinta cada video karaoke (karaoke_timings.py, desde el
proyecto Karaokes) y manda sobre todo lo demás. aligned_lyrics.json trae, para las canciones con video Karaoke, la misma letra de LRCLIB con los
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
KARAOKE_FILE = ROOT / 'karaoke_lyrics.json'  # la letra exacta que pinta tu video karaoke (karaoke_timings.py)

SECTION = re.compile(r'^(intro|coro|estribillo|verso|puente|solo|final|outro|chorus|verse|bridge|'
                     r'pre ?coro|pre ?chorus|interludio|interlude|first part|second part|parte|tab|riff)\b')


def norm(s: str) -> str:
    s = unicodedata.normalize('NFD', s.lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return ' '.join(re.sub(r'[^a-z0-9 ]+', ' ', s).split())


def sheet_lyric_lines(content: str) -> list[tuple[int, str]]:
    """Líneas de letra de la hoja: [(índice de línea, texto normalizado)], sin acordes (también los que
    agregó complete_chords, class="chord chord-added"), títulos de sección ni tablaturas."""
    lyrics = []
    for i, line in enumerate(content.split('\n')):
        no_chords = re.sub(r'<span class="chord[^"]*"[^>]*>.*?</span>', '', line)
        plain = html.unescape(re.sub(r'<[^>]+>', '', no_chords))
        if plain.count('-') >= 8 or re.match(r'\s*[A-Ga-g1-6]\s*\|', plain):  # "G|--9--x-12-x-10--|"
            continue
        text = norm(plain)
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


def word_anchors(sheet_line: str, words: list, used: set | None = None) -> list[list]:
    """[[columna, segundo], ...]: dónde está escrita en la hoja cada palabra cantada y cuándo se canta.

    Un acorde va escrito sobre una sílaba: con esto la app sabe en qué segundo entra, aunque la
    línea no se cante a velocidad pareja. Si se pasa `used`, ahí quedan las palabras cantadas que
    calzaron (su posición en `words`).
    """
    text = html.unescape(re.sub(r'<[^>]+>', '', sheet_line))
    written = [(m.start(), norm(m.group()).split()[0]) for m in re.finditer(r'\S+', text) if norm(m.group())]
    sung = [(norm(w).split()[0], t, k) for k, (w, t) in enumerate(words) if norm(w)]
    matcher = difflib.SequenceMatcher(None, [w for _, w in written], [w for w, _, _ in sung], autojunk=False)
    anchors = []
    for a, b, size in matcher.get_matching_blocks():
        for j in range(size):
            col, t, k = written[a + j][0], sung[b + j][1], sung[b + j][2]
            if not anchors or t > anchors[-1][1]:  # siempre hacia adelante
                anchors.append([col, round(t, 2)])
                if used is not None:
                    used.add(k)
    return anchors


def crammed(anchors: list | None) -> bool:
    """Palabras amontonadas (varias en una décima de segundo): nadie canta así, es un tramo donde los
    subtítulos del karaoke fallaron, y seguirlo haría parpadear la hoja."""
    return bool(anchors) and len(anchors) >= 2 and (anchors[-1][1] - anchors[0][1]) / (len(anchors) - 1) < 0.08


def region_points(sung_lines: list, sheet_lines: list, region: list) -> list[list]:
    """Las palabras cantadas de un tramo puestas sobre los renglones de la hoja de ese tramo.

    sung_lines: [[palabra, segundo], ...] de cada línea cantada del tramo, en orden; region: los
    renglones de letra de la hoja donde van. Se alinean palabra por palabra todas juntas, así da lo
    mismo cómo corta los renglones la hoja ("Un camino sin fe, melodía una dulce canción" toma media
    línea cantada y media de la siguiente). Devuelve [[segundo, renglón, anclas], ...].
    """
    written = []
    for line in region:
        text = html.unescape(re.sub(r'<[^>]+>', '', sheet_lines[line]))
        written += [(line, m.start(), norm(m.group()).split()[0]) for m in re.finditer(r'\S+', text) if norm(m.group())]
    sung = [(norm(w).split()[0], t) for words in sung_lines for w, t in words if norm(w)]
    matcher = difflib.SequenceMatcher(None, [w for _, _, w in written], [w for w, _ in sung], autojunk=False)
    anchors, last = {}, -1.0
    for a, b, size in matcher.get_matching_blocks():
        for j in range(size):
            line, col, _ = written[a + j]
            t = sung[b + j][1]
            if t > last:  # siempre hacia adelante
                anchors.setdefault(line, []).append([col, round(t, 2)])
                last = t
    points = []
    for line in region:
        a = anchors.get(line)
        if crammed(a):
            continue
        if a and (len(a) >= 2 or a[0][0] <= 2):  # una palabra suelta en medio del renglón no basta
            # Si el renglón empieza con palabras que no calzaron, empieza un poco antes de la primera que sí
            points.append([round(a[0][1] - min(a[0][0] * 0.06, 1.5), 2), line, a])
    return points


def merge_rows(points: list) -> list:
    """Un renglón con palabras de dos líneas cantadas (la hoja corta distinto que el karaoke) sale de dos
    tramos: queda un solo punto, desde su primera palabra, con las anclas de los dos. Solo si son las mismas
    palabras o si las del segundo siguen más a la derecha: un renglón que se canta otra vez ("You are",
    "You are") vuelve a empezar desde la izquierda y es otro punto."""
    out = []
    for p in sorted(points, key=lambda p: p[0]):
        q = out[-1] if out else None
        same = q and len(p) > 2 and len(q) > 2 and p[1] == q[1]
        if same and ({a[1] for a in p[2]} & {a[1] for a in q[2]}
                     or (p[2][0][0] > q[2][-1][0] and p[2][0][1] <= q[2][-1][1] + 3)):
            anchors = []
            for col, t in sorted({tuple(a) for a in q[2] + p[2]}, key=lambda a: a[1]):
                if not anchors or (col > anchors[-1][0] and t > anchors[-1][1]):
                    anchors.append([col, t])
            out[-1] = [min(q[0], p[0]), q[1], anchors]
        else:
            out.append(p)
    # Las mismas palabras cantadas puestas en dos renglones (la hoja escribe dos veces la misma frase): queda
    # el que calza mejor (más palabras, desde el comienzo del renglón), así la banda no salta entre los dos
    owner, keep = {}, [True] * len(out)
    for k, p in enumerate(out):
        if len(p) < 3:
            continue
        rivals = {owner[t] for _, t in p[2] if t in owner and out[owner[t]][1] != p[1]}
        for r in rivals:
            shared = len({t for _, t in p[2]} & {t for _, t in out[r][2]})
            if keep[r] and shared * 2 >= min(len(p[2]), len(out[r][2])):
                worse = k if (-len(p[2]), p[2][0][0]) > (-len(out[r][2]), out[r][2][0][0]) else r
                keep[worse] = False
        if keep[k]:
            owner.update({t: k for _, t in p[2]})
    return [p for k, p in enumerate(out) if keep[k]]


def no_early(points: list) -> list:
    """Un renglón no se ilumina antes de que se cante la última palabra del anterior: su comienzo estimado
    (un poco antes de la primera palabra que calzó) le ganaba a esa palabra, que quedaba sin marcar. Espera
    0,3 s después de ella, pero nunca más allá de su propia primera palabra."""
    for p, q in zip(points, points[1:]):
        if len(p) > 2 and len(q) > 2 and q[1] != p[1] and q[0] < p[2][-1][1] + 0.3:
            q[0] = round(max(q[0], min(p[2][-1][1] + 0.3, q[2][0][1])), 2)
    return sorted(points, key=lambda p: p[0])


def line_points(t: float, line: int, words: list, sheet_lines: list, lyric_order: list) -> list[list]:
    """Los puntos de una línea cantada sobre la hoja: [[segundo, renglón, anclas], ...].

    El renglón se ilumina cuando se canta su primera palabra (el karaoke muestra la línea antes). Y la
    hoja a veces parte en dos renglones lo que se canta como una línea ("Tus palabras se tornan cristal,"
    / "no las voy a entender"): las palabras que no están en el renglón calzado se buscan en el
    renglón de letra anterior y en el siguiente, que también reciben su tiempo.
    """
    used = set()
    anchors = word_anchors(sheet_lines[line], words, used)
    if crammed(anchors):
        return []
    if not anchors:
        return [[round(t, 2), line]]
    first_col, first_time = anchors[0]
    # Si el renglón empieza con palabras que no calzaron, empieza un poco antes de la primera que sí
    points = [[round(max(t, first_time - min(first_col * 0.06, 1.5)), 2), line, anchors]]
    rest = [w if k not in used else ['', 0] for k, w in enumerate(words)]
    if len(used) < 0.8 * len([w for w, _ in words if norm(w)]):
        j = lyric_order.index(line)
        for n, before in ((lyric_order[j - 1] if j > 0 else None, True),
                          (lyric_order[j + 1] if j + 1 < len(lyric_order) else None, False)):
            if n is None:
                continue
            extra = word_anchors(sheet_lines[n], rest)
            n_words = len(norm(html.unescape(re.sub(r'<[^>]+>', '', sheet_lines[n]))).split())
            in_order = extra and (extra[-1][1] < anchors[0][1] if before else extra[0][1] > anchors[-1][1])
            if len(extra) >= 2 and len(extra) >= 0.6 * n_words and in_order:
                points.append([extra[0][1], n, extra])
    return sorted(points)


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
    # Lo que pinta tu video karaoke manda: es la misma letra y los mismos tiempos que se ven en el video
    karaoke = json.loads(KARAOKE_FILE.read_text(encoding='utf-8')) if KARAOKE_FILE.exists() else {}
    # ...salvo donde esos subtítulos fallaron (muchas palabras amontonadas) y Whisper sí alineó la canción
    karaoke = {url: k for url, k in karaoke.items()
               if k.get('amontonadas', 0) <= 0.10 or not aligned.get(url, {}).get('lrc')}
    aligned = {**aligned, **karaoke}

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
            lyric_order = [k for k, _ in sheet_lyric_lines(sheet['content'])]
            sync_points[url] = []
            for j, (t, line, i) in enumerate(points):
                if not any(words[i:i + 1]):  # sin el tiempo de cada palabra: el renglón calzado, entero
                    sync_points[url].append([round(t + shift, 2), line])
                    continue
                # El tramo hasta la próxima línea calzada: lo cantado entre medio (aunque no haya calzado
                # sola) va sobre los renglones de la hoja que hay entre medio
                next_i, next_line = (points[j + 1][2], points[j + 1][1]) if j + 1 < len(points) else (len(lrc), None)
                k = lyric_order.index(line)
                first_i = 0 if j == 0 else i  # lo cantado antes de la primera línea que calzó también cuenta
                if next_line is not None and next_line > line:
                    # Hasta la próxima línea calzada incluida: la hoja puede escribir en un renglón anterior
                    # el comienzo de esa línea cantada ("Tus palabras se tornan cristal," / "no las voy...");
                    # lo que se canta desde la próxima línea lo pone su propio tramo. Y un poco más allá: el
                    # karaoke junta en una línea lo que la hoja escribe en tres ("But if you close your eyes
                    # (Eheu...), does it almost feel like nothing changed at all?") y la próxima línea puede
                    # haber calzado con uno de esos renglones; los que se cantan antes de ella son de este tramo
                    after = points[j + 2][1] if j + 2 < len(points) and points[j + 2][1] > next_line else next_line
                    region = [x for x in lyric_order[k:] if x <= after]
                    next_start = words[next_i][0][1] if words[next_i:next_i + 1] and words[next_i] else t
                    found = [p for p in region_points(words[first_i:next_i + 1], sheet_lines, region)
                             if p[1] < next_line or p[2][0][1] < next_start]
                else:  # vuelve a una parte escrita más arriba, o es el final: tantos renglones como lo cantado
                    region = lyric_order[k:k + (next_i - i) + 1]
                    found = region_points(words[first_i:next_i], sheet_lines, region)
                sync_points[url] += found or line_points(t, line, words[i], sheet_lines, lyric_order)
            sync_points[url] = no_early(merge_rows(sync_points[url]))
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
