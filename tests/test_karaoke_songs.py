"""Tests de cómo karaoke_songs.py arma las URLs candidatas de Cifra Club y LaCuerda.

Correr desde la raíz del proyecto:  python -m pytest tests
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from karaoke_songs import candidate_urls, slug, song_name  # noqa: E402


def urls_for(artist, title):
    return [url for url, _, _ in candidate_urls(artist, title)]


def test_slug_rejoins_contractions_and_drops_accents():
    assert slug("Cowboys Don t Cry", "-") == "cowboys-dont-cry"   # el apóstrofo llega como espacio
    assert slug("I m Gone", "-") == "im-gone"
    assert slug("Bailando Solo", "_") == "bailando_solo"
    assert slug("Corazón & Ñandú", "-") == "corazon-nandu"


def test_candidate_urls_try_the_full_artist_first_then_the_first_artist():
    urls = urls_for("Kidd Voodoo Mon Laferte", "Incondicional")
    assert urls[0] == "https://www.cifraclub.com/kidd-voodoo-mon-laferte/incondicional/"
    assert "https://www.cifraclub.com/kidd-voodoo/incondicional/" in urls
    assert "https://acordes.lacuerda.net/kidd_voodoo_mon_laferte/incondicional.shtml" in urls


def test_candidate_urls_clean_the_title():
    # Sin el "ft ..." y sin el artista repetido al comienzo del título
    assert "https://www.cifraclub.com/rosalia/la-perla/" in urls_for("ROSALIA", "La Perla ft Yahritza Y Su Esencia")
    assert "https://www.cifraclub.com/milo-j/rara-vez/" in urls_for("MILO J", "MILO J RARA VEZ")


def test_candidate_urls_also_try_title_and_artist_swapped():
    # Algunos karaokes vienen como "Título - Artista" ("Bailando Solo - Los Bunkers")
    assert ("https://www.cifraclub.com/los-bunkers/bailando-solo/", "Los Bunkers", "Bailando Solo") in candidate_urls(
        "Bailando Solo", "Los Bunkers")


def test_song_name_comes_from_the_variant_that_found_the_page():
    # Nombre limpio para la tarjeta: sin el artista repetido ni el "ft", y con los apóstrofos de vuelta
    assert song_name("MILO J - MILO J RARA VEZ", "https://acordes.lacuerda.net/milo_j/rara_vez.shtml") == "RARA VEZ - MILO J - LaCuerda"
    assert song_name("Milo J Trueno - Gil", "https://acordes.lacuerda.net/milo_j/gil.shtml") == "Gil - Milo J - LaCuerda"
    assert song_name("Oliver Tree - I m Gone", "https://www.cifraclub.com/oliver-tree/im-gone/") == "I'm Gone - Oliver Tree - Cifra Club"
    assert song_name("Bailando Solo - Los Bunkers", "https://www.cifraclub.com/los-bunkers/bailando-solo/") == "Bailando Solo - Los Bunkers - Cifra Club"
