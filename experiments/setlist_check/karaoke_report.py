"""Tabla de los karaokes procesados desde una fecha: palabras amontonadas del subtitles.ass, qué alineación se usó y
si la letra calza con lo que se canta (coincidencia de palabras entre la letra y la transcripción de Whisper)."""
import csv, json, re, sys, unicodedata
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from karaoke_timings import parse_ass

LOG = ROOT.parent / 'Karaokes' / 'data' / 'karaoke_log.csv'
since = sys.argv[1] if len(sys.argv) > 1 else '2026-10-22'
norm = lambda s: re.sub(r'[^a-z ]', '', unicodedata.normalize('NFD', s.lower()).encode('ascii', 'ignore').decode())
with open(LOG, encoding='utf-8', errors='replace') as f:
    rows = [r for r in csv.DictReader(f) if r['timestamp'] >= since and 'SUCCESS' in r['status']]
last = {r['project_folder']: r for r in rows}  # la última corrida de cada carpeta
for folder, r in sorted(last.items(), key=lambda x: x[1]['timestamp']):
    d = Path(folder)
    lines = parse_ass((d / 'subtitles.ass').read_text(encoding='utf-8', errors='replace')) if (d / 'subtitles.ass').exists() else []
    gaps = [b - a for _, ws in lines for (_, a), (_, b) in zip(ws, ws[1:])]
    crowded = sum(g < 0.08 for g in gaps) / max(len(gaps), 1)
    lyr = (d / 'letra_original.txt').read_text(encoding='utf-8', errors='replace') if (d / 'letra_original.txt').exists() else ''
    vocab = set(norm(lyr).split())
    heard = [norm(w['word']) for w in json.loads((d / 'whisper_raw.json').read_text(encoding='utf-8'))] if (d / 'whisper_raw.json').exists() else []
    match = sum(w in vocab for w in heard if w) / max(len(heard), 1)
    rep = json.loads((d / 'alignment_report.json').read_text(encoding='utf-8')) if (d / 'alignment_report.json').exists() else {}
    verdict = 'SIN LETRA' if not lines else 'LETRA AJENA' if match < 0.4 else 'REVISAR' if crowded > 0.10 else 'OK'
    print(f"{verdict:11} | {d.name:45} | amontonadas {crowded:5.1%} | letra calza {match:4.0%} | {rep.get('metodo', '-'):10} | {len(lines)} líneas")
