// After `vite build`: one HTML page per song (dist/cancion/artista/titulo/index.html) with its own
// title, description and picture, so a link in a YouTube description or on WhatsApp shows the song;
// 404.html, which GitHub Pages serves for any other address, a sitemap for search engines, and
// paginas_videos.json: the page and chords of each song, which Karaokes reads from the live site to
// write the comment and description of each video (sync_comentarios.py), so it only links pages that exist.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildSongs, pickBest, isViewable, normKey } from '../src/catalog.js';
import { sharpChord } from '../src/ChordUtils.js';

const dist = new URL('../dist/', import.meta.url);
const read = file => JSON.parse(readFileSync(new URL(file, dist), 'utf-8'));
const site = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).homepage.replace(/\/?$/, '/');
const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const template = readFileSync(new URL('index.html', dist), 'utf-8');
const backingTracks = read('backing_tracks.json').backing_tracks || {};
const syncPoints = read('sync_points.json');
const songs = pickBest(buildSongs(read('songs.json'), read('enriched_songs.json').songs), backingTracks, syncPoints)
  .filter(isViewable);

const page = ({ title, description, url, image }) => template
  .replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`)
  .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escape(description)}">`)
  .replace('</head>', [
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Acordate">`,
    `<meta property="og:title" content="${escape(title)}">`,
    `<meta property="og:description" content="${escape(description)}">`,
    `<meta property="og:url" content="${url}">`,
    image ? `<meta property="og:image" content="${image}">` : '',
    `</head>`,
  ].filter(Boolean).join('\n    '));

for (const song of songs) {
  const video = Object.values(backingTracks[song.url] || {})[0];
  const artist = song.folder !== 'Otros' ? song.folder : null;
  const html = page({
    title: `${song.title}${artist ? ` — ${artist}` : ''} · Acordes | Acordate`,
    description: `Acordes de ${song.title}${artist ? ` de ${artist}` : ''}`
      + (video ? ', con karaoke: la hoja sigue al video y el acorde que suena se ilumina.' : ', con diagramas y transposición.'),
    url: `${site}cancion/${song.slug}/`,
    image: video && `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
  });
  const dir = new URL(`cancion/${song.slug}/`, dist);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL('index.html', dir), html);
}

// The chords of the sheet in the order they first appear (A · A7M · F#m · B), with sharps like the page.
// In the sheet's own notation, English or Latin (Re · Sol · Sim), as the page shows them: a name in the
// other notation is a word the sheet marked as a chord ("DO" in an English sheet)
const preloaded = read('preloaded_songs.json');
const SUFFIX = String.raw`(?:$|[mM\d(/+\-º°]|maj|min|dim|aug|sus|add)`;
const ENGLISH = new RegExp(`^[A-G][#b]?${SUFFIX}`);
const LATIN = new RegExp(`^(?:do|re|mi|fa|sol|la|si)[#b]?${SUFFIX}`, 'i');
const latinCase = c => c.replace(/(^|\/)(do|re|mi|fa|sol|la|si)/gi,  // "SIm/RE" → "Sim/Re"
  (_, before, note) => before + note[0].toUpperCase() + note.slice(1).toLowerCase());
const sheetChords = url => {
  const content = preloaded[url]?.content || '';
  const names = [...content.matchAll(/<span class="chord">([^<]+)<\/span>/g)].map(m => m[1].trim());
  const latin = names.filter(c => LATIN.test(c)).length > names.filter(c => ENGLISH.test(c)).length;
  const chords = names.filter(c => (latin ? LATIN : ENGLISH).test(c))
    .map(c => sharpChord(latin ? latinCase(c) : c));
  const capo = content.match(/Capo[^<\d]*(\d+)/);
  return { chords: [...new Set(chords)], capo: capo ? Number(capo[1]) : null };
};
const paginas = { canciones: {}, videos: {} };
for (const song of songs) {
  const artist = song.folder !== 'Otros' ? song.folder : null;
  const pagina = { url: `${site}cancion/${song.slug}/`, title: song.title, artist, ...sheetChords(song.url) };
  // By name, for a video just uploaded that the repertoire doesn't know yet
  if (artist) paginas.canciones[`${normKey(artist)}|${normKey(song.title)}`] = pagina;
  for (const [version, track] of Object.entries(backingTracks[song.url] || {})) {
    paginas.videos[track.id] = { ...pagina, version };
  }
}
writeFileSync(new URL('paginas_videos.json', dist), JSON.stringify(paginas));

writeFileSync(new URL('404.html', dist), template);
writeFileSync(new URL('sitemap.xml', dist), [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  `  <url><loc>${site}</loc></url>`,
  ...songs.map(s => `  <url><loc>${site}cancion/${s.slug}/</loc></url>`),
  '</urlset>', '',
].join('\n'));
console.log(`Páginas de canciones: ${songs.length} (más 404.html, sitemap.xml y paginas_videos.json con ${Object.keys(paginas.videos).length} videos)`);
