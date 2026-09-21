// Runs the real App.js screens (react-native-web + jsdom) against a stand-in database. Run: node tests/ui.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const tmp = path.join(here, '.tmp');
fs.mkdirSync(tmp, { recursive: true });

// ---- stand-ins for the packages that only exist on a phone / at Supabase ----
// (it also remembers everything the app writes to the phone's storage, so a test can check the location is never saved)
fs.writeFileSync(path.join(tmp, 'stub-storage.mjs'), `globalThis.__stored = []; export default { getItem: async () => null, setItem: async (k, v) => { globalThis.__stored.push([k, String(v)]); }, removeItem: async () => {} };`);
fs.writeFileSync(path.join(tmp, 'stub-empty.mjs'), `export {};`);
fs.writeFileSync(path.join(tmp, 'stub-svg.mjs'), `import * as React from 'react';\nconst mk = (tag) => function SvgPart({ testID, children, ...props }) { return React.createElement(tag, { ...props, 'data-testid': testID }, children); };\nexport default mk('svg');\nexport const Circle = mk('circle'), Defs = mk('defs'), Ellipse = mk('ellipse'), G = mk('g'), LinearGradient = mk('linearGradient'), Path = mk('path'), Polygon = mk('polygon'), Rect = mk('rect'), Stop = mk('stop');\n`);
// the phone's location: each test sets globalThis.__loc to the behaviour it wants
fs.writeFileSync(path.join(tmp, 'fake-location.mjs'), `export const Accuracy = { Balanced: 3 };\nexport const requestForegroundPermissionsAsync = (...a) => globalThis.__loc.requestForegroundPermissionsAsync(...a);\nexport const getCurrentPositionAsync = (...a) => globalThis.__loc.getCurrentPositionAsync(...a);`);
// the app creates its client when the file loads, before a test has set up its data, so look the real stand-in up on every use
fs.writeFileSync(path.join(tmp, 'fake-supabase.mjs'), `export const createClient = () => new Proxy({}, { get: (_, prop) => globalThis.__db[prop] });`);
// the phone's own keystore: on the web there is none, so the app falls back to ordinary storage (as here)
fs.writeFileSync(path.join(tmp, 'stub-securestore.mjs'), `export const setItemAsync = async () => {}; export const getItemAsync = async () => null; export const deleteItemAsync = async () => {};`);
// the fingerprint reader and the notifications: each test sets globalThis.__bio / globalThis.__push
fs.writeFileSync(path.join(tmp, 'fake-biometrics.mjs'), `export const AuthenticationType = { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 };\nexport const hasHardwareAsync = async () => globalThis.__bio?.hasHardwareAsync?.() ?? false;\nexport const isEnrolledAsync = async () => globalThis.__bio?.isEnrolledAsync?.() ?? false;\nexport const supportedAuthenticationTypesAsync = async () => globalThis.__bio?.supportedAuthenticationTypesAsync?.() ?? [];\nexport const authenticateAsync = async (...a) => globalThis.__bio?.authenticateAsync?.(...a) ?? { success: false };`);
fs.writeFileSync(path.join(tmp, 'fake-notifications.mjs'), `export const getPermissionsAsync = async () => globalThis.__push?.getPermissionsAsync?.() ?? { granted: false, status: 'undetermined' };\nexport const requestPermissionsAsync = async () => globalThis.__push?.requestPermissionsAsync?.() ?? { granted: false, status: 'denied' };\nexport const getExpoPushTokenAsync = async (...a) => globalThis.__push?.getExpoPushTokenAsync?.(...a) ?? { data: '' };\nexport const addNotificationResponseReceivedListener = (fn) => { globalThis.__push?.listen?.(fn); return { remove() {} }; };`);
fs.writeFileSync(path.join(tmp, 'stub-constants.mjs'), `export default { expoConfig: { extra: { eas: { projectId: 'test-project' } } } };`);
// A stand-in phone that has taken 32 points at the top for its clock and 48 at the bottom for its navigation buttons,
// which is roughly what the Android phone that showed the cut-off buttons reports.
fs.writeFileSync(path.join(tmp, 'stub-safe-area.mjs'), `import * as React from 'react';
export const INSETS = { top: 32, bottom: 48, left: 0, right: 0 };
export function SafeAreaProvider({ children }) { return React.createElement(React.Fragment, null, children); }
export function useSafeAreaInsets() { return INSETS; }
`);
fs.writeFileSync(path.join(tmp, 'stub-crypto.mjs'), `export const getRandomBytesAsync = async (n) => new Uint8Array(n).fill(7);`);

const appSource = fs.readFileSync(process.env.APP_FILE ?? path.join(root, 'App.js'), 'utf8');
const EN = JSON.parse(fs.readFileSync(path.join(root, 'i18n', 'en.json'), 'utf8'));
async function bundle(name, source) {
  // the copy of the app lives in tests/.tmp, so point it at the real language packs
  const i18nPath = path.join(root, 'i18n', 'index.js').split(path.sep).join('/');
  fs.writeFileSync(path.join(tmp, `${name}.App.js`), source.replace("from './i18n'", `from ${JSON.stringify(i18nPath)}`));
  fs.writeFileSync(path.join(tmp, `${name}.entry.jsx`), `import * as React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './${name}.App.js';\nexport { React, createRoot, App };\n`);
  await build({
    entryPoints: [path.join(tmp, `${name}.entry.jsx`)], bundle: true, format: 'esm', platform: 'node', outfile: path.join(tmp, `${name}.bundle.mjs`),
    loader: { '.js': 'jsx', '.json': 'json' }, jsx: 'automatic', logLevel: 'error',
    alias: {
      'react-native': 'react-native-web',
      '@react-native-async-storage/async-storage': path.join(tmp, 'stub-storage.mjs'),
      'react-native-url-polyfill/auto': path.join(tmp, 'stub-empty.mjs'),
      '@supabase/supabase-js': path.join(tmp, 'fake-supabase.mjs'),
      'expo-location': path.join(tmp, 'fake-location.mjs'),
      'react-native-svg': path.join(tmp, 'stub-svg.mjs'),
      'expo-secure-store': path.join(tmp, 'stub-securestore.mjs'),
      'expo-local-authentication': path.join(tmp, 'fake-biometrics.mjs'),
      'expo-notifications': path.join(tmp, 'fake-notifications.mjs'),
      'expo-constants': path.join(tmp, 'stub-constants.mjs'),
      'react-native-safe-area-context': path.join(tmp, 'stub-safe-area.mjs'),
      'expo-crypto': path.join(tmp, 'stub-crypto.mjs'),
    },
    define: { 'process.env.NODE_ENV': '"development"', __DEV__: 'true' },
  });
  return pathToFileURL(path.join(tmp, `${name}.bundle.mjs`)).href;
}
// App.js ships with a real publishable key, so the app as committed is the keyed one. To test what someone sees who
// has pointed the app at their own project and not put their key in yet, the key is taken back out here.
const keyedSource = appSource;
const unkeyedSource = appSource.replace(/const SUPABASE_KEY = '[^']*';/, "const SUPABASE_KEY = 'PASTE_YOUR_PUBLISHABLE_KEY_HERE';");
if (unkeyedSource === appSource) throw new Error('could not take the key back out: the SUPABASE_KEY line changed');
const keyedUrl = await bundle('keyed', keyedSource);
const unkeyedUrl = await bundle('unkeyed', unkeyedSource);
// the same app with a 60 ms wait for the phone's position instead of 15 s, so a "phone never answers" case can be tested
const quickSource = keyedSource.replace('const LOCATION_TIMEOUT_MS = 15000;', 'const LOCATION_TIMEOUT_MS = 60;');
if (quickSource === keyedSource) throw new Error('could not shorten the location wait: the constant changed');
const quickUrl = await bundle('quick', quickSource);

// ---- a tiny browser ----
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window;
globalThis.window = w; globalThis.document = w.document;
for (const k of ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Element', 'Node', 'ShadowRoot', 'DocumentFragment', 'Event', 'MouseEvent', 'KeyboardEvent', 'FocusEvent', 'CustomEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'CSS']) { try { if (w[k] !== undefined) globalThis[k] = w[k]; } catch { /* read-only */ } }
try { Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true }); } catch { /* ignore */ }
w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
globalThis.ResizeObserver = w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.IS_REACT_ACT_ENVIRONMENT = false;
const opened = []; w.open = (u) => { opened.push(u); return null; };

// each bundle carries its own copy of React, so an app must always be rendered with the React that came with it
const keyed = await import(keyedUrl);
const unkeyed = await import(unkeyedUrl);
const quick = await import(quickUrl);

