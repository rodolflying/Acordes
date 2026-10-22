"""Calidad de la sincronía de karaokes nuevos: palabras amontonadas (< 0,08 s entre palabras), líneas y palabras
pintadas contra la letra de Genius, comparado con la distribución de tus karaokes ya subidos."""
import json, re, statistics, sys
from pathlib import Path
ACORDES = Path(r'C:\Users\usuario\Desktop\Software development\_WORK_\Acordes')
sys.path.insert(0, str(ACORDES))
from karaoke_timings import parse_ass, outputs_dir

existing = json.loads((ACORDES / 'karaoke_lyrics.json').read_text(encoding='utf-8'))
ratios = sorted(v['amontonadas'] for v in existing.values())
print(f"Tus {len(ratios)} karaokes ya subidos: amontonadas mediana {statistics.median(ratios):.3f}, p75 {ratios[int(len(ratios)*.75)]:.3f}, malas (>0,10): {sum(r > 0.10 for r in ratios)}")
base = outputs_dir()
for folder in sys.argv[1:]:
    d = base / folder
    ass = d / 'subtitles.ass'
    if not ass.exists():
        print(f"  ✘ {folder}: sin subtitles.ass"); continue
    lines = parse_ass(ass.read_text(encoding='utf-8', errors='replace'))
    gaps = [b - a for _, words in lines for (_, a), (_, b) in zip(words, words[1:])]
    am = sum(g < 0.08 for g in gaps) / max(len(gaps), 1)
    painted = sum(len(w) for _, w in lines)
    lyric_words = len(re.findall(r"\w+", (d / 'letra_original.txt').read_text(encoding='utf-8', errors='replace'))) if (d / 'letra_original.txt').exists() else 0
    videos = [p.name for p in d.glob('video_*.mp4')]
    flag = 'OK ' if am <= 0.10 else 'REVISAR'
    print(f"  {flag} {folder}: amontonadas {am:.3f} | {len(lines)} líneas, {painted} palabras pintadas de {lyric_words} en la letra | {lines[0][0] if lines else '-'}s→{lines[-1][0] if lines else '-'}s | {len(videos)} videos")
