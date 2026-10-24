"""Prueba de concepto: ¿la hoja de acordes coincide con lo que suena en el video?

Paso 1: acordes de la hoja -> plantillas de notas; audio -> croma (energía de cada una de las
12 notas en el tiempo); ¿en qué tono calza la hoja y qué tanto explica lo que suena?
"""
import html
import json
import re
import sys
from pathlib import Path

import librosa
import numpy as np
import scipy.ndimage

ROOT = Path(__file__).resolve().parents[2]  # la carpeta del proyecto (también en un worktree de git)
SCRATCH = Path(__file__).parent
sys.path.insert(0, str(ROOT))

NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
LETTER = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
SOLFEGE = {'DO': 0, 'RE': 2, 'MI': 4, 'FA': 5, 'SOL': 7, 'LA': 9, 'SI': 11}
HOP, SR = 2048, 22050


def parse_note(s):
    """'F#' / 'SIb' / 'Sol' -> (clase de altura 0-11, resto del texto) o None."""
    m = re.match(r'^(DO|RE|MI|FA|SOL|LA|SI)', s, re.I)
    if m:
        pc, rest = SOLFEGE[m.group(1).upper()], s[m.end():]
    elif s[:1] in LETTER:
        pc, rest = LETTER[s[0]], s[1:]
    else:
        return None
    while rest[:1] in ('#', 'b'):
        pc += 1 if rest[0] == '#' else -1
        rest = rest[1:]
    return pc % 12, rest


def parse_chord(name):
    """'F#m7' / 'SOLm' / 'A7M' / 'D/F#' / 'A7(4)' -> (raíz, intervalos, bajo) o None."""
    main, _, bass = name.strip().partition('/')
    root = parse_note(main)
    if not root:
        return None
    pc, q = root
    minor = bool(re.match(r'^(m(?!aj)|min|-)', q))
    q_low = re.sub(r'^(m(?!aj)|min|-)', '', q)
    ivs = {0, 3 if minor else 4, 7}
    if re.match(r'^(sus4|4)', q_low) or '(4)' in q_low or 'sus4' in q_low:
        ivs = {0, 5, 7}
    elif re.match(r'^(sus2|2)', q_low):
        ivs = {0, 2, 7}
    elif re.match(r'^5', q_low):
        ivs = {0, 7}
    if re.search(r'dim|°|º', q_low):
        ivs = {0, 3, 6}
    if re.search(r'aug|\+|#5', q_low):
        ivs = (ivs - {7}) | {8}
    if re.search(r'7M|maj7|Maj7', q) or re.match(r'^M7', q):
        ivs |= {11}
    elif '7' in q_low:
        ivs |= {10}
    if 'b5' in q_low:
        ivs = (ivs - {7}) | {6}
    if re.search(r'(^|\(|add)9', q_low):
        ivs |= {2}
    bass_pc = parse_note(bass)[0] if bass and parse_note(bass) else None
    return pc, frozenset(ivs), bass_pc


def template(chord, shift=0):
    pc, ivs, bass = chord
    t = np.zeros(12)
    for iv in ivs:
        t[(pc + iv + shift) % 12] = 1.0 if iv in (0, 3, 4) else 0.8 if iv in (7, 6, 8, 5, 2) else 0.6
    if bass is not None:
        t[(bass + shift) % 12] += 0.5
    return t / np.linalg.norm(t)


TRIADS = [(r, frozenset({0, 4, 7}), None) for r in range(12)] + [(r, frozenset({0, 3, 7}), None) for r in range(12)]
TRIAD_NAMES = NAMES + [n + 'm' for n in NAMES]


FLAT_TO_SHARP = {'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B', 'Fb': 'E',
                 'Reb': 'Do#', 'Mib': 'Re#', 'Solb': 'Fa#', 'Lab': 'Sol#', 'Sib': 'La#', 'Dob': 'Si', 'Fab': 'Mi'}


