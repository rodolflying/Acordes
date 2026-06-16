import React, { useState, useEffect, useMemo, Suspense } from 'react';
import CelestialIcon from './CelestialIcon';
import './index.css';

const ThreeBackground = React.lazy(() => import('./ThreeBackground'));
const SongViewer = React.lazy(() => import('./SongViewer'));
const DashboardModal = React.lazy(() => import('./DashboardModal'));

const MOODS_CONFIG = {
  "Romántico": { emoji: "💕", color: "#ff007a", rgb: "255, 0, 122" },
  "Melancólico": { emoji: "🌙", color: "#5e60ce", rgb: "94, 96, 206" },
  "Reflexivo": { emoji: "🔮", color: "#00f2ff", rgb: "0, 242, 255" },
  "Enérgico": { emoji: "⚡", color: "#ffb703", rgb: "255, 183, 3" },
  "Alegre": { emoji: "☀️", color: "#ff7096", rgb: "255, 112, 150" },
  "Épico": { emoji: "🔥", color: "#ff003c", rgb: "255, 0, 60" },
  "Nostálgico": { emoji: "🌅", color: "#f26419", rgb: "242, 100, 25" }
};

const THEMES_CONFIG = {
  "Desamor": { emoji: "💔" },
  "Amor": { emoji: "❤️" },
  "Libertad": { emoji: "🕊️" },
  "Existencial": { emoji: "🌀" },
  "Fiesta": { emoji: "🎉" },
  "Protesta": { emoji: "✊" },
  "Naturaleza": { emoji: "🌿" },
  "Cotidiano": { emoji: "🏠" }
};

const detectSource = (url) => {
    if (url.includes('cifraclub.com') || url.includes('cifraclub.com.br')) return 'Cifra Club';
    if (url.includes('lacuerda.net')) return 'LaCuerda';
    if (url.includes('ukulele-tabs.com')) return 'Uku-Tabs';
    if (url.includes('ultimate-guitar.com')) return 'Ultimate Guitar';
    if (url.includes('chordify.net')) return 'Chordify';
    return 'Web';
};

const extractArtist = (title, source) => {
    try {
        if (source === 'Cifra Club') {
            const parts = title.split('-');
            if (parts.length >= 3) {
                return parts[parts.length - 2].trim();
            } else if (parts.length === 2) {
                return parts[1].trim();
            }
        } else if (source === 'LaCuerda') {
            const match = title.match(/,\s*(.+?):/);
            if (match && match[1]) {
                return match[1].trim();
            }
        } else if (source === 'Uku-Tabs') {
            const match = title.match(/by\s+(.+?)\s+-/);
            if (match && match[1]) {
                return match[1].trim();
            }
        }
    } catch(e) {}
    
    return 'Otros';
};

const processData = (node, songs = []) => {
    if (node.type === 'url') {
        const source = detectSource(node.url);
        const artist = extractArtist(node.name, source);
        
        songs.push({
            title: node.name,
            url: node.url,
            folder: artist,
            source: source
        });
    } else if (node.children) {
        node.children.forEach(child => processData(child, songs));
    }
    return songs;
};

