"""Tercera pasada para las que quedan: todas las versiones en Cifra Club + índice del artista en LaCuerda."""
import json, re, sys, time
from pathlib import Path
from curl_cffi import requests
from bs4 import BeautifulSoup
sys.path[:0] = [str(Path(__file__).parent)]
from check_setlist import scrape_cifraclub, scrape_lacuerda, chords_in, fold
from pass2 import cc_search, same

TODO = [('System of a Down', 'Toxicity', ['system_of_a_down']), ('System of a Down', 'B.Y.O.B.', ['system_of_a_down']),
        ('Silverstein', 'Discovering the Waterfront', ['silverstein']), ('Saosin', 'Seven Years', ['saosin']),
        ('Linkin Park', 'Runaway', ['linkin_park']), ('Linkin Park', 'One Step Closer', ['linkin_park']),
        ('Avril Lavigne', 'Sk8er Boi', ['avril_lavigne']), ('Fakie', 'Ya son las 4', ['fakie']),
        ('Karkú', 'Cada vez', ['karku']), ('Karkú', 'Chico malo', ['karku'])]

def key(t):
    return re.sub(r'[^a-z0-9]', '', fold(t))

for artist, title, lc_slugs in TODO:
    found = []
    for q in (f'{artist} {title}', title, f'{artist} {title.replace("8", "a")}'):
        for d in cc_search(q):
            if same(d['a'], artist) and key(title)[:5] in key(d['m'] + d['u']):
                url = f"https://www.cifraclub.com/{d['d']}/{d['u']}/"
                if url not in [f[0] for f in found]:
                    found.append((url, chords_in(scrape_cifraclub(url).get('content')), d['m']))
                    time.sleep(0.3)
    for slug in lc_slugs:
        r = requests.get(f'https://acordes.lacuerda.net/{slug}/', impersonate='chrome110')
        links = {a.get('href') for a in BeautifulSoup(r.text, 'lxml').find_all('a')}
        for h in sorted(l for l in links if l and key(title)[:5] in key(l) and '/' not in l.strip('/')):
            base = f'https://acordes.lacuerda.net/{slug}/{h.strip("/")}'
            for v in ['', '-2', '-3']:
                url = base + v + '.shtml'
                found.append((url, chords_in(scrape_lacuerda(url).get('content')), h))
                time.sleep(0.3)
    best = max(found, key=lambda f: f[1], default=None)
    print(f"{artist} - {title}: {[f for f in found if f[1] > 0] or 'nada'}", flush=True)
