import React, { useState, useEffect, useRef } from 'react';
import { parseChord, renderSVGChord, transposeChord } from './ChordUtils';

const MOODS_CONFIG = {
  "Romántico": { color: "#ff007a", rgb: "255, 0, 122" },
  "Melancólico": { color: "#5e60ce", rgb: "94, 96, 206" },
  "Reflexivo": { color: "#00f2ff", rgb: "0, 242, 255" },
  "Enérgico": { color: "#ffb703", rgb: "255, 183, 3" },
  "Alegre": { color: "#ff7096", rgb: "255, 112, 150" },
  "Épico": { color: "#ff003c", rgb: "255, 0, 60" },
  "Nostálgico": { color: "#f26419", rgb: "242, 100, 25" }
};

// Only defined in dev (client/.env.development); undefined in the GitHub Pages build
const API_URL = import.meta.env.VITE_API_URL;

// Where the current line sits in the viewport while the sheet follows the video
const READING_LINE = 0.3;
const freshPlayer = () => ({ time: 0, stamp: 0, duration: 0, rate: 1, state: -1, ready: false });

const SongViewer = ({ song, onClose, chordDb, backingTracks: propBackingTracks, onVideoLinked }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [content, setContent] = useState('');
  const [displayContent, setDisplayContent] = useState('');
  const [transposeDelta, setTransposeDelta] = useState(0);
  const [diagrams, setDiagrams] = useState([]);
  const [selectedChordSvg, setSelectedChordSvg] = useState(null);
  
  const scrollSpeeds = [0.5, 0.65, 0.8, 1.0, 1.15, 1.3, 1.5, 1.65, 1.8, 2.0];
  const [scrollSpeedIndex, setScrollSpeedIndex] = useState(3); // Corresponde a 1.0
  const [isScrolling, setIsScrolling] = useState(false);
  const viewerRef = useRef(null);
  const scrollIntervalRef = useRef(null);
  const contentRef = useRef(null);


  // YouTube States
  const [showYoutube, setShowYoutube] = useState(false);
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
  const syncing = hasVideo && syncWithVideo;

  useEffect(() => {
    localStorage.setItem('syncWithVideo', syncWithVideo);
  }, [syncWithVideo]);

  // Chord sheet text size, as a multiplier of the base size (bigger text wraps more lines on phones)
  const [fontScale, setFontScale] = useState(() => {
    return Number(localStorage.getItem('sheetFontScale')) || 1;
  });
  const changeFontScale = (step) => {
    setFontScale(s => Math.min(1.6, Math.max(0.7, Math.round((s + step * 0.1) * 10) / 10)));
  };

  useEffect(() => {
    localStorage.setItem('sheetFontScale', fontScale);
  }, [fontScale]);

  // Fetch Backing Tracks matching this song from local uploader JSON
  useEffect(() => {
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
      
      if (defaultVer) {
        setActiveVideoId(propBackingTracks[defaultVer].id);
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
        player.ready = true;
        const info = data && data.info;
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
      if (playerRef.current.ready || !iframe.contentWindow || ++tries > 20) {
        clearInterval(timer);
        return;
      }
      iframe.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), 'https://www.youtube.com');
    }, 250);
  };

  const sendPlayerCommand = (func) => {
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [], id: 1, channel: 'widget' }), 'https://www.youtube.com');
  };

  useEffect(() => {
    const fetchSong = async () => {
      try {
        let contentData = null;
        try {
            const staticRes = await fetch('./preloaded_songs.json');
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
    
    if (transposeDelta === 0) {
        setDisplayContent(content);
        return;
    }
    
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;
    
    const chordElements = tempDiv.querySelectorAll('.chord');
    chordElements.forEach(el => {
        const originalChord = el.innerText.trim();
        el.innerText = transposeChord(originalChord, transposeDelta);
    });
    
    setDisplayContent(tempDiv.innerHTML);
  }, [content, transposeDelta]);

  useEffect(() => {
    if (displayContent && contentRef.current && chordDb && chordDb.chords) {
      const chordElements = contentRef.current.querySelectorAll('.chord');
      const uniqueChords = [...new Set(Array.from(chordElements).map(el => el.innerText.trim()))];
      
      const newDiagrams = uniqueChords.map(chordName => {
        const parsed = parseChord(chordName);
        let posData = null;
        
        if (chordDb.chords[parsed.key]) {
            const variations = chordDb.chords[parsed.key];
            const def = variations.find(v => v.suffix === parsed.suffix);
            if (def && def.positions && def.positions.length > 0) {
                posData = def.positions[0]; 
            }
        }
        return { name: chordName, svg: renderSVGChord(posData, chordName) };
      });
      
      setDiagrams(newDiagrams);
      
      const handleClick = (e) => {
          const el = e.target;
          const chordName = el.innerText.trim();
          const parsed = parseChord(chordName);
          let posData = null;
          
          if (chordDb && chordDb.chords[parsed.key]) {
              const variations = chordDb.chords[parsed.key];
              const def = variations.find(v => v.suffix === parsed.suffix);
              if (def && def.positions) posData = def.positions[0];
          }
          
          if (posData) {
              setSelectedChordSvg({ name: chordName, svg: renderSVGChord(posData, chordName) });
          } else {
              setSelectedChordSvg(null);
          }
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
  }, [displayContent, chordDb]);

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

  // Follow the video: map its progress onto the chord sheet. If the user moves the
  // sheet while it plays, wait until they let go and keep that position as an offset.
  useEffect(() => {
    const scroller = viewerRef.current;
    const sheet = contentRef.current;
    if (!syncing || !isScrolling || !scroller || !sheet) return;

    let frame;
    let pos = scroller.scrollTop; // where we last put the sheet
    let holdUntil = 0;
    const tick = (now) => {
      frame = requestAnimationFrame(tick);
      const player = playerRef.current;
      if (!player.duration) return;

      if (Math.abs(scroller.scrollTop - pos) > 2) { // moved by hand
        pos = scroller.scrollTop;
        holdUntil = now + 1000;
        return;
      }
      if (now < holdUntil) return;

      const elapsed = player.state === 1 ? (now - player.stamp) / 1000 * player.rate : 0;
      const progress = Math.min(Math.max((player.time + elapsed) / player.duration, 0), 1);
      const sheetTop = sheet.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const base = sheetTop + progress * sheet.offsetHeight - scroller.clientHeight * READING_LINE;
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
    return () => cancelAnimationFrame(frame);
  }, [syncing, isScrolling, loading]);

  const toggleScroll = () => {
    if (syncing) {
      const playing = [1, 3].includes(playerRef.current.state); // playing or buffering
      sendPlayerCommand(playing ? 'pauseVideo' : 'playVideo');
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
      if (transposeDelta === 0) return 'Tono Original';
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

  return (
    <div 
      id="song-viewer" 
      className={`${song.theme ? `theme-${song.theme.toLowerCase()}` : ''} ${showYoutube ? 'with-youtube' : ''}`}
      style={{
        '--active-mood-color': song.mood ? (MOODS_CONFIG[song.mood]?.color || '#ffffff') : 'var(--primary)',
        '--active-mood-rgb': song.mood ? (MOODS_CONFIG[song.mood]?.rgb || '255,255,255') : '0,242,255'
      }}
    >
      <div className="thematic-pattern" style={{ opacity: 0.07, zIndex: 0 }}></div>
      
      <div className={`viewer-left-panel ${selectedChordSvg ? 'with-selected-chord' : ''}`}>
        <div className="chords-scroll-container" ref={viewerRef}>
          <div className="chords-content-wrapper" style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1rem', position: 'relative', zIndex: 2 }}>
            <div className="viewer-header">
              <div>
                <h2 id="viewer-title">{song.title}</h2>
                {song.folder !== 'Otros' && <div className="viewer-artist">{song.folder}</div>}
              </div>
              
              <div className="viewer-controls">
                {/* YouTube Toggle Button (without the local server, only for songs that have tracks) */}
                {!loadingTracks && (backingTracks || API_URL) && (
                  <button 
                    onClick={() => setShowYoutube(!showYoutube)} 
                    className={`btn ${showYoutube ? 'btn-primary' : ''}`}
                    style={{ 
                      background: showYoutube ? 'rgba(255, 0, 122, 0.2)' : 'var(--glass)', 
                      color: showYoutube ? 'var(--accent)' : 'white',
                      borderColor: showYoutube ? 'var(--accent)' : 'var(--glass-border)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                    title="Pistas oficiales de acompañamiento"
                    aria-label={showYoutube ? 'Ocultar pista' : 'Mostrar pista'}
                  >
                    <i className="fab fa-youtube" style={{ color: showYoutube ? 'var(--accent)' : '#ff0000' }}></i>
                    <span className="btn-label">{showYoutube ? 'Pista Activa' : 'Acompañar'}</span>
                  </button>
                )}

                <div className="transpose-controls" style={{ display: 'flex', alignItems: 'center', background: 'var(--glass)', borderRadius: '20px', padding: '0.2rem 0.5rem', border: '1px solid var(--glass-border)' }}>
                  <button onClick={() => setTransposeDelta(p => p - 1)} className="btn-icon" style={{ width: '30px', height: '30px', fontSize: '0.9rem' }} title="Bajar medio tono">
                      <i className="fas fa-minus"></i>
                  </button>
                  <div style={{ minWidth: '80px', textAlign: 'center', fontSize: '0.85rem', fontWeight: 'bold', color: transposeDelta !== 0 ? 'var(--active-mood-color, var(--primary))' : 'var(--text-main)' }}>
                      {getTransposeLabel()}
                  </div>
                  <button onClick={() => setTransposeDelta(p => p + 1)} className="btn-icon" style={{ width: '30px', height: '30px', fontSize: '0.9rem' }} title="Subir medio tono">
                      <i className="fas fa-plus"></i>
                  </button>
                  {transposeDelta !== 0 && (
                      <button onClick={() => setTransposeDelta(0)} className="btn-icon" style={{ width: '30px', height: '30px', fontSize: '0.9rem', color: 'var(--accent)' }} title="Restablecer">
                          <i className="fas fa-undo"></i>
                      </button>
                  )}
                </div>

                <div className="font-controls">
                  <button onClick={() => changeFontScale(-1)} className="btn-icon" title="Letra más chica" aria-label="Letra más chica">A−</button>
                  <button onClick={() => changeFontScale(1)} className="btn-icon" title="Letra más grande" aria-label="Letra más grande">A+</button>
                </div>

                <button onClick={onClose} className="btn" style={{ background: 'var(--glass)', color: 'white' }} aria-label="Cerrar">
                  <i className="fas fa-times"></i> <span className="btn-label">Cerrar</span>
                </button>
              </div>
            </div>
            
            {loading && <div style={{ textAlign: 'center', padding: '3rem' }}><i className="fas fa-spinner fa-spin fa-3x"></i><br/><br/>Cargando acordes...</div>}
            
            {error && <div style={{ color: 'var(--active-mood-color, var(--primary))', padding: '2rem' }}>{error}</div>}
            
            {!loading && !error && (
              <>
                <div id="diagrams-container" className="diagrams-scroll">
                  {diagrams.map((d, i) => (
                    <div key={i} className="diagram-item animate-in" dangerouslySetInnerHTML={{ __html: d.svg }} />
                  ))}
                </div>
                <div id="viewer-content" ref={contentRef} style={{ '--sheet-scale': fontScale }}>
                  <pre className="chord-sheet" dangerouslySetInnerHTML={{ __html: displayContent }}></pre>
                </div>
              </>
            )}
          </div>
        </div>

        {selectedChordSvg && (
          <div className="selected-chord-panel animate-in">
             <div style={{ color: 'var(--active-mood-color, var(--primary))', fontWeight: 'bold', fontSize: '1.5rem', letterSpacing: '1px' }}>{selectedChordSvg.name}</div>
             <div dangerouslySetInnerHTML={{ __html: selectedChordSvg.svg }} style={{ transform: 'scale(1.2)', transformOrigin: 'center' }} />
             <button onClick={() => setSelectedChordSvg(null)} className="btn-icon" style={{background: 'var(--glass)', width: '40px', height: '40px'}}>
                 <i className="fas fa-times"></i>
             </button>
          </div>
        )}
      </div>

      {/* YouTube Sidebar */}
      {showYoutube && (
        <div className="viewer-right-panel animate-in">
          <div className="youtube-sidebar-header">
            <h3><i className="fab fa-youtube" style={{ color: '#ff0000', marginRight: '8px' }}></i>Acompañamiento</h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              {API_URL && (
              <button
                onClick={() => {
                  if (!isSearching) {
                    setSearchQuery(defaultQuery);
                    setIsSearching(true);
                  } else {
                    setIsSearching(false);
                  }
                }}
                className={`btn-icon ${isSearching ? 'active' : ''}`}
                title="Buscar otro video de YouTube"
                style={{ width: '32px', height: '32px', fontSize: '0.9rem', color: isSearching ? 'var(--primary)' : 'white', background: isSearching ? 'rgba(0, 242, 255, 0.1)' : 'transparent', border: 'none', borderRadius: '50%', cursor: 'pointer' }}
              >
                <i className="fas fa-search"></i>
              </button>
              )}
              <button onClick={() => setShowYoutube(false)} className="btn-icon" title="Ocultar panel" style={{ width: '32px', height: '32px', border: 'none', background: 'transparent', color: 'white', cursor: 'pointer' }}>
                <i className="fas fa-chevron-right"></i>
              </button>
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
                              style={{ padding: '2px 8px', fontSize: '0.7rem', background: 'var(--accent)', color: 'white', borderRadius: '8px', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}
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
                        src={`https://www.youtube.com/embed/${activeVideoId}?enablejsapi=1&origin=${window.location.origin}`}
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
                          onClick={() => isAvailable && setActiveVideoId(trackInfo.id)}
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

      {!loading && !error && (
        <div id="autoscroll-controls" className="autoscroll-panel">
          {hasVideo && (
            <button
              onClick={toggleSync}
              className={`btn-icon ${syncWithVideo ? 'sync-on' : ''}`}
              aria-pressed={syncWithVideo}
              title={syncWithVideo ? 'La hoja sigue al video · clic para velocidad fija' : 'Velocidad fija · clic para que la hoja siga al video'}
            >
              <i className="fas fa-link"></i>
            </button>
          )}
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
