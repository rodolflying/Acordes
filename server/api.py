from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from curl_cffi import requests
from bs4 import BeautifulSoup
import re
import json
import os
import urllib.parse
from datetime import datetime
from pydantic import BaseModel
from typing import Optional

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def scrape_cifraclub(url: str):
    r = requests.get(url, impersonate='chrome110')
    soup = BeautifulSoup(r.text, 'lxml')
    pre = soup.find('pre')
    if not pre:
        return {"error": "Could not find chords section"}
    
    capo_info = ""
    capo_el = soup.find(id='cifra_capo')
    if capo_el:
        capo_text = capo_el.text.strip()
        capo_info = f'<div class="capo-info" style="color: var(--primary); font-weight: bold; margin-bottom: 1rem; font-size: 1.2rem;"><i class="fas fa-guitar"></i> {capo_text}</div>\n'
    
    return {"source": "CifraClub", "content": capo_info + clean_cifraclub_html(str(pre))}


def clean_cifraclub_html(pre_html: str) -> str:
    """El <pre> de Cifra Club a nuestro formato, con los acordes en <span class="chord">.

    Cifra Club marca los acordes con <b> (en su HTML nuevo, con atributos data-chord-*) y agrupa
    las líneas en <div class="kvMV">, que se quitan sin tocar los saltos de línea.
    """
    content = re.sub(r'<b(?:\s[^>]*)?>', '<span class="chord">', pre_html)
    content = content.replace('</b>', '</span>')
    content = re.sub(r'</?div[^>]*>', '', content)
    content = re.sub(r'<pre.*?>', '', content)
    return content.replace('</pre>', '')

def scrape_lacuerda(url: str):
    r = requests.get(url, impersonate='chrome110')
    soup = BeautifulSoup(r.text, 'lxml')
    
    t_body = soup.find(id='t_body')
    if not t_body:
        return {"error": "Could not find chords section"}
    
    capo_info = ""
    cnotas = t_body.find(id='cnotas')
    if cnotas:
        cnotas_text = cnotas.text.strip()
        capo_info = f'<div class="capo-info" style="color: var(--primary); font-weight: bold; margin-bottom: 1rem; font-size: 1.2rem;"><i class="fas fa-info-circle"></i> {cnotas_text}</div>\n'
    
    pre = t_body.find('pre')
    if not pre:
        pre = t_body
        
    for a in pre.find_all('a'):
        chord_name = a.text.replace('[', '').replace(']', '')
        # Crear un tag span real para no ser escapado
        span_tag = soup.new_tag("span", attrs={"class": "chord"})
        span_tag.string = chord_name
        a.replace_with(span_tag)
        
    content = str(pre)
    content = re.sub(r'<pre.*?>', '', content, flags=re.IGNORECASE)
    content = content.replace('</pre>', '').replace('</PRE>', '')
    content = content.replace('<div></div>', '')
    return {"source": "LaCuerda", "content": capo_info + content.strip()}

