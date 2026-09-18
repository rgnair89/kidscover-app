// =====================================================================================================
// Kidscover - parent app, first version.
//
// ONE FILE ON PURPOSE: paste all of this into snack.expo.dev as App.js.
//   1. Set SUPABASE_KEY below to your publishable key (sb_publishable_...). NEVER a secret key.
//   2. Snack offers to add the packages this file imports (@supabase/supabase-js, @react-native-async-storage/
//      async-storage, react-native-url-polyfill). Accept them.
// What it does: sign in / sign up, search schools, filter by level / daycare / Google rating, open a school,
// read parent reviews, write one (anonymous, moderated before it shows), and report a review.
// =====================================================================================================
import 'react-native-url-polyfill/auto';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, AppState, BackHandler, Linking, Platform, Pressable, ScrollView, StatusBar,
  StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://twpcjrpknsqlycdvwtsj.supabase.co';
const SUPABASE_KEY = 'PASTE_YOUR_PUBLISHABLE_KEY_HERE';
const KEY_IS_SET = !SUPABASE_KEY.startsWith('PASTE');

const supabase = createClient(SUPABASE_URL, KEY_IS_SET ? SUPABASE_KEY : 'key-not-set', {
  auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

// ==== BEGIN pure logic (no imports, no React: tested on its own) ====

const PAGE_SIZE = 20;
const SCHOOL_COLUMNS = 'id,name,address,website,board,levels,google_rating,google_review_count';

const LEVEL_CHOICES = [
  { key: 'preschool', label: 'Preschool' },
  { key: 'primary', label: 'Primary' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'none', label: 'Level not stated' },
];
const RATING_CHOICES = [
  { value: 0, label: 'Any' },
  { value: 3.5, label: '3.5+' },
  { value: 4, label: '4+' },
  { value: 4.5, label: '4.5+' },
];
const RELATIONSHIPS = [
  { key: 'current_parent', label: 'Current parent' },
  { key: 'former_parent', label: 'Former parent' },
  { key: 'applicant', label: 'Applied / visited' },
  { key: 'other', label: 'Other' },
];
const REPORT_REASONS = [
  { key: 'spam', label: 'Spam' },
  { key: 'abusive', label: 'Abusive' },
  { key: 'fake', label: 'Looks fake' },
  { key: 'personal_info', label: 'Personal details' },
  { key: 'other', label: 'Something else' },
];
const DEFAULT_FILTERS = { search: '', level: null, daycare: false, minRating: 0, includeUnrated: true, sort: 'name' };

// Text typed into the search box goes into a filter string, so remove the characters that filter syntax uses.
function sanitizeSearch(text) {
  return String(text ?? '').replace(/[,()*"\\%]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

// Applies the parent's choices to a query on the schools table.
function applySchoolFilters(query, f) {
  let q = query.eq('is_hidden', false); // the database already hides non-schools from parents; this also keeps an admin's view the same
  const term = sanitizeSearch(f.search);
  if (term) q = q.or(`name.ilike.*${term}*,address.ilike.*${term}*`);
  if (f.level === 'none') q = q.eq('levels', '{}');
  else if (f.level) q = q.overlaps('levels', [f.level]);
  if (f.daycare) q = q.contains('levels', ['daycare']);
  if (f.minRating > 0) {
    q = f.includeUnrated ? q.or(`google_rating.gte.${f.minRating},google_rating.is.null`) : q.gte('google_rating', f.minRating);
  } else if (!f.includeUnrated) {
    q = q.not('google_rating', 'is', null);
  }
  if (f.sort === 'rating') {
    q = q.order('google_rating', { ascending: false, nullsFirst: false }).order('google_review_count', { ascending: false, nullsFirst: false });
  } else {
    q = q.order('name', { ascending: true });
  }
  return q;
}

function activeFilterCount(f) {
  return (f.level ? 1 : 0) + (f.daycare ? 1 : 0) + (f.minRating > 0 ? 1 : 0) + (f.includeUnrated ? 0 : 1) + (f.sort !== 'name' ? 1 : 0);
}

function levelBadges(levels) {
  if (!levels) return [];
  const out = [];
  if (levels.includes('preschool')) out.push('Preschool');
  if (levels.includes('primary')) out.push('Primary');
  if (levels.includes('secondary')) out.push('Secondary');
  if (levels.includes('daycare')) out.push('Daycare available');
  if (levels.length === 0) out.push('Level not stated');
  return out;
}

function googleRatingText(rating, count) {
  if (rating === null || rating === undefined) return 'No Google rating yet';
  return `Google ${Number(rating).toFixed(1)} \u2605${count ? ` (${count})` : ''}`;
}

function communityText(stats) {
  if (!stats || !stats.review_count) return null;
  return `Parents ${Number(stats.avg_rating).toFixed(1)} \u2605 (${stats.review_count} ${stats.review_count === 1 ? 'review' : 'reviews'})`;
}

function stars(n) {
  const k = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  return '\u2605'.repeat(k) + '\u2606'.repeat(5 - k);
}

function monthYear(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

function safeUrl(url) {
  const u = String(url ?? '').trim();
  if (!u) return null;
  const full = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  return /^https?:\/\/[^\s]+\.[^\s]+/i.test(full) ? full : null;
}

// Google business names often carry emoji and search-engine text ("Best Preschool In ... | ..."). Show the part a
// parent would call the name. This is display only: search still matches the original text.
function cleanName(name) {
  const original = String(name ?? '').trim();
  const stripped = original.replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}]/gu, ' ');
  const first = stripped.split(/(?:^|\s)\|(?:\s|$)/).map((p) => p.trim()).filter(Boolean)[0] ?? '';
  const cleaned = first.replace(/\s{2,}/g, ' ').replace(/[\s|\-–—,:;]+$/, '').trim();
  return cleaned || original;
}

function validateAuth({ mode, first, last, email, password }) {
  if (mode === 'signup' && (!first.trim() || !last.trim())) return 'Please enter your first and last name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Please enter a valid email address.';
  if (mode === 'signup' && password.length < 8) return 'Choose a password with at least 8 characters.';
  if (!password) return 'Please enter your password.';
  return null;
}

function validateReview({ rating, title, body }) {
  if (!rating || rating < 1 || rating > 5) return 'Tap the stars to give a rating.';
  if ((title ?? '').length > 120) return 'Keep the title under 120 characters.';
  const len = (body ?? '').trim().length;
  if (len < 20) return `Please write at least 20 characters (${len} so far).`;
  if (len > 2000) return 'Please keep the review under 2000 characters.';
  return null;
}

function statusLine(status, note) {
  if (status === 'pending') return 'Waiting for a moderator to check it. Only you can see it until then.';
  if (status === 'published') return 'Published. Other parents can read it, without your name.';
  if (status === 'rejected') return `Not published${note ? `: ${note}` : '.'} Edit it and it will be checked again.`;
  if (status === 'removed') return 'A moderator removed this review.';
  return '';
}

// Turns a Supabase / network error into something a parent can act on.
function friendlyError(error, context) {
  const msg = typeof error === 'string' ? error : String(error?.message ?? '');
  const code = error?.code;
  if (/invalid login credentials/i.test(msg)) return 'That email and password do not match.';
  if (/email not confirmed/i.test(msg)) return 'Please confirm your email first: open the link we sent you, then sign in.';
  if (/already registered|already been registered/i.test(msg)) return 'That email already has an account. Try signing in instead.';
  if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Please wait a minute and try again.';
  if (/network request failed|failed to fetch|networkerror|load failed/i.test(msg)) return 'Cannot reach the server. Check your internet connection and try again.';
  if (/daily review limit/i.test(msg)) return 'You have reached today\u2019s limit of 10 reviews. Try again tomorrow.';
  if (code === '23505' || /duplicate key|unique/i.test(msg)) {
    return context === 'report' ? 'You already reported this review.' : 'You have already reviewed this school. You can edit your review below.';
  }
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return context === 'report' ? 'This review cannot be reported.' : 'Please confirm your email address first, then try again.';
  }
  return msg || 'Something went wrong. Please try again.';
}

// ---- data access. Each takes the database client, so it can be tested with a stand-in. ----
async function loadStats(db, ids) {
  if (!ids.length) return {};
  const { data } = await db.from('school_review_stats').select('school_id,review_count,avg_rating').in('school_id', ids);
  return Object.fromEntries((data ?? []).map((r) => [r.school_id, r]));
}

async function loadSchools(db, filters, page) {
  const from = page * PAGE_SIZE;
  const { data, error } = await applySchoolFilters(db.from('schools').select(SCHOOL_COLUMNS), filters).range(from, from + PAGE_SIZE - 1);
  if (error) return { rows: [], hasMore: false, error };
  const rows = data ?? [];
  const stats = await loadStats(db, rows.map((r) => r.id));
  return { rows: rows.map((r) => ({ ...r, community: stats[r.id] ?? null })), hasMore: rows.length === PAGE_SIZE, error: null };
}

async function loadReviews(db, schoolId) {
  const { data, error } = await db.from('school_reviews')
    .select('id,rating,title,body,relationship,created_at')
    .eq('school_id', schoolId).eq('status', 'published')
    .order('created_at', { ascending: false }).limit(30);
  return { rows: data ?? [], error };
}

// The signed-in parent's own review of this school (any status), or null. Row level security shows them only their own.
async function loadMyReview(db, schoolId) {
  const own = await db.from('school_review_private').select('review_id,moderation_note').eq('school_id', schoolId).maybeSingle();
  if (own.error || !own.data) return { review: null, error: own.error ?? null };
  const rev = await db.from('school_reviews').select('id,rating,title,body,relationship,status,created_at').eq('id', own.data.review_id).maybeSingle();
  if (rev.error || !rev.data) return { review: null, error: rev.error ?? null };
  return { review: { ...rev.data, moderation_note: own.data.moderation_note }, error: null };
}

const reviewFields = (f) => ({ rating: f.rating, title: f.title?.trim() ? f.title.trim() : null, body: f.body.trim(), relationship: f.relationship });
const submitReview = (db, schoolId, f) => db.from('school_reviews').insert({ school_id: schoolId, ...reviewFields(f) });
const updateReview = (db, id, f) => db.from('school_reviews').update(reviewFields(f)).eq('id', id);
const deleteReview = (db, id) => db.from('school_reviews').delete().eq('id', id);
const reportReview = (db, reviewId, reason) => db.from('review_reports').insert({ review_id: reviewId, reason });

// ==== END pure logic ====

// ---------------------------------------------------------------------------------------------- small pieces
const C = { blue: '#2563EB', blueSoft: '#DBEAFE', ink: '#111827', grey: '#6B7280', line: '#E5E7EB', bg: '#F9FAFB', card: '#FFFFFF', red: '#B91C1C', redSoft: '#FEE2E2', green: '#047857', greenSoft: '#D1FAE5', amber: '#B45309', amberSoft: '#FEF3C7' };

function Btn({ label, onPress, kind = 'solid', disabled, testID }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} disabled={disabled}
      style={[s.btn, kind === 'outline' && s.btnOutline, kind === 'quiet' && s.btnQuiet, disabled && { opacity: 0.5 }]}>
      <Text style={[s.btnText, kind !== 'solid' && { color: C.blue }]}>{label}</Text>
    </Pressable>
  );
}

