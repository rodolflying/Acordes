import { useEffect, useRef, useState } from 'react';

// The background that moves with the music, like the old Windows Media Player / Winamp visualizations.
// The browser can't listen to the YouTube video (it's another site), so audio_visuals.py analyzed each
// song beforehand (how loud each frequency band is, 30 times a second) and here that analysis plays along
// with the video's time. Without it, or with the video paused, the background stays calm.
//
// - Clásico: MilkDrop presets (Butterchurn, WebGL). MilkDrop wants to hear the sound, so each frame it gets
//   a wave rebuilt from the analysis. Loaded only when chosen; drawn at half resolution and 30 fps.
// - Ondas and Ambiente: light 2D drawings, the fallback when a device can't keep up with MilkDrop.

export const VISUAL_STYLES = [
  { id: 'clasico', name: 'Clásico' },
  { id: 'ondas', name: 'Ondas' },
  { id: 'ambiente', name: 'Ambiente' },
];

const BASE = import.meta.env.BASE_URL;
const decode = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

// How each theme moves the particles of Ambiente: where they drift and how hard a hit pushes them
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

// Bands of the analysis (12, from 38 Hz to 8.6 kHz) grouped as the drawings use them
const GROUPS = { low: [0, 1, 2], bass: [2, 3, 4], mid: [5, 6, 7], high: [8, 9, 10, 11] };

