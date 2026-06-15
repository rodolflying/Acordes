import React, { useEffect, useState } from 'react';

function DashboardModal({ stats, onClose }) {
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    // Esc key listener to close modal
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    // Trigger animations after component mounts
    const timer = setTimeout(() => {
      setAnimate(true);
    }, 50);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timer);
    };
  }, [onClose]);

  if (!stats) return null;

  return (
    <div className="dashboard-overlay" onClick={onClose}>
      <div className="dashboard-modal animate-modal" onClick={(e) => e.stopPropagation()}>
        
        {/* Header */}
        <div className="dashboard-header">
          <div className="dashboard-title-area">
            <div className="dashboard-title-icon">
              <i className="fas fa-chart-pie"></i>
            </div>
            <div>
              <h2>Análisis del Repertorio</h2>
              <p>Estadísticas y desglose de tu biblioteca de canciones</p>
            </div>
          </div>
          <button className="dashboard-close-btn" onClick={onClose} title="Cerrar (Esc)">
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Content Area */}
        <div className="dashboard-scrollable">
          
          {/* KPI Cards Row */}
          <div className="dashboard-kpi-grid">
            <div className="kpi-card">
              <div className="kpi-icon"><i className="fas fa-music"></i></div>
              <div className="kpi-value">{stats.total}</div>
              <div className="kpi-label">Total Canciones</div>
            </div>

            <div 
              className="kpi-card" 
              style={{
                borderColor: stats.dominantMood ? stats.dominantMood.color : 'var(--glass-border)',
                boxShadow: stats.dominantMood ? `0 8px 32px rgba(${stats.dominantMood.color.replace('#', '') === 'ff007a' ? '255,0,122' : '0,242,255'}, 0.08)` : 'none'
              }}
            >
              <div className="kpi-icon" style={{ color: stats.dominantMood ? stats.dominantMood.color : 'inherit' }}>
                {stats.dominantMood ? stats.dominantMood.emoji : <i className="fas fa-heart"></i>}
              </div>
              <div className="kpi-value">{stats.dominantMood ? stats.dominantMood.name : 'N/A'}</div>
              <div className="kpi-label">Mood Predominante</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-icon" style={{ color: 'var(--primary)' }}>
                {stats.dominantTheme ? stats.dominantTheme.emoji : <i className="fas fa-bookmark"></i>}
              </div>
              <div className="kpi-value">{stats.dominantTheme ? stats.dominantTheme.name : 'N/A'}</div>
              <div className="kpi-label">Temática Principal</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-icon"><i className="fas fa-folder-open"></i></div>
              <div className="kpi-value">{stats.uniqueFoldersCount}</div>
              <div className="kpi-label">Artistas / Carpetas</div>
            </div>
          </div>

          {/* Main Charts Grid */}
          <div className="dashboard-charts-grid">
            
            {/* Panel 1: Espectro Emocional */}
            <div className="dashboard-panel">
              <h3><i className="fas fa-heartbeat icon-accent"></i> Espectro Emocional (Moods)</h3>
              <div className="progress-list">
                {stats.moods.map((mood) => (
                  <div key={mood.name} className="progress-item">
                    <div className="progress-item-header">
                      <span>
                        <span className="item-emoji">{mood.emoji}</span> {mood.name}
                      </span>
                      <span className="progress-count">{mood.count} ({mood.percentage}%)</span>
                    </div>
                    <div className="progress-track">
                      <div 
                        className="progress-fill" 
                        style={{ 
                          width: animate ? `${mood.percentage}%` : '0%',
                          backgroundColor: mood.color,
                          boxShadow: `0 0 8px ${mood.color}`
                        }}
                      ></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Panel 2: Lírica & Temáticas */}
            <div className="dashboard-panel">
              <h3><i className="fas fa-tags icon-accent"></i> Lírica & Temáticas</h3>
              <div className="progress-list">
                {stats.themes.map((theme) => (
                  <div key={theme.name} className="progress-item">
                    <div className="progress-item-header">
                      <span>
                        <span className="item-emoji">{theme.emoji}</span> {theme.name}
                      </span>
                      <span className="progress-count">{theme.count} ({theme.percentage}%)</span>
                    </div>
                    <div className="progress-track">
                      <div 
                        className="progress-fill" 
                        style={{ 
                          width: animate ? `${theme.percentage}%` : '0%',
                          backgroundColor: 'var(--primary)',
                          boxShadow: '0 0 8px rgba(0, 242, 255, 0.5)'
                        }}
                      ></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Panel 3: Fuentes & Energía */}
            <div className="dashboard-panel split-panel">
              <div className="panel-sub-section">
                <h3><i className="fas fa-globe icon-accent"></i> Orígenes del Scrapeo</h3>
                <div className="progress-list">
                  {stats.sources.map((src) => (
                    <div key={src.name} className="progress-item">
                      <div className="progress-item-header">
                        <span>{src.name}</span>
                        <span className="progress-count">{src.count} ({src.percentage}%)</span>
                      </div>
                      <div className="progress-track">
                        <div 
                          className="progress-fill" 
                          style={{ 
                            width: animate ? `${src.percentage}%` : '0%',
                            backgroundColor: 'var(--secondary)',
                            boxShadow: '0 0 8px rgba(112, 0, 255, 0.5)'
                          }}
                        ></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="panel-sub-section">
                <h3><i className="fas fa-bolt icon-accent"></i> Nivel de Energía</h3>
                <div className="progress-list">
                  {stats.energy.map((nrg) => (
                    <div key={nrg.name} className="progress-item">
                      <div className="progress-item-header">
                        <span>{nrg.name}</span>
                        <span className="progress-count">{nrg.count} ({nrg.percentage}%)</span>
                      </div>
                      <div className="progress-track">
                        <div 
                          className="progress-fill" 
                          style={{ 
                            width: animate ? `${nrg.percentage}%` : '0%',
                            backgroundColor: nrg.name === 'Alta' ? '#ff003c' : nrg.name === 'Media' ? '#ffb703' : nrg.name === 'Baja' ? '#38b000' : 'var(--text-muted)',
                            boxShadow: nrg.name === 'Alta' ? '0 0 8px #ff003c' : nrg.name === 'Media' ? '0 0 8px #ffb703' : nrg.name === 'Baja' ? '0 0 8px #38b000' : 'none'
                          }}
                        ></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Panel 4: Artistas & Décadas */}
            <div className="dashboard-panel split-panel">
              <div className="panel-sub-section">
                <h3><i className="fas fa-trophy icon-accent"></i> Top 5 Artistas</h3>
                <ul className="dashboard-top-list">
                  {stats.topFolders.map((artist, idx) => (
                    <li key={artist.name} className="top-list-item">
                      <div className="top-list-rank">#{idx + 1}</div>
                      <div className="top-list-name">{artist.name}</div>
                      <div className="top-list-badge">{artist.count} {artist.count === 1 ? 'canción' : 'canciones'}</div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="panel-sub-section">
                <h3><i className="fas fa-hourglass-half icon-accent"></i> Línea de Tiempo (Décadas)</h3>
                <div className="progress-list" style={{ maxHeight: '190px', overflowY: 'auto', paddingRight: '4px' }}>
                  {stats.decades.map((dec) => (
                    <div key={dec.name} className="progress-item">
                      <div className="progress-item-header">
                        <span>{dec.name}</span>
                        <span className="progress-count">{dec.count} ({dec.percentage}%)</span>
                      </div>
                      <div className="progress-track">
                        <div 
                          className="progress-fill" 
                          style={{ 
                            width: animate ? `${dec.percentage}%` : '0%',
                            backgroundColor: 'rgba(255, 255, 255, 0.45)',
                            boxShadow: '0 0 4px rgba(255, 255, 255, 0.2)'
                          }}
                        ></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}

export default DashboardModal;
