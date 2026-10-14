"""Tests de la alineación entre la letra con tiempos (LRC) y la hoja de acordes.

Correr desde la raíz del proyecto:  python -m pytest tests
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lyrics_sync import align, parse_lrc, sheet_lyric_lines  # noqa: E402

SHEET = "\n".join([
    'Intro: <span class="chord">E</span> <span class="chord">C#m</span>',  # 0: solo acordes
    "",                                                                     # 1
    '<span class="chord">E</span>      <span class="chord">C#m</span>',    # 2: solo acordes
    "Ay, paso todo el día pensando en vos",                                 # 3
    "Ay, que hay de mal en todo esto",                                      # 4
    "",                                                                     # 5
    "Coro:",                                                                # 6: título de sección
    "Perdón si estoy de nuevo acá",                                         # 7
    "Pensé que habías preguntado por mí",                                   # 8
    "",                                                                     # 9
    "Ay, vos pensás que pierdo el tiempo",                                  # 10
])


def test_sheet_lyric_lines_skips_chords_blank_lines_and_section_titles():
    assert [i for i, _ in sheet_lyric_lines(SHEET)] == [3, 4, 7, 8, 10]


def test_parse_lrc():
    assert parse_lrc("[00:13.18] When you try your best\n[00:20.00] \n[01:02.5] Lights will guide you") == [
        (13.18, "when you try your best"), (62.5, "lights will guide you")]


def test_align_follows_the_song_and_jumps_back_to_a_repeated_chorus():
    lrc = parse_lrc("\n".join([
        "[00:10.00] Ay, paso todo el día pensando en vos",
        "[00:15.00] Ay, qué hay de mal en todo esto",
        "[00:20.00] Perdón si estoy de nuevo acá",
        "[00:25.00] Pensé que habías preguntado por mí",
        "[00:30.00] Ay, vos pensás que pierdo el tiempo",
        "[00:40.00] Perdón si estoy de nuevo acá",              # coro cantado otra vez, escrito una sola vez
        "[00:45.00] Pensé que habías preguntado por mí",
        "[00:50.00] Una línea que no está en la hoja",
    ]))
    assert align(lrc, sheet_lyric_lines(SHEET)) == [
        [10.0, 3], [15.0, 4], [20.0, 7], [25.0, 8], [30.0, 10], [40.0, 7], [45.0, 8]]


def test_align_does_not_jump_back_for_a_single_line_that_looks_alike():
    # Volver atrás solo vale la pena si calzan varias líneas seguidas (un coro de verdad)
    lrc = parse_lrc("\n".join([
        "[00:10.00] Ay, paso todo el día pensando en vos",
        "[00:20.00] Perdón si estoy de nuevo acá",
        "[00:25.00] Pensé que habías preguntado por mí",
        "[00:30.00] Ay, vos pensás que pierdo el tiempo",
        "[00:35.00] Ay, paso todo el día pensando en vos",      # una frase suelta que se repite
        "[00:40.00] Ay, vos pensás que pierdo el tiempo",
    ]))
    assert align(lrc, sheet_lyric_lines(SHEET)) == [[10.0, 3], [20.0, 7], [25.0, 8], [30.0, 10], [40.0, 10]]


def test_align_matches_sung_lines_that_the_sheet_joins_and_avoids_false_jumps_back():
    # Caso real ("Ángeles", Kidd Voodoo): la hoja junta dos líneas cantadas en una, y una línea
    # anterior se parece ("recuerdo"); antes eso producía un salto falso hacia atrás
    sheet = "\n".join([
        "Mil recuerdos de ayer",                                                 # 0
        "Tus palabras se tornan cristal",                                        # 1
        "Oh baby dime si te llamo, no me mientas, yo también te extraño",        # 2
        "Me recuerdo al despertar, que antes tu eras mía y ya no más",           # 3
        "Camino en el exceso de alcohol, choco con la pared",                    # 4
    ])
    lrc = parse_lrc("\n".join([
        "[01:26.07] Dime si te llamo, no me mientas",
        "[01:32.10] Me recuerdo al despertar",
        "[01:35.70] Que antes tú eras mía y ya no más",
        "[01:43.10] Camino en el exceso de alcohol",
    ]))
    assert align(lrc, sheet_lyric_lines(sheet)) == [[86.07, 2], [92.1, 3], [95.7, 3], [103.1, 4]]


def test_align_ignores_short_or_repetitive_lines_and_prefers_the_nearest_good_match():
    # Casos reales: "ey ey ey" calzaba con "Búscame el encendedor, ey" ("Un Coco"); una frase que
    # se repite al final de la hoja se iba a la repetición lejana; "Con la tuya" (3 palabras)
    # aparecía "contenida" en otra línea ("Ángeles")
    sheet = "\n".join([
        "Búscame el encendedor, ey",                 # 0
        "Yo te voy a olvidar, yal",                  # 1
        "Me estoy ahogando y a la ola le pedí",      # 2
        "Con la tuya",                               # 3
        "Yo te voy a olvidar gyal",                  # 4: la misma frase, repetida al final
    ])
    lrc = parse_lrc("\n".join([
        "[00:10.00] Búscame el encendedor, ey",
        "[00:20.00] Yo te voy a olvidar, gyal",
        "[00:30.00] Ey, ey, ey",
        "[00:40.00] Me estoy ahogando y a la ola le pedí",
        "[00:50.00] A mi boca con la tuya, ah, ay",
    ]))
    assert align(lrc, sheet_lyric_lines(sheet)) == [[10.0, 0], [20.0, 1], [40.0, 2]]
