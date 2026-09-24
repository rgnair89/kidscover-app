// Tests for the pure logic inside App.js (between the BEGIN / END markers). Run: node tests/logic.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(process.env.APP_FILE ?? path.join(here, '..', 'App.js'), 'utf8');
const a = src.indexOf('// ==== BEGIN pure logic'), b = src.indexOf('// ==== END pure logic');
if (a < 0 || b < 0) throw new Error('markers not found in App.js');
fs.mkdirSync(path.join(here, '.tmp'), { recursive: true });
const names = ['sanitizeSearch', 'applySchoolFilters', 'activeFilterCount', 'levelBadges', 'googleRatingText', 'communityText', 'stars', 'safeUrl', 'validateAuth', 'validateReview', 'statusLine', 'cleanName', 'friendlyError', 'loadStats', 'loadSchools', 'loadReviews', 'loadMyReview', 'submitReview', 'updateReview', 'deleteReview', 'reportReview', 'DEFAULT_FILTERS', 'PAGE_SIZE', 'monthYear', 'SCHOOL_COLUMNS', 'NEARBY_COLUMNS', 'DISTANCE_CHOICES', 'SERVICE_AREA', 'validPlace', 'inServiceArea', 'defaultSort', 'normalizeFilters', 'distanceText', 'cleanAddress', 'isMissingNearby', 'locateMe', 'locationProblemText',
  'ENQUIRY_COLUMNS', 'MESSAGE_COLUMNS', 'MAX_ENQUIRY', 'MIN_ENQUIRY', 'GRADE_CHOICES', 'startYearChoices', 'validateEnquiry', 'enquirySubject',
  'enquiryStatusText', 'enquiryAbout', 'unreadCount', 'fromMe', 'isMissingEnquiries', 'sendEnquiry', 'loadEnquiries',
  'loadEnquiryForSchool', 'loadEnquiryMessages', 'replyToEnquiry', 'markEnquiryRead', 'closeEnquiry',
  'DRIVE_MODES', 'MAX_DRIVE_BATCH', 'driveTimeText', 'driveKey', 'needDriveTimes', 'requestDriveTimes', 'driveProblemText',
  'BOARD_CHOICES', 'boardSourceText', 'admissionText',
  'CATEGORY_CHOICES', 'categoryOf', 'categoryFilters', 'isSchoolPlace',
  'FACILITY_INFO', 'ACHIEVEMENT_INFO', 'SOURCE_TEXT', 'facilityText', 'sourcesText', 'photoCreditText', 'artColours', 'ART_COLOURS', 'loadFacilities', 'loadAchievements',
  'setTranslator', 't', 'setMoneyLocale', 'setDateLocale', 'rupees', 'budgetLabel', 'BUDGET_CHOICES', 'FEE_PARTS', 'feeForLevel', 'feeSummaryText', 'loadFeeSchedules', 'loadTiles', 'leaveByText', 'clockText', 'dayText', 'noteOutboundClick', 'messageFrom', 'EN_GRADES', 'classLabel', 'stageText', 'academicYearChoices', 'APPLY_CLASSES', 'APPLY_RELATIONS', 'APPLY_GENDERS', 'EMPTY_APPLICATION', 'validateApplication', 'submitApplication', 'loadApplications', 'loadApplicationEvents', 'withdrawApplication', 'deleteApplication', 'isMissingApplications', 'liveApplications', 'MAX_COMPARE', 'toggleCompare', 'compareRows', 'registerForPush', 'forgetPush', 'loadNotifications', 'markNotificationsRead', 'initialsOf', 'backTargetFor', 'BACK_FROM', 'PHOTO_BUCKET', 'PHOTO_MAX_BYTES', 'PHOTO_TYPES', 'PHOTO_URL_SECONDS', 'bytesFromBase64', 'photoTypeOf', 'photoPathFor', 'isOwnPhotoPath', 'validatePhoto', 'pickPhoto', 'photoProblemText', 'uploadPhoto', 'removePhoto', 'signedPhotoUrl', 'THEME_SETTING', 'THEME_CHOICES', 'themeFor', 'themeChoiceOf', 'TOUR_SETTING', 'TOUR_NEVER', 'TOUR_STEPS', 'TOUR_VERSION', 'tourToShow', 'tourAfterFinish', 'tourStepAt', 'nextTourIndex', 'onLastTourStep', 'ADDRESS_COLUMNS', 'MAX_ADDRESSES', 'MAX_ADDRESS_NAME', 'MAX_ADDRESS_TEXT', 'isMissingAddresses', 'addressPlace', 'validateAddress', 'loadAddresses', 'saveAddress', 'deleteAddress', 'describePlace', 'addressHere', 'PROFILE_GENDERS', 'PROFILE_AVATARS', 'AUTO_AVATAR', 'avatarFor', 'profileComplete', 'saveProfile', 'loadSettings', 'saveLanguage', 'savePushChoice', 'deleteAccount', 'biometricKind', 'unlockWithBiometrics', 'shouldLock', 'BIOMETRIC_SETTING', 'LANGUAGE_SETTING', 'LOCK_AFTER_MS', 'APPLICATION_COLUMNS'];
fs.writeFileSync(path.join(here, '.tmp', 'logic.mjs'), src.slice(a, b) + `\nexport { ${names.join(', ')} };\n`);
const L = await import(pathToFileURL(path.join(here, '.tmp', 'logic.mjs')).href);
// the words of the app come from the language packs; the tests read the English one
const EN = JSON.parse(fs.readFileSync(path.join(here, '..', 'i18n', 'en.json'), 'utf8'));
const fill = (line, values) => (values ? String(line).replace(/\{(\w+)\}/g, (whole, name) => (name in values ? String(values[name]) : whole)) : line);
L.setTranslator((key, values) => fill(EN[key] ?? key, values));

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

