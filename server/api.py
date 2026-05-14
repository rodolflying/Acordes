from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from curl_cffi import requests
from bs4 import BeautifulSoup
import re

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

import json

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

