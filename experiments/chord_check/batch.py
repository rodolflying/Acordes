"""Revisión de acordes de todas las canciones con pista: ¿la hoja coincide con lo que suena en tu video?

Por canción:
1. Baja el audio del video que la app muestra por defecto (Karaoke; si no hay, Instrumental).
2. Demucs (GPU) lo separa; nos quedamos con "other" (guitarras, teclados) y el bajo, que marca la raíz.
3. Croma (12 notas en el tiempo), guardado en audio/cache/<video>.npz; el audio se borra.
4. Tono que calza, qué tanto coinciden los acordes de la hoja con lo que suena, acordes que suenan
   distinto (mayor/menor cambiado, otra raíz) y desfase de la letra con tiempos respecto del video.

Uso:  python batch.py              (todas; retoma lo que ya está en caché)
      python batch.py fenix talk   (solo las URL que contengan esas palabras)
Resultado: results.json (una entrada por URL).
"""
import html
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import librosa
import numpy as np
import scipy.ndimage

from chordcheck import (HOP, NAMES, ROOT, SCRATCH, SR, TRIAD_NAMES, _chroma, align_sequence,
                        free_recognition, key_fit, parse_chord, report_alignment, sharp, sheet_chords,
                        template)

CACHE = SCRATCH / 'audio' / 'cache'
TMP = SCRATCH / 'audio' / 'tmp'
RESULTS = SCRATCH / 'results.json'
FRAME = HOP / SR

_model = None


def separate(path):
    """Demucs htdemucs en la GPU -> {other, bass, vocals} mono a SR."""
    global _model
    import torch
    from demucs.apply import apply_model
    from demucs.audio import AudioFile
    from demucs.pretrained import get_model
    if _model is None:
        _model = get_model('htdemucs').cuda().eval()
    wav = AudioFile(path).read(streams=0, samplerate=_model.samplerate, channels=_model.audio_channels)
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / ref.std()
    with torch.no_grad():
        out = apply_model(_model, wav[None], device='cuda', shifts=1, split=True, overlap=0.25)[0]
    out = out * ref.std() + ref.mean()
    stems = {name: librosa.resample(out[i].mean(0).cpu().numpy(), orig_sr=_model.samplerate, target_sr=SR)
             for i, name in enumerate(_model.sources) if name != 'drums'}
    return stems


def chroma_for_video(video_id):
    """Croma de other + bajo y energía de la voz del video (con caché).
    Devuelve (C, voiced, times, duración, voz) con voz = energía de la voz guía por cuadro (None si no tiene)."""
    cached = CACHE / f'{video_id}.npz'
    if not cached.exists():
        TMP.mkdir(parents=True, exist_ok=True)
        subprocess.run(['yt-dlp', '-q', '--no-warnings', '-f', 'bestaudio', '-o', str(TMP / f'{video_id}.%(ext)s'),
                        f'https://www.youtube.com/watch?v={video_id}'], check=True)
        audio = next(TMP.glob(f'{video_id}.*'))
        stems = separate(str(audio))
        other, bass = stems['other'], stems['bass']
        C = _chroma(other, 'C2', 6) + 0.5 * _chroma(bass, 'C1', 4)
        C = C / (np.linalg.norm(C, axis=0, keepdims=True) + 1e-9)
        energy = librosa.feature.rms(y=other, frame_length=HOP * 2, hop_length=HOP)[0]
        vocal = librosa.feature.rms(y=stems['vocals'], frame_length=HOP * 2, hop_length=HOP)[0]
        m = min(C.shape[1], len(energy), len(vocal))
        CACHE.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(cached, C=C[:, :m].astype(np.float32), energy=energy[:m].astype(np.float32),
                            vocal=vocal[:m].astype(np.float32), duration=len(other) / SR)
        shutil.rmtree(TMP, ignore_errors=True)
    d = np.load(cached)
    C, energy, vocal = d['C'], d['energy'], d['vocal']
    voiced = energy > 0.15 * np.median(energy)
    times = librosa.frames_to_time(np.arange(C.shape[1]), sr=SR, hop_length=HOP)
    # Un video Instrumental no tiene voz: lo que deja Demucs ahí es ruido muy por debajo de la música
    has_voice = np.percentile(vocal, 90) > 0.1 * np.percentile(energy, 90)
    return C, voiced, times, float(d['duration']), vocal if has_voice else None


