// =====================================================================================================
// Kidscover - parent app, first version.
//
// ONE FILE ON PURPOSE: paste all of this into snack.expo.dev as App.js.
//   1. Set SUPABASE_KEY below to your publishable key (sb_publishable_...). NEVER a secret key.
//   2. Snack offers to add the packages this file imports (@supabase/supabase-js, @react-native-async-storage/
//      async-storage, react-native-url-polyfill, expo-location). Accept them.
//   3. "Schools near me" needs the database function from supabase/migrations/20260919000500_schools_nearby.sql (in the
//      admin repo). Run that in the Supabase SQL Editor BEFORE using the new app. Without it the app still works; the
//      "Use my location" button just says it is not switched on yet.
//   4. Drive times need 20260919000700_drive_times.sql and the commute-times edge function (admin repo), plus the Routes
//      API switched on in Google Cloud. Without them the app says drive times are not switched on yet.
//   5. Boards and admission status need 20260919000800_school_website_findings.sql (admin repo) run FIRST: the school
//      list asks for its columns, so without it the list shows a missing-column error.
//   6. Schools / After-school classes / Colleges need 20260919001000_school_categories.sql (admin repo) run FIRST, for
//      the same reason. Paste this app straight after running it: the older app does not know the categories.
//   7. Photos, facilities and achievements need 20260919001200_school_profiles.sql (admin repo) run FIRST: the school
//      list asks for the photo columns. The drawings are made with react-native-svg (Snack offers to add it).
// What it does: sign in / sign up, search schools, filter by level / daycare / Google rating / distance, see how far (and how long a drive) each
// school is from you, open a school (its photo, facilities and achievements), read parent reviews, write one (anonymous,
// moderated before it shows), and report a review.
// =====================================================================================================
import 'react-native-url-polyfill/auto';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, AppState, BackHandler, Image, Linking, Platform, Pressable, ScrollView, StatusBar,
  StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { createClient } from '@supabase/supabase-js';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Polygon, Rect, Stop } from 'react-native-svg';

const SUPABASE_URL = 'https://twpcjrpknsqlycdvwtsj.supabase.co';
const SUPABASE_KEY = 'PASTE_YOUR_PUBLISHABLE_KEY_HERE';
const KEY_IS_SET = !SUPABASE_KEY.startsWith('PASTE');

