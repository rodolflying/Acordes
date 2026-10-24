"""Traduce la letra de las canciones con letra sincronizada: del español al inglés, o del inglés al español.

La hoja muestra la traducción del renglón que se está cantando (la vista vertical de los videos, ?reel).
Pide la traducción al LLM Router (la Raspberry: `ssh -N -L 18020:127.0.0.1:8020 raspi` para alcanzarlo desde
acá) y la guarda por canción en client/public/traducciones/<video>.json, como el análisis del fondo:
{"de": "es", "a": "en", "lineas": {"renglón de la hoja": "traducción"}}. La clave es el texto del renglón,
no su número, así que una hoja que cambia de líneas no desordena las traducciones.

    python traducir_letras.py --solo el_tesoro
"""
import argparse
import html
import json
import os
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
PUBLIC = ROOT / 'client' / 'public'
OUT_DIR = PUBLIC / 'traducciones'
ROUTER = os.environ.get('LLM_ROUTER_URL', 'http://127.0.0.1:18020')

PROMPT = """Eres traductor de letras de canciones. Te paso los renglones de una canción, numerados.
Detecta su idioma. Si está en español, tradúcela al inglés; si está en otro idioma, al español.
Traduce el sentido de cada renglón de forma natural y breve, como un subtítulo (sin explicar ni rimar),
y deja los nombres propios como están. Responde solo con JSON:
{"de": "<código del idioma original>", "a": "<código del idioma de la traducción>", "lineas": ["<traducción del 1>", ...]}
con exactamente un elemento por renglón, en el mismo orden."""


def sheet_lines(content):
    """Los renglones de la hoja como los cuenta el visor (el texto del <pre>, cortado en cada salto de línea)."""
    return html.unescape(re.sub(r'<[^>]+>', '', content)).split('\n')


def ask_router(lines):
    numbered = '\n'.join(f'{i + 1}. {line}' for i, line in enumerate(lines))
    body = json.dumps({
        'project_id': 'acordes', 'tier': 'general', 'max_tokens': 3000,
        'response_format': {'type': 'json_object'},
        'messages': [{'role': 'system', 'content': PROMPT}, {'role': 'user', 'content': numbered}],
    }).encode()
    req = urllib.request.Request(f'{ROUTER}/v1/chat/completions', body, {'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=180) as res:
        reply = json.load(res)
    data = json.loads(reply['choices'][0]['message']['content'])
    if len(data.get('lineas', [])) != len(lines):
        raise ValueError(f"el modelo devolvió {len(data.get('lineas', []))} traducciones para {len(lines)} renglones")
    return data, reply.get('model', '?')


def main(solo='', force=False):
    sheets = json.loads((PUBLIC / 'preloaded_songs.json').read_text(encoding='utf-8'))
    sync = json.loads((PUBLIC / 'sync_points.json').read_text(encoding='utf-8'))
    tracks = json.loads((PUBLIC / 'backing_tracks.json').read_text(encoding='utf-8'))['backing_tracks']
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    done = 0
    for url, points in sync.items():
        if solo and solo.lower() not in url.lower():
            continue
        # Guardada bajo el primer video de la canción, como el análisis del fondo (los tres comparten la letra)
        video = next((tracks.get(url, {}).get(v, {}).get('id') for v in ('Karaoke', 'Instrumental', 'Backtrack')
                      if tracks.get(url, {}).get(v)), None)
        if not video or url not in sheets:
            continue
        out = OUT_DIR / f'{video}.json'
        if out.exists() and not force:
            continue
        lines = sheet_lines(sheets[url]['content'])
        sung = list(dict.fromkeys(lines[p[1]].strip() for p in points if p[1] < len(lines) and lines[p[1]].strip()))
        data, model = ask_router(sung)
        result = {'de': data.get('de', ''), 'a': data.get('a', ''), 'lineas': dict(zip(sung, (t.strip() for t in data['lineas'])))}
        out.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding='utf-8')
        done += 1
        print(f"  {url.rsplit('/', 1)[-1]}: {len(sung)} renglones, {result['de']} -> {result['a']} ({model})")
    print(f'Traducciones: {done} canciones')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--solo', default='')
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    main(args.solo, args.force)