console.log('\n=== photos, facilities, achievements ===');
check('the list asks for the photo and its credit', ['photo_url', 'photo_source', 'photo_credit', 'photo_licence', 'photo_page_url'].every((c) => L.SCHOOL_COLUMNS.split(',').includes(c)));
check('photo credits: Wikimedia names author and licence; an upload is from the school; no photo, no credit', L.photoCreditText({ photo_url: 'u', photo_source: 'wikimedia', photo_credit: 'Jane', photo_licence: 'CC0' }) === 'Photo: Jane, CC0, via Wikimedia Commons' && L.photoCreditText({ photo_url: 'u', photo_source: 'school', photo_credit: 'Ravi' }) === 'Photo: Ravi' && L.photoCreditText({ photo_url: 'u', photo_source: 'school' }) === 'Photo from the school' && L.photoCreditText({}) === '' && L.photoCreditText(null) === '');
check('the same school is always drawn in the same colours; schools differ', L.artColours('s1') === L.artColours('s1') && new Set(['s1', 's2', 's3', 's4', 's5', 'n1', 'n2', 'f01'].map((x) => L.ART_COLOURS.indexOf(L.artColours(x)))).size >= 3 && L.ART_COLOURS.includes(L.artColours(undefined)));
check('the 20 facilities the portal knows, each with a label and an icon', Object.keys(L.FACILITY_INFO).length === 20 && Object.values(L.FACILITY_INFO).every(([label, icon]) => label && icon));
check('a facility with a detail reads "Label: detail"', L.facilityText({ facility: 'teacher_ratio', detail: '1:20' }) === 'Teacher-student ratio: 1:20' && L.facilityText({ facility: 'library' }) === 'Library');
check('where facts came from, once each', L.sourcesText([{ source: 'school' }, { source: 'school' }, { source: 'kidscover' }]) === 'Listed by the school; checked by Kidscover.' && L.sourcesText([{ source: 'kidscover' }]) === 'Checked by Kidscover.' && L.sourcesText([{ source: 'school website' }]) === "Found on the school's website." && L.sourcesText([{ source: 'mystery' }]) === '' && L.sourcesText([]) === '');
const fdb = (rows, error = null) => ({ from: () => { const q = { eq: () => q, order: () => q, select: () => q, then: (r) => Promise.resolve({ data: rows, error }).then(r) }; return q; } });
const f1 = await L.loadFacilities(fdb([{ facility: 'transport' }, { facility: 'nope' }, { facility: 'cafeteria' }]), 's');
check('facilities come back in the usual order, unknown ones dropped', f1.rows.map((r) => r.facility).join() === 'cafeteria,transport' && f1.error === null);
const f2 = await L.loadFacilities(fdb(null, { message: 'relation does not exist' }), 's');
check('...and an error is an empty list with the error, not a crash', f2.rows.length === 0 && !!f2.error);
const a1 = await L.loadAchievements(fdb([{ id: 1, kind: 'award', text: 'x' }, { id: 2, kind: 'class10', text: 'y' }, { id: 3, kind: 'mystery', text: 'z' }]), 's');
check('achievements come back grouped in the usual order (class 10 before awards), unknown kinds dropped', a1.groups.map((g) => g.kind).join() === 'class10,award' && a1.groups[0].label === 'Class 10 results' && !!a1.groups[0].icon);

console.log('\n=== search text is made safe ===');
check('filter-syntax characters are removed', L.sanitizeSearch('a,b(c)*d"e\\f%g') === 'a b c d e f g', L.sanitizeSearch('a,b(c)*d"e\\f%g'));
check('spaces are tidied, length capped at 60, null is fine', L.sanitizeSearch('  St.   Mary  ') === 'St. Mary' && L.sanitizeSearch('x'.repeat(200)).length === 60 && L.sanitizeSearch(null) === '');
check('an attempt to smuggle in a second filter comes out as plain words', !/[,()]/.test(L.sanitizeSearch('x),id.eq.1,(name.ilike.*')), L.sanitizeSearch('x),id.eq.1,(name.ilike.*'));

console.log('\n=== the parent\'s choices become database filters ===');
check('default: never shows hidden places, only schools, A to Z by the clean sort name, then id', eq(filtersOf({}), ['eq("is_hidden",false)', 'eq("category","school")', 'order("name_sort",{"ascending":true})', 'order("id",{"ascending":true})']), JSON.stringify(filtersOf({})));
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
const auth = (o) => L.validateAuth({ mode: 'signin', first: '', last: '', email: 'a@b.co', password: 'x', gender: 'woman', ...o });
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
check('with a place the default order is nearest first, then id', eq(filtersOf({ sort: 'distance' }, true), ['eq("is_hidden",false)', 'eq("category","school")', 'order("distance_km",{"ascending":true})', 'order("id",{"ascending":true})']), JSON.stringify(filtersOf({ sort: 'distance' }, true)));
check('"within 5 km" -> distance <= 5 (only with a place)', filtersOf({ sort: 'distance', nearKm: 5 }, true).includes('lte("distance_km",5)') && !filtersOf({ nearKm: 5 }, false).some((x) => x.includes('distance_km')));
check('no distance choice -> no distance filter', !filtersOf({ sort: 'distance' }, true).some((x) => x.startsWith('lte(')));
check('without a place, a left-over "nearest first" falls back to A to Z and never mentions distance', eq(filtersOf({ sort: 'distance', nearKm: 2 }, false), ['eq("is_hidden",false)', 'eq("category","school")', 'order("name_sort",{"ascending":true})', 'order("id",{"ascending":true})']), JSON.stringify(filtersOf({ sort: 'distance', nearKm: 2 }, false)));
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
check('a missing function is explained in plain words (not the raw database message)', L.friendlyError({ code: 'PGRST202', message: 'Could not find the function public.schools_nearby' }) === EN['error.nearbyOff'] && /not switched on yet/.test(EN['error.nearbyOff']) && !/PGRST|schema cache/.test(EN['error.nearbyOff']));

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
check('the outside-Mumbai notice names the area', /Mumbai/.test(EN['location.outsideArea']));