def chord_columns(content):
    """{línea: [(columna, nombre en sostenidos, acorde)]} y el texto plano de cada línea."""
    cols, plain = {}, []
    for i, line in enumerate(content.split('\n')):
        col, text, in_chord = 0, [], False
        for tok in re.split(r'(<[^>]+>)', line):
            if tok.startswith('<'):
                in_chord = tok.startswith('<span class="chord"')
                continue
            tok = html.unescape(tok)
            if in_chord and tok.strip():
                c = parse_chord(sharp(tok.strip()))
                if c:
                    cols.setdefault(i, []).append((col, sharp(tok.strip()), c))
            col += len(tok)
            text.append(tok)
        plain.append(''.join(text))
    return cols, plain


def anchored_offset(C, voiced, content, sync_points, k, best_any, span=8.0):
    """Desfase de la letra con tiempos respecto del video, medido con los acordes.

    Cada acorde se ubica en el tiempo de la línea de letra que va debajo (según su columna) y se
    corre todo en bloque entre -span y +span s: el corrimiento con el que mejor suenan es el desfase.
    Al revés que alinear la hoja libremente, no se confunde con las vueltas de un loop de acordes.
    Devuelve (desfase, calce con ese desfase, calce sin corregir, nitidez del máximo) o None.
    """
    cols, plain = chord_columns(content)
    pts = sorted(sync_points)
    events = []
    for j, (t, L) in enumerate(pts):
        above = cols.get(L - 1)
        if not above or L >= len(plain):
            continue
        n = max(len(plain[L].rstrip()), 1)
        t_next = pts[j + 1][0] if j + 1 < len(pts) else t + 6
        dur = min(t_next - t, 0.15 * n + 1.5)
        starts = [t + dur * min(col / n, 0.95) for col, _, _ in above]
        ends = starts[1:] + [t + dur]
        for (col, name, c), s, e in zip(above, starts, ends):
            events.append((s, min(e, s + 4), c))
    if len(events) < 8:
        return None
    ratio = {}
    for _, _, c in events:
        if c not in ratio:
            r = (template(c, k) @ C) / (best_any + 1e-9)
            ratio[c] = np.concatenate(([0], np.cumsum(np.where(voiced, r, 0))))  # sumas acumuladas
    cum_v = np.concatenate(([0], np.cumsum(voiced)))
    shifts = np.arange(-span, span + 1e-9, 0.1)
    scores = []
    m = C.shape[1]
    for d in shifts:
        tot = cnt = 0.0
        for s, e, c in events:
            a, b = int(round((s + d) / FRAME)), int(round((e + d) / FRAME))
            a, b = max(a, 0), min(b, m)
            if b <= a:
                continue
            tot += ratio[c][b] - ratio[c][a]
            cnt += cum_v[b] - cum_v[a]
        scores.append(tot / cnt if cnt else 0)
    scores = np.array(scores)
    i = int(np.argmax(scores))
    far = np.abs(shifts - shifts[i]) > 1.5
    sharpness = float(scores[i] - scores[far].max()) if far.any() else 0.0
    return float(shifts[i]), float(scores[i]), float(scores[np.argmin(np.abs(shifts))]), sharpness


def vocal_offset(vocal, lrc_times, span=10.0):
    """Desfase de la letra con tiempos (LRCLIB) respecto del video, medido con la voz guía del Karaoke.

    Se corre la letra en bloque entre -span y +span s y se compara con la voz de dos formas: cada línea
    se canta desde su tiempo hasta la siguiente (máx. 5 s), y cada línea empieza donde la voz entra.
    Lo segundo da el máximo nítido. Positivo: en el video se canta después de lo que dice la letra.
    Usa todas las líneas de la letra: con solo las que calzaron con la hoja, los huecos confunden.
    Devuelve (desfase, ancho del máximo, calce de los inicios sin corregir y corregido) o None.
    """
    pts = sorted(set(lrc_times))
    if len(pts) < 8:
        return None
    m = len(vocal)
    lv = np.log(vocal + 1e-4)
    z = (lv - lv.mean()) / (lv.std() + 1e-9)
    smooth = scipy.ndimage.gaussian_filter1d(lv, 1.5)
    onset = np.maximum(np.diff(smooth, prepend=smooth[0]), 0)  # la voz entra
    shifts = np.arange(-span, span + 1e-9, 0.05)
    act_c, ons_c = [], []
    for d in shifts:
        act, imp = np.zeros(m), np.zeros(m)
        for j, t in enumerate(pts):
            end = min(pts[j + 1] if j + 1 < len(pts) else t + 4, t + 5)
            a, b = int(round((t + d) / FRAME)), int(round((end + d) / FRAME))
            act[min(max(a, 0), m):min(max(b, 0), m)] = 1
            if 0 <= a < m:
                imp[a] = 1
        imp = scipy.ndimage.gaussian_filter1d(imp, 1.5)
        act_c.append(np.corrcoef(act, z)[0, 1] if 0 < act.sum() < m else 0.0)
        ons_c.append(np.corrcoef(imp, onset)[0, 1] if imp.any() else 0.0)
    act_c, ons_c = np.nan_to_num(act_c), np.nan_to_num(ons_c)
    total = act_c + ons_c
    i, i0 = int(np.argmax(total)), int(np.argmin(np.abs(shifts)))
    peak = shifts[total >= total[i] - 0.25 * (total[i] - np.median(total))]
    return float(shifts[i]), float(peak.max() - peak.min()), float(ons_c[i0]), float(ons_c[i])

