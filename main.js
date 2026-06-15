let allSongs = [];
let currentFilter = 'all';
let chordDb = null;

async function init() {
    initThreeBG();
    try {
        const response = await fetch('songs.json');
        const data = await response.json();
        
        try {
            const dbRes = await fetch('chords_db.json');
            chordDb = await dbRes.json();
        } catch(e) {
            console.log('No se pudo cargar la base de datos de acordes');
        }

        processData(data);
        renderFolders(data);
        renderSongs(allSongs);
        setupEventListeners();
    } catch (error) {
        console.error('Error cargando canciones:', error);
    }
}

function initThreeBG() {
    const container = document.getElementById('three-bg');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    // Light
    const ambientLight = new THREE.AmbientLight(0x404040, 2);
    scene.add(ambientLight);
    const pointLight = new THREE.PointLight(0x00f2ff, 2, 100);
    pointLight.position.set(10, 10, 10);
    scene.add(pointLight);

    // Central Floating Orb
    const geometry = new THREE.IcosahedronGeometry(2, 1);
    const material = new THREE.MeshStandardMaterial({ 
        color: 0x7000ff, 
        wireframe: true,
        transparent: true,
        opacity: 0.3
    });
    const orb = new THREE.Mesh(geometry, material);
    scene.add(orb);

    // Particles
    const particlesGeometry = new THREE.BufferGeometry();
    const particlesCount = 500;
    const posArray = new Float32Array(particlesCount * 3);
    for(let i=0; i < particlesCount * 3; i++) {
        posArray[i] = (Math.random() - 0.5) * 50;
    }
    particlesGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    const particlesMaterial = new THREE.PointsMaterial({
        size: 0.05,
        color: 0x00f2ff,
        transparent: true,
        opacity: 0.5
    });
    const particlesMesh = new THREE.Points(particlesGeometry, particlesMaterial);
    scene.add(particlesMesh);

    camera.position.z = 15;

    let mouseX = 0;
    let mouseY = 0;
    document.addEventListener('mousemove', (e) => {
        mouseX = (e.clientX - window.innerWidth / 2) / 100;
        mouseY = (e.clientY - window.innerHeight / 2) / 100;
    });

    function animate() {
        requestAnimationFrame(animate);
        orb.rotation.y += 0.005;
        orb.rotation.x += 0.003;
        
        particlesMesh.rotation.y += 0.001;
        
        camera.position.x += (mouseX - camera.position.x) * 0.05;
        camera.position.y += (-mouseY - camera.position.y) * 0.05;
        camera.lookAt(scene.position);

        renderer.render(scene, camera);
    }

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    animate();
}

function processData(node, folderName = 'Raíz') {
    if (node.type === 'url') {
        allSongs.push({
            title: node.name,
            url: node.url,
            folder: folderName,
            source: detectSource(node.url)
        });
    } else if (node.children) {
        node.children.forEach(child => processData(child, node.name));
    }
}

function detectSource(url) {
    if (url.includes('cifraclub.com')) return 'Cifra Club';
    if (url.includes('lacuerda.net')) return 'LaCuerda';
    if (url.includes('ukulele-tabs.com')) return 'Uku-Tabs';
    if (url.includes('ultimate-guitar.com')) return 'Ultimate Guitar';
    if (url.includes('chordify.net')) return 'Chordify';
    return 'Web';
}

function renderFolders(data) {
    const list = document.getElementById('folder-list');
    const folders = new Set();
    
    // Find top-level folders
    if (data.children) {
        data.children.forEach(item => {
            if (item.type === 'folder') folders.add(item.name);
        });
    }

    folders.forEach(name => {
        const li = document.createElement('li');
        li.className = 'folder-item';
        li.innerHTML = `<i class="fas fa-folder"></i> ${name}`;
        li.dataset.folder = name;
        li.onclick = () => filterByFolder(name, li);
        list.appendChild(li);
    });
}