console.log('\n=== asking a school about admissions ===');
check('a question has to say something, but not an essay', L.validateEnquiry({ message: 'x'.repeat(10) }) === null && /at least 10 characters, 9 so far/.test(L.validateEnquiry({ message: 'x'.repeat(9) })) && L.validateEnquiry({ message: 'x'.repeat(2000) }) === null && /under 2000/.test(L.validateEnquiry({ message: 'x'.repeat(2001) })));
check('spaces do not count towards the minimum', /at least 10/.test(L.validateEnquiry({ message: '  hi  ' + ' '.repeat(30) })));
check('the class chosen goes into the subject the school sees, in English so every school reads it the same', L.enquirySubject('grade.1to5') === 'Admission enquiry - Class 1 to 5' && L.enquirySubject('') === 'Admission enquiry' && L.enquirySubject(null) === 'Admission enquiry' && L.enquirySubject('grade.unknown') === 'Admission enquiry');
check('the classes offered run from nursery to class 12, in the language the parent chose', L.GRADE_CHOICES.map((g) => EN[g]).includes('Nursery') && L.GRADE_CHOICES.map((g) => EN[g]).includes('Class 11 to 12') && L.GRADE_CHOICES.length >= 5 && L.GRADE_CHOICES.every((g) => EN[g]));
check('the years offered are this year and the two after it', eq(L.startYearChoices(new Date('2026-09-19T00:00:00Z')), [2026, 2027, 2028]) && eq(L.startYearChoices(new Date('2030-01-01T00:00:00Z')), [2030, 2031, 2032]));
check('the state of an enquiry is put in words a parent understands', L.enquiryStatusText('open') === 'Waiting for a reply' && L.enquiryStatusText('replied') === 'They have replied' && L.enquiryStatusText('closed') === 'Closed' && L.enquiryStatusText('nonsense') === '');
check('what it is about reads as a phrase, and is empty when nothing was chosen', L.enquiryAbout({ grade_of_interest: 'Class 1', start_year: 2027 }) === 'Class 1, starting 2027' && L.enquiryAbout({ grade_of_interest: 'Nursery' }) === 'Nursery' && L.enquiryAbout({ start_year: 2027 }) === 'starting 2027' && L.enquiryAbout({}) === '' && L.enquiryAbout(null) === '');
check('unread enquiries are counted for the badge', L.unreadCount([{ unread_for_parent: true }, { unread_for_parent: false }, { unread_for_parent: true }]) === 2 && L.unreadCount([]) === 0 && L.unreadCount(null) === 0);
check('a message is mine only when the sender is me; with no user id nothing is mine', L.fromMe({ sender_id: 'u1' }, 'u1') === true && L.fromMe({ sender_id: 'staff' }, 'u1') === false && L.fromMe({ sender_id: 'u1' }, null) === false && L.fromMe(null, 'u1') === false);
// One person can hold both sides of a conversation - a Kidscover admin who is also testing as a parent, or a school's
// staff member enquiring about another school. Deciding by the account id alone labelled every message "You",
// including the replies that came back from the school.
check('who sent a message is decided by the role recorded on it, not by whose account is signed in', L.fromMe({ sender_role: 'parent', sender_id: 'same' }, 'same') === true && L.fromMe({ sender_role: 'school', sender_id: 'same' }, 'same') === false && L.fromMe({ sender_role: 'kidscover', sender_id: 'same' }, 'same') === false);
check('...so one account on both sides still reads as a conversation', L.messageFrom({ sender_role: 'parent', sender_id: 'same' }, 'same') === 'You' && L.messageFrom({ sender_role: 'school', sender_id: 'same' }, 'same') === 'The school' && L.messageFrom({ sender_role: 'kidscover', sender_id: 'same' }, 'same') === 'Kidscover');
check('an older message with no role recorded still falls back to the account id', L.fromMe({ sender_id: 'u1' }, 'u1') === true && L.messageFrom({ sender_id: 'u1' }, 'u1') === 'You' && L.messageFrom({ sender_id: 'other' }, 'u1') === 'Kidscover');

console.log('\n=== asking a school: what is sent ===');
let edb = fakeDb(() => ({ data: [], error: null }));
await L.sendEnquiry(edb, 'school-1', { grade: 'grade.1to5', startYear: 2027, message: '  Do you have places?  ' });
check('the question goes through the send_enquiry function with the school, subject, message, class and year', edb.recs[0].table === 'rpc:send_enquiry' && eq(edb.recs[0].args, { p_school: 'school-1', p_subject: 'Admission enquiry - Class 1 to 5', p_message: 'Do you have places?', p_grade: 'Class 1 to 5', p_start_year: 2027 }), JSON.stringify(edb.recs[0]));
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
check('...and explained plainly, without database words', fe({ code: 'PGRST202', message: 'send_enquiry not found' }, 'enquiry') === EN['error.enquiriesOff'] && !/PGRST|schema cache|enquiry_threads/.test(EN['error.enquiriesOff']));
check('asking the same school twice points the parent at the conversation they already have', /already have an open enquiry/.test(fe({ message: 'an enquiry with this school is already open' }, 'enquiry')) && /Enquiries/.test(fe({ message: 'an enquiry with this school is already open' }, 'enquiry')));
check('the daily limit is explained in plain words', /sent 10 enquiries today/.test(fe({ message: 'daily enquiry limit reached' }, 'enquiry')));
check('sending too fast is explained without blaming the parent', /wait a few minutes/.test(fe({ message: 'too many messages just now, please wait a little' }, 'enquiry')));
check('an unconfirmed account is told to confirm their email, as for reviews', /confirm your email address/.test(fe({ code: '42501' }, 'enquiry')));
check('the older messages (near me, reviews) are unchanged by all this', fe({ code: 'PGRST202', message: 'schools_nearby missing' }) === EN['error.nearbyOff'] && /do not match/.test(fe({ message: 'Invalid login credentials' })));

console.log('\n=== drive times: wording ===');
const dtt = L.driveTimeText;
check('minutes under an hour', dtt({ minutes: 25, km: 8 }) === 'About 25 min by car' && dtt({ minutes: 0.4 }) === 'About 1 min by car' && dtt({ minutes: 59.4 }) === 'About 59 min by car');
check('an hour or more: hours and minutes, and no "0 min"', dtt({ minutes: 60 }) === 'About 1 h by car' && dtt({ minutes: 75 }) === 'About 1 h 15 min by car' && dtt({ minutes: 59.6 }) === 'About 1 h by car' && dtt({ minutes: 130 }) === 'About 2 h 10 min by car');
check('nothing is shown for no route, no answer or rubbish', [null, undefined, {}, { minutes: null }, { minutes: 'x' }, { minutes: NaN }, { minutes: -3 }].every((t) => dtt(t) === ''));
check('three times of day: the weekday school run, in time for the bell, and right now', eq(L.DRIVE_MODES.map((m) => m.key), ['school_run', 'arrive', 'now']) && /7:30/.test(EN[L.DRIVE_MODES[0].label]) && L.MAX_DRIVE_BATCH === 20);
const dpt = L.driveProblemText;
check('each problem has a plain message', /used today's 20 drive-time lookups/.test(dpt('user_limit', 20)) && /used today's 30/.test(dpt('user_limit', 30)) && /paused for today/.test(dpt('daily_budget')) && /only in Mumbai and Thane/.test(dpt('outside_area')) && /confirm your email/.test(dpt('confirm_email')) && /try again in a moment/.test(dpt('network')));
check('every setup problem reads the same to a parent: not switched on yet (the details are for admins)', ['switched_off', 'not_deployed', 'not_configured', 'routes_not_enabled', 'google_key_blocked', 'google_key_invalid'].every((c) => /not switched on yet/.test(dpt(c))) && !/Google key|Routes API/i.test(dpt('google_key_blocked')));
check('an unknown problem still says something useful', /try again/.test(dpt('something_new')) && /try again/.test(dpt(undefined)));

