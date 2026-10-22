// After `vite build`: one HTML page per song (dist/cancion/artista/titulo/index.html) with its own
// title, description and picture, so a link in a YouTube description or on WhatsApp shows the song;
// 404.html, which GitHub Pages serves for any other address, and a sitemap for search engines.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildSongs, pickBest, isViewable } from '../src/catalog.js';

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

writeFileSync(new URL('404.html', dist), template);
writeFileSync(new URL('sitemap.xml', dist), [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  `  <url><loc>${site}</loc></url>`,
  ...songs.map(s => `  <url><loc>${site}cancion/${s.slug}/</loc></url>`),
  '</urlset>', '',
].join('\n'));
console.log(`Páginas de canciones: ${songs.length} (más 404.html y sitemap.xml)`);
