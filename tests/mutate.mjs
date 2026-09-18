// Breaks App.js on purpose, one way at a time, and checks the tests notice. Run: node tests/mutate.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const src = fs.readFileSync(path.join(root, 'App.js'), 'utf8').replace(/\r\n/g, '\n'); // the patterns below are written with plain line ends
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
  // ---- schools near me ----
  ['the distance limit is not applied', String.raw`if (hasPlace && f.nearKm > 0) q = q.lte('distance_km', f.nearKm);`, ''],
  ['"within N km" keeps the schools farther away instead', String.raw`q = q.lte('distance_km', f.nearKm);`, String.raw`q = q.gte('distance_km', f.nearKm);`],
  ['nearest first lists the farthest first', String.raw`q = q.order('distance_km', { ascending: true });`, String.raw`q = q.order('distance_km', { ascending: false });`],
  ['the position is sent unrounded', String.raw`const place = { lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000 };`, String.raw`const place = { lat, lng };`],
  ['a missing (null) latitude is accepted and becomes 0', String.raw`if (typeof lat !== 'number' || typeof lng !== 'number') return { ok: false, reason: 'unavailable' };`, ''],
  ['the phone is asked for a position even when permission was refused', String.raw`if (perm?.status !== 'granted') return { ok: false, reason: perm?.canAskAgain === false ? 'blocked' : 'denied' };`, ''],
  ['there is no time limit on waiting for the phone', String.raw`await withTimeout(loc.getCurrentPositionAsync({ accuracy: loc.Accuracy?.Balanced }), timeoutMs)`, String.raw`await loc.getCurrentPositionAsync({ accuracy: loc.Accuracy?.Balanced })`],
  ['a permission that is blocked for good is described as a simple refusal', String.raw`perm?.canAskAgain === false ? 'blocked' : 'denied'`, String.raw`'denied'`],
  ['a missing database function shows the raw database message', String.raw`  if (isMissingNearby(error)) return NEARBY_MISSING_TEXT;`, ''],
  ['a missing database function leaves the parent on a dead list', String.raw`if (res.error && where && isMissingNearby(res.error)) {`, String.raw`if (false) {`],
  ['with a position the app still reads the plain schools table', String.raw`const base = hasPlace`, String.raw`const base = false`],
  ['the position latitude and longitude are swapped when asking the database', String.raw`{ p_lat: place.lat, p_lng: place.lng }`, String.raw`{ p_lat: place.lng, p_lng: place.lat }`],
  ['the wrong database function name is called', String.raw`db.rpc('schools_nearby'`, String.raw`db.rpc('school_nearby'`],
  ['a left-over "nearest first" reaches the schools table (both safety nets removed)', [[String.raw`const sort = f.sort === 'distance' && !hasPlace ? 'name' : f.sort;`, String.raw`const sort = f.sort;`], [String.raw`applySchoolFilters(base, normalizeFilters(filters, hasPlace), hasPlace)`, String.raw`applySchoolFilters(base, filters, hasPlace)`]]],
  ['Plus Codes are shown', String.raw`const rest = a.replace(/^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}(?:\s*,\s*|\s+|$)/, '').trim();`, String.raw`const rest = a;`],
  ['the Plus Code rule also eats ordinary short prefixes like "C+22"', String.raw`{4,8}\+`, String.raw`{1,8}\+`],
  ['9.96 km is shown as "10.0 km"', String.raw`return tenth < 10 ?`, String.raw`return km < 10 ?`],
  ['very short distances are shown as "0.0 km"', String.raw`  if (km < 0.1) return 'Under 100 m away';`, ''],
  ['the level tags stretch to equal height again', String.raw`badgeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 6, marginVertical: 4 },`, String.raw`badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 4 },`],
  ['the list cards do not show the distance', '{!!distance && <Text testID={`distance-${school.id}`} style={s.distance}>{distance}</Text>}', ''],
  ['the school page does not show the distance', String.raw`{!!distanceText(school.distance_km) && <Text testID="school-distance" style={s.distance}>{distanceText(school.distance_km)}</Text>}`, ''],
  ['the list cards show the raw address', String.raw`{!!address && <Text style={s.muted} numberOfLines={2}>{address}</Text>}`, String.raw`{!!school.address && <Text style={s.muted} numberOfLines={2}>{school.address}</Text>}`],
  ['the school page shows the raw address', String.raw`{!!cleanAddress(school.address) && <Text style={s.body}>{cleanAddress(school.address)}</Text>}`, String.raw`{!!school.address && <Text style={s.body}>{school.address}</Text>}`],
  ['Stop leaves the distance choices behind', String.raw`    setFilters((f) => normalizeFilters(f, false));`, ''],
  ['the location is saved on the phone', String.raw`    setPlace(res.place);`, String.raw`    setPlace(res.place); AsyncStorage.setItem('place', JSON.stringify(res.place));`],
  ['the "outside Mumbai" note never appears', String.raw`    if (!inServiceArea(res.place)) setLocationNote({ tone: 'amber', text: OUTSIDE_AREA_TEXT });`, ''],
  ['a place in Delhi counts as inside the area', String.raw`p.lng <= SERVICE_AREA.lngMax`, String.raw`p.lng <= SERVICE_AREA.lngMax + 10`],
  ['the empty list ignores the distance limit in its message', String.raw`{hasPlace && filters.nearKm ?`, String.raw`{false ?`],
  ['the location button can be tapped again while it is working', String.raw`onPress={useMyLocation} disabled={locating}`, String.raw`onPress={useMyLocation}`],
  ['Clear filters goes back to A to Z even while sharing a location', String.raw`sort: defaultSort(hasPlace) })}`, String.raw`sort: 'name' })}`],
  ['"Nearest first" is offered even without a location', String.raw`{hasPlace && <Chip testID="sort-distance"`, String.raw`{true && <Chip testID="sort-distance"`],
  ['sharing a location does not switch the list to nearest first', String.raw`    set({ sort: 'distance' }); // they asked for schools near them, so show the nearest first`, ''],
  ['nearest first is counted as a filter even though it is the normal order', String.raw`(g.sort !== defaultSort(hasPlace) ? 1 : 0)`, String.raw`(g.sort !== 'name' ? 1 : 0)`],
  ['a broken position object is accepted (no finite / range check)', String.raw`Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;`, String.raw`true;`],
];

