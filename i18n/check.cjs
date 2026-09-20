// Checks the language packs: every language has exactly the keys English has, every line's {placeholders} survive the
// translation, and nothing is left in English by mistake. Run: node i18n/check.cjs
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'));
const enKeys = Object.keys(en);
const codes = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')).sort();
const holes = (line) => (String(line).match(/\{(\w+)\}/g) ?? []).sort().join(',');

let problems = 0;
const report = (code, what) => { problems += 1; console.log(`${code}: ${what}`); };

for (const code of codes) {
  const pack = JSON.parse(fs.readFileSync(path.join(dir, `${code}.json`), 'utf8'));
  const keys = Object.keys(pack);
  const missing = enKeys.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !enKeys.includes(k));
  if (missing.length) report(code, `${missing.length} words missing: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''}`);
  if (extra.length) report(code, `${extra.length} words that English does not have: ${extra.slice(0, 5).join(', ')}`);
  const wrongHoles = enKeys.filter((k) => pack[k] && holes(pack[k]) !== holes(en[k]));
  if (wrongHoles.length) report(code, `values in {curly brackets} changed in: ${wrongHoles.slice(0, 5).join(', ')}`);
  const empty = enKeys.filter((k) => typeof pack[k] === 'string' && pack[k].trim() === '');
  if (empty.length) report(code, `${empty.length} empty lines: ${empty.slice(0, 5).join(', ')}`);
  if (code !== 'en') {
    const long = enKeys.filter((k) => en[k].length > 25);
    const same = long.filter((k) => pack[k] === en[k]);
    if (same.length > long.length * 0.5) report(code, `${same.length} long lines are still word for word the English (is it translated?)`);
  }
}

// and every key the app asks for exists in English
const app = fs.readFileSync(path.join(dir, '..', 'App.js'), 'utf8');
const used = new Set();
for (const m of app.matchAll(/\bt\('([^']+)'/g)) used.add(m[1]);
for (const m of app.matchAll(/\bt\(`([^`$]+)`/g)) used.add(m[1]);
const unknown = [...used].filter((k) => !enKeys.includes(k));
if (unknown.length) report('App.js', `asks for words that English does not have: ${unknown.join(', ')}`);

console.log(problems === 0 ? `ok: ${codes.length} languages, ${enKeys.length} words each` : `${problems} problems`);
process.exit(problems ? 1 : 0);
