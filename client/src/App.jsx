import React, { useState, useEffect, useMemo } from 'react';
import ThreeBackground from './ThreeBackground';
import SongViewer from './SongViewer';
import './index.css';

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
            // "Dancin' - Aaron Smith - Cifra Club"
            const parts = title.split('-');
            if (parts.length >= 3) {
                return parts[parts.length - 2].trim();
            } else if (parts.length === 2) {
                return parts[1].trim();
            }
        } else if (source === 'LaCuerda') {
            // "GEHENA, Ases Falsos: Acordes" or "SOLO UN SEGUNDO, Bacilos: Acordes"
            const match = title.match(/,\s*(.+?):/);
            if (match && match[1]) {
                return match[1].trim();
            }
        } else if (source === 'Uku-Tabs') {
            // "I Won't Give Up Uke tab by Jason Mraz - Ukulele Tabs"
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
        // Si el artista se puede extraer, lo usamos como carpeta.
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
  const [searchQuery, setSearchQuery] = useState('');
  const [chordDb, setChordDb] = useState(null);
  
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null); // 'success', 'error', null
  
  const [selectedSong, setSelectedSong] = useState(null);
  const [randomModal, setRandomModal] = useState(null); // contains random song obj

  const loadData = async () => {
    try {
        const response = await fetch('./songs.json');
        const data = await response.json();
        
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
                    // Normalize to Title Case or just use the first seen
                    // Prefer one with uppercase if possible, so if we see "Milo j" first, maybe wait?
                    // Actually, just taking the first one is usually fine. But to be safe, if the new one has more uppercase letters, we could replace it. 
                    // Let's just use the first one, or we can use the first one.
                    folderMap.set(lower, song.folder);
                } else {
                    // If the existing one is all lowercase and the new one has uppercase, upgrade it
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

        setAllSongs(rawSongs);
        
        const fSet = new Set();
        rawSongs.forEach(song => {
            if (song.folder && song.folder !== 'Otros') {
                fSet.add(song.folder);
            }
        });
        
        // Agregar 'Otros' al final si existe alguna canción en esa categoría
        const hasOthers = rawSongs.some(s => s.folder === 'Otros');
        const foldersArray = Array.from(fSet).sort((a, b) => a.localeCompare(b, undefined, {sensitivity: 'base'}));
        if (hasOthers) foldersArray.push('Otros');
        
        setFolders(['all', ...foldersArray]);
    } catch (error) {
        console.error('Error cargando canciones:', error);
    }
  };

  useEffect(() => {
    loadData();
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
                           song.source.toLowerCase().includes(searchQuery.toLowerCase());
      
      // Si hay una búsqueda activa, ignoramos el filtro de la carpeta actual
      const matchesFolder = hasSearch ? true : (currentFilter === 'all' || song.folder === currentFilter);
      
      return matchesSearch && matchesFolder;
    });
  }, [allSongs, searchQuery, currentFilter]);

  const handleOpenSong = (song) => {
    if (song.source !== 'Cifra Club' && song.source !== 'LaCuerda') {
      window.open(song.url, '_blank');
    } else {
      setSelectedSong(song);
    }
  };

  return (
    <>
      <ThreeBackground />
      <div id="app">
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
                        onClick={() => setCurrentFilter(folder)}
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
                      placeholder="Busca por canción, artista o sitio..." 
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
                    <button className="btn btn-primary" onClick={handleRandom}>
                        <i className="fas fa-shuffle"></i>
                        ¿Qué cantar?
                    </button>
                </div>
            </header>

            <div style={{marginBottom: '1.5rem', color: 'var(--text-muted)', fontSize: '0.9rem'}}>
                Mostrando <span style={{color: 'var(--text-main)', fontWeight: '600'}}>{filteredSongs.length}</span> canciones
            </div>

            <div className="song-grid">
                {filteredSongs.map((song, index) => (
                  <div 
                    key={index} 
                    className="song-card animate-in" 
                    style={{animationDelay: `${Math.min(index * 0.05, 1)}s`}}
                    onClick={() => handleOpenSong(song)}
                  >
                      <div>
                          <div className="song-source">{song.source}</div>
                          <div className="song-title">{song.title}</div>
                      </div>
                      <div className="card-footer">
                          <span className="folder-badge">{song.folder}</span>
                          <i className="fas fa-external-link-alt external-link" onClick={(e) => { e.stopPropagation(); window.open(song.url, '_blank'); }}></i>
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
        <SongViewer song={selectedSong} chordDb={chordDb} onClose={() => setSelectedSong(null)} />
      )}
    </>
  );
}

export default App;
