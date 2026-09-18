// Breaks App.js on purpose, one way at a time, and checks the tests notice. Run: node tests/mutate.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const src = fs.readFileSync(path.join(root, 'App.js'), 'utf8');
const out = path.join(here, '.tmp', 'mutant.App.js');

const mutations = [
  ['hidden places are no longer filtered out', String.raw`let q = query.eq('is_hidden', false);`, String.raw`let q = query;`],
  ['the level filter matches the wrong way (contains instead of overlaps)', String.raw`else if (f.level) q = q.overlaps('levels', [f.level]);`, String.raw`else if (f.level) q = q.contains('levels', [f.level]);`],
  ['"include unrated" does the opposite',
    'q = f.includeUnrated ? q.or(`google_rating.gte.${f.minRating},google_rating.is.null`) : q.gte(\'google_rating\', f.minRating);',
    'q = f.includeUnrated ? q.gte(\'google_rating\', f.minRating) : q.or(`google_rating.gte.${f.minRating},google_rating.is.null`);'],
  ['the public review list stops asking for published reviews only', String.raw`.eq('school_id', schoolId).eq('status', 'published')`, String.raw`.eq('school_id', schoolId)`],
  ['a new review is sent with status published', String.raw`const submitReview = (db, schoolId, f) => db.from('school_reviews').insert({ school_id: schoolId, ...reviewFields(f) });`, String.raw`const submitReview = (db, schoolId, f) => db.from('school_reviews').insert({ school_id: schoolId, status: 'published', ...reviewFields(f) });`],
  ['a parent is offered Report on their own review', String.raw`{mine?.id !== r.id && !reportMsg[r.id] && (`, String.raw`{!reportMsg[r.id] && (`],
  ['the sign-in gate is removed', String.raw`  if (!session) return <View style={s.root}><AuthScreen /></View>;
`, ''],
  ['review validation is skipped', String.raw`    if (problem) { setError(problem); return; }
    setBusy(true);
    setError('');
    const res = initial`, String.raw`    setBusy(true);
    setError('');
    const res = initial`],
  ['"Show more schools" asks for the same page again', String.raw`run(pageRef.current + 1, true)`, String.raw`run(pageRef.current, true)`],
  ['deleting a review does not refresh the screen', String.raw`else { setConfirmDelete(false); setMessage('Your review was deleted.'); reload(); }`, String.raw`else { setConfirmDelete(false); setMessage('Your review was deleted.'); }`],
  ['the website link skips the safety check', String.raw`Linking.openURL(site)`, String.raw`Linking.openURL(school.website)`],
  ['school names are shown raw again on the list', String.raw`<Text style={s.schoolName}>{cleanName(school.name)}</Text>`, String.raw`<Text style={s.schoolName}>{school.name}</Text>`],
  ['the name tidier stops removing the text after a pipe', String.raw`.split(/(?:^|\s)\|(?:\s|$)/).map((p) => p.trim()).filter(Boolean)[0] ?? ''`, String.raw`.trim()`],
  ['the id tie-break is dropped, so equal names can repeat or skip between pages', String.raw`return q.order('id', { ascending: true });`, String.raw`return q;`],
  ['the list sorts by the raw name again', String.raw`q = q.order('name_sort', { ascending: true });`, String.raw`q = q.order('name', { ascending: true });`],
  ['search text is not cleaned before it goes into a filter', String.raw`const term = sanitizeSearch(f.search);`, String.raw`const term = String(f.search ?? '');`],
];

const run = (file) => { try { return execSync(`node tests/${file}`, { cwd: root, encoding: 'utf8', env: { ...process.env, APP_FILE: out }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 200000 }); } catch (e) { return (e.stdout || '') + (e.stderr || ''); } };
const failsOf = (o) => o.split('\n').filter((l) => l.startsWith('FAIL'));
const summary = (o) => o.split('\n').find((l) => /\d+ passed, \d+ failed/.test(l)) || 'no summary (crashed)';

fs.mkdirSync(path.join(here, '.tmp'), { recursive: true });
for (const [name, from, to] of mutations) {
  if (!src.includes(from)) { console.log('NOT APPLIED  ' + name); continue; }
  fs.writeFileSync(out, src.replace(from, to));
  let o = run('logic.test.mjs'), where = 'logic tests';
  if (!failsOf(o).length && !/no summary/.test(summary(o))) { o = run('ui.test.mjs'); where = 'screen tests'; }
  const f = failsOf(o);
  console.log(`${f.length || /no summary/.test(summary(o)) ? 'CAUGHT ' : 'MISSED '} ${name}  [${where}] ${summary(o)}`);
  if (f[0]) console.log('        ' + f[0].slice(0, 130));
}