console.log('\n=== drive times: which schools to ask about ===');
const spot = { lat: 19.076, lng: 72.878 };
const dRows = Array.from({ length: 25 }, (_, i) => ({ id: 'r' + i, distance_km: i }));
dRows[3] = { id: 'r3', distance_km: null };          // no coordinates, so no distance
check('only schools with a distance, at most 20 in one lookup', eq(L.needDriveTimes(dRows, spot, 'school_run', {}, new Set()), dRows.filter((r) => typeof r.distance_km === 'number').slice(0, 20).map((r) => r.id)));
const known = { [L.driveKey(spot, 'school_run', 'r0')]: { minutes: 5 }, [L.driveKey(spot, 'school_run', 'r1')]: null };
check('schools already answered (even "no route") are not asked again', !L.needDriveTimes(dRows, spot, 'school_run', known, new Set()).some((id) => id === 'r0' || id === 'r1'));
check('...but they are asked again for the other time of day, or from another place', L.needDriveTimes(dRows, spot, 'now', known, new Set()).includes('r0') && L.needDriveTimes(dRows, { lat: 19.1, lng: 72.9 }, 'school_run', known, new Set()).includes('r0'));
check('schools already being fetched are not asked twice', !L.needDriveTimes(dRows, spot, 'school_run', {}, new Set([L.driveKey(spot, 'school_run', 'r2')])).includes('r2'));
check('nothing is asked without a place or without a chosen time of day', L.needDriveTimes(dRows, null, 'school_run', {}, new Set()).length === 0 && L.needDriveTimes(dRows, spot, null, {}, new Set()).length === 0 && L.needDriveTimes(dRows, spot, 'midnight', {}, new Set()).length === 0 && L.needDriveTimes(null, spot, 'now', {}, new Set()).length === 0);

