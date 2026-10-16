"""Tests de la conversión del HTML de los sitios de acordes a nuestro formato.

Correr desde la raíz del proyecto:  python -m pytest tests
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from api import clean_cifraclub_html  # noqa: E402


def test_cifraclub_old_markup():
    assert clean_cifraclub_html('<pre>  <b>Am</b>   <b>G</b>\nletra</pre>') == '  <span class="chord">Am</span>   <span class="chord">G</span>\nletra'


def test_cifraclub_new_markup_with_attributes_and_line_divs():
    # HTML nuevo de Cifra Club: <b> con atributos data-chord-* y líneas agrupadas en <div class="kvMV">
    html = ('<pre><div class="kvMV">intro: <b data-chord-index="0" data-chord-name="Bb">Bb</b>\n\nverso:\n</div>'
            '<div class="kvMV">      <b data-chord-index="1" data-chord-name="D">D</b>\nletra</div></pre>')
    assert clean_cifraclub_html(html) == ('intro: <span class="chord">Bb</span>\n\nverso:\n'
                                          '      <span class="chord">D</span>\nletra')


def test_cifraclub_repairs_sheets_saved_half_converted():
    # Hojas guardadas antes del arreglo: la apertura quedó como <b data-...> y el cierre ya como </span>
    assert clean_cifraclub_html('<b data-chord-index="0">C</span> x') == '<span class="chord">C</span> x'