function Chip({ label, selected, onPress, testID }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress} style={[s.chip, selected && s.chipOn]}>
      <Text style={[s.chipText, selected && s.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const Notice = ({ tone = 'red', text, testID }) => (
  <View testID={testID} style={[s.notice, { backgroundColor: tone === 'red' ? C.redSoft : tone === 'green' ? C.greenSoft : C.amberSoft }]}>
    <Text style={{ color: tone === 'red' ? C.red : tone === 'green' ? C.green : C.amber }}>{text}</Text>
  </View>
);

// ---------------------------------------------------------------------------------------------- sign in / sign up
function AuthScreen() {
  const [mode, setMode] = useState('signin');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function submit() {
    setError('');
    setInfo('');
    const problem = validateAuth({ mode, first, last, email, password });
    if (problem) { setError(problem); return; }
    setBusy(true);
    if (mode === 'signin') {
      const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (e) setError(friendlyError(e));
    } else {
      const { data, error: e } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { first_name: first.trim(), last_name: last.trim() } } });
      if (e) setError(friendlyError(e));
      else if (!data?.session) {
        setInfo('Almost there! We sent you an email. Open the link in it to confirm your account, then sign in here.');
        setMode('signin');
        setPassword('');
      }
    }
    setBusy(false);
  }

  return (
    <ScrollView contentContainerStyle={s.authWrap} keyboardShouldPersistTaps="handled">
      <Text style={s.logo}>Kidscover</Text>
      <Text style={s.tagline}>Find the right school for your child, with real information.</Text>
      <View style={s.card}>
        <Text style={s.h2}>{mode === 'signin' ? 'Sign in' : 'Create your account'}</Text>
        {mode === 'signup' && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput testID="first-name" style={[s.input, { flex: 1 }]} placeholder="First name" value={first} onChangeText={setFirst} />
            <TextInput testID="last-name" style={[s.input, { flex: 1 }]} placeholder="Last name" value={last} onChangeText={setLast} />
          </View>
        )}
        <TextInput testID="email" style={s.input} placeholder="Email address" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
        <TextInput testID="password" style={s.input} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
        {!!error && <Notice text={error} testID="auth-error" />}
        {!!info && <Notice tone="green" text={info} testID="auth-info" />}
        <Btn testID="auth-submit" label={busy ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account'} onPress={submit} disabled={busy} />
        <Btn testID="auth-switch" kind="quiet" label={mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
          onPress={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setInfo(''); }} />
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------------------------- discover
function SchoolCard({ school, onPress }) {
  const community = communityText(school.community);
  return (
    <Pressable testID={`school-${school.id}`} accessibilityRole="button" onPress={onPress} style={s.card}>
      <Text style={s.schoolName}>{cleanName(school.name)}</Text>
      {!!school.address && <Text style={s.muted} numberOfLines={2}>{school.address}</Text>}
      <View style={s.badgeRow}>
        {levelBadges(school.levels).map((b) => <Text key={b} style={s.badge}>{b}</Text>)}
        {!!school.board && <Text style={[s.badge, { backgroundColor: C.greenSoft, color: C.green }]}>{school.board}</Text>}
      </View>
      <Text style={s.rating}>{googleRatingText(school.google_rating, school.google_review_count)}</Text>
      {!!community && <Text style={[s.rating, { color: C.green }]}>{community}</Text>}
    </Pressable>
  );
}

function DiscoverScreen({ onOpen }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [rows, setRows] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const latest = useRef(0);
  const pageRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setSearch(typed), 350); // wait until the parent pauses typing
    return () => clearTimeout(t);
  }, [typed]);

  const key = JSON.stringify({ ...filters, search });
  const run = useCallback(async (page, append) => {
    const id = ++latest.current;
    setLoading(true);
    setError('');
    const res = await loadSchools(supabase, JSON.parse(key), page);
    if (id !== latest.current) return; // a newer search has replaced this one
    if (res.error) setError(friendlyError(res.error));
    else {
      pageRef.current = page;
      setRows((prev) => (append ? [...prev, ...res.rows] : res.rows));
      setHasMore(res.hasMore);
    }
    setLoading(false);
  }, [key]);

  useEffect(() => { run(0, false); }, [run]);

  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));
  const count = activeFilterCount(filters);

  const header = (
    <View>
      <TextInput testID="search" style={s.search} placeholder="Search by school name or area" value={typed} onChangeText={setTyped} autoCorrect={false} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Btn testID="toggle-filters" kind="outline" label={showFilters ? 'Hide filters' : `Filters${count ? ` (${count})` : ''}`} onPress={() => setShowFilters((v) => !v)} />
        {count > 0 && <Btn testID="clear-filters" kind="quiet" label="Clear filters" onPress={() => setFilters(DEFAULT_FILTERS)} />}
      </View>
      {showFilters && (
        <View style={[s.card, { marginBottom: 12 }]}>
          <Text style={s.label}>Level</Text>
          <View style={s.wrap}>
            {LEVEL_CHOICES.map((l) => <Chip key={l.key} testID={`level-${l.key}`} label={l.label} selected={filters.level === l.key} onPress={() => set({ level: filters.level === l.key ? null : l.key })} />)}
          </View>
          <View style={s.switchRow}>
            <Text style={s.body}>Daycare available</Text>
            <Switch testID="daycare" value={filters.daycare} onValueChange={(v) => set({ daycare: v })} />
          </View>
          <Text style={s.label}>Google rating</Text>
          <View style={s.wrap}>
            {RATING_CHOICES.map((r) => <Chip key={r.value} testID={`rating-${r.value}`} label={r.label} selected={filters.minRating === r.value} onPress={() => set({ minRating: r.value })} />)}
          </View>
          <View style={s.switchRow}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={s.body}>Include schools with no rating</Text>
              <Text style={s.muted}>Most primary and secondary schools have none on Google, so leave this on to see them.</Text>
            </View>
            <Switch testID="include-unrated" value={filters.includeUnrated} onValueChange={(v) => set({ includeUnrated: v })} />
          </View>
          <Text style={s.label}>Sort by</Text>
          <View style={s.wrap}>
            <Chip testID="sort-name" label="A to Z" selected={filters.sort === 'name'} onPress={() => set({ sort: 'name' })} />
            <Chip testID="sort-rating" label="Best rated" selected={filters.sort === 'rating'} onPress={() => set({ sort: 'rating' })} />
          </View>
        </View>
      )}
      {!!error && <Notice text={error} testID="discover-error" />}
    </View>
  );

  return (
    <ScrollView testID="discover-list" contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      {header}
      {rows.map((item) => <SchoolCard key={item.id} school={item} onPress={() => onOpen(item)} />)}
      {!loading && !error && rows.length === 0 && <Text testID="empty" style={s.empty}>No schools match. Try removing a filter.</Text>}
      <View style={{ paddingVertical: 12 }}>
        {loading && <ActivityIndicator testID="loading" />}
        {!loading && !!error && <Btn testID="retry" label="Try again" onPress={() => run(0, false)} />}
        {!loading && hasMore && <Btn testID="more" kind="outline" label="Show more schools" onPress={() => run(pageRef.current + 1, true)} />}
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------------------------- one school
function ReviewForm({ initial, onSaved, onCancel, schoolId }) {
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [relationship, setRelationship] = useState(initial?.relationship ?? 'current_parent');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const form = { rating, title, body, relationship };
    const problem = validateReview(form);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError('');
    const res = initial ? await updateReview(supabase, initial.id, form) : await submitReview(supabase, schoolId, form);
    setBusy(false);
    if (res.error) setError(friendlyError(res.error, 'review'));
    else onSaved(initial ? 'Saved. It will be checked again before other parents see it.' : 'Thank you! A moderator will check your review before it appears. It is always shown without your name.');
  }

  return (
    <View style={[s.card, { marginTop: 12 }]}>
      <Text style={s.h2}>{initial ? 'Edit your review' : 'Write a review'}</Text>
      <Text style={s.label}>Your rating</Text>
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} testID={`star-${n}`} accessibilityRole="button" onPress={() => setRating(n)}>
            <Text style={{ fontSize: 32, color: n <= rating ? '#F59E0B' : '#D1D5DB' }}>{'\u2605'}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.label}>You are a...</Text>
      <View style={s.wrap}>
        {RELATIONSHIPS.map((r) => <Chip key={r.key} testID={`rel-${r.key}`} label={r.label} selected={relationship === r.key} onPress={() => setRelationship(r.key)} />)}
      </View>
      <TextInput testID="review-title" style={s.input} placeholder="Title (optional)" value={title} onChangeText={setTitle} maxLength={120} />
      <TextInput testID="review-body" style={[s.input, { minHeight: 110, textAlignVertical: 'top' }]} multiline placeholder="What should other parents know? (at least 20 characters)" value={body} onChangeText={setBody} />
      <Text style={s.muted}>{body.trim().length} / 2000. Please do not include names of children or staff.</Text>
      {!!error && <Notice text={error} testID="review-error" />}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <Btn testID="review-save" label={busy ? 'Saving...' : initial ? 'Save changes' : 'Submit review'} onPress={save} disabled={busy} />
        <Btn testID="review-cancel" kind="quiet" label="Cancel" onPress={onCancel} />
      </View>
    </View>
  );
}

