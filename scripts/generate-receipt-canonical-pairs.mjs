// Keep the receipt server dictionary compatible with the older Pages bundler.
// Input contains public catalogue data; output deliberately includes keys only.
import {readFileSync, writeFileSync} from 'node:fs';

const source = new URL('../ingredient-pack-catalog.json', import.meta.url);
const destination = new URL('../bb-server-lib/bb-receipt-canonical-pairs.js', import.meta.url);
const catalog = JSON.parse(readFileSync(source, 'utf8'));
const pairs = Object.keys(catalog.ingredients).sort();
const output = '// Generated from the public ingredient-pack-catalog.json by scripts/generate-receipt-canonical-pairs.mjs.\n' +
  '// Canonical ingredient/unit keys only: no prices or private recipe data.\n' +
  'export const receiptCanonicalPairs = Object.freeze(' + JSON.stringify(pairs, null, 2) + ');\n';
writeFileSync(destination, output);