const supabase = createClient(SUPABASE_URL, KEY_IS_SET ? SUPABASE_KEY : 'key-not-set', {
  auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

// ==== BEGIN pure logic (no imports, no React: tested on its own) ====

const PAGE_SIZE = 20;
const SCHOOL_COLUMNS = 'id,name,address,website,board,levels,google_rating,google_review_count,category,'
  + 'boards,board_source,board_source_url,admissions_open,admissions_year,admissions_source_url,admissions_checked_at,'
  + 'photo_url,photo_source,photo_credit,photo_licence,photo_page_url';
const NEARBY_COLUMNS = `${SCHOOL_COLUMNS},distance_km`; // the database function schools_nearby adds the distance
const LOCATION_TIMEOUT_MS = 15000;
// The area the schools were collected for (the same box the importer is limited to). Outside it the app still works.
const SERVICE_AREA = { latMin: 18.5, latMax: 19.7, lngMin: 72.5, lngMax: 73.5 };

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
const DISTANCE_CHOICES = [
  { km: null, label: 'Any distance' },
  { km: 2, label: 'Within 2 km' },
  { km: 5, label: 'Within 5 km' },
  { km: 10, label: 'Within 10 km' },
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
const DEFAULT_FILTERS = { search: '', level: null, daycare: false, minRating: 0, includeUnrated: true, sort: 'name', nearKm: null, board: null, includeUnknownBoard: false, category: 'school' };

// What kind of place. The main list is schools (preschool to class 12, junior colleges included); after-school classes
// (music, dance, sports, tuition) and colleges are kept apart so they do not crowd it. The database sorts every place
// into one of these (school_category), and an admin can move any single place.
const CATEGORY_CHOICES = [
  { key: 'school', label: 'Schools', noun: 'schools' },
  { key: 'after_school', label: 'After-school classes', noun: 'after-school classes' },
  { key: 'college', label: 'Colleges', noun: 'colleges' },
];
const categoryOf = (key) => CATEGORY_CHOICES.find((c) => c.key === key) ?? CATEGORY_CHOICES[0];
// Levels ("Level not stated") and admission enquiries are about schools; a dance class or a college shows neither.
const isSchoolPlace = (school) => categoryOf(school?.category).key === 'school';

// Level, daycare and board describe schools, so for classes and colleges they are set aside. Not cleared: they are
// still there on going back to Schools.
function categoryFilters(f) {
  const category = categoryOf(f.category).key;
  return category === 'school' ? { ...f, category } : { ...f, category, level: null, daycare: false, board: null, includeUnknownBoard: false };
}

// ---- boards and admissions: only facts an admin accepted, each with where it came from ----
const BOARD_CHOICES = ['CBSE', 'ICSE', 'IB', 'IGCSE', 'State Board'];

function boardSourceText(source) {
  if (source === 'CBSE directory') return "confirmed by CBSE's own record";
  if (source === 'school website') return "from the school's website";
  if (source === 'school name') return "from the school's name";
  if (source === 'admin') return 'checked by Kidscover';
  return '';
}

// "Admissions open for 2027-28 (from the school's website, checked Sep 2026)", or '' when nobody has checked. A value
// without a source (an old default) is never shown: unknown is better than a guess.
function admissionText(school) {
  if (!school || !school.admissions_source_url || typeof school.admissions_open !== 'boolean') return '';
  const what = school.admissions_open ? 'Admissions open' : 'Admissions closed';
  const year = school.admissions_year ? ` for ${school.admissions_year}` : '';
  const checked = monthYear(school.admissions_checked_at);
  return `${what}${year} (from the school's website${checked ? `, checked ${checked}` : ''})`;
}

// ---- a school's photo, facilities and achievements (kept by the school's staff and Kidscover, every change logged) ----
const FACILITY_INFO = {
  cafeteria: ['Cafeteria', '\ud83c\udf7d\ufe0f'], outdoor_playground: ['Open playground', '\ud83c\udf33'], indoor_play: ['Indoor play', '\ud83e\udd38'],
  swimming_pool: ['Swimming pool', '\ud83c\udfca'], sports_courts: ['Sports courts', '\ud83c\udfc0'], library: ['Library', '\ud83d\udcda'],
  science_labs: ['Science labs', '\ud83d\udd2c'], computer_lab: ['Computer lab', '\ud83d\udcbb'], maths_lab: ['Maths lab', '\u2797'],
  stem_lab: ['STEM / robotics lab', '\ud83e\udd16'], ai_lab: ['AI / coding lab', '\ud83e\udde0'], smart_classes: ['Smart classrooms', '\ud83d\udda5\ufe0f'],
  auditorium: ['Auditorium', '\ud83c\udfad'], art_music: ['Art and music rooms', '\ud83c\udfa8'], transport: ['School bus', '\ud83d\ude8c'],
  medical_room: ['Nurse / medical room', '\ud83e\ude7a'], cctv: ['CCTV and security', '\ud83d\udcf9'], air_conditioned: ['Air-conditioned classrooms', '\u2744\ufe0f'],
  special_needs: ['Special needs support', '\ud83e\udd1d'], teacher_ratio: ['Teacher-student ratio', '\ud83d\udc69\u200d\ud83c\udfeb'],
};
const FACILITY_ORDER = Object.keys(FACILITY_INFO);
const ACHIEVEMENT_INFO = {
  class10: ['Class 10 results', '\ud83d\udcdd'], class12: ['Class 12 results', '\ud83c\udf93'], placements: ['College placements', '\ud83c\udfdb\ufe0f'],
  alumni: ['Notable alumni', '\ud83c\udf1f'], award: ['Awards and rankings', '\ud83c\udfc6'], other: ['Other achievements', '\u2728'],
};
const SOURCE_TEXT = { school: 'from the school', 'school website': "from the school's website", kidscover: 'checked by Kidscover' };

function facilityText(row) {
  const [label] = FACILITY_INFO[row?.facility] ?? [row?.facility ?? ''];
  return row?.detail ? `${label}: ${row.detail}` : label;
}

// Where the facts on a page came from, in one line ("from the school and from the school's website").
function sourcesText(rows) {
  const names = [...new Set((rows ?? []).map((r) => SOURCE_TEXT[r.source]).filter(Boolean))];
  return names.length ? `Listed ${names.join(' and ')}.` : '';
}

// The credit a photo needs: Wikimedia photos name their author and licence (their licences ask for it).
function photoCreditText(school) {
  if (!school?.photo_url) return '';
  if (school.photo_source === 'wikimedia') return `Photo: ${school.photo_credit}, ${school.photo_licence}, via Wikimedia Commons`;
  return school.photo_credit ? `Photo: ${school.photo_credit}` : 'Photo from the school';
}

// The drawn school shown when there is no photo: the same colours for the same school every time, different schools
// in different colours, so a list does not look like one picture repeated.
const ART_COLOURS = [
  { sky: '#DCEBFF', roof: '#FF7A59', wall: '#FFFFFF', door: '#5B4BDB', hill: '#9FDCB4' },
  { sky: '#FFF1D6', roof: '#5B4BDB', wall: '#FFFFFF', door: '#FF7A59', hill: '#B7E4C7' },
  { sky: '#E9E4FF', roof: '#2EC4B6', wall: '#FFFDF5', door: '#FF7A59', hill: '#A8DDB5' },
  { sky: '#FFE4E1', roof: '#FFB23F', wall: '#FFFFFF', door: '#2EC4B6', hill: '#BFE6C8' },
  { sky: '#DFF7F2', roof: '#E0567A', wall: '#FFFFFF', door: '#5B4BDB', hill: '#9ED9B0' },
];
function artColours(seed) {
  let h = 0;
  for (const ch of String(seed ?? '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ART_COLOURS[h % ART_COLOURS.length];
}

// ---- where the parent is. A "place" is { lat, lng }, rounded to about 100 m. It lives only in memory: nothing is saved. ----
function validPlace(p) {
  return !!p && typeof p.lat === 'number' && typeof p.lng === 'number'
    && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

function inServiceArea(p) {
  return validPlace(p) && p.lat >= SERVICE_AREA.latMin && p.lat <= SERVICE_AREA.latMax && p.lng >= SERVICE_AREA.lngMin && p.lng <= SERVICE_AREA.lngMax;
}

// The order a parent gets when they have not chosen one: nearest first once we know where they are, A to Z before.
const defaultSort = (hasPlace) => (hasPlace ? 'distance' : 'name');

// Distance choices only make sense with a place. Without one they fall back to what a parent without a place can have.
function normalizeFilters(f, hasPlace) {
  if (hasPlace) return f;
  return { ...f, nearKm: null, sort: f.sort === 'distance' ? 'name' : f.sort };
}

function distanceText(km) {
  if (typeof km !== 'number' || !Number.isFinite(km) || km < 0) return '';
  if (km < 0.1) return 'Under 100 m away';
  const tenth = Math.round(km * 10) / 10;
  return tenth < 10 ? `${tenth.toFixed(1)} km away` : `${Math.round(km)} km away`;
}

// Google puts a "Plus Code" first in some addresses ("3W9C+9VX, Mumbai, ..."). It means nothing to a parent. Display only.
function cleanAddress(address) {
  const a = String(address ?? '').trim();
  const rest = a.replace(/^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}(?:\s*,\s*|\s+|$)/, '').trim();
  return rest;
}

const isMissingNearby = (error) => error?.code === 'PGRST202' || /schools_nearby/i.test(String(error?.message ?? ''));

function withTimeout(promise, ms) {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('location-timeout')), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

// Asks the phone for permission and its position. `loc` is expo-location (or a stand-in in tests).
// Returns { ok: true, place } or { ok: false, reason: 'denied' | 'blocked' | 'timeout' | 'unavailable' }.
async function locateMe(loc, timeoutMs = LOCATION_TIMEOUT_MS) {
  try {
    const perm = await loc.requestForegroundPermissionsAsync();
    if (perm?.status !== 'granted') return { ok: false, reason: perm?.canAskAgain === false ? 'blocked' : 'denied' };
    const pos = await withTimeout(loc.getCurrentPositionAsync({ accuracy: loc.Accuracy?.Balanced }), timeoutMs);
    const lat = pos?.coords?.latitude;
    const lng = pos?.coords?.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') return { ok: false, reason: 'unavailable' };
    const place = { lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000 };
    return validPlace(place) ? { ok: true, place } : { ok: false, reason: 'unavailable' };
  } catch (e) {
    return { ok: false, reason: e?.message === 'location-timeout' ? 'timeout' : 'unavailable' };
  }
}

function locationProblemText(reason) {
  if (reason === 'blocked') return 'Location is switched off for this app. Turn it on in your phone settings, then try again. You can still search by school name or area.';
  if (reason === 'denied') return 'We did not get permission to use your location. You can still search by school name or area, or tap the button to try again.';
  if (reason === 'timeout') return 'Finding your location took too long. Check that location is switched on for your phone, then try again.';
  return 'We could not find your location. Check that location is switched on for your phone, then try again.';
}
const OUTSIDE_AREA_TEXT = 'You seem to be outside Mumbai and Thane, where Kidscover has schools so far. Distances are measured from where you are.';

// ---- drive time by car, from Google through the commute-times function (it counts each parent's daily lookups) ----
const DRIVE_MODES = [
  { key: 'school_run', label: 'Weekday 7:30 am', long: 'leaving at 7:30 am on a weekday' },
  { key: 'now', label: 'Right now', long: 'leaving now' },
];
const MAX_DRIVE_BATCH = 20; // the function's limit per lookup, and one page of the list

function driveTimeText(t) {
  if (!t || typeof t.minutes !== 'number' || !Number.isFinite(t.minutes) || t.minutes < 0) return '';
  const m = Math.max(1, Math.round(t.minutes));
  if (m < 60) return `About ${m} min by car`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return `About ${h} h${rest ? ` ${rest} min` : ''} by car`;
}

const driveKey = (place, mode, id) => `${place.lat},${place.lng}|${mode}|${id}`;

// Which schools on screen still need a drive time: ones with a distance (so they have coordinates), not already known
// for this place and time of day, and not already being fetched. At most one lookup's worth.
function needDriveTimes(rows, place, mode, known, pending, max = MAX_DRIVE_BATCH) {
  if (!validPlace(place) || !DRIVE_MODES.some((m) => m.key === mode)) return [];
  return (rows ?? [])
    .filter((r) => typeof r.distance_km === 'number' && !(driveKey(place, mode, r.id) in (known ?? {})) && !pending?.has?.(driveKey(place, mode, r.id)))
    .map((r) => r.id)
    .slice(0, max);
}

// Asks the commute-times function. Returns { ok: true, times, lookupsLeft } or { ok: false, code, limit }.
async function requestDriveTimes(fn, place, ids, mode) {
  let res;
  try {
    res = await fn.invoke('commute-times', { body: { lat: place.lat, lng: place.lng, schoolIds: ids, when: mode } });
  } catch (_e) {
    return { ok: false, code: 'network' };
  }
  const { data, error } = res ?? {};
  if (error) {
    if (error.context?.status === 404) return { ok: false, code: 'not_deployed' };
    if (error.name === 'FunctionsFetchError' || /failed to (send|fetch)|network/i.test(String(error.message ?? ''))) return { ok: false, code: 'network' };
    return { ok: false, code: 'failed' };
  }
  if (!data || typeof data !== 'object') return { ok: false, code: 'failed' };
  if (!data.ok) return { ok: false, code: String(data.code ?? 'failed'), limit: data.limit ?? null };
  const times = {};
  for (const id of ids) times[id] = data.times?.[id] ?? data.times?.[String(id).toLowerCase()] ?? null;
  return { ok: true, times, lookupsLeft: typeof data.lookupsLeft === 'number' ? data.lookupsLeft : null };
}

function driveProblemText(code, limit) {
  switch (code) {
    case 'user_limit': return `You have used today's ${limit || 20} drive-time lookups. They start again tomorrow.`;
    case 'daily_budget': return 'Drive times are paused for today because of high demand. Please try again tomorrow.';
    case 'outside_area': return 'Drive times work only in Mumbai and Thane for now.';
    case 'confirm_email': return 'Please confirm your email address first, then try again.';
    case 'sign_in': return 'Please sign out and in again to see drive times.';
    case 'switched_off':
    case 'not_deployed':
    case 'not_configured':
    case 'routes_not_enabled':
    case 'google_key_blocked':
    case 'google_key_invalid': return 'Drive times are not switched on yet. Distances still work.';
    default: return 'Could not get drive times just now. Please try again in a moment.';
  }
}
const NEARBY_MISSING_TEXT = 'Schools near you is not switched on yet. You can still search by school name or area.';

// Text typed into the search box goes into a filter string, so remove the characters that filter syntax uses.
function sanitizeSearch(text) {
  return String(text ?? '').replace(/[,()*"\\%]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

// Applies the parent's choices to a query on the schools table (or, with a place, on the schools_nearby function, whose
// rows also carry distance_km). Without a place the distance choices are ignored.
function applySchoolFilters(query, choices, hasPlace = false) {
  const f = categoryFilters(choices);
  let q = query.eq('is_hidden', false); // the database already hides non-schools from parents; this also keeps an admin's view the same
  q = q.eq('category', f.category);
  const term = sanitizeSearch(f.search);
  if (term) q = q.or(`name.ilike.*${term}*,address.ilike.*${term}*`);
  if (f.level === 'none') q = q.eq('levels', '{}');
  else if (f.level) q = q.overlaps('levels', [f.level]);
  if (f.daycare) q = q.contains('levels', ['daycare']);
  if (BOARD_CHOICES.includes(f.board)) {
    q = f.includeUnknownBoard ? q.or(`boards.ov.{"${f.board}"},boards.is.null`) : q.overlaps('boards', [f.board]);
  }
  if (f.minRating > 0) {
    q = f.includeUnrated ? q.or(`google_rating.gte.${f.minRating},google_rating.is.null`) : q.gte('google_rating', f.minRating);
  } else if (!f.includeUnrated) {
    q = q.not('google_rating', 'is', null);
  }
  if (hasPlace && f.nearKm > 0) q = q.lte('distance_km', f.nearKm);
  // name_sort is the name without emoji, brackets or punctuation, in lower case (a database column), so the list is
  // truly A to Z. The final "id" makes the order the same every time: schools with equal names, ratings or distances
  // would otherwise be free to swap places between pages, so "Show more" could repeat one school and skip another.
  const sort = f.sort === 'distance' && !hasPlace ? 'name' : f.sort;
  if (sort === 'distance') {
    q = q.order('distance_km', { ascending: true });
  } else if (sort === 'rating') {
    q = q.order('google_rating', { ascending: false, nullsFirst: false }).order('google_review_count', { ascending: false, nullsFirst: false });
  } else {
    q = q.order('name_sort', { ascending: true });
  }
  return q.order('id', { ascending: true });
}

// How many choices are narrowing or re-ordering the list (for the "Filters (n)" button).
function activeFilterCount(f, hasPlace = false) {
  const g = categoryFilters(normalizeFilters(f, hasPlace));
  return (g.level ? 1 : 0) + (g.daycare ? 1 : 0) + (g.minRating > 0 ? 1 : 0) + (g.includeUnrated ? 0 : 1) + (g.board ? 1 : 0)
    + (g.sort !== defaultSort(hasPlace) ? 1 : 0) + (hasPlace && g.nearKm > 0 ? 1 : 0);
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
  const cleaned = first.replace(/\s{2,}/g, ' ').replace(/[\s|\-\u2013\u2014,:;]+$/, '').trim();
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
  // the enquiry screens ask first: a "function not found" from them must not be reported as the near-me one
  if (context === 'enquiry' && isMissingEnquiries(error)) return ENQUIRIES_MISSING_TEXT;
  if (isMissingNearby(error)) return NEARBY_MISSING_TEXT;
  if (/an enquiry with this school is already open/i.test(msg)) return 'You already have an open enquiry with this school. Open it under Enquiries to carry on there.';
  if (/daily enquiry limit/i.test(msg)) return 'You have sent 10 enquiries today. Please carry on tomorrow.';
  if (/too many messages/i.test(msg)) return 'That is a lot of messages at once. Please wait a few minutes and try again.';
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
// A school's facilities and achievements. If they cannot be read (for one, before 20260919001200 is run) the page
// simply leaves those sections out: they add to a school page and must never break it.
async function loadFacilities(db, schoolId) {
  const { data, error } = await db.from('school_facilities').select('facility,detail,source').eq('school_id', schoolId);
  if (error) return { rows: [], error };
  const rows = (data ?? []).filter((r) => FACILITY_INFO[r.facility]).sort((a, b) => FACILITY_ORDER.indexOf(a.facility) - FACILITY_ORDER.indexOf(b.facility));
  return { rows, error: null };
}
async function loadAchievements(db, schoolId) {
  const { data, error } = await db.from('school_achievements').select('id,kind,text,year,source,source_url').eq('school_id', schoolId)
    .order('year', { ascending: false, nullsFirst: false });
  if (error) return { groups: [], error };
  const groups = Object.keys(ACHIEVEMENT_INFO)
    .map((kind) => ({ kind, label: ACHIEVEMENT_INFO[kind][0], icon: ACHIEVEMENT_INFO[kind][1], items: (data ?? []).filter((a) => a.kind === kind) }))
    .filter((g) => g.items.length);
  return { groups, error: null };
}

async function loadStats(db, ids) {
  if (!ids.length) return {};
  const { data } = await db.from('school_review_stats').select('school_id,review_count,avg_rating').in('school_id', ids);
  return Object.fromEntries((data ?? []).map((r) => [r.school_id, r]));
}

// One page of schools. With a place, the rows come from the schools_nearby function and carry distance_km.
async function loadSchools(db, filters, page, place = null) {
  const hasPlace = validPlace(place);
  const from = page * PAGE_SIZE;
  const base = hasPlace
    ? db.rpc('schools_nearby', { p_lat: place.lat, p_lng: place.lng }).select(NEARBY_COLUMNS)
    : db.from('schools').select(SCHOOL_COLUMNS);
  const { data, error } = await applySchoolFilters(base, normalizeFilters(filters, hasPlace), hasPlace).range(from, from + PAGE_SIZE - 1);
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

// ---- admissions enquiries: a parent asks a school about joining, and the conversation that follows ----
const ENQUIRY_COLUMNS = 'id,school_id,school_name,subject,grade_of_interest,start_year,status,created_at,last_message_at,message_count,last_message,unread_for_parent';
const MESSAGE_COLUMNS = 'id,sender_id,message,created_at';
const MAX_ENQUIRY = 2000;
const MIN_ENQUIRY = 10;

const GRADE_CHOICES = ['Nursery', 'Jr KG', 'Sr KG', 'Class 1 to 5', 'Class 6 to 8', 'Class 9 to 10', 'Class 11 to 12'];

// This year and the two after it: nobody plans a school admission further ahead than that.
function startYearChoices(today = new Date()) {
  const y = today.getFullYear();
  return [y, y + 1, y + 2];
}

function validateEnquiry({ message }) {
  const len = (message ?? '').trim().length;
  if (len < MIN_ENQUIRY) return `Please write a little more (at least ${MIN_ENQUIRY} characters, ${len} so far).`;
  if (len > MAX_ENQUIRY) return `Please keep your question under ${MAX_ENQUIRY} characters.`;
  return null;
}

// The subject is what the school sees first in its inbox.
function enquirySubject(grade) {
  const g = (grade ?? '').trim();
  return (g ? `Admission enquiry - ${g}` : 'Admission enquiry').slice(0, 120);
}

function enquiryStatusText(status) {
  if (status === 'open') return 'Waiting for a reply';
  if (status === 'replied') return 'They have replied';
  if (status === 'closed') return 'Closed';
  return '';
}

function enquiryAbout(thread) {
  const bits = [];
  if (thread?.grade_of_interest) bits.push(thread.grade_of_interest);
  if (thread?.start_year) bits.push(`starting ${thread.start_year}`);
  return bits.join(', ');
}

const unreadCount = (threads) => (threads ?? []).filter((t) => t.unread_for_parent).length;

// A message is "yours" when you sent it; anything else came from the school side. The app never learns who a staff
// member is: it only compares against its own user id.
const fromMe = (message, myId) => !!myId && message?.sender_id === myId;

const isMissingEnquiries = (error) => error?.code === 'PGRST202' || error?.code === 'PGRST205' || /enquiry_threads|send_enquiry|ticket_messages/i.test(String(error?.message ?? ''));
const ENQUIRIES_MISSING_TEXT = 'Asking schools is not switched on yet. Please try again later.';

async function sendEnquiry(db, schoolId, form) {
  return db.rpc('send_enquiry', {
    p_school: schoolId,
    p_subject: enquirySubject(form.grade),
    p_message: (form.message ?? '').trim(),
    p_grade: form.grade ? form.grade : null,
    p_start_year: form.startYear ?? null,
  });
}

async function loadEnquiries(db) {
  const { data, error } = await db.from('enquiry_threads').select(ENQUIRY_COLUMNS).order('last_message_at', { ascending: false }).limit(100);
  return { rows: data ?? [], error };
}

// The parent's own enquiry about one school, if there is one, so the school page can offer to open it instead.
async function loadEnquiryForSchool(db, schoolId) {
  const { data, error } = await db.from('enquiry_threads').select(ENQUIRY_COLUMNS).eq('school_id', schoolId).order('last_message_at', { ascending: false }).limit(1);
  return { thread: (data ?? [])[0] ?? null, error };
}

async function loadEnquiryMessages(db, ticketId) {
  const { data, error } = await db.from('ticket_messages').select(MESSAGE_COLUMNS).eq('ticket_id', ticketId).order('created_at', { ascending: true }).limit(200);
  return { rows: data ?? [], error };
}

const replyToEnquiry = (db, ticketId, text) => db.from('ticket_messages').insert({ ticket_id: ticketId, message: (text ?? '').trim() });
const markEnquiryRead = (db, ticketId) => db.rpc('mark_ticket_read', { p_ticket: ticketId });
const closeEnquiry = (db, ticketId) => db.rpc('set_ticket_status', { p_ticket: ticketId, p_status: 'closed' });

const reviewFields = (f) => ({ rating: f.rating, title: f.title?.trim() ? f.title.trim() : null, body: f.body.trim(), relationship: f.relationship });
const submitReview = (db, schoolId, f) => db.from('school_reviews').insert({ school_id: schoolId, ...reviewFields(f) });
const updateReview = (db, id, f) => db.from('school_reviews').update(reviewFields(f)).eq('id', id);
const deleteReview = (db, id) => db.from('school_reviews').delete().eq('id', id);
const reportReview = (db, reviewId, reason) => db.from('review_reports').insert({ review_id: reviewId, reason });

// ==== END pure logic ====

// ---------------------------------------------------------------------------------------------- small pieces
// A friendly palette: violet for actions, coral, sunshine and mint for warmth, on a soft lavender page.
const C = {
  blue: '#5B4BDB', blueSoft: '#ECE9FF', ink: '#1F1B3A', grey: '#6B6880', line: '#E7E4F2', bg: '#F7F5FF', card: '#FFFFFF',
  red: '#B91C1C', redSoft: '#FEE2E2', green: '#0F8A6A', greenSoft: '#D7F5EC', amber: '#B45309', amberSoft: '#FEF3C7',
  coral: '#FF7A59', coralSoft: '#FFE9E2', sun: '#FFC857', sunSoft: '#FFF4D6', mint: '#2EC4B6', mintSoft: '#DDF6F3',
};
const CATEGORY_ICONS = { school: '\ud83c\udfeb', after_school: '\ud83c\udfa8', college: '\ud83c\udf93' };

// ---------------------------------------------------------------------------------------------- drawings
// Drawn here, in code (react-native-svg), so there is no image to license and nothing to download.

// A parent walking a child to school, for the sign-in screen.
function WelcomeArt({ height = 200 }) {
  return (
    <Svg testID="welcome-art" width="100%" height={height} viewBox="0 0 360 220" preserveAspectRatio="xMidYMid slice">
      <Defs>
        <LinearGradient id="kidscover-sky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#CFE3FF" />
          <Stop offset="1" stopColor="#F7F5FF" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="360" height="220" fill="url(#kidscover-sky)" />
      <Circle cx="300" cy="46" r="30" fill="#FFE7A8" />
      <Circle cx="300" cy="46" r="20" fill={C.sun} />
      <G fill="#FFFFFF">
        <Ellipse cx="70" cy="44" rx="26" ry="11" />
        <Ellipse cx="90" cy="38" rx="18" ry="12" />
        <Ellipse cx="190" cy="30" rx="22" ry="9" />
        <Ellipse cx="206" cy="25" rx="14" ry="9" />
      </G>
      <Path d="M0 168 Q 90 122 180 158 T 360 146 L360 220 L0 220 Z" fill="#BDE8C9" />
      <Path d="M0 192 Q 120 162 240 186 T 360 178 L360 220 L0 220 Z" fill="#8FD6A6" />
      <Rect x="196" y="100" width="120" height="82" rx="4" fill="#FFFFFF" stroke={C.line} strokeWidth="2" />
      <Polygon points="186,104 256,62 326,104" fill={C.coral} />
      <Circle cx="256" cy="88" r="9" fill="#FFFFFF" stroke={C.blue} strokeWidth="2" />
      <Path d="M256 83 L256 88 L260 90" stroke={C.blue} strokeWidth="2" fill="none" strokeLinecap="round" />
      <Rect x="208" y="116" width="24" height="18" rx="2" fill="#CFE3FF" stroke={C.blue} strokeWidth="2" />
      <Rect x="280" y="116" width="24" height="18" rx="2" fill="#CFE3FF" stroke={C.blue} strokeWidth="2" />
      <Rect x="208" y="146" width="24" height="18" rx="2" fill="#CFE3FF" stroke={C.blue} strokeWidth="2" />
      <Rect x="280" y="146" width="24" height="18" rx="2" fill="#CFE3FF" stroke={C.blue} strokeWidth="2" />
      <Rect x="244" y="142" width="24" height="40" rx="4" fill={C.blue} />
      <Path d="M256 62 L256 38" stroke={C.grey} strokeWidth="2" />
      <Polygon points="256,38 274,44 256,50" fill={C.sun} />
      <Path d="M36 220 C 120 204 200 200 248 182 L 264 182 C 222 206 150 214 96 220 Z" fill="#F4E7CF" />
      <Rect x="36" y="150" width="7" height="30" rx="2" fill="#8B5E3C" />
      <Circle cx="40" cy="142" r="18" fill={C.mint} />
      <Circle cx="28" cy="152" r="11" fill="#27AE9C" />
      <Rect x="104" y="170" width="7" height="28" rx="3" fill={C.ink} />
      <Rect x="115" y="170" width="7" height="28" rx="3" fill={C.ink} />
      <Rect x="98" y="128" width="30" height="46" rx="12" fill={C.blue} />
      <Circle cx="113" cy="115" r="12" fill="#E0AC69" />
      <Path d="M101 113 Q 113 94 125 113 Q 119 104 113 104 Q 106 104 101 113 Z" fill="#3B2A20" />
      <Path d="M126 142 Q 138 150 148 153" stroke="#E0AC69" strokeWidth="5" fill="none" strokeLinecap="round" />
      <Rect x="147" y="174" width="5" height="20" rx="2" fill={C.ink} />
      <Rect x="156" y="174" width="5" height="20" rx="2" fill={C.ink} />
      <Rect x="161" y="152" width="11" height="19" rx="3" fill={C.sun} />
      <Rect x="143" y="148" width="22" height="30" rx="9" fill={C.coral} />
      <Circle cx="154" cy="138" r="9" fill="#C68642" />
      <Path d="M145 136 Q 154 124 163 136 Q 158 131 154 131 Q 149 131 145 136 Z" fill="#2B1B0E" />
      <Path d="M130 60 q5 -5 10 0 q5 -5 10 0" stroke={C.grey} strokeWidth="2" fill="none" />
      <Path d="M152 74 q4 -4 8 0 q4 -4 8 0" stroke={C.grey} strokeWidth="2" fill="none" />
    </Svg>
  );
}

// A drawn school, in colours of its own: shown when a school has no photo, big on its page or small on its card.
function SchoolArt({ seed, height = 180, compact = false, testID }) {
  const k = artColours(seed);
  return (
    <Svg testID={testID} width="100%" height={height} viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">
      <Rect x="0" y="0" width="320" height="180" fill={k.sky} />
      {!compact && <Circle cx="276" cy="36" r="16" fill={C.sun} />}
      {!compact && (
        <G fill="#FFFFFF">
          <Ellipse cx="60" cy="36" rx="22" ry="9" />
          <Ellipse cx="76" cy="31" rx="14" ry="9" />
        </G>
      )}
      <Path d="M0 142 Q 80 118 160 138 T 320 132 L320 180 L0 180 Z" fill={k.hill} />
      <Rect x="96" y="76" width="128" height="80" rx="4" fill={k.wall} stroke={C.line} strokeWidth="2" />
      <Polygon points="86,80 160,40 234,80" fill={k.roof} />
      <Circle cx="160" cy="64" r="9" fill="#FFFFFF" />
      <Rect x="108" y="92" width="24" height="18" rx="2" fill="#CFE3FF" />
      <Rect x="188" y="92" width="24" height="18" rx="2" fill="#CFE3FF" />
      <Rect x="108" y="122" width="24" height="18" rx="2" fill="#CFE3FF" />
      <Rect x="188" y="122" width="24" height="18" rx="2" fill="#CFE3FF" />
      <Rect x="148" y="118" width="24" height="38" rx="4" fill={k.door} />
      <Path d="M160 40 L160 18" stroke={C.grey} strokeWidth="2" />
      <Polygon points="160,18 176,23 160,28" fill={C.sun} />
      <Rect x="38" y="118" width="6" height="26" rx="2" fill="#8B5E3C" />
      <Circle cx="41" cy="112" r="15" fill={C.mint} />
      <Rect x="274" y="120" width="6" height="24" rx="2" fill="#8B5E3C" />
      <Circle cx="277" cy="114" r="13" fill="#27AE9C" />
    </Svg>
  );
}

function LogoMark({ size = 28 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Rect x="0" y="0" width="32" height="32" rx="9" fill={C.blue} />
      <Polygon points="6,15 16,7 26,15" fill={C.sun} />
      <Rect x="9" y="15" width="14" height="10" rx="1.5" fill="#FFFFFF" />
      <Rect x="14" y="19" width="4" height="6" rx="1" fill={C.coral} />
    </Svg>
  );
}

// A school's photo, or its drawing when there is none (or the photo does not load).
function SchoolPicture({ school, height, compact = false, testID }) {
  const [broken, setBroken] = useState(false);
  const url = broken ? '' : safeUrl(school.photo_url);
  if (url) {
    return (
      <Image testID={testID ? `${testID}-photo` : undefined} source={{ uri: url }} resizeMode="cover" onError={() => setBroken(true)}
        accessibilityLabel={`Photo of ${cleanName(school.name)}`} style={{ width: '100%', height, backgroundColor: C.blueSoft }} />
    );
  }
  return <SchoolArt seed={school.id} height={height} compact={compact} testID={testID ? `${testID}-art` : undefined} />;
}

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
      <View style={s.authArt}><WelcomeArt height={200} /></View>
      <View style={s.brandRow}>
        <LogoMark size={36} />
        <Text style={s.logo}>Kidscover</Text>
      </View>
      <Text style={s.tagline}>Find the right school for your child, with real information.</Text>
      <View style={[s.card, s.authCard]}>
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
function SchoolCard({ school, drive, onPress }) {
  const community = communityText(school.community);
  const distance = distanceText(school.distance_km);
  const address = cleanAddress(school.address);
  const driving = driveTimeText(drive);
  return (
    <Pressable testID={`school-${school.id}`} accessibilityRole="button" onPress={onPress} style={[s.card, s.cardRow]}>
      <View style={s.thumb}><SchoolPicture school={school} height={78} compact testID={`thumb-${school.id}`} /></View>
      <View style={{ flex: 1, gap: 5 }}>
      <Text style={s.schoolName}>{cleanName(school.name)}</Text>
      {!!distance && <Text testID={`distance-${school.id}`} style={s.distance}>{distance}</Text>}
      {!!driving && <Text testID={`drivetime-${school.id}`} style={s.distance}>{driving}</Text>}
      {!!address && <Text style={s.muted} numberOfLines={2}>{address}</Text>}
      <View style={s.badgeRow}>
        {isSchoolPlace(school) && levelBadges(school.levels).map((b) => <Text key={b} style={s.badge}>{b}</Text>)}
        {!!school.board && <Text style={[s.badge, { backgroundColor: C.greenSoft, color: C.green }]}>{school.board}</Text>}
        {!!admissionText(school) && school.admissions_open && <Text testID={`open-${school.id}`} style={[s.badge, { backgroundColor: C.amberSoft, color: C.amber }]}>{`Admissions open${school.admissions_year ? ` ${school.admissions_year}` : ''}`}</Text>}
      </View>
      <Text style={s.rating}>{googleRatingText(school.google_rating, school.google_review_count)}</Text>
      {!!community && <Text style={[s.rating, { color: C.green }]}>{community}</Text>}
      </View>
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
  const [place, setPlace] = useState(null); // where the parent is, once they allow it; kept in memory only
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState(null); // { tone, text } about the location, kept apart from list errors
  const [driveMode, setDriveMode] = useState(null); // null until the parent asks: drive times cost a Google lookup
  const [driveTimes, setDriveTimes] = useState({}); // driveKey -> { minutes, km } | null (no route); in memory only
  const [driveNote, setDriveNote] = useState(null);
  const drivePending = useRef(new Set());
  const latest = useRef(0);
  const pageRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setSearch(typed), 350); // wait until the parent pauses typing
    return () => clearTimeout(t);
  }, [typed]);

  const key = JSON.stringify({ ...filters, search, place });
  const run = useCallback(async (page, append) => {
    const id = ++latest.current;
    const { place: where, ...f } = JSON.parse(key);
    setLoading(true);
    setError('');
    const res = await loadSchools(supabase, f, page, where);
    if (id !== latest.current) return; // a newer search has replaced this one
    if (res.error && where && isMissingNearby(res.error)) {
      // the database function has not been installed: carry on without a position instead of showing a dead list
      setPlace(null);
      setFilters((cur) => normalizeFilters(cur, false));
      setLocationNote({ tone: 'amber', text: NEARBY_MISSING_TEXT });
    } else if (res.error) setError(friendlyError(res.error));
    else {
      pageRef.current = page;
      setRows((prev) => (append ? [...prev, ...res.rows] : res.rows));
      setHasMore(res.hasMore);
    }
    setLoading(false);
  }, [key]);

  useEffect(() => { run(0, false); }, [run]);

  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));
  const cat = categoryOf(filters.category);
  const hasPlace = !!place;
  const count = activeFilterCount(filters, hasPlace);

  async function useMyLocation() {
    setLocating(true);
    setLocationNote(null);
    const res = await locateMe(Location);
    setLocating(false);
    if (!res.ok) { setLocationNote({ tone: 'amber', text: locationProblemText(res.reason) }); return; }
    setPlace(res.place);
    set({ sort: 'distance' }); // they asked for schools near them, so show the nearest first
    if (!inServiceArea(res.place)) setLocationNote({ tone: 'amber', text: OUTSIDE_AREA_TEXT });
  }

  function stopUsingLocation() {
    setPlace(null);
    setLocationNote(null);
    setDriveMode(null);
    setDriveNote(null);
    setFilters((f) => normalizeFilters(f, false));
  }

  // Once the parent has asked for drive times, fetch them for the schools on screen that do not have one yet: one
  // lookup per page of 20. Results are kept per place and time of day, so going back to a list costs nothing.
  useEffect(() => {
    if (!place || !driveMode) return;
    const ids = needDriveTimes(rows, place, driveMode, driveTimes, drivePending.current);
    if (ids.length === 0) return;
    const where = place;
    const mode = driveMode;
    ids.forEach((id) => drivePending.current.add(driveKey(where, mode, id)));
    requestDriveTimes(supabase.functions, where, ids, mode).then((res) => {
      ids.forEach((id) => drivePending.current.delete(driveKey(where, mode, id)));
      if (!res.ok) {
        setDriveMode(null); // stop asking; the parent can tap again once the problem is gone
        setDriveNote({ tone: 'amber', text: driveProblemText(res.code, res.limit) });
        return;
      }
      setDriveTimes((cur) => {
        const next = { ...cur };
        ids.forEach((id) => { next[driveKey(where, mode, id)] = res.times[id] ?? null; });
        return next;
      });
      if (typeof res.lookupsLeft === 'number' && res.lookupsLeft <= 3) {
        setDriveNote({ tone: 'amber', text: `${res.lookupsLeft} drive-time ${res.lookupsLeft === 1 ? 'lookup' : 'lookups'} left today.` });
      }
    });
  }, [rows, place, driveMode, driveTimes]);

  const driveFor = (item) => (place && driveMode ? driveTimes[driveKey(place, driveMode, item.id)] : undefined);

  const header = (
    <View>
      <View style={s.hero} testID="discover-hero">
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={s.heroTitle}>{cat.key === 'school' ? 'Find the right school' : cat.key === 'after_school' ? 'Classes after school' : 'Colleges'}</Text>
          <Text style={s.heroText}>
            {cat.key === 'school' ? 'Preschool to class 12, with boards, levels, drive times and what parents say.'
              : cat.key === 'after_school' ? 'Music, dance, sports, art and tuition near you.' : 'Degree, engineering and business colleges.'}
          </Text>
        </View>
        <View style={s.heroArt}><SchoolArt seed={cat.key} height={78} compact /></View>
      </View>
      <View style={s.wrap}>
        {CATEGORY_CHOICES.map((c) => <Chip key={c.key} testID={`category-${c.key}`} label={`${CATEGORY_ICONS[c.key]} ${c.label}`} selected={cat.key === c.key} onPress={() => set({ category: c.key })} />)}
      </View>
      <TextInput testID="search" style={s.search} placeholder={cat.key === 'school' ? 'Search by school name or area' : `Search ${cat.noun} by name or area`} value={typed} onChangeText={setTyped} autoCorrect={false} />
      {hasPlace ? (
        <View style={[s.card, { marginBottom: 8 }]} testID="near-me-on">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={s.body}>Distances are from your location</Text>
            <Btn testID="stop-location" kind="quiet" label="Turn off" onPress={stopUsingLocation} />
          </View>
          <View style={s.wrap}>
            {DISTANCE_CHOICES.map((d) => <Chip key={String(d.km)} testID={`near-${d.km ?? 'any'}`} label={d.label} selected={filters.nearKm === d.km} onPress={() => set({ nearKm: d.km })} />)}
          </View>
          <Text style={s.muted}>In a straight line, not by road.</Text>
          <Text style={s.label}>Drive time by car</Text>
          <View style={s.wrap}>
            {DRIVE_MODES.map((m) => (
              <Chip key={m.key} testID={`drive-mode-${m.key}`} label={m.label} selected={driveMode === m.key}
                onPress={() => { setDriveNote(null); setDriveMode(driveMode === m.key ? null : m.key); }} />
            ))}
          </View>
          <Text style={s.muted}>Worked out by Google Maps from your approximate location, which Kidscover does not store. Each screen of 20 schools uses one of your daily lookups.</Text>
          {!!driveNote && <Notice tone={driveNote.tone} text={driveNote.text} testID="drive-note" />}
        </View>
      ) : (
        <View style={[s.card, { marginBottom: 8 }]} testID="near-me-off">
          <Btn testID="use-location" kind="outline" label={locating ? 'Finding you...' : 'Use my location'} onPress={useMyLocation} disabled={locating} />
          <Text style={s.muted}>See how far each school is from you. Your location is only used to measure distance and is not saved.</Text>
        </View>
      )}
      {!!locationNote && <Notice tone={locationNote.tone} text={locationNote.text} testID="location-note" />}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Btn testID="toggle-filters" kind="outline" label={showFilters ? 'Hide filters' : `Filters${count ? ` (${count})` : ''}`} onPress={() => setShowFilters((v) => !v)} />
        {count > 0 && <Btn testID="clear-filters" kind="quiet" label="Clear filters" onPress={() => setFilters({ ...DEFAULT_FILTERS, category: cat.key, sort: defaultSort(hasPlace) })} />}
      </View>
      {showFilters && (
        <View style={[s.card, { marginBottom: 12 }]}>
          {cat.key === 'school' && (<>
          <Text style={s.label}>Level</Text>
          <View style={s.wrap}>
            {LEVEL_CHOICES.map((l) => <Chip key={l.key} testID={`level-${l.key}`} label={l.label} selected={filters.level === l.key} onPress={() => set({ level: filters.level === l.key ? null : l.key })} />)}
          </View>
          <View style={s.switchRow}>
            <Text style={s.body}>Daycare available</Text>
            <Switch testID="daycare" value={filters.daycare} onValueChange={(v) => set({ daycare: v })} />
          </View>
          <Text style={s.label}>Board</Text>
          <View style={s.wrap}>
            {BOARD_CHOICES.map((b) => <Chip key={b} testID={`board-${b}`} label={b} selected={filters.board === b} onPress={() => set({ board: filters.board === b ? null : b })} />)}
          </View>
          {!!filters.board && (
            <View style={s.switchRow}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={s.body}>Also show schools whose board we do not know yet</Text>
                <Text style={s.muted}>Kidscover is still checking boards with each school, so many are not known yet.</Text>
              </View>
              <Switch testID="include-unknown-board" value={filters.includeUnknownBoard} onValueChange={(v) => set({ includeUnknownBoard: v })} />
            </View>
          )}
          </>)}
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
            {hasPlace && <Chip testID="sort-distance" label="Nearest first" selected={filters.sort === 'distance'} onPress={() => set({ sort: 'distance' })} />}
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
      {rows.map((item) => (
        <SchoolCard key={item.id} school={item} drive={driveFor(item)}
          onPress={() => onOpen(driveFor(item) ? { ...item, drive: driveFor(item), driveMode } : item)} />
      ))}
      {!loading && !error && rows.length === 0 && (
        <Text testID="empty" style={s.empty}>
          {hasPlace && filters.nearKm ? `No ${cat.noun} within ${filters.nearKm} km match. Try a bigger distance or remove a filter.` : `No ${cat.noun} match. Try removing a filter.`}
        </Text>
      )}
      <View style={{ paddingVertical: 12 }}>
        {loading && <ActivityIndicator testID="loading" />}
        {!loading && !!error && <Btn testID="retry" label="Try again" onPress={() => run(0, false)} />}
        {!loading && hasMore && <Btn testID="more" kind="outline" label={`Show more ${cat.noun}`} onPress={() => run(pageRef.current + 1, true)} />}
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

// ---------------------------------------------------------------------------------------------- enquiries
function EnquiryForm({ schoolId, schoolName, onSent, onCancel }) {
  const [grade, setGrade] = useState('');
  const [startYear, setStartYear] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    const problem = validateEnquiry({ message });
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError('');
    const res = await sendEnquiry(supabase, schoolId, { grade, startYear, message });
    setBusy(false);
    if (res.error) setError(friendlyError(res.error, 'enquiry'));
    else onSent();
  }

  return (
    <View style={[s.card, { marginTop: 12 }]} testID="enquiry-form">
      <Text style={s.h2}>Ask about admissions</Text>
      <Text style={s.muted}>{`Your question goes to ${cleanName(schoolName)} through Kidscover. Please do not include your child's name or date of birth.`}</Text>
      <Text style={s.label}>Which class? (optional)</Text>
      <View style={s.wrap}>
        {GRADE_CHOICES.map((g) => <Chip key={g} testID={`grade-${g}`} label={g} selected={grade === g} onPress={() => setGrade(grade === g ? '' : g)} />)}
      </View>
      <Text style={s.label}>Starting when? (optional)</Text>
      <View style={s.wrap}>
        {startYearChoices().map((y) => <Chip key={y} testID={`year-${y}`} label={String(y)} selected={startYear === y} onPress={() => setStartYear(startYear === y ? null : y)} />)}
      </View>
      <TextInput
        testID="enquiry-message"
        style={[s.input, { minHeight: 110, textAlignVertical: 'top' }]}
        multiline
        placeholder="What would you like to ask? For example: are places open, what are the fees, how do we visit?"
        value={message}
        onChangeText={setMessage}
      />
      <Text style={s.muted}>{`${message.trim().length} / ${MAX_ENQUIRY}`}</Text>
      {!!error && <Notice text={error} testID="enquiry-error" />}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <Btn testID="enquiry-send" label={busy ? 'Sending...' : 'Send question'} onPress={submit} disabled={busy} />
        <Btn testID="enquiry-cancel" kind="quiet" label="Cancel" onPress={onCancel} />
      </View>
    </View>
  );
}

function Conversation({ thread, myId, onChanged, onBack }) {
  const [messages, setMessages] = useState(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await loadEnquiryMessages(supabase, thread.id);
    if (res.error) setError(friendlyError(res.error, 'enquiry'));
    setMessages(res.rows);
    if (thread.unread_for_parent) { await markEnquiryRead(supabase, thread.id); onChanged?.(); }
  }, [thread.id, thread.unread_for_parent, onChanged]);
  useEffect(() => { load(); }, [load]);

  async function send() {
    const text = reply.trim();
    if (text.length < 1) { setError('Please write your message first.'); return; }
    setBusy(true);
    setError('');
    const res = await replyToEnquiry(supabase, thread.id, text);
    setBusy(false);
    if (res.error) { setError(friendlyError(res.error, 'enquiry')); return; }
    setReply('');
    const again = await loadEnquiryMessages(supabase, thread.id);
    if (!again.error) setMessages(again.rows);
    onChanged?.();
  }

  async function close() {
    setBusy(true);
    const res = await closeEnquiry(supabase, thread.id);
    setBusy(false);
    if (res?.error) setError(friendlyError(res.error, 'enquiry'));
    else onChanged?.();
  }

  return (
    <View testID={`conversation-${thread.id}`}>
      <Btn testID="conversation-back" kind="quiet" label="< Back to enquiries" onPress={onBack} />
      <Text style={s.title}>{cleanName(thread.school_name ?? 'This school')}</Text>
      <Text style={s.muted}>{`${enquiryStatusText(thread.status)}${enquiryAbout(thread) ? ` \u00b7 ${enquiryAbout(thread)}` : ''}`}</Text>
      {!!error && <Notice text={error} testID="conversation-error" />}
      {messages === null ? <ActivityIndicator style={{ marginTop: 12 }} /> : messages.map((m) => (
        <View key={m.id} testID={`msg-${m.id}`} style={[s.card, fromMe(m, myId) ? s.mine : s.theirs]}>
          <Text style={s.label}>{fromMe(m, myId) ? 'You' : 'The school'}</Text>
          <Text style={s.body}>{m.message}</Text>
          <Text style={s.muted}>{monthYear(m.created_at)}</Text>
        </View>
      ))}
      {thread.status === 'closed' ? (
        <Text style={s.muted}>This enquiry is closed. Write below if you need to ask again.</Text>
      ) : null}
      <TextInput
        testID="reply-box"
        style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]}
        multiline
        placeholder="Write a message..."
        value={reply}
        onChangeText={setReply}
      />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn testID="reply-send" label={busy ? 'Sending...' : 'Send'} onPress={send} disabled={busy} />
        {thread.status !== 'closed' && <Btn testID="close-enquiry" kind="quiet" label="Close this enquiry" onPress={close} disabled={busy} />}
      </View>
    </View>
  );
}

function EnquiriesScreen({ myId, onBack, onChanged }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    const res = await loadEnquiries(supabase);
    if (res.error) setError(friendlyError(res.error, 'enquiry'));
    else setError('');
    setRows(res.rows);
    onChanged?.(res.rows);
  }, [onChanged]);
  useEffect(() => { load(); }, [load]);

  const open = (rows ?? []).find((t) => t.id === openId);

  return (
    <ScrollView testID="enquiries-screen" contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      {open ? (
        <Conversation thread={open} myId={myId} onBack={() => { setOpenId(null); load(); }} onChanged={load} />
      ) : (
        <>
          <Btn testID="enquiries-back" kind="quiet" label="< Back to schools" onPress={onBack} />
          <Text style={s.title}>Your enquiries</Text>
          {!!error && <Notice text={error} testID="enquiries-error" />}
          {rows === null && <ActivityIndicator testID="enquiries-loading" style={{ marginTop: 12 }} />}
          {rows !== null && rows.length === 0 && !error && (
            <Text testID="enquiries-empty" style={s.empty}>You have not asked any schools yet. Open a school and tap &quot;Ask about admissions&quot;.</Text>
          )}
          {(rows ?? []).map((t) => (
            <Pressable key={t.id} testID={`thread-${t.id}`} accessibilityRole="button" onPress={() => setOpenId(t.id)} style={s.card}>
              <Text style={s.schoolName}>
                {t.unread_for_parent ? '\u25cf ' : ''}{cleanName(t.school_name ?? 'This school')}
              </Text>
              <Text style={s.muted}>{`${enquiryStatusText(t.status)}${enquiryAbout(t) ? ` \u00b7 ${enquiryAbout(t)}` : ''}`}</Text>
              {!!t.last_message && <Text style={s.body} numberOfLines={2}>{t.last_message}</Text>}
            </Pressable>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function SchoolScreen({ school, onBack, onOpenEnquiries }) {
  const [stats, setStats] = useState(school.community);
  const [reviews, setReviews] = useState(null);
  const [mine, setMine] = useState(undefined); // undefined = still loading, null = has not reviewed
  const [error, setError] = useState('');
  const [form, setForm] = useState(false);
  const [message, setMessage] = useState('');
  const [reporting, setReporting] = useState(null);
  const [reportMsg, setReportMsg] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [enquiry, setEnquiry] = useState(undefined); // undefined = still loading, null = none yet
  const [askForm, setAskForm] = useState(false);
  const [askDone, setAskDone] = useState('');
  const [facilities, setFacilities] = useState([]);
  const [achievements, setAchievements] = useState([]);

  const reload = useCallback(async () => {
    const [r, m, st, en, fa, ac] = await Promise.all([
      loadReviews(supabase, school.id), loadMyReview(supabase, school.id), loadStats(supabase, [school.id]), loadEnquiryForSchool(supabase, school.id),
      loadFacilities(supabase, school.id), loadAchievements(supabase, school.id),
    ]);
    if (r.error) setError(friendlyError(r.error));
    setReviews(r.rows);
    setMine(m.review);
    setStats(st[school.id] ?? null);
    setEnquiry(en.error ? null : en.thread);
    setFacilities(fa.rows);
    setAchievements(ac.groups);
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
      <View style={s.heroPhoto}><SchoolPicture school={school} height={190} testID="hero" /></View>
      {!!photoCreditText(school) && (
        <Text testID="photo-credit" style={s.credit}>
          {photoCreditText(school)}
          {!!safeUrl(school.photo_page_url) && <Text testID="photo-source" style={{ color: C.blue }} onPress={() => Linking.openURL(safeUrl(school.photo_page_url))}> (source)</Text>}
        </Text>
      )}
      <Text testID="page-title" style={s.title}>{cleanName(school.name)}</Text>
      {!!distanceText(school.distance_km) && <Text testID="school-distance" style={s.distance}>{distanceText(school.distance_km)}</Text>}
      {!!driveTimeText(school.drive) && (
        <Text testID="page-drive" style={s.distance}>
          {`${driveTimeText(school.drive)}, ${DRIVE_MODES.find((m) => m.key === school.driveMode)?.long ?? 'leaving now'}`}
        </Text>
      )}
      {!!cleanAddress(school.address) && <Text style={s.body}>{cleanAddress(school.address)}</Text>}
      <View style={s.badgeRow}>
        {isSchoolPlace(school) && levelBadges(school.levels).map((b) => <Text key={b} style={s.badge}>{b}</Text>)}
        {!!school.board && <Text style={[s.badge, { backgroundColor: C.greenSoft, color: C.green }]}>{school.board}</Text>}
      </View>
      {!!school.board && !!boardSourceText(school.board_source) && (
        <Text testID="page-board-source" style={s.muted}>
          {`Board: ${school.board}, ${boardSourceText(school.board_source)}.`}
          {!!safeUrl(school.board_source_url) && <Text testID="board-source-link" style={{ color: C.blue }} onPress={() => Linking.openURL(safeUrl(school.board_source_url))}> See where.</Text>}
        </Text>
      )}
      {!!admissionText(school) && (
        <Text testID="page-admission" style={[s.rating, { color: school.admissions_open ? C.green : C.grey }]}>
          {admissionText(school)}
          {!!safeUrl(school.admissions_source_url) && <Text testID="admission-source-link" style={{ color: C.blue }} onPress={() => Linking.openURL(safeUrl(school.admissions_source_url))}> See the page.</Text>}
        </Text>
      )}
      <Text style={s.rating}>{googleRatingText(school.google_rating, school.google_review_count)}</Text>
      {!school.google_rating && <Text style={s.muted}>Google does not show ratings for many schools. Parent reviews below fill the gap.</Text>}
      {!!site && <Btn testID="website" kind="outline" label="Visit school website" onPress={() => Linking.openURL(site)} />}

      {facilities.length > 0 && (
        <View testID="facilities">
          <Text style={[s.h2, { marginTop: 20 }]}>Facilities</Text>
          <View style={s.wrap}>
            {facilities.map((f) => <Text key={f.facility} testID={`facility-${f.facility}`} style={s.facility}>{`${FACILITY_INFO[f.facility][1]} ${facilityText(f)}`}</Text>)}
          </View>
          <Text style={s.muted}>{sourcesText(facilities)}</Text>
        </View>
      )}

      {achievements.length > 0 && (
        <View testID="achievements">
          <Text style={[s.h2, { marginTop: 20 }]}>Achievements</Text>
          {achievements.map((g) => (
            <View key={g.kind} testID={`achievements-${g.kind}`} style={[s.card, s.achievementCard]}>
              <Text style={s.schoolName}>{`${g.icon} ${g.label}`}</Text>
              {g.items.map((a) => (
                <Text key={a.id} testID={`achievement-${a.id}`} style={s.body}>
                  {a.year ? `${a.year}: ` : ''}{a.text}
                  <Text style={s.muted}>{` (${SOURCE_TEXT[a.source] ?? 'source not given'})`}</Text>
                  {!!safeUrl(a.source_url) && <Text testID={`achievement-link-${a.id}`} style={{ color: C.blue }} onPress={() => Linking.openURL(safeUrl(a.source_url))}> See it</Text>}
                </Text>
              ))}
            </View>
          ))}
          <Text style={s.muted}>What the school says it has achieved. Each line says where it came from.</Text>
        </View>
      )}

      {isSchoolPlace(school) && (<>
      <Text style={[s.h2, { marginTop: 20 }]}>Admissions</Text>
      {!!askDone && <Notice tone="green" text={askDone} testID="enquiry-sent" />}
      {enquiry === undefined ? <ActivityIndicator style={{ marginTop: 8 }} /> : (
        <>
          {!!enquiry && (
            <View style={s.card} testID="enquiry-existing">
              <Text style={s.body}>{`You asked this school already. ${enquiryStatusText(enquiry.status)}.`}</Text>
              <Btn testID="open-enquiry" kind="outline" label="Open the conversation" onPress={onOpenEnquiries} />
            </View>
          )}
          {/* a closed enquiry is not a dead end: something new can always come up */}
          {(!enquiry || enquiry.status === 'closed') && !askForm && (
            <View style={s.card}>
              <Text style={s.body}>
                {enquiry ? 'That enquiry is closed. You can ask again if something new comes up.' : 'Ask about places, fees or a visit. Kidscover passes your question on and you get the reply here.'}
              </Text>
              <Btn testID="ask-school" label={enquiry ? 'Ask again' : 'Ask about admissions'} onPress={() => { setAskForm(true); setAskDone(''); }} />
            </View>
          )}
        </>
      )}
      {askForm && (
        <EnquiryForm
          schoolId={school.id}
          schoolName={school.name}
          onCancel={() => setAskForm(false)}
          onSent={() => { setAskForm(false); setAskDone('Sent. You will find the reply under Enquiries at the top of the app.'); reload(); }}
        />
      )}
      </>)}

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
  const [showEnquiries, setShowEnquiries] = useState(false);
  const [unread, setUnread] = useState(0);

  const refreshUnread = useCallback(async (rows) => {
    if (rows) { setUnread(unreadCount(rows)); return; }
    const res = await loadEnquiries(supabase);
    if (!res.error) setUnread(unreadCount(res.rows));
  }, []);

  useEffect(() => {
    if (!KEY_IS_SET) return undefined;
    supabase.auth.getSession().then(({ data }) => { setSession(data?.session ?? null); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) { setSchool(null); setShowEnquiries(false); setUnread(0); }
    });
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') supabase.auth.startAutoRefresh(); else supabase.auth.stopAutoRefresh();
    });
    return () => { data?.subscription?.unsubscribe(); app?.remove?.(); };
  }, []);

  useEffect(() => {
    if (!session) return undefined;
    refreshUnread();
    return undefined;
  }, [session, refreshUnread]);

  useEffect(() => {
    if ((!school && !showEnquiries) || Platform.OS !== 'android') return undefined; // the phone's back button exists only on Android
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showEnquiries) setShowEnquiries(false); else setSchool(null);
      return true;
    });
    return () => sub.remove();
  }, [school, showEnquiries]);

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
        <View style={s.brandRow}>
          <LogoMark size={26} />
          <Text style={s.topTitle}>Kidscover</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Btn testID="enquiries" kind="quiet" label={unread > 0 ? `Enquiries (${unread})` : 'Enquiries'} onPress={() => setShowEnquiries(true)} />
          <Btn testID="sign-out" kind="quiet" label="Sign out" onPress={() => supabase.auth.signOut()} />
        </View>
      </View>
      {showEnquiries ? (
        <EnquiriesScreen
          myId={session?.user?.id}
          onBack={() => { setShowEnquiries(false); refreshUnread(); }}
          onChanged={refreshUnread}
        />
      ) : (
        <>
          <View style={{ flex: 1, display: school ? 'none' : 'flex' }}><DiscoverScreen onOpen={setSchool} /></View>
          {school && (
            <SchoolScreen
              key={school.id}
              school={school}
              onBack={() => setSchool(null)}
              onOpenEnquiries={() => setShowEnquiries(true)}
            />
          )}
        </>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------------------------- styles
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 24 : Platform.OS === 'ios' ? 44 : 0 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: C.card },
  topTitle: { fontSize: 20, fontWeight: '900', color: C.blue, letterSpacing: 0.3 },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  authWrap: { padding: 20, paddingTop: 28 },
  authArt: { borderRadius: 24, overflow: 'hidden', marginBottom: 18, backgroundColor: C.blueSoft },
  authCard: { borderRadius: 20, padding: 18, shadowColor: C.blue, shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  logo: { fontSize: 34, fontWeight: '900', color: C.blue, textAlign: 'center' },
  tagline: { color: C.grey, textAlign: 'center', marginTop: 6, marginBottom: 20, fontSize: 15 },
  card: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 14, marginBottom: 10, gap: 6 },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  thumb: { width: 78, height: 78, borderRadius: 14, overflow: 'hidden', backgroundColor: C.blueSoft },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.sunSoft, borderRadius: 20, padding: 14, marginBottom: 12 },
  heroTitle: { fontSize: 19, fontWeight: '900', color: C.ink },
  heroText: { fontSize: 13, color: C.grey },
  heroArt: { width: 110, height: 78, borderRadius: 14, overflow: 'hidden' },
  heroPhoto: { borderRadius: 20, overflow: 'hidden', marginTop: 4, marginBottom: 4, backgroundColor: C.blueSoft },
  credit: { fontSize: 11, color: C.grey, marginBottom: 6 },
  facility: { backgroundColor: C.mintSoft, color: C.ink, fontSize: 13, fontWeight: '600', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12, overflow: 'hidden' },
  achievementCard: { marginTop: 8, backgroundColor: '#FFFDF7', borderColor: C.sunSoft },
  h2: { fontSize: 18, fontWeight: '700', color: C.ink },
  title: { fontSize: 24, fontWeight: '800', color: C.ink, marginTop: 4 },
  schoolName: { fontSize: 16, fontWeight: '700', color: C.ink },
  body: { fontSize: 15, color: C.ink },
  muted: { fontSize: 13, color: C.grey },
  label: { fontSize: 12, fontWeight: '700', color: C.grey, textTransform: 'uppercase', marginTop: 6 },
  rating: { fontSize: 14, fontWeight: '600', color: C.ink },
  stars: { fontSize: 18, color: '#F59E0B' },
  empty: { textAlign: 'center', color: C.grey, marginTop: 24 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, fontSize: 15, backgroundColor: '#fff', color: C.ink, marginVertical: 4 },
  search: { borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 13, fontSize: 16, backgroundColor: '#fff', color: C.ink, marginBottom: 10 },
  btn: { backgroundColor: C.blue, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', marginVertical: 4 },
  btnOutline: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.blue },
  btnQuiet: { backgroundColor: 'transparent' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12, backgroundColor: '#fff' },
  chipOn: { backgroundColor: C.blue, borderColor: C.blue },
  chipText: { color: C.ink, fontSize: 14 },
  chipTextOn: { color: '#fff', fontWeight: '700' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 4 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 6, marginVertical: 4 },
  distance: { fontSize: 13, fontWeight: '700', color: C.blue },
  mine: { backgroundColor: C.blueSoft, borderColor: C.blueSoft, marginLeft: 24 },
  theirs: { marginRight: 24 },
  badge: { backgroundColor: C.blueSoft, color: C.blue, fontSize: 12, fontWeight: '700', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, overflow: 'hidden' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 6 },
  notice: { borderRadius: 10, padding: 10, marginVertical: 6 },
});