@app.get("/api/song")
def get_song(url: str):
    try:
        if 'cifraclub' in url:
            return scrape_cifraclub(url)
        elif 'lacuerda' in url:
            return scrape_lacuerda(url)
        else:
            return {"error": "Fuente no soportada (bloqueada o no implementada). Abre el link nativo."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

import subprocess
import os

@app.post("/api/refresh")
def refresh_bookmarks():
    try:
        root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        
        # 1. extract bookmarks
        script_path = os.path.join(root_dir, "extract_bookmarks.py")
        subprocess.run(["python", script_path], check=True, cwd=root_dir)

        # 2. songs with an uploaded karaoke but no chords bookmark
        subprocess.run(["python", os.path.join(root_dir, "karaoke_songs.py")], check=True, cwd=root_dir)
        
        # 3. enrich new songs
        enricher_path = os.path.join(root_dir, "enricher.py")
        if os.path.exists(enricher_path):
            subprocess.run(["python", enricher_path], check=True, cwd=root_dir)
            
        # 4. preload chords, backing tracks mapping and lyric times
        preload_path = os.path.join(root_dir, "preload_chords.py")
        if os.path.exists(preload_path):
            subprocess.run(["python", preload_path], check=True, cwd=root_dir)
            
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/songs")
def get_songs_data():
    try:
        root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        songs_path = os.path.join(root_dir, "songs.json")
        with open(songs_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def load_youtube_api_key():
    try:
        root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        env_path = os.path.join(os.path.dirname(root_dir), "Karaokes", ".env")
        if os.path.exists(env_path):
            with open(env_path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, val = line.split('=', 1)
                        if key.strip() == 'YOUTUBE_DATA_API':
                            return val.strip()
    except Exception as e:
        print(f"Error loading youtube API key: {e}")
    return None

def verify_videos_public(video_ids: list[str], api_key: str) -> set[str]:
    if not api_key or not video_ids:
        return set(video_ids)
        
    try:
        # YouTube API lists videos status
        verified_ids = set()
        for i in range(0, len(video_ids), 50):
            batch = video_ids[i:i+50]
            ids_str = ",".join(batch)
            params = urllib.parse.urlencode({
                'part': 'status',
                'id': ids_str,
                'key': api_key
            })
            url = f"https://www.googleapis.com/youtube/v3/videos?{params}"
            
            # Using standard urllib since it's a simple public API call
            req = urllib.request.Request(url, headers={'User-Agent': 'Acordes/1.0'})
            import urllib.request as urllib_request
            with urllib_request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                
            for item in data.get('items', []):
                v_id = item.get('id')
                privacy = item.get('status', {}).get('privacyStatus', '')
                if v_id and privacy == 'public':
                    verified_ids.add(v_id)
                    
        return verified_ids
    except Exception as e:
        print(f"Error verifying YouTube videos status: {e}")
        # Fallback to candidate IDs to not block if there is a network/quota error
        return set(video_ids)

def normalize_string(s: str) -> str:
    import unicodedata
    s = s.lower()
    s = ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')
    s = re.sub(r'[^a-z0-9\s]', '', s)
    return " ".join(s.split())

@app.get("/api/youtube/has_backing_tracks")
def get_all_uploaded_songs():
    try:
        root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        candidates = [
            os.path.join(os.path.dirname(root_dir), "Karaokes", "data", "youtube_upload_state.json"),
            os.path.join(os.path.dirname(root_dir), "Karaokes", "youtube_upload_state.json"),
            os.path.join(root_dir, "youtube_upload_state.json")
        ]
        youtube_state_path = next((p for p in candidates if os.path.exists(p)), None)
        
        if not youtube_state_path:
            return {"songs": []}
            
        with open(youtube_state_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        uploads = data.get("uploads", {})
        uploaded_songs = {}
        
        for key, info in uploads.items():
            if info.get("status") != "uploaded":
                continue
                
            if '/' not in key:
                continue
                
            clean_key, version = key.rsplit('/', 1)
            parts = clean_key.split(' - ')
            if len(parts) >= 2:
                artist = parts[0].strip()
                title = parts[1].strip()
                song_id = f"{artist.lower()} - {title.lower()}"
                if song_id not in uploaded_songs:
                    uploaded_songs[song_id] = {
                        "artist": artist,
                        "title": title
                    }
                    
        return {"songs": list(uploaded_songs.values())}
    except Exception as e:
        print(f"Error getting uploaded songs list: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/song/backing_tracks")
def get_song_backing_tracks(artist: str = "", title: str = ""):
    try:
        root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        candidates = [
            os.path.join(os.path.dirname(root_dir), "Karaokes", "data", "youtube_upload_state.json"),
            os.path.join(os.path.dirname(root_dir), "Karaokes", "youtube_upload_state.json"),
            os.path.join(root_dir, "youtube_upload_state.json")
        ]
        youtube_state_path = next((p for p in candidates if os.path.exists(p)), None)
        
        if not youtube_state_path:
            return {"backing_tracks": None}
            
        with open(youtube_state_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        uploads = data.get("uploads", {})
        candidate_tracks = {}
        video_ids_to_verify = []
        
        norm_artist = normalize_string(artist)
        norm_title = normalize_string(title)
        
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
                    
                v_id = info["video_id"]
                candidate_tracks[version_label] = {
                    "id": v_id,
                    "title": info.get("title", ""),
                    "youtube_url": info.get("youtube_url", "")
                }
                video_ids_to_verify.append(v_id)
                
        # Now verify public privacy status of the matched candidates via YouTube Data API
        if candidate_tracks:
            api_key = load_youtube_api_key()
            public_ids = verify_videos_public(video_ids_to_verify, api_key)
            
            # Filter tracks to only include public ones
            public_tracks = {}
            for ver, track in candidate_tracks.items():
                if track["id"] in public_ids:
                    public_tracks[ver] = track
                    
            if public_tracks:
                return {"backing_tracks": public_tracks}
                
        return {"backing_tracks": None}
    except Exception as e:
        print(f"Error matching backing tracks: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class LinkVideoRequest(BaseModel):
    url: str
    video_id: str
    video_title: str


@app.get("/api/youtube/search")
def search_youtube(query: str):
    api_key = load_youtube_api_key()
    if not api_key:
        raise HTTPException(status_code=500, detail="YouTube API key not configured")
    try:
        import urllib.request
        import urllib.parse
        
        params = urllib.parse.urlencode({
            'part': 'snippet',
            'q': query,
            'maxResults': 5,
            'type': 'video',
            'key': api_key
        })
        url = f"https://www.googleapis.com/youtube/v3/search?{params}"
        
        req = urllib.request.Request(url, headers={'User-Agent': 'Acordes/1.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            
        results = []
        for item in data.get('items', []):
            v_id = item.get('id', {}).get('videoId')
            snippet = item.get('snippet', {})
            if v_id:
                results.append({
                    'id': v_id,
                    'title': snippet.get('title'),
                    'description': snippet.get('description'),
                    'channelTitle': snippet.get('channelTitle'),
                    'thumbnail': snippet.get('thumbnails', {}).get('default', {}).get('url')
                })
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/song/link_video")
def link_song_video(req_data: LinkVideoRequest):
    try:
        root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        enriched_path = os.path.join(root_dir, 'enriched_songs.json')
        
        # Load enriched songs
        enriched = {"last_enriched": None, "songs": {}}
        if os.path.exists(enriched_path):
            with open(enriched_path, 'r', encoding='utf-8') as f:
                enriched = json.load(f)
                
        # If song is not enriched yet, we initialize it
        if req_data.url not in enriched["songs"]:
            import sys
            if root_dir not in sys.path:
                sys.path.append(root_dir)
            from enricher import parse_song_name, detect_source
            
            # Find name from songs.json if possible
            songs_path = os.path.join(root_dir, 'songs.json')
            folder = "Musica"
            name = "Unknown"
            if os.path.exists(songs_path):
                with open(songs_path, 'r', encoding='utf-8') as sf:
                    songs_data = json.load(sf)
                
                def find_song(node):
                    if node.get('url') == req_data.url:
                        return node
                    if 'children' in node:
                        for c in node['children']:
                            res = find_song(c)
                            if res:
                                return res
                    return None
                
                song_node = find_song(songs_data)
                if song_node:
                    name = song_node.get('name', 'Unknown')
                    
            artist, title = parse_song_name(name)
            source = detect_source(req_data.url)
            
            enriched["songs"][req_data.url] = {
                "artist": artist,
                "title": title,
                "folder": folder,
                "source": source,
                "mood": "Reflexivo",
                "mood_emoji": "🔮",
                "theme": "Existencial",
                "theme_emoji": "🌀",
                "energy": "Media",
                "genre": "Unknown",
                "year": None,
                "country": None,
                "lastfm_tags": [],
                "listeners": None,
                "playcount": None,
                "enriched_at": datetime.now().isoformat()
            }
            
        # Update youtube_video
        enriched["songs"][req_data.url]["youtube_video"] = {
            "id": req_data.video_id,
            "title": req_data.video_title
        }
        
        # Save enriched using the save_enriched function from enricher
        import sys
        if root_dir not in sys.path:
            sys.path.append(root_dir)
        from enricher import save_enriched
        save_enriched(enriched)
        
        # Regenerate backing_tracks.json
        from preload_chords import generate_backing_tracks
        generate_backing_tracks()
        
        return {"status": "success", "youtube_video": enriched["songs"][req_data.url]["youtube_video"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

