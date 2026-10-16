"""Tests del parser de nombres de marcadores (enricher.parse_song_name).

Correr desde la raíz del proyecto:  python -m pytest tests
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from enricher import parse_song_name, parse_song_url  # noqa: E402


@pytest.mark.parametrize("name, expected", [
    # Cifra Club
    ("Fix You - Coldplay - Cifra Club", ("Coldplay", "Fix You")),
    ("Firestone (feat. Conrad Sewell) - Kygo - Cifra Club", ("Kygo", "Firestone (feat. Conrad Sewell)")),
    ("Niño Eterno (acordes) - Cardellino - Cifra Club", ("Cardellino", "Niño Eterno")),
    ("Stand by Me - Ben E. King - Cifra Club", ("Ben E. King", "Stand by Me")),
    # LaCuerda
    ("GEHENA, Ases Falsos: Acordes", ("Ases Falsos", "Gehena")),
    ("EL TESORO, El mató a un Policía Motorizado: Acordes", ("El mató a un Policía Motorizado", "El Tesoro")),
    ("A PERDERSE: Acordes y Letra para Guitarra, Ukulele, Bajo y Piano (Lucybell)", ("Lucybell", "A Perderse")),
    # Ukulele Tabs, en inglés y en español
    ("I Won't Give Up Uke tab by Jason Mraz - Ukulele Tabs", ("Jason Mraz", "I Won't Give Up")),
    ("Destrucción Tab por El Mato A Un Policia Motorizado - Ukulele Tabs", ("El Mato A Un Policia Motorizado", "Destrucción")),
    # Ultimate Guitar, en inglés y en español
    ("OIL AND WATER CHORDS by Incubus for Guitar, Ukulele & Piano at Ultimate-Guitar", ("Incubus", "Oil and Water")),
    ("THE BAY CHORDS (ver 2) by Metronomy @ Ultimate-Guitar.Com", ("Metronomy", "The Bay")),
    ("GUSTARME TANTO ACORDES (ver 2) por Zcar JPG @ Ultimate-Guitar.Com", ("Zcar JPG", "Gustarme Tanto")),
    ("ON MELANCHOLY HILL ACORDES (ver 2) por Gorillaz para guitarra, ukulele, piano en Ultimate-Guitar.Com",
     ("Gorillaz", "On Melancholy Hill")),
])
def test_parse_song_name(name, expected):
    assert parse_song_name(name) == expected


@pytest.mark.parametrize("url, expected", [
    # Marcadores sin nombre útil (se llamaban solo "acordes.lacuerda.net")
    ("https://acordes.lacuerda.net/maluma/admv", ("Maluma", "Admv")),
    ("https://acordes.lacuerda.net/los_bunkers/bailando_solo-2.shtml", ("Los Bunkers", "Bailando Solo")),
    ("https://www.cifraclub.com/linkin-park/shadow-of-the-day/szww/", ("Linkin Park", "Shadow of the Day")),
    ("https://www.youtube.com/watch?v=abc", None),
])
def test_parse_song_url(url, expected):
    assert parse_song_url(url) == expected