def sharp(name):
    """Regla del cancionero: siempre sostenidos, nunca bemoles (Bb -> A#, Fm/Ab -> Fm/G#)."""
    return re.sub(r'(^|/)(Do|Re|Mi|Fa|Sol|La|Si|[A-G])b', lambda m: m.group(1) + FLAT_TO_SHARP[m.group(2) + 'b'], name)


def sheet_chords(content):
    """Acordes de la hoja en orden: [(línea, nombre en sostenidos, acorde)] y la cejilla indicada (0 si no dice)."""
    out = []
    for i, line in enumerate(content.split('\n')):
        for name in re.findall(r'<span class="chord">(.*?)</span>', line):
            name = sharp(html.unescape(name).strip())
            c = parse_chord(name)
            if c:
                out.append((i, name, c))
    text = re.sub(r'<[^>]+>', ' ', content)
    m = re.search(r'(?:capo|cejilla|capotraste)[^\d\n]{0,25}(\d{1,2})', text, re.I)
    return out, int(m.group(1)) if m else 0


def _chroma(y, fmin, n_octaves):
    C = librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=HOP, bins_per_octave=36,
                                   fmin=librosa.note_to_hz(fmin), n_octaves=n_octaves)
    C = scipy.ndimage.median_filter(C, size=(1, 7))  # ~0,6 s
    return C / (np.linalg.norm(C, axis=0, keepdims=True) + 1e-9)


def audio_chroma(path, hpss=True, bass=None, bass_weight=0.5):
    """Croma (energía de las 12 notas en el tiempo). hpss quita los golpes de batería de una mezcla;
    `bass` (stem del bajo) suma la nota del bajo, que marca la raíz del acorde."""
    y, _ = librosa.load(path, sr=SR, mono=True)
    yh = librosa.effects.harmonic(y, margin=3) if hpss else y
    C = _chroma(yh, 'C2', 6)
    if bass:
        yb, _ = librosa.load(bass, sr=SR, mono=True)
        B = _chroma(yb, 'C1', 4)
        m = min(C.shape[1], B.shape[1])
        C = C[:, :m] + bass_weight * B[:, :m]
        C = C / (np.linalg.norm(C, axis=0, keepdims=True) + 1e-9)
    energy = librosa.feature.rms(y=yh, frame_length=HOP * 2, hop_length=HOP)[0][:C.shape[1]]
    C = C[:, :len(energy)]
    voiced = energy > 0.15 * np.median(energy)
    times = librosa.frames_to_time(np.arange(C.shape[1]), sr=SR, hop_length=HOP)
    return C, voiced, times


def free_recognition(C):
    """Acorde mayor/menor más probable en cada momento, suavizado (Viterbi)."""
    T = np.array([template(c) for c in TRIADS])
    S = T @ C
    P = np.exp(18 * S)
    P /= P.sum(axis=0, keepdims=True)
    path = librosa.sequence.viterbi(P, librosa.sequence.transition_loop(len(TRIADS), 0.97))
    return S, path


def key_fit(C, voiced, chords, triad_S):
    """Para cada transposición k: qué tanto explican los acordes de la hoja lo que suena."""
    uniq = list({c for _, _, c in chords})
    ceiling = triad_S[:, voiced].max(axis=0).mean()
    fits = []
    for k in range(12):
        V = np.array([template(c, k) for c in uniq])
        fits.append((V @ C[:, voiced]).max(axis=0).mean())
    best = int(np.argmax(fits))
    return best, fits[best] / ceiling, [f / ceiling for f in fits]


def segments(path, times, min_len=1.0):
    segs, start = [], 0
    for i in range(1, len(path) + 1):
        if i == len(path) or path[i] != path[start]:
            if times[min(i, len(times) - 1)] - times[start] >= min_len:
                segs.append((round(float(times[start]), 1), TRIAD_NAMES[path[start]]))
            start = i
    return segs



