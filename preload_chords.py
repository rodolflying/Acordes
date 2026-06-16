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
    out_path = os.path.join('client', 'public', 'preloaded_songs.json')
    if os.path.exists(out_path):
        try:
            with open(out_path, 'r', encoding='utf-8') as f:
                preloaded = json.load(f)
            print(f"Cargadas {len(preloaded)} canciones ya pre-cargadas de la caché.")
        except Exception as e:
            print(f"No se pudo cargar preloaded_songs.json existente: {e}")
            
    for i, url in enumerate(urls):
        if url in preloaded:
            continue
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
            
    # Generar backing_tracks.json en la carpeta pública del cliente
    generate_backing_tracks()
        
    print("¡Pre-carga completada con éxito!")

def generate_backing_tracks():
    print("Generando mapping de backing tracks...")
    import re
    import sys
    
    def normalize_string(s: str) -> str:
        import unicodedata
        s = s.lower()
        s = ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')
        s = re.sub(r'[^a-z0-9\s]', '', s)
        return " ".join(s.split())
        
    root_dir = os.path.dirname(os.path.abspath(__file__))
    youtube_state_path = os.path.join(os.path.dirname(root_dir), "Karaokes", "youtube_upload_state.json")
    
    if not os.path.exists(youtube_state_path):
        print(f"Advertencia: {youtube_state_path} no existe. No se generará backing_tracks.json.")
        return
        
    with open(youtube_state_path, 'r', encoding='utf-8') as f:
        youtube_data = json.load(f)
        
    uploads = youtube_data.get("uploads", {})
    
    # Importar parser de nombres de enricher
    sys.path.append(root_dir)
    try:
        from enricher import parse_song_name
    except ImportError:
        print("No se pudo importar parse_song_name de enricher, se usará fallback")
        def parse_song_name(name):
            return ("Unknown", name)
            
    # Cargar metadatos enriquecidos si existen
    enriched_data = {"songs": {}}
    enriched_path = os.path.join(root_dir, 'enriched_songs.json')
    if os.path.exists(enriched_path):
        try:
            with open(enriched_path, 'r', encoding='utf-8') as f:
                enriched_data = json.load(f)
        except Exception as e:
            print(f"Error cargando enriched_songs.json: {e}")

    with open(os.path.join(root_dir, 'songs.json'), 'r', encoding='utf-8') as f:
        songs_data = json.load(f)
        
    url_to_name = {}
    def walk_nodes(node):
        if 'url' in node and 'name' in node:
            url_to_name[node['url']] = node['name']
        if 'children' in node:
            for child in node['children']:
                walk_nodes(child)
    walk_nodes(songs_data)
    
    backing_tracks_map = {}
    
    for url, name in url_to_name.items():
        enriched = enriched_data.get("songs", {}).get(url, {})
        artist = enriched.get("artist")
        title = enriched.get("title")
        
        if not artist or not title:
            artist, title = parse_song_name(name)
            
        norm_artist = normalize_string(artist)
        norm_title = normalize_string(title)
        
        candidate_tracks = {}
        for key, info in uploads.items():
            if info.get("status") != "uploaded" or "video_id" not in info:
                continue
            if '/' not in key:
                continue
                
            clean_key, version = key.rsplit('/', 1)
            norm_key = normalize_string(clean_key)
            
            is_match = False
            if norm_artist in norm_key and norm_title in norm_key:
                is_match = True
            else:
                parts = [normalize_string(p) for p in clean_key.split(' - ')]
                if len(parts) >= 2:
                    p1, p2 = parts[0], parts[1]
                    if (norm_artist in p1 and norm_title in p2) or (norm_title in p1 and norm_artist in p2):
                        is_match = True
            
            if is_match:
                v_lower = version.lower()
                if "karaoke" in v_lower:
                    version_label = "Karaoke"
                elif "instrumental" in v_lower:
                    version_label = "Instrumental"
                elif "backtrack" in v_lower or "backing" in v_lower:
                    version_label = "Backtrack"
                else:
                    version_label = version.capitalize()
                    
                candidate_tracks[version_label] = {
                    "id": info["video_id"],
                    "title": info.get("title", ""),
                    "youtube_url": info.get("youtube_url", "")
                }
        if candidate_tracks:
            backing_tracks_map[url] = candidate_tracks
            
    backing_out = os.path.join(root_dir, 'client', 'public', 'backing_tracks.json')
    with open(backing_out, 'w', encoding='utf-8') as f:
        json.dump({"backing_tracks": backing_tracks_map}, f, ensure_ascii=False, indent=2)
    print(f"Se generó backing_tracks.json en la carpeta del cliente ({len(backing_tracks_map)} canciones mapeadas)")

if __name__ == '__main__':
    main()
