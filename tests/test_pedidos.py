"""Tests de pedidos.py: cómo reconoce la canción en el buscador y qué hoja elige (sin red).

Correr desde la raíz del proyecto:  python -m pytest tests
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pedidos  # noqa: E402
from enricher import parse_song_name  # noqa: E402


def sheet(chords):
    return {'content': ' '.join('<span class="chord">A</span>' for _ in range(chords))}


def test_same_name_ignores_punctuation_accents_and_extra_words():
    assert pedidos.same_name('B.Y.O.B.', 'Byob')
    assert pedidos.same_name('Ángel para un final', 'Angel Para Un Final')
    assert pedidos.same_name('Glup!', 'Glup')
    assert pedidos.same_name('La Oreja de Van Gogh', 'Oreja de Van Gogh')
    assert not pedidos.same_name('Toxicity', 'Lonely Day')


def test_card_name_is_what_enricher_parses_back():
    p = {'artista': 'Los Bunkers', 'titulo': 'Miño', 'url': 'https://www.cifraclub.com/los-bunkers/mino/'}
    assert pedidos.card_name(p) == 'Miño - Los Bunkers - Cifra Club'
    assert parse_song_name(pedidos.card_name(p)) == ('Los Bunkers', 'Miño')


def test_find_sheet_skips_tabs_and_leaves_the_acoustic_version_last(monkeypatch):
    # Cifra Club trae primero la tablatura (0 acordes), después la versión acústica y la hoja normal
    docs = [{'a': 'System Of A Down', 'm': 'B.Y.O.B.', 'd': 'system-of-a-down', 'u': 'byob'},
            {'a': 'System Of A Down', 'm': 'Byob (acústica)', 'd': 'system-of-a-down', 'u': 'byob-acustica'},
            {'a': 'System Of A Down', 'm': 'Byob', 'd': 'system-of-a-down', 'u': 'byob-2'}]
    pages = {'https://www.cifraclub.com/system-of-a-down/byob/': sheet(0),
             'https://www.cifraclub.com/system-of-a-down/byob-acustica/': sheet(30),
             'https://www.cifraclub.com/system-of-a-down/byob-2/': sheet(200)}
    monkeypatch.setattr(pedidos, 'cifraclub_search', lambda q: docs)
    monkeypatch.setattr(pedidos, 'scrape_cifraclub', lambda url: pages.get(url, {'error': 'no'}))
    monkeypatch.setattr(pedidos, 'scrape_lacuerda', lambda url: {'error': 'no'})
    monkeypatch.setattr(pedidos.time, 'sleep', lambda s: None)
    url, found = pedidos.find_sheet('System of a Down', 'B.Y.O.B.')
    assert url == 'https://www.cifraclub.com/system-of-a-down/byob-2/'
    assert pedidos.chords_in(found) == 200