function renderSongs(songs) {
    const grid = document.getElementById('song-grid');
    const count = document.getElementById('song-count');
    grid.innerHTML = '';
    count.innerText = songs.length;

    songs.forEach((song, index) => {
        const card = document.createElement('div');
        card.className = 'song-card animate-in';
        card.style.animationDelay = `${Math.min(index * 0.05, 1)}s`;
        
        card.innerHTML = `
            <div>
                <div class="song-source">${song.source}</div>
                <div class="song-title">${song.title}</div>
            </div>
            <div class="card-footer">
                <span class="folder-badge">${song.folder}</span>
                <i class="fas fa-external-link-alt external-link"></i>
            </div>
        `;
        
        card.onclick = () => openSongViewer(song);
        
        // Hacer que el icono de enlace externo sea funcional
        const externalIcon = card.querySelector('.external-link');
        externalIcon.onclick = (e) => {
            e.stopPropagation(); // Evitar que se abra el visor interno de la tarjeta
            window.open(song.url, '_blank');
        };
        
        grid.appendChild(card);
    });
}

async function openSongViewer(song) {
    // Si no es cifraclub o lacuerda, abrimos en nueva pestaña
    if (song.source !== 'Cifra Club' && song.source !== 'LaCuerda') {
        window.open(song.url, '_blank');
        return;
    }

    const viewer = document.getElementById('song-viewer');
    const content = document.getElementById('viewer-content');
    const title = document.getElementById('viewer-title');
    
    viewer.style.display = 'block';
    content.innerHTML = '<div style="text-align:center; padding: 3rem;"><i class="fas fa-spinner fa-spin fa-3x"></i><br><br>Cargando acordes...</div>';
    title.innerText = song.title;

    try {
        const response = await fetch(`http://127.0.0.1:8001/api/song?url=${encodeURIComponent(song.url)}`);
        const data = await response.json();
        
        if (data.error) {
            content.innerHTML = `<div style="color:var(--primary); padding: 2rem;">Error: ${data.error}</div>`;
            document.getElementById('diagrams-container').innerHTML = '';
        } else {
            content.innerHTML = `<pre class="chord-sheet">${data.content}</pre>`;
            document.getElementById('autoscroll-controls').style.display = 'flex';
            generateChordDiagrams(); // Generar diagramas a partir del texto
        }
    } catch (err) {
        content.innerHTML = `<div style="color:var(--primary); padding: 2rem;">Error de conexión con el servidor local para extraer la letra.</div>`;
        document.getElementById('diagrams-container').innerHTML = '';
    }
}

function closeSongViewer() {
    document.getElementById('song-viewer').style.display = 'none';
    document.getElementById('autoscroll-controls').style.display = 'none';
    document.getElementById('diagrams-container').innerHTML = '';
    stopAutoscroll();
}