function App() {
  const [allSongs, setAllSongs] = useState([]);
  const [folders, setFolders] = useState(['all']);
  const [currentFilter, setCurrentFilter] = useState('all');
  const [activeMood, setActiveMood] = useState(null);
  const [activeTheme, setActiveTheme] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [chordDb, setChordDb] = useState(null);
  const [showDashboard, setShowDashboard] = useState(false);
  
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null); // 'success', 'error', null
  
  const [selectedSong, setSelectedSong] = useState(null);
  const [randomModal, setRandomModal] = useState(null); // contains random song obj
  const [backingTracksDict, setBackingTracksDict] = useState({});
  const [filterHasBackingTrack, setFilterHasBackingTrack] = useState(false);
  const [performanceMode, setPerformanceMode] = useState(() => {
    return localStorage.getItem('performanceMode') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('performanceMode', performanceMode);
  }, [performanceMode]);

  const normalizeString = (s) => {
    if (!s) return "";
    return s.toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9\s]/g, "")
            .replace(/\s+/g, " ")
            .trim();
  };

  const songHasBackingTrack = (song) => {
    return !!backingTracksDict[song.url];
  };

  const loadData = async () => {
    try {
        const response = await fetch('./songs.json');
        const data = await response.json();
        
        let enrichedData = { songs: {} };
        try {
            const enrichedRes = await fetch('./enriched_songs.json');
            enrichedData = await enrichedRes.json();
        } catch (e) {
            console.log('No se pudo cargar la metadata enriquecida, usando datos básicos.');
        }

        try {
            const dbRes = await fetch('./chords_db.json');
            setChordDb(await dbRes.json());
        } catch(e) {
            console.log('No se pudo cargar la base de datos de acordes');
        }

        const rawSongs = processData(data);
        
        // Normalize folder names case-insensitively
        const folderMap = new Map();
        rawSongs.forEach(song => {
            if (song.folder && song.folder !== 'Otros') {
                const lower = song.folder.toLowerCase();
                if (!folderMap.has(lower)) {
                    folderMap.set(lower, song.folder);
                } else {
                    const existing = folderMap.get(lower);
                    if (existing === lower && song.folder !== lower) {
                        folderMap.set(lower, song.folder);
                    }
                }
            }
        });
        
        rawSongs.forEach(song => {
            if (song.folder && song.folder !== 'Otros') {
                song.folder = folderMap.get(song.folder.toLowerCase());
            }
        });

        // Merge enriched data
        const mergedSongs = rawSongs.map(song => {
            const enriched = enrichedData.songs[song.url] || {};
            return {
                ...song,
                mood: enriched.mood || null,
                mood_emoji: enriched.mood_emoji || null,
                theme: enriched.theme || null,
                theme_emoji: enriched.theme_emoji || null,
                energy: enriched.energy || null,
                year: enriched.year || null,
                genre: enriched.genre || null,
                youtube_video: enriched.youtube_video || null,
                clean_artist: enriched.artist || null,
                clean_title: enriched.title || null,
            };
        });

        setAllSongs(mergedSongs);
        
        const fSet = new Set();
        mergedSongs.forEach(song => {
            if (song.folder && song.folder !== 'Otros') {
                fSet.add(song.folder);
            }
        });
        
        // Agregar 'Otros' al final si existe alguna canción en esa categoría
        const hasOthers = mergedSongs.some(s => s.folder === 'Otros');
        const foldersArray = Array.from(fSet).sort((a, b) => a.localeCompare(b, undefined, {sensitivity: 'base'}));
        if (hasOthers) foldersArray.push('Otros');
        
        setFolders(['all', ...foldersArray]);
    } catch (error) {
        console.error('Error cargando canciones:', error);
    }
  };

  const loadBackingTracksList = async () => {
    try {
      const res = await fetch('./backing_tracks.json');
      if (res.ok) {
        const data = await res.json();
        setBackingTracksDict(data.backing_tracks || {});
      }
    } catch(e) {
      console.log("No se pudo cargar la lista de backing tracks estáticos");
    }
  };

  useEffect(() => {
    loadData();
    loadBackingTracksList();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setSyncStatus(null);
    try {
      const response = await fetch('http://127.0.0.1:8001/api/refresh', { method: 'POST' });
      if (response.ok) {
        await loadData();
        setSyncStatus('success');
      } else {
        setSyncStatus('error');
      }
    } catch (err) {
      console.error(err);
      setSyncStatus('error');
    } finally {
      setTimeout(() => setSyncStatus(null), 2000);
      setSyncing(false);
    }
  };

  const handleRandom = () => {
    if (allSongs.length > 0) {
      const randomSong = allSongs[Math.floor(Math.random() * allSongs.length)];
      setRandomModal(randomSong);
    }
  };

  const filteredSongs = useMemo(() => {
    return allSongs.filter(song => {
      const hasSearch = searchQuery.trim() !== '';
      const matchesSearch = song.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           song.folder.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           song.source.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           (song.mood && song.mood.toLowerCase().includes(searchQuery.toLowerCase())) ||
                           (song.theme && song.theme.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesFolder = hasSearch ? true : (currentFilter === 'all' || song.folder === currentFilter);
      const matchesMood = activeMood === null || song.mood === activeMood;
      const matchesTheme = activeTheme === null || song.theme === activeTheme;
      const matchesBackingTrack = !filterHasBackingTrack || songHasBackingTrack(song);
      
      return matchesSearch && matchesFolder && matchesMood && matchesTheme && matchesBackingTrack;
    });
  }, [allSongs, searchQuery, currentFilter, activeMood, activeTheme, filterHasBackingTrack, backingTracksDict]);

  const stats = useMemo(() => {
    if (!allSongs.length) return null;
    
    const total = allSongs.length;
    
    // Moods distribution
    const moodsCount = {};
    Object.keys(MOODS_CONFIG).forEach(m => { moodsCount[m] = 0; });
    moodsCount['Sin clasificar'] = 0;
    
    // Themes distribution
    const themesCount = {};
    Object.keys(THEMES_CONFIG).forEach(t => { themesCount[t] = 0; });
    themesCount['Sin clasificar'] = 0;
    
    // Sources distribution
    const sourcesCount = {};
    
    // Energy distribution
    const energyCount = { 'Alta': 0, 'Media': 0, 'Baja': 0, 'Sin clasificar': 0 };
    
    // Folders (Artists) distribution
    const foldersCount = {};
    
    // Decades distribution
    const decadesCount = {};
    
    allSongs.forEach(song => {
        // Mood
        if (song.mood && MOODS_CONFIG[song.mood]) {
            moodsCount[song.mood]++;
        } else {
            moodsCount['Sin clasificar']++;
        }
        
        // Theme
        if (song.theme && THEMES_CONFIG[song.theme]) {
            themesCount[song.theme]++;
        } else {
            themesCount['Sin clasificar']++;
        }
        
        // Source
        const source = song.source || 'Otros';
        sourcesCount[source] = (sourcesCount[source] || 0) + 1;
        
        // Energy
        const energy = song.energy || 'Sin clasificar';
        if (energyCount[energy] !== undefined) {
            energyCount[energy]++;
        } else {
            energyCount['Sin clasificar']++;
        }
        
        // Folder (Artist)
        const folder = song.folder || 'Otros';
        foldersCount[folder] = (foldersCount[folder] || 0) + 1;
        
        // Year / Decade
        if (song.year) {
            const yearNum = parseInt(song.year);
            if (!isNaN(yearNum) && yearNum > 1900 && yearNum < 2100) {
                const decadeStart = Math.floor(yearNum / 10) * 10;
                const decadeLabel = `${decadeStart}s`;
                decadesCount[decadeLabel] = (decadesCount[decadeLabel] || 0) + 1;
            } else {
                decadesCount['Sin año'] = (decadesCount['Sin año'] || 0) + 1;
            }
        } else {
            decadesCount['Sin año'] = (decadesCount['Sin año'] || 0) + 1;
        }
    });
    
    // Convert to sorted lists
    const moodsArray = Object.entries(moodsCount)
        .map(([name, count]) => ({
            name,
            count,
            percentage: total > 0 ? Math.round((count / total) * 100) : 0,
            color: MOODS_CONFIG[name]?.color || 'var(--text-muted)',
            emoji: MOODS_CONFIG[name]?.emoji || '❓'
        }))
        .filter(m => m.count > 0 || m.name !== 'Sin clasificar') // hide unclassified if 0
        .sort((a, b) => b.count - a.count);
        
    const themesArray = Object.entries(themesCount)
        .map(([name, count]) => ({
            name,
            count,
            percentage: total > 0 ? Math.round((count / total) * 100) : 0,
            emoji: THEMES_CONFIG[name]?.emoji || '❓'
        }))
        .filter(t => t.count > 0 || t.name !== 'Sin clasificar')
        .sort((a, b) => b.count - a.count);
        
    const sourcesArray = Object.entries(sourcesCount)
        .map(([name, count]) => ({
            name,
            count,
            percentage: total > 0 ? Math.round((count / total) * 100) : 0
        }))
        .sort((a, b) => b.count - a.count);
        
    const energyArray = Object.entries(energyCount)
        .map(([name, count]) => ({
            name,
            count,
            percentage: total > 0 ? Math.round((count / total) * 100) : 0
        }))
        .filter(e => e.count > 0 || e.name !== 'Sin clasificar');
        
    const topFolders = Object.entries(foldersCount)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
        
    const decadesArray = Object.entries(decadesCount)
        .map(([name, count]) => ({
            name,
            count,
            percentage: total > 0 ? Math.round((count / total) * 100) : 0
        }))
        .sort((a, b) => {
            if (a.name === 'Sin año') return 1;
            if (b.name === 'Sin año') return -1;
            return a.name.localeCompare(b.name);
        });
        
    const dominantMood = moodsArray.find(m => m.name !== 'Sin clasificar') || moodsArray[0];
    const dominantTheme = themesArray.find(t => t.name !== 'Sin clasificar') || themesArray[0];
    const uniqueFoldersCount = Object.keys(foldersCount).length;
        
    return {
        total,
        moods: moodsArray,
        themes: themesArray,
        sources: sourcesArray,
        energy: energyArray,
        topFolders,
        decades: decadesArray,
        dominantMood,
        dominantTheme,
        uniqueFoldersCount
    };
  }, [allSongs]);

  const handleOpenSong = (song) => {
    if (song.source !== 'Cifra Club' && song.source !== 'LaCuerda') {
      window.open(song.url, '_blank');
    } else {
      setSelectedSong(song);
    }
  };

  return (
    <>
      {!selectedSong && !performanceMode && (
        <Suspense fallback={<div className="three-placeholder" />}>
          <ThreeBackground />
        </Suspense>
      )}
      <div id="app" className={performanceMode ? 'no-animations' : ''}>
        <aside>
            <div className="logo-container">
                <div className="logo-icon">
                    <i className="fas fa-music"></i>
                </div>
                <h2>Musica</h2>
            </div>
            
            <nav>
                <div style={{marginTop: '2rem', marginBottom: '1rem', fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '700', letterSpacing: '1px'}}>
                    Carpetas
                </div>
                <ul className="folder-list">
                    {folders.map(folder => (
                      <li 
                        key={folder}
                        className={`folder-item ${currentFilter === folder ? 'active' : ''}`} 
                        onClick={() => {
                          setCurrentFilter(folder);
                          setActiveMood(null); // Reset filters on folder change to prevent empty states
                          setActiveTheme(null);
                        }}
                      >
                          <i className={`fas ${folder === 'all' ? 'fa-th-large' : 'fa-folder'}`}></i>
                          {folder === 'all' ? 'Todas' : folder}
                      </li>
                    ))}
                </ul>
            </nav>
        </aside>

        <main>
            <header>
                <div className="search-container">
                    <i className="fas fa-search search-icon"></i>
                    <input 
                      id="search"
                      type="text" 
                      placeholder="Busca por canción, artista, mood o sitio..." 
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                      <i 
                        className="fas fa-times clear-icon" 
                        onClick={() => setSearchQuery('')}
                        title="Borrar búsqueda"
                      ></i>
                    )}
                </div>
                <div className="actions" style={{display: 'flex', gap: '0.5rem'}}>
                    <button 
                      className={`btn ${performanceMode ? 'btn-active' : ''}`}
                      style={{
                        background: performanceMode ? 'rgba(255, 183, 3, 0.2)' : 'var(--glass)', 
                        color: performanceMode ? '#ffb703' : 'white',
                        borderColor: performanceMode ? '#ffb703' : 'var(--glass-border)',
                      }}
                      onClick={() => setPerformanceMode(!performanceMode)}
                      title={performanceMode ? "Activar animaciones" : "Desactivar animaciones para mejorar rendimiento"}
                    >
                        <i className={`fas ${performanceMode ? 'fa-bolt' : 'fa-film'}`} style={{ color: performanceMode ? '#ffb703' : 'white' }}></i>
                        {performanceMode ? 'Modo Rápido' : 'Animaciones'}
                    </button>
                    <button 
                      className="btn btn-primary" 
                      style={{background: 'var(--glass)', color: 'white'}}
                      onClick={handleSync}
                      disabled={syncing}
                    >
                        {syncing ? <><i className="fas fa-spinner fa-spin"></i> Sincronizando...</> : 
                         syncStatus === 'success' ? <><i className="fas fa-check"></i> ¡Listo!</> :
                         syncStatus === 'error' ? <><i className="fas fa-times"></i> Error</> :
                         <><i className="fas fa-sync-alt"></i> Sincronizar</>}
                    </button>
                    <button 
                      className="btn btn-primary" 
                      style={{background: 'var(--glass)', color: 'white'}}
                      onClick={() => setShowDashboard(true)}
                    >
                        <i className="fas fa-chart-pie"></i>
                        Análisis
                    </button>
                    <button className="btn btn-primary" onClick={handleRandom}>
                        <i className="fas fa-shuffle"></i>
                        ¿Qué cantar?
                    </button>
                </div>
            </header>

            {/* Filter buttons */}
            <div className="filters-container">
                <div className="filter-row">
                    <span className="filter-label">MOOD</span>
                    <div className="filter-buttons">
                        {Object.entries(MOODS_CONFIG).map(([moodName, config]) => (
                            <button
                                key={moodName}
                                className={`filter-tag mood-btn ${activeMood === moodName ? 'active' : ''}`}
                                onClick={() => setActiveMood(activeMood === moodName ? null : moodName)}
                                style={{
                                    '--mood-color': config.color,
                                    borderColor: activeMood === moodName ? config.color : 'var(--glass-border)',
                                    background: activeMood === moodName ? `rgba(${config.rgb}, 0.15)` : 'var(--glass)',
                                    color: activeMood === moodName ? config.color : 'var(--text-muted)'
                                }}
                            >
                                <span className="filter-emoji">{config.emoji}</span> {moodName}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="filter-row" style={{ marginTop: '0.8rem' }}>
                    <span className="filter-label">TEMÁTICA</span>
                    <div className="filter-buttons">
                        {Object.entries(THEMES_CONFIG).map(([themeName, config]) => (
                            <button
                                key={themeName}
                                className={`filter-tag theme-btn ${activeTheme === themeName ? 'active' : ''}`}
                                onClick={() => setActiveTheme(activeTheme === themeName ? null : themeName)}
                                style={{
                                    borderColor: activeTheme === themeName ? 'var(--primary)' : 'var(--glass-border)',
                                    background: activeTheme === themeName ? 'rgba(0, 242, 255, 0.15)' : 'var(--glass)',
                                    color: activeTheme === themeName ? 'var(--primary)' : 'var(--text-muted)'
                                }}
                            >
                                <span className="filter-emoji">{config.emoji}</span> {themeName}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="filter-row" style={{ marginTop: '0.8rem' }}>
                    <span className="filter-label">PISTAS</span>
                    <div className="filter-buttons">
                        <button
                            className={`filter-tag ${filterHasBackingTrack ? 'active' : ''}`}
                            onClick={() => setFilterHasBackingTrack(!filterHasBackingTrack)}
                            style={{
                                borderColor: filterHasBackingTrack ? 'var(--accent)' : 'var(--glass-border)',
                                background: filterHasBackingTrack ? 'rgba(255, 0, 122, 0.15)' : 'var(--glass)',
                                color: filterHasBackingTrack ? 'var(--accent)' : 'var(--text-muted)',
                                fontWeight: '700'
                            }}
                        >
                            <span className="filter-emoji">🎤</span> Solo con Pista Oficial
                        </button>
                    </div>
                </div>
            </div>

            <div style={{marginBottom: '1.5rem', color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '1.5rem'}}>
                Mostrando <span style={{color: 'var(--text-main)', fontWeight: '600'}}>{filteredSongs.length}</span> canciones
            </div>

            <div className="song-grid">
                {filteredSongs.map((song, index) => (
                  <div 
                    key={index} 
                    className={`song-card animate-in ${song.theme ? `theme-${song.theme.toLowerCase()}` : ''}`} 
                    style={{
                      animationDelay: `${Math.min(index * 0.05, 1)}s`,
                      '--active-mood-color': song.mood ? (MOODS_CONFIG[song.mood]?.color || '#ffffff') : 'var(--primary)',
                      '--active-mood-rgb': song.mood ? (MOODS_CONFIG[song.mood]?.rgb || '255,255,255') : '0,242,255'
                    }}
                    onClick={() => handleOpenSong(song)}
                  >
                      {/* Background Thematic Pattern */}
                      <div className="thematic-pattern"></div>

                      {/* 3D Celestial floating element */}
                      <div className="celestial-container">
                          <CelestialIcon mood={song.mood} />
                      </div>

                      <div className="card-main-content">
                          <div className="song-source">{song.source}</div>
                          <div className="song-title">{song.title}</div>
                          <div className="song-artist">{song.folder}</div>
                      </div>

                      <div className="card-footer">
                          <div className="card-badges">
                              {songHasBackingTrack(song) && (
                                  <span className="backing-track-badge" title="Pistas oficiales disponibles">
                                      <i className="fab fa-youtube" style={{ color: 'var(--accent)', marginRight: '4px' }}></i>
                                      Pista
                                  </span>
                              )}
                              {song.mood && (
                                  <span 
                                      className="mood-badge"
                                      style={{
                                          color: MOODS_CONFIG[song.mood]?.color || 'white',
                                          background: `rgba(${MOODS_CONFIG[song.mood]?.rgb || '255,255,255'}, 0.1)`,
                                          borderColor: `rgba(${MOODS_CONFIG[song.mood]?.rgb || '255,255,255'}, 0.2)`
                                      }}
                                  >
                                      <span className="badge-emoji">{MOODS_CONFIG[song.mood]?.emoji}</span>
                                      {song.mood}
                                  </span>
                              )}
                              {song.theme && (
                                  <span className="theme-badge">
                                      <span className="badge-emoji">{THEMES_CONFIG[song.theme]?.emoji}</span>
                                      {song.theme}
                                  </span>
                              )}
                          </div>
                          
                          <div className="card-actions">
                              {(song.source === 'Cifra Club' || song.source === 'LaCuerda') && (
                                  <i className="fas fa-volume-up play-indicator" title="Visualizador local disponible"></i>
                              )}
                              <i className="fas fa-external-link-alt external-link" title="Abrir en pestaña nueva" onClick={(e) => { e.stopPropagation(); window.open(song.url, '_blank'); }}></i>
                          </div>
                      </div>
                  </div>
                ))}
            </div>
        </main>
      </div>

      {randomModal && (
        <div style={{position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)', zIndex: 1000, display: 'grid', placeItems: 'center'}}>
            <div className="song-card" style={{width: '400px', padding: '3rem', textAlign: 'center'}}>
                <div style={{fontSize: '0.9rem', color: 'var(--primary)', marginBottom: '1rem', fontWeight: '700', textTransform: 'uppercase'}}>¡Hoy deberías cantar!</div>
                <div className="song-title" style={{fontSize: '2rem', marginBottom: '1.5rem'}}>{randomModal.title}</div>
                <div style={{display: 'flex', gap: '1rem', flexDirection: 'column'}}>
                    {(randomModal.source === 'Cifra Club' || randomModal.source === 'LaCuerda') && (
                      <button 
                        className="btn btn-primary" 
                        style={{justifyContent: 'center', width: '100%'}}
                        onClick={() => { setRandomModal(null); handleOpenSong(randomModal); }}
                      >
                          <i className="fas fa-eye"></i> Ver en mi página
                      </button>
                    )}
                    <a href={randomModal.url} target="_blank" rel="noreferrer" className="btn" style={{justifyContent: 'center', background: 'var(--glass)', color: 'white', width: '100%'}}>
                        <i className="fas fa-external-link-alt"></i> Ir a la fuente
                    </a>
                </div>
                <button onClick={() => setRandomModal(null)} style={{marginTop: '1.5rem', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.9rem'}}>
                  Tal vez luego
                </button>
            </div>
        </div>
      )}

      {selectedSong && (
        <Suspense fallback={
          <div className="viewer-loading-overlay">
            <div className="viewer-loading-card">
              <i className="fas fa-spinner fa-spin fa-2x" style={{color: 'var(--active-mood-color, var(--primary))'}}></i>
              <p style={{marginTop: '1rem', color: 'var(--text-muted)'}}>Cargando acordes...</p>
            </div>
          </div>
        }>
          <SongViewer 
            song={selectedSong} 
            chordDb={chordDb} 
            backingTracks={backingTracksDict[selectedSong.url]} 
            onClose={() => setSelectedSong(null)} 
          />
        </Suspense>
      )}

      {showDashboard && (
        <Suspense fallback={
          <div className="dashboard-overlay">
            <div className="dashboard-modal animate-modal" style={{justifyContent: 'center', alignItems: 'center', minHeight: '400px'}}>
              <i className="fas fa-spinner fa-spin fa-2x" style={{color: 'var(--primary)'}}></i>
              <p style={{marginTop: '1rem', color: 'var(--text-muted)', fontSize: '0.9rem'}}>Cargando estadísticas...</p>
            </div>
          </div>
        }>
          <DashboardModal stats={stats} onClose={() => setShowDashboard(false)} />
        </Suspense>
      )}
    </>
  );
}

export default App;