function SchoolScreen({ school, onBack }) {
  const [stats, setStats] = useState(school.community);
  const [reviews, setReviews] = useState(null);
  const [mine, setMine] = useState(undefined); // undefined = still loading, null = has not reviewed
  const [error, setError] = useState('');
  const [form, setForm] = useState(false);
  const [message, setMessage] = useState('');
  const [reporting, setReporting] = useState(null);
  const [reportMsg, setReportMsg] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const reload = useCallback(async () => {
    const [r, m, st] = await Promise.all([loadReviews(supabase, school.id), loadMyReview(supabase, school.id), loadStats(supabase, [school.id])]);
    if (r.error) setError(friendlyError(r.error));
    setReviews(r.rows);
    setMine(m.review);
    setStats(st[school.id] ?? null);
  }, [school.id]);
  useEffect(() => { reload(); }, [reload]);

  async function report(reviewId, reason) {
    const res = await reportReview(supabase, reviewId, reason);
    setReportMsg((m) => ({ ...m, [reviewId]: res.error ? friendlyError(res.error, 'report') : 'Thank you. A moderator will take a look.' }));
    setReporting(null);
  }

  async function remove() {
    const res = await deleteReview(supabase, mine.id);
    if (res.error) setError(friendlyError(res.error));
    else { setConfirmDelete(false); setMessage('Your review was deleted.'); reload(); }
  }

  const site = safeUrl(school.website);
  const community = communityText(stats);

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Btn testID="back" kind="quiet" label="< Back to schools" onPress={onBack} />
      <Text style={s.title}>{cleanName(school.name)}</Text>
      {!!school.address && <Text style={s.body}>{school.address}</Text>}
      <View style={s.badgeRow}>
        {levelBadges(school.levels).map((b) => <Text key={b} style={s.badge}>{b}</Text>)}
        {!!school.board && <Text style={[s.badge, { backgroundColor: C.greenSoft, color: C.green }]}>{school.board}</Text>}
      </View>
      <Text style={s.rating}>{googleRatingText(school.google_rating, school.google_review_count)}</Text>
      {!school.google_rating && <Text style={s.muted}>Google does not show ratings for many schools. Parent reviews below fill the gap.</Text>}
      {!!site && <Btn testID="website" kind="outline" label="Visit school website" onPress={() => Linking.openURL(site)} />}

      <Text style={[s.h2, { marginTop: 20 }]}>What parents say</Text>
      {community ? <Text testID="community-summary" style={[s.rating, { color: C.green }]}>{community}</Text> : <Text style={s.muted}>No parent reviews yet. Be the first.</Text>}
      {!!error && <Notice text={error} testID="school-error" />}
      {!!message && <Notice tone="green" text={message} testID="review-message" />}

      {mine === undefined ? <ActivityIndicator style={{ marginTop: 12 }} /> : mine ? (
        <View style={[s.card, { marginTop: 12 }]} testID="my-review">
          <Text style={s.label}>Your review</Text>
          <Text style={s.stars}>{stars(mine.rating)}</Text>
          {!!mine.title && <Text style={s.schoolName}>{mine.title}</Text>}
          <Text style={s.body}>{mine.body}</Text>
          <Notice tone={mine.status === 'published' ? 'green' : mine.status === 'pending' ? 'amber' : 'red'} text={statusLine(mine.status, mine.moderation_note)} testID="my-review-status" />
          {!form && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {mine.status !== 'removed' && <Btn testID="edit-review" kind="outline" label="Edit" onPress={() => { setForm(true); setMessage(''); }} />}
              {!confirmDelete
                ? <Btn testID="delete-review" kind="quiet" label="Delete" onPress={() => setConfirmDelete(true)} />
                : <Btn testID="confirm-delete" kind="quiet" label="Tap again to delete for good" onPress={remove} />}
            </View>
          )}
        </View>
      ) : !form && <Btn testID="write-review" label="Write a review" onPress={() => { setForm(true); setMessage(''); }} />}

      {form && <ReviewForm schoolId={school.id} initial={mine || undefined} onCancel={() => setForm(false)} onSaved={(m) => { setForm(false); setMessage(m); reload(); }} />}

      {(reviews ?? []).map((r) => (
        <View key={r.id} style={s.card} testID={`review-${r.id}`}>
          <Text style={s.stars}>{stars(r.rating)}</Text>
          {!!r.title && <Text style={s.schoolName}>{r.title}</Text>}
          <Text style={s.body}>{r.body}</Text>
          <Text style={s.muted}>{`${RELATIONSHIPS.find((x) => x.key === r.relationship)?.label ?? 'Parent'} \u00b7 ${monthYear(r.created_at)}`}</Text>
          {!!reportMsg[r.id] && <Text testID={`report-msg-${r.id}`} style={[s.muted, { color: C.green }]}>{reportMsg[r.id]}</Text>}
          {mine?.id !== r.id && !reportMsg[r.id] && (reporting === r.id ? (
            <View style={s.wrap}>
              {REPORT_REASONS.map((x) => <Chip key={x.key} testID={`reason-${x.key}`} label={x.label} onPress={() => report(r.id, x.key)} />)}
            </View>
          ) : <Btn testID={`report-${r.id}`} kind="quiet" label="Report" onPress={() => setReporting(r.id)} />)}
        </View>
      ))}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------------------------- the app
