import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import CelestialIcon from './CelestialIcon';
import { buildSongs, pickBest, isViewable } from './catalog';
import './index.css';

const ThreeBackground = React.lazy(() => import('./ThreeBackground'));
const SongViewer = React.lazy(() => import('./SongViewer'));
const DashboardModal = React.lazy(() => import('./DashboardModal'));

// Only defined in dev (client/.env.development); undefined in the GitHub Pages build
const API_URL = import.meta.env.VITE_API_URL;

// Where the site lives: '/' in dev, '/Acordes/' on GitHub Pages
const BASE = import.meta.env.BASE_URL;
const SITE_TITLE = 'Acordate · Acordes que siguen a tu video';

// Each song has its own address, /cancion/artista/titulo/ (see catalog.js)
const songPath = song => `${BASE}cancion/${song.slug}/`;
const slugInPath = () => {
  const path = window.location.pathname;
  const m = path.startsWith(BASE) && path.slice(BASE.length).match(/^cancion\/([^/]+\/[^/]+)\/?$/);
  return m ? m[1] : null;
};

const PAGE_SIZES = [24, 48, 96, Infinity]; // Infinity = all songs on one page

// Page numbers to show: first, last and the current page's neighbours, with gaps as '…'
const pageItems = (current, total) => {
  const items = [];
  for (let p = 1; p <= total; p++) {
    if (p === 1 || p === total || Math.abs(p - current) <= 1) items.push(p);
    else if (items[items.length - 1] !== '…') items.push('…');
  }
  return items;
};

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
  
  // The open song is the one in the address (/cancion/artista/titulo/), so a shared link opens it
  const [selectedSlug, setSelectedSlug] = useState(slugInPath);
  const [randomModal, setRandomModal] = useState(null); // contains random song obj
  const [backingTracksDict, setBackingTracksDict] = useState({});
  const [syncPointsDict, setSyncPointsDict] = useState({});
  const [filterHasBackingTrack, setFilterHasBackingTrack] = useState(false);
  const [performanceMode, setPerformanceMode] = useState(() => {
    return localStorage.getItem('performanceMode') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('performanceMode', performanceMode);
  }, [performanceMode]);

  const [pageSize, setPageSize] = useState(() => {
    return Number(localStorage.getItem('pageSize')) || PAGE_SIZES[0];
  });
  const [page, setPage] = useState(1);
  const resultsRef = useRef(null);
  const [filtersOpen, setFiltersOpen] = useState(false); // only matters on phones, where filters collapse

  useEffect(() => {
    localStorage.setItem('pageSize', pageSize);
  }, [pageSize]);

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
        const response = await fetch(`${BASE}songs.json`);
        const data = await response.json();
        
        let enrichedData = { songs: {} };
        try {
            const enrichedRes = await fetch(`${BASE}enriched_songs.json`);
            enrichedData = await enrichedRes.json();
        } catch (e) {
            console.log('No se pudo cargar la metadata enriquecida, usando datos básicos.');
        }

        try {
            const dbRes = await fetch(`${BASE}chords_db.json`);
            setChordDb(await dbRes.json());
        } catch(e) {
            console.log('No se pudo cargar la base de datos de acordes');
        }

        const mergedSongs = buildSongs(data, enrichedData.songs);

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
      const res = await fetch(`${BASE}backing_tracks.json`);
      if (res.ok) {
        const data = await res.json();
        setBackingTracksDict(data.backing_tracks || {});
      }
    } catch(e) {
      console.log("No se pudo cargar la lista de backing tracks estáticos");
    }
  };

  // Seconds at which each lyric line is sung (lyrics_sync.py), so the sheet follows the video line by line
  const loadSyncPoints = async () => {
    try {
      const res = await fetch(`${BASE}sync_points.json`);
      if (res.ok) setSyncPointsDict(await res.json());
    } catch(e) {
      console.log("No se pudieron cargar los tiempos de las letras");
    }
  };

  useEffect(() => {
    loadData();
    loadBackingTracksList();
    loadSyncPoints();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setSyncStatus(null);
    try {
      const response = await fetch(`${API_URL}/api/refresh`, { method: 'POST' });
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

  // One card per song (catalog.js)
  const songs = useMemo(() => pickBest(allSongs, backingTracksDict, syncPointsDict),
    [allSongs, backingTracksDict, syncPointsDict]);

  const handleRandom = () => {
    if (songs.length > 0) {
      const randomSong = songs[Math.floor(Math.random() * songs.length)];
      setRandomModal(randomSong);
    }
  };

  const filteredSongs = useMemo(() => {
    // Without accents or case: "angeles" finds "Ángeles", "fenix" finds "Fénix"
    const fold = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const query = fold(searchQuery.trim());
    return songs.filter(song => {
      const hasSearch = query !== '';
      const matchesSearch = [song.title, song.folder, song.source, song.mood, song.theme].some(field => fold(field).includes(query));
      
      const matchesFolder = hasSearch ? true : (currentFilter === 'all' || song.folder === currentFilter);
      const matchesMood = activeMood === null || song.mood === activeMood;
      const matchesTheme = activeTheme === null || song.theme === activeTheme;
      const matchesBackingTrack = !filterHasBackingTrack || songHasBackingTrack(song);
      
      return matchesSearch && matchesFolder && matchesMood && matchesTheme && matchesBackingTrack;
    });
  }, [songs, searchQuery, currentFilter, activeMood, activeTheme, filterHasBackingTrack, backingTracksDict]);

  // Back to the first page whenever the filters change the list
  const [pagedList, setPagedList] = useState(filteredSongs);
  if (pagedList !== filteredSongs) {
    setPagedList(filteredSongs);
    setPage(1);
  }
  const pageCount = Math.max(1, Math.ceil(filteredSongs.length / pageSize));
  const visibleSongs = pageCount === 1 ? filteredSongs : filteredSongs.slice((page - 1) * pageSize, page * pageSize);

  const goToPage = (p) => {
    setPage(p);
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const stats = useMemo(() => {
    if (!songs.length) return null;
    
    const total = songs.length;
    
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
    
    songs.forEach(song => {
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
  }, [songs]);

  const handleVideoLinked = (url, videoId, videoTitle) => {
    setBackingTracksDict(prev => ({
      ...prev,
      [url]: {
        "Karaoke": {
          "id": videoId,
          "title": videoTitle,
          "youtube_url": `https://www.youtube.com/watch?v=${videoId}`
        }
      }
    }));

    setAllSongs(prevSongs => prevSongs.map(song => {
      if (song.url === url) {
        return {
          ...song,
          youtube_video: {
            id: videoId,
            title: videoTitle
          }
        };
      }
      return song;
    }));
  };

  const selectedSong = selectedSlug ? songs.find(s => s.slug === selectedSlug) : null;

  const handleOpenSong = (song) => {
    if (!isViewable(song)) {
      window.open(song.url, '_blank');
    } else {
      setSelectedSlug(song.slug);
      window.history.pushState({ songOpen: true }, '', songPath(song));
    }
  };

  // Arriving from a shared link, "back" goes to the song list instead of leaving the site
  useEffect(() => {
    if (!selectedSlug || window.history.state?.songOpen) return;
    window.history.replaceState(null, '', BASE);
    window.history.pushState({ songOpen: true }, '', `${BASE}cancion/${selectedSlug}/`);
  }, []);

  // "Back" and "forward" follow the address
  useEffect(() => {
    const onPop = () => setSelectedSlug(slugInPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // An address with no song (renamed or removed) shows the list
  useEffect(() => {
    if (allSongs.length && selectedSlug && !allSongs.some(s => s.slug === selectedSlug)) {
      window.history.replaceState(null, '', BASE);
      setSelectedSlug(null);
    }
  }, [allSongs, selectedSlug]);

  useEffect(() => {
    document.title = selectedSong ? `${selectedSong.title} — ${selectedSong.folder} · Acordate` : SITE_TITLE;
  }, [selectedSong]);

  const closeSong = () => {
    if (window.history.state?.songOpen) window.history.back(); // its popstate closes the song
    else {
      window.history.replaceState(null, '', BASE);
      setSelectedSlug(null);
    }
  };

  return (
    <>
      {!selectedSlug && !performanceMode && (
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
                <h2>Acordate</h2>
            </div>
            
            <nav>
                <div style={{marginTop: '2rem', marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: '600'}}>
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
                <div className="actions">
                    <button
                      className={`btn ${performanceMode ? 'btn-on' : ''}`}
                      onClick={() => setPerformanceMode(!performanceMode)}
                      title={performanceMode ? "Activar animaciones" : "Desactivar animaciones para mejorar rendimiento"}
                    >
                        <i className={`fas ${performanceMode ? 'fa-bolt' : 'fa-film'}`}></i>
                        {performanceMode ? 'Modo rápido' : 'Animaciones'}
                    </button>
                    {API_URL && (
                    <button
                      className="btn"
                      onClick={handleSync}
                      disabled={syncing}
                    >
                        {syncing ? <><i className="fas fa-spinner fa-spin"></i> Sincronizando...</> :
                         syncStatus === 'success' ? <><i className="fas fa-check"></i> ¡Listo!</> :
                         syncStatus === 'error' ? <><i className="fas fa-times"></i> Error</> :
                         <><i className="fas fa-sync-alt"></i> Sincronizar</>}
                    </button>
                    )}
                    <button
                      className="btn"
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
            <button className="filters-toggle" onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen}>
                <i className="fas fa-sliders"></i> Filtros
                {(activeMood || activeTheme || filterHasBackingTrack) && (
                    <span className="filters-count">{[activeMood, activeTheme, filterHasBackingTrack].filter(Boolean).length}</span>
                )}
                <i className={`fas fa-chevron-${filtersOpen ? 'up' : 'down'}`} style={{ marginLeft: 'auto' }}></i>
            </button>
            <div className={`filters-container ${filtersOpen ? 'open' : ''}`}>
                <div className="filter-row">
                    <span className="filter-label">Mood</span>
                    <div className="filter-buttons">
                        {Object.entries(MOODS_CONFIG).map(([moodName, config]) => (
                            <button
                                key={moodName}
                                className={`filter-tag mood-btn ${activeMood === moodName ? 'active' : ''}`}
                                onClick={() => setActiveMood(activeMood === moodName ? null : moodName)}
                            >
                                {/* The mood keeps its color only as a dot: the cards are where moods get colored */}
                                <span className="filter-dot" style={{ background: config.color }}></span>{moodName}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="filter-row" style={{ marginTop: '0.8rem' }}>
                    <span className="filter-label">Temática</span>
                    <div className="filter-buttons">
                        {Object.keys(THEMES_CONFIG).map(themeName => (
                            <button
                                key={themeName}
                                className={`filter-tag theme-btn ${activeTheme === themeName ? 'active' : ''}`}
                                onClick={() => setActiveTheme(activeTheme === themeName ? null : themeName)}
                            >
                                {themeName}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="filter-row" style={{ marginTop: '0.8rem' }}>
                    <span className="filter-label">Pistas</span>
                    <div className="filter-buttons">
                        <button
                            className={`filter-tag ${filterHasBackingTrack ? 'active' : ''}`}
                            onClick={() => setFilterHasBackingTrack(!filterHasBackingTrack)}
                        >
                            <i className="fas fa-microphone"></i> Solo con pista oficial
                        </button>
                    </div>
                </div>
            </div>

            <div ref={resultsRef} className="results-bar">
                <span>
                    {pageCount > 1 ? (
                        <>Mostrando <span style={{color: 'var(--text-main)', fontWeight: '600'}}>{(page - 1) * pageSize + 1}–{(page - 1) * pageSize + visibleSongs.length}</span> de {filteredSongs.length} canciones</>
                    ) : (
                        <>Mostrando <span style={{color: 'var(--text-main)', fontWeight: '600'}}>{filteredSongs.length}</span> canciones</>
                    )}
                </span>
                <label className="page-size">
                    Por página
                    <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
                        {PAGE_SIZES.map(size => (
                            <option key={size} value={size}>{size === Infinity ? 'Todas' : size}</option>
                        ))}
                    </select>
                </label>
            </div>

            <div className="song-grid">
                {visibleSongs.map((song, index) => (
                  <div
                    key={song.url}
                    className={`song-card animate-in ${song.theme ? `theme-${song.theme.toLowerCase()}` : ''}`} 
                    style={{
                      animationDelay: `${Math.min(index * 0.05, 1)}s`,
                      '--active-mood-color': song.mood ? (MOODS_CONFIG[song.mood]?.color || '#ffffff') : 'var(--primary)',
                      '--active-mood-rgb': song.mood ? (MOODS_CONFIG[song.mood]?.rgb || '255,255,255') : '242,184,75'
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

            {pageCount > 1 && (
                <nav className="pagination" aria-label="Páginas">
                    <button className="page-btn" disabled={page === 1} onClick={() => goToPage(page - 1)} aria-label="Página anterior">
                        <i className="fas fa-chevron-left"></i>
                    </button>
                    {pageItems(page, pageCount).map((p, i) => p === '…' ? (
                        <span key={`gap-${i}`} className="page-gap">…</span>
                    ) : (
                        <button
                            key={p}
                            className={`page-btn ${p === page ? 'active' : ''}`}
                            aria-current={p === page ? 'page' : undefined}
                            onClick={() => goToPage(p)}
                        >
                            {p}
                        </button>
                    ))}
                    <button className="page-btn" disabled={page === pageCount} onClick={() => goToPage(page + 1)} aria-label="Página siguiente">
                        <i className="fas fa-chevron-right"></i>
                    </button>
                </nav>
            )}
        </main>
      </div>

      {randomModal && (
        <div style={{position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)', zIndex: 1000, display: 'grid', placeItems: 'center'}}>
            <div className="song-card" style={{width: '400px', padding: '3rem', textAlign: 'center'}}>
                <div style={{fontSize: '0.9rem', color: 'var(--primary)', marginBottom: '1rem', fontWeight: '700', textTransform: 'uppercase'}}>¡Hoy deberías cantar!</div>
                <div style={{marginBottom: '1.5rem'}}>
                    <div className="song-title" style={{fontSize: '2rem', marginBottom: '0.3rem'}}>{randomModal.title}</div>
                    {randomModal.folder !== 'Otros' && <div className="song-artist">{randomModal.folder}</div>}
                </div>
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
            syncPoints={syncPointsDict[selectedSong.url]}
            onClose={closeSong}
            onVideoLinked={handleVideoLinked}
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
