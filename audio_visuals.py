"""
audio_visuals.py — El fondo que se mueve con la música: cómo suena cada canción, cuadro a cuadro.

El navegador no puede escuchar el video de YouTube (es otro sitio), pero la hoja ya sabe en qué segundo va.
Este paso analiza de antemano las pistas separadas de cada karaoke (Google Drive: Karaokes/outputs/<canción>/
demucs_output/htdemucs/original: batería, bajo, voz y el resto) y guarda, 20 veces por segundo, cuánto suena
cada una y el espectro de la mezcla. El fondo de la hoja lo reproduce a la par del video. Las tres versiones
(Karaoke, Instrumental y Backtrack) salen de la misma grabación, con los mismos tiempos.

Genera client/public/visuals/<id del video>.json, uno por canción (se carga al abrirla):
    {"v": 1, "fps": 20.0, "frames": n, "tempo": bpm, "beats": [segundo, ...],
     "stems": {"drums": b64, "bass": b64, "vocals": b64, "other": b64},   # 0-255 por cuadro
     "bands": 12, "spectrum": b64}                                         # 0-255 por cuadro y banda

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
HOP = round(SR / 20)  # ~20 cuadros por segundo
BANDS = 12
STEMS = ('drums', 'bass', 'vocals', 'other')


def b64(values) -> str:
    return base64.b64encode(np.asarray(values, dtype=np.uint8).tobytes()).decode('ascii')


def to_byte(x, top):
    return np.clip(np.round(x / max(top, 1e-9) * 255), 0, 255).astype(np.uint8)


def analyze(stems_dir: Path) -> dict:
    import librosa
    import scipy.signal
    if not hasattr(scipy.signal, 'hann'):  # librosa 0.10 la busca ahí; el scipy instalado la movió a windows
        scipy.signal.hann = scipy.signal.windows.hann
    audio = {name: librosa.load(stems_dir / f'{name}.wav', sr=SR, mono=True)[0] for name in STEMS}
    n = min(len(y) for y in audio.values())
    audio = {name: y[:n] for name, y in audio.items()}

    # Cuánto suena cada pista: el 98% más fuerte de la canción es el máximo (un golpe aislado no aplana el resto)
    stems = {}
    for name, y in audio.items():
        rms = librosa.feature.rms(y=y, frame_length=2 * HOP, hop_length=HOP)[0]
        stems[name] = to_byte(rms, np.percentile(rms, 98))

    # Espectro de la mezcla en 12 bandas (40 Hz a 8 kHz), cada banda entre su propio piso y su techo, para que
    # los agudos también se muevan aunque suenen menos que los graves
    mix = sum(audio.values())
    mel = librosa.feature.melspectrogram(y=mix, sr=SR, n_fft=2048, hop_length=HOP, n_mels=BANDS, fmin=40, fmax=8000)
    db = librosa.power_to_db(mel, ref=np.max)
    lo = np.percentile(db, 5, axis=1, keepdims=True)
    hi = np.percentile(db, 99, axis=1, keepdims=True)
    spectrum = np.clip((db - lo) / np.maximum(hi - lo, 1e-6), 0, 1).T  # cuadros × bandas

    # El pulso, de la batería y el bajo
    tempo, beats = librosa.beat.beat_track(y=audio['drums'] + audio['bass'], sr=SR, units='time')
    frames = min(len(spectrum), *(len(v) for v in stems.values()))
    return {
        'v': 1, 'fps': round(SR / HOP, 3), 'frames': frames,
        'tempo': round(float(np.atleast_1d(tempo)[0]), 1), 'beats': [round(float(t), 2) for t in beats],
        'stems': {name: b64(v[:frames]) for name, v in stems.items()},
        'bands': BANDS, 'spectrum': b64(np.round(spectrum[:frames] * 255)),
    }


def songs_with_stems():
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
    for video, folder in songs_with_stems():
        if solo and solo.lower() not in folder.lower():
            continue
        out = OUT_DIR / f'{video}.json'
        if out.exists() and not force:
            continue
        stems_dir = base / folder / 'demucs_output' / 'htdemucs' / 'original'
        if not all((stems_dir / f'{name}.wav').exists() for name in STEMS):
            missing.append(folder)
            continue
        data = analyze(stems_dir)
        out.write_text(json.dumps(data, separators=(',', ':')), encoding='utf-8')
        done += 1
        print(f"  ✔ {folder}: {data['frames'] / data['fps']:.0f} s, {data['tempo']} bpm, {out.stat().st_size // 1024} KB")
    print(f"Fondo con la música: {done} canciones analizadas" + (f" | sin pistas separadas: {', '.join(missing)}" if missing else ''))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--solo', default='')
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    main(args.solo, args.force)
