import requests
from bs4 import BeautifulSoup
import re

def scrape_cifraclub(url: str):
    r = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'})
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

print(scrape_cifraclub("https://www.cifraclub.com/milo-j/tu-manta/")['content'][:500])