def reentry_offset(vocal, lrc_times, shift):
    """Comprobación independiente del desfase: dónde vuelve a entrar la voz después de cada pausa
    larga de la letra (y al principio), tomando la entrada más cercana a `shift`. Devuelve la mediana."""
    lv = scipy.ndimage.gaussian_filter1d(np.log(vocal + 1e-4), 2)
    on = lv > np.percentile(lv, 30) + 0.5 * (np.percentile(lv, 90) - np.percentile(lv, 30))
    starts = np.where(on[1:] & ~on[:-1])[0] * FRAME + FRAME
    pts = sorted(set(lrc_times))
    entries = [pts[0]] + [b for a, b in zip(pts, pts[1:]) if b - a >= 4]
    deltas = []
    for t in entries:
        cand = starts[np.abs(starts - t) < 12] - t
        if len(cand):
            deltas.append(cand[np.argmin(np.abs(cand - shift))])
    return float(np.median(deltas)) if deltas else None


def chord_report(states, C, voiced, chords, k, triad_S):
    """Por acorde de la hoja (en su propio tono): qué suena de verdad bajo él."""
    n = len(chords)
    by_name = {}
    for t in np.where((states >= 1) & (states <= n) & voiced)[0]:
        _, name, c = chords[states[t] - 1]
        by_name.setdefault(name, (c, []))[1].append(t)
    rows = []
    for name, (c, fr) in sorted(by_name.items(), key=lambda kv: -len(kv[1][1])):
        secs = len(fr) * FRAME
        root, ivs, _ = c
        votes = np.bincount(triad_S[:, fr].argmax(axis=0), minlength=24) / len(fr)
        top = int(votes.argmax())
        heard = TRIAD_NAMES[(top % 12 - k) % 12 + (12 if top >= 12 else 0)]  # en el tono de la hoja
        prof = C[:, fr].mean(axis=1)
        maj3, min3 = prof[(root + k + 4) % 12], prof[(root + k + 3) % 12]
        third = 'menor' if min3 > maj3 * 1.5 else 'mayor' if maj3 > min3 * 1.5 else 'dudoso'
        sheet_quality = 'mayor' if 4 in ivs else 'menor' if 3 in ivs else None
        expected = (root + k) % 12 + (12 if sheet_quality == 'menor' else 0)
        issue = None
        if secs >= 6 and sheet_quality and third not in ('dudoso', sheet_quality):
            issue = f'suena {NAMES[root]}{"m" if third == "menor" else ""}'
        elif secs >= 6 and top % 12 != (root + k) % 12 and votes[top] >= 0.5 and votes[expected] < 0.2:
            issue = f'suena {heard}'
        elif (secs >= 6 and sheet_quality and top % 12 == (root + k) % 12 and top != expected
              and votes[top] >= 0.35 and votes[expected] < 0.5 * votes[top]):
            issue = f'quizás {heard}'  # la tercera no es concluyente, pero el reconocedor oye el paralelo
        rows.append({'acorde': name, 'segundos': round(secs, 1), 'suena_mas': heard,
                     'proporcion': round(float(votes[top]), 2), 'tercera': third, 'problema': issue})
    return rows