console.log('\n=== drive times: asking the function ===');
const fakeFn = (answer) => { const calls = []; return { calls, invoke: async (name, opts) => { calls.push([name, opts]); if (answer instanceof Error) throw answer; return answer; } }; };
let fn = fakeFn({ data: { ok: true, times: { a: { minutes: 12, km: 4.1 }, b: null }, lookupsLeft: 7 }, error: null });
let dres = await L.requestDriveTimes(fn, spot, ['a', 'b', 'c'], 'school_run');
check('it calls commute-times with the rounded place, the school ids and the time of day, and nothing else', fn.calls.length === 1 && fn.calls[0][0] === 'commute-times' && eq(fn.calls[0][1], { body: { lat: 19.076, lng: 72.878, schoolIds: ['a', 'b', 'c'], when: 'school_run' } }), JSON.stringify(fn.calls));
check('the answer: a time, "no route", and a school the function left out all come back', dres.ok && eq(dres.times, { a: { minutes: 12, km: 4.1 }, b: null, c: null }) && dres.lookupsLeft === 7, JSON.stringify(dres));
fn = fakeFn({ data: { ok: true, times: { 'abcdef00-0000-4000-8000-000000000001': { minutes: 3, km: 1 } } }, error: null });
dres = await L.requestDriveTimes(fn, spot, ['ABCDEF00-0000-4000-8000-000000000001'], 'now');
check('ids are matched whatever their letter case', eq(dres.times, { 'ABCDEF00-0000-4000-8000-000000000001': { minutes: 3, km: 1 } }) && dres.lookupsLeft === null, JSON.stringify(dres));
fn = fakeFn({ data: { ok: false, code: 'user_limit', limit: 20 }, error: null });
dres = await L.requestDriveTimes(fn, spot, ['a'], 'now');
check('a refusal from the function is passed on with its limit', dres.ok === false && dres.code === 'user_limit' && dres.limit === 20, JSON.stringify(dres));
fn = fakeFn({ data: null, error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status: 404 } } });
check('a function that has not been deployed is recognised', (await L.requestDriveTimes(fn, spot, ['a'], 'now')).code === 'not_deployed');
fn = fakeFn({ data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' } });
check('no connection is recognised', (await L.requestDriveTimes(fn, spot, ['a'], 'now')).code === 'network');
fn = fakeFn({ data: null, error: { name: 'FunctionsHttpError', message: 'non-2xx', context: { status: 500 } } });
check('a crash in the function is a plain failure', (await L.requestDriveTimes(fn, spot, ['a'], 'now')).code === 'failed');
fn = fakeFn(new Error('boom'));
check('an exception while calling becomes "network", not a crash', (await L.requestDriveTimes(fn, spot, ['a'], 'now')).code === 'network');
for (const junk of [{ data: 'hello', error: null }, { data: null, error: null }, undefined, { data: { ok: false }, error: null }]) {
  fn = fakeFn(junk);
  const x = await L.requestDriveTimes(fn, spot, ['a'], 'now');
  check('an odd answer (' + JSON.stringify(junk) + ') is a failure, not a crash', x.ok === false && typeof x.code === 'string');
}

console.log('\n=== boards and admissions ===');
check('the list asks for the board and admission facts with their sources', ['boards', 'board_source', 'board_source_url', 'admissions_open', 'admissions_year', 'admissions_source_url', 'admissions_checked_at'].every((c) => L.SCHOOL_COLUMNS.split(',').includes(c)) && L.NEARBY_COLUMNS.endsWith(',distance_km'));
check('the boards offered: CBSE, ICSE, IB, IGCSE, State Board', eq(L.BOARD_CHOICES, ['CBSE', 'ICSE', 'IB', 'IGCSE', 'State Board']));
check('board CBSE -> only schools known to be CBSE (the default)', filtersOf({ board: 'CBSE' }).includes('overlaps("boards",["CBSE"])') && !filtersOf({ board: 'CBSE' }).some((x) => x.startsWith('or(')));
check('...with "also show unknown" -> CBSE or not known yet (quoted, so "State Board" works too)', filtersOf({ board: 'State Board', includeUnknownBoard: true }).includes('or("boards.ov.{\\"State Board\\"},boards.is.null")'), JSON.stringify(filtersOf({ board: 'State Board', includeUnknownBoard: true })));
check('no board chosen -> no board filter, whatever the switch says', !filtersOf({ includeUnknownBoard: true }).some((x) => /boards/.test(x)));

console.log('\n=== schools, after-school classes, colleges ===');
check('three categories, schools first and the default', L.CATEGORY_CHOICES.map((c) => c.key).join() === 'school,after_school,college' && L.DEFAULT_FILTERS.category === 'school');
check('after-school -> only after-school classes', filtersOf({ category: 'after_school' }).includes('eq("category","after_school")') && !filtersOf({ category: 'after_school' }).includes('eq("category","school")'));
check('colleges -> only colleges', filtersOf({ category: 'college' }).includes('eq("category","college")'));
check('no category, or one that does not exist -> schools (never an unfiltered list)', filtersOf({}).includes('eq("category","school")') && filtersOf({ category: 'shop' }).includes('eq("category","school")') && !filtersOf({ category: 'shop' }).some((x) => /shop/.test(x)), JSON.stringify(filtersOf({ category: 'shop' })));
const classChoices = { category: 'after_school', level: 'primary', daycare: true, board: 'CBSE', includeUnknownBoard: true, minRating: 4, search: 'dance' };
check('for classes, level / daycare / board are set aside; search and rating still apply', (() => { const ops = filtersOf(classChoices); return !ops.some((x) => /levels|boards/.test(x)) && ops.some((x) => /name\.ilike\.\*dance\*/.test(x)) && ops.some((x) => /google_rating/.test(x)); })(), JSON.stringify(filtersOf(classChoices)));
check('...and they apply again on Schools (set aside, not cleared)', (() => { const ops = filtersOf({ ...classChoices, category: 'school' }); return ops.includes('overlaps("levels",["primary"])') && ops.includes('contains("levels",["daycare"])') && ops.some((x) => /boards/.test(x)); })(), JSON.stringify(filtersOf({ ...classChoices, category: 'school' })));
check('the category itself is not counted as a filter; set-aside filters are not counted either', L.activeFilterCount({ ...L.DEFAULT_FILTERS, category: 'college' }) === 0 && L.activeFilterCount({ ...L.DEFAULT_FILTERS, category: 'college', level: 'primary', board: 'CBSE', daycare: true }) === 0 && L.activeFilterCount({ ...L.DEFAULT_FILTERS, level: 'primary', board: 'CBSE', daycare: true }) === 3 && L.activeFilterCount({ ...L.DEFAULT_FILTERS, category: 'college', minRating: 4 }) === 1);
check('the parent\'s filters are not changed by being set aside', classChoices.level === 'primary' && classChoices.board === 'CBSE' && L.categoryFilters(classChoices) !== classChoices);
check('a place with no category (an older database row) counts as a school; classes and colleges do not', L.isSchoolPlace({}) && L.isSchoolPlace({ category: 'school' }) && !L.isSchoolPlace({ category: 'after_school' }) && !L.isSchoolPlace({ category: 'college' }) && L.isSchoolPlace(null));
check('the list asks for the category (the app hides level badges and admissions for classes and colleges)', L.SCHOOL_COLUMNS.split(',').includes('category') && L.NEARBY_COLUMNS.split(',').includes('category'));
check('a category\'s words: "after-school classes", "colleges"', EN[L.categoryOf('after_school').noun] === 'after-school classes' && EN[L.categoryOf('college').label] === 'Colleges' && L.categoryOf('nope').key === 'school');
check('a board that is not on the list is ignored (nothing odd reaches the filter)', !filtersOf({ board: 'Harvard' }).some((x) => /boards/.test(x)) && !filtersOf({ board: 'CBSE},id.eq.1' }).some((x) => /boards/.test(x)));
check('board works together with level and near me', ['overlaps("boards",["ICSE"])', 'overlaps("levels",["primary"])', 'lte("distance_km",5)'].every((x) => filtersOf({ board: 'ICSE', level: 'primary', sort: 'distance', nearKm: 5 }, true).includes(x)));
check('a chosen board counts as one filter', L.activeFilterCount({ ...L.DEFAULT_FILTERS, board: 'IB' }) === 1 && L.activeFilterCount({ ...L.DEFAULT_FILTERS, board: 'IB', includeUnknownBoard: true }) === 1 && L.DEFAULT_FILTERS.includeUnknownBoard === false);
check('where a board came from, in words', L.boardSourceText('CBSE directory') === "confirmed by CBSE's own record" && L.boardSourceText('school website') === "from the school's website" && L.boardSourceText('school name') === "from the school's name" && L.boardSourceText(null) === '' && L.boardSourceText('blog') === '');
const at = L.admissionText;
check('admissions open, with the year and when it was checked', at({ admissions_open: true, admissions_year: '2027-28', admissions_source_url: 'https://s.example/a', admissions_checked_at: '2026-09-19T05:00:00Z' }) === "Admissions open for 2027-28 (from the school's website, checked Sep 2026)", at({ admissions_open: true, admissions_year: '2027-28', admissions_source_url: 'https://s.example/a', admissions_checked_at: '2026-09-19T05:00:00Z' }));
check('admissions closed, and a notice without a year', at({ admissions_open: false, admissions_year: '2026-27', admissions_source_url: 'u', admissions_checked_at: '2026-09-19' }).startsWith('Admissions closed for 2026-27') && at({ admissions_open: true, admissions_source_url: 'u', admissions_checked_at: 'nonsense' }) === "Admissions open (from the school's website)");
check('nothing is said without a source (an old "closed" default is never shown), or when unknown', at({ admissions_open: false }) === '' && at({ admissions_open: null, admissions_source_url: 'u' }) === '' && at(null) === '' && at({}) === '');
// ---------------------------------------------------------------------------------------------------------------
console.log('\n=== getting back, and the profile button ===');
check('every screen a person can be on has somewhere to go back to', ['school', 'compare', 'apply', 'enquiries', 'applications', 'settings', 'language'].every((sc) => !!L.backTargetFor(sc)));
check('the list itself has nowhere further back, so the phone\'s back button leaves the app', L.backTargetFor('discover') === null && L.backTargetFor('nonsense') === null);
check('back from the form goes to the school it was for, not all the way out', L.backTargetFor('apply') === 'school');
check('back from the language list goes to settings, where it was opened from', L.backTargetFor('language') === 'settings');
check('the other screens go back to the list', ['school', 'compare', 'enquiries', 'applications', 'settings'].every((sc) => L.backTargetFor(sc) === 'discover'));
check('the profile button shows a person\'s initials', L.initialsOf({ first_name: 'Ann', last_name: 'Rao' }) === 'AR');
check('...one name is enough', L.initialsOf({ first_name: 'ann', last_name: '' }) === 'A' && L.initialsOf({ last_name: 'Rao' }) === 'R');
check('...and someone with no name yet still gets a button to press', L.initialsOf(null) === '··' && L.initialsOf({}) === '··' && L.initialsOf({ first_name: '  ' }) === '··');

// ---------------------------------------------------------------------------------------------------------------
console.log('\n=== the profile ===');
check('signing up asks how you would like to be described, and will not take an invented answer', /choose one/.test(auth({ mode: 'signup', first: 'A', last: 'B', password: '12345678', gender: null })) && /choose one/.test(auth({ mode: 'signup', first: 'A', last: 'B', password: '12345678', gender: 'wizard' })) && auth({ mode: 'signup', first: 'A', last: 'B', password: '12345678', gender: 'prefer_not_to_say' }) === null);
check('signing in is not asked, because they answered when they joined', auth({ gender: null }) === null);
check('the four answers are the four the database will accept', L.PROFILE_GENDERS.join() === 'woman,man,other,prefer_not_to_say');

check('a profile is finished when a school would know who is asking', L.profileComplete({ first_name: 'Ann', last_name: 'Rao', gender: 'woman' }) === true);
check('...preferring not to say finishes it too: it is an answer, not a gap', L.profileComplete({ first_name: 'Ann', last_name: 'Rao', gender: 'prefer_not_to_say' }) === true);
check('...a missing name, a blank name or no answer at all leaves it unfinished', L.profileComplete({ first_name: 'Ann', gender: 'woman' }) === false && L.profileComplete({ first_name: '  ', last_name: 'Rao', gender: 'woman' }) === false && L.profileComplete({ first_name: 'Ann', last_name: 'Rao' }) === false && L.profileComplete(null) === false);

check('everyone has a picture from the first moment, before they have chosen or said anything', L.PROFILE_AVATARS.includes(L.avatarFor(null)) && L.PROFILE_AVATARS.includes(L.avatarFor({ avatar: 'auto' })));
check('...the picture follows how they described themselves until they pick one', L.avatarFor({ avatar: 'auto', gender: 'woman' }) !== L.avatarFor({ avatar: 'auto', gender: 'man' }) && L.PROFILE_GENDERS.every((g) => L.PROFILE_AVATARS.includes(L.avatarFor({ avatar: 'auto', gender: g }))));
check('...and once they pick one, that is the one, whatever they said', L.avatarFor({ avatar: 'parent_six', gender: 'woman' }) === 'parent_six');
check('...a picture the app cannot draw is ignored rather than shown as a hole', L.PROFILE_AVATARS.includes(L.avatarFor({ avatar: 'mystery', gender: 'man' })));

{
  const seen = [];
  const db = { from: () => ({ update: (v) => { seen.push(v); return { eq: () => Promise.resolve({ error: null }) }; } }) };
  const r1 = await L.saveProfile(db, 'u1', { first_name: '  Ann  ', last_name: 'Rao', gender: 'woman', avatar: 'parent_two' });
  check('saving trims the names and sends exactly what was asked for', r1.error === null && seen[0].first_name === 'Ann' && seen[0].last_name === 'Rao' && seen[0].gender === 'woman' && seen[0].avatar === 'parent_two');
  const r2 = await L.saveProfile(db, 'u1', { gender: 'wizard', avatar: 'mystery' });
  check('...and quietly refuses to send an answer the database would reject', r2.error === null && seen.length === 1 && Object.keys(r2.saved).length === 0);
  const r3 = await L.saveProfile(db, 'u1', { first_name: 'x'.repeat(200), last_name: 'y' });
  check('...and a name longer than the column is cut to fit rather than failing at the database', seen[1].first_name.length === 60);
}

console.log('\n=== the address book ===');
const ROW = (id, label, extra = {}) => ({ id, label, address: null, latitude: 19.06, longitude: 72.83, created_at: '2026-09-01T10:00:00Z', ...extra });
check('a saved place turns back into somewhere to search from', eq(L.addressPlace(ROW('a1', 'Home')), { lat: 19.06, lng: 72.83 }));
check('...and a row with nothing in it is not a place', L.addressPlace(ROW('a2', 'Broken', { latitude: null })) === null && L.addressPlace(null) === null && L.addressPlace({}) === null);
check('a place needs a name', L.validateAddress({ label: '   ', rows: [] }) === EN['address.needName']);
check('...a name that would not fit on a button is refused, saying how long is allowed', L.validateAddress({ label: 'x'.repeat(41), rows: [] }) === 'A name can be up to 40 letters.');
check('...and the same name twice is refused, however it is spaced or capitalised', L.validateAddress({ label: ' home ', rows: [ROW('a1', 'Home')] }) === EN['address.nameTaken']);
check('renaming a place is not the same name twice', L.validateAddress({ label: 'Home', rows: [ROW('a1', 'Home')], editingId: 'a1' }) === null);
const six = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map((n, i) => ROW('a' + i, n));
check('six places is the most, and the seventh says so instead of failing at the database', L.validateAddress({ label: 'Seven', rows: six }) === 'You can keep up to 6 places.' && L.MAX_ADDRESSES === 6);
check('...but renaming one of the six is still allowed', L.validateAddress({ label: 'Second', rows: six, editingId: 'a1' }) === null);

db = fakeDb(() => ({ data: [ROW('a1', 'Home'), ROW('a2', 'No coordinates', { latitude: null, longitude: null }), ROW('a3', 'Work')], error: null }));
got = await L.loadAddresses(db);
check('the list is asked for in the order it was saved', ops(db.recs[0]).join(' ') === `select("${L.ADDRESS_COLUMNS}") order("created_at",{"ascending":true})`, ops(db.recs[0]).join(' '));
check('...and a row the app could not search from is left out rather than offered', got.rows.map((r) => r.label).join() === 'Home,Work' && got.error === null);
got = await L.loadAddresses(fakeDb(() => ({ data: null, error: { code: 'PGRST205', message: 'Could not find the table public.parent_addresses in the schema cache' } })));
check('...and when the table is not there yet, the error comes back so the app can hide the whole thing', got.rows.length === 0 && L.isMissingAddresses(got.error));
check('the two ways a missing table shows up are both recognised', L.isMissingAddresses({ code: '42P01', message: 'relation does not exist' }) && L.isMissingAddresses({ message: 'relation "public.parent_addresses" does not exist' }));
check('...and an ordinary problem is not mistaken for one', !L.isMissingAddresses({ code: '42501', message: 'permission denied' }) && !L.isMissingAddresses(null));

db = fakeDb(() => ({ error: null }));
res = await L.saveAddress(db, 'u1', { label: '  Home  ', address: '  Flat 4, Sunrise  ', place: { lat: 19.06, lng: 72.83 } });
check('saving a new place sends the name, the address and where it is, tidied up', res.error === null
  && eq(db.recs[0].ops[0], ['insert', { label: 'Home', address: 'Flat 4, Sunrise', user_id: 'u1', latitude: 19.06, longitude: 72.83 }]), JSON.stringify(db.recs[0].ops));
db = fakeDb(() => ({ error: null }));
await L.saveAddress(db, 'u1', { label: 'Home', address: '   ', place: { lat: 19.06, lng: 72.83 } });
check('...address text of nothing but spaces is saved as nothing at all', db.recs[0].ops[0][1].address === null);
db = fakeDb(() => ({ error: null }));
await L.saveAddress(db, 'u1', { label: 'H'.repeat(80), address: 'a'.repeat(300), place: { lat: 19.06, lng: 72.83 } });
check('...and anything longer than the database allows is cut to fit rather than refused there', db.recs[0].ops[0][1].label.length === L.MAX_ADDRESS_NAME && db.recs[0].ops[0][1].address.length === L.MAX_ADDRESS_TEXT);
db = fakeDb(() => ({ error: null }));
res = await L.saveAddress(db, 'u1', { label: 'Home', address: '', place: null });
check('a new place with nowhere to save is not sent at all', !!res.error && db.recs.length === 0);
db = fakeDb(() => ({ error: null }));
res = await L.saveAddress(db, 'u1', { id: 'a1', label: 'Grandma', address: 'Sion' });
check('renaming a place changes only the name and the address, and never moves it', res.error === null
  && eq(db.recs[0].ops[0], ['update', { label: 'Grandma', address: 'Sion' }]) && eq(db.recs[0].ops[1], ['eq', 'id', 'a1']), JSON.stringify(db.recs[0].ops));
db = fakeDb(() => ({ error: { message: 'no' } }));
res = await L.saveAddress(db, 'u1', { id: 'a1', label: 'Grandma' });
check('...and a refusal from the database comes back rather than being swallowed', !!res.error);
db = fakeDb(() => ({ error: null }));
res = await L.deleteAddress(db, 'a1');
check('removing a place removes exactly that one', res.error === null && eq(db.recs[0].ops, [['delete'], ['eq', 'id', 'a1']]), JSON.stringify(db.recs[0].ops));

check('what the phone says is at a position becomes one line', L.describePlace([{ name: '4', street: 'Hill Road', district: 'Bandra West', city: 'Mumbai', postalCode: '400050' }]) === '4, Hill Road, Bandra West, Mumbai');
check('...without saying the same thing twice', L.describePlace([{ name: 'Bandra', street: null, district: 'bandra', city: 'Mumbai' }]) === 'Bandra, Mumbai');
check('...and a phone that answers with nothing leaves the parent to type it', L.describePlace([]) === '' && L.describePlace(null) === '' && L.describePlace([{}]) === '');
check('a phone with no address lookup at all is not a problem', await L.addressHere({}, { lat: 19, lng: 72 }) === '');
check('...nor is one whose lookup fails', await L.addressHere({ reverseGeocodeAsync: async () => { throw new Error('no service'); } }, { lat: 19, lng: 72 }) === '');
check('...and when it does work, the address is offered ready to keep or change', await L.addressHere({ reverseGeocodeAsync: async () => [{ street: 'Hill Road', city: 'Mumbai' }] }, { lat: 19, lng: 72 }) === 'Hill Road, Mumbai');
console.log('\n=== the tour ===');
const STEPS = L.TOUR_STEPS;
check('every card has a picture, words of its own, and the version it arrived in', STEPS.length >= 5
  && STEPS.every((x) => x.key && x.icon && x.title && x.body && x.added >= 1)
  && new Set(STEPS.map((x) => x.key)).size === STEPS.length);
check('...and every word the tour asks for is in the language packs', STEPS.every((x) => EN[x.title] && EN[x.body]),
  STEPS.filter((x) => !EN[x.title] || !EN[x.body]).map((x) => x.key).join());
check('the cards come in an order a parent would meet them in', STEPS.map((x) => x.key).join().startsWith('find,near,compare,ask,you'));
check('the version of the tour is the newest card in it', L.TOUR_VERSION === Math.max(...STEPS.map((x) => x.added)));
check('a phone that has never been here is shown all of it', L.tourToShow(null).length === STEPS.length && L.tourToShow(undefined).length === STEPS.length && L.tourToShow('').length === STEPS.length);
check('...one that has been through all of it is shown none of it', L.tourToShow(String(L.TOUR_VERSION)).length === 0);
check('...and one that asked not to be shown it again is shown none of it either', L.tourToShow(L.TOUR_NEVER).length === 0);
{
  // two versions of a pretend tour, so the "only what is new" rule is checked on its own rather than on today's cards
  const pretend = [{ key: 'a', added: 1 }, { key: 'b', added: 1 }, { key: 'c', added: 2 }, { key: 'd', added: 3 }];
  check('somebody who read version one is shown only what came after it', L.tourToShow('1', pretend).map((x) => x.key).join() === 'c,d');
  check('...and somebody up to date with version two sees only the newest card', L.tourToShow('2', pretend).map((x) => x.key).join() === 'd');
  check('...and a new parent still sees the whole thing', L.tourToShow(null, pretend).length === 4);
  check('a half-written or older answer is treated as having seen nothing, never as having seen everything', L.tourToShow('yes', pretend).length === 4 && L.tourToShow('0', pretend).length === 4 && L.tourToShow('-3', pretend).length === 4);
}
check('reaching the end remembers the version just read', L.tourAfterFinish('1') === String(L.TOUR_VERSION) && L.tourAfterFinish(null) === String(L.TOUR_VERSION));
check('...but asking to see it again does not undo "do not show me this again"', L.tourAfterFinish(L.TOUR_NEVER) === L.TOUR_NEVER);
check('asking for a card past the end gives the last one, not nothing', L.tourStepAt(STEPS, 99).key === STEPS[STEPS.length - 1].key && L.tourStepAt(STEPS, -4).key === 'find');
check('...and nonsense gives the first', L.tourStepAt(STEPS, undefined).key === 'find' && L.tourStepAt(STEPS, null).key === 'find' && L.tourStepAt(STEPS, 'x').key === 'find');
check('...and a run with no cards in it gives nothing at all rather than failing', L.tourStepAt([], 0) === undefined && L.tourStepAt(undefined, 0) === undefined);
check('next stops at the last card of this run rather than running off the end', L.nextTourIndex(0, 1, 3) === 1 && L.nextTourIndex(2, 1, 3) === 2 && L.nextTourIndex(99, 1, 3) === 2);
check('...and back stops at the first', L.nextTourIndex(2, -1, 3) === 1 && L.nextTourIndex(0, -1, 3) === 0);
check('the last card of a run is the one that finishes, however long the run is', L.onLastTourStep(2, 3) && !L.onLastTourStep(1, 3) && L.onLastTourStep(0, 1));
check('what is kept on the phone is one word, under a name that says what it is', L.TOUR_SETTING === 'kidscover.tourSeen' && L.TOUR_NEVER === 'never');
console.log('\n=== light and dark ===');
check('there are three answers: follow the phone, light, dark', L.THEME_CHOICES.join() === 'system,light,dark');
check('following the phone means whatever the phone says', L.themeFor('system', 'dark') === 'dark' && L.themeFor('system', 'light') === 'light');
check('...and a phone that will not say counts as light, because that is what it looked like before', L.themeFor('system', null) === 'light' && L.themeFor('system', undefined) === 'light');
check('choosing one holds whatever the phone is set to', L.themeFor('dark', 'light') === 'dark' && L.themeFor('light', 'dark') === 'light');
check('a word the app does not know means following the phone, never a blank screen', L.themeChoiceOf('sepia') === 'system' && L.themeChoiceOf(null) === 'system' && L.themeChoiceOf('') === 'system');
check('...and the three it does know are kept as they are', L.THEME_CHOICES.every((c) => L.themeChoiceOf(c) === c));
check('what is kept on the phone is the word itself, under a name that says what it is', L.THEME_SETTING === 'kidscover.theme');

console.log('\n=== photographs ===');
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
check('a picture handed over as text comes back as the same bytes', (() => {
  const want = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x01]);
  const got = L.bytesFromBase64(b64(want));
  return got.length === want.length && want.every((x, i) => got[i] === x);
})());
check('...whatever length it is, and with the line breaks a phone may put in', (() => {
  for (let n = 0; n < 40; n++) {
    const want = Uint8Array.from(Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256));
    const text = b64(want).replace(/(.{8})/g, '$1\n');
    const got = L.bytesFromBase64(text);
    if (got.length !== want.length || !want.every((x, i) => got[i] === x)) return false;
  }
  return true;
})());
check('...and nothing at all comes back as nothing, rather than as a crash', L.bytesFromBase64('').length === 0 && L.bytesFromBase64(null).length === 0 && L.bytesFromBase64(undefined).length === 0);

