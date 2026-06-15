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
    
    # Cifraclub usa <b> para los acordes. Reemplazamos sus tags con unos genéricos nuestros.
    content = str(pre)
    content = content.replace('<b>', '<span class="chord">')
    content = content.replace('</b>', '</span>')
    
    # Clean up structure
    content = re.sub(r'<pre.*?>', '', content)
    content = content.replace('</pre>', '')
    return {"source": "CifraClub", "content": capo_info + content}

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
        script_path = os.path.join(root_dir, "extract_bookmarks.py")
        subprocess.run(["python", script_path], check=True, cwd=root_dir)
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
        youtube_state_path = os.path.join(os.path.dirname(root_dir), "Karaokes", "youtube_upload_state.json")
        
        if not os.path.exists(youtube_state_path):
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
        youtube_state_path = os.path.join(os.path.dirname(root_dir), "Karaokes", "youtube_upload_state.json")
        
        if not os.path.exists(youtube_state_path):
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