def analyze(url, content, sync_points, lrc_times, video_id):
    chords, capo = sheet_chords(content)
    if len(chords) < 4:
        return {'estado': 'sin acordes en la hoja'}
    C, voiced, times, duration, vocal = chroma_for_video(video_id)
    S, _ = free_recognition(C)
    best_any = S.max(axis=0)
    _, _, fits = key_fit(C, voiced, chords, S)
    best = None
    for k in np.argsort(fits)[::-1][:3]:  # entre los 3 tonos más probables manda la secuencia completa
        states, E = align_sequence(C, voiced, chords, int(k))
        _, agree, t0, t1 = report_alignment(states, E, C, voiced, times, chords, S)
        if best is None or agree > best[0]:
            best = (agree, int(k), states, t0, t1)
    agree, k, states, t0, t1 = best
    off = anchored_offset(C, voiced, content, sync_points, k, best_any) if sync_points else None
    voff = vocal_offset(vocal, lrc_times) if lrc_times and vocal is not None else None
    reentry = reentry_offset(vocal, lrc_times, voff[0]) if voff else None
    return {
        'estado': 'ok', 'video': video_id, 'duracion': round(duration),
        'acordes_hoja': len(chords), 'distintos': len({n for _, n, _ in chords}), 'cejilla': capo,
        'transposicion': k, 'calce_tono': round(float(fits[k]), 3), 'coinciden': round(agree, 3),
        'hoja_suena_desde': round(t0 or 0), 'hoja_suena_hasta': round(t1 or 0),
        'desfase_acordes': None if off is None else {'segundos': round(off[0], 1), 'calce': round(off[1], 3),
                                                     'calce_sin_corregir': round(off[2], 3), 'nitidez': round(off[3], 3)},
        'desfase_voz': None if voff is None else {'segundos': round(voff[0], 2), 'ancho': round(voff[1], 2),
                                                  'inicios_sin_corregir': round(voff[2], 3), 'inicios_corregido': round(voff[3], 3),
                                                  'reentradas': None if reentry is None else round(reentry, 2)},
        'acordes': chord_report(states, C, voiced, chords, k, S),
    }


if __name__ == '__main__':
    pre = json.loads((ROOT / 'client/public/preloaded_songs.json').read_text(encoding='utf-8'))
    sync = json.loads((ROOT / 'client/public/sync_points.json').read_text(encoding='utf-8'))
    tracks = json.loads((ROOT / 'client/public/backing_tracks.json').read_text(encoding='utf-8'))['backing_tracks']
    enriched = json.loads((ROOT / 'client/public/enriched_songs.json').read_text(encoding='utf-8'))['songs']
    lrclib = json.loads((ROOT / 'lrclib_cache.json').read_text(encoding='utf-8'))
    sys.path.insert(0, str(ROOT))
    from lyrics_sync import parse_lrc
    results = json.loads(RESULTS.read_text(encoding='utf-8')) if RESULTS.exists() else {}
    filters = sys.argv[1:]
    todo = [u for u in tracks if u in pre and (not filters or any(f in u for f in filters))]
    print(f'{len(todo)} canciones con pista y hoja', flush=True)
    for i, url in enumerate(todo, 1):
        versions = tracks[url]
        video = (versions.get('Karaoke') or versions.get('Instrumental') or next(iter(versions.values())))['id']
        t = time.time()
        try:
            song = enriched.get(url, {})
            lrc = lrclib.get(f"{song.get('artist')}|{song.get('title')}") if url in sync else None
            lrc_times = [t for t, line in parse_lrc(lrc) if line.strip()] if lrc else []
            r = analyze(url, pre[url].get('content') or '', sync.get(url, []), lrc_times, video)
        except Exception as e:  # una canción que falla no corta el lote
            r = {'estado': f'error: {type(e).__name__}: {e}'[:300]}
        results[url] = r
        RESULTS.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding='utf-8')
        if r['estado'] == 'ok':
            d, dv = r['desfase_acordes'], r['desfase_voz']
            flags = [f"{a['acorde']}: {a['problema']}" for a in r['acordes'] if a['problema']]
            print(f"[{i}/{len(todo)}] {url.split('.com')[-1][:45]:45} coinciden {r['coinciden']:.0%} | +{r['transposicion']} | "
                  f"desfase voz {dv['segundos'] if dv else '—'}s (ancho {dv['ancho'] if dv else '—'}) "
                  f"acordes {d['segundos'] if d else '—'}s (nitidez {d['nitidez'] if d else '—'}) | {'; '.join(flags) or 'sin alertas'} "
                  f"({time.time() - t:.0f}s)", flush=True)
        else:
            print(f"[{i}/{len(todo)}] {url[:60]} -> {r['estado']}", flush=True)
