import React, { useState, useEffect, useRef, useCallback } from 'react';
import { findChordShape, renderSVGChord, sharpChord, transposeChord } from './ChordUtils';
import { SaveStar } from './Listas';
import Visualizer, { VISUAL_STYLES } from './Visualizer';

const MOODS_CONFIG = {
  "Romántico": { color: "#ff007a", rgb: "255, 0, 122" },
  "Melancólico": { color: "#5e60ce", rgb: "94, 96, 206" },
  "Reflexivo": { color: "#38bdf8", rgb: "56, 189, 248" },
  "Enérgico": { color: "#ffb703", rgb: "255, 183, 3" },
  "Alegre": { color: "#ff7096", rgb: "255, 112, 150" },
  "Épico": { color: "#ff003c", rgb: "255, 0, 60" },
  "Nostálgico": { color: "#f26419", rgb: "242, 100, 25" }
};

// Only defined in dev (client/.env.development); undefined in the GitHub Pages build
const API_URL = import.meta.env.VITE_API_URL;

// Where the current line sits while the sheet follows the video, as a share of the visible
// area below the sticky header
const READING_LINE = 0.3;
const freshPlayer = () => ({ time: 0, stamp: 0, duration: 0, rate: 1, state: -1, ready: false });
// Speeds the slider offers for the video: slower to practice a part, a bit faster once it's learned
const VIDEO_RATES = [0.5, 0.75, 1, 1.25, 1.5];
// ?reel: the vertical 9:16 view the TikTok / Reels videos are recorded from (grabar_reel.py). No buttons and no
// YouTube player: the song's second comes from window.__reel, frame by frame, the background takes the video's
// place at the bottom and the line being sung shows its translation (traducir_letras.py)
const REEL_PARAMS = new URLSearchParams(window.location.search);
const REEL = REEL_PARAMS.has('reel');
// ?v=<video id>: the link in a video's comment on YouTube opens that same version (instrumental, backtrack…)
const LINKED_VIDEO = REEL_PARAMS.get('v');

// Top (px from `origin`) of each source line of the chord sheet. Measured in the DOM because on
// phones long lines wrap, so a line's position isn't its index × line height
const measureLineTops = (pre, origin, lineHeight) => {
  const tops = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
  let lineStart = true;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (let i = 0; i < node.data.length; i++) {
      if (lineStart) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getClientRects()[0];
        tops.push(rect ? rect.top - origin : (tops.length ? tops[tops.length - 1] + lineHeight : 0));
        lineStart = false;
      }
      if (node.data[i] === '\n') lineStart = true;
    }
  }
  return tops;
};

// Each source line of the sheet: its length in characters, its chords (element and column) and
// whether it only holds chords (a chord line above the lyrics, an intro or a solo)
const indexSheet = (pre) => {
  const newLine = () => ({ length: 0, chords: [], letters: 0, text: '', parts: [] });
  const lines = [newLine()];
  const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const chord = node.parentElement.closest('.chord');
    let i = 0;
    for (const ch of node.data) {
      const line = lines[lines.length - 1];
      if (ch === '\n') { lines.push(newLine()); i++; continue; }
      // Where each piece of the line's text lives in the DOM, to light up the words being sung
      if (!line.parts.length || line.parts[line.parts.length - 1].node !== node) line.parts.push({ node, offset: i, col: line.length });
      if (chord && line.chords[line.chords.length - 1]?.el !== chord) line.chords.push({ col: line.length, el: chord });
      if (!chord && ch.trim()) line.letters++;
      line.text += ch;
      line.length++;
      i++;
    }
  }
  // A few letters next to the chords are labels ("Intro: RE-SOL (x2)"), not lyrics
  lines.forEach(l => { l.chordsOnly = l.chords.length > 0 && l.letters <= 12; });
  return lines;
};

// When each line sounds and when each chord comes in, from the synced lyrics: a sung line lights up
// together with its chord line above, and each chord comes in at its column's share of the line.
// Between sung lines, the lines that only have chords (intro, solos) share the gap
const buildTimeline = (points, lines) => {
  const segments = [];
  const singing = (t, line) => Math.min(t, 0.15 * Math.max(lines[line]?.length || 0, 1) + 1.5);
  const addChordLines = (from, to, start, end) => {
    const block = [];
    for (let l = from; l < to; l++) if (lines[l]?.chordsOnly) block.push(l);
    const count = block.reduce((n, l) => n + lines[l].chords.length, 0);
    if (!count || end - start < 1) return;
    let k = 0;
    block.forEach(l => {
      const events = lines[l].chords.map(c => ({ t: start + (end - start) * (k++) / count, el: c.el }));
      segments.push({ start: events[0].t, top: l, bottom: l, events });
    });
  };
  // A sheet line can hold two sung phrases ("Y todo es extraño" + "Y el día no empieza"): when the second
  // one's words continue further right on the same line, both are one pass over that line
  const merged = [];
  points.forEach(([t, line, anchors]) => {
    const prev = merged[merged.length - 1];
    const lastCol = prev?.[2]?.[prev[2].length - 1]?.[0];
    if (prev && prev[1] === line && lastCol !== undefined && anchors?.length && anchors[0][0] > lastCol) {
      prev[2] = [...prev[2], ...anchors];
    } else {
      merged.push([t, line, anchors ? [...anchors] : anchors]);
    }
  });
  points = merged;
  points.forEach(([t, line, anchors], j) => {
    const next = points[j + 1]?.[0] ?? t + 6;
    const above = lines[line - 1]?.chordsOnly ? line - 1 : line;
    const length = Math.max(lines[line]?.length || 0, 1);
    // Column -> second while the line is sung: with the time of each word (Whisper on your video)
    // a chord comes in exactly when its syllable is sung; without it, at its share of the line
    const curve = [[0, t]];
    (anchors || []).forEach(([c, s]) => {
      const [pc, ps] = curve[curve.length - 1];
      if (c > pc && s > ps && s < next) curve.push([c, s]);
    });
    const [lastCol, lastTime] = curve[curve.length - 1];
    const end = Math.min(Math.max(t + singing(next - t, line), lastTime + 0.5), next);
    curve.push([Math.max(length, lastCol + 1), Math.max(end, lastTime + 0.01)]);
    const cols = curve.map(p => p[0]);
    const times = curve.map(p => p[1]);
    const events = [...(above < line ? lines[above].chords : []), ...(lines[line]?.chords || [])]
      .map(c => ({ t: interpolate(c.col, cols, times), el: c.el }));
    if (j === 0) addChordLines(0, above, 0, t); // the intro, before the first sung line
    segments.push({ start: t, top: above, bottom: line, sung: end - t, cols, times, length, events });
    // Lines that only have chords (a solo, a bridge) between this sung line and the next one; when the
    // song goes back to a part written above, the ones right after this line
    let nextLine = points[j + 1]?.[1];
    if (nextLine !== undefined && nextLine <= line) {
      nextLine = line + 1;
      while (nextLine < lines.length && (lines[nextLine].chordsOnly || !lines[nextLine].length)) nextLine++;
    }
    if (nextLine > line + 1) addChordLines(line + 1, lines[nextLine - 1]?.chordsOnly ? nextLine - 1 : nextLine, end, next);
  });
  segments.sort((a, b) => a.start - b.start);
  return { segments, events: segments.flatMap(s => s.events).sort((a, b) => a.t - b.t) };
};

// The words of a line already sung (from its first letter to the end of the word at `col`) and the word being
// sung, as DOM ranges, to paint them like the karaoke does. Uses the CSS Custom Highlight API, which colors
// text without touching the sheet, so the chord columns never move
const sungRanges = (line, col) => {
  const { text, parts } = line;
  const first = text.search(/\S/);
  if (first < 0 || col < first) return null;
  let at = Math.min(Math.floor(col), text.length - 1);
  while (at > first && /\s/.test(text[at])) at--; // on a space: the word just sung
  let start = at;
  while (start > first && /\S/.test(text[start - 1])) start--;
  let end = at;
  while (end < text.length && /\S/.test(text[end])) end++;
  const pos = c => {
    const part = parts.filter(p => p.col <= c).pop() || parts[0];
    return [part.node, Math.min(part.offset + (c - part.col), part.node.data.length)];
  };
  const range = (a, b) => { const r = new Range(); r.setStart(...pos(a)); r.setEnd(...pos(b)); return r; };
  return { sung: range(first, end), now: range(start, end), key: `${first}-${end}` };
};
const canHighlight = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
const clearSung = () => { if (canHighlight) { CSS.highlights.delete('sung'); CSS.highlights.delete('sung-now'); } };

