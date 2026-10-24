"""Tests de cuándo escucha el paso del audio de complete_chords cada renglón de la hoja.

Correr desde la raíz del proyecto:  python -m pytest tests
"""
import json
import sys
from pathlib import Path

import pytest

pytest.importorskip('librosa')  # el análisis de audio (experiments/chord_check) necesita sus librerías
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'experiments' / 'chord_check'))
import audio_fill  # noqa: E402

URL = 'https://acordes.lacuerda.net/alguien/una_cancion.shtml'
ROWS = [
    'mañana salgo temprano a buscarte',
    'con la luna',
    'camino por la orilla del río',
    'cuento las piedras del puente',
    'el viento me sopla la cara',
    'y se me olvida tu nombre',
    'vuelvo a la casa de noche',
    'la radio canta bajito',
    'y te espero en la cocina',
]
SHEET = '\n'.join(['<span class="chord">A</span>'] + ROWS)  # el renglón k de ROWS es la línea k + 1


def sung(lines, start):
    """La letra cantada como la guardan aligned_lyrics.json y karaoke_lyrics.json: cada palabra 0,4 s
    después de la anterior y cada línea 1 s después de la última palabra de la anterior."""
    lrc, words, t = [], [], start
    for line in lines:
        lrc.append(f'[{int(t // 60):02d}:{t % 60:05.2f}] {line}')
        words.append([])
        for w in line.split():
            words[-1].append([w, round(t, 2)])
            t += 0.4
        t += 0.6
    return {'lrc': '\n'.join(lrc), 'words': words}


def first_words(entry):
    """El segundo en que se canta la primera palabra de cada renglón de ROWS."""
    words = [w for line in entry['words'] for w in line]
    out, k = [], 0
    for row in ROWS:
        out.append(words[k][1])
        k += len(row.split())
    return out


@pytest.fixture
def song_files(tmp_path, monkeypatch):
    def write(voice, karaoke):
        files = {'ALIGNED_FILE': ('aligned_lyrics.json', voice), 'KARAOKE_FILE': ('karaoke_lyrics.json', karaoke),
                 'OFFSETS_FILE': ('sync_offsets.json', {}), 'CACHE_FILE': ('lrclib_cache.json', {})}
        for name, (file, data) in files.items():
            (tmp_path / file).write_text(json.dumps(data), encoding='utf-8')
            monkeypatch.setattr(audio_fill, name, tmp_path / file, raising=False)
        public = tmp_path / 'client' / 'public'
        public.mkdir(parents=True)
        (public / 'enriched_songs.json').write_text(
            json.dumps({'songs': {URL: {'artist': 'Alguien', 'title': 'Una canción'}}}), encoding='utf-8')
        monkeypatch.setattr(audio_fill, 'ROOT', tmp_path)
    return write


# El karaoke junta en su primera línea los dos primeros renglones de la hoja
KARAOKE = {**sung([ROWS[0] + ' ' + ROWS[1]] + ROWS[2:], 10.0), 'amontonadas': 0.0}


def test_listens_where_whisper_heard_the_voice_before_what_the_karaoke_paints(song_files):
    voice = sung(ROWS, 11.0)
    song_files({URL: voice}, {URL: KARAOKE})
    starts = first_words(voice)
    assert audio_fill.line_times(URL, SHEET) == {
        k + 1: pytest.approx((t, starts[k + 1] if k + 1 < len(starts) else t + 6)) for k, t in enumerate(starts)}


def test_with_only_the_karaoke_every_row_is_heard_a_little_after_it_is_painted(song_files):
    song_files({URL: {'lrc': None}}, {URL: KARAOKE})  # Whisper: la letra de LRCLIB es de otra versión
    starts = [t + audio_fill.KARAOKE_LEAD for t in first_words(KARAOKE)]
    times = audio_fill.line_times(URL, SHEET)
    # "con la luna" va en la misma línea del karaoke que el renglón de arriba, y también tiene su tiempo
    assert times == {
        k + 1: pytest.approx((t, starts[k + 1] if k + 1 < len(starts) else t + 6)) for k, t in enumerate(starts)}