export default function App() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  const [school, setSchool] = useState(null);

  useEffect(() => {
    if (!KEY_IS_SET) return undefined;
    supabase.auth.getSession().then(({ data }) => { setSession(data?.session ?? null); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); if (!next) setSchool(null); });
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') supabase.auth.startAutoRefresh(); else supabase.auth.stopAutoRefresh();
    });
    return () => { data?.subscription?.unsubscribe(); app?.remove?.(); };
  }, []);

  useEffect(() => {
    if (!school || Platform.OS !== 'android') return undefined; // the phone's back button exists only on Android
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setSchool(null); return true; });
    return () => sub.remove();
  }, [school]);

  if (!KEY_IS_SET) {
    return (
      <View style={[s.root, s.center]} testID="setup">
        <Text style={s.h2}>One quick step</Text>
        <Text style={[s.body, { textAlign: 'center', marginTop: 8 }]}>
          Open App.js and replace PASTE_YOUR_PUBLISHABLE_KEY_HERE with your Supabase publishable key (it starts with sb_publishable_). Never use a secret key here.
        </Text>
      </View>
    );
  }
  if (!ready) return <View style={[s.root, s.center]}><ActivityIndicator testID="boot" /></View>;
  if (!session) return <View style={s.root}><AuthScreen /></View>;

  return (
    <View style={s.root}>
      <View style={s.topBar}>
        <Text style={s.topTitle}>Kidscover</Text>
        <Btn testID="sign-out" kind="quiet" label="Sign out" onPress={() => supabase.auth.signOut()} />
      </View>
      <View style={{ flex: 1, display: school ? 'none' : 'flex' }}><DiscoverScreen onOpen={setSchool} /></View>
      {school && <SchoolScreen key={school.id} school={school} onBack={() => setSchool(null)} />}
    </View>
  );
}

