// The song list, built from the bookmarks (songs.json) and the names cleaned by enricher.py.
// Pure functions: the app uses them in the browser and scripts/song-pages.mjs at build time, so the
// address of each song (/cancion/artista/titulo/) is the same in both places.

// Comparable form of a name: no accents, case or punctuation ("I Won't Give Up" = "I Wont Give Up")
export const normKey = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// URL piece of a name: "Ángel Para Un Final" → "angel-para-un-final", "I'm With You" → "im-with-you"
export const slugify = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Only these sites open in our own viewer; the rest open on their site
export const isViewable = song => song.source === 'Cifra Club' || song.source === 'LaCuerda';

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

// Two bookmarks of the same song (mobile and desktop Cifra Club, .com and .com.br, two sites) share it
const songKey = s => s.clean_title ? `${normKey(s.folder)}|${normKey(s.clean_title)}` : s.url;

// Every bookmark of a song, with its enriched data and the song's address (`slug`)
export const buildSongs = (data, enrichedSongs = {}) => {
    // Only chord pages: the bookmark folders also hold music-related links that aren't
    // songs (tools, shops, tutorials and covers on YouTube…)
    const rawSongs = processData(data).filter(song => song.source !== 'Web');

    // Merge enriched data. Title and folder (artist) use the names cleaned by
    // enricher.py when available, instead of the raw bookmark name
    const mergedSongs = rawSongs.map(song => {
        const enriched = enrichedSongs[song.url] || {};
        const hasArtist = enriched.artist && enriched.artist !== 'Unknown';
        return {
            ...song,
            title: enriched.title || song.title,
            folder: hasArtist ? enriched.artist : song.folder,
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

    // Normalize folder names ignoring case and accents, keeping the best spelling:
    // accented over plain ("El Mató…" over "El Mato…"), capitalized over all-lowercase
    const folderKey = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const spellingScore = s => (/[\u0300-\u036f]/.test(s.normalize('NFD')) ? 2 : 0) + (s !== s.toLowerCase() ? 1 : 0);
    const folderMap = new Map();
    mergedSongs.forEach(song => {
        if (song.folder && song.folder !== 'Otros') {
            const key = folderKey(song.folder);
            const existing = folderMap.get(key);
            if (!existing || spellingScore(song.folder) > spellingScore(existing)) {
                folderMap.set(key, song.folder);
            }
        }
    });

    mergedSongs.forEach(song => {
        if (song.folder && song.folder !== 'Otros') {
            song.folder = folderMap.get(folderKey(song.folder));
        }
    });

    // Address of each song: artist/title. The bookmarks of one song share it; two different songs
    // that would get the same one (only when a name couldn't be cleaned) take -2, -3…
    const slugOfKey = new Map();
    const taken = new Set();
    mergedSongs.forEach(song => {
        const key = songKey(song);
        if (!slugOfKey.has(key)) {
            const base = `${slugify(song.folder) || 'otros'}/${slugify(song.clean_title || song.title) || 'cancion'}`;
            let slug = base;
            for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
            taken.add(slug);
            slugOfKey.set(key, slug);
        }
        song.slug = slugOfKey.get(key);
    });

    return mergedSongs;
};

// One card per song: when the same song was bookmarked twice keep the most complete one —
// backing tracks, synced lyrics, chords
export const pickBest = (allSongs, backingTracks = {}, syncPoints = {}) => {
    const score = s => (backingTracks[s.url] ? 4 : 0) + (syncPoints[s.url] ? 2 : 0)
      - (s.source === 'LaCuerda' && !s.url.includes('.shtml') ? 3 : 0) // prefer the song page over a LaCuerda index page
      - (s.url.includes('//m.') ? 1 : 0);
    const best = new Map();
    allSongs.forEach(s => {
      const k = songKey(s);
      if (!best.has(k) || score(s) > score(best.get(k))) best.set(k, s);
    });
    return allSongs.filter(s => best.get(songKey(s)) === s);
};
