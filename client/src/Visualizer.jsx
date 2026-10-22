import { useEffect, useRef } from 'react';

// The background that moves with the music, like the old Windows Media Player visualizations. The browser
// can't listen to the YouTube video (it's another site), so audio_visuals.py analyzed each song beforehand
// from its separated tracks (drums, bass, voice, the rest) and here that analysis plays along with the
// video's time. Without that data, or with the video paused, it stays as a calm background in the song's
// mood color.

export const VISUAL_STYLES = [
  { id: 'barras', name: 'Barras' },
  { id: 'ondas', name: 'Ondas' },
  { id: 'ambiente', name: 'Ambiente' },
];

const decode = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

// How each theme moves the particles: where they drift and how hard a drum hit pushes them
const THEME_MOTION = {
  Desamor: { dx: 0, dy: 0.35, burst: 0.6 },     // falling slowly, like tears or rain
  Amor: { dx: 0, dy: -0.2, burst: 0.8 },        // rising
  Fiesta: { dx: 0, dy: -0.1, burst: 1.8 },      // bursting on every hit
  Protesta: { dx: 0.45, dy: 0, burst: 1.4 },    // marching sideways
  Naturaleza: { dx: 0.1, dy: -0.25, burst: 0.6 },
  Libertad: { dx: 0.3, dy: -0.3, burst: 1 },
  Existencial: { dx: 0, dy: 0, burst: 0.9 },    // floating in place
  Cotidiano: { dx: 0.15, dy: 0, burst: 0.8 },
};
const ENERGY = { Baja: 0.75, Media: 1, Alta: 1.3 };

export default function Visualizer({ style, videoId, getTime, rgb, theme, energy }) {
  const canvasRef = useRef(null);
  const dataRef = useRef(null);

  // This song's analysis, if it has one
  useEffect(() => {
    dataRef.current = null;
    if (!videoId) return;
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}visuals/${videoId}.json`)
      .then(res => (res.ok ? res.json() : null))
      .then(d => {
        if (cancelled || !d) return;
        dataRef.current = {
          ...d,
          stems: Object.fromEntries(Object.entries(d.stems).map(([k, v]) => [k, decode(v)])),
          spectrum: decode(d.spectrum),
        };
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [videoId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !style) return;
    const ctx = canvas.getContext('2d');
    const motion = THEME_MOTION[theme] || THEME_MOTION.Existencial;
    const strength = ENERGY[energy] || 1;
    const color = a => `rgba(${rgb}, ${a})`;

    const bands = 12;
    const level = { drums: 0, bass: 0, vocals: 0, other: 0 };
    const spec = new Float32Array(bands);
    const peaks = new Float32Array(bands);
    let particles = [];
    let lastDraw = 0;
    let lastDrums = 0;
    let frame;

    const draw = (now) => {
      frame = requestAnimationFrame(draw);
      if (now - lastDraw < 33) return; // ~30 fps is plenty for a background
      lastDraw = now;

      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        particles = [];
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // Where the music is: the analysis at the video's second, or a slow idle breathing
      const data = dataRef.current;
      const t = getTime();
      const i = data && t != null ? Math.min(data.frames - 1, Math.max(0, Math.floor(t * data.fps))) : -1;
      const idle = 0.12 + 0.06 * Math.sin(now / 1400);
      for (const k of Object.keys(level)) {
        const target = i >= 0 ? data.stems[k][i] / 255 : idle;
        level[k] = target > level[k] ? target : level[k] * 0.86 + target * 0.14; // hits fast, fades slow
      }
      for (let b = 0; b < bands; b++) {
        const target = i >= 0 ? data.spectrum[i * bands + b] / 255 : idle * (0.6 + 0.4 * Math.sin(now / 900 + b));
        spec[b] = target > spec[b] ? target : spec[b] * 0.8 + target * 0.2;
      }
      const hit = Math.max(0, level.drums - lastDrums); // a drum hit: how much louder than a moment ago
      lastDrums = level.drums;

      // The whole background breathes with the drums
      const glow = ctx.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, Math.max(W, H) * 0.7);
      glow.addColorStop(0, color(0.05 + 0.13 * level.drums * strength));
      glow.addColorStop(1, color(0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      if (style === 'barras') {
        // Classic bars from bass (left) to treble (right), with the caps that fall slowly
        const gap = W * 0.012;
        const barW = (W - gap * (bands + 1)) / bands;
        for (let b = 0; b < bands; b++) {
          const h = spec[b] * H * 0.42 * strength;
          peaks[b] = Math.max(peaks[b] - H * 0.006, h);
          const x = gap + b * (barW + gap);
          ctx.fillStyle = color(0.1 + 0.22 * spec[b]);
          ctx.fillRect(x, H - h, barW, h);
          ctx.fillStyle = color(0.45);
          ctx.fillRect(x, H - peaks[b] - 4, barW, 3);
        }
      } else if (style === 'ondas') {
        // Three waves: bass below, the rest in the middle, the voice above; a drum hit thickens them
        const waves = [[level.bass, 0.78, 1.2, 0.0016], [level.other, 0.62, 2.1, 0.0023], [level.vocals, 0.46, 3.3, 0.0031]];
        for (const [amp, yRatio, cycles, speed] of waves) {
          ctx.beginPath();
          for (let x = 0; x <= W; x += 6) {
            const phase = (x / W) * Math.PI * 2 * cycles + now * speed;
            const y = H * yRatio + Math.sin(phase) * H * 0.09 * amp * strength + Math.sin(phase * 2.7) * H * 0.02 * amp;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = color(0.14 + 0.32 * amp);
          ctx.lineWidth = 1.5 + 5 * hit * strength + 1.5 * amp;
          ctx.stroke();
        }
      } else {
        // Ambiente: particles that drift as the theme says and get pushed out from the middle on each hit
        if (!particles.length) {
          particles = Array.from({ length: 70 }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: 0, vy: 0, r: 1 + Math.random() * 2.5 }));
        }
        const push = hit * 14 * motion.burst * strength;
        for (const p of particles) {
          if (push > 0.4) {
            const ax = p.x - W / 2;
            const ay = p.y - H / 2;
            const d = Math.hypot(ax, ay) || 1;
            p.vx += (ax / d) * push;
            p.vy += (ay / d) * push;
          }
          p.vx *= 0.92;
          p.vy *= 0.92;
          const drift = 0.6 + 1.8 * level.other;
          p.x = (p.x + p.vx + motion.dx * drift + W) % W;
          p.y = (p.y + p.vy + motion.dy * drift + H) % H;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * (1 + 1.6 * level.vocals), 0, Math.PI * 2);
          ctx.fillStyle = color(0.18 + 0.45 * level.bass);
          ctx.fill();
        }
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [style, rgb, theme, energy, getTime]);

  if (!style) return null;
  return <canvas ref={canvasRef} className="music-visualizer" aria-hidden="true" />;
}
