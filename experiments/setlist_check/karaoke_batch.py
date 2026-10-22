"""Corre el flujo de Karaokes (main.main_process, el mismo de la GUI) para una lista de canciones, sin Qwen
(alineación local + la forzada de config.USE_FORCED_ALIGNMENT, sin abrir Chrome). Cada canción ocupa ~550 MB en el
Drive: se detiene si G: o C: (la caché de Google Drive) bajan de 8 GB libres, o si aparece el archivo DETENER junto
a este script (para cortar entre una canción y otra, nunca a mitad de un render).

Uso:
    python karaoke_batch.py --lista hacer.json [--rehacer rehacer.json]
    --rehacer: canciones ya procesadas cuya sincronía salió mal: borra sus 3 videos y su transcripción y las vuelve a correr; main_process
               se salta la descarga, la letra y Demucs (ya están) y solo re-alinea y renderiza.
Los nombres son los de karaoke_sources.json ("Artista - Título")."""
import csv, json, os, shutil, sys, time
from pathlib import Path

KAR = r'C:\Users\usuario\Desktop\Software development\_WORK_\Karaokes'
HERE = Path(__file__).parent
rows = {f"{r['artista']} - {r['titulo']}": r for r in json.load(open(HERE / 'karaoke_sources.json', encoding='utf-8'))}
args = dict(zip(sys.argv[1::2], sys.argv[2::2]))
todo = json.load(open(args['--lista'], encoding='utf-8')) if '--lista' in args else []
redo = json.load(open(args['--rehacer'], encoding='utf-8')) if '--rehacer' in args else []
STOP = HERE / 'DETENER'
MIN_FREE_GB = 8

os.chdir(KAR)
sys.path.insert(0, KAR)
import config
config.USE_QWEN_ALIGNMENT = False
import main


def folder_of(url):
    """La carpeta de la última corrida exitosa de ese video, según el log de Karaokes."""
    with open(os.path.join(KAR, 'data', 'karaoke_log.csv'), encoding='utf-8', errors='replace') as f:
        done = [r for r in csv.DictReader(f) if r['url'] == url and 'SUCCESS' in r['status']]
    return done[-1]['project_folder'] if done else None


for name in redo + todo:
    free = {d: shutil.disk_usage(d).free / 1e9 for d in ('G:/', 'C:/')}
    if min(free.values()) < MIN_FREE_GB:
        print(f"######## ALTO: poco espacio libre ({', '.join(f'{d} {v:.1f} GB' for d, v in free.items())})", flush=True)
        break
    if STOP.exists():
        print("######## ALTO: apareció el archivo DETENER", flush=True)
        break
    r = rows[name]
    if name in redo:
        folder = folder_of(r['youtube'])
        if not folder:
            print(f"######## ERROR {name}: no encontré su carpeta en el log para rehacerla", flush=True)
            continue
        # Los videos y la transcripción: si la letra estaba equivocada (Genius trajo otra canción), Whisper
        # transcribió en el idioma de esa letra y hay que volver a oír la voz con el de la correcta
        for v in ('video_karaoke.mp4', 'video_instrumental.mp4', 'video_backtrack.mp4', 'whisper_raw.json'):
            p = os.path.join(folder, v)
            if os.path.exists(p):
                os.remove(p)
        print(f"\n######## REHACER {name} ({folder})", flush=True)
    t = time.time()
    print(f"\n######## {name} <- {r['youtube']} ({r['video']})", flush=True)
    try:
        main.main_process(r['youtube'])
    except Exception as e:
        print(f"######## ERROR {name}: {e}", flush=True)
    print(f"######## FIN {name}: {time.time() - t:.0f} s", flush=True)