check('what a phone says a picture is, made into one of the three kinds the bucket takes',
  L.photoTypeOf('image/jpeg') === 'image/jpeg' && L.photoTypeOf('image/jpg') === 'image/jpeg'
  && L.photoTypeOf('IMAGE/PNG; charset=binary') === 'image/png' && L.photoTypeOf('image/webp') === 'image/webp');
check('...worked out from the file name when the phone will not say', L.photoTypeOf(null, 'DSC_0001.JPG') === 'image/jpeg' && L.photoTypeOf('', 'sketch.png') === 'image/png');
check('...and anything else is nothing, so it is never sent to be refused', L.photoTypeOf('image/gif') === null && L.photoTypeOf('application/pdf', 'x.pdf') === null && L.photoTypeOf(null, null) === null);

const WHO = 'u1';
check('a file goes in the person\'s own folder, under a name nobody could guess', (() => {
  const path = L.photoPathFor('parent', WHO, 'image/jpeg', 1700000000000, 0.5);
  return path.startsWith(`parents/${WHO}/`) && path.endsWith('.jpg') && L.isOwnPhotoPath(path, 'parent', WHO);
})(), L.photoPathFor('parent', WHO, 'image/jpeg'));
check('...the child in the children folder, keeping the kind of picture it is', L.photoPathFor('child', WHO, 'image/png').startsWith(`children/${WHO}/`) && L.photoPathFor('child', WHO, 'image/png').endsWith('.png'));
check('...two pictures never land on the same name', L.photoPathFor('parent', WHO, 'image/jpeg', 1, 0.1) !== L.photoPathFor('parent', WHO, 'image/jpeg', 1, 0.9));
check('...and nothing is made up when there is nobody to make it for', L.photoPathFor('parent', null, 'image/jpeg') === null && L.photoPathFor('other', WHO, 'image/jpeg') === null && L.photoPathFor('parent', WHO, 'image/gif') === null);
check('somebody else\'s path is never mistaken for your own', !L.isOwnPhotoPath(`parents/u2/a.jpg`, 'parent', WHO) && !L.isOwnPhotoPath(`children/${WHO}/a.jpg`, 'parent', WHO) && !L.isOwnPhotoPath(`parents/${WHO}/../u2/a.jpg`, 'parent', WHO) && !L.isOwnPhotoPath(null, 'parent', WHO));

