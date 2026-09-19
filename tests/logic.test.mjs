// Tests for the pure logic inside App.js (between the BEGIN / END markers). Run: node tests/logic.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(process.env.APP_FILE ?? path.join(here, '..', 'App.js'), 'utf8');
const a = src.indexOf('// ==== BEGIN pure logic'), b = src.indexOf('// ==== END pure logic');
if (a < 0 || b < 0) throw new Error('markers not found in App.js');
fs.mkdirSync(path.join(here, '.tmp'), { recursive: true });
const names = ['sanitizeSearch', 'applySchoolFilters', 'activeFilterCount', 'levelBadges', 'googleRatingText', 'communityText', 'stars', 'safeUrl', 'validateAuth', 'validateReview', 'statusLine', 'cleanName', 'friendlyError', 'loadStats', 'loadSchools', 'loadReviews', 'loadMyReview', 'submitReview', 'updateReview', 'deleteReview', 'reportReview', 'DEFAULT_FILTERS', 'PAGE_SIZE', 'monthYear', 'SCHOOL_COLUMNS', 'NEARBY_COLUMNS', 'DISTANCE_CHOICES', 'SERVICE_AREA', 'validPlace', 'inServiceArea', 'defaultSort', 'normalizeFilters', 'distanceText', 'cleanAddress', 'isMissingNearby', 'locateMe', 'locationProblemText', 'OUTSIDE_AREA_TEXT', 'NEARBY_MISSING_TEXT',
  'ENQUIRY_COLUMNS', 'MESSAGE_COLUMNS', 'MAX_ENQUIRY', 'MIN_ENQUIRY', 'GRADE_CHOICES', 'startYearChoices', 'validateEnquiry', 'enquirySubject',
  'enquiryStatusText', 'enquiryAbout', 'unreadCount', 'fromMe', 'isMissingEnquiries', 'ENQUIRIES_MISSING_TEXT', 'sendEnquiry', 'loadEnquiries',
  'loadEnquiryForSchool', 'loadEnquiryMessages', 'replyToEnquiry', 'markEnquiryRead', 'closeEnquiry'];
