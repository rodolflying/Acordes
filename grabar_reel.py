"""Graba el video vertical de una canción (1080×1920: TikTok, Reels, Shorts) desde la vista ?reel de Acordate.

Cuadro a cuadro: Chromium abre la canción con ?reel, pone la canción en el segundo de cada cuadro
(window.__reel.frame) y le saca una foto; ffmpeg arma el video con el audio original de la canción, el del
Drive de Karaokes. Como cada cuadro espera a estar dibujado, el video sale fluido aunque el computador tarde
más que el tiempo real en dibujarlo.

    python grabar_reel.py --cancion el-mato-a-un-policia-motorizado/el-tesoro --desde 18 --hasta 84
    python grabar_reel.py --cancion ... --foto 60      # solo el cuadro del segundo 60, para revisar el diseño

Necesita el sitio corriendo (npm --prefix client run dev) en --sitio, y Google Drive abierto.
"""
import argparse
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

from audio_visuals import songs_with_audio
from karaoke_timings import outputs_dir

ROOT = Path(__file__).parent
OUT_DIR = ROOT / 'reels'
# 540×960 de pantalla a 2x: el diseño de un celular, grabado en 1080×1920
VIEWPORT = {'width': 540, 'height': 960}
SCALE = 2


def open_reel(browser, site, song):
    page = browser.new_page(viewport=VIEWPORT, device_scale_factor=SCALE)
    page.goto(f"{site.rstrip('/')}/cancion/{song.strip('/')}/?reel")
    # Lista cuando están la hoja, el fondo de MilkDrop con su preset y el reloj de ?reel
    page.wait_for_function("""() => window.__reel?.video
        && document.querySelector('.chord-sheet')?.textContent.length > 0
        && document.querySelector('.music-visualizer[data-preset]:not([data-preset=""])')""", timeout=60000)
    page.wait_for_timeout(1500)  # la traducción y las fuentes
    return page


def song_audio(video):
    folder = dict(songs_with_audio()).get(video)
    audio = folder and outputs_dir() / folder / 'original.mp3'
    if not audio or not audio.exists():
        sys.exit(f'No encontré el audio original del video {video} en el Drive de Karaokes (¿Drive abierto?)')
    return audio


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cancion', required=True, help='artista/titulo, como en /cancion/artista/titulo/')
    parser.add_argument('--desde', type=float, default=0)
    parser.add_argument('--hasta', type=float, default=60)
    parser.add_argument('--fps', type=int, default=30)
    parser.add_argument('--sitio', default='http://localhost:5174')
    parser.add_argument('--foto', type=float, help='solo la foto de ese segundo (reels/<canción>_<s>.png)')
    args = parser.parse_args()

    OUT_DIR.mkdir(exist_ok=True)
    name = args.cancion.strip('/').replace('/', '_')
    with sync_playwright() as p:
        # La GPU dibuja MilkDrop; sin ella Chromium usa WebGL por software, que también sirve pero más lento
        browser = p.chromium.launch(args=['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'])
        page = open_reel(browser, args.sitio, args.cancion)

        if args.foto is not None:
            # Unos segundos antes, para que la hoja y el fondo lleguen como en el video
            for i in range(int(args.fps * 2), -1, -1):
                page.evaluate('t => window.__reel.frame(t)', max(0, args.foto - i / args.fps))
            out = OUT_DIR / f'{name}_{args.foto:g}.png'
            page.screenshot(path=str(out))
            print(out)
            return

        audio = song_audio(page.evaluate('window.__reel.video'))
        length = args.hasta - args.desde
        frames = round(length * args.fps)
        out = OUT_DIR / f'{name}.mp4'
        fade = min(0.8, length / 4)
        ffmpeg = subprocess.Popen([
            'ffmpeg', '-y', '-loglevel', 'error',
            '-f', 'image2pipe', '-framerate', str(args.fps), '-c:v', 'mjpeg', '-i', '-',
            '-ss', f'{args.desde:.3f}', '-t', f'{length:.3f}', '-i', str(audio),
            '-map', '0:v', '-map', '1:a',
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
            '-af', f'afade=t=in:d=0.3,afade=t=out:st={length - fade:.3f}:d={fade:.3f}',
            '-c:a', 'aac', '-b:a', '192k', '-shortest', str(out),
        ], stdin=subprocess.PIPE)

        start = time.time()
        for i in range(frames):
            page.evaluate('t => window.__reel.frame(t)', args.desde + i / args.fps)
            ffmpeg.stdin.write(page.screenshot(type='jpeg', quality=92))
            if i % (args.fps * 10) == 0:
                print(f'  {i + 1}/{frames} cuadros, {time.time() - start:.0f} s', flush=True)
        ffmpeg.stdin.close()
        ffmpeg.wait()
        browser.close()
    print(f'{out} ({length:.0f} s, {frames} cuadros en {time.time() - start:.0f} s)')


if __name__ == '__main__':
    main()