// ---------------------------------------------------------------------------------------------- styles
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 24 : Platform.OS === 'ios' ? 44 : 0 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: C.card },
  topTitle: { fontSize: 20, fontWeight: '800', color: C.ink },
  authWrap: { padding: 20, paddingTop: 48 },
  logo: { fontSize: 34, fontWeight: '900', color: C.ink, textAlign: 'center' },
  tagline: { color: C.grey, textAlign: 'center', marginTop: 6, marginBottom: 24 },
  card: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 14, marginBottom: 10, gap: 6 },
  h2: { fontSize: 18, fontWeight: '700', color: C.ink },
  title: { fontSize: 24, fontWeight: '800', color: C.ink, marginTop: 4 },
  schoolName: { fontSize: 16, fontWeight: '700', color: C.ink },
  body: { fontSize: 15, color: C.ink },
  muted: { fontSize: 13, color: C.grey },
  label: { fontSize: 12, fontWeight: '700', color: C.grey, textTransform: 'uppercase', marginTop: 6 },
  rating: { fontSize: 14, fontWeight: '600', color: C.ink },
  stars: { fontSize: 18, color: '#F59E0B' },
  empty: { textAlign: 'center', color: C.grey, marginTop: 24 },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 10, padding: 12, fontSize: 15, backgroundColor: '#fff', color: C.ink, marginVertical: 4 },
  search: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 12, padding: 12, fontSize: 16, backgroundColor: '#fff', color: C.ink, marginBottom: 10 },
  btn: { backgroundColor: C.blue, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 16, alignItems: 'center', marginVertical: 4 },
  btnOutline: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.blue },
  btnQuiet: { backgroundColor: 'transparent' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  chip: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12, backgroundColor: '#fff' },
  chipOn: { backgroundColor: C.blue, borderColor: C.blue },
  chipText: { color: C.ink, fontSize: 14 },
  chipTextOn: { color: '#fff', fontWeight: '700' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 4 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 4 },
  badge: { backgroundColor: C.blueSoft, color: C.blue, fontSize: 12, fontWeight: '700', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, overflow: 'hidden' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 6 },
  notice: { borderRadius: 10, padding: 10, marginVertical: 6 },
});