const someBytes = (n) => Uint8Array.from({ length: n }, () => 1);
check('a picture that could not be read is said to be, rather than sent', L.validatePhoto({ bytes: someBytes(0), mime: 'image/jpeg' }) === EN['photo.notRead'] && L.validatePhoto({}) === EN['photo.notRead']);
check('...a kind the bucket will not take is refused here, not at the server', L.validatePhoto({ bytes: someBytes(10), mime: 'image/gif' }) === EN['photo.wrongKind']);
check('...and one too large is refused with the size said out loud', L.validatePhoto({ bytes: someBytes(L.PHOTO_MAX_BYTES + 1), mime: 'image/jpeg' }) === 'That picture is larger than 3 MB. Try a smaller one.');
check('...while an ordinary photograph passes', L.validatePhoto({ bytes: someBytes(200000), mime: 'image/jpeg' }) === null);

// a stand-in phone, and a stand-in bucket
const phone = (answer) => ({ requestMediaLibraryPermissionsAsync: async () => ({ status: 'granted', canAskAgain: true }), launchImageLibraryAsync: async () => answer });
got = await L.pickPhoto(phone({ canceled: true }));
check('changing your mind in the picker is not a problem to report', got.cancelled === true && !got.problem);
got = await L.pickPhoto({ requestMediaLibraryPermissionsAsync: async () => ({ status: 'denied', canAskAgain: true }) });
check('...a phone that says no is said plainly', got.problem === 'denied' && L.photoProblemText('denied') === EN['photo.denied']);
got = await L.pickPhoto({ requestMediaLibraryPermissionsAsync: async () => ({ status: 'denied', canAskAgain: false }) });
check('...and one that will not ask again says where to change it', got.problem === 'blocked' && L.photoProblemText('blocked') === EN['photo.blocked']);
got = await L.pickPhoto(phone({ assets: [{ base64: b64([1, 2, 3]), mimeType: 'image/jpeg', fileName: 'a.jpg' }] }));
check('a picture chosen comes back as bytes and a kind', got.bytes.length === 3 && got.mime === 'image/jpeg' && !got.problem);
got = await L.pickPhoto(phone({ assets: [{ base64: b64([1]), mimeType: 'image/heic', fileName: 'a.heic' }] }));
check('...and one the app cannot use says so instead of failing later', got.problem === 'unreadable');
got = await L.pickPhoto({ requestMediaLibraryPermissionsAsync: async () => { throw new Error('no picker here'); } });
check('...as does a phone with no picker at all', got.problem === 'unreadable');

