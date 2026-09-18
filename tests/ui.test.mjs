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
fs.writeFileSync(path.join(tmp, 'stub-storage.mjs'), `export default { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };`);
fs.writeFileSync(path.join(tmp, 'stub-empty.mjs'), `export {};`);
// the app creates its client when the file loads, before a test has set up its data, so look the real stand-in up on every use
fs.writeFileSync(path.join(tmp, 'fake-supabase.mjs'), `export const createClient = () => new Proxy({}, { get: (_, prop) => globalThis.__db[prop] });`);

const appSource = fs.readFileSync(process.env.APP_FILE ?? path.join(root, 'App.js'), 'utf8');
async function bundle(name, source) {
  fs.writeFileSync(path.join(tmp, `${name}.App.js`), source);
  fs.writeFileSync(path.join(tmp, `${name}.entry.jsx`), `import * as React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './${name}.App.js';\nexport { React, createRoot, App };\n`);
  await build({
    entryPoints: [path.join(tmp, `${name}.entry.jsx`)], bundle: true, format: 'esm', platform: 'node', outfile: path.join(tmp, `${name}.bundle.mjs`),
    loader: { '.js': 'jsx' }, jsx: 'automatic', logLevel: 'error',
    alias: {
      'react-native': 'react-native-web',
      '@react-native-async-storage/async-storage': path.join(tmp, 'stub-storage.mjs'),
      'react-native-url-polyfill/auto': path.join(tmp, 'stub-empty.mjs'),
      '@supabase/supabase-js': path.join(tmp, 'fake-supabase.mjs'),
    },
    define: { 'process.env.NODE_ENV': '"development"', __DEV__: 'true' },
  });
  return pathToFileURL(path.join(tmp, `${name}.bundle.mjs`)).href;
}
const keyedUrl = await bundle('keyed', appSource.replace('PASTE_YOUR_PUBLISHABLE_KEY_HERE', 'sb_publishable_test'));
const unkeyedUrl = await bundle('unkeyed', appSource);

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

