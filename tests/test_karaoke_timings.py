"""Tests de la lectura de los subtítulos de tus karaokes (subtitles.ass del proyecto Karaokes).

Correr desde la raíz del proyecto:  python -m pytest tests
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from karaoke_timings import parse_ass, to_lrc  # noqa: E402

ASS = r"""[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:07.62,0:00:09.35,Default,,0,0,0,,{\kf1}Son{\kf16}{\kf80} las{\kf54} 6
Dialogue: 0,0:00:11.09,0:00:13.97,Default,,0,0,0,,{\kf15}{\kf20}El{\kf40} gallo{\kf28} no\N{\kf88} canta
Dialogue: 0,0:01:02.00,0:01:03.00,Default,,0,0,0,,{\kf50}
"""


def test_each_word_starts_when_the_karaoke_paints_it_and_pauses_add_time():
    lines = parse_ass(ASS)
    assert lines[0] == (7.62, [('Son', 7.62), ('las', 7.79), ('6', 8.59)])
    # La primera {\kf15} es una pausa antes de "El"; \N (salto de renglón en el video) no es una palabra
    assert lines[1] == (11.09, [('El', 11.24), ('gallo', 11.44), ('no', 11.84), ('canta', 12.12)])


def test_lines_without_words_are_skipped_and_the_lrc_keeps_the_line_start():
    lines = parse_ass(ASS)
    assert len(lines) == 2
    assert to_lrc(lines).split('\n') == ['[00:07.62] Son las 6', '[00:11.09] El gallo no canta']