const bucket = (result) => { const calls = []; return { calls, from: () => ({ upload: async (...a) => { calls.push(['upload', ...a]); return result.upload ?? { error: null }; }, remove: async (...a) => { calls.push(['remove', ...a]); return { error: null }; }, createSignedUrl: async (...a) => { calls.push(['signed', ...a]); return result.signed ?? { data: { signedUrl: 'https://x/y' }, error: null }; } }) }; };
let store = bucket({});
await L.uploadPhoto(store, 'parents/u1/a.jpg', someBytes(5), 'image/jpeg');
check('a picture is put where it was told, saying what kind it is and never replacing something already there',
  store.calls[0][0] === 'upload' && store.calls[0][1] === 'parents/u1/a.jpg' && store.calls[0][3].contentType === 'image/jpeg' && store.calls[0][3].upsert === false, JSON.stringify(store.calls[0]));
store = bucket({});
const link = await L.signedPhotoUrl(store, 'parents/u1/a.jpg');
check('showing a photo asks for an address that runs out', link.url === 'https://x/y' && store.calls[0][2] === L.PHOTO_URL_SECONDS);
check('...and asking for nothing asks the server nothing', (await L.signedPhotoUrl(bucket({}), '')).url === '');
store = bucket({ signed: { data: null, error: { message: 'Object not found' } } });
check('...and a photo that cannot be fetched leaves nothing to show, not a broken picture', (await L.signedPhotoUrl(store, 'parents/u1/a.jpg')).url === '');
store = { from: () => ({ createSignedUrl: async () => { throw new Error('offline'); } }) };
check('...even when the network itself fails', (await L.signedPhotoUrl(store, 'parents/u1/a.jpg')).url === '');
store = bucket({});
await L.removePhoto(store, '');
check('taking away nothing asks the server nothing', store.calls.length === 0);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
