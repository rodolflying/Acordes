"""¿Qué audio conviene para revisar acordes? Misma hoja, mismo análisis, distintas fuentes:

- el Instrumental de YouTube (bajo + batería + other, la batería se quita con un filtro)
- el stem "other" real del proyecto Karaokes (guitarras, teclados; sin bajo ni batería)
- el "other" que saca Demucs del Instrumental de YouTube (lo que podríamos hacer para las 63 canciones)
- cada "other" más su bajo, que marca la raíz del acorde

Además mide si el stem real está corrido respecto del video (el desfase se calibra contra el video).
"""
import json
import sys
from pathlib import Path

import librosa
import numpy as np

from chordcheck import (ROOT, SCRATCH, SR, HOP, TRIAD_NAMES, align_sequence, audio_chroma,
                        free_recognition, key_fit, line_offsets, report_alignment, sheet_chords)

KARAOKES = Path(r'C:\Users\usuario\Desktop\Software development\_WORK_\Karaokes\py_karaoke_v2\outputs')
AUDIO = SCRATCH / 'audio'
SONGS = {  # nombre: (hoja, carpeta de stems en Karaokes)
    'el_tesoro': ('https://acordes.lacuerda.net/mato_a_un_policia_motorizado/el_tesoro-4.shtml',
                  'el tesoro  el mató a un policía motorizado  letra'),
    'un_coco': ('https://www.cifraclub.com/bad-bunny/un-coco/', 'Un Coco'),
    'talk_is_cheap': ('https://www.cifraclub.com/chet-faker/talk-is-cheap/', 'Talk is cheap'),
}


def lag_seconds(a_path, b_path):
    """Cuántos segundos hay que correr b para que calce con a (correlación de los ataques)."""
    sr, hop = 11025, 256
    envs = []
    for p in (a_path, b_path):
        y, _ = librosa.load(p, sr=sr, mono=True)
        envs.append(librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop))
    a, b = (e - e.mean() for e in envs)
    n = len(a) + len(b)
    xc = np.fft.irfft(np.fft.rfft(a, n) * np.conj(np.fft.rfft(b, n)), n)
    k = int(np.argmax(xc))
    if k > n // 2:
        k -= n
    return k * hop / sr, float(xc.max() / (np.linalg.norm(a) * np.linalg.norm(b)))


def analyze(chords, sync_points, source):
    C, voiced, times = source
    S, path = free_recognition(C)
    _, _, fits = key_fit(C, voiced, chords, S)
    # Una hoja subida una cuarta comparte casi todos los acordes, así que el puñado de acordes no basta
    # para decidir el tono: entre los 3 mejores manda la alineación de la secuencia completa
    best = None
    for k in np.argsort(fits)[::-1][:3]:
        states, E = align_sequence(C, voiced, chords, int(k))
        _, agree, _, _ = report_alignment(states, E, C, voiced, times, chords, S)
        if best is None or agree > best[0]:
            best = (agree, int(k), states)
    agree, k, states = best
    fit = fits[k]
    d = line_offsets(states, times, chords, sync_points)
    off = f'{np.median(d):+5.1f}s ±{(np.percentile(d, 75) - np.percentile(d, 25)) / 2:.1f}' if len(d) else '   —   '
    return k, fit, agree, off, path


if __name__ == '__main__':
    pre = json.loads((ROOT / 'client/public/preloaded_songs.json').read_text(encoding='utf-8'))
    sync = json.loads((ROOT / 'client/public/sync_points.json').read_text(encoding='utf-8'))
    only = sys.argv[1:] or list(SONGS)
    for name in only:
        url, folder = SONGS[name]
        chords, capo = sheet_chords(pre[url]['content'])
        real = KARAOKES / folder / 'audio'
        dem = AUDIO / 'demucs' / 'htdemucs' / f'{name}_inst'
        inst = AUDIO / f'{name}_inst.wav'
        if not chords:
            print(f'\n=== {name}: la hoja no tiene acordes (solo tablatura), se salta')
            continue
        lag, conf = lag_seconds(str(dem / 'other.wav'), str(real / 'other.mp3'))
        same_audio = conf >= 0.5
        print(f'\n=== {name}: {len(chords)} acordes en la hoja | stem real vs video: corrido {lag:+.2f}s (correlación {conf:.2f})'
              + ('' if same_audio else ' -> otra grabación, el desfase del stem real no se compara'))
        sources = {
            'Instrumental YouTube (filtro)': audio_chroma(str(inst)),
            'other real': audio_chroma(str(real / 'other.mp3'), hpss=False),
            'other real + bajo': audio_chroma(str(real / 'other.mp3'), hpss=False, bass=str(real / 'bass.mp3')),
            'other Demucs': audio_chroma(str(dem / 'other.wav'), hpss=False),
            'other Demucs + bajo': audio_chroma(str(dem / 'other.wav'), hpss=False, bass=str(dem / 'bass.wav')),
        }
        paths = {}
        print(f'  {"fuente":32} tono  calce  coinciden  desfase vs letra (mediana ± media dispersión)')
        for label, src in sources.items():
            if label.startswith('other real') and same_audio:  # al tiempo del video, para comparar el desfase
                C, voiced, times = src
                src = (C, voiced, times + lag)
            real_elsewhere = label.startswith('other real') and not same_audio
            k, fit, agree, off, path = analyze(chords, [] if real_elsewhere else sync.get(url, []), src)
            paths[label] = (path, src[2])
            print(f'  {label:32} +{k:<3} {fit:5.0%}  {agree:8.0%}   {off}')
        # ¿Demucs reconoce lo mismo que el stem real? (acorde libre cuadro a cuadro, ya alineados en el tiempo)
        if same_audio:
            (pr, tr), (pd, td) = paths['other real + bajo'], paths['other Demucs + bajo']
            idx = np.searchsorted(td, tr).clip(0, len(pd) - 1)
            ok = (tr >= td[0]) & (tr <= td[-1])
            print(f'  acorde reconocido igual con el stem real y con Demucs: {np.mean(pr[ok] == pd[idx[ok]]):.0%} del tiempo')