const run = (file) => { try { return execSync(`node tests/${file}`, { cwd: root, encoding: 'utf8', env: { ...process.env, APP_FILE: out }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 200000 }); } catch (e) { return (e.stdout || '') + (e.stderr || ''); } };
const failsOf = (o) => o.split('\n').filter((l) => l.startsWith('FAIL'));
const summary = (o) => o.split('\n').find((l) => /\d+ passed, \d+ failed/.test(l)) || 'no summary (crashed)';

fs.mkdirSync(path.join(here, '.tmp'), { recursive: true });
for (const [name, from, to] of mutations) {
  const pairs = Array.isArray(from) ? from : [[from, to]]; // one breakage may touch several places
  if (!pairs.every(([a]) => src.includes(a))) { console.log('NOT APPLIED  ' + name); continue; }
  let mutated = src;
  for (const [a, b] of pairs) mutated = mutated.replace(a, () => b);
  if (mutated === src) { console.log('NOT APPLIED (no change)  ' + name); continue; }
  fs.writeFileSync(out, mutated);
  let o = run('logic.test.mjs'), where = 'logic tests';
  if (!failsOf(o).length && !/no summary/.test(summary(o))) { o = run('ui.test.mjs'); where = 'screen tests'; }
  const f = failsOf(o);
  console.log(`${f.length || /no summary/.test(summary(o)) ? 'CAUGHT ' : 'MISSED '} ${name}  [${where}] ${summary(o)}`);
  if (f[0]) console.log('        ' + f[0].slice(0, 130));
}
