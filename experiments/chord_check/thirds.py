"""¿Mayor o menor? Energía de la tercera mayor vs la tercera menor bajo cada acorde de la hoja (Fénix)."""
import json

import numpy as np

from chordcheck import ROOT, SCRATCH, NAMES, align_sequence, audio_chroma, sheet_chords

pre = json.loads((ROOT / 'client/public/preloaded_songs.json').read_text(encoding='utf-8'))
chords, _ = sheet_chords(pre['https://www.cifraclub.com/tronic/fenix/']['content'])
C, voiced, times = audio_chroma(str(SCRATCH / 'audio' / 'fenix.wav'))
states, _ = align_sequence(C, voiced, chords, 0)
n = len(chords)
for name in ('G', 'C', 'D', 'A#', 'D#', 'F'):
    fr = [t for t in range(len(states)) if 1 <= states[t] <= n and chords[states[t] - 1][1] == name and voiced[t]]
    if not fr:
        continue
    root = chords[[i for i, c in enumerate(chords) if c[1] == name][0]][2][0]
    prof = C[:, fr].mean(axis=1)
    major3, minor3 = prof[(root + 4) % 12], prof[(root + 3) % 12]
    verdict = 'MENOR' if minor3 > major3 * 1.15 else 'MAYOR' if major3 > minor3 * 1.15 else 'dudoso'
    print(f'{name:3}: tercera mayor {NAMES[(root + 4) % 12]:2} = {major3:.2f} | tercera menor {NAMES[(root + 3) % 12]:2} = {minor3:.2f} -> suena {verdict}')
