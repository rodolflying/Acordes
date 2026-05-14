import React, { useState, useEffect, useRef } from 'react';
import { parseChord, renderSVGChord, transposeChord } from './ChordUtils';

const SongViewer = ({ song, onClose, chordDb }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [content, setContent] = useState('');
  const [displayContent, setDisplayContent] = useState('');
  const [transposeDelta, setTransposeDelta] = useState(0);
  const [diagrams, setDiagrams] = useState([]);
  const [selectedChordSvg, setSelectedChordSvg] = useState(null);
  
  const [scrollSpeed, setScrollSpeed] = useState(1);
  const [isScrolling, setIsScrolling] = useState(false);
  const viewerRef = useRef(null);
  const scrollIntervalRef = useRef(null);
  const contentRef = useRef(null);

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
          viewerRef.current.scrollTop += (scrollSpeed * 0.5);
        }
      }, 50);
    } else {
      clearInterval(scrollIntervalRef.current);
    }
    return () => clearInterval(scrollIntervalRef.current);
  }, [isScrolling, scrollSpeed]);

  const toggleScroll = () => setIsScrolling(!isScrolling);
  const updateSpeed = (delta) => {
    setScrollSpeed(prev => {
      let next = prev + delta;
      if (next < 0.5) next = 0.5;
      if (next > 10) next = 10;
      return next;
    });
  };

  const displaySpeed = scrollSpeed % 1 === 0 ? scrollSpeed : scrollSpeed.toFixed(1);

  const getTransposeLabel = () => {
      if (transposeDelta === 0) return 'Tono Original';
      return transposeDelta > 0 ? `+${transposeDelta}` : `${transposeDelta}`;
  };
  return (
    <div id="song-viewer" ref={viewerRef} style={{ display: 'block', position: 'fixed', inset: 0, background: 'var(--bg-dark)', zIndex: 2000, overflowY: 'auto' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem' }}>
        <div className="viewer-header">
          <h2 id="viewer-title">{song.title}</h2>
          
          <div className="viewer-controls">
            <div className="transpose-controls" style={{ display: 'flex', alignItems: 'center', background: 'var(--glass)', borderRadius: '20px', padding: '0.2rem 0.5rem', border: '1px solid var(--glass-border)' }}>
              <button onClick={() => setTransposeDelta(p => p - 1)} className="btn-icon" style={{ width: '30px', height: '30px', fontSize: '0.9rem' }} title="Bajar medio tono">
                  <i className="fas fa-minus"></i>
              </button>
              <div style={{ minWidth: '80px', textAlign: 'center', fontSize: '0.85rem', fontWeight: 'bold', color: transposeDelta !== 0 ? 'var(--primary)' : 'var(--text-main)' }}>
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
        
        {error && <div style={{ color: 'var(--primary)', padding: '2rem' }}>{error}</div>}
        
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
      
      {!loading && !error && (
        <div id="autoscroll-controls" className="autoscroll-panel">
          <button onClick={() => updateSpeed(-0.5)} className="btn-icon"><i className="fas fa-minus"></i></button>
          <button onClick={toggleScroll} className="btn-primary" style={{ borderRadius: '20px', padding: '0.5rem 1rem' }}>
            {isScrolling ? <><i className="fas fa-pause"></i> Pausar</> : <><i className="fas fa-play"></i> Auto-Scroll</>}
          </button>
          <button onClick={() => updateSpeed(0.5)} className="btn-icon"><i className="fas fa-plus"></i></button>
          <div id="scroll-speed-display">x{displaySpeed}</div>
        </div>
      )}

      {selectedChordSvg && (
        <div className="selected-chord-panel">
           <div style={{ color: 'var(--primary)', fontWeight: 'bold', fontSize: '1.5rem', letterSpacing: '1px' }}>{selectedChordSvg.name}</div>
           <div dangerouslySetInnerHTML={{ __html: selectedChordSvg.svg }} style={{ transform: 'scale(1.2)', transformOrigin: 'center' }} />
           <button onClick={() => setSelectedChordSvg(null)} className="btn-icon" style={{background: 'var(--glass)', width: '40px', height: '40px'}}>
               <i className="fas fa-times"></i>
           </button>
        </div>
      )}
    </div>
  );
};

export default SongViewer;
