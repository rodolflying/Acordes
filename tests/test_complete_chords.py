"""Tests del completado de acordes que las hojas escriben una sola vez.

Correr desde la raíz del proyecto:  python -m pytest tests
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from complete_chords import complete  # noqa: E402


def chord(name):
    return f'<span class="chord">{name}</span>'


def readable(content):
    """La hoja como texto: acordes originales entre [ ] y agregados entre { }."""
    content = re.sub(r'<span class="chord chord-added"[^>]*>(.*?)</span>', r'{\1}', content)
    return re.sub(r'<span class="chord">(.*?)</span>', r'[\1]', content).split('\n')


def test_a_block_sung_again_without_chords_copies_the_first_one():
    sheet = '\n'.join([
        f'{chord("A")}      {chord("B")}',
        'Perdón si estoy de nuevo acá',
        f'     {chord("G#m")}',
        'Pensé que habías preguntado',
        '',
        'Perdón si estoy de nuevo acá',
        'Pensé que habías preguntado',
    ])
    content, stats = complete(sheet)
    assert stats['bloque'] == 2
    assert readable(content)[5:] == [
        '{A}      {B}',
        'Perdón si estoy de nuevo acá',
        '     {G#m}',
        'Pensé que habías preguntado',
    ]


def test_a_labelled_part_takes_the_chords_of_the_part_with_the_same_label():
    sheet = '\n'.join([
        f'   {chord("RE")}          {chord("SOL")}',
        '(A)Te bañaré de luces de pie',
        f'   {chord("RE")}     {chord("SOL")}',
        'Te daré de alfombra el mar',
        '',
        '[A] Seguiré tus pasos cuando te mueras',
        'Crecerá de mi mano un rosal',
    ])
    content, stats = complete(sheet)
    assert stats['bloque'] == 2
    lines = readable(content)
    assert ' '.join(lines[5].split()) == '{RE} {SOL}' and lines[6].startswith('[A] Seguiré')
    assert ' '.join(lines[7].split()) == '{RE} {SOL}' and lines[8] == 'Crecerá de mi mano un rosal'


def test_a_different_block_of_the_same_size_does_not_take_chords():
    sheet = '\n'.join([
        f'{chord("Am")}        {chord("F")}',
        'Hoy desperté pensando en vos',
        f'{chord("C")}        {chord("G")}',
        'y salí a caminar al sol',
        '',
        'Nada que ver con lo de antes',
        'otra letra muy distinta acá',
    ])
    content, stats = complete(sheet)
    assert content == sheet
    assert stats == {'bloque': 0, 'linea': 0, 'audio': 0}


def test_a_repeated_line_gets_its_chords_but_tab_marks_are_not_lyrics():
    sheet = '\n'.join([
        f'          {chord("C")}',
        'Say it after me',
        '',
        f'   {chord("F")}',
        '  P.M  .   .     .   .',
        '',
        'Say it after me',
        '  P.M  .   .     .   .',
    ])
    content, stats = complete(sheet)
    assert stats['bloque'] + stats['linea'] == 1
    assert readable(content)[6:] == ['          {C}', 'Say it after me', '  P.M  .   .     .   .']


def test_a_line_sung_over_different_chords_takes_the_nearest_ones():
    sheet = '\n'.join([
        f'{chord("F#m")}          {chord("G")}',
        'Todo el universo depende de eso',
        '',
        'Otra cosa en el medio de la canción',
        '',
        f'{chord("D")}          {chord("Bm")}',
        'Todo el universo depende de eso',
        '',
        'Todo el universo depende de eso',
    ])
    lines = readable(complete(sheet)[0])
    assert lines[8:] == ['{D}          {Bm}', 'Todo el universo depende de eso']


def test_chords_keep_their_place_in_a_longer_line():
    sheet = '\n'.join([
        f'{chord("E")}   {chord("C#m")}            {chord("E")}',
        'Ay, paso todo el día pensando',
        f'{chord("E")}    {chord("C#m")}',
        'Ay, vos pensás que pierdo',
        '',
        'Ay, todo lo que hago es para vos y más',
        'Ay, vos pensás que pierdo',
    ])
    lines = readable(complete(sheet)[0])
    assert lines[5].startswith('{E}') and lines[5].rstrip().endswith('{E}')
    # el último acorde iba sobre "pensando", cerca del final; en la línea más larga sigue cerca del final
    assert lines[5].rindex('{E}') > len('Ay, todo lo que hago es para vos y más') * 0.6