// ---- the stand-in database: follows the same rules as the real one ----
const S = (id, name, address, levels, rating, count, extra = {}) => ({ id, name, address, levels, google_rating: rating, google_review_count: count, board: null, website: null, is_hidden: false, ...extra });
function seed() {
  const schools = [
    S('s1', 'Sunrise Preschool & Daycare', 'Bandra West, Mumbai', ['daycare', 'preschool'], 4.8, 120, { website: 'sunrisepre.in' }),
    S('s2', "St. Andrew's High School", 'Bandra West, Mumbai', ['secondary'], null, null),
    S('s3', 'Podar Primary', 'Santacruz, Mumbai', ['primary'], 4.1, 40),
    S('s4', 'BMC School Sion', 'Sion, Mumbai', [], null, null),
    S('s5', 'Tiny Tots Preschool', 'Andheri, Mumbai', ['preschool'], 4.9, 60),
    S('s6', 'Kids Daycare Only', 'Powai, Mumbai', ['daycare'], 4.5, 10),
    S('s7', 'Chess Class', 'Dadar, Mumbai', ['primary'], 5, 3, { is_hidden: true }),
  ];
  for (let i = 1; i <= 28; i++) schools.push(S('f' + String(i).padStart(2, '0'), 'Filler School ' + String(i).padStart(2, '0'), 'Chembur, Mumbai', ['primary'], null, null));
  // two real-looking Google names with emoji / search-engine text
  schools.push(S('n1', '\u{1F60A}Smiling Kids Pre-school \u{1F60A} and \u{1F4DA}Eon International School \u{1F4DA}', 'Kalher, Maharashtra', ['preschool'], 5, 21));
  schools.push(S('n2', '270 Degree Kids Preschool Kasarvadavali, Thane | Best Preschool In Kasarvadavali', 'Kasarvadavali, Thane', ['preschool', 'daycare'], 4.9, 139));
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
  };
}
const cond = (r, { col, op, val }) => {
  const v = r[col];
  if (op === 'ilike') return v != null && String(v).toLowerCase().includes(val.replace(/\*/g, '').toLowerCase());
  if (op === 'gte') return v != null && v >= Number(val);
  if (op === 'is') return val === 'null' && v == null;
  return false;
};
class Query {
  constructor(state, table) { Object.assign(this, { state, table, preds: [], sorts: [], op: 'select', payload: null, rng: null, lim: null, one: false, ops: [] }); state.log.push(this); }
  select() { return this; }
  eq(c, v) { this.ops.push(['eq', c, v]); this.preds.push((r) => (c === 'levels' && v === '{}' ? Array.isArray(r.levels) && r.levels.length === 0 : r[c] === v)); return this; }
  in(c, vals) { this.preds.push((r) => vals.includes(r[c])); return this; }
  overlaps(c, vals) { this.ops.push(['overlaps', c, vals]); this.preds.push((r) => Array.isArray(r[c]) && r[c].some((x) => vals.includes(x))); return this; }
  contains(c, vals) { this.preds.push((r) => Array.isArray(r[c]) && vals.every((x) => r[c].includes(x))); return this; }
  gte(c, v) { this.preds.push((r) => r[c] != null && r[c] >= v); return this; }
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
    if (this.table === 'schools') return this.finish(all(st.schools));
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
    click: async (t) => { const el = typeof t === 'string' ? api.id(t) : t; if (!el) throw new Error('no element ' + t); el.click(); await sleep(20); },
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
await ui.click('sign-out');
check('signing out goes back to the sign-in screen', await waitFor(() => ui.id('auth-submit') && !ui.id('search')));
await ui.click('auth-switch'); await ui.type('first-name', 'Dee'); await ui.type('last-name', 'Rao'); await ui.type('email', 'dee@x.in'); await ui.type('password', 'longenough1'); await ui.click('auth-submit');
const su = st.authCalls.find((c) => c[0] === 'signup');
check('sign up sends the names the database trigger reads (first_name, last_name)', su && su[1].options.data.first_name === 'Dee' && su[1].options.data.last_name === 'Rao' && su[1].email === 'dee@x.in', JSON.stringify(su));
check('...then says to check the email and switches to sign in', await waitFor(() => /confirm your account/.test(ui.id('auth-info')?.textContent ?? '')) && /Sign in/.test(ui.text()));
await ui.click('auth-switch'); await ui.type('first-name', 'x');
await ui.type('email', 'ann@x.in'); await ui.type('password', 'short'); await ui.click('auth-submit');
check('sign up refuses a short password before calling the server', /8 characters/.test(ui.id('auth-error')?.textContent ?? '') && st.authCalls.filter((c) => c[0] === 'signup').length === 1);
await ui.unmount();

// =============================================================================================================
console.log('\n=== finding schools ===');
st = seed(); ui = await mount(st); await signIn(ui, 'ann@x.in', 'password1');
check('the first page shows 20 schools', await waitFor(() => ui.cards() === 20), ui.cards());
check('a place the database marks as not a school (Chess Class) never appears', !ui.text().includes('Chess Class'));
check('"Show more schools" is offered, and adds the rest (36 in total)', !!ui.id('more') && (await ui.click('more'), await waitFor(() => ui.cards() === 36)) && !ui.id('more'), ui.cards());
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
check('the school page title is tidied too', /Smiling Kids Pre-school and Eon International School/.test(ui.text()) && !/[\u{1F300}-\u{1FAFF}]/u.test(ui.text()));
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
await ui.toggle('daycare'); await ui.click('level-secondary'); await waitFor(() => ui.cards() === 1, 3000);
check('Secondary: St. Andrew only, and it says no Google rating yet', /St\. Andrew/.test(ui.text()) && /No Google rating yet/.test(cardText(ui, 's2')));
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
