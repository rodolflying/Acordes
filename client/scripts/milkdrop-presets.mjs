// The MilkDrop presets the background offers (Visualizer.jsx), taken from butterchurn-presets into a small
// public/visuals/presets.json: only these are downloaded, and only when the background is on.
// Each one says which song themes it suits, so a song starts with a preset that fits it.
// Run after changing the list:  node scripts/milkdrop-presets.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const pack = require('butterchurn-presets/lib/butterchurnPresets.min.js');
const all = (pack.default || pack).getPresets();

// [preset, themes it suits]. Chosen from a contact sheet of the base pack for looking like the Windows Media
// Player classics (fire, plasma, tunnels, swirls, kaleidoscopes) and staying easy on the eyes behind the
// lyrics. A song starts with the first one that suits its theme
const CHOSEN = [
  ['Cope - The Neverending Explosion of Red Liquid Fire', ['Fiesta', 'Protesta']],
  ['Rovastar - Oozing Resistance', ['Desamor', 'Naturaleza']],
  ['Flexi - infused with the spiral', ['Amor', 'Existencial']],
  ['Goody - The Wild Vort', ['Protesta']],
  ['Krash + Illusion - Spiral Movement', ['Libertad']],
  ['flexi - swing out on the spiral', ['Cotidiano', 'Fiesta']],
  ['Unchained & Rovastar - Wormhole Pillars (Hall of Shadows mix)', ['Desamor']],
  ['Aderrasi - Potion of Spirits', ['Amor', 'Naturaleza']],
  ['Phat+fiShbRaiN+Eo.S_Mandala_Chasers_remix', ['Fiesta']],
  ['Zylot - True Visionary (Final Mix)', ['Existencial', 'Libertad']],
  ['Eo.S. + Zylot - skylight (Stained Glass Majesty mix)', ['Libertad']],
  ['Flexi - mindblob mix', ['Desamor', 'Amor']],
  ['Flexi, martin + geiss - dedicated to the sherwin maxawow', ['Cotidiano', 'Existencial']],
];

const presets = CHOSEN.map(([name, themes]) => {
  if (!all[name]) throw new Error(`No existe el preset: ${name}`);
  return { name, themes, preset: all[name] };
});
const out = new URL('../public/visuals/presets.json', import.meta.url);
writeFileSync(out, JSON.stringify(presets));
console.log(`${presets.length} presets → public/visuals/presets.json (${Math.round(JSON.stringify(presets).length / 1024)} KB)`);
