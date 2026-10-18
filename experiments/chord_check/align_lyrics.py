"""Ubica cada línea de la letra donde realmente se canta en tu video (alineación forzada con Whisper).

Para cada canción con letra de LRCLIB y video Karaoke (que trae la voz guía al 30%):
1. Demucs separa la voz guía (audio/vocals/<video>.flac, en caché).
2. stable-ts alinea el texto de la letra con esa voz: cada línea queda con su inicio real en el video.
   Resuelve de una vez las intros más largas (Familiar: +21 s) y las ediciones distintas del tema,
   donde ningún corrimiento único sirve.
3. Control de calidad: una línea solo se acepta si cae donde hay voz y en orden; si quedan muy
   pocas líneas buenas, la canción se descarta (letra de otra versión).

Resultado: ROOT/aligned_lyrics.json  { url: {"video": id, "lrc": "[mm:ss.xx] línea ..."} }: la misma
letra de LRCLIB con los tiempos de tu video, que lyrics_sync.py usa en vez de la original, y "words": el
tiempo de cada palabra por línea (vacío donde Whisper no fue confiable). "lrc": null
marca una letra que es de otra versión (no calza ni línea a línea ni corrida en bloque): esa canción
vuelve a avanzar en proporción al video.
Uso:  python align_lyrics.py [palabras de la URL ...]
"""
import json
import re
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import librosa

from chordcheck import ROOT, SCRATCH
import batch

VOCALS = SCRATCH / 'audio' / 'vocals'
OUT = ROOT / 'aligned_lyrics.json'
RAW = SCRATCH / 'aligned_raw.json'  # lo que devolvió Whisper, para ajustar el control sin volver a alinear
VSR = 16000
_model = None


def vocals_for_video(video_id):
    path = VOCALS / f'{video_id}.flac'
    if not path.exists():
        batch.TMP.mkdir(parents=True, exist_ok=True)
        subprocess.run(['yt-dlp', '-q', '--no-warnings', '-f', 'bestaudio', '-o', str(batch.TMP / f'{video_id}.%(ext)s'),
                        f'https://www.youtube.com/watch?v={video_id}'], check=True)
        audio = next(batch.TMP.glob(f'{video_id}.*'))
        stems = batch.separate(str(audio))
        VOCALS.mkdir(parents=True, exist_ok=True)
        sf.write(path, librosa.resample(stems['vocals'], orig_sr=batch.SR, target_sr=VSR), VSR, format='FLAC')
        for f in batch.TMP.glob('*'):
            f.unlink()
    return path


def lrc_lines(lrc):
    """'[01:02.50] Texto' -> [(62.5, 'Texto')] con el texto original (sin las líneas vacías)."""
    out = []
    for line in lrc.splitlines():
        m = re.match(r'\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)', line)
        if m and re.search(r'\w', m.group(3)):
            out.append((int(m.group(1)) * 60 + float(m.group(2)), m.group(3).strip()))
    return out


def language(lines):
    text = ' '.join(t for _, t in lines).lower()
    es = len(re.findall(r'\b(que|de|la|el|en|y|no|me|te|por|para|con|mi|tu|lo)\b', text))
    en = len(re.findall(r'\b(the|you|and|i|to|me|my|it|in|of|that|is|your|we)\b', text))
    return 'es' if es >= en else 'en'


def align(vocal_path, lines):
    global _model
    import stable_whisper
    if _model is None:
        _model = stable_whisper.load_model('large-v3-turbo', device='cuda')
    result = _model.align(str(vocal_path), '\n'.join(t for _, t in lines), language=language(lines),
                          original_split=True, verbose=None)
    # Por línea: inicio, fin, texto y el tiempo de cada palabra (el acorde va sobre una palabra)
    return [(s.start, s.end, s.text.strip(), [(w.word.strip(), round(w.start, 2)) for w in s.words])
            for s in result.segments]