// Piecewise-linear map from xs to ys (both increasing), held flat outside the ends
const interpolate = (x, xs, ys) => {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / ((xs[i] - xs[i - 1]) || 1);
  }
  return ys[ys.length - 1];
};

// Last item of a list sorted by `key` whose key is <= t
const lastAt = (list, t, key) => {
  let found = null;
  for (const item of list) { if (key(item) <= t) found = item; else break; }
  return found;
};

const SongViewer = ({ song, onClose, chordDb, backingTracks: propBackingTracks, syncPoints, onVideoLinked, saved, onSave }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [content, setContent] = useState('');
  const [displayContent, setDisplayContent] = useState('');
  // Lines the sheet left without chords that complete_chords.py filled ({bloque, linea, audio})
  const [addedChords, setAddedChords] = useState(null);
  const [transposeDelta, setTransposeDelta] = useState(0);
  const [diagrams, setDiagrams] = useState([]);
  const [selectedChordSvg, setSelectedChordSvg] = useState(null);
  // "Acorde en pantalla": the chord you're at, big, and the one that comes next. Off until you turn it on;
  // then it stays on for every song
  const [chordOnScreen, setChordOnScreen] = useState(() => REEL || localStorage.getItem('chordOnScreen') === 'true');
  const [liveChord, setLiveChord] = useState(null); // { now, next } chord names
  
  const scrollSpeeds = [0.5, 0.65, 0.8, 1.0, 1.15, 1.3, 1.5, 1.65, 1.8, 2.0];
  const [scrollSpeedIndex, setScrollSpeedIndex] = useState(3); // Corresponde a 1.0
  const [isScrolling, setIsScrolling] = useState(false);
  const viewerRef = useRef(null);
  const scrollIntervalRef = useRef(null);
  const contentRef = useRef(null);
  const bandRef = useRef(null); // lights up the line being sung
  const progressRef = useRef(null); // how far into that line the singing is
  const nowChordRef = useRef(null); // the chord sounding now
  const captionRef = useRef(null); // in ?reel, the translation of the line being sung

  // YouTube States
  const [showYoutube, setShowYoutube] = useState(false);
  // The background that moves with the music (Visualizer.jsx): '' (off), 'clasico', 'ondas' or 'ambiente'.
  // On unless the phone asks for less motion or the site is in "Modo rápido"
  const [visualStyle, setVisualStyle] = useState(() => {
    if (REEL) return 'clasico';
    const saved = localStorage.getItem('visualStyle');
    if (saved === 'barras') return 'clasico'; // the bars were retired
    if (saved !== null) return saved;
    const calm = localStorage.getItem('performanceMode') === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    return calm ? '' : VISUAL_STYLES[0].id;
  });
  useEffect(() => { if (!REEL) localStorage.setItem('visualStyle', visualStyle); }, [visualStyle]);
  const nextVisualStyle = () => {
    const ids = ['', ...VISUAL_STYLES.map(v => v.id)];
    setVisualStyle(ids[(ids.indexOf(visualStyle) + 1) % ids.length]);
  };
  // In Clásico, which MilkDrop preset (counting from the one that fits the song's theme), like WMP's arrows
  const [presetStep, setPresetStep] = useState(0);
  useEffect(() => { setPresetStep(0); }, [song.url]);
  const fallBackToLight = useCallback(() => setVisualStyle('ondas'), []);

  // The video panel minimized to a small player in a corner: it keeps playing and the sheet keeps following
  const [videoMini, setVideoMini] = useState(false);
  const [activeVideoId, setActiveVideoId] = useState(null);
  const [backingTracks, setBackingTracks] = useState(null);
  const [loadingTracks, setLoadingTracks] = useState(true);

  // Search & Link States
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchingVideo, setSearchingVideo] = useState(false);
  const [linkingVideo, setLinkingVideo] = useState(false);

  // Video sync: the sheet follows the video's playback position instead of a fixed speed
  const [syncWithVideo, setSyncWithVideo] = useState(() => {
    return localStorage.getItem('syncWithVideo') !== 'false';
  });
  const iframeRef = useRef(null);
  const playerRef = useRef(freshPlayer()); // last time, duration, state and rate reported by YouTube
  const syncOffsetRef = useRef(0); // manual correction (px) made by the user while the video plays
  const hasVideo = showYoutube && !isSearching && Boolean(backingTracks && activeVideoId);
  // The second the video is at while it plays (null when paused or without video), for the background
  const videoTime = useCallback(() => {
    const player = playerRef.current;
    if (!(REEL || iframeRef.current?.isConnected) || player.state !== 1 || !player.duration) return null;
    return player.time + (performance.now() - player.stamp) / 1000 * player.rate;
  }, []);
  // The second the video was at when its player went away (another version picked, the video closed, a
  // search opened), so the next one starts there: the three versions share timing. Only a version change
  // keeps it playing
  const [resumeAt, setResumeAt] = useState(null); // { t, play }
  const keepSpot = (keepPlaying = false) => {
    const player = playerRef.current;
    if (!player.ready) return; // it never loaded (a blocked video): keep the spot it was given
    const ended = player.state === 0;
    setResumeAt({ t: ended ? 0 : Math.floor(videoTime() ?? player.time), play: keepPlaying && player.state === 1 });
  };
  // The song's analysis is saved under its first video (Karaoke, Instrumental, Backtrack): all three share timing
  const visualsId = ['Karaoke', 'Instrumental', 'Backtrack'].map(v => backingTracks?.[v]?.id).find(Boolean) || null;
  const syncing = (hasVideo && syncWithVideo) || (REEL && Boolean(syncPoints?.length));

  // ?reel: the translation of each sung line ({ de, a, lineas: { line: translation } }), saved under the same video
  const [translation, setTranslation] = useState(null);
  useEffect(() => {
    setTranslation(null);
    if (!REEL || !visualsId) return;
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}traducciones/${visualsId}.json`)
      .then(res => (res.ok ? res.json() : null))
      .then(d => { if (!cancelled && d?.lineas) setTranslation(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [visualsId]);

  // ?reel: the recorder sets the song's second for each frame; ?reel&t=18&play plays it in real time from there
  const visualsIdRef = useRef(null);
  visualsIdRef.current = visualsId;
  useEffect(() => {
    if (!REEL) return;
    const at = (time, rate) => Object.assign(playerRef.current, { time, rate, stamp: performance.now(), state: 1, duration: 24 * 3600, ready: true });
    at(Number(REEL_PARAMS.get('t')) || 0, REEL_PARAMS.has('play') ? 1 : 0);
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
    let last = null;
    window.__reel = {
      get video() { return visualsIdRef.current; }, // the recorder finds the song's audio by it
      // Resolves once the frame at second t is drawn: the sheet and the background move on the first
      // animation frame, then the chord on screen catches up and React paints it
      frame: async (t) => {
        const step = last === null ? 0 : Math.max(0, (t - last) * 1000);
        last = t;
        at(t, 0);
        await nextFrame();
        window.dispatchEvent(new Event('reel:frame'));
        await nextFrame();
        // CSS transitions (the band gliding to the next line) run on the wall clock, and a frame takes longer
        // than that to record: hold them and move them by the song's time instead
        for (const anim of document.getAnimations()) {
          anim.pause();
          anim.currentTime = (anim.currentTime || 0) + step;
        }
        await nextFrame();
      },
      play: (t) => at(t, 1),
    };
    return () => { delete window.__reel; };
  }, []);

  useEffect(() => {
    localStorage.setItem('syncWithVideo', syncWithVideo);
  }, [syncWithVideo]);

  // Seconds the video runs ahead of the recording the lyric times come from (e.g. the intro of an
  // official video), per song. Set once with the 🎯 button and a tap on the line being sung
  const [timeOffsets, setTimeOffsets] = useState(() => {
    try { return JSON.parse(localStorage.getItem('syncTimeOffsets')) || {}; } catch { return {}; }
  });
  // A correction belongs to the lyric times it was made with: once those change (the song gets
  // re-aligned with your video), an old correction would push the sheet off, so it no longer applies
  const lyricTimesKey = syncPoints?.length ? `${syncPoints.length}:${syncPoints[0][0]}` : '';
  const savedOffset = timeOffsets[song.url];
  const timeOffset = savedOffset?.times === lyricTimesKey ? savedOffset.s : 0;
  const [calibrating, setCalibrating] = useState(false);
  const [playHint, setPlayHint] = useState(false); // phones only let YouTube start with a tap on the video

  useEffect(() => {
    localStorage.setItem('syncTimeOffsets', JSON.stringify(timeOffsets));
  }, [timeOffsets]);

  // Chord sheet text size, as a multiplier of the base size (bigger text wraps more lines on phones)
  const [fontScale, setFontScale] = useState(() => {
    return REEL ? 1 : Number(localStorage.getItem('sheetFontScale')) || 1;
  });
  const changeFontScale = (step) => {
    setFontScale(s => Math.min(1.6, Math.max(0.7, Math.round((s + step * 0.1) * 10) / 10)));
  };

  useEffect(() => {
    if (!REEL) localStorage.setItem('sheetFontScale', fontScale);
  }, [fontScale]);

  // Fetch Backing Tracks matching this song from local uploader JSON
  useEffect(() => {
    setResumeAt(null); // another song starts from the top
    if (propBackingTracks) {
      setBackingTracks(propBackingTracks);
      
      // Determine default version to play (Karaoke -> Instrumental -> Backtrack)
      const versions = ['Karaoke', 'Instrumental', 'Backtrack'];
      let defaultVer = null;
      for (const v of versions) {
        if (propBackingTracks[v]) {
          defaultVer = v;
          break;
        }
      }
      if (!defaultVer) {
        defaultVer = Object.keys(propBackingTracks)[0];
      }
      const linked = Object.values(propBackingTracks).find(t => t.id === LINKED_VIDEO);

      if (defaultVer) {
        setActiveVideoId(linked ? linked.id : propBackingTracks[defaultVer].id);
        setShowYoutube(true);
      }
      setLoadingTracks(false);
      return;
    }

    // Fallback A: Embedded youtube_video metadata (from enriched_songs.json)
    if (song.youtube_video) {
      const defaultTrack = {
        "Karaoke": {
          "id": song.youtube_video.id,
          "title": song.youtube_video.title,
          "youtube_url": `https://www.youtube.com/watch?v=${song.youtube_video.id}`
        }
      };
      setBackingTracks(defaultTrack);
      setActiveVideoId(song.youtube_video.id);
      setShowYoutube(true);
      setLoadingTracks(false);
      return;
    }

    // Fallback B: local API server (for active local development)
    if (!API_URL) {
      setLoadingTracks(false);
      return;
    }
    const fetchTracks = async () => {
      setLoadingTracks(true);
      try {
        const artist = song.clean_artist || song.folder || '';
        const title = song.clean_title || song.title || '';
        const response = await fetch(`${API_URL}/api/song/backing_tracks?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`);
        
        if (response.ok) {
          const data = await response.json();
          if (data.backing_tracks) {
            setBackingTracks(data.backing_tracks);
            
            // Determine default version to play (Karaoke -> Instrumental -> Backtrack)
            const versions = ['Karaoke', 'Instrumental', 'Backtrack'];
            let defaultVer = null;
            for (const v of versions) {
              if (data.backing_tracks[v]) {
                defaultVer = v;
                break;
              }
            }
            if (!defaultVer) {
              defaultVer = Object.keys(data.backing_tracks)[0];
            }
            
            if (defaultVer) {
              setActiveVideoId(data.backing_tracks[defaultVer].id);
              setShowYoutube(true);
            }
          } else {
            setBackingTracks(null);
            setActiveVideoId(null);
            setShowYoutube(false);
          }
        }
      } catch (err) {
        console.error("Error fetching backing tracks from API:", err);
      } finally {
        setLoadingTracks(false);
      }
    };
    fetchTracks();
  }, [song, propBackingTracks]);

  // Reset scrolling when the video changes or goes away
  useEffect(() => {
    setIsScrolling(false);
    syncOffsetRef.current = 0;
  }, [activeVideoId, hasVideo]);

  const postToPlayer = (func, args = []) => {
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args, id: 1, channel: 'widget' }), 'https://www.youtube.com');
  };

  // YouTube Player synchronization using window messages
  useEffect(() => {
    const handleMessage = (event) => {
      if (event.origin !== 'https://www.youtube.com' && event.origin !== 'https://www.youtube-nocookie.com') {
        return;
      }
      if (event.source !== iframeRef.current?.contentWindow) return;

      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        const player = playerRef.current;
        // Only the player's own widget messages mean it heard us (keep saying 'listening' until then)
        if (['initialDelivery', 'onReady', 'infoDelivery'].includes(data?.event)) player.ready = true;
        // Like YouTube's own API: once the player is ready, subscribe to its state changes, so a play
        // pressed on the video itself starts the sheet just like Reproducir
        if (data?.event === 'onReady' && !player.subscribed) {
          player.subscribed = true;
          ['onStateChange', 'onPlaybackRateChange'].forEach(ev => postToPlayer('addEventListener', [ev]));
        }
        const info = typeof data?.info !== 'number' ? data?.info
          : data.event === 'onStateChange' ? { playerState: data.info }
          : data.event === 'onPlaybackRateChange' ? { playbackRate: data.info } : null;
        if (!info || typeof info !== 'object') return;

        if (info.currentTime !== undefined) {
          player.time = info.currentTime;
          player.stamp = performance.now();
        }
        if (info.duration) player.duration = info.duration;
        if (info.playbackRate) player.rate = info.playbackRate;
        if (info.playerState !== undefined) {
          const state = info.playerState;
          player.state = state;
          player.stamp = performance.now();
          if (state === 1) {
            setIsScrolling(prev => prev !== true ? true : prev);
            setPlayHint(false);
          } else if (state === 2 || state === 0) {
            setIsScrolling(prev => prev !== false ? false : prev);
          }
        }
      } catch (e) {
        // Ignore parsing errors for non-JSON postMessages
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  // YouTube only reports playback events once the page says it's listening;
  // repeat until the player answers, since it may not be ready right at load
  const connectPlayer = (iframe) => {
    playerRef.current = freshPlayer();
    let tries = 0;
    const timer = setInterval(() => {
      if (playerRef.current.ready || !iframe.contentWindow || ++tries > 40) {
        clearInterval(timer);
        return;
      }
      iframe.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), 'https://www.youtube.com');
    }, 250);
  };

  const sendPlayerCommand = (func) => postToPlayer(func);

  useEffect(() => {
    const fetchSong = async () => {
      try {
        let contentData = null;
        try {
            const staticRes = await fetch(`${import.meta.env.BASE_URL}preloaded_songs.json`);
            if (staticRes.ok) {
                const preloaded = await staticRes.json();
                if (preloaded[song.url]) {
                    contentData = preloaded[song.url];
                }
            }
        } catch (e) {
            console.log('No preloaded data found, falling back to local server...');
        }

        if (!contentData) {
            if (!API_URL) {
                setError('Esta canción aún no está precargada.');
                return;
            }
            const response = await fetch(`${API_URL}/api/song?url=${encodeURIComponent(song.url)}`);
            contentData = await response.json();
        }
        
        if (contentData.error) {
          setError(contentData.error);
        } else {
          setContent(contentData.content);
          setAddedChords(contentData.added_chords || null);
        }
      } catch (err) {
        setError('Error de conexión al cargar la canción.');
      } finally {
        setLoading(false);
      }
    };

    fetchSong();
  }, [song]);

  useEffect(() => {
    if (!content) {
        setDisplayContent('');
        return;
    }
    
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;

    // Always in sharps: transposing already gives sharps, and in the original key the flats are rewritten
    const chordElements = tempDiv.querySelectorAll('.chord');
    chordElements.forEach(el => {
        const originalChord = el.innerText.trim();
        const shown = transposeDelta === 0 ? sharpChord(originalChord) : transposeChord(originalChord, transposeDelta);
        if (shown !== originalChord) el.innerText = shown;
    });
    
    setDisplayContent(tempDiv.innerHTML);
  }, [content, transposeDelta]);

  // The sheet's text as big as fits without wrapping a chord line or the lyrics under it (wrapped, the chords lose
  // their columns; a long comment line may wrap). Phones and ?reel take it as the base size (--sheet-fit), which
  // A− A+ then scale like before
  useEffect(() => {
    const pre = contentRef.current?.querySelector('.chord-sheet');
    if (!displayContent || !pre) return;
    const lines = indexSheet(pre);
    const cols = Math.max(0, ...lines.filter((l, i) => l.chords.length || lines[i - 1]?.chordsOnly).map(l => l.text.trimEnd().length));
    const sample = lines.flatMap(l => l.parts).find(p => /^[^\n]{8}/.test(p.node.data.slice(p.offset)));
    if (!cols || !sample) return;
    const fit = () => {
      pre.style.setProperty('--sheet-fit', 1);
      const range = document.createRange();
      range.setStart(sample.node, sample.offset);
      range.setEnd(sample.node, sample.offset + 8);
      const charWidth = range.getBoundingClientRect().width / 8 / fontScale; // at A− A+ 1
      const room = pre.clientWidth - parseFloat(getComputedStyle(pre).paddingLeft) * 2;
      pre.style.setProperty('--sheet-fit', Math.max(REEL ? 0.6 : 0.85, Math.min(1, room / (cols * charWidth) - 0.01)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [displayContent, fontScale]);

  useEffect(() => {
    if (displayContent && contentRef.current && chordDb && chordDb.chords) {
      const chordElements = contentRef.current.querySelectorAll('.chord');
      const uniqueChords = [...new Set(Array.from(chordElements).map(el => el.innerText.trim()))];
      
      // Several chords written together ("Am-C-D") or a tuning aren't a chord: no diagram
      setDiagrams(uniqueChords.map(chordDiagram).filter(Boolean));

      const handleClick = (e) => {
          const chordName = e.target.innerText.trim();
          setSelectedChordSvg(chordDiagram(chordName));
          if (chordOnScreen) setLiveChord(live => ({ ...live, now: chordName }));
      };

      chordElements.forEach(el => {
          el.addEventListener('click', handleClick);
      });

      return () => {
          chordElements.forEach(el => {
              el.removeEventListener('click', handleClick);
          });
      };
    }
  }, [displayContent, chordDb, chordOnScreen]);

  useEffect(() => {
    if (isScrolling && !syncing) {
      scrollIntervalRef.current = setInterval(() => {
        if (viewerRef.current) {
          const currentSpeed = scrollSpeeds[scrollSpeedIndex];
          viewerRef.current.scrollTop += (currentSpeed * 0.5);
        }
      }, 50);
    } else {
      clearInterval(scrollIntervalRef.current);
    }
    return () => clearInterval(scrollIntervalRef.current);
  }, [isScrolling, scrollSpeedIndex, syncing]);

  // Follow the video. With synced lyrics, the line being sung lights up, its chords come in one by
  // one and the sheet stays still, turning the page when the lit line gets near the bottom (like
  // "Escuchar artículo" in the blog): a sheet that never stops moving is hard to read with a guitar
  // in your hands. Without synced lyrics, the sheet glides in proportion to the video. If the user
  // moves the sheet while it plays, wait until they let go.
  useEffect(() => {
    const scroller = viewerRef.current;
    const sheet = contentRef.current;
    if (!syncing || !(isScrolling || REEL) || !scroller || !sheet) return;
    if (syncPoints?.length) return followLyrics(scroller, sheet);

    // Only a real gesture counts as moving the sheet by hand. The page also scrolls on its own when it
    // reflows (zoom, window or text size), and that must not become a manual offset
    let lastGesture = -Infinity;
    const gesture = () => { lastGesture = performance.now(); };
    const scrollbarGesture = (e) => { if (e.target === scroller) gesture(); };
    const keyGesture = (e) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) gesture(); };
    scroller.addEventListener('wheel', gesture, { passive: true });
    scroller.addEventListener('touchmove', gesture, { passive: true });
    scroller.addEventListener('pointerdown', scrollbarGesture);
    window.addEventListener('keydown', keyGesture);

    let frame;
    let pos = scroller.scrollTop; // where we last put the sheet
    let holdUntil = 0;
    let lines = { size: '' }; // the sheet's size, to notice when it reflows
    const tick = (now) => {
      frame = requestAnimationFrame(tick);
      const player = playerRef.current;
      if (!player.duration) return;

      if (Math.abs(scroller.scrollTop - pos) > 2) {
        pos = scroller.scrollTop;
        if (now - lastGesture < 1000) { // moved by hand (a fling keeps moving after the finger lifts)
          lastGesture = now;
          holdUntil = now + 1000;
          return;
        }
      }
      if (now < holdUntil) return;

      const elapsed = player.state === 1 ? (now - player.stamp) / 1000 * player.rate : 0;
      const t = Math.min(Math.max(player.time + elapsed, 0), player.duration);
      const sheetRect = sheet.getBoundingClientRect();
      const sheetTop = sheetRect.top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const size = `${sheet.offsetWidth}x${sheet.offsetHeight}`;
      if (lines.size !== size) {
        if (lines.size) syncOffsetRef.current = 0; // a manual offset in px means nothing once lines move
        lines = { size };
      }
      const y = t / player.duration * sheet.offsetHeight;
      const headerHeight = scroller.querySelector('.viewer-header')?.offsetHeight || 0;
      const readingY = headerHeight + (scroller.clientHeight - headerHeight) * READING_LINE;
      const base = sheetTop + y - readingY;
      if (holdUntil) {
        syncOffsetRef.current = pos - base;
        holdUntil = 0;
      }
      const maxScroll = scroller.scrollHeight - scroller.clientHeight;
      const target = Math.min(Math.max(base + syncOffsetRef.current, 0), maxScroll);
      pos += (target - pos) * 0.15;
      scroller.scrollTop = pos;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('wheel', gesture);
      scroller.removeEventListener('touchmove', gesture);
      scroller.removeEventListener('pointerdown', scrollbarGesture);
      window.removeEventListener('keydown', keyGesture);
    };
  }, [syncing, isScrolling, loading, syncPoints, timeOffset, displayContent, translation]);

  // Line by line with the synced lyrics (see above). Returns the cleanup
  const followLyrics = (scroller, sheet) => {
    const pre = sheet.querySelector('.chord-sheet');
    const band = bandRef.current;
    const progress = progressRef.current;
    if (!pre || !band || !progress) return undefined;
    const lines = indexSheet(pre);
    const { segments, events } = buildTimeline(syncPoints, lines);
    let sungKey = null; // the words lit now, to touch the highlights only when they change
    band.classList.toggle('words', canHighlight);
    // Highlights read custom properties from the root, so the song's mood color goes there
    if (canHighlight) document.documentElement.style.setProperty('--sing-ink', getComputedStyle(scroller).getPropertyValue('--mood-ink').trim() || 'var(--signal)');

    let lastGesture = -Infinity;
    const gesture = () => { lastGesture = performance.now(); };
    const scrollbarGesture = (e) => { if (e.target === scroller) gesture(); };
    const keyGesture = (e) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) gesture(); };
    scroller.addEventListener('wheel', gesture, { passive: true });
    scroller.addEventListener('touchmove', gesture, { passive: true });
    scroller.addEventListener('pointerdown', scrollbarGesture);
    window.addEventListener('keydown', keyGesture);

    let frame;
    let pos = scroller.scrollTop; // where we last put the sheet
    let target = null; // where the sheet is gliding to after a page turn
    let holdUntil = 0;
    let layout = { size: '' }; // line positions, measured again when the sheet's size changes
    let shown = null; // segment on screen
    let lastClock = null; // to glide by elapsed time, the same on a 60 or 120 Hz screen and in a recording
    const tick = (now) => {
      frame = requestAnimationFrame(tick);
      const player = playerRef.current;
      if (!player.duration) return;

      if (Math.abs(scroller.scrollTop - pos) > 2) {
        pos = scroller.scrollTop;
        if (now - lastGesture < 1000) { // moved by hand: let them read where they want for a while
          lastGesture = now;
          holdUntil = now + 2500;
          target = null;
        }
      }

      const size = `${sheet.offsetWidth}x${sheet.offsetHeight}`;
      if (layout.size !== size) {
        const lineHeight = parseFloat(getComputedStyle(pre).lineHeight) || 20;
        layout = { size, lineHeight, tops: measureLineTops(pre, sheet.getBoundingClientRect().top, lineHeight), widths: new Map() };
        band.style.left = `${pre.offsetLeft + 6}px`;
        band.style.width = `${pre.offsetWidth - 12}px`;
        progress.style.left = `${parseFloat(getComputedStyle(pre).paddingLeft) - 6}px`;
        shown = null;
      }
      const { tops, lineHeight } = layout;
      const lineTop = l => tops[Math.min(l, tops.length - 1)] ?? 0;
      const lineBottom = l => (l + 1 < tops.length ? tops[l + 1] : lineTop(l) + lineHeight);

      const elapsed = player.state === 1 ? (now - player.stamp) / 1000 * player.rate : 0;
      const t = Math.min(Math.max(player.time + elapsed, 0), player.duration) - timeOffset;

      // The line being sung and the chord sounding now
      const seg = lastAt(segments, t, s => s.start);
      if (seg !== shown) {
        shown = seg;
        band.classList.toggle('on', Boolean(seg));
        if (seg) {
          band.style.transform = `translateY(${lineTop(seg.top) - 4}px)`;
          band.style.height = `${lineBottom(seg.bottom) - lineTop(seg.top) + 8}px`;
          if (seg.sung && !layout.widths.has(seg.bottom)) {
            const range = document.createRange(); // how wide the sung line is, for the progress bar
            range.selectNodeContents(pre);
            const rects = [...range.getClientRects()].filter(r => r.top >= sheet.getBoundingClientRect().top + lineTop(seg.bottom) - 1 && r.top < sheet.getBoundingClientRect().top + lineBottom(seg.bottom) - 1);
            const left = pre.getBoundingClientRect().left + parseFloat(getComputedStyle(pre).paddingLeft);
            layout.widths.set(seg.bottom, Math.max(0, ...rects.map(r => r.right - left)));
          }
          progress.style.width = `${seg.sung ? layout.widths.get(seg.bottom) : 0}px`;
        }
        // ?reel: the sung line's translation; a part with chords only (intro, solo) has none
        const caption = captionRef.current;
        if (caption) {
          const text = seg?.sung && translation?.lineas[lines[seg.bottom].text.trim()];
          if (text) caption.textContent = text;
          caption.classList.toggle('on', Boolean(text));
        }
      }
      // The words already sung light up, word by word (a bar under the line where the browser can't)
      if (seg?.sung) {
        const col = interpolate(t, seg.times, seg.cols);
        if (canHighlight) {
          const lit = sungRanges(lines[seg.bottom], col);
          const key = lit && `${seg.bottom}:${lit.key}`;
          if (key !== sungKey) {
            sungKey = key;
            if (lit) {
              CSS.highlights.set('sung', new Highlight(lit.sung));
              CSS.highlights.set('sung-now', new Highlight(lit.now));
            } else clearSung();
          }
        } else progress.style.transform = `scaleX(${Math.min(col / seg.length, 1)})`;
      } else if (sungKey !== null) { sungKey = null; clearSung(); }
      // A chord keeps sounding until the next one; long after the last written one (a part the sheet
      // writes without chords, "same as above") it is no longer what sounds
      const last = lastAt(events, t, e => e.t);
      const chord = last && (t - last.t < 12 || seg?.events.includes(last)) ? last.el : null;
      if (chord !== nowChordRef.current) {
        nowChordRef.current?.classList.remove('chord-now');
        chord?.classList.add('chord-now');
        nowChordRef.current = chord;
      }

      // Turn the page when the lit line leaves the comfortable part of the screen
      if (now >= holdUntil && seg) {
        const headerHeight = scroller.querySelector('.viewer-header')?.offsetHeight || 0;
        const visible = scroller.clientHeight - headerHeight;
        const sheetTop = sheet.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
        const top = sheetTop + lineTop(seg.top) - scroller.scrollTop;
        const bottom = sheetTop + lineBottom(seg.bottom) - scroller.scrollTop;
        if (top < headerHeight + visible * 0.05 || bottom > headerHeight + visible * 0.75) {
          const maxScroll = scroller.scrollHeight - scroller.clientHeight;
          target = Math.min(Math.max(sheetTop + lineTop(seg.top) - headerHeight - visible * 0.2, 0), maxScroll);
        }
      }
      // A recording draws frames slower than real time, so there the song's own second is the clock
      const clock = REEL ? t * 1000 : now;
      const dt = lastClock === null ? 16.7 : Math.min(Math.max(clock - lastClock, 0), 100);
      lastClock = clock;
      if (target !== null && dt > 0) {
        pos += (target - pos) * (1 - Math.pow(0.88, dt / 16.7)); // 12% of the way per 60 Hz frame
        if (Math.abs(target - pos) < 0.5) { pos = target; target = null; }
        scroller.scrollTop = pos;
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      clearSung();
      scroller.removeEventListener('wheel', gesture);
      scroller.removeEventListener('touchmove', gesture);
      scroller.removeEventListener('pointerdown', scrollbarGesture);
      window.removeEventListener('keydown', keyGesture);
    };
  };

  // Turning the sync off (or changing song, version or key) takes the light off the sheet
  useEffect(() => {
    if (syncing && syncPoints?.length) return;
    bandRef.current?.classList.remove('on');
    clearSung();
    nowChordRef.current?.classList.remove('chord-now');
    nowChordRef.current = null;
  }, [syncing, syncPoints, displayContent]);

  // 🎯 calibration: the tapped line is the one being sung now, so the gap between the video's
  // time and that line's lyric time is the song's offset
  const calibrateAt = (e) => {
    if (!calibrating || !syncPoints?.length) return;
    const sheet = contentRef.current;
    const pre = sheet.querySelector('.chord-sheet');
    const sheetTop = sheet.getBoundingClientRect().top;
    const tops = measureLineTops(pre, sheetTop, parseFloat(getComputedStyle(pre).lineHeight) || 20);
    let line = 0;
    tops.forEach((top, i) => { if (top <= e.clientY - sheetTop) line = i; });
    const player = playerRef.current;
    const now = player.time + (player.state === 1 ? (performance.now() - player.stamp) / 1000 * player.rate : 0);
    // The synced line closest to the tapped one; for a chorus sung several times, the time nearest to now
    const [lyricTime] = syncPoints.reduce((best, p) => {
      const score = Math.abs(p[1] - line) * 1000 + Math.abs(now - timeOffset - p[0]);
      return score < best.score ? { p, score } : best;
    }, { p: null, score: Infinity }).p;
    setTimeOffsets(offsets => ({ ...offsets, [song.url]: { s: Math.round((now - lyricTime) * 10) / 10, times: lyricTimesKey } }));
    syncOffsetRef.current = 0;
    setCalibrating(false);
  };

  // { name, svg, note } for a chord as the sheet writes it, or null if it isn't one
  const chordDiagram = (chordName) => {
    const shape = findChordShape(chordDb, chordName);
    return shape && { name: chordName, svg: renderSVGChord(shape.pos, chordName), note: shape.note };
  };

  useEffect(() => {
    if (!REEL) localStorage.setItem('chordOnScreen', chordOnScreen);
  }, [chordOnScreen]);

  // Which chord you're at: with the lyrics following the video, the one sounding; otherwise the first one
  // at the top of what you see (the line you're reading as the sheet goes up). And the next different one
  useEffect(() => {
    if (!chordOnScreen || loading) return;
    const pick = () => {
      const scroller = viewerRef.current;
      const sheet = contentRef.current;
      if (!scroller || !sheet) return;
      const chords = [...sheet.querySelectorAll('.chord')].filter(c => findChordShape(chordDb, c.innerText.trim()));
      if (!chords.length) return;
      let now = syncing && syncPoints?.length && nowChordRef.current?.isConnected ? nowChordRef.current : null;
      if (!now) {
        const headerBottom = scroller.querySelector('.viewer-header')?.getBoundingClientRect().bottom ?? 0;
        now = chords.find(c => c.getBoundingClientRect().top >= headerBottom) || chords[chords.length - 1];
      }
      const name = now.innerText.trim();
      const next = chords.slice(chords.indexOf(now) + 1).find(c => c.innerText.trim() !== name)?.innerText.trim() || null;
      setLiveChord(live => (live?.now === name && live?.next === next ? live : { now: name, next }));
    };
    pick();
    if (REEL) { // the recorder asks on every frame
      window.addEventListener('reel:frame', pick);
      return () => window.removeEventListener('reel:frame', pick);
    }
    const timer = setInterval(pick, 200);
    return () => clearInterval(timer);
  }, [chordOnScreen, loading, displayContent, syncing, syncPoints, chordDb]);

  // The speed slider: with the video, how fast it plays (slower to practice; the sheet keeps following it);
  // without it, how fast the sheet scrolls (same steps as − and +)
  const [rateIndex, setRateIndex] = useState(VIDEO_RATES.indexOf(1));
  useEffect(() => { setRateIndex(VIDEO_RATES.indexOf(1)); }, [activeVideoId]); // a new video starts at 1x

  const setVideoRate = (i) => {
    const player = playerRef.current;
    const now = performance.now();
    if (player.state === 1) { // keep the time count right across the change
      player.time += (now - player.stamp) / 1000 * player.rate;
      player.stamp = now;
    }
    player.rate = VIDEO_RATES[i];
    setRateIndex(i);
    postToPlayer('setPlaybackRate', [VIDEO_RATES[i]]);
  };

  const toggleScroll = () => {
    if (syncing) {
      const playing = [1, 3].includes(playerRef.current.state); // playing or buffering
      sendPlayerCommand(playing ? 'pauseVideo' : 'playVideo');
      if (!playing) setTimeout(() => setPlayHint(playerRef.current.state !== 1), 2500);
    } else {
      setIsScrolling(!isScrolling);
    }
  };

  const toggleSync = () => {
    syncOffsetRef.current = 0;
    // Turning sync on while the video plays should start following right away
    if (!syncWithVideo) setIsScrolling(playerRef.current.state === 1);
    setSyncWithVideo(!syncWithVideo);
  };
  const updateSpeed = (direction) => {
    setScrollSpeedIndex(prev => {
      let next = prev + direction;
      if (next < 0) next = 0;
      if (next >= scrollSpeeds.length) next = scrollSpeeds.length - 1;
      return next;
    });
  };

  const displaySpeed = scrollSpeeds[scrollSpeedIndex];

  const getTransposeLabel = () => {
      if (transposeDelta === 0) return 'Tono original';
      return transposeDelta > 0 ? `+${transposeDelta}` : `${transposeDelta}`;
  };

  const artist = song.clean_artist || song.folder || '';
  const title = song.clean_title || song.title || '';
  const defaultQuery = artist !== 'Otros' && artist !== 'Unknown' ? `${artist} ${title} karaoke` : `${title} karaoke`;

  const handleSearchYoutube = async (overrideQuery = null) => {
    const q = overrideQuery || searchQuery || defaultQuery;
    if (!q.trim()) return;
    setSearchingVideo(true);
    try {
      const response = await fetch(`${API_URL}/api/youtube/search?query=${encodeURIComponent(q)}`);
      if (response.ok) {
        const data = await response.json();
        setSearchResults(data.results || []);
      }
    } catch (err) {
      console.error("Error searching YouTube:", err);
    } finally {
      setSearchingVideo(false);
    }
  };

  const handleLinkVideo = async (videoId, videoTitle) => {
    setLinkingVideo(true);
    try {
      const response = await fetch(`${API_URL}/api/song/link_video`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: song.url,
          video_id: videoId,
          video_title: videoTitle
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        const updatedTrack = {
          "Karaoke": {
            "id": videoId,
            "title": videoTitle,
            "youtube_url": `https://www.youtube.com/watch?v=${videoId}`
          }
        };
        setBackingTracks(updatedTrack);
        setResumeAt(null);
        setActiveVideoId(videoId);
        setIsSearching(false);
        if (onVideoLinked) {
          onVideoLinked(song.url, videoId, videoTitle);
        }
      }
    } catch (err) {
      console.error("Error linking video:", err);
    } finally {
      setLinkingVideo(false);
    }
  };

  // The song's own address (/cancion/artista/titulo/): the phone's share sheet, or copied on a computer
  const [shared, setShared] = useState(false);
  const shareSong = async () => {
    const url = window.location.href;
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ title: `${song.title} — ${song.folder}`, url }); } catch (e) { /* cancelado */ }
      return;
    }
    await navigator.clipboard.writeText(url);
    setShared(true);
    setTimeout(() => setShared(false), 2000);
  };

  return (
    <div 
      id="song-viewer" 
      className={`${song.theme ? `theme-${song.theme.toLowerCase()}` : ''} ${showYoutube && !videoMini ? 'with-youtube' : ''} ${visualStyle ? 'with-visuals' : ''} ${REEL ? 'reel' : ''}`}
      style={{
        '--active-mood-color': song.mood ? (MOODS_CONFIG[song.mood]?.color || '#ffffff') : 'var(--primary)',
        '--active-mood-rgb': song.mood ? (MOODS_CONFIG[song.mood]?.rgb || '255,255,255') : '242,184,75'
      }}
    >
      <Visualizer
        style={visualStyle}
        videoId={visualsId}
        getTime={videoTime}
        rgb={MOODS_CONFIG[song.mood]?.rgb || '242, 184, 75'}
        theme={song.theme}
        energy={song.energy}
        presetStep={presetStep}
        onFallback={fallBackToLight}
        reel={REEL}
      />
      <div className="thematic-pattern" style={{ opacity: 0.07, zIndex: 0 }}></div>
      
      <div className={`viewer-left-panel ${selectedChordSvg || chordOnScreen ? 'with-selected-chord' : ''}`}>
        <div className="chords-scroll-container" ref={viewerRef}>
          <div className="chords-content-wrapper" style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1rem', position: 'relative', zIndex: 2 }}>
            <div className="viewer-header">
              <div>
                <h2 id="viewer-title">{song.title}</h2>
                {song.folder !== 'Otros' && <div className="viewer-artist">{song.folder}</div>}
                {REEL && <div className="reel-brand"><i className="fas fa-music"></i> Acordate · rodolflying.github.io/Acordes</div>}
              </div>
              
              <div className="viewer-controls">
                <button
                  onClick={() => setChordOnScreen(on => !on)}
                  className={`btn ${chordOnScreen ? 'btn-on' : ''}`}
                  aria-pressed={chordOnScreen}
                  title={chordOnScreen ? 'Ocultar el acorde en pantalla' : 'Ver en grande el acorde en que vas y el que sigue (queda activo para todas las canciones)'}
                >
                  <i className="fas fa-table-cells-large"></i> <span className="btn-label">Acorde en pantalla</span>
                </button>

                {/* YouTube Toggle Button (without the local server, only for songs that have tracks) */}
                {!loadingTracks && (backingTracks || API_URL) && (
                  <button 
                    onClick={() => {
                      if (videoMini) return setVideoMini(false);
                      if (showYoutube) keepSpot();
                      setShowYoutube(!showYoutube);
                    }}
                    className={`btn ${showYoutube ? 'btn-on' : ''}`}
                    title="Pistas oficiales de acompañamiento"
                    aria-label={showYoutube ? 'Ocultar pista' : 'Mostrar pista'}
                  >
                    <i className="fab fa-youtube" style={{ color: '#ff3b3b' }}></i>
                    <span className="btn-label">{showYoutube ? 'Pista activa' : 'Acompañar'}</span>
                  </button>
                )}

                <div className="transpose-controls">
                  <button onClick={() => setTransposeDelta(p => p - 1)} className="btn-icon" title="Bajar medio tono" aria-label="Bajar medio tono">
                      <i className="fas fa-minus"></i>
                  </button>
                  <div className={`transpose-label ${transposeDelta !== 0 ? 'shifted' : ''}`}>
                      {getTransposeLabel()}
                  </div>
                  <button onClick={() => setTransposeDelta(p => p + 1)} className="btn-icon" title="Subir medio tono" aria-label="Subir medio tono">
                      <i className="fas fa-plus"></i>
                  </button>
                  {transposeDelta !== 0 && (
                      <button onClick={() => setTransposeDelta(0)} className="btn-icon transpose-reset" title="Volver al tono original" aria-label="Volver al tono original">
                          <i className="fas fa-undo"></i>
                      </button>
                  )}
                </div>

                <div className="font-controls">
                  <button onClick={() => changeFontScale(-1)} className="btn-icon" title="Letra más chica" aria-label="Letra más chica">A−</button>
                  <button onClick={() => changeFontScale(1)} className="btn-icon" title="Letra más grande" aria-label="Letra más grande">A+</button>
                </div>

                <SaveStar saved={saved} onClick={onSave} withLabel />

                <button onClick={shareSong} className={`btn ${shared ? 'btn-on' : ''}`} title="Compartir el link de esta canción" aria-label="Compartir">
                  <i className={`fas ${shared ? 'fa-check' : 'fa-share-nodes'}`}></i>{shared && <span className="btn-label"> Link copiado</span>}
                </button>

                <button onClick={onClose} className="btn btn-close" aria-label="Cerrar">
                  <i className="fas fa-times"></i> <span className="btn-label">Cerrar</span>
                </button>
              </div>
            </div>
            
            {loading && <div style={{ textAlign: 'center', padding: '3rem' }}><i className="fas fa-spinner fa-spin fa-3x"></i><br/><br/>Cargando acordes...</div>}
            
            {error && <div style={{ color: 'var(--text-soft)', padding: '2rem' }}>{error}</div>}
            
            {!loading && !error && (
              <>
                <div id="diagrams-container" className="diagrams-scroll">
                  {diagrams.map((d, i) => (
                    <div key={i} className="diagram-item animate-in" title={d.note ? `${d.name}: ${d.note}` : d.name}>
                      <div dangerouslySetInnerHTML={{ __html: d.svg }} />
                      {d.note && <div className="diagram-note">{d.note}</div>}
                    </div>
                  ))}
                </div>
                {addedChords && (addedChords.bloque + addedChords.linea + addedChords.audio) > 0 && (
                  <p className="added-note">
                    <i className="fas fa-wand-magic-sparkles"></i>{' '}
                    Completamos {addedChords.bloque + addedChords.linea + addedChords.audio} líneas que esta hoja dejaba sin acordes
                    {' '}(<span className="chord-added-sample">subrayados</span>):
                    {addedChords.bloque + addedChords.linea > 0 && ` ${addedChords.bloque + addedChords.linea} repiten una parte de más arriba`}
                    {addedChords.bloque + addedChords.linea > 0 && addedChords.audio > 0 && ' y'}
                    {addedChords.audio > 0 && ` ${addedChords.audio} los oímos en tu video`}.
                  </p>
                )}
                <div id="viewer-content" ref={contentRef} style={{ '--sheet-scale': fontScale }} className={calibrating ? 'calibrating' : ''} onClick={calibrateAt}>
                  <div className="sing-band" ref={bandRef} aria-hidden="true">
                    <div className="sing-progress" ref={progressRef}></div>
                  </div>
                  <pre className="chord-sheet" dangerouslySetInnerHTML={{ __html: displayContent }}></pre>
                </div>
              </>
            )}
          </div>
        </div>

        {chordOnScreen && liveChord?.now && (() => {
          const now = chordDiagram(liveChord.now);
          const next = liveChord.next && chordDiagram(liveChord.next);
          return now && (
            <div className="selected-chord-panel chord-live-panel" aria-live="polite">
              <div className="chord-live-now">
                <div className="chord-live-label">Ahora</div>
                <div className="chord-live-svg" dangerouslySetInnerHTML={{ __html: now.svg }} />
                {now.note && <div className="diagram-note">{now.note}</div>}
              </div>
              {next && (
                <div className="chord-live-next">
                  <div className="chord-live-label">Sigue</div>
                  <div dangerouslySetInnerHTML={{ __html: next.svg }} />
                </div>
              )}
            </div>
          );
        })()}

        {REEL && translation && <div className="reel-caption" ref={captionRef} lang={translation.a} aria-live="polite"></div>}

        {selectedChordSvg && !chordOnScreen && (
          <div className="selected-chord-panel animate-in">
             <div style={{ color: 'var(--mood-ink, var(--signal))', fontWeight: 'bold', fontSize: '1.5rem', letterSpacing: '1px' }}>{selectedChordSvg.name}</div>
             <div dangerouslySetInnerHTML={{ __html: selectedChordSvg.svg }} style={{ transform: 'scale(1.2)', transformOrigin: 'center' }} />
             <button onClick={() => setSelectedChordSvg(null)} className="btn-icon" style={{background: 'var(--glass)', width: '40px', height: '40px'}}>
                 <i className="fas fa-times"></i>
             </button>
          </div>
        )}
      </div>

      {/* YouTube Sidebar */}
      {showYoutube && !REEL && (
        <div className={`viewer-right-panel ${videoMini ? 'mini' : 'animate-in'}`}>
          <div className="youtube-sidebar-header">
            <h3><i className="fab fa-youtube" style={{ color: '#ff3b3b', marginRight: '8px' }}></i>Acompañamiento</h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              {API_URL && (
              <button
                onClick={() => {
                  if (!isSearching) {
                    setSearchQuery(defaultQuery);
                    keepSpot();
                    setIsSearching(true);
                  } else {
                    setIsSearching(false);
                  }
                }}
                className={`btn-icon ${isSearching ? 'active' : ''}`}
                title="Buscar otro video de YouTube"
                style={{ width: '32px', height: '32px', fontSize: '0.9rem', color: isSearching ? 'var(--primary)' : 'white', background: isSearching ? 'var(--signal-soft)' : 'transparent', border: 'none', borderRadius: '50%', cursor: 'pointer' }}
              >
                <i className="fas fa-search"></i>
              </button>
              )}
              <button
                onClick={() => setVideoMini(!videoMini)}
                className="btn-icon"
                title={videoMini ? 'Agrandar el panel' : 'Minimizar: el video sigue sonando en una esquina'}
                aria-label={videoMini ? 'Agrandar el panel del video' : 'Minimizar el panel del video'}
                style={{ width: '32px', height: '32px', border: 'none', background: 'transparent', color: 'white', cursor: 'pointer' }}
              >
                <i className={`fas ${videoMini ? 'fa-up-right-and-down-left-from-center' : 'fa-down-left-and-up-right-to-center'}`}></i>
              </button>
              {videoMini && (
                <button onClick={() => { keepSpot(); setVideoMini(false); setShowYoutube(false); }} className="btn-icon" title="Cerrar el video" aria-label="Cerrar el video" style={{ width: '32px', height: '32px', border: 'none', background: 'transparent', color: 'white', cursor: 'pointer' }}>
                  <i className="fas fa-times"></i>
                </button>
              )}
            </div>
          </div>

          <div className="youtube-sidebar-content">
            {isSearching ? (
              <div className="youtube-search-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                  <span className="sidebar-section-title" style={{ margin: 0, fontSize: '0.9rem', color: 'var(--primary)', fontWeight: 'bold' }}>Buscar en YouTube</span>
                  {backingTracks && (
                    <button 
                      onClick={() => setIsSearching(false)} 
                      style={{ fontSize: '0.8rem', color: 'var(--text-muted)', border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
                    >
                      Volver
                    </button>
                  )}
                </div>
                
                <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem' }}>
                  <input 
                    type="text" 
                    value={searchQuery} 
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Ej: Coldplay Fix You..."
                    style={{
                      flex: 1,
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid var(--glass-border)',
                      borderRadius: '15px',
                      padding: '0.5rem 0.8rem',
                      color: 'white',
                      fontSize: '0.9rem',
                      outline: 'none'
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearchYoutube()}
                  />
                  <button 
                    onClick={() => handleSearchYoutube()}
                    className="btn btn-primary"
                    style={{ padding: '0.5rem 1rem', borderRadius: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    disabled={searchingVideo}
                  >
                    {searchingVideo ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-search"></i>}
                  </button>
                </div>

                {searchResults.length > 0 ? (
                  <div className="search-results-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
                    {searchResults.map((video) => (
                      <div 
                        key={video.id} 
                        className="search-result-item" 
                        style={{ 
                          display: 'flex', 
                          gap: '8px', 
                          background: 'rgba(255, 255, 255, 0.03)', 
                          padding: '0.5rem', 
                          borderRadius: '12px',
                          border: '1px solid rgba(255, 255, 255, 0.05)'
                        }}
                      >
                        <img 
                          src={video.thumbnail} 
                          alt={video.title} 
                          style={{ width: '80px', height: '60px', objectFit: 'cover', borderRadius: '8px' }} 
                        />
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                          <div 
                            style={{ 
                              fontSize: '0.75rem', 
                              fontWeight: 'bold', 
                              color: 'var(--text-main)', 
                              display: '-webkit-box', 
                              WebkitLineClamp: 2, 
                              WebkitBoxOrient: 'vertical', 
                              overflow: 'hidden',
                              lineHeight: '1rem',
                              textAlign: 'left'
                            }} 
                            dangerouslySetInnerHTML={{ __html: video.title }}
                          />
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{video.channelTitle}</span>
                            <button 
                              className="btn" 
                              style={{ padding: '2px 8px', fontSize: '0.7rem', background: 'var(--signal)', color: 'var(--signal-ink)', borderRadius: '8px', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}
                              disabled={linkingVideo}
                              onClick={() => handleLinkVideo(video.id, video.title)}
                            >
                              {linkingVideo ? <i className="fas fa-spinner fa-spin"></i> : 'Vincular'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  !searchingVideo && (
                    <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      Realiza una búsqueda para ver videos candidatos.
                    </div>
                  )
                )}
              </div>
            ) : backingTracks ? (
              <>
                {activeVideoId ? (
                  <div className="youtube-player-container">
                    <div className="youtube-player-wrapper">
                      <iframe
                        key={activeVideoId}
                        ref={iframeRef}
                        onLoad={(e) => connectPlayer(e.currentTarget)}
                        id="youtube-player-iframe"
                        src={`https://www.youtube.com/embed/${activeVideoId}?enablejsapi=1&playsinline=1&origin=${window.location.origin}${resumeAt?.t ? `&start=${resumeAt.t}` : ''}${resumeAt?.play ? '&autoplay=1' : ''}`}
                        title="YouTube Backing Track Player"
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                      ></iframe>
                    </div>
                    <div className="youtube-video-current-title" style={{ marginTop: '0.5rem' }}>
                      {Object.values(backingTracks).find(t => t.id === activeVideoId)?.title || 'Pista Seleccionada'}
                    </div>
                  </div>
                ) : (
                  <div className="youtube-placeholder-card">
                    <i className="fas fa-music fa-2x" style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}></i>
                    <p>Selecciona una pista abajo para empezar</p>
                  </div>
                )}

                {/* Exclusive 3-version selector */}
                <div className="version-selector-container">
                  <div className="sidebar-section-title">Elige versión de acompañamiento:</div>
                  <div className="version-buttons-group">
                    {['Karaoke', 'Instrumental', 'Backtrack'].map(version => {
                      const trackInfo = backingTracks[version];
                      const isAvailable = !!trackInfo;
                      const isActive = activeVideoId === trackInfo?.id;
                      
                      return (
                        <button
                          key={version}
                          className={`version-btn ${isActive ? 'active' : ''} ${!isAvailable ? 'disabled' : ''}`}
                          disabled={!isAvailable}
                          onClick={() => {
                            if (!isAvailable || isActive) return; // the same video would reload
                            keepSpot(true);
                            setActiveVideoId(trackInfo.id);
                          }}
                        >
                          <span className="version-icon">
                            {version === 'Karaoke' && '🎤'}
                            {version === 'Instrumental' && '🎸'}
                            {version === 'Backtrack' && '🥁'}
                          </span>
                          <div className="version-label-info">
                            <span className="version-name">{version}</span>
                            <span className="version-status">{isAvailable ? 'Disponible' : 'No disponible'}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div className="youtube-placeholder-card" style={{ padding: '2rem 1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--glass-border)', borderRadius: '15px', margin: '1rem' }}>
                <i className="fab fa-youtube fa-3x" style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}></i>
                <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-main)' }}>Sin video de acompañamiento</h4>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', marginBottom: '1.5rem', lineHeight: '1.2rem' }}>
                  Esta canción no tiene pistas oficiales ni videos vinculados. ¿Quieres buscar uno en YouTube?
                </p>
                <button 
                  onClick={() => {
                    setSearchQuery(defaultQuery);
                    setIsSearching(true);
                    handleSearchYoutube(defaultQuery);
                  }}
                  className="btn btn-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0.6rem 1.2rem', borderRadius: '20px', cursor: 'pointer' }}
                >
                  <i className="fas fa-search"></i> Buscar en YouTube
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {!loading && !error && !REEL && (
        <div id="autoscroll-controls" className="autoscroll-panel">
          <button
            onClick={nextVisualStyle}
            className={`btn-icon ${visualStyle ? 'sync-on' : ''}`}
            aria-pressed={Boolean(visualStyle)}
            title={`Fondo con la música: ${VISUAL_STYLES.find(v => v.id === visualStyle)?.name || 'apagado'} · clic para cambiar`}
            aria-label="Cambiar el fondo con la música"
          >
            <i className="fas fa-wave-square"></i>
          </button>
          {visualStyle === 'clasico' && (
            <button onClick={() => setPresetStep(n => n + 1)} className="btn-icon" title="Otro efecto" aria-label="Otro efecto del fondo">
              <i className="fas fa-forward-step"></i>
            </button>
          )}
          <label className="speed-slider"  title={syncing ? 'Velocidad del video: más lento para practicar' : 'Velocidad del desplazamiento'}>
            <i className="fas fa-gauge-high"></i>
            <input
              type="range" min="0" step="1"
              max={syncing ? VIDEO_RATES.length - 1 : scrollSpeeds.length - 1}
              value={syncing ? rateIndex : scrollSpeedIndex}
              onChange={e => (syncing ? setVideoRate(Number(e.target.value)) : setScrollSpeedIndex(Number(e.target.value)))}
              aria-label={syncing ? 'Velocidad del video' : 'Velocidad del desplazamiento'}
            />
            {syncing && <span className="speed-value">x{VIDEO_RATES[rateIndex]}</span>}
          </label>
          {hasVideo && (
            <button
              onClick={toggleSync}
              className={`btn-icon ${syncWithVideo ? 'sync-on' : ''}`}
              aria-pressed={syncWithVideo}
              title={!syncWithVideo ? 'Velocidad fija · clic para que la hoja siga al video'
                : syncPoints?.length ? 'La hoja sigue la letra del video, línea a línea · clic para velocidad fija'
                : 'La hoja sigue al video de forma aproximada (esta canción no tiene letra con tiempos) · clic para velocidad fija'}
            >
              <i className="fas fa-link"></i>
            </button>
          )}
          {syncing && syncPoints?.length > 0 && (
            <button
              onClick={() => setCalibrating(!calibrating)}
              className={`btn-icon ${calibrating ? 'sync-on' : ''}`}
              aria-pressed={calibrating}
              title={`¿La hoja va desfasada? Toca acá y después la línea que está sonando${timeOffset ? ` (desfase actual: ${timeOffset > 0 ? '+' : ''}${timeOffset} s)` : ''}`}
            >
              <i className="fas fa-crosshairs"></i>
            </button>
          )}
          {syncing && !calibrating && timeOffset !== 0 && <span className="sync-offset">{timeOffset > 0 ? '+' : ''}{timeOffset}s</span>}
          {calibrating && <div className="panel-hint">Toca la línea que está sonando</div>}
          {!calibrating && playHint && <div className="panel-hint">Toca el video para empezar</div>}
          {!syncing && <button onClick={() => updateSpeed(-1)} className="btn-icon"><i className="fas fa-minus"></i></button>}
          <button onClick={toggleScroll} className="btn-primary" style={{ borderRadius: '20px', padding: '0.5rem 1rem' }}>
            {isScrolling ? <><i className="fas fa-pause"></i> Pausar</> : <><i className="fas fa-play"></i> {syncing ? 'Reproducir' : 'Auto-Scroll'}</>}
          </button>
          {!syncing && <button onClick={() => updateSpeed(1)} className="btn-icon"><i className="fas fa-plus"></i></button>}
          {!syncing && <div id="scroll-speed-display">x{displaySpeed}</div>}
        </div>
      )}
    </div>
  );
};

export default SongViewer;