function parseChord(chordStr) {
    // Splits "C#m7" or "Sol#m" into root ("C#", "Sol#") and suffix ("m7", "m")
    // Put Spanish notes first to avoid eager matching on English prefixes (like D matching in DO)
    const match = chordStr.match(/^((?:Do|Re|Mi|Fa|Sol|La|Si|C|D|E|F|G|A|B|H)[#b]?)(.*)$/i);
    if (!match) return { key: chordStr, suffix: 'major' }; // Fallback
    
    let root = match[1];
    let suffix = match[2];
    
    // Capitalize first letter, lowercase the rest (e.g., "sol#" -> "Sol#", "DO" -> "Do")
    root = root.charAt(0).toUpperCase() + root.slice(1).toLowerCase();
    
    // Translation dict
    const chordTranslation = {
        'C': 'C', 'Do': 'C',
        'C#': 'Csharp', 'Db': 'Csharp', 'Do#': 'Csharp', 'Reb': 'Csharp',
        'D': 'D', 'Re': 'D',
        'D#': 'Eb', 'Eb': 'Eb', 'Re#': 'Eb', 'Mib': 'Eb',
        'E': 'E', 'Mi': 'E',
        'F': 'F', 'Fa': 'F',
        'F#': 'Fsharp', 'Gb': 'Fsharp', 'Fa#': 'Fsharp', 'Solb': 'Fsharp',
        'G': 'G', 'Sol': 'G',
        'G#': 'Ab', 'Ab': 'Ab', 'Sol#': 'Ab', 'Lab': 'Ab',
        'A': 'A', 'La': 'A',
        'A#': 'Bb', 'Bb': 'Bb', 'La#': 'Bb', 'Sib': 'Bb',
        'B': 'B', 'Si': 'B'
    };
    
    const rootKey = chordTranslation[root] || root;
    let suffixKey = suffix.replace(/\s+/g, '');
    
    // Removemos paréntesis comunes en notaciones como C(add9) o Fm7(b5)
    suffixKey = suffixKey.replace(/\(/g, '').replace(/\)/g, '');
    
    if (!suffixKey) suffixKey = 'major';
    if (suffixKey === 'm') suffixKey = 'minor';
    if (suffixKey === '-') suffixKey = 'minor';
    
    // Traducciones de notación regional a estándar
    suffixKey = suffixKey.replace(/7M/g, 'maj7');
    suffixKey = suffixKey.replace(/9M/g, 'maj9');
    suffixKey = suffixKey.replace(/º|°/g, 'dim');
    suffixKey = suffixKey.replace(/\+/g, 'aug');
    
    // Acordes con '4' o '2' solos que se refieren a acordes suspendidos
    if (suffixKey === '4') suffixKey = 'sus4';
    if (suffixKey === '2') suffixKey = 'sus2';
    
    // Traducir nota de bajo en acordes con barra (ej. /Sol -> /G)
    const slashTranslation = {
        'C': 'C', 'Do': 'C',
        'C#': 'C#', 'Db': 'C#', 'Do#': 'C#', 'Reb': 'C#',
        'D': 'D', 'Re': 'D',
        'D#': 'D#', 'Eb': 'Eb', 'Re#': 'D#', 'Mib': 'Eb',
        'E': 'E', 'Mi': 'E',
        'F': 'F', 'Fa': 'F',
        'F#': 'F#', 'Gb': 'F#', 'Fa#': 'F#', 'Solb': 'F#',
        'G': 'G', 'Sol': 'G',
        'G#': 'G#', 'Ab': 'Ab', 'Sol#': 'G#', 'Lab': 'Ab',
        'A': 'A', 'La': 'A',
        'A#': 'A#', 'Bb': 'Bb', 'La#': 'A#', 'Sib': 'Bb',
        'B': 'B', 'Si': 'B'
    };
    const slashMatch = suffixKey.match(/\/((?:Do|Re|Mi|Fa|Sol|La|Si|C|D|E|F|G|A|B)[#b]?)$/i);
    if (slashMatch) {
        let slashRoot = slashMatch[1];
        slashRoot = slashRoot.charAt(0).toUpperCase() + slashRoot.slice(1).toLowerCase();
        const translatedSlash = slashTranslation[slashRoot] || slashRoot;
        suffixKey = suffixKey.slice(0, slashMatch.index) + '/' + translatedSlash;
    }
    
    return { key: rootKey, suffix: suffixKey };
}

function renderSVGChord(posData, rootName) {
    if (!posData) return `<div class="unknown-chord" style="color:var(--text-muted); text-align:center; padding: 20px 0;">${rootName}</div>`;
    const w = 90;
    const h = 110;
    const stringSpacing = w / 5;
    const fretSpacing = h / 5;
    
    
    const frets = posData.frets;
    const baseFret = posData.baseFret;
    const barres = posData.barres || [];
    
    // Expanded viewBox from -20 to -35 to allow 2-digit fret numbers to fit on the left
    let svg = `<svg viewBox="-35 -25 145 145" width="100" height="115" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<text x="45" y="-12" text-anchor="middle" font-family="Outfit, sans-serif" font-weight="700" font-size="20" fill="var(--text-main)">${rootName}</text>`;
    
    // Nut or Base Fret
    if (baseFret > 1) {
        svg += `<text x="-8" y="15" text-anchor="end" font-family="Outfit" font-weight="600" font-size="12" fill="var(--text-muted)">${baseFret}fr</text>`;
    } else {
        svg += `<rect x="0" y="0" width="${w}" height="4" fill="var(--text-main)"/>`;
    }

    // Grid (5 frets)
    for (let i = 0; i <= 5; i++) {
        const y = i * fretSpacing;
        svg += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="var(--text-main)" stroke-width="${(i===0 && baseFret===1) ? 0 : 1}" opacity="0.3"/>`;
    }

    // Strings
    for (let i = 0; i <= 5; i++) {
        const x = i * stringSpacing;
        svg += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="var(--text-main)" stroke-width="1" opacity="0.3"/>`;
    }

    // Barres
    if (barres && barres.length > 0) {
        barres.forEach(fretNum => {
            let minStr = 5, maxStr = 0;
            frets.forEach((f, idx) => {
                if (f === fretNum) {
                    if (idx < minStr) minStr = idx;
                    if (idx > maxStr) maxStr = idx;
                }
            });
            if (minStr <= maxStr) {
                const y = (fretNum - 0.5) * fretSpacing;
                svg += `<rect x="${minStr * stringSpacing - 5}" y="${y - 5}" width="${(maxStr - minStr) * stringSpacing + 10}" height="10" rx="5" fill="var(--primary)"/>`;
            }
        });
    }

    // Dots and Muted
    for (let i = 0; i < 6; i++) {
        let fret = frets[i];
        const x = i * stringSpacing;

        if (fret === -1 || fret === 'x') {
            svg += `<text x="${x}" y="-4" text-anchor="middle" font-family="Outfit" font-size="14" font-weight="bold" fill="var(--primary)">x</text>`;
        } else if (fret === 0) {
            svg += `<circle cx="${x}" cy="-8" r="3" fill="transparent" stroke="var(--text-main)" stroke-width="1.5" opacity="0.5"/>`;
        } else {
            const y = (fret - 0.5) * fretSpacing;
            const isBarre = barres && barres.includes(fret);
            if (!isBarre) {
                svg += `<circle cx="${x}" cy="${y}" r="6" fill="var(--primary)"/>`;
            } else {
                svg += `<circle cx="${x}" cy="${y}" r="3" fill="white"/>`;
            }
        }
    }

    svg += `</svg>`;
    return svg;
}

function generateChordDiagrams() {
    const container = document.getElementById('diagrams-container');
    container.innerHTML = '';
    
    if (!chordDb || !chordDb.chords) return;

    // Obtener todos los acordes únicos de la canción visualizada
    const chordElements = document.querySelectorAll('#viewer-content .chord');
    const uniqueChords = [...new Set(Array.from(chordElements).map(el => el.innerText.trim()))];
    
    uniqueChords.forEach(chordName => {
        const parsed = parseChord(chordName);
        let posData = null;
        
        if (chordDb.chords[parsed.key]) {
            const variations = chordDb.chords[parsed.key];
            const def = variations.find(v => v.suffix === parsed.suffix);
            if (def && def.positions && def.positions.length > 0) {
                posData = def.positions[0]; // Usamos la primera posición (la más estándar)
            }
        }
        
        const div = document.createElement('div');
        div.className = 'diagram-item animate-in';
        div.innerHTML = renderSVGChord(posData, chordName);
        container.appendChild(div);
    });

    // Configurar Tooltips para hover
    setupChordTooltips();
}

let tooltipEl = null;

function setupChordTooltips() {
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'chord-tooltip';
        document.body.appendChild(tooltipEl);
    }
    
    const chordElements = document.querySelectorAll('#viewer-content .chord');
    
    chordElements.forEach(el => {
        el.addEventListener('mouseenter', (e) => {
            const chordName = el.innerText.trim();
            const parsed = parseChord(chordName);
            let posData = null;
            
            if (chordDb && chordDb.chords[parsed.key]) {
                const variations = chordDb.chords[parsed.key];
                const def = variations.find(v => v.suffix === parsed.suffix);
                if (def && def.positions) posData = def.positions[0];
            }
            
            if (posData) {
                tooltipEl.innerHTML = renderSVGChord(posData, chordName);
                
                // Posicionar tooltip con un poco de delay visual o inmediato
                const rect = el.getBoundingClientRect();
                tooltipEl.style.display = 'block';
                tooltipEl.style.top = `${rect.top + window.scrollY - tooltipEl.offsetHeight - 10}px`;
                tooltipEl.style.left = `${rect.left + rect.width/2}px`;
            }
        });
        
        el.addEventListener('mouseleave', () => {
            tooltipEl.style.display = 'none';
            tooltipEl.innerHTML = '';
        });
    });
}

function filterByFolder(folder, element) {
    currentFilter = folder;
    
    // Update UI
    document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
    element.classList.add('active');

    const filtered = folder === 'all' 
        ? allSongs 
        : allSongs.filter(s => s.folder === folder);
    
    renderSongs(filtered);
}

function setupEventListeners() {
    const searchInput = document.getElementById('search');
    searchInput.oninput = (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allSongs.filter(song => {
            const matchesSearch = song.title.toLowerCase().includes(term) || 
                                 song.folder.toLowerCase().includes(term) ||
                                 song.source.toLowerCase().includes(term);
            const matchesFolder = currentFilter === 'all' || song.folder === currentFilter;
            return matchesSearch && matchesFolder;
        });
        renderSongs(filtered);
    };

    document.getElementById('random-btn').onclick = () => {
        const randomSong = allSongs[Math.floor(Math.random() * allSongs.length)];
        const modal = document.getElementById('random-modal');
        const title = document.getElementById('rand-title');
        const link = document.getElementById('rand-link');
        const viewInternalBtn = document.getElementById('rand-view-internal');
        
        title.innerText = randomSong.title;
        link.href = randomSong.url;
        
        // Configurar botón de visor interno
        viewInternalBtn.onclick = () => {
            modal.style.display = 'none';
            openSongViewer(randomSong);
        };

        // Solo mostrar "Ver en mi página" si la fuente es soportada por el scraper
        if (randomSong.source === 'Cifra Club' || randomSong.source === 'LaCuerda') {
            viewInternalBtn.style.display = 'flex';
        } else {
            viewInternalBtn.style.display = 'none';
        }
        
        modal.style.display = 'grid';
    };

    // Autoscroll controls
    document.getElementById('scroll-toggle').onclick = () => {
        isScrolling ? stopAutoscroll() : startAutoscroll();
    };
    document.getElementById('scroll-increase').onclick = () => updateScrollSpeed(1);
    document.getElementById('scroll-decrease').onclick = () => updateScrollSpeed(-1);

    // Refresh controls
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.onclick = async () => {
            const originalText = refreshBtn.innerHTML;
            refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sincronizando...';
            refreshBtn.disabled = true;
            try {
                const response = await fetch('http://127.0.0.1:8001/api/refresh', { method: 'POST' });
                if (response.ok) {
                    // Re-fetch data
                    allSongs = [];
                    document.getElementById('folder-list').innerHTML = `
                        <li class="folder-item active" data-folder="all" onclick="filterByFolder('all', this)">
                            <i class="fas fa-th-large"></i>
                            Todas
                        </li>
                    `;
                    const res = await fetch('songs.json?' + new Date().getTime()); // cache buster
                    const data = await res.json();
                    processData(data);
                    renderFolders(data);
                    filterByFolder(currentFilter, document.querySelector(`.folder-item[data-folder="${currentFilter}"]`) || document.querySelector('.folder-item[data-folder="all"]'));
                    
                    refreshBtn.innerHTML = '<i class="fas fa-check"></i> ¡Listo!';
                    setTimeout(() => { refreshBtn.innerHTML = originalText; refreshBtn.disabled = false; }, 2000);
                } else {
                    refreshBtn.innerHTML = '<i class="fas fa-times"></i> Error';
                    setTimeout(() => { refreshBtn.innerHTML = originalText; refreshBtn.disabled = false; }, 2000);
                }
            } catch (err) {
                console.error(err);
                refreshBtn.innerHTML = '<i class="fas fa-times"></i> Error de conexión';
                setTimeout(() => { refreshBtn.innerHTML = originalText; refreshBtn.disabled = false; }, 2000);
            }
        };
    }
}

// Autoscroll Logic
const scrollSpeeds = [0.5, 0.65, 0.8, 1.0, 1.15, 1.3, 1.5, 1.65, 1.8, 2.0];
let scrollSpeedIndex = 3; // Corresponde a 1.0
let scrollInterval = null;
let isScrolling = false;

function startAutoscroll() {
    if (isScrolling) return;
    isScrolling = true;
    document.getElementById('scroll-toggle').innerHTML = '<i class="fas fa-pause"></i> Pausar';
    
    const viewer = document.getElementById('song-viewer');
    scrollInterval = setInterval(() => {
        // Increment scrollTop
        const currentSpeed = scrollSpeeds[scrollSpeedIndex];
        viewer.scrollTop += (currentSpeed * 0.5); 
    }, 50); // 50ms interval => 20 fps smooth scrolling
}

function stopAutoscroll() {
    if (!isScrolling) return;
    isScrolling = false;
    document.getElementById('scroll-toggle').innerHTML = '<i class="fas fa-play"></i> Auto-Scroll';
    clearInterval(scrollInterval);
}

function updateScrollSpeed(direction) {
    scrollSpeedIndex += direction;
    if (scrollSpeedIndex < 0) scrollSpeedIndex = 0;
    if (scrollSpeedIndex >= scrollSpeeds.length) scrollSpeedIndex = scrollSpeeds.length - 1;
    
    const currentSpeed = scrollSpeeds[scrollSpeedIndex];
    document.getElementById('scroll-speed-display').innerText = `x${currentSpeed}`;
}

init();
