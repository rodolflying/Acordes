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

const SongViewer = ({ song, onClose, chordDb }) => {
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

  // Fetch Backing Tracks matching this song from local uploader JSON
  useEffect(() => {
    const fetchTracks = async () => {
      setLoadingTracks(true);
      try {
        const artist = song.clean_artist || song.folder || '';
        const title = song.clean_title || song.title || '';
        const response = await fetch(`http://127.0.0.1:8001/api/song/backing_tracks?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`);
        
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
        console.error("Error fetching backing tracks:", err);
      } finally {
        setLoadingTracks(false);
      }
    };
    fetchTracks();
  }, [song]);

  // Reset scrolling on version switch
  useEffect(() => {
    setIsScrolling(false);
  }, [activeVideoId]);

  // YouTube Player synchronization using window messages
  useEffect(() => {
    const handleMessage = (event) => {
      if (event.origin !== 'https://www.youtube.com' && event.origin !== 'https://www.youtube-nocookie.com') {
        return;
      }
      
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data && data.event === 'infoDelivery' && data.info && data.info.playerState !== undefined) {
          const state = data.info.playerState;
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
            const response = await fetch(`http://127.0.0.1:8001/api/song?url=${encodeURIComponent(song.url)}`);
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
    if (isScrolling) {
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
  }, [isScrolling, scrollSpeedIndex]);

  const toggleScroll = () => setIsScrolling(!isScrolling);
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

  return (
    <div 
      id="song-viewer" 
      className={`${song.theme ? `theme-${song.theme.toLowerCase()}` : ''} ${showYoutube && backingTracks ? 'with-youtube' : ''}`}
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
              <h2 id="viewer-title">{song.title}</h2>
              
              <div className="viewer-controls">
                {/* YouTube Toggle Button (only displayed if backing tracks are loaded) */}
                {!loadingTracks && backingTracks && (
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
                  >
                    <i className="fab fa-youtube" style={{ color: showYoutube ? 'var(--accent)' : '#ff0000' }}></i> 
                    {showYoutube ? 'Pista Activa' : 'Acompañar'}
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

                <button onClick={onClose} className="btn" style={{ background: 'var(--glass)', color: 'white' }}>
                  <i className="fas fa-times"></i> Cerrar
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
                <div id="viewer-content" ref={contentRef}>
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
      {showYoutube && backingTracks && (
        <div className="viewer-right-panel animate-in">
          <div className="youtube-sidebar-header">
            <h3><i className="fab fa-youtube" style={{ color: '#ff0000', marginRight: '8px' }}></i>Acompañamiento</h3>
            <button onClick={() => setShowYoutube(false)} className="btn-icon" title="Ocultar panel">
              <i className="fas fa-chevron-right"></i>
            </button>
          </div>

          <div className="youtube-sidebar-content">
            {activeVideoId ? (
              <div className="youtube-player-container">
                <div className="youtube-player-wrapper">
                  <iframe 
                    key={activeVideoId}
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
          </div>
        </div>
      )}

      {!loading && !error && (
        <div id="autoscroll-controls" className="autoscroll-panel">
          <button onClick={() => updateSpeed(-1)} className="btn-icon"><i className="fas fa-minus"></i></button>
          <button onClick={toggleScroll} className="btn-primary" style={{ borderRadius: '20px', padding: '0.5rem 1rem' }}>
            {isScrolling ? <><i className="fas fa-pause"></i> Pausar</> : <><i className="fas fa-play"></i> Auto-Scroll</>}
          </button>
          <button onClick={() => updateSpeed(1)} className="btn-icon"><i className="fas fa-plus"></i></button>
          <div id="scroll-speed-display">x{displaySpeed}</div>
        </div>
      )}
    </div>
  );
};

export default SongViewer;
