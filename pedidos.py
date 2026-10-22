"""
pedidos.py — Canciones pedidas que no vienen de tus marcadores (el setlist de la banda y, más
adelante, lo que pidan los usuarios desde la página).

pedidos.json guarda cada pedido con su estado:
    pendiente  → todavía no se busca su hoja
    encontrada → tiene hoja con acordes (url), entra al repertorio
    sin_hoja   → no hay hoja con acordes en Cifra Club ni LaCuerda (solo tablaturas, o no existe)

Cada corrida busca la hoja de los pendientes, agrega las encontradas a songs.json en la carpeta
"Pedidos" (se rehace siempre: extract_bookmarks.py reescribe el archivo) y deja sus acordes en la
precarga.

Para encontrar la hoja no basta con adivinar la URL ("la-oreja-de-van-gogh-musicas", "byob-2",
"oreja_de_van_gogh"): primero el buscador de Cifra Club, después la URL esperada y al final el
índice del artista en LaCuerda. Muchas páginas de metal son solo tablaturas, así que una hoja
cuenta si trae acordes marcados.

Uso:
    python pedidos.py            # después de karaoke_songs.py
    python pedidos.py --retry    # vuelve a buscar las que quedaron sin hoja
"""

import html
import json
import re
import sys
import time
import urllib.parse
from pathlib import Path

from curl_cffi import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).parent
sys.path.append(str(ROOT / 'server'))
from api import scrape_cifraclub, scrape_lacuerda  # noqa: E402
from karaoke_songs import candidate_urls, slug  # noqa: E402

PEDIDOS_FILE = ROOT / 'pedidos.json'
SONGS_FILE = ROOT / 'songs.json'
PRELOADED_FILE = ROOT / 'client' / 'public' / 'preloaded_songs.json'
FOLDER = 'Pedidos'
MIN_CHORDS = 4  # menos que eso es una tablatura o una página sin acordes marcados
MIN_LYRIC_LINES = 12  # una hoja de verdad trae la letra; una partitura de ritmo marca "acordes" (S, E, Q) sin letra
ACOUSTIC = re.compile(r'ac[uú]stic|acoustic|unplugged', re.IGNORECASE)


def chords_in(sheet: dict) -> int:
    return len(re.findall(r'class="chord"', sheet.get('content') or '')) if 'error' not in sheet else 0


def lyric_lines(sheet: dict) -> int:
    """Líneas de letra de la hoja: con al menos 3 palabras, sin contar acordes ni tablaturas. La hoja de B.Y.O.B.
    que se aceptó era una partitura de ritmo ("S S q e.") con 204 "acordes" y ninguna línea de letra."""
    n = 0
    for raw in (sheet.get('content') or '').split('\n'):
        text = html.unescape(re.sub(r'<[^>]+>', '', re.sub(r'<span class="chord[^"]*"[^>]*>.*?</span>', ' ', raw)))
        if not re.search(r'[|-]{4,}', text) and len(re.findall(r'[^\W\d_]{2,}', text)) >= 3:
            n += 1
    return n


def same_name(a: str, b: str) -> bool:
    a, b = slug(a, ''), slug(b, '')  # sin espacios: "B.Y.O.B." = "Byob"
    return bool(a and b) and (a == b or a in b or b in a)


def cifraclub_search(query: str) -> list[dict]:
    """Canciones del buscador de Cifra Club: {'a': artista, 'm': título, 'd': slug artista, 'u': slug canción}."""
    r = requests.get('https://solr.sscdn.co/cc/h2/?q=' + urllib.parse.quote(query), impersonate='chrome110', timeout=20)
    body = r.text[r.text.find('{'):r.text.rfind('}') + 1]  # viene como JSONP: ({...})
    return [d for d in json.loads(body)['response']['docs'] if d.get('t') == '2'] if body else []


def index_links(page: str, prefix: str) -> list[str]:
    """Links de la página de un artista que empiezan con `prefix`."""
    r = requests.get(page, impersonate='chrome110', timeout=20)
    return sorted({a['href'] for a in BeautifulSoup(r.text, 'lxml').find_all('a', href=True) if a['href'].startswith(prefix)})


def artist_pages(artist: str, title: str, artist_slugs: list[str]) -> list[str]:
    """Hojas de la canción en la página del artista, cuando el buscador no la encuentra por el nombre
    ("Sk8er Boi" está como "sk8er-boy", "Ya son las 4" como "ya_son_las_cuatro"): las que empiezan igual."""
    found = []
    start = slug(title, '-')[:5]
    for d in artist_slugs:  # Cifra Club
        found += [f'https://www.cifraclub.com{h}' for h in index_links(f'https://www.cifraclub.com/{d}/', f'/{d}/{start}')
                  if h.count('/') == 3]
    lc = slug(artist, '_')
    for d in dict.fromkeys([lc, re.sub(r'^(la|el|los|las|the)_', '', lc)]):  # LaCuerda: "oreja_de_van_gogh"
        links = index_links(f'https://acordes.lacuerda.net/{d}/', start.replace('-', '_'))
        found += [f'https://acordes.lacuerda.net/{d}/{h}{v}.shtml' for h in links if '.' not in h for v in ('', '-2')]
    return found


