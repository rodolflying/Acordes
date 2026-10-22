"""
audio_visuals.py — El fondo que se mueve con la música: cómo suena cada canción, cuadro a cuadro.

El navegador no puede escuchar el video de YouTube (es otro sitio), pero la hoja ya sabe en qué segundo va.
Este paso analiza de antemano el audio de cada karaoke y guarda, 30 veces por segundo, cuánto suena cada
banda de frecuencias. El fondo de la hoja (Visualizer.jsx) lo reproduce a la par del video: con eso
reconstruye la onda que necesita MilkDrop (Butterchurn) y mueve las Ondas y el Ambiente.

Lee el mismo audio que suena en el video: Google Drive/Karaokes/outputs/<canción>/audio_mixes/karaoke.mp3
(5 MB; si no está, original.mp3). Las tres versiones (Karaoke, Instrumental y Backtrack) salen de la misma
grabación, con los mismos tiempos, así que un análisis sirve para las tres.

Genera client/public/visuals/<id del video>.json, uno por canción (se carga al abrirla):
    {"v": 2, "fps": 30.0, "frames": n, "tempo": bpm, "beats": [segundo, ...],
     "bands": 12, "freqs": [Hz, ...], "spectrum": b64}   # 0-255 por cuadro y banda

Uso:
    python audio_visuals.py                 # las canciones con pista que todavía no tienen su archivo
    python audio_visuals.py --solo angeles  # solo las que calcen con el texto (para probar)
    python audio_visuals.py --force         # recalcular todas
Necesita Google Drive abierto.
"""

import argparse
import base64
import json
from pathlib import Path

import numpy as np

from karaoke_timings import KARAOKES, outputs_dir

ROOT = Path(__file__).parent
PUBLIC = ROOT / 'client' / 'public'
OUT_DIR = PUBLIC / 'visuals'
SR = 22050
HOP = round(SR / 30)  # ~30 cuadros por segundo, los mismos que dibuja el fondo
BANDS = 12
FMIN, FMAX = 30, 11000  # MilkDrop separa graves, medios y agudos hasta ~11 kHz


def b64(values) -> str:
    return base64.b64encode(np.asarray(values, dtype=np.uint8).tobytes()).decode('ascii')


def analyze(audio_file: Path) -> dict:
    import librosa
    import scipy.signal
    if not hasattr(scipy.signal, 'hann'):  # librosa 0.10 la busca ahí; el scipy instalado la movió a windows
        scipy.signal.hann = scipy.signal.windows.hann
    y, _ = librosa.load(audio_file, sr=SR, mono=True)

    # Bandas en escala logarítmica, como las oye el oído y las separa MilkDrop (graves de verdad desde 30 Hz).
    # Cada banda en amplitud (no en dB, para que un golpe se note), con el 98% más fuerte de esa banda como
    # máximo: así los agudos también se mueven aunque suenen menos que los graves
    stft = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP))
    bins = librosa.fft_frequencies(sr=SR, n_fft=2048)
    edges = np.geomspace(FMIN, FMAX, BANDS + 1)
    amp = np.array([stft[(bins >= lo) & (bins < hi)].mean(axis=0) for lo, hi in zip(edges[:-1], edges[1:])])
    top = np.percentile(amp, 98, axis=1, keepdims=True)
    spectrum = np.clip(amp / np.maximum(top, 1e-9), 0, 1).T  # cuadros × bandas
    freqs = np.sqrt(edges[:-1] * edges[1:])

    tempo, beats = librosa.beat.beat_track(y=y, sr=SR, units='time')
    return {
        'v': 2, 'fps': round(SR / HOP, 3), 'frames': len(spectrum),
        'tempo': round(float(np.atleast_1d(tempo)[0]), 1), 'beats': [round(float(t), 2) for t in beats],
        'bands': BANDS, 'freqs': [round(float(f)) for f in freqs],
        'spectrum': b64(np.round(spectrum * 255)),
    }


def songs_with_audio():
    """[(id del video, carpeta de la canción en Karaokes)] de las canciones con pista."""
    tracks = json.loads((PUBLIC / 'backing_tracks.json').read_text(encoding='utf-8'))['backing_tracks']
    uploads = json.loads((KARAOKES / 'data' / 'youtube_upload_state.json').read_text(encoding='utf-8')).get('uploads', {})
    folder_of = {v['video_id']: k.rsplit('/', 1)[0] for k, v in uploads.items() if v.get('video_id') and '/' in k}
    found = {}
    for versions in tracks.values():
        video = next((versions[v]['id'] for v in ('Karaoke', 'Instrumental', 'Backtrack') if v in versions), None)
        if video and folder_of.get(video):
            found[video] = folder_of[video]
    return sorted(found.items(), key=lambda x: x[1])


def main(solo: str = '', force: bool = False):
    base = outputs_dir()
    if not base.exists():
        print(f"Fondo con la música: no encontré las salidas de Karaokes en {base} (¿Google Drive abierto?)")
        return
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    done, missing = 0, []
    for video, folder in songs_with_audio():
        if solo and solo.lower() not in folder.lower():
            continue
        out = OUT_DIR / f'{video}.json'
        if out.exists() and not force:
            continue
        audio = next((f for f in (base / folder / 'audio_mixes' / 'karaoke.mp3', base / folder / 'original.mp3') if f.exists()), None)
        if not audio:
            missing.append(folder)
            continue
        data = analyze(audio)
        out.write_text(json.dumps(data, separators=(',', ':')), encoding='utf-8')
        done += 1
        print(f"  ✔ {folder}: {data['frames'] / data['fps']:.0f} s, {data['tempo']} bpm, {out.stat().st_size // 1024} KB")
    print(f"Fondo con la música: {done} canciones analizadas" + (f" | sin audio: {', '.join(missing)}" if missing else ''))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--solo', default='')
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    main(args.solo, args.force)
