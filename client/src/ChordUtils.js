export function parseChord(chordStr) {
    // Splits "C#m7" or "Sol#m" into root ("C#", "Sol#") and suffix ("m7", "m")
    // Put Spanish notes first to avoid eager matching on English prefixes (like D matching in DO)
    const match = chordStr.match(/^((?:Do|Re|Mi|Fa|Sol|La|Si|C|D|E|F|G|A|B|H)[#b]?)(.*)$/i);
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
    
    // Traducir nota de bajo en acordes con barra (ej. /Sol -> /G), con los nombres que usa
    // chords_db en sus sufijos (/C#, /Eb, /F#, /Ab, /Bb)
    const slashTranslation = {
        'C': 'C', 'Do': 'C',
        'C#': 'C#', 'Db': 'C#', 'Do#': 'C#', 'Reb': 'C#',
        'D': 'D', 'Re': 'D',
        'D#': 'Eb', 'Eb': 'Eb', 'Re#': 'Eb', 'Mib': 'Eb',
        'E': 'E', 'Mi': 'E',
        'F': 'F', 'Fa': 'F',
        'F#': 'F#', 'Gb': 'F#', 'Fa#': 'F#', 'Solb': 'F#',
        'G': 'G', 'Sol': 'G',
        'G#': 'Ab', 'Ab': 'Ab', 'Sol#': 'Ab', 'Lab': 'Ab',
        'A': 'A', 'La': 'A',
        'A#': 'Bb', 'Bb': 'Bb', 'La#': 'Bb', 'Sib': 'Bb',
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

// Chord names the sites write that chords_db doesn't have as such, turned into the same chord in its
// naming: Em7(9) = Em9, A7(4) = A7sus4, D5(9) = Dsus2 (D A E), C#m7(5-) = C#m7b5
const SAME_CHORD = [
    [/^m79$/, 'm9'], [/^m7(?:9\/)?11$/, 'm11'], [/^m911$/, 'm11'], [/^79$/, '9'], [/^911$/, '11'],
    [/^maj79(?:\/13)?$/, 'maj9'], [/^(?:74|47)$/, '7sus4'], [/^4$/, 'sus4'], [/^59$/, 'sus2'],
    [/^m75-(?:\/9-?)?$/, 'm7b5'], [/^75?aug$/, 'aug7'], [/^5aug$/, 'aug'],
];
// When even that doesn't exist, the chord without its extensions: Em7(13-) → Em7, F6(11+) → F6, G4(6) → Gsus4
const QUALITY = /^(mmaj7|maj7|m7b5|m7|m6|m9|m11|dim7|dim|aug7|aug|7sus4|sus4|sus2|maj9|13|11|9|7|6|5|m)/;
const QUALITY_ALIASES = { '4': 'sus4' };
const dbSuffix = body => (body === '' ? 'major' : body === 'm' ? 'minor' : body);
const shownSuffix = s => (s === 'major' ? '' : s === 'minor' ? 'm' : s);

// The diagram for a chord as the sheet writes it: { pos, note } or null when it isn't a chord ("Am-C-D",
// several chords written together, or a tuning). `note` says what the diagram shows when it isn't exactly
// the written chord: "bajo en G" (the shape without its bass note) or "forma de Em7" (without extensions)
export function findChordShape(chordDb, chordName) {
    const name = chordName.replace(/\*/g, '').trim();
    const { key, suffix } = parseChord(name);
    const variations = chordDb?.chords?.[key];
    if (!variations || /-[A-G]/.test(suffix)) return null;
    const find = s => variations.find(v => v.suffix === s && v.positions?.length)?.positions[0];
    if (find(suffix)) return { pos: find(suffix), note: null };

    const [, rawBody, bass] = suffix.match(/^(.*?)(?:\/([A-G][#b]?))?$/);
    const body = rawBody === 'major' ? '' : rawBody === 'minor' ? 'm' : rawBody;
    const same = SAME_CHORD.filter(([re]) => re.test(body)).map(([, s]) => s);
    const quality = body.match(QUALITY)?.[1] ?? QUALITY_ALIASES[body.match(/^\d/)?.[0]];
    // Names as the sheet writes them (in sharps), not as chords_db spells them (Eb, Bb)
    const root = name.match(/^((?:Do|Re|Mi|Fa|Sol|La|Si|[A-H])[#b]?)/i)?.[1] || '';
    const writtenBass = name.match(/\/((?:Do|Re|Mi|Fa|Sol|La|Si|[A-H])[#b]?)$/i)?.[1] || bass;
    const candidates = [...new Set([body, ...same, quality])].filter(b => b !== undefined);
    for (const b of candidates) {
        const exact = b === body || same.includes(b);
        const s = dbSuffix(b);
        if (bass) {
            const withBass = find(s === 'major' ? `/${bass}` : `${shownSuffix(s)}/${bass}`);
            if (withBass) return { pos: withBass, note: exact ? null : `forma de ${root}${shownSuffix(s)}/${writtenBass}` };
        }
        const pos = find(s);
        if (pos) {
            const parts = [!exact && `forma de ${root}${shownSuffix(s)}`, bass && `bajo en ${writtenBass}`].filter(Boolean);
            return { pos, note: parts.join(' · ') || null };
        }
    }
    return null;
}

// The songbook writes every chord with sharps, never flats: Bb → A#, Ebm7 → D#m7, Fm/Ab → Fm/G#.
// Keeps the sheet's language (Sib → La#)
const FLAT_TO_SHARP = {
    'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B', 'Fb': 'E',
    'Reb': 'Do#', 'Mib': 'Re#', 'Solb': 'Fa#', 'Lab': 'Sol#', 'Sib': 'La#', 'Dob': 'Si', 'Fab': 'Mi'
};

export function sharpChord(chordStr) {
    return chordStr.replace(/(^|\/)(Do|Re|Mi|Fa|Sol|La|Si|[A-G])b/g,
        (flat, before, note) => before + FLAT_TO_SHARP[note + 'b']);
}

export function transposeChord(chordStr, delta) {
    // Put Spanish notes first to avoid eager matching on English prefixes (like D matching in DO)
    const match = chordStr.match(/^((?:Do|Re|Mi|Fa|Sol|La|Si|C|D|E|F|G|A|B|H)[#b]?)(.*)$/i);
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
    // Support Spanish notes for the bass note in suffix matching
    const slashMatch = suffix.match(/^(.*?)\/((?:Do|Re|Mi|Fa|Sol|La|Si|C|D|E|F|G|A|B|H)[#b]?)$/i);
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
