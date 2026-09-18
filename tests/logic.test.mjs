// Tests for the pure logic inside App.js (between the BEGIN / END markers). Run: node tests/logic.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(process.env.APP_FILE ?? path.join(here, '..', 'App.js'), 'utf8');
const a = src.indexOf('// ==== BEGIN pure logic'), b = src.indexOf('// ==== END pure logic');
if (a < 0 || b < 0) throw new Error('markers not found in App.js');
fs.mkdirSync(path.join(here, '.tmp'), { recursive: true });
const names = ['sanitizeSearch', 'applySchoolFilters', 'activeFilterCount', 'levelBadges', 'googleRatingText', 'communityText', 'stars', 'safeUrl', 'validateAuth', 'validateReview', 'statusLine', 'cleanName', 'friendlyError', 'loadStats', 'loadSchools', 'loadReviews', 'loadMyReview', 'submitReview', 'updateReview', 'deleteReview', 'reportReview', 'DEFAULT_FILTERS', 'PAGE_SIZE', 'monthYear'];
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
  return { from, recs };
}
const ops = (rec) => rec.ops.map((o) => o[0] + '(' + o.slice(1).map((x) => JSON.stringify(x)).join(',') + ')');
const filtersOf = (f) => { const db = fakeDb(() => ({ data: [], error: null })); const rec = { table: 'schools', ops: [] }; const p = new Proxy(function () {}, { get(_, prop) { return (...args) => { rec.ops.push([prop, ...args]); return p; }; } }); L.applySchoolFilters(p, { ...L.DEFAULT_FILTERS, ...f }); return ops(rec); };

console.log('\n=== search text is made safe ===');
check('filter-syntax characters are removed', L.sanitizeSearch('a,b(c)*d"e\\f%g') === 'a b c d e f g', L.sanitizeSearch('a,b(c)*d"e\\f%g'));
check('spaces are tidied, length capped at 60, null is fine', L.sanitizeSearch('  St.   Mary  ') === 'St. Mary' && L.sanitizeSearch('x'.repeat(200)).length === 60 && L.sanitizeSearch(null) === '');
check('an attempt to smuggle in a second filter comes out as plain words', !/[,()]/.test(L.sanitizeSearch('x),id.eq.1,(name.ilike.*')), L.sanitizeSearch('x),id.eq.1,(name.ilike.*'));

console.log('\n=== the parent\'s choices become database filters ===');
check('default: never shows hidden places, A to Z, nothing else', eq(filtersOf({}), ['eq("is_hidden",false)', 'order("name",{"ascending":true})']), JSON.stringify(filtersOf({})));
check('search looks in name AND address', filtersOf({ search: 'Bandra' }).includes('or("name.ilike.*Bandra*,address.ilike.*Bandra*")'), JSON.stringify(filtersOf({ search: 'Bandra' })));
check('a search with commas and brackets cannot break the filter', filtersOf({ search: 'a,b)' }).includes('or("name.ilike.*a b*,address.ilike.*a b*")'));
check('an empty or blank search adds no filter', !filtersOf({ search: '   ' }).some((x) => x.startsWith('or(')));
check('level: primary -> levels overlap', filtersOf({ level: 'primary' }).includes('overlaps("levels",["primary"])'));
check('level: not stated -> levels equal to the empty list', filtersOf({ level: 'none' }).includes('eq("levels","{}")'));
check('daycare switch -> levels contain daycare', filtersOf({ daycare: true }).includes('contains("levels",["daycare"])'));
check('level and daycare together are both applied', filtersOf({ level: 'preschool', daycare: true }).length === 4);
check('rating 4+ while keeping unrated schools -> rating >= 4 OR no rating', filtersOf({ minRating: 4 }).includes('or("google_rating.gte.4,google_rating.is.null")'));
check('rating 4+ with unrated switched off -> rating >= 4 only', filtersOf({ minRating: 4, includeUnrated: false }).includes('gte("google_rating",4)') && !filtersOf({ minRating: 4, includeUnrated: false }).some((x) => x.startsWith('or(')));
check('any rating with unrated switched off -> only rated schools', filtersOf({ includeUnrated: false }).includes('not("google_rating","is",null)'));
check('best rated sorts by rating then review count, unrated last', filtersOf({ sort: 'rating' }).join('|').includes('order("google_rating",{"ascending":false,"nullsFirst":false})|order("google_review_count",{"ascending":false,"nullsFirst":false})'), filtersOf({ sort: 'rating' }).join('|'));
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