def find_sheet(artist: str, title: str, skip: set = frozenset()) -> tuple[str, dict] | None:
    """(url, hoja) de la primera hoja con acordes y letra de la canción, o None. `skip`: urls ya descartadas."""
    def scrape(url):
        time.sleep(0.3)  # amable con los sitios
        try:
            sheet = (scrape_cifraclub if 'cifraclub' in url else scrape_lacuerda)(url)
        except Exception as e:
            sheet = {'error': str(e)}
        return sheet if chords_in(sheet) >= MIN_CHORDS and lyric_lines(sheet) >= MIN_LYRIC_LINES else None

    docs = [d for d in cifraclub_search(f'{artist} {title}') if same_name(d['a'], artist)]
    songs = [d for d in docs if same_name(d['m'], title)]
    songs.sort(key=lambda d: bool(ACOUSTIC.search(d['m'] + d['u'])))  # la versión normal antes que la acústica
    urls = [f"https://www.cifraclub.com/{d['d']}/{d['u']}/" for d in songs]
    urls += [u for u, _, _ in candidate_urls(artist, title)]
    tried = set(skip)
    for url in urls:
        if url not in tried:
            tried.add(url)
            if sheet := scrape(url):
                return url, sheet
    artist_slugs = list(dict.fromkeys([d['d'] for d in docs or cifraclub_search(artist) if same_name(d['a'], artist)]
                                      or [slug(artist, '-')]))
    for url in artist_pages(artist, title, artist_slugs):
        if url not in tried:
            tried.add(url)
            if sheet := scrape(url):
                return url, sheet
    return None


def card_name(p: dict) -> str:
    """Nombre del marcador ("Título - Artista - Sitio"), el formato que entiende enricher.py."""
    site = 'Cifra Club' if 'cifraclub' in p['url'] else 'LaCuerda'
    return f"{p['titulo']} - {p['artista']} - {site}"


def main(retry: bool = False):
    data = json.loads(PEDIDOS_FILE.read_text(encoding='utf-8')) if PEDIDOS_FILE.exists() else {'pedidos': []}
    preloaded = json.loads(PRELOADED_FILE.read_text(encoding='utf-8')) if PRELOADED_FILE.exists() else {}

    todo = [p for p in data['pedidos'] if p['estado'] == 'pendiente' or (retry and p['estado'] == 'sin_hoja')]
    print(f"Pedidos por buscar: {len(todo)}")
    for p in todo:
        found = find_sheet(p['artista'], p['titulo'])
        if found:
            p['estado'], p['url'] = 'encontrada', found[0]
            preloaded[found[0]] = found[1]
        else:
            p['estado'] = 'sin_hoja'
        print(f"  {'✔' if found else '✘'} {p['artista']} - {p['titulo']}{' -> ' + found[0] if found else ''}")

    # Las encontradas que todavía no están precargadas (pedidos que llegaron con su url)
    for p in data['pedidos']:
        if p['estado'] == 'encontrada' and p['url'] not in preloaded:
            sheet = (scrape_cifraclub if 'cifraclub' in p['url'] else scrape_lacuerda)(p['url'])
            time.sleep(0.3)
            if chords_in(sheet):
                preloaded[p['url']] = sheet

    PEDIDOS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
    PRELOADED_FILE.write_text(json.dumps(preloaded, ensure_ascii=False), encoding='utf-8')

    # Carpeta "Pedidos" en songs.json, una vez cada hoja (dos pedidos pueden caer en la misma)
    found = {p['url']: card_name(p) for p in data['pedidos'] if p['estado'] == 'encontrada'}
    songs = json.loads(SONGS_FILE.read_text(encoding='utf-8'))
    songs['children'] = [c for c in songs.get('children', []) if c.get('name') != FOLDER or c.get('type') != 'folder']
    songs['children'].append({
        'name': FOLDER, 'type': 'folder',
        'children': [{'name': name, 'type': 'url', 'url': url} for url, name in found.items()],
    })
    SONGS_FILE.write_text(json.dumps(songs, ensure_ascii=False, indent=4), encoding='utf-8')
    misses = sum(1 for p in data['pedidos'] if p['estado'] == 'sin_hoja')
    print(f"Pedidos en el repertorio: {len(found)} | sin hoja con acordes: {misses}")


if __name__ == '__main__':
    main(retry='--retry' in sys.argv)
