"""Segunda pasada: buscador de Cifra Club (en vez de adivinar la URL) para las que no aparecieron,
y versión acústica disponible para todas. Lee setlist_result.json y escribe setlist_result2.json."""
import json, re, sys, time, urllib.parse
from pathlib import Path
from curl_cffi import requests

HERE = Path(__file__).parent
sys.path[:0] = [str(HERE)]
from check_setlist import scrape_cifraclub, chords_in, fold


def cc_search(q):
    r = requests.get('https://solr.sscdn.co/cc/h2/?q=' + urllib.parse.quote(q), impersonate='chrome110', timeout=20)
    body = r.text.strip()
    body = body[body.index('{'):body.rindex('}') + 1]
    return [d for d in json.loads(body)['response']['docs'] if d.get('t') == '2']


def same(a, b):
    a, b = fold(a), fold(b)
    return bool(a and b) and (a == b or a in b or b in a)


ACOUSTIC = re.compile(r'ac[uú]stic|acoustic|unplugged|desenchufado', re.I)


def main():
    rows = json.loads((HERE / 'setlist_result.json').read_text(encoding='utf-8'))
    # Interpretaciones corregidas después de la primera pasada
    fixes = {'Mi historia entre tus manos - Gianluca': ('Gianluca Grignani', 'Mi historia entre tus dedos'),
             'Daddy Yankee El Amante': ('Daddy Yankee', 'El amante')}
    for row in rows:
        if row['raw'] in fixes:
            row['artist'], row['title'] = fixes[row['raw']]
            row['lastfm'], row['sheet'], row['have'] = None, None, []
    for row in rows:
        names = [(row['artist'], row['title'])]
        if row.get('lastfm'):
            names.append((row['lastfm']['artist'], row['lastfm']['title']))
        docs = []
        for a, t in names:
            docs = cc_search(f'{a} {t}')
            time.sleep(0.3)
            docs = [d for d in docs if same(d['a'], a)]
            if docs:
                break
        # Versión acústica de la misma canción en Cifra Club
        title = fold(names[-1][1])
        ac = [d for d in docs if ACOUSTIC.search(d['m'] + ' ' + d['u']) and title.split()[0] in fold(d['m'])]
        row['acoustic'] = [f"https://www.cifraclub.com/{d['d']}/{d['u']}/" for d in ac]
        need = not row['have'] and not (row.get('sheet') or {}).get('url')
        if need:
            hit = next((d for d in docs if not ACOUSTIC.search(d['m'])
                        and (same(d['m'], names[0][1]) or same(d['m'], names[-1][1]))), None)
            if hit:
                url = f"https://www.cifraclub.com/{hit['d']}/{hit['u']}/"
                res = scrape_cifraclub(url)
                n = chords_in(res.get('content'))
                if n >= 4:
                    row['sheet'] = {'url': url, 'chords': n, 'via': 'buscador', 'as': f"{hit['a']} - {hit['m']}"}
            print(f"{'OK  ' if (row.get('sheet') or {}).get('url') else 'NADA'} | {row['raw']} | "
                  f"{(row.get('sheet') or {}).get('url') or [(d['a'], d['m']) for d in docs[:3]]}", flush=True)
        if row['acoustic']:
            print(f"     acústica: {row['raw']} -> {row['acoustic']}", flush=True)
    (HERE / 'setlist_result2.json').write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding='utf-8')


if __name__ == '__main__':
    main()
