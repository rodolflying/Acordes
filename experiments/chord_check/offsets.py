"""Pasa a sync_offsets.json los desfases de la letra que la voz guía midió con claridad (results.json).

Solo entran mediciones confiables: máximo angosto, la letra corregida calza claramente mejor con la
voz que sin corregir, la comprobación independiente (dónde vuelve a entrar la voz después de cada
pausa) da lo mismo, y un desfase que se nota (bajo 1 s puede ser sesgo de la medición: la voz tarda
en subir de volumen, y que la hoja vaya un poco adelantada ayuda a leer).
Después: python lyrics_sync.py  (aplica los desfases a client/public/sync_points.json)
"""
import json

from chordcheck import ROOT, SCRATCH

MAX_WIDTH = 0.6      # s: ancho del máximo de la medición
MIN_GAIN = 0.05      # cuánto mejor calzan los inicios de línea con la voz al corregir
MIN_SHIFT = 1.0      # s
MAX_DISAGREE = 0.6   # s: diferencia máxima con la comprobación por re-entradas

if __name__ == '__main__':
    results = json.loads((SCRATCH / 'results.json').read_text(encoding='utf-8'))
    offsets, doubtful = {}, []
    for url, r in sorted(results.items()):
        v = r.get('desfase_voz')
        if not v or abs(v['segundos']) < MIN_SHIFT:
            continue
        agrees = v.get('reentradas') is not None and abs(v['reentradas'] - v['segundos']) <= MAX_DISAGREE
        if v['ancho'] <= MAX_WIDTH and v['inicios_corregido'] - v['inicios_sin_corregir'] >= MIN_GAIN and agrees:
            offsets[url] = {'segundos': v['segundos'], 'video': r['video'], 'medido': 'voz guía del Karaoke'}
        else:
            doubtful.append(f"{url} ({v['segundos']:+.2f}s, ancho {v['ancho']}, re-entradas {v.get('reentradas')})")
    (ROOT / 'sync_offsets.json').write_text(json.dumps(offsets, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'{len(offsets)} desfases confiables escritos en sync_offsets.json')
    for url, o in offsets.items():
        print(f"  {o['segundos']:+5.2f}s  {url}")
    if doubtful:
        print('Dudosos (no se aplican):\n  ' + '\n  '.join(doubtful))
