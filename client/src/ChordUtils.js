export function parseChord(chordStr) {
    const match = chordStr.match(/^((?:C|D|E|F|G|A|B|H|Do|Re|Mi|Fa|Sol|La|Si)[#b]?)(.*)$/i);
    if (!match) return { key: chordStr, suffix: 'major' }; 
    
    let root = match[1];
    let suffix = match[2];
    
    root = root.charAt(0).toUpperCase() + root.slice(1).toLowerCase();
    
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
    
    suffixKey = suffixKey.replace(/\(/g, '').replace(/\)/g, '');
    
    if (!suffixKey) suffixKey = 'major';
    if (suffixKey === 'm') suffixKey = 'minor';
    if (suffixKey === '-') suffixKey = 'minor';
    
    suffixKey = suffixKey.replace(/7M/g, 'maj7');
    suffixKey = suffixKey.replace(/9M/g, 'maj9');
    suffixKey = suffixKey.replace(/º|°/g, 'dim');
    suffixKey = suffixKey.replace(/\+/g, 'aug');
    
    if (suffixKey === '4') suffixKey = 'sus4';
    if (suffixKey === '2') suffixKey = 'sus2';
    
    return { key: rootKey, suffix: suffixKey };
}

export function transposeChord(chordStr, delta) {
    const match = chordStr.match(/^((?:C|D|E|F|G|A|B|H|Do|Re|Mi|Fa|Sol|La|Si)[#b]?)(.*)$/i);
    if (!match) return chordStr; 
    
    let root = match[1];
    let suffix = match[2];
    
    root = root.charAt(0).toUpperCase() + root.slice(1).toLowerCase();
    
    const rootToEnglish = {
        'Do': 'C', 'Do#': 'C#', 'Reb': 'Db',
        'Re': 'D', 'Re#': 'D#', 'Mib': 'Eb',
        'Mi': 'E',
        'Fa': 'F', 'Fa#': 'F#', 'Solb': 'Gb',
        'Sol': 'G', 'Sol#': 'G#', 'Lab': 'Ab',
        'La': 'A', 'La#': 'A#', 'Sib': 'Bb',
        'Si': 'B'
    };
    
    const normalizedRoot = rootToEnglish[root] || root;
    
    const scale = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const scaleMap = { 
        'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 
        'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 
        'A#': 10, 'Bb': 10, 'B': 11, 'H': 11 
    };
    
    if (scaleMap[normalizedRoot] === undefined) return chordStr;
    
    let newIndex = (scaleMap[normalizedRoot] + delta) % 12;
    if (newIndex < 0) newIndex += 12;
    
    const newRoot = scale[newIndex];
    
    let newSuffix = suffix;
    const slashMatch = suffix.match(/^(.*?)\/([CDEFGABH][#b]?)$/i);
    if (slashMatch) {
        const bassNote = slashMatch[2].charAt(0).toUpperCase() + slashMatch[2].slice(1).toLowerCase();
        const normBass = rootToEnglish[bassNote] || bassNote;
        if (scaleMap[normBass] !== undefined) {
            let newBassIndex = (scaleMap[normBass] + delta) % 12;
            if (newBassIndex < 0) newBassIndex += 12;
            const newBass = scale[newBassIndex];
            newSuffix = slashMatch[1] + '/' + newBass;
        }
    }
    
    return newRoot + newSuffix;
}

export function renderSVGChord(posData, rootName) {
    if (!posData) return `<div class="unknown-chord" style="color:var(--text-muted); text-align:center; padding: 20px 0;">${rootName}</div>`;
    const w = 90;
    const h = 110;
    const stringSpacing = w / 5;
    const fretSpacing = h / 5;
    
    const frets = posData.frets;
    const baseFret = posData.baseFret;
    const barres = posData.barres || [];
    
    let svg = `<svg viewBox="-35 -25 145 145" width="100" height="115" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<text x="45" y="-12" text-anchor="middle" font-family="Outfit, sans-serif" font-weight="700" font-size="20" fill="var(--text-main)">${rootName}</text>`;
    
    if (baseFret > 1) {
        svg += `<text x="-8" y="15" text-anchor="end" font-family="Outfit" font-weight="600" font-size="12" fill="var(--text-muted)">${baseFret}fr</text>`;
    } else {
        svg += `<rect x="0" y="0" width="${w}" height="4" fill="var(--text-main)"/>`;
    }

    for (let i = 0; i <= 5; i++) {
        const y = i * fretSpacing;
        svg += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="var(--text-main)" stroke-width="${(i===0 && baseFret===1) ? 0 : 1}" opacity="0.3"/>`;
    }

    for (let i = 0; i <= 5; i++) {
        const x = i * stringSpacing;
        svg += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="var(--text-main)" stroke-width="1" opacity="0.3"/>`;
    }

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