def align_sequence(C, voiced, chords, k, skip_cost=2.0):
    """Alinea en orden la secuencia de acordes de la hoja con el audio (programación dinámica).

    Estados: intro (antes de la hoja), cada acorde de la hoja, outro (después). Cada cuadro se queda
    en el acorde actual o avanza al siguiente; saltarse un acorde de la hoja cuesta skip_cost.
    Devuelve, por acorde de la hoja: (inicio en segundos, duración, qué tan bien calza).
    """
    T = np.array([template(c, k) for _, _, c in chords])
    E = T @ C
    E[:, ~voiced] = np.median(E[:, voiced])
    n, m = E.shape
    floor = np.percentile(E[:, voiced], 35)  # puntaje de un cuadro que no es parte de la hoja
    NEG = -1e18
    D = np.full(n + 2, NEG); D[0] = 0.0
    back = np.zeros((m, n + 2), dtype=np.int32)
    emit = np.empty(n + 2)
    for t in range(m):
        emit[0] = emit[n + 1] = floor
        emit[1:n + 1] = E[:, t]
        stay = D
        adv = np.concatenate(([NEG], D[:-1]))
        skip = np.concatenate(([NEG, NEG], D[:-2])) - skip_cost
        best = np.maximum(np.maximum(stay, adv), skip)
        back[t] = np.where(best == stay, 0, np.where(best == adv, 1, 2))
        D = best + emit
    s = int(np.argmax(D)); states = np.empty(m, dtype=np.int32)
    for t in range(m - 1, -1, -1):
        states[t] = s
        s -= back[t, s]
    return states, E


def report_alignment(states, E, C, voiced, times, chords, triad_S):
    n = len(chords)
    best_any = triad_S.max(axis=0)
    in_sheet = (states >= 1) & (states <= n)
    occ = {}
    for t in np.where(in_sheet)[0]:
        occ.setdefault(states[t] - 1, []).append(t)
    rows = []
    for i in range(n):
        fr = occ.get(i)
        if not fr:
            rows.append((i, None, 0.0, None)); continue
        fit = float(np.mean(E[i, fr] / (best_any[fr] + 1e-9)))
        rows.append((i, float(times[fr[0]]), float(times[fr[-1]] - times[fr[0]]), fit))
    v = in_sheet & voiced
    agree = np.mean(E[states[v] - 1, np.where(v)[0]] >= 0.92 * best_any[v]) if v.any() else 0
    return rows, float(agree), float(times[np.where(in_sheet)[0][0]]) if in_sheet.any() else None,         float(times[np.where(in_sheet)[0][-1]]) if in_sheet.any() else None


def diagnose(states, E, C, voiced, times, chords, triad_S, k, sync_points):
    """Qué suena de verdad bajo cada acorde de la hoja, tramos que calzan mal y desfase con la letra."""
    n = len(chords)
    best_any = triad_S.max(axis=0)
    out = []
    # 1. por nombre de acorde: qué tríada explica mejor esos momentos
    by_name = {}
    for t in np.where((states >= 1) & (states <= n) & voiced)[0]:
        by_name.setdefault(chords[states[t] - 1][1], []).append(t)
    for name, fr in sorted(by_name.items(), key=lambda kv: -len(kv[1])):
        votes = np.bincount(triad_S[:, fr].argmax(axis=0), minlength=24)
        top = int(votes.argmax())
        sheet_says = TRIAD_NAMES[(chords[[i for i, c in enumerate(chords) if c[1] == name][0]][2][0] + k) % 12]
        out.append(f'    {name:6} ({len(fr) * HOP / SR:5.1f}s) -> suena sobre todo {TRIAD_NAMES[top]} ({votes[top] / len(fr):.0%})')
    # 2. tramos de 8 s con calce bajo
    fit = np.where((states >= 1) & (states <= n), E[np.clip(states - 1, 0, n - 1), np.arange(len(states))] / (best_any + 1e-9), np.nan)
    win = int(8 * SR / HOP)
    bad = []
    for a in range(0, len(fit) - win, win):
        seg = fit[a:a + win][voiced[a:a + win]]
        if len(seg) and np.nanmean(seg) < 0.8:
            bad.append(f'{times[a]:.0f}-{times[a + win]:.0f}s ({np.nanmean(seg):.0%})')
    out.append('    tramos con calce bajo: ' + (', '.join(bad) if bad else 'ninguno'))
    d = line_offsets(states, times, chords, sync_points)
    if len(d):
        out.append(f'    desfase acordes del video vs letra con tiempos: mediana {np.median(d):+.1f}s, '
                   f'dispersión {np.percentile(d, 75) - np.percentile(d, 25):.1f}s ({len(d)} líneas)')
    return out


