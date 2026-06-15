"""
enricher.py — Enriquecimiento inteligente de canciones para Acordes
Usa Last.fm, MusicBrainz y Qwen LLM para clasificar mood, temática y energía.

Uso:
    python enricher.py           # Enriquecer solo canciones nuevas
    python enricher.py --all     # Re-enriquecer todas las canciones
    python enricher.py --test    # Probar con 3 canciones
"""

import json
import os
import re
import sys
import time
import argparse
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def load_env():
    """Carga variables del archivo .env"""
    env_path = Path(__file__).parent / '.env'
    config = {}
    if env_path.exists():
        with open(env_path, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    config[key.strip()] = value.strip()
    return config

ENV = load_env()
LASTFM_API_KEY = ENV.get('LASTFM_API_KEY', '')
QWEN_API_KEY = ENV.get('QWEN_API_KEY', '')
QWEN_BASE_URL = ENV.get('QWEN_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1')
QWEN_MODEL = ENV.get('QWEN_MODEL', 'qwen-plus')

ENRICHED_FILE = Path(__file__).parent / 'enriched_songs.json'
SONGS_FILE = Path(__file__).parent / 'songs.json'

# Categorías válidas
MOODS = {
    "Melancólico": "🌙",
    "Enérgico": "⚡",
    "Romántico": "💕",
    "Reflexivo": "🔮",
    "Alegre": "☀️",
    "Nostálgico": "🌅",
    "Épico": "🔥",
}

THEMES = {
    "Desamor": "💔",
    "Amor": "❤️",
    "Libertad": "🕊️",
    "Existencial": "🌀",
    "Fiesta": "🎉",
    "Protesta": "✊",
    "Naturaleza": "🌿",
    "Cotidiano": "🏠",
}

ENERGIES = ["Baja", "Media", "Alta"]

# ---------------------------------------------------------------------------
# Song Name Parser
# ---------------------------------------------------------------------------

def parse_song_name(name: str) -> tuple[str, str]:
    """
    Extrae (artist, title) del nombre del bookmark.
    
    Patrones soportados:
    - "Fix You - Coldplay - Cifra Club"           → ("Coldplay", "Fix You")
    - "GEHENA, Ases Falsos: Acordes"              → ("Ases Falsos", "Gehena")
    - "A PERDERSE: Acordes y Letra... (Lucybell)" → ("Lucybell", "A Perderse")
    - "OIL AND WATER CHORDS by Incubus..."        → ("Incubus", "Oil And Water")
    - "I Won't Give Up Uke tab by Jason Mraz..."  → ("Jason Mraz", "I Won't Give Up")
    """
    original = name.strip()
    
    # ===== Try LaCuerda patterns on original text FIRST (before stripping "Acordes") =====
    
    # Pattern A: "TITLE, ARTIST: Acordes" or "TITLE, ARTIST: Tablatura"
    m = re.match(r'^(.+?),\s*(.+?):\s*(?:Acordes|Tablatura|Acordes y Letra.*)$', original, re.IGNORECASE)
    if m:
        title, artist = m.group(1).strip(), m.group(2).strip()
        return (_title_case(artist), _title_case(title))
    
    # Pattern B: "TITLE: Acordes y Letra... (ARTIST)"
    m = re.match(r'^(.+?):\s*Acordes y Letra.*?\((.+?)\)$', original, re.IGNORECASE)
    if m:
        title, artist = m.group(1).strip(), m.group(2).strip()
        return (_title_case(artist), _title_case(title))
    
    # ===== Aggressive cleaning for other patterns =====
    clean = re.sub(r'\s*[-–]\s*(CIFRA CLUB|Cifra Club|cifra club)$', '', original, flags=re.IGNORECASE)
    clean = re.sub(r'\s*[-–]\s*Cifra Club$', '', clean, flags=re.IGNORECASE)
    clean = re.sub(r'\s*CHORDS?\s*(\(ver \d+\))?\s*by\s+', ' by ', clean, flags=re.IGNORECASE)
    clean = re.sub(r'\s+for guitar.*$', '', clean, flags=re.IGNORECASE)
    clean = re.sub(r'\s+at Ultimate-Guitar$', '', clean, flags=re.IGNORECASE)
    # Handle "TITLE Uke tab by ARTIST - Site" -> "TITLE by ARTIST"
    clean = re.sub(r'\s+Uke\s+tab\s+by\s+', ' by ', clean, flags=re.IGNORECASE)
    # Remove standalone "Uke tab" suffix (no "by" following)
    clean = re.sub(r'\s*Uke\s+tab\b.*$', '', clean, flags=re.IGNORECASE)
    # Remove "Acordes" in the middle of dash-separated names (e.g. Chordify)
    clean = re.sub(r'\s+Acordes\b', '', clean, flags=re.IGNORECASE)
    # Remove trailing " - Ukulele Tabs"
    clean = re.sub(r'\s*[-–]\s*Ukulele Tabs$', '', clean, flags=re.IGNORECASE)
    
    # Pattern C: "TITLE by ARTIST ..." (Ultimate Guitar, Chordify)
    m = re.match(r'^(.+?)\s+by\s+(.+?)(?:\s*[-–].*)?$', clean, re.IGNORECASE)
    if m:
        title, artist = m.group(1).strip(), m.group(2).strip()
        return (_title_case(artist), _title_case(title))
    
    # Pattern D: "TITLE - ARTIST - SITE" or "TITLE - ARTIST"
    parts = re.split(r'\s*[-–]\s*', clean)
    if len(parts) >= 2:
        # Remove known site names from last part
        sites = ['cifra club', 'cifraclub', 'ultimate guitar', 'chordify', 'uku-tabs', 'ukulele tabs']
        filtered = [p for p in parts if p.lower().strip() not in sites]
        if len(filtered) >= 2:
            title = filtered[0].strip()
            artist = filtered[1].strip()
            return (_title_case(artist), _title_case(title))
        elif len(filtered) == 1:
            return ('Unknown', _title_case(filtered[0].strip()))
    
    # Fallback
    return ('Unknown', _title_case(original))


def _title_case(s: str) -> str:
    """Smart title case que preserva partículas como 'de', 'la', etc."""
    if s.isupper() or s.islower():
        # All caps or all lower: convert to title case
        words = s.split()
        minor = {'a', 'al', 'de', 'del', 'el', 'en', 'la', 'las', 'lo', 'los', 
                 'un', 'una', 'y', 'e', 'o', 'the', 'a', 'an', 'and', 'or', 'of', 
                 'in', 'on', 'at', 'to', 'for', 'is', 'it', 'by', 'vs'}
        result = []
        for i, w in enumerate(words):
            if i == 0 or w.lower() not in minor:
                result.append(w.capitalize())
            else:
                result.append(w.lower())
        return ' '.join(result)
    return s


# ---------------------------------------------------------------------------
# Last.fm API
# ---------------------------------------------------------------------------

def fetch_lastfm_tags(artist: str, title: str) -> list[str]:
    """Obtiene tags de Last.fm para una canción."""
    if not LASTFM_API_KEY or LASTFM_API_KEY == 'your_lastfm_api_key_here':
        return []
    
    try:
        import urllib.request
        import urllib.parse
        
        params = urllib.parse.urlencode({
            'method': 'track.getTopTags',
            'api_key': LASTFM_API_KEY,
            'artist': artist,
            'track': title,
            'format': 'json'
        })
        url = f'http://ws.audioscrobbler.com/2.0/?{params}'
        
        req = urllib.request.Request(url, headers={'User-Agent': 'Acordes/1.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        
        if 'toptags' in data and 'tag' in data['toptags']:
            tags = data['toptags']['tag']
            # Only take tags with count > 0
            return [t['name'].lower() for t in tags[:15] if int(t.get('count', 0)) > 0]
    except Exception as e:
        print(f"  ⚠ Last.fm error for {artist} - {title}: {e}")
    
    return []


def fetch_lastfm_info(artist: str, title: str) -> dict:
    """Obtiene info de Last.fm (duración, listeners, etc.)."""
    if not LASTFM_API_KEY or LASTFM_API_KEY == 'your_lastfm_api_key_here':
        return {}
    
    try:
        import urllib.request
        import urllib.parse
        
        params = urllib.parse.urlencode({
            'method': 'track.getInfo',
            'api_key': LASTFM_API_KEY,
            'artist': artist,
            'track': title,
            'format': 'json'
        })
        url = f'http://ws.audioscrobbler.com/2.0/?{params}'
        
        req = urllib.request.Request(url, headers={'User-Agent': 'Acordes/1.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        
        if 'track' in data:
            track = data['track']
            info = {}
            if 'duration' in track and track['duration']:
                info['duration_ms'] = int(track['duration'])
            if 'listeners' in track:
                info['listeners'] = int(track['listeners'])
            if 'playcount' in track:
                info['playcount'] = int(track['playcount'])
            # Extract tags from track info too
            if 'toptags' in track and 'tag' in track['toptags']:
                info['tags'] = [t['name'].lower() for t in track['toptags']['tag']]
            return info
    except Exception as e:
        print(f"  ⚠ Last.fm info error for {artist} - {title}: {e}")
    
    return {}


# ---------------------------------------------------------------------------
# MusicBrainz API
# ---------------------------------------------------------------------------

def fetch_musicbrainz_metadata(artist: str, title: str) -> dict:
    """Busca metadata en MusicBrainz (género, año)."""
    try:
        import urllib.request
        import urllib.parse
        
        query = f'recording:"{title}" AND artist:"{artist}"'
        params = urllib.parse.urlencode({
            'query': query,
            'fmt': 'json',
            'limit': 1
        })
        url = f'https://musicbrainz.org/ws/2/recording/?{params}'
        
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Acordes/1.0 (contact: acordes@example.com)',
            'Accept': 'application/json'
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        
        result = {}
        if 'recordings' in data and data['recordings']:
            rec = data['recordings'][0]
            
            # Get year from first release
            if 'releases' in rec and rec['releases']:
                release = rec['releases'][0]
                if 'date' in release and release['date']:
                    try:
                        result['year'] = int(release['date'][:4])
                    except (ValueError, IndexError):
                        pass
                if 'country' in release:
                    result['country'] = release['country']
            
            # Get tags/genres
            if 'tags' in rec:
                result['genres'] = [t['name'] for t in rec['tags'][:5]]
        
        return result
    except Exception as e:
        print(f"  ⚠ MusicBrainz error for {artist} - {title}: {e}")
    
    return {}


# ---------------------------------------------------------------------------
# Qwen LLM Classification
# ---------------------------------------------------------------------------

def classify_with_llm(artist: str, title: str, tags: list[str]) -> dict:
    """Usa Qwen para clasificar mood, temática y energía."""
    if not QWEN_API_KEY or QWEN_API_KEY == 'your_qwen_api_key_here':
        return _fallback_classify(tags)
    
    mood_list = ', '.join(MOODS.keys())
    theme_list = ', '.join(THEMES.keys())
    energy_list = ', '.join(ENERGIES)
    
    tags_str = ', '.join(tags[:10]) if tags else 'sin tags disponibles'
    
    system_prompt = f"""Eres un experto musicólogo. Tu tarea es clasificar canciones en categorías predefinidas y determinar su año de lanzamiento original.
Responde SOLO con un JSON válido, sin explicaciones adicionales ni markdown.

Categorías de Mood: {mood_list}
Categorías de Temática: {theme_list}  
Categorías de Energía: {energy_list}

Formato de respuesta exacto:
{{"mood": "...", "theme": "...", "energy": "...", "year": AÑO_ENTERO_O_NULL}}"""

    user_prompt = f"""Clasifica esta canción y estima su año de lanzamiento:
Artista: {artist}
Título: {title}
Tags de la comunidad: {tags_str}

Responde solo con el JSON."""

    try:
        import urllib.request
        
        payload = json.dumps({
            "model": QWEN_MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.3,
            "max_tokens": 100
        })
        
        url = f"{QWEN_BASE_URL}/chat/completions"
        req = urllib.request.Request(url, data=payload.encode('utf-8'), headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {QWEN_API_KEY}'
        })
        
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
        
        content = data['choices'][0]['message']['content'].strip()
        # Clean up potential markdown wrapping
        content = re.sub(r'^```(?:json)?\s*', '', content)
        content = re.sub(r'\s*```$', '', content)
        
        result = json.loads(content)
        
        # Validate categories
        if result.get('mood') not in MOODS:
            result['mood'] = _closest_category(result.get('mood', ''), list(MOODS.keys()))
        if result.get('theme') not in THEMES:
            result['theme'] = _closest_category(result.get('theme', ''), list(THEMES.keys()))
        if result.get('energy') not in ENERGIES:
            result['energy'] = 'Media'
            
        # Validate year
        year_val = result.get('year')
        if year_val:
            try:
                result['year'] = int(year_val)
            except (ValueError, TypeError):
                result['year'] = None
        else:
            result['year'] = None
        
        return result
        
    except Exception as e:
        print(f"  ⚠ Qwen error for {artist} - {title}: {e}")
        return _fallback_classify(tags)


def _closest_category(value: str, categories: list[str]) -> str:
    """Encuentra la categoría más cercana por similitud simple."""
    if not value:
        return categories[0]
    value_lower = value.lower()
    for cat in categories:
        if cat.lower() in value_lower or value_lower in cat.lower():
            return cat
    return categories[0]


def _fallback_classify(tags: list[str]) -> dict:
    """Clasificación heurística basada en tags de Last.fm cuando no hay LLM."""
    mood = "Reflexivo"
    theme = "Existencial"
    energy = "Media"
    
    tags_lower = [t.lower() for t in tags]
    tags_str = ' '.join(tags_lower)
    
    # Mood heuristics
    sad_keywords = ['sad', 'melancholy', 'melancholic', 'depressing', 'emotional', 'crying']
    happy_keywords = ['happy', 'upbeat', 'cheerful', 'fun', 'joy']
    energetic_keywords = ['energetic', 'upbeat', 'punk', 'metal', 'hard rock', 'power']
    romantic_keywords = ['romantic', 'love', 'ballad', 'love songs', 'amor']
    epic_keywords = ['epic', 'anthemic', 'stadium', 'powerful', 'progressive']
    nostalgic_keywords = ['nostalgic', 'nostalgia', '80s', '90s', 'classic', 'retro']
    
    if any(k in tags_str for k in sad_keywords):
        mood = "Melancólico"
    elif any(k in tags_str for k in happy_keywords):
        mood = "Alegre"
    elif any(k in tags_str for k in energetic_keywords):
        mood = "Enérgico"
    elif any(k in tags_str for k in romantic_keywords):
        mood = "Romántico"
    elif any(k in tags_str for k in epic_keywords):
        mood = "Épico"
    elif any(k in tags_str for k in nostalgic_keywords):
        mood = "Nostálgico"
    
    # Theme heuristics
    love_keywords = ['love', 'love songs', 'romantic', 'amor']
    heartbreak_keywords = ['heartbreak', 'breakup', 'sad', 'desamor']
    freedom_keywords = ['freedom', 'free', 'libertad', 'travel']
    party_keywords = ['party', 'dance', 'club', 'fiesta']
    protest_keywords = ['protest', 'political', 'social']
    
    if any(k in tags_str for k in heartbreak_keywords):
        theme = "Desamor"
    elif any(k in tags_str for k in love_keywords):
        theme = "Amor"
    elif any(k in tags_str for k in freedom_keywords):
        theme = "Libertad"
    elif any(k in tags_str for k in party_keywords):
        theme = "Fiesta"
    elif any(k in tags_str for k in protest_keywords):
        theme = "Protesta"
    
    # Energy heuristics
    high_energy = ['energetic', 'punk', 'metal', 'hard rock', 'fast', 'power', 'dance']
    low_energy = ['acoustic', 'ballad', 'slow', 'calm', 'ambient', 'chill']
    
    if any(k in tags_str for k in high_energy):
        energy = "Alta"
    elif any(k in tags_str for k in low_energy):
        energy = "Baja"
    
    return {"mood": mood, "theme": theme, "energy": energy}


# ---------------------------------------------------------------------------
# Main Enrichment Pipeline
# ---------------------------------------------------------------------------

def load_songs() -> list[dict]:
    """Carga y aplana songs.json en una lista de canciones."""
    with open(SONGS_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    songs = []
    def _walk(node, folder='Raíz'):
        if node.get('type') == 'url':
            songs.append({
                'name': node['name'],
                'url': node['url'],
                'folder': folder
            })
        elif node.get('children'):
            for child in node['children']:
                _walk(child, node.get('name', folder))
    
    _walk(data)
    return songs


def load_enriched() -> dict:
    """Carga datos enriquecidos existentes."""
    if ENRICHED_FILE.exists():
        with open(ENRICHED_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {"last_enriched": None, "songs": {}}


def save_enriched(data: dict):
    """Guarda datos enriquecidos."""
    data['last_enriched'] = datetime.now().isoformat()
    with open(ENRICHED_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        
    # También guardar en la carpeta pública del cliente si existe la ruta
    client_public_enriched = Path(__file__).parent / 'client' / 'public' / 'enriched_songs.json'
    try:
        client_public_enriched.parent.mkdir(parents=True, exist_ok=True)
        with open(client_public_enriched, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"  ⚠ Error guardando enriched_songs.json en la carpeta del cliente: {e}")


def detect_source(url: str) -> str:
    if 'cifraclub.com' in url: return 'Cifra Club'
    if 'lacuerda.net' in url: return 'LaCuerda'
    if 'ukulele-tabs.com' in url: return 'Uku-Tabs'
    if 'ultimate-guitar.com' in url: return 'Ultimate Guitar'
    if 'chordify.net' in url: return 'Chordify'
    return 'Web'


def enrich_song(song: dict) -> dict:
    """Enriquece una sola canción con todas las fuentes."""
    artist, title = parse_song_name(song['name'])
    source = detect_source(song['url'])
    
    print(f"  🎵 {artist} — {title}")
    
    # 1. Last.fm tags
    tags = fetch_lastfm_tags(artist, title)
    time.sleep(0.2)
    
    # 2. Last.fm info
    info = fetch_lastfm_info(artist, title)
    if info.get('tags'):
        # Merge tags
        tags = list(dict.fromkeys(tags + info['tags']))  # deduplicate preserving order
    time.sleep(0.2)
    
    # 3. MusicBrainz metadata
    mb_data = fetch_musicbrainz_metadata(artist, title)
    if mb_data:
        time.sleep(1.1)  # MusicBrainz rate limit: 1 req/sec
    
    # 4. LLM classification (or fallback)
    classification = classify_with_llm(artist, title, tags)
    if QWEN_API_KEY and QWEN_API_KEY != 'your_qwen_api_key_here':
        time.sleep(0.5)  # Slight delay for API courtesy
    
    # Determine genre from tags + MusicBrainz
    genre = 'Unknown'
    genre_tags = mb_data.get('genres', [])
    if genre_tags:
        genre = genre_tags[0]
    elif tags:
        # Use most common "genre-like" tags
        genre_candidates = [t for t in tags if t in [
            'rock', 'pop', 'alternative', 'indie', 'folk', 'acoustic', 
            'electronic', 'metal', 'punk', 'blues', 'jazz', 'reggae',
            'latin', 'ska', 'grunge', 'post-punk', 'new wave',
            'alternative rock', 'indie rock', 'indie pop', 'britpop',
            'classic rock', 'soft rock', 'hard rock', 'post-rock'
        ]]
        if genre_candidates:
            genre = genre_candidates[0]
    
    # Merge year from MusicBrainz and Qwen LLM
    year = mb_data.get('year') or classification.get('year')
    
    return {
        "artist": artist,
        "title": title,
        "folder": song['folder'],
        "source": source,
        "mood": classification.get('mood', 'Reflexivo'),
        "mood_emoji": MOODS.get(classification.get('mood', 'Reflexivo'), '🔮'),
        "theme": classification.get('theme', 'Existencial'),
        "theme_emoji": THEMES.get(classification.get('theme', 'Existencial'), '🌀'),
        "energy": classification.get('energy', 'Media'),
        "genre": genre,
        "year": year,
        "country": mb_data.get('country'),
        "lastfm_tags": tags[:10],
        "listeners": info.get('listeners'),
        "playcount": info.get('playcount'),
        "enriched_at": datetime.now().isoformat()
    }


def enrich_all(force: bool = False, test_limit: int = 0):
    """
    Pipeline principal de enriquecimiento.
    - force=True: re-enriquecer todas
    - test_limit>0: solo enriquecer N canciones (para pruebas)
    """
    print("=" * 60)
    print("🎸 Acordes — Enriquecimiento Musical")
    print("=" * 60)
    
    # Check API status
    has_lastfm = LASTFM_API_KEY and LASTFM_API_KEY != 'your_lastfm_api_key_here'
    has_qwen = QWEN_API_KEY and QWEN_API_KEY != 'your_qwen_api_key_here'
    
    print(f"\n📡 APIs configuradas:")
    print(f"   Last.fm:     {'✅ Activa' if has_lastfm else '❌ No configurada (fallback heurístico)'}")
    print(f"   MusicBrainz: ✅ Activa (sin API key requerida)")
    print(f"   Qwen LLM:    {'✅ ' + QWEN_MODEL if has_qwen else '❌ No configurada (fallback heurístico)'}")
    
    # Load data
    songs = load_songs()
    enriched = load_enriched()
    
    # Filter non-music URLs
    music_domains = ['cifraclub.com', 'lacuerda.net', 'ultimate-guitar.com', 
                     'chordify.net', 'ukulele-tabs.com']
    songs = [s for s in songs if any(d in s['url'] for d in music_domains)]
    
    print(f"\n📊 Canciones de sitios musicales: {len(songs)}")
    print(f"   Ya enriquecidas: {len(enriched['songs'])}")
    
    # Determine which songs to process
    if force:
        to_process = songs
        print(f"   🔄 Modo forzado: re-enriqueciendo TODAS")
    else:
        to_process = [s for s in songs if s['url'] not in enriched['songs']]
        print(f"   🆕 Nuevas por enriquecer: {len(to_process)}")
    
    if test_limit > 0:
        to_process = to_process[:test_limit]
        print(f"   🧪 Modo test: limitado a {test_limit} canciones")
    
    if not to_process:
        print("\n✅ No hay canciones nuevas por enriquecer!")
        return enriched
    
    # Process
    print(f"\n{'='*60}")
    print(f"🚀 Procesando {len(to_process)} canciones...")
    print(f"{'='*60}\n")
    
    errors = 0
    for i, song in enumerate(to_process):
        print(f"[{i+1}/{len(to_process)}] Procesando: {song['name'][:60]}...")
        try:
            enriched_song = enrich_song(song)
            enriched['songs'][song['url']] = enriched_song
            print(f"  ✅ {enriched_song['mood_emoji']} {enriched_song['mood']} | "
                  f"{enriched_song['theme_emoji']} {enriched_song['theme']} | "
                  f"⚡ {enriched_song['energy']} | 🎸 {enriched_song['genre']}")
        except Exception as e:
            errors += 1
            print(f"  ❌ Error: {e}")
        
        # Save progress every 10 songs
        if (i + 1) % 10 == 0:
            save_enriched(enriched)
            print(f"\n  💾 Progreso guardado ({i+1}/{len(to_process)})\n")
    
    # Final save
    save_enriched(enriched)
    
    print(f"\n{'='*60}")
    print(f"✅ Enriquecimiento completado!")
    print(f"   Procesadas: {len(to_process) - errors}")
    print(f"   Errores: {errors}")
    print(f"   Total enriquecidas: {len(enriched['songs'])}")
    print(f"   Guardado en: {ENRICHED_FILE}")
    print(f"{'='*60}")
    
    return enriched


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description='Enriquecimiento musical para Acordes')
    parser.add_argument('--all', action='store_true', help='Re-enriquecer todas las canciones')
    parser.add_argument('--test', action='store_true', help='Probar con 3 canciones')
    parser.add_argument('--test-parser', action='store_true', help='Solo probar el parser de nombres')
    args = parser.parse_args()
    
    if args.test_parser:
        test_names = [
            "Fix You - Coldplay - Cifra Club",
            "GEHENA, Ases Falsos: Acordes",
            "A PERDERSE: Acordes y Letra para Guitarra, Ukulele, Bajo y Piano (Lucybell)",
            "OIL AND WATER CHORDS (ver 2) by Incubus for guitar, ukulele, piano at Ultimate-Guitar",
            "I Won't Give Up Uke tab by Jason Mraz - Ukulele Tabs",
            "Wonderwall - Oasis - Cifra Club",
            "BAJO LLAVE, Tronic: Acordes",
            "AZUL, Little Jesus: Acordes",
            "Times of Grace - Willing (Acoustic version) Acordes - Chordify",
            "As It Was - Harry Styles - Cifra Club",
        ]
        print("🧪 Test del parser de nombres:\n")
        for name in test_names:
            artist, title = parse_song_name(name)
            print(f"  📝 \"{name}\"")
            print(f"     → Artist: {artist}, Title: {title}\n")
        return
    
    if args.test:
        enrich_all(test_limit=3)
    elif args.all:
        enrich_all(force=True)
    else:
        enrich_all()


if __name__ == '__main__':
    main()