def check(aligned, lines, vocal_env):
    """Tiempo real de cada línea de la letra, o None si la letra no calza con lo que se canta.

    Whisper a veces ubica mal una línea suelta (una repetición, un coro con "eh-oh"): una línea solo
    usa su tiempo alineado si cae donde hay voz y se corre igual que sus vecinas (±1,5 s). Las demás
    toman su tiempo de LRCLIB más el corrimiento de sus vecinas, así que un video que es otra
    edición del tema (corrimiento que cambia a mitad de la canción) también queda bien.
    """
    if len(aligned) != len(lines):
        return None, f'{len(aligned)} segmentos para {len(lines)} líneas', None, None
    frame = batch.FRAME
    lv = np.log(vocal_env + 1e-4)
    singing = lv > np.percentile(lv, 30) + 0.4 * (np.percentile(lv, 90) - np.percentile(lv, 30))
    shift = np.full(len(lines), np.nan)
    for i, ((start, end, *_), (t, _)) in enumerate(zip(aligned, lines)):
        a, b = int(start / frame), max(int(end / frame), int(start / frame) + 1)
        if b <= len(singing) and singing[a:b].mean() >= 0.5 and end - start >= 0.3:
            shift[i] = start - t
    if np.isnan(shift).all():
        return None, 'ninguna línea cae donde hay voz', 0.0, None
    overall = np.nanmedian(shift)
    local = np.array([np.nanmedian(w) if np.sum(~np.isnan(w := shift[max(i - 4, 0):i + 5])) >= 3 else overall
                      for i in range(len(lines))])
    trusted = ~np.isnan(shift) & (np.abs(shift - local) <= 1.5)
    times = np.where(trusted, [a[0] for a in aligned], [t for t, _ in lines] + local)
    for i in range(1, len(times)):  # en orden
        if times[i] < times[i - 1]:
            times[i] = times[i - 1] + 0.1
    share = trusted.sum() / len(lines)
    if trusted.sum() < max(6, 0.6 * len(lines)):
        return None, f'solo {trusted.sum()}/{len(lines)} líneas calzan con la voz', share, None
    return ([round(float(x), 2) for x in times], f'{trusted.sum()}/{len(lines)} líneas, corrimiento {overall:+.1f}s',
            share, trusted.tolist())


def to_lrc(times, lines):
    return '\n'.join(f'[{int(t // 60):02d}:{t % 60:05.2f}] {text}' for t, (_, text) in zip(times, lines))


if __name__ == '__main__':
    results = json.loads((SCRATCH / 'results.json').read_text(encoding='utf-8'))
    enriched = json.loads((ROOT / 'client/public/enriched_songs.json').read_text(encoding='utf-8'))['songs']
    lrclib = json.loads((ROOT / 'lrclib_cache.json').read_text(encoding='utf-8'))
    out = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {}
    raw = json.loads(RAW.read_text(encoding='utf-8')) if RAW.exists() else {}
    filters = sys.argv[1:]
    todo = [u for u, r in results.items() if r.get('desfase_voz') and (not filters or any(f in u for f in filters))]
    print(f'{len(todo)} canciones con voz guía y letra con tiempos', flush=True)
    for i, url in enumerate(todo, 1):
        r, song = results[url], enriched.get(url, {})
        lrc = lrclib.get(f"{song.get('artist')}|{song.get('title')}")
        if not lrc:
            continue
        lines = lrc_lines(lrc)
        t0 = time.time()
        try:
            cached = raw.get(url)
            if (not cached or cached['video'] != r['video'] or len(cached['segments']) != len(lines)
                    or len(cached['segments'][0]) < 4):  # sin el tiempo de cada palabra
                cached = {'video': r['video'], 'segments': align(vocals_for_video(r['video']), lines)}
                raw[url] = cached
                RAW.write_text(json.dumps(raw, ensure_ascii=False), encoding='utf-8')
            times, why, share, trusted = check(cached['segments'], lines, batch.chroma_for_video(r['video'])[4])
        except Exception as e:
            times, why, share, trusted = None, f'error: {type(e).__name__}: {e}'[:200], None, None
        if times:
            # Palabras con su tiempo solo en las líneas confiables (en las demás, el acorde se ubica
            # por su columna, como antes)
            words = [[[w, t] for w, t in seg[3] if w] if ok else [] for seg, ok in zip(cached['segments'], trusted)]
            out[url] = {'video': r['video'], 'lrc': to_lrc(times, lines), 'words': words}
        elif share is not None and share < 0.4 and r['desfase_voz']['ancho'] > 2:
            # Ni Whisper ni un corrimiento en bloque calzan: la letra de LRCLIB es de otra versión.
            # Mejor que la hoja avance en proporción al video que iluminar líneas equivocadas
            out[url] = {'video': r['video'], 'lrc': None, 'motivo': f'la letra con tiempos es de otra versión ({why})'}
            why += ' -> letra de otra versión, sin sincronía por línea'
        elif url in out:
            del out[url]
        OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
        name = url.split('/')[-2] if url.endswith('/') else url.split('/')[-1]
        print(f"[{i}/{len(todo)}] {name}: {why} ({time.time() - t0:.0f}s)", flush=True)
