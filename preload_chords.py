import json
import os
import time
import sys

# Reutilizar lógica de api.py
sys.path.append(os.path.join(os.path.dirname(__file__), 'server'))
from api import scrape_cifraclub, scrape_lacuerda

def main():
    print("Cargando songs.json...")
    with open('songs.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    urls = []
    def get_urls(node):
        if 'url' in node:
            urls.append(node['url'])
        if 'children' in node:
            for c in node['children']:
                get_urls(c)
    get_urls(data)
    
    print(f"Total de canciones: {len(urls)}")
    
    preloaded = {}
    
    for i, url in enumerate(urls):
        print(f"[{i+1}/{len(urls)}] Descargando {url}...")
        try:
            if 'cifraclub' in url:
                res = scrape_cifraclub(url)
                if "error" not in res:
                    preloaded[url] = res
            elif 'lacuerda' in url:
                res = scrape_lacuerda(url)
                if "error" not in res:
                    preloaded[url] = res
            else:
                pass # Otras webs no se pre-cargan
        except Exception as e:
            print(f"Error en {url}: {e}")
        time.sleep(0.5) # Pausa pequeña para no ser baneados
        
    # Guardar en public del cliente
    out_path = os.path.join('client', 'public', 'preloaded_songs.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(preloaded, f, ensure_ascii=False)
        
    # También copiar songs.json a public
    with open(os.path.join('client', 'public', 'songs.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
        
    # También copiar enriched_songs.json a public si existe
    enriched_src = 'enriched_songs.json'
    enriched_dest = os.path.join('client', 'public', 'enriched_songs.json')
    if os.path.exists(enriched_src):
        try:
            import shutil
            shutil.copy(enriched_src, enriched_dest)
            print("Se copió enriched_songs.json a la carpeta pública del cliente")
        except Exception as e:
            print(f"Error copiando enriched_songs.json: {e}")
        
    print("¡Pre-carga completada con éxito!")

if __name__ == '__main__':
    main()