fs.writeFileSync(path.join(here, '.tmp', 'logic.mjs'), src.slice(a, b) + `\nexport { ${names.join(', ')} };\n`);
const L = await import(pathToFileURL(path.join(here, '.tmp', 'logic.mjs')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? '  -> ' + String(detail).slice(0, 200) : ''}`); };
const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);

// a stand-in database: records every call in the chain, and answers with whatever the test provides
function fakeDb(handler) {
  const recs = [];
  const from = (table) => {
    const rec = { table, ops: [] }; recs.push(rec);
    const p = new Proxy(function () {}, { get(_, prop) { if (prop === 'then') return (res, rej) => Promise.resolve(handler(rec)).then(res, rej); return (...args) => { rec.ops.push([prop, ...args]); return p; }; } });
    return p;
  };
  const rpc = (fn, args) => {
    const rec = { table: 'rpc:' + fn, args, ops: [] }; recs.push(rec);
    const p = new Proxy(function () {}, { get(_, prop) { if (prop === 'then') return (res, rej) => Promise.resolve(handler(rec)).then(res, rej); return (...a) => { rec.ops.push([prop, ...a]); return p; }; } });
    return p;
  };
  return { from, rpc, recs };
}
const ops = (rec) => rec.ops.map((o) => o[0] + '(' + o.slice(1).map((x) => JSON.stringify(x)).join(',') + ')');
const filtersOf = (f, hasPlace = false) => { const db = fakeDb(() => ({ data: [], error: null })); const rec = { table: 'schools', ops: [] }; const p = new Proxy(function () {}, { get(_, prop) { return (...args) => { rec.ops.push([prop, ...args]); return p; }; } }); L.applySchoolFilters(p, { ...L.DEFAULT_FILTERS, ...f }, hasPlace); return ops(rec); };

console.log('\n=== search text is made safe ===');
check('filter-syntax characters are removed', L.sanitizeSearch('a,b(c)*d"e\\f%g') === 'a b c d e f g', L.sanitizeSearch('a,b(c)*d"e\\f%g'));
check('spaces are tidied, length capped at 60, null is fine', L.sanitizeSearch('  St.   Mary  ') === 'St. Mary' && L.sanitizeSearch('x'.repeat(200)).length === 60 && L.sanitizeSearch(null) === '');
check('an attempt to smuggle in a second filter comes out as plain words', !/[,()]/.test(L.sanitizeSearch('x),id.eq.1,(name.ilike.*')), L.sanitizeSearch('x),id.eq.1,(name.ilike.*'));

console.log('\n=== the parent\'s choices become database filters ===');
check('default: never shows hidden places, A to Z by the clean sort name, then id', eq(filtersOf({}), ['eq("is_hidden",false)', 'order("name_sort",{"ascending":true})', 'order("id",{"ascending":true})']), JSON.stringify(filtersOf({})));
check('every sort ends with an id tie-break, so equal names or ratings never repeat or skip between pages', filtersOf({}).at(-1) === 'order("id",{"ascending":true})' && filtersOf({ sort: 'rating' }).at(-1) === 'order("id",{"ascending":true})');
check('search looks in name AND address', filtersOf({ search: 'Bandra' }).includes('or("name.ilike.*Bandra*,address.ilike.*Bandra*")'), JSON.stringify(filtersOf({ search: 'Bandra' })));
check('a search with commas and brackets cannot break the filter', filtersOf({ search: 'a,b)' }).includes('or("name.ilike.*a b*,address.ilike.*a b*")'));
check('an empty or blank search adds no filter', !filtersOf({ search: '   ' }).some((x) => x.startsWith('or(')));
check('level: primary -> levels overlap', filtersOf({ level: 'primary' }).includes('overlaps("levels",["primary"])'));
check('level: not stated -> levels equal to the empty list', filtersOf({ level: 'none' }).includes('eq("levels","{}")'));
check('daycare switch -> levels contain daycare', filtersOf({ daycare: true }).includes('contains("levels",["daycare"])'));
check('level and daycare together are both applied', filtersOf({ level: 'preschool', daycare: true }).includes('overlaps("levels",["preschool"])') && filtersOf({ level: 'preschool', daycare: true }).includes('contains("levels",["daycare"])'));
check('rating 4+ while keeping unrated schools -> rating >= 4 OR no rating', filtersOf({ minRating: 4 }).includes('or("google_rating.gte.4,google_rating.is.null")'));
check('rating 4+ with unrated switched off -> rating >= 4 only', filtersOf({ minRating: 4, includeUnrated: false }).includes('gte("google_rating",4)') && !filtersOf({ minRating: 4, includeUnrated: false }).some((x) => x.startsWith('or(')));
check('any rating with unrated switched off -> only rated schools', filtersOf({ includeUnrated: false }).includes('not("google_rating","is",null)'));
check('best rated sorts by rating, then review count, unrated last, then id', filtersOf({ sort: 'rating' }).join('|').includes('order("google_rating",{"ascending":false,"nullsFirst":false})|order("google_review_count",{"ascending":false,"nullsFirst":false})|order("id",{"ascending":true})'), filtersOf({ sort: 'rating' }).join('|'));
check('filter count for the button label', L.activeFilterCount(L.DEFAULT_FILTERS) === 0 && L.activeFilterCount({ ...L.DEFAULT_FILTERS, level: 'primary', daycare: true, minRating: 4, includeUnrated: false, sort: 'rating' }) === 5);

console.log('\n=== wording ===');
check('level badges', eq(L.levelBadges(['daycare', 'preschool']), ['Preschool', 'Daycare available']) && eq(L.levelBadges([]), ['Level not stated']) && eq(L.levelBadges(null), []) && eq(L.levelBadges(['secondary', 'primary']), ['Primary', 'Secondary']));
check('Google rating text, including "no rating yet"', L.googleRatingText(null) === 'No Google rating yet' && L.googleRatingText(4.66, 118) === 'Google 4.7 ★ (118)' && L.googleRatingText(5, 0) === 'Google 5.0 ★');
check('parent rating text: nothing for no reviews, singular / plural otherwise', L.communityText(null) === null && L.communityText({ review_count: 0 }) === null && L.communityText({ review_count: 1, avg_rating: '4.5' }) === 'Parents 4.5 ★ (1 review)' && L.communityText({ review_count: 3, avg_rating: 3 }) === 'Parents 3.0 ★ (3 reviews)');
check('stars are clamped to 0-5', L.stars(4) === '★★★★☆' && L.stars(0) === '☆☆☆☆☆' && L.stars(9) === '★★★★★' && L.stars(undefined) === '☆☆☆☆☆');
check('month and year', L.monthYear('2026-09-18T10:00:00Z') === 'Sep 2026' && L.monthYear('nonsense') === '');
check('review status lines (the moderator note is shown when rejected)', /Waiting/.test(L.statusLine('pending')) && /without your name/.test(L.statusLine('published')) && /Not published: Please remove the name/.test(L.statusLine('rejected', 'Please remove the name')) && /removed/.test(L.statusLine('removed')));

console.log('\n=== school names are tidied for display ===');
const cn = L.cleanName;
check('emoji are removed, and the gaps closed (real name from the app)', cn('\u{1F60A}Smiling Kids Pre-school \u{1F60A} and \u{1F4DA}Eon International School \u{1F4DA}') === 'Smiling Kids Pre-school and Eon International School', cn('\u{1F60A}Smiling Kids Pre-school \u{1F60A} and \u{1F4DA}Eon International School \u{1F4DA}'));
check('search-engine text after a pipe is dropped (real name from the app)', cn('270 Degree Kids Preschool Kasarvadavali, Thane | Best Preschool In Kasarvadavali') === '270 Degree Kids Preschool Kasarvadavali, Thane');
check('several pipes: only the first part is kept', cn('Iqra Creative | Best pencil pouches | wholesaler') === 'Iqra Creative');
check('ordinary names are left exactly as they are, including dashes, commas, dots and brackets', ['Podar International School - Santacruz', "St. Xavier's High School, Fort", 'S.M.G Vidyamandir & Junior College', '(S.E.S) SITALDAS KHEMANI HIGH SCHOOL', 'NMMC School No.9'].every((x) => cn(x) === x));
check('a trailing separator left behind is removed', cn('Sunrise School - \u{1F31F}') === 'Sunrise School' && cn('Sunrise School |') === 'Sunrise School', JSON.stringify([cn('Sunrise School - \u{1F31F}'), cn('Sunrise School |')]));
check('a name that is only emoji, or empty, is never made blank', cn('\u{1F60A}\u{1F60A}') === '\u{1F60A}\u{1F60A}' && cn('') === '' && cn(null) === '');
check('a name that starts with a pipe uses the first real part', cn('| Real Name | ad') === 'Real Name', cn('| Real Name | ad'));
check('non-English names are untouched', cn('शारदा विद्यालय') === 'शारदा विद्यालय');

console.log('\n=== links ===');
check('website links are made safe', L.safeUrl('example.com') === 'https://example.com' && L.safeUrl('http://a.in/x') === 'http://a.in/x' && L.safeUrl('') === null && L.safeUrl(null) === null && L.safeUrl('javascript:alert(1)') === null && L.safeUrl('not a url') === null);

console.log('\n=== forms ===');
const auth = (o) => L.validateAuth({ mode: 'signin', first: '', last: '', email: 'a@b.co', password: 'x', ...o });
check('sign in: needs a valid email and a password', auth({}) === null && /valid email/.test(auth({ email: 'nope' })) && /password/.test(auth({ password: '' })));
check('sign up: needs both names and an 8-character password', /first and last name/.test(auth({ mode: 'signup', password: '12345678' })) && /8 characters/.test(auth({ mode: 'signup', first: 'A', last: 'B', password: '1234567' })) && auth({ mode: 'signup', first: 'A', last: 'B', password: '12345678' }) === null);
const rv = (o) => L.validateReview({ rating: 5, title: '', body: 'x'.repeat(20), ...o });
check('review: rating required', /stars/.test(rv({ rating: 0 })) && rv({}) === null);
check('review: 20 characters minimum (the count is shown), 2000 maximum, title 120', /at least 20 characters \(19 so far\)/.test(rv({ body: 'x'.repeat(19) })) && rv({ body: 'x'.repeat(2000) }) === null && /under 2000/.test(rv({ body: 'x'.repeat(2001) })) && /120/.test(rv({ title: 'x'.repeat(121) })));
check('review: spaces do not count towards the 20', /at least 20/.test(rv({ body: 'x'.repeat(10) + ' '.repeat(30) })));

console.log('\n=== errors are turned into plain language ===');
const fe = L.friendlyError;
check('wrong password / unconfirmed email / already registered / too many attempts', /do not match/.test(fe({ message: 'Invalid login credentials' })) && /confirm your email/.test(fe({ message: 'Email not confirmed' })) && /already has an account/.test(fe({ message: 'User already registered' })) && /Too many/.test(fe({ message: 'email rate limit exceeded' })));
check('no connection', /internet/.test(fe({ message: 'Network request failed' })) && /internet/.test(fe(new TypeError('Failed to fetch'))));
check('daily limit', /limit of 10/.test(fe({ message: 'daily review limit reached' })));
check('already reviewed (by code and by message)', /already reviewed/.test(fe({ code: '23505' }, 'review')) && /already reviewed/.test(fe({ message: 'duplicate key value violates unique constraint' }, 'review')));
check('reporting twice says so', /already reported/.test(fe({ code: '23505' }, 'report')));
check('unverified account (row level security) -> asks to confirm email; for a report -> cannot be reported', /confirm your email address/.test(fe({ code: '42501' }, 'review')) && /cannot be reported/.test(fe({ code: '42501' }, 'report')));
check('anything unknown is passed through, and an empty error still says something useful', fe({ message: 'Something odd' }) === 'Something odd' && /went wrong/.test(fe({})));

console.log('\n=== talking to the database ===');
const rows20 = Array.from({ length: 20 }, (_, i) => ({ id: 's' + i, name: 'S' + i }));
let db = fakeDb((rec) => (rec.table === 'schools' ? { data: rows20, error: null } : { data: [{ school_id: 's3', review_count: 2, avg_rating: '4.5' }], error: null }));
let res = await L.loadSchools(db, L.DEFAULT_FILTERS, 0);
check('first page asks for rows 0-19 and reports there may be more', db.recs[0].ops.some((o) => o[0] === 'range' && o[1] === 0 && o[2] === 19) && res.hasMore === true);
check('the parent star ratings are looked up for exactly those schools and attached', db.recs[1].table === 'school_review_stats' && db.recs[1].ops.some((o) => o[0] === 'in' && o[1] === 'school_id' && o[2].length === 20) && res.rows[3].community.review_count === 2 && res.rows[0].community === null);
res = await L.loadSchools(db, L.DEFAULT_FILTERS, 2);
check('page 3 asks for rows 40-59', db.recs.at(-2).ops.some((o) => o[0] === 'range' && o[1] === 40 && o[2] === 59));
db = fakeDb(() => ({ data: rows20.slice(0, 5), error: null }));
res = await L.loadSchools(db, L.DEFAULT_FILTERS, 0);
check('a short page means no more to show', res.hasMore === false && res.rows.length === 5);
db = fakeDb(() => ({ data: [], error: null }));
res = await L.loadSchools(db, L.DEFAULT_FILTERS, 0);
check('an empty result does not look up ratings at all', db.recs.length === 1 && res.rows.length === 0);
db = fakeDb(() => ({ data: null, error: { message: 'Network request failed' } }));
res = await L.loadSchools(db, L.DEFAULT_FILTERS, 0);
check('a failure is returned, not thrown', !!res.error && res.rows.length === 0 && res.hasMore === false);
db = fakeDb(() => ({ data: [], error: null })); await L.loadReviews(db, 'sch1');
check('only published reviews of that school, newest first', eq(ops(db.recs[0]).slice(1, 4), ['eq("school_id","sch1")', 'eq("status","published")', 'order("created_at",{"ascending":false})']), JSON.stringify(ops(db.recs[0])));
db = fakeDb((rec) => (rec.table === 'school_review_private' ? { data: null, error: null } : { data: null, error: null }));
res = await L.loadMyReview(db, 'sch1');
check('no review of my own -> null, and the second lookup is skipped', res.review === null && db.recs.length === 1);
db = fakeDb((rec) => (rec.table === 'school_review_private' ? { data: { review_id: 'r9', moderation_note: 'be kind' }, error: null } : { data: { id: 'r9', rating: 4, status: 'rejected' }, error: null }));
res = await L.loadMyReview(db, 'sch1');
check('my review is joined with the moderator note', res.review.id === 'r9' && res.review.moderation_note === 'be kind' && res.review.status === 'rejected');
const inserted = []; db = { from: (t) => ({ insert: (p) => { inserted.push([t, p]); return { error: null }; }, update: (p) => ({ eq: (c, v) => { inserted.push([t, 'update', p, c, v]); return { error: null }; } }), delete: () => ({ eq: (c, v) => { inserted.push([t, 'delete', c, v]); return { error: null }; } }) }) };
L.submitReview(db, 'sch1', { rating: 4, title: '  ', body: '  A long enough review body.  ', relationship: 'current_parent' });
L.updateReview(db, 'r1', { rating: 3, title: ' Fine ', body: 'Edited review text here ok.', relationship: 'other' });
L.deleteReview(db, 'r1'); L.reportReview(db, 'r1', 'spam');
check('a new review sends trimmed text, no title when blank, and only the allowed columns', eq(inserted[0], ['school_reviews', { school_id: 'sch1', rating: 4, title: null, body: 'A long enough review body.', relationship: 'current_parent' }]), JSON.stringify(inserted[0]));
check('an edit sends only the editable columns', eq(inserted[1], ['school_reviews', 'update', { rating: 3, title: 'Fine', body: 'Edited review text here ok.', relationship: 'other' }, 'id', 'r1']), JSON.stringify(inserted[1]));
check('delete and report go to the right tables', eq(inserted[2], ['school_reviews', 'delete', 'id', 'r1']) && eq(inserted[3], ['review_reports', { review_id: 'r1', reason: 'spam' }]));

console.log('\n=== near me: what is asked of the database ===');
check('with a place the default order is nearest first, then id', eq(filtersOf({ sort: 'distance' }, true), ['eq("is_hidden",false)', 'order("distance_km",{"ascending":true})', 'order("id",{"ascending":true})']), JSON.stringify(filtersOf({ sort: 'distance' }, true)));
check('"within 5 km" -> distance <= 5 (only with a place)', filtersOf({ sort: 'distance', nearKm: 5 }, true).includes('lte("distance_km",5)') && !filtersOf({ nearKm: 5 }, false).some((x) => x.includes('distance_km')));
check('no distance choice -> no distance filter', !filtersOf({ sort: 'distance' }, true).some((x) => x.startsWith('lte(')));
check('without a place, a left-over "nearest first" falls back to A to Z and never mentions distance', eq(filtersOf({ sort: 'distance', nearKm: 2 }, false), ['eq("is_hidden",false)', 'order("name_sort",{"ascending":true})', 'order("id",{"ascending":true})']), JSON.stringify(filtersOf({ sort: 'distance', nearKm: 2 }, false)));
check('with a place, A to Z and best rated still work', filtersOf({ sort: 'name' }, true).includes('order("name_sort",{"ascending":true})') && filtersOf({ sort: 'rating' }, true).includes('order("google_rating",{"ascending":false,"nullsFirst":false})'));
check('every order ends with an id tie-break, distance included', ['distance', 'name', 'rating'].every((sort) => filtersOf({ sort }, true).at(-1) === 'order("id",{"ascending":true})'));
check('distance works together with the other filters', ['overlaps("levels",["primary"])', 'lte("distance_km",5)', 'or("google_rating.gte.4,google_rating.is.null")'].every((x) => filtersOf({ sort: 'distance', nearKm: 5, level: 'primary', minRating: 4 }, true).includes(x)));
check('the choices are Any / 2 / 5 / 10 km', eq(L.DISTANCE_CHOICES.map((d) => d.km), [null, 2, 5, 10]));
check('filter count: nearest-first is the default with a place, so it is not counted', L.activeFilterCount({ ...L.DEFAULT_FILTERS, sort: 'distance' }, true) === 0 && L.activeFilterCount(L.DEFAULT_FILTERS, false) === 0);
check('filter count: a distance limit counts once; choosing A to Z with a place counts once', L.activeFilterCount({ ...L.DEFAULT_FILTERS, sort: 'distance', nearKm: 5 }, true) === 1 && L.activeFilterCount({ ...L.DEFAULT_FILTERS, sort: 'name' }, true) === 1);
check('filter count: without a place a left-over distance choice is ignored', L.activeFilterCount({ ...L.DEFAULT_FILTERS, sort: 'distance', nearKm: 5 }, false) === 0);
check('default sort and normalising', L.defaultSort(true) === 'distance' && L.defaultSort(false) === 'name' && eq(L.normalizeFilters({ sort: 'distance', nearKm: 5, level: 'primary' }, false), { sort: 'name', nearKm: null, level: 'primary' }) && eq(L.normalizeFilters({ sort: 'rating', nearKm: 5 }, false), { sort: 'rating', nearKm: null }) && eq(L.normalizeFilters({ sort: 'distance', nearKm: 5 }, true), { sort: 'distance', nearKm: 5 }));

console.log('\n=== near me: loading a page ===');
const near20 = Array.from({ length: 20 }, (_, i) => ({ id: 'n' + i, name: 'N' + i, distance_km: i / 4 }));
let ndb = fakeDb((rec) => (rec.table.startsWith('rpc:') ? { data: near20, error: null } : { data: [], error: null }));
res = await L.loadSchools(ndb, { ...L.DEFAULT_FILTERS, sort: 'distance', nearKm: 5 }, 1, { lat: 19.076, lng: 72.878 });
check('with a place: calls schools_nearby with the position (not the schools table)', ndb.recs[0].table === 'rpc:schools_nearby' && eq(ndb.recs[0].args, { p_lat: 19.076, p_lng: 72.878 }) && !ndb.recs.some((r) => r.table === 'schools'), JSON.stringify(ndb.recs[0]));
check('asks for the school columns plus distance_km', ndb.recs[0].ops[0][0] === 'select' && ndb.recs[0].ops[0][1] === L.SCHOOL_COLUMNS + ',distance_km' && L.NEARBY_COLUMNS === L.SCHOOL_COLUMNS + ',distance_km');
check('and applies the filters, the order and the page (rows 20-39 for page 2)', ndb.recs[0].ops.some((o) => o[0] === 'lte' && o[1] === 'distance_km' && o[2] === 5) && ndb.recs[0].ops.some((o) => o[0] === 'order' && o[1] === 'distance_km') && ndb.recs[0].ops.some((o) => o[0] === 'range' && o[1] === 20 && o[2] === 39));
check('the distances come back on the rows, with the parent ratings attached', res.rows.length === 20 && res.rows[3].distance_km === 0.75 && res.hasMore === true && 'community' in res.rows[3]);
ndb = fakeDb(() => ({ data: [], error: null }));
await L.loadSchools(ndb, L.DEFAULT_FILTERS, 0, null);
check('without a place: the schools table, no function call', ndb.recs[0].table === 'schools' && !ndb.recs.some((r) => r.table.startsWith('rpc:')));
ndb = fakeDb(() => ({ data: [], error: null }));
await L.loadSchools(ndb, { ...L.DEFAULT_FILTERS, sort: 'distance', nearKm: 2 }, 0, undefined);
check('without a place, a left-over "nearest first" is not sent to the schools table (it has no distance column)', !ndb.recs[0].ops.some((o) => String(o[1]).includes('distance_km')), JSON.stringify(ndb.recs[0].ops));
for (const bad of [{ lat: NaN, lng: 72 }, { lat: 91, lng: 72 }, { lat: 19, lng: 181 }, { lat: null, lng: 72 }, { lat: '19.07', lng: 72.8 }, {}, 'here']) {
  ndb = fakeDb(() => ({ data: [], error: null }));
  await L.loadSchools(ndb, L.DEFAULT_FILTERS, 0, bad);
  check(`a broken place (${JSON.stringify(bad)}) is treated as no place`, ndb.recs[0].table === 'schools');
}
ndb = fakeDb(() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.schools_nearby(p_lat, p_lng) in the schema cache' } }));
res = await L.loadSchools(ndb, L.DEFAULT_FILTERS, 0, { lat: 19, lng: 72.8 });
check('the function not being installed comes back as an error, not a crash, and is recognised', !!res.error && L.isMissingNearby(res.error) && res.rows.length === 0);
check('missing-function detection: by code, by name, and not for other errors', L.isMissingNearby({ code: 'PGRST202' }) && L.isMissingNearby({ message: 'function public.schools_nearby does not exist' }) && !L.isMissingNearby({ message: 'Network request failed' }) && !L.isMissingNearby(null) && !L.isMissingNearby({ code: '23505' }));
check('a missing function is explained in plain words (not the raw database message)', L.friendlyError({ code: 'PGRST202', message: 'Could not find the function public.schools_nearby' }) === L.NEARBY_MISSING_TEXT && /not switched on yet/.test(L.NEARBY_MISSING_TEXT) && !/PGRST|schema cache/.test(L.NEARBY_MISSING_TEXT));

console.log('\n=== near me: how far ===');
const dt = L.distanceText;
check('under 100 m', dt(0) === 'Under 100 m away' && dt(0.06) === 'Under 100 m away' && dt(0.099) === 'Under 100 m away');
check('one decimal below 10 km', dt(0.1) === '0.1 km away' && dt(0.5) === '0.5 km away' && dt(0.51) === '0.5 km away' && dt(4.26) === '4.3 km away' && dt(5.38) === '5.4 km away' && dt(9.94) === '9.9 km away');
check('9.96 rounds up to 10, not "10.0 km"', dt(9.96) === '10 km away' && dt(9.95) !== '10.0 km away');
check('whole km from 10 up', dt(10) === '10 km away' && dt(12.4) === '12 km away' && dt(19.02) === '19 km away' && dt(480.6) === '481 km away');
check('nothing is shown when there is no distance (no place, or bad data)', ['', dt(null), dt(undefined), dt(NaN), dt(-1), dt(Infinity), dt('3.2'), dt({})].every((x) => x === ''));

console.log('\n=== near me: Plus Codes are removed from addresses ===');
const ca = L.cleanAddress;
check('a leading Plus Code and its comma go', ca('3W9C+9VX, Sion Koliwada, Mumbai, Maharashtra 400037, India') === 'Sion Koliwada, Mumbai, Maharashtra 400037, India', ca('3W9C+9VX, Sion Koliwada, Mumbai, Maharashtra 400037, India'));
check('a full-length code (with the area part) goes too', ca('7JFJ3W9C+9VX, Mumbai, Maharashtra') === 'Mumbai, Maharashtra' && ca('3W9C+9V, Mumbai') === 'Mumbai');
check('a code followed by a space instead of a comma', ca('3W9C+9VX Mumbai, Maharashtra') === 'Mumbai, Maharashtra');
check('an address that is only a code is shown as nothing', ca('3W9C+9VX') === '' && ca('  3W9C+9VX,  ') === '');
check('ordinary addresses are left exactly as they are', ['Plot 12, Road No 3, Bandra West, Mumbai 400050', '90 Feet Road, Dharavi, Mumbai', 'B/1, 2nd Floor, Shivaji Nagar', 'Shop 1+2, Andheri West', 'C+22 Main Road', 'BANDRA+WEST, Mumbai', 'Near Sion 3W9C+9VX, Mumbai', '3w9c+9vx, Mumbai'].every((a) => ca(a) === a), JSON.stringify(['Shop 1+2, Andheri West', 'C+22 Main Road', 'BANDRA+WEST, Mumbai', 'Near Sion 3W9C+9VX, Mumbai', '3w9c+9vx, Mumbai'].map(ca)));
check('empty and missing addresses', ca('') === '' && ca(null) === '' && ca(undefined) === '');

console.log('\n=== near me: where the parent is ===');
check('a place must be two real, in-range numbers', L.validPlace({ lat: 19.07, lng: 72.87 }) && L.validPlace({ lat: -90, lng: 180 }) && [null, undefined, {}, { lat: 19 }, { lat: NaN, lng: 1 }, { lat: 91, lng: 0 }, { lat: 0, lng: -181 }, { lat: '19', lng: '72' }, { lat: Infinity, lng: 0 }].every((p) => !L.validPlace(p)));
check('inside the Mumbai area: Bandra, Thane, Navi Mumbai', L.inServiceArea({ lat: 19.06, lng: 72.83 }) && L.inServiceArea({ lat: 19.218, lng: 72.978 }) && L.inServiceArea({ lat: 19.033, lng: 73.03 }));
check('outside: Delhi, Pune, Chennai, the middle of the sea, and nonsense', [{ lat: 28.61, lng: 77.2 }, { lat: 18.52, lng: 73.86 }, { lat: 13.08, lng: 80.27 }, { lat: 19.0, lng: 60 }, { lat: 200, lng: 72.8 }, null].every((p) => !L.inServiceArea(p)));

console.log('\n=== near me: asking the phone ===');
const okPos = (lat, lng) => ({ coords: { latitude: lat, longitude: lng, accuracy: 20 } });
const fakeLoc = (o = {}) => { const calls = []; return { calls, Accuracy: { Balanced: 3 }, requestForegroundPermissionsAsync: async () => { calls.push('permission'); if (o.permThrows) throw new Error('boom'); return o.perm ?? { status: 'granted', canAskAgain: true }; }, getCurrentPositionAsync: async (opts) => { calls.push(['position', opts]); if (o.posThrows) throw new Error('Location services are disabled'); if (o.hang) return new Promise(() => {}); return 'pos' in o ? o.pos : okPos(19.07604, 72.87771); } }; };
let loc = fakeLoc();
let got = await L.locateMe(loc);
check('permission first, then the position; both work -> a place', got.ok === true && eq(loc.calls.map((c) => (Array.isArray(c) ? c[0] : c)), ['permission', 'position']) && loc.calls[1][1].accuracy === 3, JSON.stringify(got));
check('the position is rounded to about 100 m before it goes anywhere', eq(got.place, { lat: 19.076, lng: 72.878 }), JSON.stringify(got.place));
got = await L.locateMe(fakeLoc({ pos: okPos(-33.86882, 151.20929) }));
check('rounding works for negative coordinates too', eq(got.place, { lat: -33.869, lng: 151.209 }), JSON.stringify(got));
loc = fakeLoc({ perm: { status: 'denied', canAskAgain: true } }); got = await L.locateMe(loc);
check('permission refused -> "denied", and the phone is never asked for a position', got.ok === false && got.reason === 'denied' && loc.calls.length === 1);
got = await L.locateMe(fakeLoc({ perm: { status: 'denied', canAskAgain: false } }));
check('refused and cannot ask again -> "blocked" (needs the phone settings)', got.reason === 'blocked');
got = await L.locateMe(fakeLoc({ perm: { status: 'undetermined' } }));
check('undetermined is treated as denied', got.ok === false && got.reason === 'denied');
got = await L.locateMe(fakeLoc({ permThrows: true }));
check('an error while asking for permission is "unavailable", not a crash', got.ok === false && got.reason === 'unavailable');
got = await L.locateMe(fakeLoc({ posThrows: true }));
check('location switched off on the phone (position throws) -> "unavailable"', got.ok === false && got.reason === 'unavailable');
const t0 = Date.now(); got = await L.locateMe(fakeLoc({ hang: true }), 40);
check('a position that never arrives -> "timeout" after the limit', got.ok === false && got.reason === 'timeout' && Date.now() - t0 < 1500, JSON.stringify(got));
for (const [why, pos] of [['no coordinates', {}], ['a null latitude (must not become 0,0)', okPos(null, 72.8)], ['a null longitude', okPos(19, null)], ['undefined', undefined], ['NaN', okPos(NaN, 72.8)], ['latitude 95', okPos(95, 72.8)], ['text instead of numbers', okPos('19.07', '72.87')]]) {
  got = await L.locateMe(fakeLoc({ pos }));
  check(`a bad position (${why}) is "unavailable"`, got.ok === false && got.reason === 'unavailable', JSON.stringify(got));
}
check('each problem has its own plain-words message, and none blames the parent', ['denied', 'blocked', 'timeout', 'unavailable'].every((r) => L.locationProblemText(r).length > 30) && new Set(['denied', 'blocked', 'timeout', 'unavailable'].map(L.locationProblemText)).size === 4 && /settings/.test(L.locationProblemText('blocked')) && /search by school name/.test(L.locationProblemText('denied')));
check('the outside-Mumbai notice names the area', /Mumbai/.test(L.OUTSIDE_AREA_TEXT));

console.log('\n=== asking a school about admissions ===');
check('a question has to say something, but not an essay', L.validateEnquiry({ message: 'x'.repeat(10) }) === null && /at least 10 characters, 9 so far/.test(L.validateEnquiry({ message: 'x'.repeat(9) })) && L.validateEnquiry({ message: 'x'.repeat(2000) }) === null && /under 2000/.test(L.validateEnquiry({ message: 'x'.repeat(2001) })));
check('spaces do not count towards the minimum', /at least 10/.test(L.validateEnquiry({ message: '  hi  ' + ' '.repeat(30) })));
check('the class chosen goes into the subject the school sees, and it is never over-long', L.enquirySubject('Class 1') === 'Admission enquiry - Class 1' && L.enquirySubject('') === 'Admission enquiry' && L.enquirySubject(null) === 'Admission enquiry' && L.enquirySubject('x'.repeat(300)).length === 120);
check('the classes offered run from nursery to class 12', L.GRADE_CHOICES.includes('Nursery') && L.GRADE_CHOICES.includes('Class 11 to 12') && L.GRADE_CHOICES.length >= 5);
check('the years offered are this year and the two after it', eq(L.startYearChoices(new Date('2026-09-19T00:00:00Z')), [2026, 2027, 2028]) && eq(L.startYearChoices(new Date('2030-01-01T00:00:00Z')), [2030, 2031, 2032]));
check('the state of an enquiry is put in words a parent understands', L.enquiryStatusText('open') === 'Waiting for a reply' && L.enquiryStatusText('replied') === 'They have replied' && L.enquiryStatusText('closed') === 'Closed' && L.enquiryStatusText('nonsense') === '');
check('what it is about reads as a phrase, and is empty when nothing was chosen', L.enquiryAbout({ grade_of_interest: 'Class 1', start_year: 2027 }) === 'Class 1, starting 2027' && L.enquiryAbout({ grade_of_interest: 'Nursery' }) === 'Nursery' && L.enquiryAbout({ start_year: 2027 }) === 'starting 2027' && L.enquiryAbout({}) === '' && L.enquiryAbout(null) === '');
check('unread enquiries are counted for the badge', L.unreadCount([{ unread_for_parent: true }, { unread_for_parent: false }, { unread_for_parent: true }]) === 2 && L.unreadCount([]) === 0 && L.unreadCount(null) === 0);
check('a message is mine only when the sender is me; with no user id nothing is mine', L.fromMe({ sender_id: 'u1' }, 'u1') === true && L.fromMe({ sender_id: 'staff' }, 'u1') === false && L.fromMe({ sender_id: 'u1' }, null) === false && L.fromMe(null, 'u1') === false);

console.log('\n=== asking a school: what is sent ===');
let edb = fakeDb(() => ({ data: [], error: null }));
await L.sendEnquiry(edb, 'school-1', { grade: 'Class 1', startYear: 2027, message: '  Do you have places?  ' });
check('the question goes through the send_enquiry function with the school, subject, message, class and year', edb.recs[0].table === 'rpc:send_enquiry' && eq(edb.recs[0].args, { p_school: 'school-1', p_subject: 'Admission enquiry - Class 1', p_message: 'Do you have places?', p_grade: 'Class 1', p_start_year: 2027 }), JSON.stringify(edb.recs[0]));
edb = fakeDb(() => ({ data: [], error: null }));
await L.sendEnquiry(edb, 'school-1', { grade: '', startYear: null, message: 'Just a question.' });
check('no class and no year are sent as nothing, not as empty text', edb.recs[0].args.p_grade === null && edb.recs[0].args.p_start_year === null && edb.recs[0].args.p_subject === 'Admission enquiry');
check('a child\'s name or date of birth is never part of what is sent', !JSON.stringify(edb.recs[0].args).match(/dob|birth|child_name|ward/i));
edb = fakeDb(() => ({ data: [], error: null }));
await L.replyToEnquiry(edb, 'th-1', '  Thank you!  ');
check('a reply is trimmed and goes to the right conversation', edb.recs[0].table === 'ticket_messages' && eq(edb.recs[0].ops[0], ['insert', { ticket_id: 'th-1', message: 'Thank you!' }]), JSON.stringify(edb.recs[0].ops));
edb = fakeDb(() => ({ data: [], error: null }));
await L.markEnquiryRead(edb, 'th-1');
await L.closeEnquiry(edb, 'th-1');
check('reading and closing go through the database functions', edb.recs[0].table === 'rpc:mark_ticket_read' && eq(edb.recs[0].args, { p_ticket: 'th-1' }) && edb.recs[1].table === 'rpc:set_ticket_status' && eq(edb.recs[1].args, { p_ticket: 'th-1', p_status: 'closed' }), JSON.stringify(edb.recs.map((r) => [r.table, r.args])));

console.log('\n=== asking a school: reading them back ===');
const threadRows = [{ id: 'th-1', school_name: 'Sunrise', status: 'replied', unread_for_parent: true }];
edb = fakeDb(() => ({ data: threadRows, error: null }));
res = await L.loadEnquiries(edb);
check('the list asks for the newest movement first and the columns the screen shows', edb.recs[0].table === 'enquiry_threads' && ops(edb.recs[0]).includes('order("last_message_at",{"ascending":false})') && edb.recs[0].ops[0][1] === L.ENQUIRY_COLUMNS && /unread_for_parent/.test(L.ENQUIRY_COLUMNS) && res.rows.length === 1, JSON.stringify(ops(edb.recs[0])));
edb = fakeDb(() => ({ data: threadRows, error: null }));
res = await L.loadEnquiryForSchool(edb, 'school-9');
check('a school page asks only for its own enquiry, and gets one or nothing', ops(edb.recs[0]).includes('eq("school_id","school-9")') && res.thread.id === 'th-1', JSON.stringify(ops(edb.recs[0])));
edb = fakeDb(() => ({ data: [], error: null }));
res = await L.loadEnquiryForSchool(edb, 'school-9');
check('...nothing means no enquiry yet, not an error', res.thread === null && !res.error);
edb = fakeDb(() => ({ data: null, error: { message: 'boom' } }));
res = await L.loadEnquiries(edb);
check('a failure comes back as an error, not a crash, with an empty list', !!res.error && eq(res.rows, []));
edb = fakeDb(() => ({ data: [{ id: 'm1' }], error: null }));
res = await L.loadEnquiryMessages(edb, 'th-1');
check('a conversation is read oldest first, for that thread only', edb.recs[0].table === 'ticket_messages' && ops(edb.recs[0]).includes('eq("ticket_id","th-1")') && ops(edb.recs[0]).includes('order("created_at",{"ascending":true})') && res.rows.length === 1, JSON.stringify(ops(edb.recs[0])));
check('the app never asks for who the staff member is, only the sender id', !/first_name|last_name|email/.test(L.MESSAGE_COLUMNS) && /sender_id/.test(L.MESSAGE_COLUMNS), L.MESSAGE_COLUMNS);

console.log('\n=== asking a school: when it goes wrong ===');
check('a database that has not been set up is recognised, by code or by name', L.isMissingEnquiries({ code: 'PGRST202' }) && L.isMissingEnquiries({ code: 'PGRST205' }) && L.isMissingEnquiries({ message: 'Could not find the table public.enquiry_threads in the schema cache' }) && !L.isMissingEnquiries({ message: 'Network request failed' }) && !L.isMissingEnquiries(null));
check('...and explained plainly, without database words', fe({ code: 'PGRST202', message: 'send_enquiry not found' }, 'enquiry') === L.ENQUIRIES_MISSING_TEXT && !/PGRST|schema cache|enquiry_threads/.test(L.ENQUIRIES_MISSING_TEXT));
check('asking the same school twice points the parent at the conversation they already have', /already have an open enquiry/.test(fe({ message: 'an enquiry with this school is already open' }, 'enquiry')) && /Enquiries/.test(fe({ message: 'an enquiry with this school is already open' }, 'enquiry')));
check('the daily limit is explained in plain words', /sent 10 enquiries today/.test(fe({ message: 'daily enquiry limit reached' }, 'enquiry')));
check('sending too fast is explained without blaming the parent', /wait a few minutes/.test(fe({ message: 'too many messages just now, please wait a little' }, 'enquiry')));
check('an unconfirmed account is told to confirm their email, as for reviews', /confirm your email address/.test(fe({ code: '42501' }, 'enquiry')));
check('the older messages (near me, reviews) are unchanged by all this', fe({ code: 'PGRST202', message: 'schools_nearby missing' }) === L.NEARBY_MISSING_TEXT && /do not match/.test(fe({ message: 'Invalid login credentials' })));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