// The analysis of a song, decoded: { fps, frames, bands, freqs, spectrum }
const useSongAnalysis = (videoId) => {
  const ref = useRef(null);
  useEffect(() => {
    ref.current = null;
    if (!videoId) return;
    let cancelled = false;
    fetch(`${BASE}visuals/${videoId}.json`)
      .then(res => (res.ok ? res.json() : null))
      .then(d => { if (!cancelled && d?.v === 2) ref.current = { ...d, spectrum: decode(d.spectrum) }; })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [videoId]);
  return ref;
};

// The frame of the analysis at the video's second, or null (no analysis, or the video isn't playing)
const frameAt = (data, t) => (data && t != null ? Math.min(data.frames - 1, Math.max(0, Math.floor(t * data.fps))) : -1);

// `reel`: the vertical view a video is recorded from (SongViewer's ?reel). Frames come slower than real time,
// so MilkDrop draws once per new second of the song and counts that as its elapsed time, at full resolution
export default function Visualizer({ style, videoId, getTime, rgb, theme, energy, presetStep = 0, onFallback, reel = false }) {
  const data = useSongAnalysis(videoId);
  if (!style) return null;
  return style === 'clasico'
    ? <MilkDrop data={data} getTime={getTime} rgb={rgb} theme={theme} step={presetStep} onFallback={onFallback} reel={reel} />
    : <Canvas2D style={style} data={data} getTime={getTime} rgb={rgb} theme={theme} energy={energy} />;
}

// ====== Clásico: MilkDrop ======
function MilkDrop({ data, getTime, rgb, theme, step, onFallback, reel }) {
  const canvasRef = useRef(null);
  const vizRef = useRef(null);
  const presetsRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [presetName, setPresetName] = useState('');

  // The engine and the presets, only now that this style is on
  useEffect(() => {
    let cancelled = false;
    let audio;
    (async () => {
      try {
        const [{ default: butterchurn }, { default: isSupported }, presets] = await Promise.all([
          import('butterchurn'),
          import('butterchurn/lib/isSupported.min'),
          fetch(`${BASE}visuals/presets.json`).then(res => res.json()),
        ]);
        if (cancelled) return;
        if (!isSupported()) { onFallback?.(); return; }
        audio = new AudioContext(); // never plays anything: MilkDrop only needs it to exist
        const canvas = canvasRef.current;
        vizRef.current = butterchurn.createVisualizer(audio, canvas, { width: canvas.width, height: canvas.height, pixelRatio: 1, textureRatio: 1 });
        presetsRef.current = presets;
        setReady(true);
      } catch (e) {
        onFallback?.();
      }
    })();
    return () => { cancelled = true; vizRef.current = null; audio?.close(); };
  }, []);

  // A preset that fits the song's theme; the "next" button walks through the rest
  useEffect(() => {
    const presets = presetsRef.current;
    if (!ready || !presets) return;
    const first = Math.max(0, presets.findIndex(p => p.themes.includes(theme)));
    const chosen = presets[(first + step) % presets.length];
    vizRef.current.loadPreset(chosen.preset, step ? 2.5 : 0);
    setPresetName(chosen.name);
  }, [ready, theme, step]);

  useEffect(() => {
    if (!ready) return;
    const viz = vizRef.current;
    const canvas = canvasRef.current;
    const N = 1024; // samples MilkDrop reads per frame
    const sampleRate = 44100;
    const wave = new Uint8Array(N);
    const sum = new Float32Array(N);
    const phases = new Float32Array(12).map(() => Math.random() * Math.PI * 2);
    let frame;
    let last = 0;
    let lastT = null;
    let slowFrames = 0;
    let measured = 0;

    const draw = (now) => {
      frame = requestAnimationFrame(draw);
      const t = getTime();
      const playing = t != null;
      if (reel ? t === lastT : now - last < (playing ? 33 : 66)) return; // 30 fps with music, 15 when calm
      const elapsed = reel ? Math.min(Math.max(t - (lastT ?? t - 1 / 30), 0.001), 1) : undefined;
      last = now;
      lastT = t;

      // Half resolution, stretched by CSS: MilkDrop's soft plasma looks the same and costs a quarter
      const scale = reel ? 1 : 0.5;
      const w = Math.max(160, Math.round(canvas.clientWidth * scale));
      const h = Math.max(90, Math.round(canvas.clientHeight * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        viz.setRendererSize(w, h);
      }

      // Rebuild the sound from the analysis: one tone per band, as loud as that band at this second.
      // MilkDrop takes its bass, mids and treble from it, which is what moves the presets
      const d = data.current;
      const i = frameAt(d, t);
      sum.fill(0);
      if (i >= 0) {
        for (let b = 0; b < d.bands; b++) {
          const a = d.spectrum[i * d.bands + b] / 255;
          if (a < 0.02) continue;
          const inc = 2 * Math.PI * d.freqs[b] / sampleRate;
          for (let n = 0; n < N; n++) sum[n] += a * a * Math.sin(phases[b] + inc * n);
          phases[b] = (phases[b] + inc * N) % (2 * Math.PI);
        }
      } else {
        for (let n = 0; n < N; n++) sum[n] = 0.08 * Math.sin(now / 900 + n / 60); // a calm hum
      }
      for (let n = 0; n < N; n++) wave[n] = 128 + Math.max(-127, Math.min(127, Math.round(sum[n] * 40)));

      const start = performance.now();
      viz.render({ audioLevels: { timeByteArray: wave, timeByteArrayL: wave, timeByteArrayR: wave }, elapsedTime: elapsed });
      // A device that can't keep up gets the light background instead (after a few seconds of trying);
      // a recording waits for every frame, so there it doesn't matter
      if (performance.now() - start > 28) slowFrames++;
      if (++measured === 90 && slowFrames > 45 && !reel) onFallback?.();
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [ready, getTime, reel]);

  return (
    <div className="music-visualizer milkdrop" data-preset={presetName}>
      <canvas ref={canvasRef} width="480" height="270" aria-hidden="true" />
      {/* The song's mood color over MilkDrop's own colors */}
      <div className="visualizer-tint" style={{ background: `rgb(${rgb})` }} />
    </div>
  );
}

// ====== Ondas and Ambiente: light 2D drawings ======
function Canvas2D({ style, data, getTime, rgb, theme, energy }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const motion = THEME_MOTION[theme] || THEME_MOTION.Existencial;
    const strength = ENERGY[energy] || 1;
    const color = a => `rgba(${rgb}, ${a})`;
    const level = { low: 0, bass: 0, mid: 0, high: 0 };
    let particles = [];
    let lastDraw = 0;
    let lastLow = 0;
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
      const d = data.current;
      const i = frameAt(d, getTime());
      const idle = 0.12 + 0.06 * Math.sin(now / 1400);
      for (const [k, bands] of Object.entries(GROUPS)) {
        const target = i >= 0 ? bands.reduce((s, b) => s + d.spectrum[i * d.bands + b], 0) / bands.length / 255 : idle;
        level[k] = target > level[k] ? target : level[k] * 0.75 + target * 0.25; // hits fast, fades quickly
      }
      const hit = Math.max(0, level.low - lastLow); // a kick: how much louder the lows got since a moment ago
      lastLow = level.low;

      // The whole background breathes with the lows
      const glow = ctx.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, Math.max(W, H) * 0.7);
      glow.addColorStop(0, color(0.05 + 0.13 * level.low * strength));
      glow.addColorStop(1, color(0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      if (style === 'ondas') {
        // Three waves: the bass below, the mids in the middle, the highs above; a kick thickens them
        const waves = [[level.bass, 0.78, 1.2, 0.0016], [level.mid, 0.62, 2.1, 0.0023], [level.high, 0.46, 3.3, 0.0031]];
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
        // Ambiente: particles that drift as the theme says and get pushed out from the middle on each kick
        if (!particles.length) {
          particles = Array.from({ length: 70 }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: 0, vy: 0, r: 1 + Math.random() * 2.5 }));
        }
        const push = hit * 14 * motion.burst * strength;
        for (const p of particles) {
          if (push > 0.4) {
            const ax = p.x - W / 2;
            const ay = p.y - H / 2;
            const dist = Math.hypot(ax, ay) || 1;
            p.vx += (ax / dist) * push;
            p.vy += (ay / dist) * push;
          }
          p.vx *= 0.92;
          p.vy *= 0.92;
          const drift = 0.6 + 1.8 * level.mid;
          p.x = (p.x + p.vx + motion.dx * drift + W) % W;
          p.y = (p.y + p.vy + motion.dy * drift + H) % H;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * (1 + 1.6 * level.high), 0, Math.PI * 2);
          ctx.fillStyle = color(0.18 + 0.45 * level.bass);
          ctx.fill();
        }
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [style, rgb, theme, energy, getTime]);

  return <canvas ref={canvasRef} className="music-visualizer" aria-hidden="true" />;
}