// ---- the stand-in database: follows the same rules as the real one ----
// the same recipe as the database column schools.name_sort: first part before " | ", punctuation and emoji removed, lower case
const sortKey = (name) => name.split(' | ')[0].replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
const S = (id, name, address, levels, rating, count, extra = {}) => ({ id, name, name_sort: sortKey(name), address, levels, google_rating: rating, google_review_count: count, board: null, website: null, is_hidden: false, category: 'school', ...extra });
function seed() {
  const schools = [
    S('s1', 'Sunrise Preschool & Daycare', 'Bandra West, Mumbai', ['daycare', 'preschool'], 4.8, 120, { website: 'sunrisepre.in', latitude: 19.0596, longitude: 72.8295 }),
    S('s2', "St. Andrew's High School", 'Bandra West, Mumbai', ['secondary'], null, null, { latitude: 19.055, longitude: 72.829 }),
    S('s3', 'Podar Primary', 'Santacruz, Mumbai', ['primary'], 4.1, 40, { latitude: 19.08, longitude: 72.842 }),
    S('s4', 'BMC School Sion', '3W9C+9VX, Sion, Mumbai', [], null, null, { latitude: 19.039, longitude: 72.8619 }),
    S('s5', 'Tiny Tots Preschool', 'Andheri, Mumbai', ['preschool'], 4.9, 60, { latitude: 19.1136, longitude: 72.8697 }),
    S('s6', 'Kids Daycare Only', 'Powai, Mumbai', ['daycare'], 4.5, 10, { latitude: 19.1176, longitude: 72.906 }),
    S('s7', 'Chess Class', 'Dadar, Mumbai', ['primary'], 5, 3, { is_hidden: true, latitude: 19.0178, longitude: 72.8478 }),
  ];
  for (let i = 1; i <= 25; i++) schools.push(S('f' + String(i).padStart(2, '0'), 'Filler School ' + String(i).padStart(2, '0'), 'Chembur, Mumbai', ['primary'], null, null, i === 25 ? {} : { latitude: Math.round((19.0625 + i * 0.0004) * 1e6) / 1e6, longitude: 72.9023 })); // the last one has no coordinates yet
  // a name that starts with a bracket, and two schools with the SAME name (a chain with two branches)
  schools.push(S('n3', '(S.E.S) SITALDAS KHEMANI HIGH SCHOOL', 'Ulhasnagar, Maharashtra', ['secondary'], null, null, { latitude: 19.2215, longitude: 73.1631 }));
  schools.push(S('t2', 'Twin Branch School', 'Thane', ['primary'], null, null, { latitude: 19.2183, longitude: 72.9781 }));
  schools.push(S('t1', 'Twin Branch School', 'Thane', ['primary'], null, null, { latitude: 19.2183, longitude: 72.9781 }));
  // two real-looking Google names with emoji / search-engine text
  schools.push(S('n1', '\u{1F60A}Smiling Kids Pre-school \u{1F60A} and \u{1F4DA}Eon International School \u{1F4DA}', 'Kalher, Maharashtra', ['preschool'], 5, 21, { latitude: 19.2831, longitude: 73.0546 }));
  schools.push(S('n2', '270 Degree Kids Preschool Kasarvadavali, Thane | Best Preschool In Kasarvadavali', 'Kasarvadavali, Thane', ['preschool', 'daycare'], 4.9, 139, { latitude: 19.2645, longitude: 72.9694, photo_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/270.jpg/800px-270.jpg', photo_source: 'wikimedia', photo_credit: 'Jane Doe', photo_licence: 'CC BY-SA 4.0', photo_page_url: 'https://commons.wikimedia.org/wiki/File:270.jpg' }));
  Object.assign(schools.find((x) => x.id === 'n2'), { fee_preschool: 136000, fee_primary: 231000, fees_from: 136000, fees_year: '2026-27', start_time: '08:15:00', start_time_source: 'school' });
  Object.assign(schools.find((x) => x.id === 's1'), { fee_preschool: 60000, fees_from: 60000, fees_year: '2026-27' });
  Object.assign(schools.find((x) => x.id === 's4'), { photo_url: 'https://proj.supabase.co/storage/v1/object/public/school-photos/s4/photo-1.jpg', photo_source: 'school', photo_credit: null });
  return {
    schools, session: null, log: [], authCalls: [], nextId: 1,
    users: { 'ann@x.in': { password: 'password1', id: 'u1', verified: true }, 'bob@x.in': { password: 'password2', id: 'u2', verified: true }, 'cat@x.in': { password: 'password3', id: 'u3', verified: false } },
    reviews: [
      { id: 'rv1', school_id: 's1', rating: 5, title: 'Wonderful start', body: 'The teachers are warm and the place is spotless.', relationship: 'current_parent', status: 'published', created_at: '2026-08-10T10:00:00Z' },
      { id: 'rv2', school_id: 's1', rating: 4, title: null, body: 'Good activities, fees are on the higher side.', relationship: 'former_parent', status: 'published', created_at: '2026-07-01T10:00:00Z' },
      { id: 'rv3', school_id: 's1', rating: 1, title: 'Hidden pending one', body: 'This one is still waiting for a moderator.', relationship: 'other', status: 'pending', created_at: '2026-09-01T10:00:00Z' },
    ],
    private: [{ review_id: 'rv1', school_id: 's1', author_id: 'u2', moderation_note: null }, { review_id: 'rv2', school_id: 's1', author_id: 'u9', moderation_note: null }, { review_id: 'rv3', school_id: 's1', author_id: 'u9', moderation_note: null }],
    reports: [], failNext: null,
    fees: [
      { school_id: 'n2', level: 'preschool', academic_year: '2026-27', tuition: 90000, transport: 24000, meals: 0, uniform_books: 6000,
        activities: 0, other_annual: 0, admission_fee: 15000, registration_fee: 1000, deposit: 5000, annual_total: 120000,
        first_year_total: 136000, note: 'Sibling discount 10%', source: 'school', source_url: null },
      { school_id: 'n2', level: 'primary', academic_year: '2026-27', tuition: 150000, transport: 30000, meals: 12000, uniform_books: 8000,
        activities: 5000, other_annual: 0, admission_fee: 25000, registration_fee: 1000, deposit: 10000, annual_total: 205000,
        first_year_total: 231000, note: null, source: 'kidscover', source_url: null },
    ],
    applications: [], appEvents: [], notifications: [], pushTokens: [], clicks: [], profiles: {},
    deleteAccountResult: { ok: true },
    threads: [], tmsgs: [], nextT: 1, rpcCalls: [], clock: Date.now(),
    fnCalls: [], fnMode: 'ok', lookupsLeft: undefined,
    facilities: [
      { school_id: 'n2', facility: 'teacher_ratio', detail: '1:15', source: 'school' },
      { school_id: 'n2', facility: 'library', detail: null, source: 'school' },
      { school_id: 'n2', facility: 'helipad', detail: null, source: 'school' },
      { school_id: 'n2', facility: 'cafeteria', detail: null, source: 'school website' },
    ],
    achievements: [
      { id: 'a1', school_id: 'n2', kind: 'class12', text: 'All students passed HSC', year: 2025, source: 'school', source_url: null },
      { id: 'a2', school_id: 'n2', kind: 'class10', text: '100% pass in SSC, topper 97.2%', year: 2025, source: 'school website', source_url: 'https://270degree.example/results' },
      { id: 'a3', school_id: 'n2', kind: 'class10', text: 'Topper 96.4%', year: 2024, source: 'school', source_url: null },
    ],
  };
}

// a clock that always moves forward, so "which is newest" is never a coin toss between two calls in the same moment
const tick = (st) => new Date((st.clock += 1000)).toISOString();

// what the enquiry_threads view works out for each thread
const threadRows = (st) => st.threads.map((t) => {
  const mine = st.tmsgs.filter((m) => m.ticket_id === t.id);
  return {
    ...t,
    message_count: mine.length,
    last_message: mine[mine.length - 1]?.message ?? null,
    unread_for_parent: new Date(t.last_message_at) > new Date(t.parent_read_at ?? 0),
  };
});

// the school answering, as the database trigger would record it
function staffReply(st, ticketId, message) {
  const now = tick(st);
  st.tmsgs.push({ id: 'staff' + st.nextT++, ticket_id: ticketId, sender_id: 'school-staff', sender_role: 'school', message, created_at: now });
  const t = st.threads.find((x) => x.id === ticketId);
  t.last_message_at = now;
  t.status = 'replied';
}
// great-circle distance in km, written here on its own (the app never calculates distance; the database does)
const hav = (a, b, c, d) => { const rad = (x) => (x * Math.PI) / 180; const h = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2; return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h))); };
const cond = (r, { col, op, val }) => {
  const v = r[col];
  if (op === 'ilike') return v != null && String(v).toLowerCase().includes(val.replace(/\*/g, '').toLowerCase());
  if (op === 'gte') return v != null && v >= Number(val);
  if (op === 'is') return val === 'null' && v == null;
  if (op === 'ov') { const vals = val.replace(/^{|}$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')); return Array.isArray(v) && v.some((x) => vals.includes(x)); }
  return false;
};
class Query {
  constructor(state, table) { Object.assign(this, { state, table, preds: [], sorts: [], op: 'select', payload: null, rng: null, lim: null, one: false, ops: [] }); state.log.push(this); }
  select(cols) { this.cols = cols; return this; }
  eq(c, v) { this.ops.push(['eq', c, v]); this.preds.push((r) => (c === 'levels' && v === '{}' ? Array.isArray(r.levels) && r.levels.length === 0 : r[c] === v)); return this; }
  in(c, vals) { this.preds.push((r) => vals.includes(r[c])); return this; }
  overlaps(c, vals) { this.ops.push(['overlaps', c, vals]); this.preds.push((r) => Array.isArray(r[c]) && r[c].some((x) => vals.includes(x))); return this; }
  contains(c, vals) { this.preds.push((r) => Array.isArray(r[c]) && vals.every((x) => r[c].includes(x))); return this; }
  gte(c, v) { this.preds.push((r) => r[c] != null && r[c] >= v); return this; }
  lte(c, v) { this.ops.push(['lte', c, v]); this.preds.push((r) => r[c] != null && r[c] <= v); return this; }
  not(c, op, v) { this.preds.push((r) => (op === 'is' && v === null ? r[c] != null : true)); return this; }
  or(str) { this.ops.push(['or', str]); const cs = str.split(',').map((t) => { const [col, op, ...rest] = t.split('.'); return { col, op, val: rest.join('.') }; }); this.preds.push((r) => cs.some((c) => cond(r, c))); return this; }
  order(c, o) { this.sorts.push([c, o]); return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  limit(n) { this.lim = n; return this; }
  maybeSingle() { this.one = true; return this; }
  insert(p) { this.op = 'insert'; this.payload = p; return this; }
  update(p) { this.op = 'update'; this.payload = p; return this; }
  delete() { this.op = 'delete'; return this; }
  then(res, rej) { return Promise.resolve(this.exec()).then(res, rej); }
  finish(rows) {
    // like the real database: sort by the first key, and use the next keys only to break ties
    if (this.sorts.length) {
      rows = [...rows].sort((x, y) => {
        for (const [c, o] of this.sorts) {
          const a = x[c], b = y[c];
          let d;
          if (a == null && b == null) d = 0; else if (a == null) d = o?.nullsFirst ? -1 : 1; else if (b == null) d = o?.nullsFirst ? 1 : -1;
          else d = (a < b ? -1 : a > b ? 1 : 0) * (o?.ascending === false ? -1 : 1);
          if (d !== 0) return d;
        }
        return 0;
      });
    }
    if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
    if (this.lim != null) rows = rows.slice(0, this.lim);
    return this.one ? { data: rows[0] ?? null, error: null } : { data: rows, error: null };
  }
  exec() {
    const st = this.state, me = st.session?.user;
    if (st.failNext) { const e = st.failNext; st.failNext = null; return { data: null, error: e }; }
    const mineIds = new Set(st.private.filter((p) => p.author_id === me?.id).map((p) => p.review_id));
    const all = (rows) => rows.filter((r) => this.preds.every((p) => p(r)));
    if (this.table === 'school_facilities' || this.table === 'school_achievements') {
      if (st.profilesMissing) return { data: null, error: { code: '42P01', message: `relation "public.${this.table}" does not exist` } };
      return this.finish(all(this.table === 'school_facilities' ? st.facilities : st.achievements));
    }
    if (this.table === 'schools') return this.finish(all(st.schools));
    if (this.table === 'school_fee_schedules') {
      if (st.feesMissing) return { data: null, error: { code: '42P01', message: 'relation "public.school_fee_schedules" does not exist' } };
      return this.finish(all(st.fees));
    }
    if (this.table === 'admission_applications') {
      if (st.applicationsMissing) return { data: null, error: { code: 'PGRST205', message: 'Could not find the table public.admission_applications in the schema cache' } };
      return this.finish(all(st.applications.filter((a) => a.parent_id === me?.id).map((a) => ({ ...a, schools: { name: st.schools.find((x) => x.id === a.school_id)?.name ?? null } }))));
    }
    if (this.table === 'admission_application_events') return this.finish(all(st.appEvents));
    if (this.table === 'notifications') return this.finish(all(st.notifications.filter((n) => n.user_id === me?.id)));
    if (this.table === 'profiles') {
      if (this.op === 'update') { st.profiles[me?.id] = { ...(st.profiles[me?.id] ?? {}), ...this.payload }; return { error: null }; }
      const row = { id: me?.id, language: null, notify_push: true, first_name: 'Ann', last_name: 'Rao', email: me?.email, ...(st.profiles[me?.id] ?? {}) };
      return this.finish(all([row]));
    }
    if (this.table === 'rpc:schools_nearby') {
      // the same rules as the database function: only schools with coordinates, distance in km rounded to 0.01, bad input -> nothing
      if (st.nearbyMissing) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.schools_nearby(p_lat, p_lng) in the schema cache' } };
      const { p_lat, p_lng } = this.args;
      if (![p_lat, p_lng].every((x) => typeof x === 'number' && Number.isFinite(x)) || Math.abs(p_lat) > 90 || Math.abs(p_lng) > 180) return this.finish([]);
      return this.finish(all(st.schools.filter((x) => x.latitude != null && x.longitude != null).map((x) => ({ ...x, distance_km: Math.round(hav(p_lat, p_lng, x.latitude, x.longitude) * 100) / 100 }))));
    }
    if (this.table === 'school_review_stats') {
      const by = {}; for (const r of st.reviews.filter((x) => x.status === 'published')) (by[r.school_id] ??= []).push(r.rating);
      return this.finish(all(Object.entries(by).map(([school_id, a]) => ({ school_id, review_count: a.length, avg_rating: (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) }))));
    }
    if (this.table === 'school_review_private') return this.finish(all(st.private.filter((p) => p.author_id === me?.id)));
    if (this.table === 'school_reviews') {
      if (this.op === 'select') return this.finish(all(st.reviews.filter((r) => r.status === 'published' || mineIds.has(r.id))));
      if (this.op === 'insert') {
        if (!me || !st.users[me.email].verified) return { error: { code: '42501', message: 'new row violates row-level security policy for table "school_reviews"' } };
        if (st.private.some((p) => p.school_id === this.payload.school_id && p.author_id === me.id)) return { error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        const id = 'new' + st.nextId++;
        st.reviews.push({ id, status: 'pending', created_at: '2026-09-19T09:00:00Z', ...this.payload });
        st.private.push({ review_id: id, school_id: this.payload.school_id, author_id: me.id, moderation_note: null });
        return { error: null };
      }
      const target = st.reviews.filter((r) => mineIds.has(r.id) && this.preds.every((p) => p(r)));
      if (this.op === 'update') {
        for (const r of target) { if (r.status === 'removed') return { error: { code: '42501', message: 'this review was removed and cannot be edited' } }; Object.assign(r, this.payload, { status: 'pending' }); st.private.find((p) => p.review_id === r.id).moderation_note = null; }
        return { error: null };
      }
      st.reviews = st.reviews.filter((r) => !target.includes(r)); st.private = st.private.filter((p) => !target.some((r) => r.id === p.review_id));
      return { error: null };
    }
    if (this.table.startsWith('rpc:') && this.table !== 'rpc:schools_nearby') {
      const fn = this.table.slice(4);
      const args = this.args ?? {};
      st.rpcCalls.push({ fn, args });
      const own = (id) => st.threads.find((t) => t.id === id && t.parent_id === me?.id);
      if (fn === 'send_enquiry') {
        if (!me || !st.users[me.email].verified) return { data: null, error: { code: '42501', message: 'confirm your email address first' } };
        if (st.threads.some((t) => t.parent_id === me.id && t.school_id === args.p_school && t.status !== 'closed')) {
          return { data: null, error: { code: 'P0001', message: 'an enquiry with this school is already open' } };
        }
        const now = tick(st);
        const id = 'th' + st.nextT++;
        st.threads.push({
          id, school_id: args.p_school, school_name: st.schools.find((x) => x.id === args.p_school)?.name ?? null,
          parent_id: me.id, subject: args.p_subject, grade_of_interest: args.p_grade, start_year: args.p_start_year,
          status: 'open', created_at: now, last_message_at: now, parent_read_at: now,
        });
        st.tmsgs.push({ id: 'tm' + st.nextT++, ticket_id: id, sender_id: me.id, message: args.p_message, created_at: now });
        return { data: id, error: null };
      }
      if (fn === 'school_tiles') {
        const inside = st.schools.filter((x) => !x.is_hidden && x.category !== 'after_school' && x.category !== 'college');
        return { data: { schools: inside.length, admissions_open: inside.filter((x) => x.admissions_open && x.admissions_source_url).length,
          admissions_closed: 0, with_fees: inside.filter((x) => x.fees_from != null).length }, error: null };
      }
      if (fn === 'submit_admission_application') {
        if (!me || !st.users[me.email].verified) return { data: null, error: { code: '42501', message: 'Please confirm your email address first' } };
        const form = args.p_form ?? {};
        if (st.applications.some((a) => a.school_id === args.p_school && a.parent_id === me.id
          && a.child_first_name.toLowerCase() === String(form.child_first_name).toLowerCase() && !['withdrawn', 'declined'].includes(a.status))) {
          return { data: null, error: { code: '23505', message: 'You have already applied to this school for this child' } };
        }
        const id = 'app' + st.nextT++;
        st.applications.push({ id, school_id: args.p_school, parent_id: me.id, status: 'submitted', status_note: null,
          consent_at: tick(st), created_at: tick(st), updated_at: tick(st), ...form });
        st.appEvents.push({ id: st.appEvents.length + 1, application_id: id, status: 'submitted', note: null, by_role: 'parent', at: tick(st) });
        return { data: id, error: null };
      }
      if (fn === 'withdraw_admission_application') {
        const a = st.applications.find((x) => x.id === args.p_app && x.parent_id === me?.id);
        if (!a) return { data: null, error: { code: '42501', message: 'This application is not yours' } };
        a.status = 'withdrawn';
        st.appEvents.push({ id: st.appEvents.length + 1, application_id: a.id, status: 'withdrawn', note: null, by_role: 'parent', at: tick(st) });
        return { data: null, error: null };
      }
      if (fn === 'delete_admission_application') {
        const before = st.applications.length;
        st.applications = st.applications.filter((x) => !(x.id === args.p_app && x.parent_id === me?.id));
        st.appEvents = st.appEvents.filter((e) => e.application_id !== args.p_app);
        return before === st.applications.length ? { data: null, error: { code: '42501', message: 'This application is not yours' } } : { data: null, error: null };
      }
      if (fn === 'register_push_device') { st.pushTokens.push({ token: args.p_token, platform: args.p_platform, user: me?.id }); return { data: null, error: null }; }
      if (fn === 'unregister_push_device') { st.pushTokens = st.pushTokens.filter((x) => x.token !== args.p_token); return { data: null, error: null }; }
      if (fn === 'log_outbound_click') { st.clicks.push({ school: args.p_school, kind: args.p_kind, user: me?.id }); return { data: null, error: null }; }
      if (fn === 'mark_notifications_read') { st.notifications.filter((n) => n.user_id === me?.id).forEach((n) => { n.read_at = tick(st); }); return { data: null, error: null }; }
      if (fn === 'mark_ticket_read') {
        const t = own(args.p_ticket);
        if (!t) return { data: null, error: { code: '42501', message: 'this enquiry is not yours' } };
        t.parent_read_at = tick(st);
        return { data: null, error: null };
      }
      if (fn === 'set_ticket_status') {
        const t = own(args.p_ticket);
        if (!t) return { data: null, error: { code: '42501', message: 'this enquiry is not yours' } };
        t.status = args.p_status;
        return { data: null, error: null };
      }
      return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` } };
    }
    if (this.table === 'enquiry_threads') return this.finish(all(threadRows(st).filter((t) => t.parent_id === me?.id)));
    if (this.table === 'ticket_messages') {
      const mineThread = (id) => st.threads.find((t) => t.id === id && t.parent_id === me?.id);
      if (this.op === 'insert') {
        if (!me || !st.users[me.email].verified) return { error: { code: '42501', message: 'confirm your email address first' } };
        if (!mineThread(this.payload.ticket_id)) return { error: { code: '42501', message: 'this enquiry is not yours' } };
        const now = tick(st);
        st.tmsgs.push({ id: 'tm' + st.nextT++, ticket_id: this.payload.ticket_id, sender_id: me.id, message: this.payload.message, created_at: now });
        const t = st.threads.find((x) => x.id === this.payload.ticket_id);
        t.last_message_at = now; t.status = 'open'; t.parent_read_at = now;   // writing counts as reading, as the trigger does
        return { error: null };
      }
      return this.finish(all(st.tmsgs.filter((m) => mineThread(m.ticket_id))));
    }
    if (this.table === 'review_reports' && this.op === 'insert') {
      const rev = st.reviews.find((r) => r.id === this.payload.review_id);
      if (!me || !st.users[me.email].verified || !rev || rev.status !== 'published' || mineIds.has(rev.id)) return { error: { code: '42501', message: 'new row violates row-level security policy' } };
      if (st.reports.some((r) => r.review_id === rev.id && r.reporter === me.id)) return { error: { code: '23505', message: 'duplicate key' } };
      st.reports.push({ ...this.payload, reporter: me.id }); return { error: null };
    }
    return { data: [], error: null };
  }
}
function makeDb(state) {
  const listeners = new Set(); const notify = (e, s) => listeners.forEach((cb) => cb(e, s));
  return {
    auth: {
      getSession: async () => ({ data: { session: state.session } }),
      onAuthStateChange: (cb) => { listeners.add(cb); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }; },
      signInWithPassword: async ({ email, password }) => { state.authCalls.push(['signin', email]); const u = state.users[email]; if (!u || u.password !== password) return { data: {}, error: { message: 'Invalid login credentials' } }; state.session = { user: { id: u.id, email } }; notify('SIGNED_IN', state.session); return { data: { session: state.session }, error: null }; },
      signUp: async (args) => { state.authCalls.push(['signup', args]); if (state.users[args.email]) return { data: {}, error: { message: 'User already registered' } }; return { data: { session: null }, error: null }; },
      signOut: async () => { state.session = null; notify('SIGNED_OUT', null); return { error: null }; },
      startAutoRefresh() {}, stopAutoRefresh() {},
    },
    from: (t) => new Query(state, t),
    rpc: (fn, args) => Object.assign(new Query(state, 'rpc:' + fn), { args }),
    // the commute-times edge function: a fixed rule for the minutes, and one school (s6) that has no road to it
    functions: {
      invoke: async (name, opts) => {
        const body = opts?.body ?? {};
        state.fnCalls.push({ name, body });
        const mode = state.fnMode ?? 'ok';
        if (mode === 'not_deployed') return { data: null, error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status: 404 } } };
        if (mode === 'network') return { data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' } };
        if (name === 'delete-account') return { data: state.deleteAccountResult, error: null };
        if (name === 'send-push' || name === 'crm-deliver') return { data: { ok: true }, error: null };
        if (mode !== 'ok') return { data: { ok: false, code: mode, limit: 20 }, error: null };
        const times = {};
        for (const id of body.schoolIds) {
          const x = state.schools.find((s2) => s2.id === id);
          times[id] = !x || x.id === 's6' || x.latitude == null ? null : { minutes: Math.round(hav(body.lat, body.lng, x.latitude, x.longitude) * 3) + 4, km: 1 };
        }
        if (typeof state.lookupsLeft === 'number') state.lookupsLeft -= 1;
        return { data: { ok: true, when: body.when, times, lookupsLeft: state.lookupsLeft ?? 15 }, error: null };
      },
    },
  };
}

// ---- helpers ----
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  -> ' + String(detail).slice(0, 220) : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 4000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch { /* keep waiting */ } await sleep(15); } return false; }
async function mount(state, mod = keyed) {
  globalThis.__db = makeDb(state);
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootEl = mod.createRoot(container); rootEl.render(mod.React.createElement(mod.App));
  const api = {
    c: container, state,
    id: (t) => container.querySelector(`[data-testid="${t}"]`),
    all: (prefix) => [...container.querySelectorAll(`[data-testid^="${prefix}"]`)],
    text: () => container.textContent,
    click: async (t) => { const el = typeof t === 'string' ? api.id(t) : t; if (!el) throw new Error('no element ' + t); el.click(); await sleep(60); },
    type: async (t, v) => { const el = api.id(t); const proto = el.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(20); },
    toggle: async (t) => { const el = api.id(t); const inp = el.matches('input') ? el : el.querySelector('input'); inp.click(); await sleep(20); },
    unmount: async () => { rootEl.unmount(); container.remove(); await sleep(10); },
    names: () => api.all('school-').map((e) => e.querySelector('div')?.textContent ?? e.textContent),
    cards: () => api.all('school-').length,
  };
  return api;
}
async function signIn(ui, email, password) {
  await waitFor(() => ui.id('auth-submit'));
  await ui.type('email', email); await ui.type('password', password); await ui.click('auth-submit');
  return waitFor(() => ui.id('search'));
}
const cardText = (ui, id) => ui.id('school-' + id)?.textContent ?? '';
// what a query asked the database for, as text (the log entries themselves point back at the whole stand-in world)
const asked = (q) => `${JSON.stringify(q?.ops ?? [])} ${q?.cols ?? ''} ${JSON.stringify(q?.sorts ?? [])}`;

// =============================================================================================================
console.log('\n=== setup and sign in ===');
let ui = await mount(seed(), unkeyed);
check('with no key pasted yet, the app explains what to do instead of failing', await waitFor(() => ui.id('setup')) && /publishable key/.test(ui.text()) && /Never use a secret key/.test(ui.text()));
await ui.unmount();

let st = seed(); ui = await mount(st);
check('a signed-out visitor sees the sign-in screen, not the schools', await waitFor(() => ui.id('auth-submit')) && !ui.id('search'));
await ui.click('auth-submit');
check('submitting an empty form asks for a valid email', /valid email/.test(ui.id('auth-error')?.textContent ?? ''));
await ui.type('email', 'ann@x.in'); await ui.type('password', 'wrong'); await ui.click('auth-submit');
check('a wrong password gives a plain-language message', await waitFor(() => /do not match/.test(ui.id('auth-error')?.textContent ?? '')));
await ui.type('password', 'password1'); await ui.click('auth-submit');
check('the right password opens the school list', await waitFor(() => ui.id('search') && ui.cards() > 0));
// The phone in this test has taken 32 points at the top for its clock and 48 at the bottom for its navigation
// buttons. Without both of these the app draws underneath them, and the last button on a screen - "Send the
// application", "Write a review" - sits behind the back / home / recents row where it cannot be pressed.
const framePadding = () => ui.id('frame')?.getAttribute('style') ?? '';
check('the app keeps clear of the phone\'s clock and navigation buttons', /padding-top:\s*32px/.test(framePadding()) && /padding-bottom:\s*48px/.test(framePadding()), framePadding());

// Settings holds the language, notifications, fingerprint unlock and deleting the account. It used to be the third
// button in a single row that also carried the logo, the app's name, Applications and Enquiries, so on a real phone
// it was pushed off the right-hand edge and none of it could be reached.
check('the profile button is there to be pressed on the school list', !!ui.id('settings'));
await ui.click('settings');
check('...and it opens settings', await waitFor(() => !!ui.id('settings-screen')));
check('...where the language, notifications and account are', /Language|Notifications/.test(ui.text()));
await ui.click('top-back');
check('the back button in the top bar returns to the list', await waitFor(() => !!ui.id('search')));
await ui.click('settings'); await ui.click('settings-signout');
check('signing out goes back to the sign-in screen', await waitFor(() => ui.id('auth-submit') && !ui.id('search')));
await ui.click('auth-switch'); await ui.type('first-name', 'Dee'); await ui.type('last-name', 'Rao'); await ui.type('email', 'dee@x.in'); await ui.type('password', 'longenough1'); await ui.click('auth-submit');
const su = st.authCalls.find((c) => c[0] === 'signup');
check('sign up sends the names the database trigger reads (first_name, last_name)', su && su[1].options.data.first_name === 'Dee' && su[1].options.data.last_name === 'Rao' && su[1].email === 'dee@x.in', JSON.stringify(su));
check('...then says to check the email and switches to sign in', await waitFor(() => /confirm your account/.test(ui.id('auth-info')?.textContent ?? '')) && !ui.id('first-name'));
await ui.click('auth-switch');
 await ui.type('first-name', 'x');
await ui.type('email', 'ann@x.in'); await ui.type('password', 'short'); await ui.click('auth-submit');
check('sign up refuses a short password before calling the server', /8 characters/.test(ui.id('auth-error')?.textContent ?? '') && st.authCalls.filter((c) => c[0] === 'signup').length === 1);
await ui.unmount();

// =============================================================================================================
check('...and the list itself offers no back button, because there is nowhere further back', !ui.id('top-back'));

console.log('\n=== finding schools ===');
st = seed(); ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1');
check('the first page shows 20 schools', await waitFor(() => ui.cards() === 20), ui.cards());
check('a place the database marks as not a school (Chess Class) never appears', !ui.text().includes('Chess Class'));
check('"Show more schools" is offered, and adds the rest (36 in total)', !!ui.id('more') && (await ui.click('more'), await waitFor(() => ui.cards() === 36)) && !ui.id('more'), ui.cards());
{
  const shownIds = ui.all('school-').map((e) => e.getAttribute('data-testid').slice(7));
  const expected = st.schools.filter((x) => !x.is_hidden).sort((a, b) => (a.name_sort < b.name_sort ? -1 : a.name_sort > b.name_sort ? 1 : a.id < b.id ? -1 : 1)).map((x) => x.id);
  check('the whole list is A to Z by the clean name: numbers first, "(S.E.S)" under S, emoji ignored', JSON.stringify(shownIds) === JSON.stringify(expected), shownIds.slice(0, 6).join(','));
  check('across the two pages every school appears exactly once (no repeats, none skipped)', new Set(shownIds).size === 36 && shownIds.length === 36);
  check('the two schools with the same name keep a fixed order (t1 before t2)', shownIds.indexOf('t1') < shownIds.indexOf('t2') && shownIds.indexOf('t1') === shownIds.indexOf('t2') - 1);
}
await ui.type('search', 'bandra');
check('typing in the search box narrows the list by name or area (after a short pause)', await waitFor(() => ui.cards() === 2, 3000), ui.cards());
check('...and matches on address, so "Bandra" finds both schools there', /Sunrise/.test(ui.text()) && /St\. Andrew/.test(ui.text()));
await ui.type('search', 'a,b)*');
await sleep(600);
check('odd characters in the search box do not break anything', !ui.id('discover-error') && ui.id('search'));
await ui.type('search', 'zzzz'); await waitFor(() => ui.id('empty'), 3000);
check('a search with no match says so', !!ui.id('empty') && ui.cards() === 0);
await ui.type('search', ''); await waitFor(() => ui.cards() === 20, 3000);
check('clearing the search brings the list back', ui.cards() === 20);

console.log('\n=== tidy names ===');
await ui.type('search', 'kasarvadavali'); await waitFor(() => ui.id('school-n2') && ui.cards() === 1, 3000);
check('a name with search-engine text is shown without it', ui.cards() === 1 && /270 Degree Kids Preschool Kasarvadavali, Thane/.test(cardText(ui, 'n2')) && !/Best Preschool In/.test(cardText(ui, 'n2')), cardText(ui, 'n2'));
await ui.type('search', 'best preschool'); await waitFor(() => ui.id('school-n2') && ui.cards() === 1, 3000);
check('...but search still finds it by the hidden text', ui.cards() === 1 && /270 Degree/.test(ui.text()));
await ui.type('search', 'smiling'); await waitFor(() => ui.id('school-n1') && ui.cards() === 1, 3000);
check('a name with emoji is shown without them', !/[\u{1F300}-\u{1FAFF}]/u.test(cardText(ui, 'n1')) && /Smiling Kids Pre-school and Eon International School/.test(cardText(ui, 'n1')), cardText(ui, 'n1'));
await ui.click('school-n1'); await waitFor(() => ui.id('back'));
check('the school page title is tidied too', /Smiling Kids Pre-school and Eon International School/.test(ui.id('page-title')?.textContent ?? '') && !/[\u{1F300}-\u{1FAFF}]/u.test(ui.id('page-title')?.textContent ?? ''), ui.id('page-title')?.textContent);
await ui.click('back'); await waitFor(() => ui.id('search')); await ui.type('search', ''); await waitFor(() => ui.cards() === 20, 3000);

console.log('\n=== filters ===');
await ui.click('toggle-filters');
check('the filter panel opens', !!ui.id('level-preschool') && !!ui.id('include-unrated'));
check('it tells parents why unrated schools are kept by default', /Most primary and secondary schools have none/.test(ui.text()));
await ui.click('level-preschool'); await waitFor(() => ui.cards() === 4, 3000);
check('Preschool: only the 4 preschools (Sunrise, Tiny Tots, Smiling Kids, 270 Degree)', ui.cards() === 4 && /Sunrise/.test(ui.text()) && /Tiny Tots/.test(ui.text()) && /Smiling Kids/.test(ui.text()) && !/Podar/.test(ui.text()), ui.cards());
await ui.toggle('daycare'); await waitFor(() => ui.cards() === 2, 3000);
check('Preschool + Daycare available: Sunrise and 270 Degree', ui.cards() === 2 && /Sunrise/.test(ui.text()) && /270 Degree/.test(ui.text()), ui.cards());
await ui.click('level-preschool'); await waitFor(() => ui.cards() === 3, 3000);
check('tapping the selected level again clears it (daycare only: Sunrise, Kids Daycare Only, 270 Degree)', ui.cards() === 3 && /Kids Daycare Only/.test(ui.text()), ui.cards());
await ui.toggle('daycare'); await ui.click('level-secondary'); await waitFor(() => ui.cards() === 2, 3000);
check('Secondary: St. Andrew and the S.E.S high school, and St. Andrew says no Google rating yet', /St\. Andrew/.test(ui.text()) && /SITALDAS/.test(ui.text()) && /No Google rating yet/.test(cardText(ui, 's2')), ui.cards());
await ui.click('level-none'); await waitFor(() => /BMC/.test(ui.text()) && ui.cards() === 1, 3000);
check('Level not stated: the BMC school', ui.cards() === 1 && /BMC School Sion/.test(ui.text()) && /Level not stated/.test(cardText(ui, 's4')));
await ui.click('level-none'); await ui.click('rating-4'); await waitFor(() => ui.cards() === 20, 3000);
check('4+ rating while "include unrated" is on keeps unrated schools (still 20 on page one)', ui.cards() === 20);
await ui.toggle('include-unrated'); await waitFor(() => ui.cards() === 6, 3000);
check('4+ with unrated switched off: only the 6 rated 4 or above (Sunrise, Podar, Tiny Tots, Kids Daycare, Smiling Kids, 270 Degree)', ui.cards() === 6 && /Podar/.test(ui.text()) && !/Filler/.test(ui.text()) && !/St\. Andrew/.test(ui.text()), ui.cards());
await ui.click('rating-4.5'); await waitFor(() => ui.cards() === 5, 3000);
check('4.5+ narrows further (Podar at 4.1 drops out)', ui.cards() === 5 && !/Podar/.test(ui.text()), ui.cards());
await ui.click('sort-rating'); await waitFor(() => ui.all('school-')[0]?.textContent.includes('Smiling Kids'), 3000);
check('Best rated puts the highest first (Smiling Kids, 5.0)', /Smiling Kids/.test(ui.all('school-')[0].textContent));
check('the filter button shows how many filters are on', /Filters|Hide filters/.test(ui.id('toggle-filters').textContent) && !!ui.id('clear-filters'));
await ui.click('clear-filters'); await waitFor(() => ui.cards() === 20, 3000);
check('Clear filters resets everything', ui.cards() === 20 && !ui.id('clear-filters'));
await ui.unmount();

console.log('\n=== when the connection fails ===');
st = seed(); ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
st.failNext = { message: 'Network request failed' };
await ui.type('search', 'sun'); await waitFor(() => ui.id('discover-error'), 3000);
check('a failed search shows a plain message and a Try again button', /internet connection/.test(ui.id('discover-error')?.textContent ?? '') && !!ui.id('retry'));
await ui.click('retry');
check('Try again works once the connection is back', await waitFor(() => !ui.id('discover-error') && ui.cards() === 1, 3000));
await ui.unmount();

// =============================================================================================================
console.log('\n=== a school page ===');
st = seed(); ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
await ui.type('search', 'sunrise'); await waitFor(() => ui.cards() === 1, 3000);
check('the list card shows Google\'s rating and the parents\' rating', /Google 4\.8/.test(cardText(ui, 's1')) && /Parents 4\.5 ★ \(2 reviews\)/.test(cardText(ui, 's1')), cardText(ui, 's1'));
check('...and the level badges, including Daycare available', /Preschool/.test(cardText(ui, 's1')) && /Daycare available/.test(cardText(ui, 's1')));
await ui.click('school-s1');
check('tapping a school opens its page', await waitFor(() => ui.id('back')) && /Sunrise Preschool/.test(ui.text()) && /Bandra West/.test(ui.text()));
check('it shows the parents\' summary and the two published reviews', await waitFor(() => ui.id('review-rv1') && ui.id('review-rv2')) && /4\.5/.test(ui.id('community-summary').textContent));
check('a review still waiting for a moderator is not shown to the public', !ui.id('review-rv3') && !/Hidden pending one/.test(ui.text()));
check('reviews are anonymous: no author names or ids anywhere on the page', !/u2|u9|Ann|Bob/.test(ui.id('review-rv1').textContent));
check('the website button opens a safe https link (a bare "sunrisepre.in" gets https:// added)', (await ui.click('website'), /^https:\/\/sunrisepre\.in\/?$/.test(opened.at(-1) ?? '')), opened.join());
await ui.click('back');
check('Back returns to the list with the search still in place', await waitFor(() => ui.id('search') && ui.id('search').value === 'sunrise' && ui.cards() === 1));
await ui.type('search', 'andrew'); await waitFor(() => ui.cards() === 1 && /Andrew/.test(ui.text()), 3000);
await ui.click('school-s2'); await waitFor(() => ui.id('back'));
check('a school without a Google rating explains why, and points to parent reviews', /No Google rating yet/.test(ui.text()) && /Google does not show ratings for many schools/.test(ui.text()) && /Be the first/.test(ui.text()));
await ui.unmount();

// =============================================================================================================
console.log('\n=== writing a review ===');
st = seed(); ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
await ui.type('search', 'sunrise'); await waitFor(() => ui.cards() === 1, 3000); await ui.click('school-s1'); await waitFor(() => ui.id('write-review'));
await ui.click('write-review');
check('the review form opens', !!ui.id('review-body') && !!ui.id('star-5'));
await ui.click('review-save');
check('saving with no stars asks for a rating', /stars/.test(ui.id('review-error')?.textContent ?? ''));
await ui.click('star-4'); await ui.type('review-body', 'Too short');
await ui.click('review-save');
check('a short review says how many characters it has', /at least 20 characters \(9 so far\)/.test(ui.id('review-error')?.textContent ?? ''), ui.id('review-error')?.textContent);
check('nothing was sent to the database yet', !st.log.some((q) => q.table === 'school_reviews' && q.op === 'insert'));
await ui.click('rel-applicant'); await ui.type('review-title', 'Lovely visit');
await ui.type('review-body', 'We visited twice and the staff answered every question patiently.');
await ui.click('review-save');
check('a good review is accepted, with a promise it will be checked and stay anonymous', await waitFor(() => /A moderator will check your review/.test(ui.id('review-message')?.textContent ?? '')) && /without your name/.test(ui.id('review-message').textContent));
const sent = st.reviews.find((r) => r.school_id === 's1' && r.title === 'Lovely visit');
check('it was stored as pending, with the right rating, relationship and text', sent && sent.status === 'pending' && sent.rating === 4 && sent.relationship === 'applicant' && /patiently/.test(sent.body), JSON.stringify(sent));
check('the parent now sees their own review with a "waiting for a moderator" status', await waitFor(() => ui.id('my-review')) && /Waiting for a moderator/.test(ui.id('my-review-status').textContent));
check('the Write a review button is gone (one review per school)', !ui.id('write-review'));
check('it is NOT in the public list and the parents\' rating is unchanged', !ui.id('review-new1') && /4\.5/.test(ui.id('community-summary').textContent));
await ui.click('edit-review');
check('editing opens the form filled in', ui.id('review-body').value.includes('patiently') && ui.id('review-title').value === 'Lovely visit');
await ui.type('review-body', 'We visited twice and the staff answered every question patiently. Edited.'); await ui.click('review-save');
check('an edit is saved and goes back to be checked again', await waitFor(() => /checked again/.test(ui.id('review-message')?.textContent ?? '')) && st.reviews.find((r) => r.id === 'new1').status === 'pending' && /Edited/.test(st.reviews.find((r) => r.id === 'new1').body));
st.reviews.find((r) => r.id === 'new1').status = 'rejected'; st.private.find((p) => p.review_id === 'new1').moderation_note = 'Please remove the teacher\'s name';
await ui.click('back'); await waitFor(() => ui.id('search')); await ui.click('school-s1'); await waitFor(() => ui.id('my-review-status'));
check('a rejected review shows the moderator\'s reason and says editing re-submits it', /Not published: Please remove the teacher's name/.test(ui.id('my-review-status').textContent) && /checked again/.test(ui.id('my-review-status').textContent), ui.id('my-review-status').textContent);
await ui.click('delete-review');
check('deleting asks for a second tap', !!ui.id('confirm-delete') && st.reviews.some((r) => r.id === 'new1'));
await ui.click('confirm-delete');
check('the second tap deletes it, and the parent can write again', await waitFor(() => ui.id('write-review')) && !st.reviews.some((r) => r.id === 'new1') && !st.private.some((p) => p.review_id === 'new1'));
await ui.unmount();

console.log('\n=== an unverified account ===');
st = seed(); ui = await mount(st); await signIn(ui, 'cat@x.in', 'password3'); await waitFor(() => ui.cards() === 20);
await ui.type('search', 'sunrise'); await waitFor(() => ui.cards() === 1, 3000); await ui.click('school-s1'); await waitFor(() => ui.id('write-review')); await ui.click('write-review');
await ui.click('star-5'); await ui.type('review-body', 'A perfectly good review that is long enough.'); await ui.click('review-save');
check('writing a review before confirming the email gives a helpful message', await waitFor(() => /confirm your email address/.test(ui.id('review-error')?.textContent ?? '')), ui.id('review-error')?.textContent);
check('the form stays open so nothing typed is lost', !!ui.id('review-body') && ui.id('review-body').value.length > 20);
await ui.unmount();

console.log('\n=== reporting a review ===');
st = seed(); ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
await ui.type('search', 'sunrise'); await waitFor(() => ui.cards() === 1, 3000); await ui.click('school-s1'); await waitFor(() => ui.id('review-rv1'));
await ui.click('report-rv1');
check('Report offers the reasons', !!ui.id('reason-spam') && !!ui.id('reason-personal_info'));
await ui.click('reason-abusive');
check('choosing one files the report and thanks the parent', await waitFor(() => /Thank you/.test(ui.id('report-msg-rv1')?.textContent ?? '')) && st.reports.length === 1 && st.reports[0].reason === 'abusive' && st.reports[0].review_id === 'rv1', JSON.stringify(st.reports));
check('the Report button goes away for that review', !ui.id('report-rv1'));
await ui.unmount();

st = seed(); ui = await mount(st); await signIn(ui, 'bob@x.in', 'password2'); await waitFor(() => ui.cards() === 20);
await ui.type('search', 'sunrise'); await waitFor(() => ui.cards() === 1, 3000); await ui.click('school-s1'); await waitFor(() => ui.id('review-rv1'));
check('a parent is never offered a Report button on their own review (Bob wrote rv1)', !ui.id('report-rv1') && !!ui.id('report-rv2'));
await ui.click('report-rv2'); await ui.click('reason-spam'); await waitFor(() => ui.id('report-msg-rv2'));
await ui.unmount();

// =============================================================================================================
// the phone's location, as each test wants it
const fakePhone = (o = {}) => {
  const calls = [];
  globalThis.__loc = {
    calls,
    requestForegroundPermissionsAsync: async () => { calls.push('permission'); return o.perm ?? { status: 'granted', canAskAgain: true }; },
    getCurrentPositionAsync: async () => { calls.push('position'); if (o.hang) return new Promise(() => {}); if (o.posThrows) throw new Error('Location services are disabled'); return 'pos' in o ? o.pos : { coords: { latitude: 19.07604, longitude: 72.87771, accuracy: 15 } }; },
  };
  return calls;
};
const DELHI = { coords: { latitude: 28.6139, longitude: 77.209 } };
// what the list should be, worked out here on its own: schools with coordinates that are not hidden, by distance from (lat, lng), then id
const expectedNear = (stt, lat, lng) => stt.schools.filter((x) => !x.is_hidden && x.latitude != null).map((x) => ({ id: x.id, km: Math.round(hav(lat, lng, x.latitude, x.longitude) * 100) / 100 })).sort((a, b) => a.km - b.km || (a.id < b.id ? -1 : 1));
const shown = (u) => u.all('school-').map((e) => e.getAttribute('data-testid').slice(7));
const distanceOf = (u, id) => u.id('distance-' + id)?.textContent ?? '';
const firstCard = (u) => u.all('school-')[0]?.getAttribute('data-testid') ?? '';
// a chosen chip is the blue one (the app's selected style); read it from the style the page really has
const selected = (u, t) => !!u.id(t) && w.getComputedStyle(u.id(t)).backgroundColor === 'rgb(91, 75, 219)'; // the app's violet (C.blue)
const settle = () => sleep(80); // a button re-enabled a moment ago needs the page to finish updating before it takes a tap

console.log('\n=== addresses and tags (cosmetic fixes) ===');
st = seed(); ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
await ui.type('search', 'sion'); await waitFor(() => ui.cards() === 1, 3000);
check('a Google Plus Code in front of an address is not shown ("3W9C+9VX, Sion, Mumbai" -> "Sion, Mumbai")', /Sion, Mumbai/.test(cardText(ui, 's4')) && !/3W9C/.test(cardText(ui, 's4')), cardText(ui, 's4'));
await ui.type('search', '3W9C'); await waitFor(() => ui.cards() === 1, 3000);
check('...but searching for that text still finds the school (display only)', ui.cards() === 1 && /BMC School Sion/.test(cardText(ui, 's4')));
await ui.click('school-s4'); await waitFor(() => ui.id('back'));
check('the school page hides the Plus Code too', /Sion, Mumbai/.test(ui.text()) && !/3W9C/.test(ui.text()));
await ui.click('back'); await waitFor(() => ui.id('search')); await ui.type('search', 'sunrise'); await waitFor(() => ui.cards() === 1 && ui.id('school-s1'), 3000);
{
  const row = [...ui.id('school-s1').querySelectorAll('div')].find((d) => [...d.children].map((c) => c.textContent).join('|') === 'Preschool|Daycare available');
  const align = row ? w.getComputedStyle(row).alignItems : 'no row';
  check('the row of level tags does not stretch the tags to equal height (align-items: flex-start)', align === 'flex-start', align);
}
await ui.unmount();

console.log('\n=== schools near me ===');
st = seed(); ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
check('before asking: a "Use my location" button, a line saying it is not saved, and no distances anywhere', !!ui.id('use-location') && /not saved/.test(ui.id('near-me-off').textContent) && ui.all('distance-').length === 0 && !ui.id('near-me-on'));
await ui.click('toggle-filters');
check('"Nearest first" is not offered until the app knows where the parent is', !ui.id('sort-distance') && !!ui.id('sort-name'));
await ui.click('toggle-filters');
let calls = fakePhone(); globalThis.__stored = [];
const logBefore = st.log.length;
await ui.click('use-location');
check('tapping it shows "Finding you..." while the phone works, and cannot be tapped twice', /Finding you/.test(ui.id('use-location')?.textContent ?? 'gone') || !!ui.id('near-me-on'));
check('it switches to the near-me panel and lists the nearest schools first', await waitFor(() => ui.id('near-me-on') && firstCard(ui) === 'school-f24', 4000), firstCard(ui));
check('the phone was asked for permission first, then for the position', JSON.stringify(calls) === JSON.stringify(['permission', 'position']), JSON.stringify(calls));
{
  const rpcs = st.log.slice(logBefore).filter((q) => q.table === 'rpc:schools_nearby');
  check('the position sent to the database is rounded to about 100 m (19.07604 -> 19.076, 72.87771 -> 72.878)', rpcs.length > 0 && rpcs.every((q) => q.args.p_lat === 19.076 && q.args.p_lng === 72.878), JSON.stringify(rpcs.map((q) => q.args)));
  check('...and nothing else about the parent is sent: only the two numbers', rpcs.every((q) => JSON.stringify(Object.keys(q.args).sort()) === '["p_lat","p_lng"]'));
  check('...and the app asks for the distance column along with the school columns', rpcs.every((q) => /distance_km/.test(q.cols) && /google_rating/.test(q.cols)), rpcs[0]?.cols);
  check('nothing is written anywhere: no inserts, updates or deletes, and nothing saved on the phone', st.log.slice(logBefore).every((q) => q.op === 'select') && globalThis.__stored.length === 0);
}
{
  // The app saves three things and no more: the language, whether to unlock with a fingerprint, and the sign-in
  // itself (encrypted with a key kept in the phone's own keystore). Never a position, never a search.
  const saved = globalThis.__stored.map(([key]) => key);
  const allowed = saved.every((key) => key === 'kidscover.language' || key === 'kidscover.unlockWithBiometrics' || /supabase|sb-/i.test(key));
  const values = globalThis.__stored.map(([, value]) => String(value)).join(' | ');
  check('the only things saved on the phone are the language, the unlock choice and the sign-in', allowed, saved.join(', '));
  check('...and never where the parent is', !/19\\.0|72\\.8|latitude|longitude/.test(values), values.slice(0, 120));
  check('the app never reaches for the browser own storage', !/localStorage|sessionStorage/.test(appSource.replace(/\/\/.*$/gm, '')));
}
{
  const want = expectedNear(st, 19.076, 72.878);
  check('the first page is the 20 nearest, in distance order (independent maths)', JSON.stringify(shown(ui)) === JSON.stringify(want.slice(0, 20).map((x) => x.id)), shown(ui).slice(0, 5).join(','));
  check('every card shows its distance: nearest is "2.6 km away"', ui.all('distance-').length === 20 && distanceOf(ui, 'f24') === '2.6 km away', distanceOf(ui, 'f24'));
  check('the address still shows under the name', /Chembur, Mumbai/.test(cardText(ui, 'f24')));
  check('the near-me panel offers Any distance / 2 / 5 / 10 km, with Any selected, and a straight-line note', ['near-any', 'near-2', 'near-5', 'near-10'].every((t) => !!ui.id(t)) && selected(ui, 'near-any') && /straight line/.test(ui.id('near-me-on').textContent));
  check('the filter button shows no count (nearest first is the normal order once you share your location)', ui.id('toggle-filters').textContent === 'Filters', ui.id('toggle-filters').textContent);
  await ui.click('more'); await waitFor(() => ui.cards() === 35, 3000);
  const all = shown(ui);
  check('35 schools in all: every school with coordinates once, in order', all.length === 35 && new Set(all).size === 35 && JSON.stringify(all) === JSON.stringify(want.map((x) => x.id)), `${all.length} / ${new Set(all).size}`);
  check('a school with no coordinates (f25) and a hidden one (Chess Class) are not in the near list', !all.includes('f25') && !all.includes('s7'));
  check('the two same-named branches at the same spot keep a fixed order, both "19 km away"', all.indexOf('t1') === all.indexOf('t2') - 1 && distanceOf(ui, 't1') === '19 km away' && distanceOf(ui, 't2') === '19 km away');
  check('far schools show whole kilometres (Ulhasnagar 34 km) and the list ends with the farthest', all.at(-1) === 'n3' && distanceOf(ui, 'n3') === '34 km away' && distanceOf(ui, 's3') === '3.8 km away' && distanceOf(ui, 's5') === '4.3 km away');
}
await ui.click('toggle-filters');
check('the filter panel offers "Nearest first", selected', selected(ui, 'sort-distance') && !selected(ui, 'sort-name'));
await ui.click('near-5'); await waitFor(() => ui.cards() === 20 && !!ui.id('more'), 3000);
check('Within 5 km: a first page of 20 with more to come, all within 5 km', ui.cards() === 20 && !!ui.id('more') && ui.all('distance-').every((e) => parseFloat(e.textContent) <= 5.05), ui.all('distance-').map((e) => e.textContent).slice(-3).join('|'));
await ui.click('more'); await waitFor(() => ui.cards() === 27, 3000);
check('...27 schools in all (24 fillers, Podar, Tiny Tots, BMC), none farther than 5 km', ui.cards() === 27 && !ui.id('more') && !/Twin Branch|Sunrise/.test(ui.text()), ui.cards());
check('the button counts the distance limit as one filter', /Hide filters/.test(ui.id('toggle-filters').textContent) && !!ui.id('clear-filters'));
await ui.click('near-2'); await waitFor(() => ui.id('empty'), 3000);
check('Within 2 km: nobody is that close, and the message says so', ui.cards() === 0 && /within 2 km/.test(ui.id('empty').textContent) && /bigger distance/.test(ui.id('empty').textContent), ui.id('empty')?.textContent);
await ui.click('near-10'); await ui.click('level-preschool'); await waitFor(() => ui.cards() === 2, 3000);
check('Within 10 km and Preschool: Tiny Tots (4.3 km) then Sunrise (5.4 km)', JSON.stringify(shown(ui)) === JSON.stringify(['s5', 's1']) && distanceOf(ui, 's5') === '4.3 km away' && distanceOf(ui, 's1') === '5.4 km away', JSON.stringify(shown(ui)));
await ui.click('level-preschool'); await ui.click('near-any');
await ui.click('sort-name'); await waitFor(() => ui.cards() === 20 && !!ui.id('more'), 3000);
{
  const az = st.schools.filter((x) => !x.is_hidden && x.latitude != null).sort((a, b) => (a.name_sort < b.name_sort ? -1 : a.name_sort > b.name_sort ? 1 : a.id < b.id ? -1 : 1)).map((x) => x.id);
  check('A to Z with a location: the same order as the plain A to Z list, and every card still shows a distance', JSON.stringify(shown(ui)) === JSON.stringify(az.slice(0, 20)) && ui.all('distance-').length === 20, shown(ui).slice(0, 4).join(','));
  check('the filter button now counts the sort choice', /Hide filters/.test(ui.id('toggle-filters').textContent) && !!ui.id('clear-filters'));
}
await ui.click('sort-rating'); await waitFor(() => firstCard(ui) === 'school-n1', 3000);
check('Best rated with a location: Smiling Kids (5.0), then 270 Degree (4.9, more reviews), then Tiny Tots (4.9)', JSON.stringify(shown(ui).slice(0, 3)) === JSON.stringify(['n1', 'n2', 's5']), shown(ui).slice(0, 3).join(','));
await ui.click('clear-filters'); await waitFor(() => firstCard(ui) === 'school-f24', 3000);
check('Clear filters puts the order back to nearest first (and keeps the location)', firstCard(ui) === 'school-f24' && !!ui.id('near-me-on') && selected(ui, 'sort-distance') && !ui.id('clear-filters'));
await ui.click('toggle-filters');
await ui.type('search', 'bandra'); await waitFor(() => ui.cards() === 2, 3000);
check('searching while sharing a location: Bandra schools, nearest first, with distances (Sunrise 5.4 km, St. Andrew 5.7 km)', JSON.stringify(shown(ui)) === JSON.stringify(['s1', 's2']) && distanceOf(ui, 's1') === '5.4 km away' && distanceOf(ui, 's2') === '5.7 km away', JSON.stringify(shown(ui)));
await ui.click('school-s1'); await waitFor(() => ui.id('back'));
check('the school page shows the distance', ui.id('school-distance')?.textContent === '5.4 km away', ui.id('school-distance')?.textContent);
await ui.click('back'); await waitFor(() => ui.id('search'));
check('...and going back keeps the location, the search and the distances', !!ui.id('near-me-on') && ui.cards() === 2 && distanceOf(ui, 's1') === '5.4 km away');
await ui.type('search', ''); await waitFor(() => ui.cards() === 20, 3000);
await ui.click('near-5'); await waitFor(() => ui.cards() === 20 && !!ui.id('more'), 3000);
await ui.click('stop-location');
check('Stop goes back to A to Z without distances, and offers the button again', await waitFor(() => ui.id('use-location') && !ui.id('near-me-on') && ui.all('distance-').length === 0, 3000) && !ui.id('sort-distance'));
{
  const az = st.schools.filter((x) => !x.is_hidden).sort((a, b) => (a.name_sort < b.name_sort ? -1 : a.name_sort > b.name_sort ? 1 : a.id < b.id ? -1 : 1)).map((x) => x.id);
  await waitFor(() => JSON.stringify(shown(ui)) === JSON.stringify(az.slice(0, 20)), 3000);
  check('...the plain A to Z list is back (including schools that have no coordinates)', JSON.stringify(shown(ui)) === JSON.stringify(az.slice(0, 20)) && ui.id('toggle-filters').textContent === 'Filters', shown(ui).slice(0, 4).join(','));
}
await ui.click('toggle-filters');
check('after Stop, "A to Z" is the chosen order and the distance choices are gone', selected(ui, 'sort-name') && !ui.id('sort-distance') && !ui.id('near-5'));
await ui.click('toggle-filters');
await ui.click('use-location'); await waitFor(() => ui.id('near-me-on') && firstCard(ui) === 'school-f24', 3000);
check('starting again: back to nearest first, and the old distance limit did not come back', selected(ui, 'near-any') && !selected(ui, 'near-5'));
await ui.click('near-5'); await waitFor(() => ui.cards() === 20, 3000);
await ui.click('settings'); await ui.click('settings-signout'); await waitFor(() => ui.id('auth-submit'));
await signIn(ui, 'bob@x.in', 'password2'); await waitFor(() => ui.cards() === 20);
check('signing out forgets the location: the next person starts with the button and a plain list', !!ui.id('use-location') && !ui.id('near-me-on') && ui.all('distance-').length === 0);
await ui.unmount();

console.log('\n=== schools near me: when it does not work ===');
st = seed(); ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
calls = fakePhone({ perm: { status: 'denied', canAskAgain: true } });
await ui.click('use-location');
check('permission refused: an amber note explains, and the parent can still search by name or area', await waitFor(() => /did not get permission/.test(ui.id('location-note')?.textContent ?? '')) && /search by school name or area/.test(ui.id('location-note').textContent));
check('...the button is still there to try again, the list is unchanged, and the database was never asked for distances', !!ui.id('use-location') && !ui.id('near-me-on') && ui.cards() === 20 && ui.all('distance-').length === 0 && !st.log.some((q) => q.table.startsWith('rpc:') && !q.table.includes('school_tiles')) && JSON.stringify(calls) === JSON.stringify(['permission']), JSON.stringify(calls));
await settle(); fakePhone({ perm: { status: 'denied', canAskAgain: false } });
await ui.click('use-location');
check('permission blocked for good: says to switch it on in the phone settings', await waitFor(() => /phone settings/.test(ui.id('location-note')?.textContent ?? '')) && !ui.id('near-me-on'));
await settle(); fakePhone({ posThrows: true });
await ui.click('use-location');
check('the phone has location switched off: a plain message, no crash', await waitFor(() => /could not find your location/.test(ui.id('location-note')?.textContent ?? '')) && !ui.id('near-me-on'));
await settle(); fakePhone({ pos: { coords: { latitude: null, longitude: 72.8 } } });
await ui.click('use-location');
check('a broken position (null latitude) is refused, not treated as 0,0', await waitFor(() => /could not find your location/.test(ui.id('location-note')?.textContent ?? '')) && !ui.id('near-me-on') && !st.log.some((q) => q.table.startsWith('rpc:') && !q.table.includes('school_tiles')));
await settle(); fakePhone();
await ui.click('use-location');
check('then it works, and the old warning is gone', await waitFor(() => ui.id('near-me-on') && firstCard(ui) === 'school-f24', 3000) && !ui.id('location-note'));
await ui.unmount();

st = seed(); ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
fakePhone({ pos: DELHI });
await ui.click('use-location');
check('a parent outside Mumbai still gets distances, with a note that we only list Mumbai and Thane', await waitFor(() => ui.id('near-me-on') && !!ui.id('location-note') && /outside Mumbai/.test(ui.id('location-note').textContent), 3000));
{
  const want = expectedNear(st, 28.614, 77.209);
  await waitFor(() => firstCard(ui) === 'school-' + want[0].id, 3000);
  check('the nearest school to Delhi is listed first with its real distance in whole km', firstCard(ui) === 'school-' + want[0].id && distanceOf(ui, want[0].id) === `${Math.round(want[0].km)} km away`, `${firstCard(ui)} ${distanceOf(ui, want[0].id)} vs ${want[0].id} ${want[0].km}`);
}
await ui.unmount();

// the phone never answers (a shortened wait of 60 ms stands in for 15 seconds)
st = seed(); ui = await mount(st, quick); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
calls = fakePhone({ hang: true });
await ui.click('use-location');
check('while waiting the button says so and is off', /Finding you/.test(ui.id('use-location')?.textContent ?? ''));
await ui.click('use-location');
check('tapping it again does not ask the phone twice', calls.filter((c) => c === 'permission').length === 1, JSON.stringify(calls));
check('a phone that never answers ends with a "took too long" note, and the button is back', await waitFor(() => /took too long/.test(ui.id('location-note')?.textContent ?? ''), 3000) && /Use my location/.test(ui.id('use-location')?.textContent ?? '') && !ui.id('near-me-on'));
await ui.unmount();

// the database function has not been installed yet (the paste-order mistake)
st = seed(); st.nearbyMissing = true; ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
fakePhone();
await ui.click('use-location');
check('function missing in the database: a plain "not switched on yet" note, not a database error', await waitFor(() => /not switched on yet/.test(ui.id('location-note')?.textContent ?? ''), 3000) && !/PGRST|schema cache|schools_nearby/.test(ui.text()));
{
  const az = st.schools.filter((x) => !x.is_hidden).sort((a, b) => (a.name_sort < b.name_sort ? -1 : a.name_sort > b.name_sort ? 1 : a.id < b.id ? -1 : 1)).map((x) => x.id);
  await waitFor(() => !ui.id('near-me-on') && JSON.stringify(shown(ui)) === JSON.stringify(az.slice(0, 20)), 3000);
  check('...the parent is dropped back to the normal A to Z list, with no error box and the button available', !ui.id('near-me-on') && !ui.id('discover-error') && !!ui.id('use-location') && JSON.stringify(shown(ui)) === JSON.stringify(az.slice(0, 20)) && ui.all('distance-').length === 0, shown(ui).slice(0, 3).join(','));
}
st.nearbyMissing = false; await settle();
await ui.click('use-location');
check('once the function is installed, the same button works', await waitFor(() => ui.id('near-me-on') && firstCard(ui) === 'school-f24', 3000) && !ui.id('location-note'));
await ui.unmount();

// a network failure while the location is on
st = seed(); ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
fakePhone(); await ui.click('use-location'); await waitFor(() => ui.id('near-me-on') && firstCard(ui) === 'school-f24', 3000);
st.failNext = { message: 'Network request failed' };
await ui.click('near-5'); await waitFor(() => ui.id('discover-error'), 3000);
check('a connection failure while sharing a location shows the usual message and Try again, and keeps the location', /internet connection/.test(ui.id('discover-error')?.textContent ?? '') && !!ui.id('retry') && !!ui.id('near-me-on'));
await ui.click('retry');
check('Try again works, with the distance limit applied', await waitFor(() => !ui.id('discover-error') && ui.cards() === 20 && !!ui.id('more'), 3000) && ui.all('distance-').every((e) => parseFloat(e.textContent) <= 5.05));
await ui.unmount();

// =============================================================================================================
console.log('\n=== asking a school about admissions ===');
const openSchool = async (u, term, id) => { await u.type('search', term); await waitFor(() => u.cards() >= 1 && !!u.id('school-' + id), 3000); await u.click('school-' + id); await waitFor(() => u.id('back')); };
st = seed(); ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
check('the top bar offers Enquiries, with no unread count to start with', ui.id('enquiries').textContent === 'Enquiries', ui.id('enquiries')?.textContent);
await ui.click('enquiries');
check('with none asked yet, the screen says how to start one', await waitFor(() => !!ui.id('enquiries-empty')) && /Ask about admissions/.test(ui.id('enquiries-empty').textContent), ui.id('enquiries-empty')?.textContent);
await ui.click('enquiries-back');
await waitFor(() => ui.id('search'));
await openSchool(ui, 'sunrise', 's1');
check('a school page offers to ask about admissions and explains what happens', !!ui.id('ask-school') && /Kidscover passes your question on/.test(ui.text()));
await ui.click('ask-school');
check('the form asks for a class, a year and the question', await waitFor(() => !!ui.id('enquiry-message')) && !!ui.id('grade-Nursery') && !!ui.id(`year-${new Date().getFullYear()}`));
check('...and says not to include a child\'s name or date of birth', /do not include your child's name or date of birth/.test(ui.id('enquiry-form').textContent), ui.id('enquiry-form')?.textContent.slice(0, 200));
await ui.click('enquiry-send');
check('sending an empty question asks for more, and nothing is sent', /at least 10 characters/.test(ui.id('enquiry-error')?.textContent ?? '') && st.rpcCalls.filter((c) => c.fn === 'send_enquiry').length === 0, ui.id('enquiry-error')?.textContent);
await ui.type('enquiry-message', 'Too short');
await ui.click('enquiry-send');
check('a very short question says how much is missing', /at least 10 characters, 9 so far/.test(ui.id('enquiry-error')?.textContent ?? ''), ui.id('enquiry-error')?.textContent);
await ui.click('grade-Class 1 to 5');
await ui.click(`year-${new Date().getFullYear() + 1}`);
await ui.type('enquiry-message', 'Do you have places for next year, and how do we arrange a visit?');
await ui.click('enquiry-send');
check('a good question is sent', await waitFor(() => st.rpcCalls.some((c) => c.fn === 'send_enquiry'), 3000), JSON.stringify(st.rpcCalls));
{
  const call = st.rpcCalls.find((c) => c.fn === 'send_enquiry');
  check('...to the right school, with the class and year chosen and a subject the school will understand', call.args.p_school === 's1' && call.args.p_grade === 'Class 1 to 5' && call.args.p_start_year === new Date().getFullYear() + 1 && call.args.p_subject === 'Admission enquiry - Class 1 to 5', JSON.stringify(call.args));
  check('...and nothing about a child is sent', !/dob|birth|ward|child_name/i.test(JSON.stringify(call.args)));
}
check('the parent is told where the reply will appear', await waitFor(() => /find the reply under Enquiries/.test(ui.id('enquiry-sent')?.textContent ?? '')), ui.id('enquiry-sent')?.textContent);
check('the school page now shows the enquiry instead of the form, and says it is waiting', await waitFor(() => !!ui.id('enquiry-existing')) && /Waiting for a reply/.test(ui.id('enquiry-existing').textContent) && !ui.id('ask-school'), ui.id('enquiry-existing')?.textContent);
await ui.click('open-enquiry');
check('"Open the conversation" goes to the enquiries screen', await waitFor(() => !!ui.id('enquiries-screen') && !!ui.all('thread-').length));
{
  const tid = st.threads[0].id;
  check('the enquiry is listed with the school, what it is about and the question', /Sunrise Preschool/.test(ui.id(`thread-${tid}`).textContent) && /Class 1 to 5, starting/.test(ui.id(`thread-${tid}`).textContent) && /arrange a visit/.test(ui.id(`thread-${tid}`).textContent), ui.id(`thread-${tid}`)?.textContent);
  check('...and it is not marked unread, because the parent wrote it', !/●/.test(ui.id(`thread-${tid}`).textContent));
  await ui.click(`thread-${tid}`);
  check('opening it shows the question, marked as yours', await waitFor(() => !!ui.id(`conversation-${tid}`)) && /You/.test(ui.text()) && /arrange a visit/.test(ui.text()));
  await ui.click('conversation-back');
  await waitFor(() => !!ui.id('enquiries-back'));
}
await ui.click('enquiries-back');
await waitFor(() => ui.id('search'));
await openSchool(ui, 'sunrise', 's1');
check('going back to the school still shows the existing enquiry, not the form', await waitFor(() => !!ui.id('enquiry-existing')) && !ui.id('ask-school'));
await ui.unmount();

console.log('\n=== the school replies ===');
st = seed(); ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
await openSchool(ui, 'sunrise', 's1');
await ui.click('ask-school'); await waitFor(() => !!ui.id('enquiry-message'));
await ui.type('enquiry-message', 'Are there places in the pre-primary class this year?');
await ui.click('enquiry-send');
await waitFor(() => !!ui.id('enquiry-existing'), 3000);
const TID = st.threads[0].id;
staffReply(st, TID, 'Yes, we have a few places. Please visit any weekday between 10am and noon.');
await ui.click('back'); await waitFor(() => ui.id('search'));
await ui.click('enquiries'); await waitFor(() => !!ui.id('enquiries-screen'));
check('a reply from the school shows the enquiry as answered, with a dot', await waitFor(() => /They have replied/.test(ui.id(`thread-${TID}`)?.textContent ?? '')) && /●/.test(ui.id(`thread-${TID}`).textContent), ui.id(`thread-${TID}`)?.textContent);
await ui.click('enquiries-back'); await waitFor(() => ui.id('search'));
check('...and the top bar shows there is 1 unread', await waitFor(() => ui.id('enquiries').textContent === 'Enquiries (1)', 3000), ui.id('enquiries')?.textContent);
await ui.click('enquiries'); await waitFor(() => !!ui.id('enquiries-screen'));
await ui.click(`thread-${TID}`);
check('the conversation shows both sides, the school\'s answer labelled as the school', await waitFor(() => !!ui.id(`conversation-${TID}`) && ui.all('msg-').length === 2) && /The school/.test(ui.text()) && /weekday between 10am/.test(ui.text()));
check('...and never a staff member\'s name or id', !/kidscover-staff/.test(ui.text()));
check('opening it marks it read', await waitFor(() => st.rpcCalls.some((c) => c.fn === 'mark_ticket_read' && c.args.p_ticket === TID)));
await ui.click('reply-send');
check('an empty reply is refused', /write your message first/.test(ui.id('conversation-error')?.textContent ?? ''), ui.id('conversation-error')?.textContent);
await ui.type('reply-box', '  Thank you, we will come on Tuesday.  ');
await ui.click('reply-send');
check('a reply is sent, trimmed, and appears in the conversation', await waitFor(() => ui.all('msg-').length === 3, 3000) && st.tmsgs.some((m) => m.message === 'Thank you, we will come on Tuesday.'), st.tmsgs.map((m) => m.message).join(' | '));
check('...and the box is cleared so it cannot be sent twice by accident', ui.id('reply-box').value === '');
await ui.click('conversation-back');
await waitFor(() => !!ui.id('enquiries-back'));
check('back in the list it is waiting for a reply again, with no unread dot', await waitFor(() => /Waiting for a reply/.test(ui.id(`thread-${TID}`)?.textContent ?? '')) && !/●/.test(ui.id(`thread-${TID}`).textContent), ui.id(`thread-${TID}`)?.textContent);
await ui.click('enquiries-back'); await waitFor(() => ui.id('search'));
check('...and the unread count on the top bar is gone', await waitFor(() => ui.id('enquiries').textContent === 'Enquiries', 3000), ui.id('enquiries')?.textContent);
await ui.click('enquiries'); await waitFor(() => !!ui.id('enquiries-screen'));
await ui.click(`thread-${TID}`); await waitFor(() => !!ui.id('close-enquiry'));
await ui.click('close-enquiry');
check('a parent can close their own enquiry', await waitFor(() => st.threads[0].status === 'closed', 3000) && st.rpcCalls.some((c) => c.fn === 'set_ticket_status' && c.args.p_status === 'closed'));
await ui.click('conversation-back'); await waitFor(() => !!ui.id('enquiries-back'));
check('...and it then reads as closed', await waitFor(() => /Closed/.test(ui.id(`thread-${TID}`)?.textContent ?? '')), ui.id(`thread-${TID}`)?.textContent);
await ui.click('enquiries-back'); await waitFor(() => ui.id('search'));
await openSchool(ui, 'sunrise', 's1');
check('with the old one closed, the school page still shows it and offers to ask again', await waitFor(() => !!ui.id('ask-school'), 3000) && /Ask again/.test(ui.id('ask-school').textContent) && !!ui.id('enquiry-existing') && /Closed/.test(ui.id('enquiry-existing').textContent), ui.text().slice(0, 200));
await ui.click('ask-school');
await ui.type('enquiry-message', 'One more thing came up: is there a school bus to Bandra?');
await ui.click('enquiry-send');
check('...and a second enquiry with that school is accepted', await waitFor(() => st.threads.length === 2, 3000), st.threads.length);
check('...and once it is open again, the "ask again" button goes away', await waitFor(() => !ui.id('ask-school'), 3000) && /Waiting for a reply/.test(ui.id('enquiry-existing')?.textContent ?? ''), ui.id('enquiry-existing')?.textContent);
await ui.unmount();

console.log('\n=== asking twice, and other refusals ===');
st = seed(); ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
await openSchool(ui, 'sunrise', 's1');
await ui.click('ask-school'); await waitFor(() => !!ui.id('enquiry-message'));
await ui.type('enquiry-message', 'A perfectly ordinary first question about admissions.');
await ui.click('enquiry-send');
await waitFor(() => !!ui.id('enquiry-existing'), 3000);
st.threads[0].school_id = 'other';   // pretend the first one was about a different school, so the page offers the form again
await ui.click('back'); await waitFor(() => ui.id('search'));
await openSchool(ui, 'sunrise', 's1');
st.threads[0].school_id = 's1';      // ...but the database still knows it is the same school
await ui.click('ask-school'); await waitFor(() => !!ui.id('enquiry-message'));
await ui.type('enquiry-message', 'The very same question, asked a second time.');
await ui.click('enquiry-send');
check('asking the same school twice is refused kindly, pointing at the conversation', await waitFor(() => /already have an open enquiry/.test(ui.id('enquiry-error')?.textContent ?? ''), 3000), ui.id('enquiry-error')?.textContent);
check('...and what was typed is not lost', ui.id('enquiry-message').value.includes('second time'));
await ui.unmount();

st = seed(); ui = await mount(st); await signIn(ui, 'cat@x.in', 'password3'); await waitFor(() => ui.cards() === 20);
await openSchool(ui, 'sunrise', 's1');
await ui.click('ask-school'); await waitFor(() => !!ui.id('enquiry-message'));
await ui.type('enquiry-message', 'Can we visit the school next week some time?');
await ui.click('enquiry-send');
check('an account that has not confirmed its email is told to do that first', await waitFor(() => /confirm your email address/.test(ui.id('enquiry-error')?.textContent ?? ''), 3000), ui.id('enquiry-error')?.textContent);
check('...and nothing was stored', st.threads.length === 0);
await ui.unmount();

st = seed(); ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
await openSchool(ui, 'sunrise', 's1');
await ui.click('ask-school'); await waitFor(() => !!ui.id('enquiry-message'));
st.failNext = { message: 'Network request failed' };
await ui.type('enquiry-message', 'A question that the connection will swallow.');
await ui.click('enquiry-send');
check('a connection failure while asking says so in plain words', await waitFor(() => /internet connection/.test(ui.id('enquiry-error')?.textContent ?? ''), 3000), ui.id('enquiry-error')?.textContent);
await sleep(120);   // the button was disabled while sending; the page needs a moment before it takes another tap
await ui.click('enquiry-send');
check('...and trying again works', await waitFor(() => !!ui.id('enquiry-sent'), 3000) && st.threads.length === 1);
await ui.unmount();

console.log('\n=== signing out forgets the enquiries ===');
st = seed(); ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
await openSchool(ui, 'sunrise', 's1');
await ui.click('ask-school'); await waitFor(() => !!ui.id('enquiry-message'));
await ui.type('enquiry-message', 'One last question before signing out of the app.');
await ui.click('enquiry-send');
await waitFor(() => st.threads.length === 1, 3000);
staffReply(st, st.threads[0].id, 'A reply nobody else should ever see.');
await ui.click('back'); await waitFor(() => ui.id('search'));
await waitFor(() => ui.id('enquiries').textContent === 'Enquiries (1)', 3000);
await ui.click('settings'); await ui.click('settings-signout'); await waitFor(() => ui.id('auth-submit'));
await signIn(ui, 'bob@x.in', 'password2'); await waitFor(() => ui.cards() === 20);
check('the next person sees no unread count and none of the other family\'s enquiries', ui.id('enquiries').textContent === 'Enquiries', ui.id('enquiries')?.textContent);
await ui.click('enquiries');
check('...and an empty enquiries screen', await waitFor(() => !!ui.id('enquiries-empty')) && !/should ever see/.test(ui.text()));
await ui.unmount();

// =============================================================================================================
console.log('\n=== drive times by car ===');
// the drive time the stand-in function gives: 3 minutes a straight-line km, plus 4 (a fixed rule, so tests can check it)
const fakeMinutes = (st2, id, lat, lng) => { const x = st2.schools.find((s2) => s2.id === id); return Math.round(hav(lat, lng, x.latitude, x.longitude) * 3) + 4; };
const driveOf = (u, id) => u.id('drivetime-' + id)?.textContent ?? '';
const fnCalls = (st2) => st2.fnCalls.filter((c) => c.name === 'commute-times');
const locationOn = async (u) => { fakePhone(); await u.click('use-location'); return waitFor(() => u.id('near-me-on') && firstCard(u) === 'school-f24', 4000); };

st = seed(); ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
check('without a location there is nothing about driving', !ui.id('drive-mode-school_run') && !ui.id('drive-mode-now'));
await locationOn(ui);
check('with a location, the panel offers "Weekday 7:30 am" and "Right now", neither chosen', !!ui.id('drive-mode-school_run') && !!ui.id('drive-mode-now') && !selected(ui, 'drive-mode-school_run') && !selected(ui, 'drive-mode-now'));
check('...and says Google works it out and Kidscover does not store the location', /Google Maps/.test(ui.id('near-me-on').textContent) && /does not store/.test(ui.id('near-me-on').textContent));
await sleep(200);
check('nothing is sent to Google until the parent asks (it costs a lookup)', fnCalls(st).length === 0 && ui.all('drivetime-').length === 0);
await ui.click('drive-mode-school_run');
check('asking: one call for the 20 schools on screen', await waitFor(() => fnCalls(st).length === 1, 3000) && fnCalls(st)[0].body.schoolIds.length === 20, JSON.stringify(fnCalls(st).map((c) => c.body.schoolIds.length)));
{
  const c = fnCalls(st)[0].body;
  check('...with the rounded position, the school run, and exactly the schools shown', c.lat === 19.076 && c.lng === 72.878 && c.when === 'school_run' && JSON.stringify(c.schoolIds) === JSON.stringify(shown(ui)), JSON.stringify(c).slice(0, 200));
  check('...and nothing else', JSON.stringify(Object.keys(c).sort()) === JSON.stringify(['lat', 'lng', 'schoolIds', 'when']));
}
check('each card shows its drive time under the distance', await waitFor(() => driveOf(ui, 'f24') === `About ${fakeMinutes(st, 'f24', 19.076, 72.878)} min by car`, 3000), driveOf(ui, 'f24'));
check('the chosen time of day is highlighted', selected(ui, 'drive-mode-school_run'));
await ui.click('more'); await waitFor(() => ui.cards() === 35, 3000);
check('"Show more" costs one more lookup, for the 15 new schools only', await waitFor(() => fnCalls(st).length === 2, 3000) && fnCalls(st)[1].body.schoolIds.length === 15 && !fnCalls(st)[1].body.schoolIds.some((id) => fnCalls(st)[0].body.schoolIds.includes(id)), JSON.stringify(fnCalls(st).map((c) => c.body.schoolIds.length)));
check('a school Google finds no road to shows no drive time rather than a guess', await waitFor(() => !!driveOf(ui, 'n3'), 3000) && driveOf(ui, 's6') === '' && !!ui.id('school-s6'), driveOf(ui, 'n3'));
check('far schools show hours and minutes', await waitFor(() => /^About 1 h \d+ min by car$|^About \d+ min by car$/.test(driveOf(ui, 'n3')), 3000), driveOf(ui, 'n3'));
await ui.click('near-5'); await waitFor(() => ui.cards() === 20, 3000);
await sleep(200);
check('narrowing to 5 km reuses the times already fetched: no new lookup', fnCalls(st).length === 2 && !!driveOf(ui, 'f24'), fnCalls(st).length);
await ui.click('near-any'); await waitFor(() => ui.cards() === 20, 3000);
await sleep(200);
check('...and so does going back to "Any distance"', fnCalls(st).length === 2);
await ui.click('school-f24'); await waitFor(() => ui.id('back'));
check('the school page repeats it with the time of day', ui.id('page-drive')?.textContent === `About ${fakeMinutes(st, 'f24', 19.076, 72.878)} min by car, leaving at 7:30 am on a weekday`, ui.id('page-drive')?.textContent);
await ui.click('back'); await waitFor(() => ui.id('search'));
await ui.click('drive-mode-now');
check('switching to "Right now" asks again for the schools on screen, as "now"', await waitFor(() => fnCalls(st).length === 3, 3000) && fnCalls(st)[2].body.when === 'now' && selected(ui, 'drive-mode-now') && !selected(ui, 'drive-mode-school_run'));
await ui.click('drive-mode-now');
check('tapping the chosen one again hides the drive times and asks nothing more', await waitFor(() => ui.all('drivetime-').length === 0, 2000) && (await sleep(200), fnCalls(st).length === 3));
await ui.click('drive-mode-school_run');
await sleep(250);
check('...and choosing the school run again shows the times it already had, without a new lookup', fnCalls(st).length === 3 && !!driveOf(ui, 'f24'), fnCalls(st).length);
await ui.click('stop-location');
check('turning the location off removes drive times and the choice', await waitFor(() => !ui.id('drive-mode-school_run') && ui.all('drivetime-').length === 0, 2000));
await locationOn(ui);
check('turning it back on does not start asking Google by itself', (await sleep(250), fnCalls(st).length === 3) && !selected(ui, 'drive-mode-school_run'));
await ui.unmount();

console.log('\n=== drive times: when it cannot help ===');
st = seed(); st.fnMode = 'user_limit'; ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
await locationOn(ui);
await ui.click('drive-mode-school_run');
check('over the daily allowance: says so with the number, and stops asking', await waitFor(() => /used today's 20 drive-time lookups/.test(ui.id('drive-note')?.textContent ?? ''), 3000) && !selected(ui, 'drive-mode-school_run') && (await sleep(250), fnCalls(st).length === 1), ui.id('drive-note')?.textContent);
check('...the distances are still there', /km away/.test(distanceOf(ui, 'f24')));
await ui.unmount();

st = seed(); st.fnMode = 'not_deployed'; ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
await locationOn(ui);
await ui.click('drive-mode-now');
check('function not deployed yet: "not switched on yet", no technical words', await waitFor(() => /not switched on yet/.test(ui.id('drive-note')?.textContent ?? ''), 3000) && !/404|Edge Function|commute/i.test(ui.text()), ui.id('drive-note')?.textContent);
st.fnMode = 'ok'; await settle();
await ui.click('drive-mode-now');
check('...and once it is deployed, the same chip works and the note goes away', await waitFor(() => !!driveOf(ui, 'f24'), 3000) && !ui.id('drive-note'));
await ui.unmount();

st = seed(); st.fnMode = 'network'; ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
await locationOn(ui);
await ui.click('drive-mode-school_run');
check('no connection: a "try again" message, not a crash', await waitFor(() => /try again/.test(ui.id('drive-note')?.textContent ?? ''), 3000) && ui.cards() === 20);
await ui.unmount();

st = seed(); st.lookupsLeft = 3; ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
await locationOn(ui);
await ui.click('drive-mode-school_run');
check('when a parent is nearly out of lookups, they are told how many are left', await waitFor(() => /2 drive-time lookups left today/.test(ui.id('drive-note')?.textContent ?? ''), 3000) && !!driveOf(ui, 'f24'), ui.id('drive-note')?.textContent);
await ui.click('more'); await waitFor(() => ui.cards() === 35, 3000);
check('...counting down, and "1 lookup" in the singular', await waitFor(() => /1 drive-time lookup left today/.test(ui.id('drive-note')?.textContent ?? ''), 3000), ui.id('drive-note')?.textContent);
await ui.unmount();

// =============================================================================================================
console.log('\n=== boards and admissions ===');
const withFacts = () => {
  const s2 = seed();
  const put = (id, o) => Object.assign(s2.schools.find((x) => x.id === id), o);
  put('s2', { board: 'ICSE', boards: ['ICSE'], board_source: 'school website', board_source_url: 'https://standrews.example/about' });
  put('s3', { board: 'CBSE', boards: ['CBSE'], board_source: 'CBSE directory', board_source_url: 'https://podar.example/disclosure' });
  put('n3', { board: 'State Board', boards: ['State Board'], board_source: 'school name' });
  put('s1', { admissions_open: true, admissions_year: '2027-28', admissions_source_url: 'https://sunrisepre.in/admissions', admissions_checked_at: '2026-09-19T05:00:00Z' });
  put('f05', { admissions_open: false, admissions_year: '2026-27', admissions_source_url: 'https://filler5.example/', admissions_checked_at: '2026-09-19T05:00:00Z' });
  put('s5', { admissions_open: false });   // the old default, never checked by anyone
  return s2;
};
st = withFacts(); ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
await ui.click('toggle-filters');
check('the filters offer the five boards, and no "unknown" switch until one is chosen', ['CBSE', 'ICSE', 'IB', 'IGCSE', 'State Board'].every((b) => !!ui.id('board-' + b)) && !ui.id('include-unknown-board'));
await ui.click('board-CBSE');
check('CBSE: only the school known to be CBSE', await waitFor(() => ui.cards() === 1 && !!ui.id('school-s3'), 3000), ui.cards());
check('...and the filter button counts it', /Hide filters/.test(ui.id('toggle-filters').textContent) && !!ui.id('clear-filters'));
check('...the switch to include unknown boards appears, off, and says why', !!ui.id('include-unknown-board') && /still checking boards/.test(ui.text()));
await ui.toggle('include-unknown-board');
check('with it on: CBSE plus every school whose board is not known (not the ICSE or State Board ones)', await waitFor(() => ui.cards() === 20 && !!ui.id('more'), 3000) && !ui.id('school-s2') && !ui.id('school-n3'), ui.cards());
await ui.click('more'); await waitFor(() => ui.cards() > 20, 3000);
check('...34 in all', await waitFor(() => ui.cards() === 34, 3000), ui.cards());
await ui.toggle('include-unknown-board');
await ui.click('board-State Board');
check('State Board (two words) works', await waitFor(() => ui.cards() === 1 && !!ui.id('school-n3'), 3000), ui.cards());
await ui.click('board-State Board');
check('tapping it again clears the board filter', await waitFor(() => ui.cards() === 20 && !ui.id('include-unknown-board'), 3000));
await ui.click('toggle-filters');

await ui.type('search', 'podar'); await waitFor(() => ui.cards() === 1 && !!ui.id('school-s3'), 3000);
await ui.click('school-s3'); await waitFor(() => ui.id('back'));
check('a school page says where the board comes from: CBSE, confirmed by CBSE\'s own record', /Board: CBSE, confirmed by CBSE's own record\./.test(ui.id('page-board-source')?.textContent ?? ''), ui.id('page-board-source')?.textContent);
await ui.click('board-source-link');
check('..."See where" opens the page it came from', opened.at(-1) === 'https://podar.example/disclosure', opened.at(-1));
await ui.click('back'); await waitFor(() => ui.id('search'));
await ui.type('search', 'sunrise'); await waitFor(() => ui.cards() === 1 && !!ui.id('school-s1'), 3000);
check('a card shows "Admissions open 2027-28" when a school\'s website said so and an admin accepted it', /Admissions open 2027-28/.test(ui.id('open-s1')?.textContent ?? ''));
await ui.click('school-s1'); await waitFor(() => ui.id('back'));
check('the school page gives the year, the source and when it was checked', ui.id('page-admission')?.textContent.startsWith("Admissions open for 2027-28 (from the school's website, checked Sept 2026)"), ui.id('page-admission')?.textContent);
await ui.click('admission-source-link');
check('..."See the page" opens the school\'s own admissions page', opened.at(-1) === 'https://sunrisepre.in/admissions');
await ui.click('back'); await waitFor(() => ui.id('search'));
await ui.type('search', 'filler school 05'); await waitFor(() => ui.cards() === 1 && !!ui.id('school-f05'), 3000);
check('a school whose admissions are closed has no "open" badge on its card', !ui.id('open-f05') && !/Admissions open/.test(cardText(ui, 'f05')), cardText(ui, 'f05'));
await ui.click('school-f05'); await waitFor(() => ui.id('back'));
check('"Admissions closed for 2026-27" is shown as closed on its page', /^Admissions closed for 2026-27/.test(ui.id('page-admission')?.textContent ?? ''));
await ui.click('back'); await waitFor(() => ui.id('search'));
await ui.type('search', 'tiny tots'); await waitFor(() => ui.cards() === 1 && !!ui.id('school-s5'), 3000);
check('a "closed" nobody checked (the old default) is never shown, on the card', !ui.id('open-s5') && !/Admissions/.test(cardText(ui, 's5')));
await ui.click('school-s5'); await waitFor(() => ui.id('back'));
check('...or on the school page', !ui.id('page-admission') && !/Admissions (open|closed)/.test(ui.text()));
check('a board taken from the school\'s name says so', await (async () => { await ui.click('back'); await waitFor(() => ui.id('search')); await ui.type('search', 'sitaldas'); await waitFor(() => ui.cards() === 1 && !!ui.id('school-n3'), 3000); await ui.click('school-n3'); await waitFor(() => ui.id('back')); return /Board: State Board, from the school's name\./.test(ui.id('page-board-source')?.textContent ?? '') && !ui.id('board-source-link'); })(), ui.id('page-board-source')?.textContent);
await ui.unmount();

st = withFacts(); ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
fakePhone(); await ui.click('use-location'); await waitFor(() => ui.id('near-me-on') && firstCard(ui) === 'school-f24', 4000);
await ui.click('toggle-filters'); await ui.click('board-ICSE');
check('the board filter works in "near me" too, with the distance shown', await waitFor(() => ui.cards() === 1 && !!ui.id('school-s2'), 3000) && /km away/.test(distanceOf(ui, 's2')), ui.cards());
await ui.unmount();

// =============================================================================================================
console.log('\n=== schools, after-school classes, colleges ===');
const withCategories = () => {
  const s2 = seed();
  const C = (id, name, category, levels, lat, extra = {}) => S(id, name, 'Bandra West, Mumbai', levels, 4.6, 25, { category, latitude: lat, longitude: 72.83, ...extra });
  s2.schools.push(
    C('c1', 'Rhythm Dance Academy', 'after_school', [], 19.058),
    C('c2', 'Aqua Kids Swimming', 'after_school', ['primary'], 19.059),
    C('c3', 'Sharma Tuition Classes', 'after_school', [], 19.061, { google_rating: 3.2 }),
    C('k1', 'Sardar Patel College of Engineering', 'college', [], 19.123),
    C('k2', "St. Xavier's College", 'college', [], 18.943),
  );
  return s2;
};
const idsShown = () => ui.all('school-').map((e) => e.getAttribute('data-testid').slice(7));
st = withCategories(); ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
check('three choices at the top, Schools chosen', ['school', 'after_school', 'college'].every((k) => !!ui.id('category-' + k)) && /Schools/.test(ui.id('category-school').textContent));
await ui.type('search', 'academy');
check('Schools holds none of the classes or colleges (searching "academy" finds nothing)', await waitFor(() => !!ui.id('empty'), 3000) && /No schools match/.test(ui.id('empty').textContent), ui.cards());
await ui.type('search', '');
await waitFor(() => ui.cards() === 20, 3000);
await ui.click('category-after_school');
check('After-school classes: exactly the three classes, A to Z', await waitFor(() => ui.cards() === 3, 3000) && idsShown().join() === 'c2,c1,c3', idsShown().join());
const look = (k) => ui.id('category-' + k)?.className ?? '';
check('...and it is shown as chosen (its own look), the other two alike', look('after_school') !== look('school') && look('school') === look('college'), [look('after_school'), look('school')].join(' | '));
check('...the search box says what it searches', /after-school classes/.test(ui.id('search').getAttribute('placeholder') ?? ''), ui.id('search').getAttribute('placeholder'));
check('...a class shows no school level badges ("Primary", "Level not stated")', !/Primary|Level not stated/.test(cardText(ui, 'c2')) && !/Level not stated/.test(cardText(ui, 'c1')), cardText(ui, 'c2'));
await ui.click('toggle-filters');
check('...its filters have no Level, Daycare or Board (they describe schools), but rating and sort stay', !ui.id('level-preschool') && !ui.id('daycare') && !ui.id('board-CBSE') && !!ui.id('rating-4') && !!ui.id('sort-name'));
await ui.click('rating-4');
check('...a rating filter works on classes', await waitFor(() => ui.cards() === 2 && !ui.id('school-c3'), 3000), idsShown().join());
await ui.click('clear-filters');
check('..."Clear filters" clears them but stays on After-school classes', await waitFor(() => ui.cards() === 3 && ui.id('category-after_school') && !ui.id('clear-filters'), 3000), idsShown().join());
await ui.click('category-college');
check('Colleges: the two colleges', await waitFor(() => ui.cards() === 2 && !!ui.id('school-k1') && !!ui.id('school-k2'), 3000), idsShown().join());
await ui.type('search', 'zzz');
check('...an empty search says "No colleges match"', await waitFor(() => /No colleges match/.test(ui.id('empty')?.textContent ?? ''), 3000));
await ui.type('search', '');
await ui.click('category-school');
await waitFor(() => ui.cards() === 20, 3000);
await ui.click('level-preschool');
check('back on Schools, a level filter', await waitFor(() => ui.cards() > 0 && ui.cards() < 20, 3000) && /\(1\)|Hide filters/.test(ui.id('toggle-filters').textContent));
const preschools = ui.cards();
await ui.click('category-after_school');
check('...is set aside on After-school classes (all three shown, nothing counted)', await waitFor(() => ui.cards() === 3, 3000) && !ui.id('clear-filters'), ui.cards());
await ui.click('category-school');
check('...and is back on returning to Schools', await waitFor(() => ui.cards() === preschools && !!ui.id('clear-filters'), 3000), ui.cards());
await ui.click('level-preschool'); await ui.click('toggle-filters');
await ui.click('category-after_school'); await waitFor(() => ui.cards() === 3, 3000);
await ui.click('school-c1'); await waitFor(() => ui.id('back'));
check('a class\'s page has no "Ask about admissions" (enquiries are for schools), but has parent reviews', !ui.id('ask-school') && !/Admissions/.test(ui.text()) && /What parents say/.test(ui.text()));
await ui.click('back'); await waitFor(() => ui.id('search'));
check('...and going back keeps After-school classes', await waitFor(() => ui.cards() === 3, 3000));
fakePhone(); await ui.click('use-location');
const kms = () => idsShown().map((id) => parseFloat(distanceOf(ui, id)));
check('"near me" on After-school classes: only the classes, nearest first, with distances', await waitFor(() => !!ui.id('near-me-on') && ui.cards() === 3 && kms().every((k) => k > 0), 4000) && idsShown().every((id) => /^c/.test(id)) && kms().every((k, i, a) => i === 0 || a[i - 1] <= k), idsShown().join() + ' ' + kms().join());
await ui.click('category-school');
check('...and on Schools, only schools again', await waitFor(() => ui.cards() === 20 && !idsShown().some((id) => /^[ck]\d/.test(id)), 4000), idsShown().join());
await ui.unmount();

// =============================================================================================================
console.log('\n=== the new look: drawings, photos, facilities, achievements ===');
st = seed(); ui = await mount(st);
check('the sign-in screen has its drawing (a parent walking a child to school) and the brand', await waitFor(() => !!ui.id('welcome-art')) && ui.id('welcome-art').tagName.toLowerCase() === 'svg' && /Kidscover/.test(ui.text()));
await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
check('the list opens with a welcome banner', /Find the right school/.test(ui.id('discover-hero')?.textContent ?? ''));
await ui.click('category-college');
check('...which changes with the list chosen', await waitFor(() => /Colleges/.test(ui.id('discover-hero')?.textContent ?? '')));
await ui.click('category-school'); await waitFor(() => ui.cards() === 20);
check('each card has a picture: the drawn school when there is no photo', !!ui.id('thumb-f01-art') && !ui.id('thumb-f01-photo') && ui.all('thumb-').length === 20, ui.all('thumb-').length);
await ui.type('search', 'bmc'); await waitFor(() => ui.cards() === 1 && !!ui.id('school-s4'), 3000);
check('...and the school\'s own photo when it has one', !!ui.id('thumb-s4-photo') && /photo-1\.jpg/.test(ui.id('thumb-s4-photo').outerHTML) && !ui.id('thumb-s4-art'));
await ui.click('school-s4'); await waitFor(() => ui.id('back'));
check('an uploaded photo is shown big on the school page, credited to the school', !!ui.id('hero-photo') && ui.id('photo-credit')?.textContent === 'Photo from the school' && !ui.id('photo-source'), ui.id('photo-credit')?.textContent);
check('...a school with nothing listed shows no Facilities or Achievements section', !ui.id('facilities') && !ui.id('achievements'));
await ui.click('back'); await waitFor(() => ui.id('search'));
await ui.type('search', '270 degree'); await waitFor(() => ui.cards() === 1 && !!ui.id('school-n2'), 3000);
await ui.click('school-n2'); await waitFor(() => ui.id('back'));
check('a Wikimedia photo is credited with its author and licence, with a link to where it came from', await waitFor(() => !!ui.id('hero-photo')) && /Photo: Jane Doe, CC BY-SA 4\.0, via Wikimedia Commons/.test(ui.id('photo-credit').textContent), ui.id('photo-credit')?.textContent);
await ui.click('photo-source');
check('..."source" opens the photo\'s Commons page', opened.at(-1) === 'https://commons.wikimedia.org/wiki/File:270.jpg', opened.at(-1));
const facs = () => ui.all('facility-').map((e) => e.getAttribute('data-testid').slice(9));
check('facilities are listed in the usual order, each with its detail; an unknown one is left out', await waitFor(() => !!ui.id('facilities')) && facs().join() === 'cafeteria,library,teacher_ratio' && /Teacher-student ratio: 1:15/.test(ui.id('facility-teacher_ratio').textContent), facs().join());
check('...and the page says where they came from', /Found on the school's website; listed by the school\./.test(ui.id('facilities').textContent), ui.id('facilities').textContent);
const groups = ui.all('achievements-').map((e) => e.getAttribute('data-testid'));
check('achievements come grouped: class 10 results first, then class 12', groups.join() === 'achievements-class10,achievements-class12', groups.join());
check('...newest first within a group, each with its year and where it came from', /2025: 100% pass in SSC, topper 97\.2% \(from the school's website\)/.test(ui.id('achievement-a2').textContent) && ui.id('achievements-class10').textContent.indexOf('2025') < ui.id('achievements-class10').textContent.indexOf('2024'), ui.id('achievements-class10').textContent);
await ui.click('achievement-link-a2');
check('..."See it" opens the page the school published it on; one with no link has none', opened.at(-1) === 'https://270degree.example/results' && !ui.id('achievement-link-a1'));
await ui.unmount();

st = seed(); st.profilesMissing = true; ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1'); await waitFor(() => ui.cards() === 20);
await ui.type('search', '270 degree'); await waitFor(() => ui.cards() === 1 && !!ui.id('school-n2'), 3000);
await ui.click('school-n2'); await waitFor(() => ui.id('back'));
check('if facilities and achievements cannot be read, the page just leaves them out (no error)', await waitFor(() => /What parents say/.test(ui.text())) && !ui.id('facilities') && !ui.id('achievements') && !ui.id('school-error'));
await ui.unmount();
// =============================================================================================================
console.log('\n=== what a year costs ===');
st = seed(); ui = await mount(st);
await signIn(ui, 'ann@x.in', 'password1');
check('a school with fees shows the first-year cost on its card', await waitFor(() => !!ui.id('fee-n2')) && /2,31,000|1,36,000/.test(ui.id('fee-n2').textContent), ui.id('fee-n2')?.textContent);
check('...starting from the cheapest level when no level is chosen', /From/.test(ui.id('fee-n2').textContent));
await ui.click('toggle-filters');
await ui.click('budget-200000');
check('a budget filter asks the database for the first-year cost, and offers to include schools with no fees', await waitFor(() => st.log.some((q) => asked(q).includes('fees_from'))) && !!ui.id('include-unknown-fees'), asked(st.log.at(-1)));
await ui.click('level-primary');
check('with a level chosen, the cost filter uses that level', await waitFor(() => st.log.some((q) => asked(q).includes('fee_primary'))));
await ui.click('sort-cost');
check('the list can be put in order of cost', await waitFor(() => st.log.some((q) => JSON.stringify(q.sorts ?? []).includes('fee_primary'))), JSON.stringify(st.log.at(-1)?.sorts ?? []));
await ui.click('clear-filters');
await waitFor(() => ui.cards() > 3);
await ui.click('school-n2');
check('the school page breaks the cost down, year by year and once', await waitFor(() => !!ui.id('fee-breakdown')) && /Tuition/.test(ui.id('fee-breakdown').textContent) && /Admission fee/.test(ui.id('fee-breakdown').textContent) && /once/.test(ui.id('fee-breakdown').textContent), ui.id('fee-breakdown')?.textContent.slice(0, 200));
check('...with the total for the first year and for each year after', /Total, first year/.test(ui.id('fee-breakdown').textContent) && /1,36,000/.test(ui.id('fee-breakdown').textContent) && /1,20,000/.test(ui.id('fee-breakdown').textContent), ui.id('fee-breakdown')?.textContent.slice(0, 220));
check('...the refundable deposit kept apart from the cost', /refundable deposit of/.test(ui.id('fee-breakdown').textContent) && /5,000/.test(ui.id('fee-breakdown').textContent) && !/1,41,000/.test(ui.id('fee-breakdown').textContent));
check('...and where the numbers came from', /listed by the school|checked by Kidscover/.test(ui.id('fee-breakdown').textContent));
check('the levels with fees can each be seen', !!ui.id('fee-level-preschool') && !!ui.id('fee-level-primary'));
check('the school page says when the school day starts', /starts at 08:15/.test(ui.id('school-start')?.textContent ?? ''), ui.id('school-start')?.textContent);
await ui.click('back');
await waitFor(() => !!ui.id('search'));
await ui.type('search', 'Sunrise');
await waitFor(() => !!ui.id('school-s1'), 3000);
await ui.click('school-s1');
await waitFor(() => !!ui.id('website'));
await ui.click('website');
check('opening the school website is counted for the school, without saying who', await waitFor(() => st.clicks.length === 1) && st.clicks[0].kind === 'website' && st.clicks[0].school === 's1', JSON.stringify(st.clicks));
await ui.unmount();
st = seed(); st.feesMissing = true; ui = await mount(st);
await signIn(ui, 'ann@x.in', 'password1');
await ui.click('school-n2');
check('before the fee migration is run, the page simply leaves fees out', await waitFor(() => !!ui.id('page-title')) && !ui.id('fee-breakdown') && !ui.id('discover-error'));
await ui.unmount();

// =============================================================================================================
console.log('\n=== the dashboard counts ===');
st = seed(); ui = await mount(st);
await signIn(ui, 'ann@x.in', 'password1');
check('the dashboard says how many schools are listed and how many have fees', await waitFor(() => !!ui.id('tiles')) && Number(ui.id('tile-schools').textContent) > 20 && Number(ui.id('tile-fees').textContent) === 2, ui.id('tiles')?.textContent);
await ui.click('tile-open');
check('tapping "admissions open" narrows the list to those schools', await waitFor(() => st.log.some((q) => asked(q).includes('admissions_open'))));
await ui.unmount();

// =============================================================================================================
console.log('\n=== comparing schools ===');
st = seed(); ui = await mount(st);
await signIn(ui, 'ann@x.in', 'password1');
await ui.type('search', 'Sunrise');
await waitFor(() => !!ui.id('compare-s1'), 3000);
await ui.click('compare-s1');
await ui.type('search', '270 Degree');
await waitFor(() => !!ui.id('compare-n2'), 3000);
await ui.click('compare-n2');
await ui.type('search', '');
await waitFor(() => ui.cards() > 3, 3000);
check('two schools can be put side by side', await waitFor(() => !!ui.id('compare-bar')) && /2 of 4/.test(ui.id('compare-bar').textContent), ui.id('compare-bar')?.textContent);
await ui.click('open-compare');
check('the comparison shows a row for cost, distance, levels, board, admissions and ratings', await waitFor(() => !!ui.id('compare-screen')) && ['fees', 'distance', 'levels', 'board', 'admissions', 'google', 'parents', 'start'].every((r) => !!ui.id('compare-row-' + r)), ui.text().slice(0, 200));
check('...with both schools in it', /Sunrise Preschool/.test(ui.id('compare-screen').textContent) && /270 Degree Kids/.test(ui.id('compare-screen').textContent));
check('...and "Not known" where a school has not said', /Not known/.test(ui.id('compare-screen').textContent));
await ui.click('compare-remove-s1');
check('one can be taken out again', await waitFor(() => !ui.id('compare-open-s1')));
await ui.click('compare-back');
await waitFor(() => !!ui.id('search'));
const notSchools = ['compare-bar', 'compare-note', 'compare-open', 'compare-back', 'compare-screen', 'compare-toggle'];
const compareButtons = ui.all('compare-').filter((e) => !notSchools.includes(e.getAttribute('data-testid')));
// only schools not already chosen, so a tap never takes one back out
for (const el of compareButtons.filter((e) => /Compare/.test(e.textContent)).slice(0, 5)) { await ui.click(el); }
check('at most four schools at a time, and the app says so', await waitFor(() => /up to 4 schools/.test(ui.id('compare-note')?.textContent ?? ''), 3000), 'chosen: ' + (ui.id('compare-bar')?.textContent ?? 'none') + ' | buttons: ' + compareButtons.length);
await ui.unmount();

// =============================================================================================================
console.log('\n=== applying to a school ===');
st = seed(); ui = await mount(st);
await signIn(ui, 'ann@x.in', 'password1');
await ui.click('school-n2');
await waitFor(() => !!ui.id('apply-start'));
await ui.click('apply-start');
check('the form asks about the child, the parent, and nothing else', await waitFor(() => !!ui.id('apply-screen')) && !!ui.id('apply-child-first') && !!ui.id('apply-dob') && !!ui.id('apply-phone') && !!ui.id('apply-pincode'));
await ui.click('apply-send');
check('an empty form is refused here, without troubling the database', await waitFor(() => /first and last name/.test(ui.id('apply-error')?.textContent ?? '')) && st.applications.length === 0);
await ui.type('apply-child-first', 'Ananya'); await ui.type('apply-child-last', 'Nair');
await ui.type('apply-dob', '2021-06-30');
await ui.click('apply-class-jr_kg');
await ui.type('apply-parent-name', 'Priya Nair');
await ui.type('apply-phone', '98200 11111');
await ui.type('apply-email', 'priya@x.in');
await ui.type('apply-address', '12 Hill Road, Bandra West');
await ui.type('apply-pincode', '400050');
await ui.click('apply-send');
check('without the family agreeing to share the details, nothing is sent', await waitFor(() => /agree to share/.test(ui.id('apply-error')?.textContent ?? '')) && st.applications.length === 0);
await ui.click('apply-consent');
await ui.click('apply-send');
check('with everything filled in, the application goes to that school, tidied up', await waitFor(() => st.applications.length === 1) && st.applications[0].school_id === 'n2' && st.applications[0].parent_phone === '9820011111' && st.applications[0].parent_email === 'priya@x.in' && st.applications[0].consent === true, JSON.stringify(st.applications[0] ?? {}).slice(0, 200));
await waitFor(() => !!ui.id('applications-screen'), 4000);
check('...and the family is taken to their applications', await waitFor(() => /Ananya/.test(ui.id('applications-screen')?.textContent ?? ''), 4000), ui.text().slice(0, 200));
check('...where it says which stage it is at', /Sent to the school/.test(ui.id('applications-screen').textContent));
await ui.click('application-open-' + st.applications[0].id);
check('opening it shows what has happened and when the details were shared', await waitFor(() => !!ui.id('application-detail-' + st.applications[0].id)) && /Shared with the school/.test(ui.text()));
await ui.click('withdraw-' + st.applications[0].id);
check('the family can withdraw it', await waitFor(() => st.applications[0].status === 'withdrawn') && /Withdrawn/.test(ui.text()));
await ui.click('delete-' + st.applications[0].id);
await ui.click('delete-confirm-' + st.applications[0].id);
check('...and delete it completely, in two taps', await waitFor(() => st.applications.length === 0) && /Deleted/.test(ui.id('applications-notice')?.textContent ?? ''));
await ui.unmount();
st = seed(); st.applicationsMissing = true; ui = await mount(st);
await signIn(ui, 'ann@x.in', 'password1');
await ui.click('applications');
check('before the migration is run it says applying is not switched on yet', await waitFor(() => /not switched on yet/.test(ui.id('applications-error')?.textContent ?? '')), ui.text().slice(0, 150));
await ui.unmount();

// =============================================================================================================
console.log('\n=== the language ===');
st = seed(); ui = await mount(st);
await waitFor(() => !!ui.id('auth-language'));
check('a language can be chosen before signing in', /English/.test(ui.id('auth-language').textContent));
await ui.click('auth-language');
check('...from all 31, each written in its own script', await waitFor(() => !!ui.id('language-screen')) && ui.all('language-').length >= 31 && /\u092e\u0930\u093e\u0920\u0940/.test(ui.text()) && /\u0d2e\u0d32\u0d2f\u0d3e\u0d33\u0d02/.test(ui.text()), String(ui.all('language-').length));
await ui.click('language-ml');
check('choosing Malayalam changes the words of the app at once', await waitFor(() => !/Find the right school for your child/.test(ui.text())) && globalThis.__stored.some(([k, v]) => k === 'kidscover.language' && v === 'ml'), ui.text().slice(0, 120));
await ui.click('auth-language');
await ui.click('language-ar');
check('Arabic too, and the page turns round to read right to left', await waitFor(() => !!ui.id('auth-submit')) && !!ui.c.querySelector('[style*="direction"], [dir]'), 'no rtl marker');
await ui.click('auth-language');
await ui.click('language-en');
await waitFor(() => /Find the right school/.test(ui.text()));
await signIn(ui, 'ann@x.in', 'password1');
check('the language a person chose is saved with their account', await waitFor(() => (st.profiles.u1 ?? {}).language === 'en', 4000), JSON.stringify(st.profiles) + ' | tables: ' + [...new Set(st.log.map((q) => q.table + ':' + q.op))].join(','));
await ui.unmount();
st = seed(); st.profiles = { u1: { language: 'mr', notify_push: true } }; ui = await mount(st);
await signIn(ui, 'ann@x.in', 'password1');
check('signing in on a new phone brings the language back', await waitFor(() => !/Find the right school for your child/.test(ui.text()), 3000), ui.text().slice(0, 100));
await ui.unmount();

// =============================================================================================================
console.log('\n=== settings, unlocking and notifications ===');
globalThis.__bio = { hasHardwareAsync: () => true, isEnrolledAsync: () => true, supportedAuthenticationTypesAsync: () => [1], authenticateAsync: async () => ({ success: true }) };
globalThis.__push = { getPermissionsAsync: async () => ({ granted: true, status: 'granted' }), requestPermissionsAsync: async () => ({ granted: true, status: 'granted' }), getExpoPushTokenAsync: async () => ({ data: 'ExponentPushToken[abc123]' }) };
st = seed(); ui = await mount(st);
await signIn(ui, 'ann@x.in', 'password1');
check('the phone is remembered for notifications once, quietly', await waitFor(() => st.pushTokens.length === 1) && st.pushTokens[0].token === 'ExponentPushToken[abc123]');
await ui.click('settings');
check('settings offers the language, notifications, unlocking and deleting the account', await waitFor(() => !!ui.id('settings-screen')) && !!ui.id('settings-language') && !!ui.id('settings-push') && !!ui.id('settings-unlock') && !!ui.id('settings-delete'));
await ui.toggle('settings-push');
check('switching notifications off saves that and forgets the phone', await waitFor(() => (st.profiles.u1 ?? {}).notify_push === false) && st.pushTokens.length === 0);
await ui.toggle('settings-unlock');
check('unlocking with a fingerprint is only switched on after the fingerprint is given once', await waitFor(() => globalThis.__stored.some(([k, v]) => k === 'kidscover.unlockWithBiometrics' && v === 'on')));
await ui.click('settings-delete');
await ui.type('settings-password', 'wrong-one');
st.deleteAccountResult = { ok: true };
st.users['ann@x.in'].password = 'password1';
await ui.click('settings-delete-confirm');
check('deleting the account asks for the password again, and a wrong one deletes nothing', await waitFor(() => /did not match/.test(ui.id('settings-error')?.textContent ?? '')) && !st.fnCalls.some((c) => c.name === 'delete-account'), ui.id('settings-error')?.textContent);
await ui.type('settings-password', 'password1');
await ui.click('settings-delete-confirm');
check('...and with the right password it is deleted and the app signs out', await waitFor(() => st.fnCalls.some((c) => c.name === 'delete-account')) && await waitFor(() => !!ui.id('auth-submit')));
await ui.unmount();
globalThis.__bio = { hasHardwareAsync: () => false, isEnrolledAsync: () => false, supportedAuthenticationTypesAsync: () => [] };
st = seed(); ui = await mount(st);
await signIn(ui, 'ann@x.in', 'password1');
await ui.click('settings');
check('a phone with no fingerprint reader is not offered unlocking', await waitFor(() => !!ui.id('settings-screen')) && !ui.id('settings-unlock'));
await ui.unmount();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
