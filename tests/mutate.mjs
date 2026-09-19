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
  // ---- asking a school about admissions ----
  ['a one-word question is sent to the school', String.raw`if (len < MIN_ENQUIRY) return `, String.raw`if (false) return `],
  ['a question longer than the database allows is sent anyway', String.raw`  if (len > MAX_ENQUIRY) return `, String.raw`  if (false) return `],
  ['the class chosen never reaches the school', String.raw`  const g = (grade ?? '').trim();`, String.raw`  const g = '';`],
  ['a very long class name makes a subject the database will refuse', String.raw`.slice(0, 120);`, String.raw`;`],
  ['the years offered start in the past', String.raw`  return [y, y + 1, y + 2];`, String.raw`  return [y - 1, y, y + 1];`],
  ['the question is sent untrimmed', String.raw`p_message: (form.message ?? '').trim(),`, String.raw`p_message: form.message ?? '',`],
  ['no class chosen is sent as empty text instead of nothing', String.raw`p_grade: form.grade ? form.grade : null,`, String.raw`p_grade: form.grade,`],
  ['every enquiry looks unread', String.raw`const unreadCount = (threads) => (threads ?? []).filter((t) => t.unread_for_parent).length;`, String.raw`const unreadCount = (threads) => (threads ?? []).length;`],
  ['the school\'s messages look like the parent\'s own', String.raw`const fromMe = (message, myId) => !!myId && message?.sender_id === myId;`, String.raw`const fromMe = () => true;`],
  ['the state of an enquiry is described wrongly', String.raw`  if (status === 'replied') return 'They have replied';`, String.raw`  if (status === 'replied') return 'Waiting for a reply';`],
  ['the enquiry list is oldest first', String.raw`.order('last_message_at', { ascending: false }).limit(100);`, String.raw`.order('last_message_at', { ascending: true }).limit(100);`],
  ['a school page looks up every enquiry, not just its own', String.raw`.eq('school_id', schoolId).order('last_message_at', { ascending: false }).limit(1);`, String.raw`.order('last_message_at', { ascending: false }).limit(1);`],
  ['a conversation is shown newest message first', String.raw`.eq('ticket_id', ticketId).order('created_at', { ascending: true }).limit(200);`, String.raw`.eq('ticket_id', ticketId).order('created_at', { ascending: false }).limit(200);`],
  ['a reply is sent untrimmed', String.raw`db.from('ticket_messages').insert({ ticket_id: ticketId, message: (text ?? '').trim() });`, String.raw`db.from('ticket_messages').insert({ ticket_id: ticketId, message: text ?? '' });`],
  ['closing an enquiry sends the wrong status', String.raw`db.rpc('set_ticket_status', { p_ticket: ticketId, p_status: 'closed' });`, String.raw`db.rpc('set_ticket_status', { p_ticket: ticketId, p_status: 'open' });`],
  ['the app asks the database who the staff member is', String.raw`const MESSAGE_COLUMNS = 'id,sender_id,message,created_at';`, String.raw`const MESSAGE_COLUMNS = 'id,sender_id,message,created_at,profiles(first_name,last_name,email)';`],
  ['the unread mark is never asked for', String.raw`const ENQUIRY_COLUMNS = 'id,school_id,school_name,subject,grade_of_interest,start_year,status,created_at,last_message_at,message_count,last_message,unread_for_parent';`, String.raw`const ENQUIRY_COLUMNS = 'id,school_id,school_name,subject,grade_of_interest,start_year,status,created_at,last_message_at,message_count,last_message';`],
  ['asking the same school twice shows a raw database message', String.raw`  if (/an enquiry with this school is already open/i.test(msg)) return 'You already have an open enquiry with this school. Open it under Enquiries to carry on there.';`, ''],
  ['a missing enquiry function is reported as the near-me one', [[String.raw`  // the enquiry screens ask first: a "function not found" from them must not be reported as the near-me one
  if (context === 'enquiry' && isMissingEnquiries(error)) return ENQUIRIES_MISSING_TEXT;
  if (isMissingNearby(error)) return NEARBY_MISSING_TEXT;`, String.raw`  if (isMissingNearby(error)) return NEARBY_MISSING_TEXT;
  if (context === 'enquiry' && isMissingEnquiries(error)) return ENQUIRIES_MISSING_TEXT;`]]],
  ['the question is sent without being checked first', String.raw`    const problem = validateEnquiry({ message });
    if (problem) { setError(problem); return; }`, ''],
  ['opening a conversation does not mark it read', String.raw`if (thread.unread_for_parent) { await markEnquiryRead(supabase, thread.id); onChanged?.(); }`, ''],
  ['the reply box keeps what was already sent', String.raw`    setReply('');
    const again = await loadEnquiryMessages(supabase, thread.id);`, String.raw`    const again = await loadEnquiryMessages(supabase, thread.id);`],
  ['the school page offers the form again even when an enquiry is open', String.raw`{(!enquiry || enquiry.status === 'closed') && !askForm && (`, String.raw`{!askForm && (`],
  ['the top bar never shows how many replies are waiting', String.raw`label={unread > 0 ? `, String.raw`label={false ? `],
  ['signing out leaves the last person\'s unread count on screen', String.raw`if (!next) { setSchool(null); setShowEnquiries(false); setUnread(0); }`, String.raw`if (!next) { setSchool(null); setShowEnquiries(false); }`],
  // ---- drive times by car ----
  ['drive times are fetched without the parent asking', String.raw`const [driveMode, setDriveMode] = useState(null);`, String.raw`const [driveMode, setDriveMode] = useState('school_run');`],
  ['schools already answered are asked about again', String.raw`!(driveKey(place, mode, r.id) in (known ?? {}))`, String.raw`true`],
  ['a school being fetched is asked about twice', String.raw` && !pending?.has?.(driveKey(place, mode, r.id))`, ''],
  ['schools without a distance are sent to Google', String.raw`.filter((r) => typeof r.distance_km === 'number' && `, String.raw`.filter((r) => `],
  ['more than 20 schools go in one lookup', String.raw`    .slice(0, max);`, String.raw`    ;`],
  ['the time of day chosen is not sent', String.raw`schoolIds: ids, when: mode } });`, String.raw`schoolIds: ids, when: 'now' } });`],
  ['a refused lookup keeps asking', String.raw`        setDriveMode(null); // stop asking; the parent can tap again once the problem is gone`, ''],
  ['a school with no road is asked about again and again', String.raw`ids.forEach((id) => { next[driveKey(where, mode, id)] = res.times[id] ?? null; });`, String.raw`ids.forEach((id) => { if (res.times[id]) next[driveKey(where, mode, id)] = res.times[id]; });`],
  ['the parent is not warned when lookups run low', String.raw`if (typeof res.lookupsLeft === 'number' && res.lookupsLeft <= 3) {`, String.raw`if (false) {`],
  ['"1 lookups left"', String.raw`res.lookupsLeft === 1 ? 'lookup' : 'lookups'`, String.raw`'lookups'`],
  ['turning the location off leaves drive times on', String.raw`    setLocationNote(null);
    setDriveMode(null);
`, String.raw`    setLocationNote(null);
`],
  ['cards never show the drive time', String.raw`{!!driving && `, String.raw`{false && `],
  ['the school page forgets the time of day', String.raw`DRIVE_MODES.find((m) => m.key === school.driveMode)?.long ?? 'leaving now'`, String.raw`'leaving now'`],
  ['an hour-long drive is shown in minutes only', String.raw`  if (m < 60) return `, String.raw`  if (true) return `],
  ['a very short drive shows 0 min', String.raw`const m = Math.max(1, Math.round(t.minutes));`, String.raw`const m = Math.round(t.minutes);`],
  ['a function that is not deployed is reported as a general failure', String.raw`    if (error.context?.status === 404) return { ok: false, code: 'not_deployed' };
`, ''],
  ['the privacy note about Google is dropped', String.raw`Worked out by Google Maps from your approximate location, which Kidscover does not store.`, String.raw`Worked out by Google Maps.`],
  ['tapping the chosen time of day again does not turn it off', String.raw`setDriveMode(driveMode === m.key ? null : m.key)`, String.raw`setDriveMode(m.key)`],
  ['a setup problem at Google is shown to parents as a passing failure', String.raw`    case 'routes_not_enabled':
`, ''],
  ['drive times from one place are reused for another', 'const driveKey = (place, mode, id) => `${place.lat},${place.lng}|${mode}|${id}`;', 'const driveKey = (place, mode, id) => `${mode}|${id}`;'],
  // ---- boards and admissions ----
  ['the board filter is ignored', 'if (BOARD_CHOICES.includes(f.board)) {', 'if (false) {'],
  ['"also show unknown boards" does the opposite', 'q = f.includeUnknownBoard ? q.or(', 'q = !f.includeUnknownBoard ? q.or('],
  ['a two-word board is sent unquoted', 'boards.ov.{"${f.board}"}', 'boards.ov.{${f.board}}'],
  ['any text is accepted as a board', 'if (BOARD_CHOICES.includes(f.board)) {', 'if (f.board) {'],
  ['a chosen board is not counted as a filter', ' + (g.board ? 1 : 0)', ''],
  ['unknown boards are included by default', "board: null, includeUnknownBoard: false, category: 'school' };", "board: null, includeUnknownBoard: true, category: 'school' };"],
  ['an admission status without a source is shown', "if (!school || !school.admissions_source_url || typeof school.admissions_open !== 'boolean') return '';", "if (!school || typeof school.admissions_open !== 'boolean') return '';"],
  ['closed admissions are shown as open', "const what = school.admissions_open ? 'Admissions open' : 'Admissions closed';", "const what = 'Admissions open';"],
  ['the open badge shows on closed schools', '{!!admissionText(school) && school.admissions_open && ', '{!!admissionText(school) && '],
  ['a CBSE-confirmed board is described as from the website', "if (source === 'CBSE directory') return \"confirmed by CBSE's own record\";", "if (source === 'CBSE directory') return \"from the school's website\";"],
  ['a "see where" link is shown with nowhere to go', '{!!safeUrl(school.board_source_url) && <Text testID="board-source-link"', '{true && <Text testID="board-source-link"'],
  ['the unknown-board switch shows without a board', '{!!filters.board && (', '{true && ('],
  ['the board facts are not asked for', "+ 'boards,board_source,board_source_url,", "+ 'board_source,board_source_url,"],
  // ---- categories ----
  ["the list is not limited to one category", "  q = q.eq('category', f.category);", "  q = q;"],
  ["an unknown category is passed on as it is", "const categoryOf = (key) => CATEGORY_CHOICES.find((c) => c.key === key) ?? CATEGORY_CHOICES[0];", "const categoryOf = (key) => CATEGORY_CHOICES.find((c) => c.key === key) ?? { key, label: key, noun: key };"],
  ["level / daycare / board still apply to classes and colleges", "  return category === 'school' ? { ...f, category } : { ...f, category, level: null, daycare: false, board: null, includeUnknownBoard: false };", "  return { ...f, category };"],
  ["switching category clears the school filters instead of setting them aside", "onPress={() => set({ category: c.key })}", "onPress={() => set({ category: c.key, level: null, daycare: false, board: null })}"],
  ["set-aside filters are counted", "  const g = categoryFilters(normalizeFilters(f, hasPlace));", "  const g = normalizeFilters(f, hasPlace);"],
  ["\"Clear filters\" goes back to Schools", "setFilters({ ...DEFAULT_FILTERS, category: cat.key, sort: defaultSort(hasPlace) })", "setFilters({ ...DEFAULT_FILTERS, sort: defaultSort(hasPlace) })"],
  ["classes and colleges show the Level / Daycare / Board filters", "          {cat.key === 'school' && (<>", "          {true && (<>"],
  ["a class card shows school level badges", "        {isSchoolPlace(school) && levelBadges(school.levels).map(", "        {levelBadges(school.levels).map("],
  ["a class page offers admission enquiries", "      {isSchoolPlace(school) && (<>\n      <Text style={[s.h2, { marginTop: 20 }]}>Admissions</Text>", "      {true && (<>\n      <Text style={[s.h2, { marginTop: 20 }]}>Admissions</Text>"],
  ["a place with no category is not treated as a school", "const isSchoolPlace = (school) => categoryOf(school?.category).key === 'school';", "const isSchoolPlace = (school) => school?.category === 'school';"],
  ["the category is not asked for", "google_rating,google_review_count,category,", "google_rating,google_review_count,"],
  ["the empty list always says \"schools\"", "`No ${cat.noun} match. Try removing a filter.`", "'No schools match. Try removing a filter.'"],
  ["the search box always says \"school name\"", "placeholder={cat.key === 'school' ? 'Search by school name or area' : `Search ${cat.noun} by name or area`}", "placeholder=\"Search by school name or area\""],
  ["the app opens on After-school classes", "includeUnknownBoard: false, category: 'school' };", "includeUnknownBoard: false, category: 'after_school' };"],
  ["the chosen category is not shown as chosen", "selected={cat.key === c.key}", "selected={c.key === 'school'}"],
];

const run = (file) => { try { return execSync(`node tests/${file}`, { cwd: root, encoding: 'utf8', env: { ...process.env, APP_FILE: out }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 200000 }); } catch (e) { return (e.stdout || '') + (e.stderr || ''); } };
const failsOf = (o) => o.split('\n').filter((l) => l.startsWith('FAIL'));
const summary = (o) => o.split('\n').find((l) => /\d+ passed, \d+ failed/.test(l)) || 'no summary (crashed)';

fs.mkdirSync(path.join(here, '.tmp'), { recursive: true });
// The whole run takes a while (every breakage runs the test suites). MUT_RANGE=1-25 runs part of it, so several
// copies of the repo can share the work: MUT_RANGE=1-25, MUT_RANGE=26-50, and so on.
const [lo, hi] = (process.env.MUT_RANGE ?? '1-9999').split('-').map(Number);
for (const [i, [name, from, to]] of mutations.entries()) {
  if (i + 1 < lo || i + 1 > hi) continue;
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
