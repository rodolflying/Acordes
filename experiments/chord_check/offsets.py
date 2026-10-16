"""Pasa a sync_offsets.json los desfases de la letra que la voz guía midió con claridad (results.json).

Solo para las canciones que Whisper no pudo alinear línea a línea (align_lyrics.py, que es mejor:
ubica cada línea donde se canta). Para esas, un corrimiento en bloque entra solo si es confiable:
- la letra corregida calza claramente con la voz (los inicios de línea calzan con donde entra la voz),
- la comprobación independiente (dónde vuelve a entrar la voz después de cada pausa) da lo mismo,
- y se nota (bajo 1 s puede ser sesgo de la medición, y que la hoja vaya un poco adelantada ayuda a leer).
Con un rango de ±40 s aparecen falsos calces en canciones de estrofas parejas (Pompeii calzaba con
+7 s y con +15 s; Whisper confirmó +15 s), así que las exigencias son altas.
Después: python lyrics_sync.py  (aplica los desfases a client/public/sync_points.json)
"""
import json

from chordcheck import ROOT, SCRATCH

MIN_FIT = 0.3        # calce de los inicios de línea con la voz, ya corregido
MIN_GAIN = 0.15      # cuánto mejor calzan que sin corregir
MIN_SHIFT = 1.0      # s
MAX_DISAGREE = 0.6   # s: diferencia máxima con la comprobación por re-entradas

if __name__ == '__main__':
    results = json.loads((SCRATCH / 'results.json').read_text(encoding='utf-8'))
    aligned_path = ROOT / 'aligned_lyrics.json'
    aligned = json.loads(aligned_path.read_text(encoding='utf-8')) if aligned_path.exists() else {}
    offsets, doubtful = {}, []
    for url, r in sorted(results.items()):
        v = r.get('desfase_voz')
        if url in aligned or not v or abs(v['segundos']) < MIN_SHIFT:
            continue
        agrees = v.get('reentradas') is not None and abs(v['reentradas'] - v['segundos']) <= MAX_DISAGREE
        fit, gain = v['inicios_corregido'], v['inicios_corregido'] - v['inicios_sin_corregir']
        if fit >= MIN_FIT and gain >= MIN_GAIN and agrees:
            offsets[url] = {'segundos': v['segundos'], 'video': r['video'], 'medido': 'voz guía del Karaoke'}
        else:
            doubtful.append(f"{url} ({v['segundos']:+.2f}s, inicios {v['inicios_sin_corregir']:.2f}->{fit:.2f}, re-entradas {v.get('reentradas')})")
    (ROOT / 'sync_offsets.json').write_text(json.dumps(offsets, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'{len(aligned)} canciones con la letra alineada por Whisper; {len(offsets)} desfases en bloque para las demás')
    for url, o in offsets.items():
        print(f"  {o['segundos']:+5.2f}s  {url}")
    if doubtful:
        print('Dudosos (no se aplican):\n  ' + '\n  '.join(doubtful))