def line_offsets(states, times, chords, sync_points):
    """Desfase (s) entre donde el audio pone cada línea de acordes y el tiempo de la letra que va
    debajo (sync_points: [(segundo, línea de la hoja)]). Positivo: el audio llega después que la letra."""
    n = len(chords)
    starts = {}
    for t in range(len(states)):
        if 1 <= states[t] <= n and states[t] - 1 not in starts:
            starts[states[t] - 1] = times[t]
    line_start = {}
    for i, (line, _, _) in enumerate(chords):
        if i in starts and line not in line_start:
            line_start[line] = starts[i]
    return np.array([line_start[L - 1] - t for t, L in sync_points if L - 1 in line_start] +
                    [line_start[L] - t for t, L in sync_points if L in line_start and L - 1 not in line_start])

if __name__ == '__main__':
    pre = json.loads((ROOT / 'client/public/preloaded_songs.json').read_text(encoding='utf-8'))
    sync = json.loads((ROOT / 'client/public/sync_points.json').read_text(encoding='utf-8'))
    songs = {'fenix': 'https://www.cifraclub.com/tronic/fenix/',
             'el_tesoro': 'https://acordes.lacuerda.net/mato_a_un_policia_motorizado/el_tesoro-4.shtml',
             'bailando_solo': 'https://www.cifraclub.com/los-bunkers/bailando-solo/'}
    for name, url in songs.items():
        chords, capo = sheet_chords(pre[url]['content'])
        C, voiced, times = audio_chroma(str(SCRATCH / 'audio' / f'{name}.wav'))
        S, path = free_recognition(C)
        k, fit, fits = key_fit(C, voiced, chords, S)
        print(f'\n=== {name}: {len(chords)} acordes en la hoja ({len({n for _, n, _ in chords})} distintos), cejilla indicada: {capo}')
        print(f'  mejor transposición: +{k} semitonos | esperada por la cejilla: +{capo % 12} | la hoja explica el {fit:.0%} de lo que suena')
        print('  calce por transposición:', ' '.join(f'+{i}:{f:.0%}' for i, f in enumerate(fits)))
        print('  hoja (primeros):', ' '.join(n for _, n, _ in chords[:16]))
        print('  audio (primeros):', ' '.join(f'{t}s:{c}' for t, c in segments(path, times)[:16]))
        print('  acordes distintos de la hoja:', sorted({n for _, n, _ in chords}))
        for kk in sorted({0, capo % 12, k}):
            states, E = align_sequence(C, voiced, chords, kk)
            rows, agree, t0, t1 = report_alignment(states, E, C, voiced, times, chords, S)
            fits = [r[3] for r in rows if r[3] is not None]
            skipped = sum(1 for r in rows if r[1] is None)
            print(f'  alineando con +{kk}: la hoja suena de {t0:.0f}s a {t1:.0f}s (audio {times[-1]:.0f}s) | '
                  f'calce medio {np.mean(fits):.0%} | acordes que coinciden con el mejor posible {agree:.0%} | acordes de la hoja saltados {skipped}/{len(rows)}')
            print('\n'.join(diagnose(states, E, C, voiced, times, chords, S, kk, sync.get(url, []))))

