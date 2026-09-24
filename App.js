// =====================================================================================================
// Kidscover - the parent app.
//
// This is an Expo project. Two ways to run it:
//   * On your own phone, as an installable app: see README.md ("Building the app for your phone").
//   * In a browser or Expo Go: npx expo start   (or paste this project into snack.expo.dev)
// SUPABASE_KEY below is the Supabase *publishable* key. It is meant to be in the app: every copy of the app carries
// it, and anyone can read it out of an installed one. What keeps data safe is row level security in the database,
// not hiding this. NEVER put a secret key (sb_secret_..., service_role) here - that one grants everything.
//
// What it does: sign in (with a fingerprint next time), find schools near you, filter by level, board, rating,
// distance and cost, see the drive time (including when to leave to be there for the start of school), open a school
// (photo, levels, board, fees, facilities, achievements, reviews), compare up to four schools, ask a school about
// admissions, apply with the Kidscover Standard form, follow the application, and read it all in 31 languages.
//
// The database work it needs, in order: supabase/migrations up to 20260920000600 in the admin repository.
// =====================================================================================================
import 'react-native-url-polyfill/auto';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, AppState, BackHandler, I18nManager, Image, Linking, Platform, Pressable, ScrollView, StatusBar,
  StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Notifications from 'expo-notifications';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import aesjs from 'aes-js';
import { createClient } from '@supabase/supabase-js';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Polygon, Rect, Stop } from 'react-native-svg';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LANGUAGES, languageName, makeTranslator, isRightToLeft, localeFor } from './i18n';

const SUPABASE_URL = 'https://twpcjrpknsqlycdvwtsj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Jm7k8r7chSvR2k1bOAXNcw_66M64fGI';
const KEY_IS_SET = !SUPABASE_KEY.startsWith('PASTE');

// ---- where the sign-in is kept on the phone -------------------------------------------------------------------------
// The sign-in token is not left lying about in plain text. It is encrypted with a key that lives in the phone's own
// keystore (Keychain on iOS, Keystore on Android), and only the encrypted text goes into ordinary storage. On the web
// (Snack, a browser) there is no keystore, so it falls back to ordinary storage, as any website does.
const secureStoreAvailable = Platform.OS !== 'web' && !!SecureStore?.setItemAsync;

const randomKey = async () => {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return aesjs.utils.hex.fromBytes(Array.from(bytes));
};

const LockedStorage = {
  async getItem(key) {
    const stored = await AsyncStorage.getItem(key);
    if (stored === null) return null;
    if (!secureStoreAvailable) return stored;
    try {
      const hexKey = await SecureStore.getItemAsync(`kidscover_key_${key}`);
      if (!hexKey) return null;
      const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(hexKey), new aesjs.Counter(1));
      return aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(stored)));
    } catch {
      return null;   // a key that has gone (the app was reinstalled): sign in again
    }
  },
  async setItem(key, value) {
    if (!secureStoreAvailable) { await AsyncStorage.setItem(key, String(value)); return; }
    const hexKey = await randomKey();
    const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(hexKey), new aesjs.Counter(1));
    const encrypted = aesjs.utils.hex.fromBytes(cipher.encrypt(aesjs.utils.utf8.toBytes(String(value))));
    await SecureStore.setItemAsync(`kidscover_key_${key}`, hexKey);
    await AsyncStorage.setItem(key, encrypted);
  },
  async removeItem(key) {
    await AsyncStorage.removeItem(key);
    if (secureStoreAvailable) { try { await SecureStore.deleteItemAsync(`kidscover_key_${key}`); } catch { /* already gone */ } }
  },
};

const supabase = createClient(SUPABASE_URL, KEY_IS_SET ? SUPABASE_KEY : 'key-not-set', {
  auth: { storage: LockedStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

// ==== BEGIN pure logic (no imports, no React: tested on its own) ====

// The words of the app. The language pack is put in place as soon as it is known (see setTranslator); until then, and
// in tests, English is used. Everything a parent reads goes through t(), so the whole app changes language at once.
let translate = (key) => key;
function setTranslator(fn) { translate = fn; }
const t = (key, values) => translate(key, values);

const PAGE_SIZE = 20;
const SCHOOL_COLUMNS = 'id,name,address,website,board,levels,google_rating,google_review_count,category,'
  + 'boards,board_source,board_source_url,admissions_open,admissions_year,admissions_source_url,admissions_checked_at,'
  + 'photo_url,photo_source,photo_credit,photo_licence,photo_page_url,'
  + 'fee_daycare,fee_preschool,fee_primary,fee_secondary,fees_from,fees_year,start_time,start_time_source';
const NEARBY_COLUMNS = `${SCHOOL_COLUMNS},distance_km`; // the database function schools_nearby adds the distance
const LOCATION_TIMEOUT_MS = 15000;
// The area the schools were collected for (the same box the importer is limited to). Outside it the app still works.
const SERVICE_AREA = { latMin: 18.5, latMax: 19.7, lngMin: 72.5, lngMax: 73.5 };
const MAX_COMPARE = 4;

const LEVEL_CHOICES = [
  { key: 'preschool', label: 'level.preschool' },
  { key: 'primary', label: 'level.primary' },
  { key: 'secondary', label: 'level.secondary' },
  { key: 'none', label: 'level.none' },
];
const RATING_CHOICES = [
  { value: 0, label: 'rating.any' },
  { value: 3.5, label: 'rating.3_5' },
  { value: 4, label: 'rating.4' },
  { value: 4.5, label: 'rating.4_5' },
];
const DISTANCE_CHOICES = [
  { km: null, label: 'distance.any' },
  { km: 2, label: 'distance.2' },
  { km: 5, label: 'distance.5' },
  { km: 10, label: 'distance.10' },
];
// What a family can spend in the first year, all fees counted.
const BUDGET_CHOICES = [null, 50000, 100000, 200000, 300000, 500000, 1000000];
const RELATIONSHIPS = [
  { key: 'current_parent', label: 'relationship.current_parent' },
  { key: 'former_parent', label: 'relationship.former_parent' },
  { key: 'applicant', label: 'relationship.applicant' },
  { key: 'other', label: 'relationship.other' },
];
const REPORT_REASONS = [
  { key: 'spam', label: 'report.spam' },
  { key: 'abusive', label: 'report.abusive' },
  { key: 'fake', label: 'report.fake' },
  { key: 'personal_info', label: 'report.personal_info' },
  { key: 'other', label: 'report.other' },
];
const DEFAULT_FILTERS = {
  search: '', level: null, daycare: false, minRating: 0, includeUnrated: true, sort: 'name', nearKm: null,
  board: null, includeUnknownBoard: false, category: 'school', maxFee: null, includeUnknownFees: false, admissionsOpen: false,
};

// What kind of place. The main list is schools (preschool to class 12, junior colleges included); after-school classes
// (music, dance, sports, tuition) and colleges are kept apart so they do not crowd it.
const CATEGORY_CHOICES = [
  { key: 'school', label: 'category.school', noun: 'category.school.noun' },
  { key: 'after_school', label: 'category.after_school', noun: 'category.after_school.noun' },
  { key: 'college', label: 'category.college', noun: 'category.college.noun' },
];
const categoryOf = (key) => CATEGORY_CHOICES.find((c) => c.key === key) ?? CATEGORY_CHOICES[0];
const isSchoolPlace = (school) => categoryOf(school?.category).key === 'school';

// Level, daycare, board and fees describe schools, so for classes and colleges they are set aside. Not cleared: they
// are still there on going back to Schools.
function categoryFilters(f) {
  const category = categoryOf(f.category).key;
  return category === 'school' ? { ...f, category }
    : { ...f, category, level: null, daycare: false, board: null, includeUnknownBoard: false, maxFee: null, admissionsOpen: false };
}

// ---- boards and admissions: only facts an admin accepted, each with where it came from ----
const BOARD_CHOICES = ['CBSE', 'ICSE', 'IB', 'IGCSE', 'State Board'];

function boardSourceText(source) {
  if (source === 'CBSE directory') return t('source.cbse');
  if (source === 'school website') return t('source.website');
  if (source === 'school name') return t('source.name');
  if (source === 'admin') return t('source.kidscover');
  return '';
}

// "Admissions open for 2027-28 (from the school's website, checked Sep 2026)", or '' when nobody has checked.
function admissionText(school) {
  if (!school || !school.admissions_source_url || typeof school.admissions_open !== 'boolean') return '';
  const checked = monthYear(school.admissions_checked_at);
  return t(school.admissions_open ? 'admissions.open' : 'admissions.closed', {
    year: school.admissions_year ? t('admissions.forYear', { year: school.admissions_year }) : '',
    checked: checked ? t('admissions.checked', { month: checked }) : '',
  });
}

// ---- a school's photo, facilities and achievements ----
const FACILITY_INFO = {
  cafeteria: ['facility.cafeteria', '\ud83c\udf7d\ufe0f'], outdoor_playground: ['facility.outdoor_playground', '\ud83c\udf33'],
  indoor_play: ['facility.indoor_play', '\ud83e\udd38'], swimming_pool: ['facility.swimming_pool', '\ud83c\udfca'],
  sports_courts: ['facility.sports_courts', '\ud83c\udfc0'], library: ['facility.library', '\ud83d\udcda'],
  science_labs: ['facility.science_labs', '\ud83d\udd2c'], computer_lab: ['facility.computer_lab', '\ud83d\udcbb'],
  maths_lab: ['facility.maths_lab', '\u2797'], stem_lab: ['facility.stem_lab', '\ud83e\udd16'],
  ai_lab: ['facility.ai_lab', '\ud83e\udde0'], smart_classes: ['facility.smart_classes', '\ud83d\udda5\ufe0f'],
  auditorium: ['facility.auditorium', '\ud83c\udfad'], art_music: ['facility.art_music', '\ud83c\udfa8'],
  transport: ['facility.transport', '\ud83d\ude8c'], medical_room: ['facility.medical_room', '\ud83e\ude7a'],
  cctv: ['facility.cctv', '\ud83d\udcf9'], air_conditioned: ['facility.air_conditioned', '\u2744\ufe0f'],
  special_needs: ['facility.special_needs', '\ud83e\udd1d'], teacher_ratio: ['facility.teacher_ratio', '\ud83d\udc69\u200d\ud83c\udfeb'],
};
const FACILITY_ORDER = Object.keys(FACILITY_INFO);
const ACHIEVEMENT_INFO = {
  class10: ['achievement.class10', '\ud83d\udcdd'], class12: ['achievement.class12', '\ud83c\udf93'],
  placements: ['achievement.placements', '\ud83c\udfdb\ufe0f'], alumni: ['achievement.alumni', '\ud83c\udf1f'],
  award: ['achievement.award', '\ud83c\udfc6'], other: ['achievement.other', '\u2728'],
};
const SOURCE_TEXT = { school: 'source.school', 'school website': 'source.website', kidscover: 'source.kidscover' };

function facilityText(row) {
  const key = FACILITY_INFO[row?.facility]?.[0];
  const label = key ? t(key) : (row?.facility ?? '');
  return row?.detail ? `${label}: ${row.detail}` : label;
}

// Where the facts on a page came from, in one line.
const SOURCE_LINE = { school: 'sourceline.school', 'school website': 'sourceline.website', kidscover: 'sourceline.kidscover' };
function sourcesText(rows) {
  const parts = [...new Set((rows ?? []).map((r) => SOURCE_LINE[r.source]).filter(Boolean))].map((key) => t(key));
  if (!parts.length) return '';
  const line = parts.join('; ');
  return `${line[0].toUpperCase()}${line.slice(1)}.`;
}

// The credit a photo needs: Wikimedia photos name their author and licence (their licences ask for it).
function photoCreditText(school) {
  if (!school?.photo_url) return '';
  if (school.photo_source === 'wikimedia') return t('photo.wikimedia', { credit: school.photo_credit, licence: school.photo_licence });
  return school.photo_credit ? t('photo.credit', { credit: school.photo_credit }) : t('photo.fromSchool');
}

// The drawn school shown when there is no photo: the same colours for the same school every time.
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

// ---- money ----------------------------------------------------------------------------------------------------------
// Whole rupees, grouped the way the reader's language groups them (2,19,000 in India; 219,000 elsewhere).
let moneyLocale = 'en-IN';
function setMoneyLocale(locale) { moneyLocale = locale || 'en-IN'; }
function rupees(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  try {
    return new Intl.NumberFormat(moneyLocale, { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
  } catch {
    return `\u20b9${Math.round(n)}`;
  }
}
// "Up to 2 lakh" for the budget chips, in plain numbers for languages that do not count in lakhs.
function budgetLabel(amount) {
  if (!amount) return t('fees.anyBudget');
  return t('fees.upTo', { amount: rupees(amount) });
}

const FEE_PARTS = [
  ['tuition', 'fees.tuition', 'year'],
  ['transport', 'fees.transport', 'year'],
  ['meals', 'fees.meals', 'year'],
  ['uniform_books', 'fees.uniform_books', 'year'],
  ['activities', 'fees.activities', 'year'],
  ['other_annual', 'fees.other_annual', 'year'],
  ['admission_fee', 'fees.admission_fee', 'once'],
  ['registration_fee', 'fees.registration_fee', 'once'],
];

// The fee row a family should see: the level they filtered on, else the cheapest one the school gave.
function feeForLevel(school, level) {
  const byLevel = { daycare: school?.fee_daycare, preschool: school?.fee_preschool, primary: school?.fee_primary, secondary: school?.fee_secondary };
  const chosen = level && level !== 'none' ? byLevel[level] : null;
  return typeof chosen === 'number' ? chosen : (typeof school?.fees_from === 'number' ? school.fees_from : null);
}

function feeSummaryText(school, level) {
  const amount = feeForLevel(school, level);
  if (amount === null) return '';
  const exact = level && level !== 'none' && typeof { daycare: school?.fee_daycare, preschool: school?.fee_preschool, primary: school?.fee_primary, secondary: school?.fee_secondary }[level] === 'number';
  return t(exact ? 'fees.firstYear' : 'fees.firstYearFrom', { amount: rupees(amount) });
}

// ---- where the parent is. A "place" is { lat, lng }, rounded to about 100 m. It lives only in memory. ----
function validPlace(p) {
  return !!p && typeof p.lat === 'number' && typeof p.lng === 'number'
    && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

function inServiceArea(p) {
  return validPlace(p) && p.lat >= SERVICE_AREA.latMin && p.lat <= SERVICE_AREA.latMax && p.lng >= SERVICE_AREA.lngMin && p.lng <= SERVICE_AREA.lngMax;
}

const defaultSort = (hasPlace) => (hasPlace ? 'distance' : 'name');

function normalizeFilters(f, hasPlace) {
  if (hasPlace) return f;
  return { ...f, nearKm: null, sort: f.sort === 'distance' ? 'name' : f.sort };
}

function distanceText(km) {
  if (typeof km !== 'number' || !Number.isFinite(km) || km < 0) return '';
  if (km < 0.1) return t('distance.under100m');
  const tenth = Math.round(km * 10) / 10;
  return t('distance.away', { km: tenth < 10 ? tenth.toFixed(1) : String(Math.round(km)) });
}

// Google puts a "Plus Code" first in some addresses ("3W9C+9VX, Mumbai, ..."). It means nothing to a parent.
function cleanAddress(address) {
  const a = String(address ?? '').trim();
  return a.replace(/^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}(?:\s*,\s*|\s+|$)/, '').trim();
}

const isMissingNearby = (error) => error?.code === 'PGRST202' || /schools_nearby/i.test(String(error?.message ?? ''));

function withTimeout(promise, ms) {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('location-timeout')), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

// Asks the phone for permission and its position. `loc` is expo-location (or a stand-in in tests).
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
  if (reason === 'blocked') return t('location.blocked');
  if (reason === 'denied') return t('location.denied');
  if (reason === 'timeout') return t('location.timeout');
  return t('location.unavailable');
}

// ---- the address book: the few places a parent looks for schools from ----
// There is no street-address lookup in this app, so a place is saved where the parent is standing: they turn their
// location on at home, name it "Home", and afterwards they can search around home from anywhere, without turning the
// location on again. The list is theirs alone; the database lets nobody else read it.
const ADDRESS_COLUMNS = 'id,label,address,latitude,longitude,created_at';
const MAX_ADDRESSES = 6;
const MAX_ADDRESS_NAME = 40;
const MAX_ADDRESS_TEXT = 160;

// The table arrives with a migration the person running Kidscover pastes in by hand. Until they have, the app hides
// the address book rather than showing an error nobody can act on.
const isMissingAddresses = (error) => error?.code === 'PGRST205' || error?.code === '42P01' || /parent_addresses/i.test(String(error?.message ?? ''));

const addressPlace = (row) => {
  const place = { lat: row?.latitude, lng: row?.longitude };
  return validPlace(place) ? place : null;
};

const sameName = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

function validateAddress({ label, rows, editingId }) {
  const name = String(label ?? '').trim();
  if (!name) return t('address.needName');
  if (name.length > MAX_ADDRESS_NAME) return t('address.nameLong', { max: MAX_ADDRESS_NAME });
  if ((rows ?? []).some((r) => r.id !== editingId && sameName(r.label, name))) return t('address.nameTaken');
  if (!editingId && (rows ?? []).length >= MAX_ADDRESSES) return t('address.full', { max: MAX_ADDRESSES });
  return null;
}

async function loadAddresses(db) {
  const { data, error } = await db.from('parent_addresses').select(ADDRESS_COLUMNS).order('created_at', { ascending: true });
  if (error) return { rows: [], error };
  // a row the app cannot search from is no use to anyone; it is left in the database but not offered
  return { rows: (data ?? []).filter((r) => !!addressPlace(r)), error: null };
}

// Saving a new place needs somewhere to save: the position the app is holding. Renaming one does not.
async function saveAddress(db, userId, { id, label, address, place }) {
  const fields = {
    label: String(label ?? '').trim().slice(0, MAX_ADDRESS_NAME),
    address: String(address ?? '').trim().slice(0, MAX_ADDRESS_TEXT) || null,
  };
  if (id) {
    const { error } = await db.from('parent_addresses').update(fields).eq('id', id);
    return { error: error ?? null };
  }
  if (!validPlace(place)) return { error: { message: 'no place to save' } };
  const { error } = await db.from('parent_addresses')
    .insert({ ...fields, user_id: userId, latitude: place.lat, longitude: place.lng });
  return { error: error ?? null };
}

async function deleteAddress(db, id) {
  const { error } = await db.from('parent_addresses').delete().eq('id', id);
  return { error: error ?? null };
}

// What the phone says is at a position, as one line. Phones disagree about which fields they fill in and repeat
// themselves, so this takes what there is, in order, without saying the same thing twice.
function describePlace(found) {
  const one = Array.isArray(found) ? found[0] : found;
  if (!one) return '';
  const line = [];
  for (const part of [one.name, one.street, one.district, one.city ?? one.subregion, one.postalCode]) {
    const text = String(part ?? '').trim();
    if (text && !line.some((x) => sameName(x, text))) line.push(text);
  }
  return line.slice(0, 4).join(', ').slice(0, MAX_ADDRESS_TEXT);
}

// Best effort, and nothing more: a phone may have no address lookup at all, and a parent can always type their own.
async function addressHere(loc, place) {
  if (!validPlace(place) || typeof loc?.reverseGeocodeAsync !== 'function') return '';
  try {
    return describePlace(await loc.reverseGeocodeAsync({ latitude: place.lat, longitude: place.lng }));
  } catch {
    return '';
  }
}

// ---- drive time by car, from Google through the commute-times function ----
const DRIVE_MODES = [
  { key: 'school_run', label: 'drive.schoolRun', long: 'drive.schoolRunLong' },
  { key: 'arrive', label: 'drive.arrive', long: 'drive.arriveLong' },
  { key: 'now', label: 'drive.now', long: 'drive.nowLong' },
];
const MAX_DRIVE_BATCH = 20;

function driveTimeText(time) {
  if (!time || typeof time.minutes !== 'number' || !Number.isFinite(time.minutes) || time.minutes < 0) return '';
  const m = Math.max(1, Math.round(time.minutes));
  if (m < 60) return t('drive.minutes', { minutes: m });
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? t('drive.hoursMinutes', { hours: h, minutes: rest }) : t('drive.hours', { hours: h });
}

// "Leave by 07:35 to be there for 08:15" - only for the "arrive" mode, which knows the school's own start time.
function leaveByText(time) {
  if (!time?.leaveBy) return '';
  const leave = clockText(time.leaveBy);
  if (!leave) return '';
  return t(time.assumedStart ? 'drive.leaveByAssumed' : 'drive.leaveBy', { leave, start: time.startTime ?? '' });
}

function clockText(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // India time, where the schools are, whatever the phone is set to
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
}

const driveKey = (place, mode, id) => `${place.lat},${place.lng}|${mode}|${id}`;

function needDriveTimes(rows, place, mode, known, pending, max = MAX_DRIVE_BATCH) {
  if (!validPlace(place) || !DRIVE_MODES.some((m) => m.key === mode)) return [];
  return (rows ?? [])
    .filter((r) => typeof r.distance_km === 'number' && !(driveKey(place, mode, r.id) in (known ?? {})) && !pending?.has?.(driveKey(place, mode, r.id)))
    .map((r) => r.id)
    .slice(0, max);
}

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
    case 'user_limit': return t('drive.limitReached', { limit: limit || 20 });
    case 'daily_budget': return t('drive.paused');
    case 'outside_area': return t('drive.outsideArea');
    case 'confirm_email': return t('error.confirmEmail');
    case 'sign_in': return t('drive.signInAgain');
    case 'switched_off':
    case 'not_deployed':
    case 'not_configured':
    case 'routes_not_enabled':
    case 'google_key_blocked':
    // The server rejected the request outright. In practice that means it is an older copy that does not know this
    // way of asking - "in time for school" was added after it was deployed. Telling someone to try again in a moment
    // is no help: the answer will be the same every time until the function is redeployed.
    case 'bad_request':
    case 'google_key_invalid': return t('drive.notOn');
    default: return t('drive.tryAgain');
  }
}

// Text typed into the search box goes into a filter string, so remove the characters that filter syntax uses.
function sanitizeSearch(text) {
  return String(text ?? '').replace(/[,()*"\\%]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

// Applies the parent's choices to a query on the schools table (or on schools_nearby, whose rows carry distance_km).
function applySchoolFilters(query, choices, hasPlace = false) {
  const f = categoryFilters(choices);
  let q = query.eq('is_hidden', false);
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
  if (f.maxFee > 0) {
    const column = f.level && f.level !== 'none' ? `fee_${f.level}` : 'fees_from';
    q = f.includeUnknownFees ? q.or(`${column}.lte.${f.maxFee},${column}.is.null`) : q.lte(column, f.maxFee);
  }
  if (f.admissionsOpen) q = q.eq('admissions_open', true).not('admissions_source_url', 'is', null);
  if (hasPlace && f.nearKm > 0) q = q.lte('distance_km', f.nearKm);
  const sort = f.sort === 'distance' && !hasPlace ? 'name' : f.sort;
  if (sort === 'distance') {
    q = q.order('distance_km', { ascending: true });
  } else if (sort === 'rating') {
    q = q.order('google_rating', { ascending: false, nullsFirst: false }).order('google_review_count', { ascending: false, nullsFirst: false });
  } else if (sort === 'cost') {
    q = q.order(f.level && f.level !== 'none' ? `fee_${f.level}` : 'fees_from', { ascending: true, nullsFirst: false });
  } else {
    q = q.order('name_sort', { ascending: true });
  }
  return q.order('id', { ascending: true });
}

// How many choices are narrowing or re-ordering the list (for the "Filters (n)" button).
function activeFilterCount(f, hasPlace = false) {
  const g = categoryFilters(normalizeFilters(f, hasPlace));
  return (g.level ? 1 : 0) + (g.daycare ? 1 : 0) + (g.minRating > 0 ? 1 : 0) + (g.includeUnrated ? 0 : 1) + (g.board ? 1 : 0)
    + (g.maxFee ? 1 : 0) + (g.admissionsOpen ? 1 : 0)
    + (g.sort !== defaultSort(hasPlace) ? 1 : 0) + (hasPlace && g.nearKm > 0 ? 1 : 0);
}

function levelBadges(levels) {
  if (!levels) return [];
  const out = [];
  if (levels.includes('preschool')) out.push(t('level.preschool'));
  if (levels.includes('primary')) out.push(t('level.primary'));
  if (levels.includes('secondary')) out.push(t('level.secondary'));
  if (levels.includes('daycare')) out.push(t('level.daycareAvailable'));
  if (levels.length === 0) out.push(t('level.none'));
  return out;
}

function googleRatingText(rating, count) {
  if (rating === null || rating === undefined) return t('rating.none');
  return t(count ? 'rating.google' : 'rating.googleNoCount', { rating: Number(rating).toFixed(1), count });
}

function communityText(stats) {
  if (!stats || !stats.review_count) return null;
  return t(stats.review_count === 1 ? 'reviews.summaryOne' : 'reviews.summary', {
    rating: Number(stats.avg_rating).toFixed(1), count: stats.review_count,
  });
}

function stars(n) {
  const k = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  return '\u2605'.repeat(k) + '\u2606'.repeat(5 - k);
}

let dateLocale = 'en-US';
function setDateLocale(locale) { dateLocale = locale || 'en-US'; }
function monthYear(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try { return d.toLocaleString(dateLocale, { month: 'short', year: 'numeric' }); }
  catch { return d.toLocaleString('en-US', { month: 'short', year: 'numeric' }); }
}
function dayText(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try { return d.toLocaleDateString(dateLocale, { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return d.toISOString().slice(0, 10); }
}

function safeUrl(url) {
  const u = String(url ?? '').trim();
  if (!u) return null;
  const full = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  return /^https?:\/\/[^\s]+\.[^\s]+/i.test(full) ? full : null;
}

// Google business names often carry emoji and search-engine text. Show the part a parent would call the name.
function cleanName(name) {
  const original = String(name ?? '').trim();
  const stripped = original.replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}]/gu, ' ');
  const first = stripped.split(/(?:^|\s)\|(?:\s|$)/).map((p) => p.trim()).filter(Boolean)[0] ?? '';
  const cleaned = first.replace(/\s{2,}/g, ' ').replace(/[\s|\-\u2013\u2014,:;]+$/, '').trim();
  return cleaned || original;
}

function validateAuth({ mode, first, last, email, password, gender }) {
  if (mode === 'signup' && (!first.trim() || !last.trim())) return t('auth.needName');
  if (mode === 'signup' && !PROFILE_GENDERS.includes(gender)) return t('profile.needGender');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return t('auth.needEmail');
  if (mode === 'signup' && password.length < 8) return t('auth.needPassword');
  if (!password) return t('auth.needPasswordAny');
  return null;
}

// ---------------------------------------------------------------------------------------------- the person's profile
// How someone describes themselves. "Prefer not to say" is one of the answers, not the absence of one: a parent can
// finish their profile without telling us something they would rather keep, and the app stops nagging either way.
const PROFILE_GENDERS = ['woman', 'man', 'other', 'prefer_not_to_say'];
// Every picture is drawn by the app in code. Nothing is uploaded, nothing is licensed, and no face reaches a server.
const PROFILE_AVATARS = ['parent_one', 'parent_two', 'parent_three', 'parent_four', 'parent_five', 'parent_six'];
// Which drawing to show. 'auto' - what everyone starts with - follows how they described themselves.
const AUTO_AVATAR = { woman: 'parent_one', man: 'parent_two', other: 'parent_three', prefer_not_to_say: 'parent_four' };
function avatarFor(profile) {
  const chosen = profile?.avatar;
  if (PROFILE_AVATARS.includes(chosen)) return chosen;
  return AUTO_AVATAR[profile?.gender] ?? 'parent_five';
}
// A profile is finished when a school would know who it is hearing from. The database says the same thing in
// my_profile_complete(); this is the app's own copy so a screen does not have to wait for a round trip to know.
const profileComplete = (profile) => !!(String(profile?.first_name ?? '').trim() && String(profile?.last_name ?? '').trim() && PROFILE_GENDERS.includes(profile?.gender));

async function saveProfile(db, userId, patch) {
  const clean = {};
  if ('first_name' in patch) clean.first_name = String(patch.first_name ?? '').trim().slice(0, 60);
  if ('last_name' in patch) clean.last_name = String(patch.last_name ?? '').trim().slice(0, 60);
  if ('gender' in patch && PROFILE_GENDERS.includes(patch.gender)) clean.gender = patch.gender;
  if ('avatar' in patch && PROFILE_AVATARS.includes(patch.avatar)) clean.avatar = patch.avatar;
  if (Object.keys(clean).length === 0) return { error: null, saved: {} };
  const { error } = await db.from('profiles').update(clean).eq('id', userId);
  return { error: error ?? null, saved: clean };
}

function validateReview({ rating, title, body }) {
  if (!rating || rating < 1 || rating > 5) return t('review.needRating');
  if ((title ?? '').length > 120) return t('review.titleTooLong');
  const len = (body ?? '').trim().length;
  if (len < 20) return t('review.tooShort', { count: len });
  if (len > 2000) return t('review.tooLong');
  return null;
}

function statusLine(status, note) {
  if (status === 'pending') return t('review.pending');
  if (status === 'published') return t('review.published');
  if (status === 'rejected') return note ? t('review.rejectedWithNote', { note }) : t('review.rejected');
  if (status === 'removed') return t('review.removed');
  return '';
}

// Turns a Supabase / network error into something a parent can act on.
function friendlyError(error, context) {
  const msg = typeof error === 'string' ? error : String(error?.message ?? '');
  const code = error?.code;
  if (context === 'enquiry' && isMissingEnquiries(error)) return t('error.enquiriesOff');
  if (isMissingNearby(error)) return t('error.nearbyOff');
  if (/an enquiry with this school is already open/i.test(msg)) return t('error.enquiryOpen');
  if (/daily enquiry limit/i.test(msg)) return t('error.enquiryLimit');
  if (/daily application limit/i.test(msg)) return t('error.applicationLimit');
  if (/already applied to this school/i.test(msg)) return t('error.alreadyApplied');
  if (/too many messages/i.test(msg)) return t('error.tooManyMessages');
  if (/invalid login credentials/i.test(msg)) return t('error.badLogin');
  if (/email not confirmed/i.test(msg)) return t('error.notConfirmed');
  if (/already registered|already been registered/i.test(msg)) return t('error.alreadyRegistered');
  if (/rate limit|too many/i.test(msg)) return t('error.rateLimit');
  if (/network request failed|failed to fetch|networkerror|load failed/i.test(msg)) return t('error.network');
  if (/daily review limit/i.test(msg)) return t('error.reviewLimit');
  if (code === '23505' || /duplicate key|unique/i.test(msg)) {
    return context === 'report' ? t('error.alreadyReported') : t('error.alreadyReviewed');
  }
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return context === 'report' ? t('error.cannotReport') : t('error.confirmEmail');
  }
  return msg || t('error.general');
}

// ---- data access. Each takes the database client, so it can be tested with a stand-in. ----
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
    .map((kind) => ({ kind, label: t(ACHIEVEMENT_INFO[kind][0]), icon: ACHIEVEMENT_INFO[kind][1], items: (data ?? []).filter((a) => a.kind === kind) }))
    .filter((g) => g.items.length);
  return { groups, error: null };
}

// Every fee a family pays at this school, per level, for the breakdown on the school page.
async function loadFeeSchedules(db, schoolId) {
  const { data, error } = await db.from('school_fee_schedules')
    .select('level,academic_year,tuition,transport,meals,uniform_books,activities,other_annual,admission_fee,registration_fee,deposit,annual_total,first_year_total,note,source,source_url')
    .eq('school_id', schoolId);
  if (error) return { rows: [], error };
  const order = ['daycare', 'preschool', 'primary', 'secondary'];
  return { rows: (data ?? []).sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level)), error: null };
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

// The counts on the dashboard: how many schools, how many with admissions open or closed.
async function loadTiles(db, place, km) {
  const { data, error } = await db.rpc('school_tiles', {
    p_lat: validPlace(place) ? place.lat : null,
    p_lng: validPlace(place) ? place.lng : null,
    p_km: validPlace(place) && km > 0 ? km : null,
  });
  if (error || !data) return { tiles: null, error: error ?? null };
  return { tiles: data, error: null };
}

async function loadReviews(db, schoolId) {
  const { data, error } = await db.from('school_reviews')
    .select('id,rating,title,body,relationship,created_at')
    .eq('school_id', schoolId).eq('status', 'published')
    .order('created_at', { ascending: false }).limit(30);
  return { rows: data ?? [], error };
}

async function loadMyReview(db, schoolId) {
  const own = await db.from('school_review_private').select('review_id,moderation_note').eq('school_id', schoolId).maybeSingle();
  if (own.error || !own.data) return { review: null, error: own.error ?? null };
  const rev = await db.from('school_reviews').select('id,rating,title,body,relationship,status,created_at').eq('id', own.data.review_id).maybeSingle();
  if (rev.error || !rev.data) return { review: null, error: rev.error ?? null };
  return { review: { ...rev.data, moderation_note: own.data.moderation_note }, error: null };
}

// Counts as "the parent went to the school's own site", so a school can see how much interest Kidscover sends it.
// It is only a count: which parent is never shown to the school.
async function noteOutboundClick(db, schoolId, kind = 'website') {
  try { await db.rpc('log_outbound_click', { p_school: schoolId, p_kind: kind }); } catch { /* never in the way of opening the link */ }
}

// ---- admissions enquiries: a parent asks a school about joining, and the conversation that follows ----
const ENQUIRY_COLUMNS = 'id,school_id,school_name,subject,grade_of_interest,start_year,status,created_at,last_message_at,message_count,last_message,unread_for_parent';
const MESSAGE_COLUMNS = 'id,sender_id,sender_role,message,created_at';
const MAX_ENQUIRY = 2000;
const MIN_ENQUIRY = 10;

const GRADE_CHOICES = ['grade.nursery', 'grade.jrkg', 'grade.srkg', 'grade.1to5', 'grade.6to8', 'grade.9to10', 'grade.11to12'];

function startYearChoices(today = new Date()) {
  const y = today.getFullYear();
  return [y, y + 1, y + 2];
}

function validateEnquiry({ message }) {
  const len = (message ?? '').trim().length;
  if (len < MIN_ENQUIRY) return t('enquiry.tooShort', { min: MIN_ENQUIRY, count: len });
  if (len > MAX_ENQUIRY) return t('enquiry.tooLong', { max: MAX_ENQUIRY });
  return null;
}

// The subject is what the school sees first in its inbox. It is stored in English so every school reads it the same.
function enquirySubject(gradeKey) {
  const grade = gradeKey ? EN_GRADES[gradeKey] ?? '' : '';
  return (grade ? `Admission enquiry - ${grade}` : 'Admission enquiry').slice(0, 120);
}
const EN_GRADES = {
  'grade.nursery': 'Nursery', 'grade.jrkg': 'Jr KG', 'grade.srkg': 'Sr KG', 'grade.1to5': 'Class 1 to 5',
  'grade.6to8': 'Class 6 to 8', 'grade.9to10': 'Class 9 to 10', 'grade.11to12': 'Class 11 to 12',
};

function enquiryStatusText(status) {
  if (status === 'open') return t('enquiry.waiting');
  if (status === 'replied') return t('enquiry.replied');
  if (status === 'closed') return t('enquiry.closed');
  return '';
}

function enquiryAbout(thread) {
  const bits = [];
  if (thread?.grade_of_interest) bits.push(thread.grade_of_interest);
  if (thread?.start_year) bits.push(t('enquiry.starting', { year: thread.start_year }));
  return bits.join(', ');
}

const unreadCount = (threads) => (threads ?? []).filter((t2) => t2.unread_for_parent).length;

// Who a message came from. The database records that on every message as sender_role - 'parent', 'school' or
// 'kidscover' - and that is what decides the name shown, not whose account happens to be signed in. Matching on the
// account id alone got this wrong whenever one person held both sides: every message in the thread said "You",
// including the school's own replies.
const fromMe = (message, myId) => (message?.sender_role ? message.sender_role === 'parent' : !!myId && message?.sender_id === myId);
const messageFrom = (message, myId) => (fromMe(message, myId) ? t('enquiry.you') : message?.sender_role === 'school' ? t('enquiry.theSchool') : t('enquiry.kidscover'));

const isMissingEnquiries = (error) => error?.code === 'PGRST202' || error?.code === 'PGRST205' || /enquiry_threads|send_enquiry|ticket_messages/i.test(String(error?.message ?? ''));

async function sendEnquiry(db, schoolId, form) {
  return db.rpc('send_enquiry', {
    p_school: schoolId,
    p_subject: enquirySubject(form.grade),
    p_message: (form.message ?? '').trim(),
    p_grade: form.grade ? EN_GRADES[form.grade] ?? null : null,
    p_start_year: form.startYear ?? null,
  });
}

async function loadEnquiries(db) {
  const { data, error } = await db.from('enquiry_threads').select(ENQUIRY_COLUMNS).order('last_message_at', { ascending: false }).limit(100);
  return { rows: data ?? [], error };
}

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

// ---- applying: the Kidscover Standard form -----------------------------------------------------------------------------
const APPLY_CLASSES = ['playgroup', 'nursery', 'jr_kg', 'sr_kg', 'class_1', 'class_2', 'class_3', 'class_4', 'class_5',
  'class_6', 'class_7', 'class_8', 'class_9', 'class_10', 'class_11', 'class_12'];
const APPLY_RELATIONS = ['mother', 'father', 'guardian'];
const APPLY_GENDERS = ['girl', 'boy', 'other'];
const APPLICATION_STAGES = ['submitted', 'in_review', 'visit_scheduled', 'offered', 'waitlisted', 'accepted', 'declined', 'withdrawn'];
const APPLICATION_COLUMNS = 'id,school_id,status,status_note,child_first_name,child_last_name,child_dob,child_gender,'
  + 'class_applying,academic_year,current_school,parent_name,parent_relation,parent_phone,parent_email,address,pincode,'
  + 'notes,consent_at,created_at,updated_at,schools(name)';

const classLabel = (key) => t(`class.${key}`);
const stageText = (status) => t(`stage.${status}`);

// The two school years a family can apply for, written the way schools do: 2027-28.
function academicYearChoices(today = new Date()) {
  const start = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return [start, start + 1, start + 2].map((y) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`);
}

const EMPTY_APPLICATION = {
  child_first_name: '', child_last_name: '', child_dob: '', child_gender: '', class_applying: '', academic_year: '',
  current_school: '', parent_name: '', parent_relation: 'mother', parent_phone: '', parent_email: '', address: '',
  pincode: '', notes: '', consent: false,
};

// Everything the form must have before it is worth sending. The database checks all of this again.
function validateApplication(form, today = new Date()) {
  const need = (value, min, max) => { const s = String(value ?? '').trim(); return s.length >= min && s.length <= max; };
  if (!need(form.child_first_name, 1, 60) || !need(form.child_last_name, 1, 60)) return t('apply.needChildName');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(form.child_dob ?? '').trim())) return t('apply.needDob');
  const dob = new Date(`${form.child_dob}T00:00:00Z`);
  const age = (today.getTime() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (Number.isNaN(dob.getTime()) || age < 0.5 || age > 20) return t('apply.dobLooksWrong');
  if (form.child_gender && !APPLY_GENDERS.includes(form.child_gender)) return t('apply.needGender');
  if (!APPLY_CLASSES.includes(form.class_applying)) return t('apply.needClass');
  if (!/^20\d\d-\d\d$/.test(String(form.academic_year ?? ''))) return t('apply.needYear');
  if (!need(form.parent_name, 2, 120)) return t('apply.needParentName');
  if (!APPLY_RELATIONS.includes(form.parent_relation)) return t('apply.needRelation');
  if (!/^\+?[0-9]{10,15}$/.test(String(form.parent_phone ?? '').replace(/[\s()-]/g, ''))) return t('apply.needPhone');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(form.parent_email ?? '').trim())) return t('apply.needEmail');
  if (!need(form.address, 5, 300)) return t('apply.needAddress');
  if (!/^[1-9][0-9]{5}$/.test(String(form.pincode ?? '').trim())) return t('apply.needPincode');
  if (String(form.notes ?? '').length > 1000) return t('apply.notesTooLong');
  if (!form.consent) return t('apply.needConsent');
  return null;
}

async function submitApplication(db, schoolId, form) {
  const problem = validateApplication(form);
  if (problem) return { error: { message: problem } };
  const clean = {
    child_first_name: form.child_first_name.trim(), child_last_name: form.child_last_name.trim(),
    child_dob: form.child_dob.trim(), class_applying: form.class_applying, academic_year: form.academic_year,
    parent_name: form.parent_name.trim(), parent_relation: form.parent_relation,
    parent_phone: String(form.parent_phone).replace(/[\s()-]/g, ''), parent_email: form.parent_email.trim().toLowerCase(),
    address: form.address.trim(), pincode: form.pincode.trim(), consent: true,
  };
  if (form.child_gender) clean.child_gender = form.child_gender;
  if (String(form.current_school ?? '').trim()) clean.current_school = form.current_school.trim();
  if (String(form.notes ?? '').trim()) clean.notes = form.notes.trim();
  const { data, error } = await db.rpc('submit_admission_application', { p_school: schoolId, p_form: clean });
  return { id: data ?? null, error: error ?? null };
}

async function loadApplications(db) {
  const { data, error } = await db.from('admission_applications').select(APPLICATION_COLUMNS).order('created_at', { ascending: false }).limit(50);
  const rows = (data ?? []).map((r) => ({ ...r, school_name: (Array.isArray(r.schools) ? r.schools[0] : r.schools)?.name ?? '' }));
  return { rows, error: error ?? null };
}

async function loadApplicationEvents(db, applicationId) {
  const { data, error } = await db.from('admission_application_events').select('id,status,note,by_role,at')
    .eq('application_id', applicationId).order('at', { ascending: true }).limit(50);
  return { rows: data ?? [], error: error ?? null };
}

const withdrawApplication = (db, id) => db.rpc('withdraw_admission_application', { p_app: id });
const deleteApplication = (db, id) => db.rpc('delete_admission_application', { p_app: id });

const isMissingApplications = (error) => error?.code === 'PGRST202' || error?.code === 'PGRST205'
  || /admission_application|submit_admission/i.test(String(error?.message ?? ''));

// Which of a parent's applications are still moving, for the badge on the button.
const liveApplications = (rows) => (rows ?? []).filter((r) => !['withdrawn', 'declined', 'accepted'].includes(r.status)).length;

// ---- comparing schools ---------------------------------------------------------------------------------------------
function toggleCompare(list, school, max = MAX_COMPARE) {
  const ids = list.map((s) => s.id);
  if (ids.includes(school.id)) return { list: list.filter((s) => s.id !== school.id), full: false };
  if (list.length >= max) return { list, full: true };
  return { list: [...list, school], full: false };
}

// The rows of the comparison table, in the order a family cares about.
function compareRows(schools, level) {
  const value = (fn) => schools.map(fn);
  return [
    { key: 'fees', label: t('compare.cost'), values: value((s) => feeSummaryText(s, level) || t('compare.notKnown')) },
    { key: 'distance', label: t('compare.distance'), values: value((s) => distanceText(s.distance_km) || t('compare.notKnown')) },
    { key: 'drive', label: t('compare.drive'), values: value((s) => driveTimeText(s.drive) || t('compare.notKnown')) },
    { key: 'levels', label: t('compare.levels'), values: value((s) => (levelBadges(s.levels).join(', ') || t('compare.notKnown'))) },
    { key: 'board', label: t('compare.board'), values: value((s) => s.board || t('compare.notKnown')) },
    { key: 'admissions', label: t('compare.admissions'), values: value((s) => (admissionText(s) ? (s.admissions_open ? t('compare.open') : t('compare.closed')) : t('compare.notKnown'))) },
    { key: 'google', label: t('compare.google'), values: value((s) => (s.google_rating ? Number(s.google_rating).toFixed(1) : t('compare.notKnown'))) },
    { key: 'parents', label: t('compare.parents'), values: value((s) => (s.community?.review_count ? Number(s.community.avg_rating).toFixed(1) : t('compare.notKnown'))) },
    { key: 'start', label: t('compare.start'), values: value((s) => (s.start_time ? String(s.start_time).slice(0, 5) : t('compare.notKnown'))) },
  ];
}

// ---- notifications on the phone ---------------------------------------------------------------------------------------
// `notifications` is expo-notifications (or a stand-in in tests). Returns what happened, so the settings screen can say.
async function registerForPush(notifications, db, platform = 'android', projectId = null) {
  try {
    if (!notifications?.getPermissionsAsync) return { ok: false, reason: 'unavailable' };
    const current = await notifications.getPermissionsAsync();
    let granted = current?.granted || current?.status === 'granted';
    if (!granted) {
      const asked = await notifications.requestPermissionsAsync();
      granted = asked?.granted || asked?.status === 'granted';
    }
    if (!granted) return { ok: false, reason: 'denied' };
    const token = await notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const value = token?.data ?? '';
    if (!/^Expo(nent)?PushToken\[/.test(value)) return { ok: false, reason: 'no_token' };
    const { error } = await db.rpc('register_push_device', { p_token: value, p_platform: platform });
    if (error) return { ok: false, reason: 'not_saved' };
    return { ok: true, token: value };
  } catch (_e) {
    return { ok: false, reason: 'unavailable' };
  }
}

async function forgetPush(notifications, db, platform = 'android', projectId = null) {
  try {
    const token = await notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    if (token?.data) await db.rpc('unregister_push_device', { p_token: token.data });
  } catch { /* nothing to forget */ }
}

async function loadNotifications(db) {
  const { data, error } = await db.from('notifications').select('id,kind,school_id,ticket_id,application_id,status,created_at,read_at')
    .order('created_at', { ascending: false }).limit(50);
  return { rows: data ?? [], error: error ?? null };
}
const markNotificationsRead = async (db) => { const { error } = await db.rpc('mark_notifications_read', { p_ids: null }); return { error: error ?? null }; };

// ---- each person's own settings ---------------------------------------------------------------------------------------
// The two letters on the profile button. A person who has not given a name yet still gets something to press.
function initialsOf(profile) {
  const first = String(profile?.first_name ?? '').trim();
  const last = String(profile?.last_name ?? '').trim();
  const letters = (first.slice(0, 1) + last.slice(0, 1)).trim();
  return letters ? letters.toUpperCase() : '··';
}

// Where the back button, and Android's own back gesture, should go from each screen. Every screen leads somewhere;
// the list is the only place with nowhere further back, and there the phone's back button leaves the app as usual.
const BACK_FROM = {
  school: 'discover',
  compare: 'discover',
  apply: 'school',
  enquiries: 'discover',
  applications: 'discover',
  settings: 'discover',
  language: 'settings',
};
const backTargetFor = (screen) => BACK_FROM[screen] ?? null;

async function loadSettings(db, userId) {
  const { data, error } = await db.from('profiles').select('language,notify_push,first_name,last_name,email,gender,avatar').eq('id', userId).maybeSingle();
  return { settings: data ?? null, error: error ?? null };
}
// These run the moment they are called: a query that is only built and never waited for is never sent.
async function saveLanguage(db, userId, language) {
  const { error } = await db.from('profiles').update({ language }).eq('id', userId);
  return { error: error ?? null };
}
async function savePushChoice(db, userId, on) {
  const { error } = await db.from('profiles').update({ notify_push: !!on }).eq('id', userId);
  return { error: error ?? null };
}

// Deleting the account: the app asks the person to type their password again first, so a phone left unlocked on a
// table cannot wipe someone's account.
async function deleteAccount(db, email, password) {
  const again = await db.auth.signInWithPassword({ email, password });
  if (again.error) return { error: { message: t('settings.wrongPassword') } };
  let res;
  try {
    res = await db.functions.invoke('delete-account', { body: {} });
  } catch (_e) {
    return { error: { message: t('error.network') } };
  }
  const data = res?.data;
  if (res?.error || !data?.ok) {
    if (data?.code === 'reauth') return { error: { message: t('settings.signInAgain') } };
    if (data?.code === 'not_configured') return { error: { message: t('settings.deleteNotReady') } };
    return { error: { message: t('error.general') } };
  }
  return { error: null };
}

// ---- unlocking with a fingerprint ---------------------------------------------------------------------------------------
// `auth` is expo-local-authentication (or a stand-in in tests).
async function biometricKind(auth) {
  try {
    if (!auth?.hasHardwareAsync) return 'none';
    const [hardware, enrolled, types] = await Promise.all([
      auth.hasHardwareAsync(), auth.isEnrolledAsync(), auth.supportedAuthenticationTypesAsync?.() ?? Promise.resolve([]),
    ]);
    if (!hardware || !enrolled) return 'none';
    const list = types ?? [];
    if (list.includes(auth.AuthenticationType?.FACIAL_RECOGNITION)) return 'face';
    if (list.includes(auth.AuthenticationType?.IRIS)) return 'iris';
    return 'fingerprint';
  } catch {
    return 'none';
  }
}

async function unlockWithBiometrics(auth, promptMessage) {
  try {
    const res = await auth.authenticateAsync({ promptMessage, disableDeviceFallback: false, cancelLabel: t('lock.usePassword') });
    return { ok: !!res?.success, error: res?.error ?? null };
  } catch (e) {
    return { ok: false, error: e?.message ?? 'failed' };
  }
}

const BIOMETRIC_SETTING = 'kidscover.unlockWithBiometrics';
const LANGUAGE_SETTING = 'kidscover.language';
// Remembers that this person chose to use their location, so the app can pick it up by itself next time instead of
// making them press "Use my location" on every visit. It records the choice, never the place.
const LOCATION_SETTING = 'kidscover.useMyLocation';
// How long the app may sit in the background before it asks for the fingerprint again.
const LOCK_AFTER_MS = 2 * 60 * 1000;

const shouldLock = (enabled, leftAt, now = Date.now(), after = LOCK_AFTER_MS) => !!enabled && !!leftAt && now - leftAt >= after;

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

// A drawn school, in colours of its own: shown when a school has no photo.
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

// The six parents, drawn rather than photographed. Nobody uploads a face, so nobody's face is ours to lose. They
// differ by hair, skin and clothes only; none of them is labelled as a woman or a man, because a picture should not
// have to be. What a person chose as their own description picks the first one shown, and they can change it.
const AVATAR_LOOKS = {
  parent_one:   { skin: '#8D5524', hair: '#2B1B12', clothes: C.coral, back: C.coralSoft, bun: true },
  parent_two:   { skin: '#C68642', hair: '#1F1B3A', clothes: C.blue, back: C.blueSoft, bun: false },
  parent_three: { skin: '#F1C27D', hair: '#6D4C2F', clothes: C.mint, back: C.mintSoft, bun: true },
  parent_four:  { skin: '#5C3A21', hair: '#111111', clothes: C.sun, back: C.sunSoft, bun: false },
  parent_five:  { skin: '#E0AC69', hair: '#8A6A4A', clothes: C.mint, back: C.blueSoft, bun: false },
  parent_six:   { skin: '#A9744F', hair: '#3B2A1A', clothes: C.blue, back: C.sunSoft, bun: true },
};
function ParentAvatar({ look = 'parent_five', size = 44, testID }) {
  const a = AVATAR_LOOKS[look] ?? AVATAR_LOOKS.parent_five;
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" testID={testID}>
      <Circle cx="24" cy="24" r="24" fill={a.back} />
      {/* shoulders */}
      <Path d="M8 48c0-9 7.2-14 16-14s16 5 16 14z" fill={a.clothes} />
      {/* head */}
      <Circle cx="24" cy="20" r="10" fill={a.skin} />
      {/* hair: a fringe for everyone, and a bun for some */}
      <Path d="M14 18c0-6.1 4.5-10 10-10s10 3.9 10 10c0-3.2-3.2-4.6-10-4.6S14 14.8 14 18z" fill={a.hair} />
      {a.bun && <Circle cx="24" cy="7.5" r="4" fill={a.hair} />}
      {/* eyes and a small smile, so it reads as a person rather than a shape */}
      <Circle cx="20.4" cy="20.5" r="1.25" fill={C.ink} />
      <Circle cx="27.6" cy="20.5" r="1.25" fill={C.ink} />
      <Path d="M20.8 24.4c1.6 1.7 4.8 1.7 6.4 0" stroke={C.ink} strokeWidth="1.2" strokeLinecap="round" fill="none" />
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
        accessibilityLabel={t('photo.of', { name: cleanName(school.name) })} style={{ width: '100%', height, backgroundColor: C.blueSoft }} />
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

const Field = ({ label, hint, children }) => (
  <View style={{ marginBottom: 6 }}>
    <Text style={s.label}>{label}</Text>
    {children}
    {!!hint && <Text style={s.muted}>{hint}</Text>}
  </View>
);

// ---------------------------------------------------------------------------------------------- language
function LanguageScreen({ current, onPick, onClose }) {
  return (
    <ScrollView testID="language-screen" contentContainerStyle={{ padding: 16 }}>
      <Btn testID="language-back" kind="quiet" label={t('back')} onPress={onClose} />
      <Text style={s.title}>{t('settings.language')}</Text>
      <Text style={s.muted}>{t('settings.languageHelp')}</Text>
      {LANGUAGES.map((l) => (
        <Pressable key={l.code} testID={`language-${l.code}`} accessibilityRole="button" onPress={() => onPick(l.code)}
          style={[s.card, current === l.code && { borderColor: C.blue, backgroundColor: C.blueSoft }]}>
          <Text style={s.schoolName}>{l.endonym}</Text>
          <Text style={s.muted}>{l.name}{l.rtl ? ' \u00b7 right to left' : ''}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------------------------- sign in / sign up
function AuthScreen({ language, onPickLanguage }) {
  const [mode, setMode] = useState('signin');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [gender, setGender] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function submit() {
    setError('');
    setInfo('');
    const problem = validateAuth({ mode, first, last, email, password, gender });
    if (problem) { setError(problem); return; }
    setBusy(true);
    if (mode === 'signin') {
      const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (e) setError(friendlyError(e));
    } else {
      const { data, error: e } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { first_name: first.trim(), last_name: last.trim(), language, gender } },
      });
      if (e) setError(friendlyError(e));
      else if (!data?.session) {
        setInfo(t('auth.checkEmail'));
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
      <Text style={s.tagline}>{t('auth.tagline')}</Text>
      <View style={{ alignItems: 'center' }}>
        <Btn testID="auth-language" kind="quiet" label={`\ud83c\udf10 ${languageName(language)}`} onPress={onPickLanguage} />
      </View>
      <View style={[s.card, s.authCard]}>
        <Text style={s.h2}>{mode === 'signin' ? t('auth.signIn') : t('auth.createAccount')}</Text>
        {mode === 'signup' && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput testID="first-name" style={[s.input, { flex: 1 }]} placeholder={t('auth.firstName')} value={first} onChangeText={setFirst} />
            <TextInput testID="last-name" style={[s.input, { flex: 1 }]} placeholder={t('auth.lastName')} value={last} onChangeText={setLast} />
          </View>
        )}
        {mode === 'signup' && (<>
          <Text style={s.label}>{t('profile.gender')}</Text>
          <View style={s.wrap}>
            {PROFILE_GENDERS.map((g) => (
              <Chip key={g} testID={`signup-gender-${g}`} label={t(`profile.gender.${g}`)} selected={gender === g} onPress={() => setGender(g)} />
            ))}
          </View>
        </>)}
        <TextInput testID="email" style={s.input} placeholder={t('auth.email')} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
        <TextInput testID="password" style={s.input} placeholder={t('auth.password')} secureTextEntry value={password} onChangeText={setPassword} />
        {!!error && <Notice text={error} testID="auth-error" />}
        {!!info && <Notice tone="green" text={info} testID="auth-info" />}
        <Btn testID="auth-submit" label={busy ? t('pleaseWait') : mode === 'signin' ? t('auth.signIn') : t('auth.createAccount')} onPress={submit} disabled={busy} />
        <Btn testID="auth-switch" kind="quiet" label={mode === 'signin' ? t('auth.newHere') : t('auth.haveAccount')}
          onPress={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setInfo(''); }} />
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------------------------- the lock screen
function LockScreen({ kind, onUnlock, onSignOut, busy, error }) {
  return (
    <View style={[s.root, s.center]} testID="lock-screen">
      <LogoMark size={44} />
      <Text style={[s.title, { textAlign: 'center' }]}>{t('lock.title')}</Text>
      <Text style={[s.body, { textAlign: 'center', marginBottom: 12 }]}>
        {kind === 'face' ? t('lock.face') : kind === 'iris' ? t('lock.iris') : t('lock.fingerprint')}
      </Text>
      {!!error && <Notice text={error} testID="lock-error" />}
      <Btn testID="lock-unlock" label={busy ? t('pleaseWait') : t('lock.unlock')} onPress={onUnlock} disabled={busy} />
      <Btn testID="lock-signout" kind="quiet" label={t('lock.usePassword')} onPress={onSignOut} />
    </View>
  );
}

// ---------------------------------------------------------------------------------------------- discover
function Tiles({ tiles, onOpenAdmissions }) {
  if (!tiles) return null;
  return (
    <View style={s.tileRow} testID="tiles">
      <View style={[s.tile, { backgroundColor: C.blueSoft }]}>
        <Text testID="tile-schools" style={[s.tileNumber, { color: C.blue }]}>{tiles.schools ?? 0}</Text>
        <Text style={s.tileLabel}>{t('tiles.schools')}</Text>
      </View>
      <Pressable testID="tile-open" accessibilityRole="button" onPress={onOpenAdmissions} style={[s.tile, { backgroundColor: C.greenSoft }]}>
        <Text style={[s.tileNumber, { color: C.green }]}>{tiles.admissions_open ?? 0}</Text>
        <Text style={s.tileLabel}>{t('tiles.open')}</Text>
      </Pressable>
      <View style={[s.tile, { backgroundColor: C.sunSoft }]}>
        <Text testID="tile-fees" style={[s.tileNumber, { color: C.amber }]}>{tiles.with_fees ?? 0}</Text>
        <Text style={s.tileLabel}>{t('tiles.withFees')}</Text>
      </View>
    </View>
  );
}

function SchoolCard({ school, drive, level, comparing, onPress, onCompare }) {
  const community = communityText(school.community);
  const distance = distanceText(school.distance_km);
  const address = cleanAddress(school.address);
  const driving = driveTimeText(drive);
  const fee = feeSummaryText(school, level);
  return (
    <View style={[s.card, { gap: 6 }]}>
      <Pressable testID={`school-${school.id}`} accessibilityRole="button" onPress={onPress} style={s.cardRow}>
      <View style={s.thumb}><SchoolPicture school={school} height={78} compact testID={`thumb-${school.id}`} /></View>
      <View style={{ flex: 1, gap: 5 }}>
        <Text style={s.schoolName}>{cleanName(school.name)}</Text>
        {!!distance && <Text testID={`distance-${school.id}`} style={s.distance}>{distance}</Text>}
        {!!driving && <Text testID={`drivetime-${school.id}`} style={s.distance}>{driving}</Text>}
        {!!leaveByText(drive) && <Text testID={`leaveby-${school.id}`} style={s.distance}>{leaveByText(drive)}</Text>}
        {!!fee && <Text testID={`fee-${school.id}`} style={[s.rating, { color: C.amber }]}>{fee}</Text>}
        {!!address && <Text style={s.muted} numberOfLines={2}>{address}</Text>}
        <View style={s.badgeRow}>
          {isSchoolPlace(school) && levelBadges(school.levels).map((b) => <Text key={b} style={s.badge}>{b}</Text>)}
          {!!school.board && <Text style={[s.badge, { backgroundColor: C.greenSoft, color: C.green }]}>{school.board}</Text>}
          {!!admissionText(school) && school.admissions_open && <Text testID={`open-${school.id}`} style={[s.badge, { backgroundColor: C.amberSoft, color: C.amber }]}>{t('admissions.badge', { year: school.admissions_year ?? '' })}</Text>}
        </View>
        <Text style={s.rating}>{googleRatingText(school.google_rating, school.google_review_count)}</Text>
        {!!community && <Text style={[s.rating, { color: C.green }]}>{community}</Text>}
      </View>
      </Pressable>
      {/* outside the card's own tap area, so choosing "compare" never opens the school by mistake */}
      {isSchoolPlace(school) && (
        <Pressable testID={`compare-${school.id}`} accessibilityRole="button" accessibilityState={{ selected: comparing }} onPress={onCompare} style={{ alignSelf: 'flex-start' }}>
          <Text style={[s.compareTag, comparing && { backgroundColor: C.blue, color: '#fff' }]}>{comparing ? t('compare.added') : t('compare.add')}</Text>
        </Pressable>
      )}
    </View>
  );
}

// Where the school list is measured from: the phone's own position, or one of the places the parent saved. Nothing
// is shown until there is a saved place, because a single choice is not a choice.
function AddressPicker({ rows, here, from, onPick, onHere, busy }) {
  if (!rows?.length) return null;
  return (
    <View testID="address-chips">
      <Text style={s.label}>{t('address.searchFrom')}</Text>
      <View style={s.wrap}>
        <Chip testID="address-here" label={busy ? t('location.finding') : t('address.here')} selected={here} onPress={onHere} />
        {rows.map((row) => (
          <Chip key={row.id} testID={`address-${row.id}`} label={row.label} selected={from === row.label} onPress={() => onPick(row)} />
        ))}
      </View>
    </View>
  );
}

// The address book itself, in the profile: what is saved, renamed and removed. Places are added where they are, from
// the school list, because that is the only place the app learns coordinates from.
function AddressBook({ rows, available, onChanged }) {
  const [editing, setEditing] = useState(null);
  const [label, setLabel] = useState('');
  const [text, setText] = useState('');
  const [problem, setProblem] = useState('');
  const [done, setDone] = useState('');
  const [saving, setSaving] = useState(false);
  // which place is being removed, if any: pressing remove on one place must not grey out the others
  const [removing, setRemoving] = useState('');
  const list = rows ?? [];

  function startEdit(row) {
    setEditing(row);
    setLabel(row.label ?? '');
    setText(row.address ?? '');
    setProblem('');
    setDone('');
  }

  async function save() {
    const bad = validateAddress({ label, rows: list, editingId: editing?.id });
    if (bad) { setProblem(bad); return; }
    setSaving(true);
    const res = await saveAddress(supabase, null, { id: editing.id, label, address: text });
    setSaving(false);
    if (res.error) { setProblem(friendlyError(res.error)); return; }
    setEditing(null);
    setProblem('');
    setDone(t('address.saved'));
    onChanged?.();
  }

  async function remove(row) {
    setProblem('');
    setDone('');
    setRemoving(row.id);
    const res = await deleteAddress(supabase, row.id);
    setRemoving('');
    if (res.error) { setProblem(friendlyError(res.error)); return; }
    if (editing?.id === row.id) setEditing(null);
    setDone(t('address.removed'));
    onChanged?.();
  }

  return (
    <View style={s.card} testID="address-book">
      <Text style={s.h2}>{t('address.title')}</Text>
      <Text style={s.muted}>{t('address.help')}</Text>
      {!available && <Notice tone="amber" text={t('address.off')} testID="address-book-off" />}
      {available && list.length === 0 && <Text style={s.body} testID="address-book-empty">{t('address.none')}</Text>}
      {list.map((row) => (
        <View key={row.id} testID={`book-${row.id}`} style={s.addressRow}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={s.body}>{row.label}</Text>
            {!!row.address && <Text style={s.muted}>{row.address}</Text>}
          </View>
          <Btn testID={`book-edit-${row.id}`} kind="quiet" label={t('address.rename')} onPress={() => startEdit(row)} />
          <Btn testID={`book-remove-${row.id}`} kind="quiet" label={t('address.remove')} onPress={() => remove(row)} disabled={removing === row.id} />
        </View>
      ))}
      {!!editing && (
        <View testID="book-form" style={{ gap: 6, paddingTop: 4 }}>
          <Text style={s.label}>{t('address.name')}</Text>
          <TextInput testID="book-label" style={s.input} placeholder={t('address.nameHint')} value={label}
            onChangeText={(v) => { setLabel(v); setProblem(''); }} maxLength={MAX_ADDRESS_NAME} />
          <TextInput testID="book-text" style={s.input} placeholder={t('address.text')} value={text}
            onChangeText={setText} maxLength={MAX_ADDRESS_TEXT} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Btn testID="book-save" label={saving ? t('saving') : t('saveChanges')} onPress={save} disabled={saving} />
            <Btn testID="book-cancel" kind="quiet" label={t('cancel')} onPress={() => { setEditing(null); setProblem(''); }} />
          </View>
        </View>
      )}
      {!!problem && <Notice text={problem} testID="address-book-problem" />}
      {!!done && <Notice tone="green" text={done} testID="address-book-done" />}
    </View>
  );
}

function DiscoverScreen({ onOpen, compare, onToggleCompare, onOpenCompare, addresses, onSavedAddress, userId }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showNear, setShowNear] = useState(true);
  const [rows, setRows] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [place, setPlace] = useState(null);
  // which saved place the list is searching from. Empty means the phone's own position.
  const [placeName, setPlaceName] = useState('');
  const [savingPlace, setSavingPlace] = useState(false);
  const [placeLabel, setPlaceLabel] = useState('');
  const [placeText, setPlaceText] = useState('');
  const [placeProblem, setPlaceProblem] = useState('');
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState(null);
  const [driveMode, setDriveMode] = useState(null);
  const [driveTimes, setDriveTimes] = useState({});
  const [driveNote, setDriveNote] = useState(null);
  const [tiles, setTiles] = useState(null);
  const drivePending = useRef(new Set());
  const latest = useRef(0);
  const pageRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed), 350);
    return () => clearTimeout(timer);
  }, [typed]);

  const key = JSON.stringify({ ...filters, search, place });
  const run = useCallback(async (page, append) => {
    const id = ++latest.current;
    const { place: where, ...f } = JSON.parse(key);
    setLoading(true);
    setError('');
    const res = await loadSchools(supabase, f, page, where);
    if (id !== latest.current) return;
    if (res.error && where && isMissingNearby(res.error)) {
      setPlace(null);
      setFilters((cur) => normalizeFilters(cur, false));
      setLocationNote({ tone: 'amber', text: t('error.nearbyOff') });
    } else if (res.error) setError(friendlyError(res.error));
    else {
      pageRef.current = page;
      setRows((prev) => (append ? [...prev, ...res.rows] : res.rows));
      setHasMore(res.hasMore);
    }
    setLoading(false);
  }, [key]);

  useEffect(() => { run(0, false); }, [run]);

  // the tile counts follow the place and the distance the parent chose
  useEffect(() => {
    let alive = true;
    loadTiles(supabase, place, filters.nearKm).then((res) => { if (alive && !res.error) setTiles(res.tiles); });
    return () => { alive = false; };
  }, [place, filters.nearKm]);

  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));
  const cat = categoryOf(filters.category);
  const hasPlace = !!place;
  const count = activeFilterCount(filters, hasPlace);

  // `quiet` is the app picking the location up by itself on opening, because this person asked for that last time.
  // It says nothing when it cannot: they did not press anything, so a complaint would come out of nowhere.
  async function useMyLocation(quiet = false) {
    if (!quiet) setLocating(true);
    setLocationNote(null);
    const res = await locateMe(Location);
    setLocating(false);
    if (!res.ok) {
      if (!quiet) setLocationNote({ tone: 'amber', text: locationProblemText(res.reason) });
      if (res.reason === 'blocked' || res.reason === 'denied') AsyncStorage.removeItem(LOCATION_SETTING).catch(() => {});
      return;
    }
    AsyncStorage.setItem(LOCATION_SETTING, '1').catch(() => {});
    setPlace(res.place);
    setPlaceName('');
    set({ sort: 'distance' });
    if (!inServiceArea(res.place)) setLocationNote({ tone: 'amber', text: t('location.outsideArea') });
    // the phone may be able to say what is at this position; if it can, it saves the parent typing it
    addressHere(Location, res.place).then((text) => { if (text) setPlaceText((old) => old || text); });
  }

  // Searching from a place saved earlier. No permission is needed and the phone is not asked anything: the
  // coordinates were saved once, at the place itself.
  function searchFromAddress(row) {
    const where = addressPlace(row);
    if (!where) return;
    setLocationNote(null);
    setDriveNote(null);
    setPlace(where);
    setPlaceName(row.label);
    setSavingPlace(false);
    set({ sort: 'distance' });
    if (!inServiceArea(where)) setLocationNote({ tone: 'amber', text: t('location.outsideArea') });
  }

  async function saveThisPlace() {
    const problem = validateAddress({ label: placeLabel, rows: addresses ?? [] });
    if (problem) { setPlaceProblem(problem); return; }
    setPlaceProblem('');
    const res = await saveAddress(supabase, userId, { label: placeLabel, address: placeText, place });
    if (res.error) { setPlaceProblem(friendlyError(res.error)); return; }
    setPlaceName(placeLabel.trim());
    setPlaceLabel('');
    setPlaceText('');
    setSavingPlace(false);
    setLocationNote({ tone: 'green', text: t('address.saved') });
    onSavedAddress?.();
  }

  // Asked for once, on opening. If they chose to use their location before and the phone still allows it, it is
  // picked up without being asked again; if they turned it off, or the phone now refuses, nothing happens.
  const askedOnce = useRef(false);
  useEffect(() => {
    if (askedOnce.current) return;
    askedOnce.current = true;
    AsyncStorage.getItem(LOCATION_SETTING).then((saved) => { if (saved === '1') useMyLocation(true); }).catch(() => {});
  }, []);

  function stopUsingLocation() {
    AsyncStorage.removeItem(LOCATION_SETTING).catch(() => {});
    setPlace(null);
    setPlaceName('');
    setSavingPlace(false);
    setPlaceProblem('');
    setLocationNote(null);
    setDriveMode(null);
    setDriveNote(null);
    setFilters((f) => normalizeFilters(f, false));
  }

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
        setDriveMode(null);
        setDriveNote({ tone: 'amber', text: driveProblemText(res.code, res.limit) });
        return;
      }
      setDriveTimes((cur) => {
        const next = { ...cur };
        ids.forEach((id) => { next[driveKey(where, mode, id)] = res.times[id] ?? null; });
        return next;
      });
      if (typeof res.lookupsLeft === 'number' && res.lookupsLeft <= 3) {
        setDriveNote({ tone: 'amber', text: t(res.lookupsLeft === 1 ? 'drive.lookupsLeftOne' : 'drive.lookupsLeft', { count: res.lookupsLeft }) });
      }
    });
  }, [rows, place, driveMode, driveTimes]);

  const driveFor = (item) => (place && driveMode ? driveTimes[driveKey(place, driveMode, item.id)] : undefined);
  const comparingIds = compare.map((x) => x.id);

  const header = (
    <View>
      <View style={s.hero} testID="discover-hero">
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={s.heroTitle}>{t(`hero.${cat.key}.title`)}</Text>
          <Text style={s.heroText}>{t(`hero.${cat.key}.text`)}</Text>
        </View>
        <View style={s.heroArt}><SchoolArt seed={cat.key} height={78} compact /></View>
      </View>
      {cat.key === 'school' && <Tiles tiles={tiles} onOpenAdmissions={() => set({ admissionsOpen: !filters.admissionsOpen })} />}
      <View style={s.wrap}>
        {CATEGORY_CHOICES.map((c) => <Chip key={c.key} testID={`category-${c.key}`} label={`${CATEGORY_ICONS[c.key]} ${t(c.label)}`} selected={cat.key === c.key} onPress={() => set({ category: c.key })} />)}
      </View>
      <TextInput testID="search" style={s.search} placeholder={cat.key === 'school' ? t('search.schools') : t('search.other', { what: t(cat.noun) })} value={typed} onChangeText={setTyped} autoCorrect={false} />
      {hasPlace ? (
        <View style={[s.card, { marginBottom: 8 }]} testID="near-me-on">
          {/* The title row folds the rest away. Once the distance and the drive time are set there is no reason for
              this to keep taking up the top of the screen, but it still has to be easy to open again. */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Pressable testID="near-me-fold" accessibilityRole="button" accessibilityLabel={t('location.on')}
              onPress={() => setShowNear((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
              <Text style={s.body}>{showNear ? '▾' : '▸'}</Text>
              <Text style={[s.body, { flexShrink: 1 }]} testID="near-me-title">{placeName ? t('address.from', { label: placeName }) : t('location.on')}</Text>
            </Pressable>
            <Btn testID="stop-location" kind="quiet" label={t('location.turnOff')} onPress={stopUsingLocation} />
          </View>
          {showNear && (<>
            <AddressPicker rows={addresses} here={!placeName} from={placeName}
              onPick={searchFromAddress} onHere={() => useMyLocation()} busy={locating} />
            {/* Only a position the phone just gave can be saved: a place already in the book has nothing to add,
                and a parent standing somewhere else would be saving the wrong spot. */}
            {!placeName && Array.isArray(addresses) && (savingPlace ? (
              <View testID="address-form" style={{ gap: 6, paddingTop: 4 }}>
                <Text style={s.label}>{t('address.name')}</Text>
                <TextInput testID="address-label" style={s.input} placeholder={t('address.nameHint')} value={placeLabel}
                  onChangeText={(v) => { setPlaceLabel(v); setPlaceProblem(''); }} maxLength={MAX_ADDRESS_NAME} />
                <TextInput testID="address-text" style={s.input} placeholder={t('address.text')} value={placeText}
                  onChangeText={setPlaceText} maxLength={MAX_ADDRESS_TEXT} />
                {!!placeProblem && <Notice text={placeProblem} testID="address-problem" />}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Btn testID="address-save" label={t('address.save')} onPress={saveThisPlace} />
                  <Btn testID="address-cancel" kind="quiet" label={t('cancel')} onPress={() => { setSavingPlace(false); setPlaceProblem(''); }} />
                </View>
              </View>
            ) : (
              <Btn testID="address-add" kind="outline" label={t('address.saveHere')} onPress={() => setSavingPlace(true)} />
            ))}
            <View style={s.wrap}>
              {DISTANCE_CHOICES.map((d) => <Chip key={String(d.km)} testID={`near-${d.km ?? 'any'}`} label={t(d.label)} selected={filters.nearKm === d.km} onPress={() => set({ nearKm: d.km })} />)}
            </View>
            <Text style={s.muted}>{t('location.straightLine')}</Text>
            <Text style={s.label}>{t('drive.title')}</Text>
            <View style={s.wrap}>
              {DRIVE_MODES.map((m) => (
                <Chip key={m.key} testID={`drive-mode-${m.key}`} label={t(m.label)} selected={driveMode === m.key}
                  onPress={() => { setDriveNote(null); setDriveMode(driveMode === m.key ? null : m.key); }} />
              ))}
            </View>
            <Text style={s.muted}>{t('drive.note')}</Text>
          </>)}
          {!!driveNote && <Notice tone={driveNote.tone} text={driveNote.text} testID="drive-note" />}
        </View>
      ) : (
        <View style={[s.card, { marginBottom: 8 }]} testID="near-me-off">
          <Btn testID="use-location" kind="outline" label={locating ? t('location.finding') : t('location.use')} onPress={() => useMyLocation()} disabled={locating} />
          <Text style={s.muted}>{t('location.why')}</Text>
          {/* A place saved earlier needs no permission and no waiting, so it is offered here as well. */}
          {!!addresses?.length && (<>
            <Text style={s.label}>{t('address.orFrom')}</Text>
            <View style={s.wrap} testID="address-chips-off">
              {addresses.map((row) => (
                <Chip key={row.id} testID={`address-off-${row.id}`} label={row.label} selected={false} onPress={() => searchFromAddress(row)} />
              ))}
            </View>
          </>)}
        </View>
      )}
      {!!locationNote && <Notice tone={locationNote.tone} text={locationNote.text} testID="location-note" />}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Btn testID="toggle-filters" kind="outline" label={showFilters ? t('filters.hide') : count ? t('filters.showCount', { count }) : t('filters.show')} onPress={() => setShowFilters((v) => !v)} />
        {count > 0 && <Btn testID="clear-filters" kind="quiet" label={t('filters.clear')} onPress={() => setFilters({ ...DEFAULT_FILTERS, category: cat.key, sort: defaultSort(hasPlace) })} />}
      </View>
      {showFilters && (
        <View style={[s.card, { marginBottom: 12 }]}>
          {cat.key === 'school' && (<>
            <Text style={s.label}>{t('filters.level')}</Text>
            <View style={s.wrap}>
              {LEVEL_CHOICES.map((l) => <Chip key={l.key} testID={`level-${l.key}`} label={t(l.label)} selected={filters.level === l.key} onPress={() => set({ level: filters.level === l.key ? null : l.key })} />)}
            </View>
            <View style={s.switchRow}>
              <Text style={s.body}>{t('filters.daycare')}</Text>
              <Switch testID="daycare" value={filters.daycare} onValueChange={(v) => set({ daycare: v })} />
            </View>
            <Text style={s.label}>{t('filters.board')}</Text>
            <View style={s.wrap}>
              {BOARD_CHOICES.map((b) => <Chip key={b} testID={`board-${b}`} label={b} selected={filters.board === b} onPress={() => set({ board: filters.board === b ? null : b })} />)}
            </View>
            {!!filters.board && (
              <View style={s.switchRow}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={s.body}>{t('filters.unknownBoard')}</Text>
                  <Text style={s.muted}>{t('filters.unknownBoardHelp')}</Text>
                </View>
                <Switch testID="include-unknown-board" value={filters.includeUnknownBoard} onValueChange={(v) => set({ includeUnknownBoard: v })} />
              </View>
            )}
            <Text style={s.label}>{t('filters.cost')}</Text>
            <Text style={s.muted}>{t('filters.costHelp')}</Text>
            <View style={s.wrap}>
              {BUDGET_CHOICES.map((b) => <Chip key={String(b)} testID={`budget-${b ?? 'any'}`} label={budgetLabel(b)} selected={filters.maxFee === b} onPress={() => set({ maxFee: b })} />)}
            </View>
            {!!filters.maxFee && (
              <View style={s.switchRow}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={s.body}>{t('filters.unknownFees')}</Text>
                  <Text style={s.muted}>{t('filters.unknownFeesHelp')}</Text>
                </View>
                <Switch testID="include-unknown-fees" value={filters.includeUnknownFees} onValueChange={(v) => set({ includeUnknownFees: v })} />
              </View>
            )}
            <View style={s.switchRow}>
              <Text style={s.body}>{t('filters.admissionsOpen')}</Text>
              <Switch testID="admissions-open" value={filters.admissionsOpen} onValueChange={(v) => set({ admissionsOpen: v })} />
            </View>
          </>)}
          <Text style={s.label}>{t('filters.rating')}</Text>
          <View style={s.wrap}>
            {RATING_CHOICES.map((r) => <Chip key={r.value} testID={`rating-${r.value}`} label={t(r.label)} selected={filters.minRating === r.value} onPress={() => set({ minRating: r.value })} />)}
          </View>
          <View style={s.switchRow}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={s.body}>{t('filters.unrated')}</Text>
              <Text style={s.muted}>{t('filters.unratedHelp')}</Text>
            </View>
            <Switch testID="include-unrated" value={filters.includeUnrated} onValueChange={(v) => set({ includeUnrated: v })} />
          </View>
          <Text style={s.label}>{t('filters.sort')}</Text>
          <View style={s.wrap}>
            {hasPlace && <Chip testID="sort-distance" label={t('sort.nearest')} selected={filters.sort === 'distance'} onPress={() => set({ sort: 'distance' })} />}
            <Chip testID="sort-name" label={t('sort.name')} selected={filters.sort === 'name'} onPress={() => set({ sort: 'name' })} />
            <Chip testID="sort-rating" label={t('sort.rating')} selected={filters.sort === 'rating'} onPress={() => set({ sort: 'rating' })} />
            {cat.key === 'school' && <Chip testID="sort-cost" label={t('sort.cost')} selected={filters.sort === 'cost'} onPress={() => set({ sort: 'cost' })} />}
          </View>
        </View>
      )}
      {!!error && <Notice text={error} testID="discover-error" />}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <ScrollView testID="discover-list" contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        {header}
        {rows.map((item) => (
          <SchoolCard key={item.id} school={item} drive={driveFor(item)} level={filters.level} comparing={comparingIds.includes(item.id)}
            onCompare={() => onToggleCompare({ ...item, drive: driveFor(item) })}
            onPress={() => onOpen(driveFor(item) ? { ...item, drive: driveFor(item), driveMode } : item)} />
        ))}
        {!loading && !error && rows.length === 0 && (
          <Text testID="empty" style={s.empty}>
            {hasPlace && filters.nearKm ? t('empty.within', { what: t(cat.noun), km: filters.nearKm }) : t('empty.any', { what: t(cat.noun) })}
          </Text>
        )}
        <View style={{ paddingVertical: 12 }}>
          {loading && <ActivityIndicator testID="loading" />}
          {!loading && !!error && <Btn testID="retry" label={t('tryAgain')} onPress={() => run(0, false)} />}
          {!loading && hasMore && <Btn testID="more" kind="outline" label={t('showMore', { what: t(cat.noun) })} onPress={() => run(pageRef.current + 1, true)} />}
        </View>
      </ScrollView>
      {/* Outside the list on purpose. It used to be the last thing in the scroll, under every school on screen, so
          after picking two schools there was no way to start the comparison without scrolling to the bottom. */}
      {compare.length > 0 && (
        <View style={s.compareBar} testID="compare-bar">
          <Text style={s.body}>{t('compare.chosen', { count: compare.length, max: MAX_COMPARE })}</Text>
          <Text style={s.muted}>{t('compare.full', { max: MAX_COMPARE })}</Text>
          <Btn testID="open-compare" label={t('compare.open')} onPress={onOpenCompare} disabled={compare.length < 2} />
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------------------------- comparing
function CompareScreen({ schools, level, onBack, onOpen, onRemove }) {
  const rows = compareRows(schools, level);
  return (
    <ScrollView testID="compare-screen" contentContainerStyle={{ padding: 16 }}>
      <Btn testID="compare-back" kind="quiet" label={t('back')} onPress={onBack} />
      <Text style={s.title}>{t('compare.title')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ paddingBottom: 8 }}>
        <View>
          <View style={{ flexDirection: 'row' }}>
            <View style={[s.compareCell, s.compareHead]} />
            {schools.map((school) => (
              <View key={school.id} style={[s.compareCell, s.compareHead]}>
                <Pressable testID={`compare-open-${school.id}`} accessibilityRole="button" onPress={() => onOpen(school)}>
                  <View style={{ height: 60, borderRadius: 10, overflow: 'hidden', marginBottom: 4 }}>
                    <SchoolPicture school={school} height={60} compact testID={`compare-pic-${school.id}`} />
                  </View>
                  <Text style={s.compareName} numberOfLines={2}>{cleanName(school.name)}</Text>
                </Pressable>
                <Pressable testID={`compare-remove-${school.id}`} accessibilityRole="button" onPress={() => onRemove(school)}>
                  <Text style={[s.muted, { color: C.blue }]}>{t('compare.remove')}</Text>
                </Pressable>
              </View>
            ))}
          </View>
          {rows.map((row) => (
            <View key={row.key} style={{ flexDirection: 'row' }} testID={`compare-row-${row.key}`}>
              <View style={[s.compareCell, { backgroundColor: C.bg }]}><Text style={s.label}>{row.label}</Text></View>
              {row.values.map((value, i) => (
                <View key={schools[i].id} style={s.compareCell}><Text style={s.body}>{value}</Text></View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      <Text style={s.muted}>{t('compare.note')}</Text>
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
    else onSaved(initial ? t('review.savedEdit') : t('review.savedNew'));
  }

  return (
    <View style={[s.card, { marginTop: 12 }]}>
      <Text style={s.h2}>{initial ? t('review.edit') : t('review.write')}</Text>
      <Text style={s.label}>{t('review.yourRating')}</Text>
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} testID={`star-${n}`} accessibilityRole="button" onPress={() => setRating(n)}>
            <Text style={{ fontSize: 32, color: n <= rating ? '#F59E0B' : '#D1D5DB' }}>{'\u2605'}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.label}>{t('review.youAre')}</Text>
      <View style={s.wrap}>
        {RELATIONSHIPS.map((r) => <Chip key={r.key} testID={`rel-${r.key}`} label={t(r.label)} selected={relationship === r.key} onPress={() => setRelationship(r.key)} />)}
      </View>
      <TextInput testID="review-title" style={s.input} placeholder={t('review.titlePlaceholder')} value={title} onChangeText={setTitle} maxLength={120} />
      <TextInput testID="review-body" style={[s.input, { minHeight: 110, textAlignVertical: 'top' }]} multiline placeholder={t('review.bodyPlaceholder')} value={body} onChangeText={setBody} />
      <Text style={s.muted}>{t('review.counter', { count: body.trim().length })}</Text>
      {!!error && <Notice text={error} testID="review-error" />}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <Btn testID="review-save" label={busy ? t('saving') : initial ? t('saveChanges') : t('review.submit')} onPress={save} disabled={busy} />
        <Btn testID="review-cancel" kind="quiet" label={t('cancel')} onPress={onCancel} />
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
      <Text style={s.h2}>{t('enquiry.title')}</Text>
      <Text style={s.muted}>{t('enquiry.intro', { school: cleanName(schoolName) })}</Text>
      <Text style={s.label}>{t('enquiry.whichClass')}</Text>
      <View style={s.wrap}>
        {GRADE_CHOICES.map((g) => <Chip key={g} testID={`grade-${EN_GRADES[g]}`} label={t(g)} selected={grade === g} onPress={() => setGrade(grade === g ? '' : g)} />)}
      </View>
      <Text style={s.label}>{t('enquiry.whichYear')}</Text>
      <View style={s.wrap}>
        {startYearChoices().map((y) => <Chip key={y} testID={`year-${y}`} label={String(y)} selected={startYear === y} onPress={() => setStartYear(startYear === y ? null : y)} />)}
      </View>
      <TextInput testID="enquiry-message" style={[s.input, { minHeight: 110, textAlignVertical: 'top' }]} multiline
        placeholder={t('enquiry.placeholder')} value={message} onChangeText={setMessage} />
      <Text style={s.muted}>{`${message.trim().length} / ${MAX_ENQUIRY}`}</Text>
      {!!error && <Notice text={error} testID="enquiry-error" />}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <Btn testID="enquiry-send" label={busy ? t('sending') : t('enquiry.send')} onPress={submit} disabled={busy} />
        <Btn testID="enquiry-cancel" kind="quiet" label={t('cancel')} onPress={onCancel} />
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
    if (text.length < 1) { setError(t('enquiry.writeFirst')); return; }
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
      <Btn testID="conversation-back" kind="quiet" label={t('enquiry.backToList')} onPress={onBack} />
      <Text style={s.title}>{cleanName(thread.school_name ?? t('thisSchool'))}</Text>
      <Text style={s.muted}>{`${enquiryStatusText(thread.status)}${enquiryAbout(thread) ? ` \u00b7 ${enquiryAbout(thread)}` : ''}`}</Text>
      {!!error && <Notice text={error} testID="conversation-error" />}
      {messages === null ? <ActivityIndicator style={{ marginTop: 12 }} /> : messages.map((m) => (
        <View key={m.id} testID={`msg-${m.id}`} style={[s.card, fromMe(m, myId) ? s.mine : s.theirs]}>
          <Text style={s.label}>{messageFrom(m, myId)}</Text>
          <Text style={s.body}>{m.message}</Text>
          <Text style={s.muted}>{monthYear(m.created_at)}</Text>
        </View>
      ))}
      {thread.status === 'closed' ? <Text style={s.muted}>{t('enquiry.closedNote')}</Text> : null}
      <TextInput testID="reply-box" style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]} multiline
        placeholder={t('enquiry.writeMessage')} value={reply} onChangeText={setReply} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn testID="reply-send" label={busy ? t('sending') : t('send')} onPress={send} disabled={busy} />
        {thread.status !== 'closed' && <Btn testID="close-enquiry" kind="quiet" label={t('enquiry.close')} onPress={close} disabled={busy} />}
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

  const open = (rows ?? []).find((x) => x.id === openId);

  return (
    <ScrollView testID="enquiries-screen" contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      {open ? (
        <Conversation thread={open} myId={myId} onBack={() => { setOpenId(null); load(); }} onChanged={load} />
      ) : (
        <>
          <Btn testID="enquiries-back" kind="quiet" label={t('backToSchools')} onPress={onBack} />
          <Text style={s.title}>{t('enquiry.yours')}</Text>
          {!!error && <Notice text={error} testID="enquiries-error" />}
          {rows === null && <ActivityIndicator testID="enquiries-loading" style={{ marginTop: 12 }} />}
          {rows !== null && rows.length === 0 && !error && <Text testID="enquiries-empty" style={s.empty}>{t('enquiry.none')}</Text>}
          {(rows ?? []).map((x) => (
            <Pressable key={x.id} testID={`thread-${x.id}`} accessibilityRole="button" onPress={() => setOpenId(x.id)} style={s.card}>
              <Text style={s.schoolName}>{x.unread_for_parent ? '\u25cf ' : ''}{cleanName(x.school_name ?? t('thisSchool'))}</Text>
              <Text style={s.muted}>{`${enquiryStatusText(x.status)}${enquiryAbout(x) ? ` \u00b7 ${enquiryAbout(x)}` : ''}`}</Text>
              {!!x.last_message && <Text style={s.body} numberOfLines={2}>{x.last_message}</Text>}
            </Pressable>
          ))}
        </>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------------------------- applying
function ApplyScreen({ school, profile, onDone, onCancel }) {
  const [form, setForm] = useState({
    ...EMPTY_APPLICATION,
    academic_year: academicYearChoices()[1],
    parent_name: [profile?.first_name, profile?.last_name].filter(Boolean).join(' '),
    parent_email: profile?.email ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function submit() {
    setBusy(true);
    setError('');
    const res = await submitApplication(supabase, school.id, form);
    setBusy(false);
    if (res.error) { setError(isMissingApplications(res.error) ? t('apply.notOn') : friendlyError(res.error)); return; }
    onDone();
  }

  return (
    <ScrollView testID="apply-screen" contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Btn testID="apply-back" kind="quiet" label={t('back')} onPress={onCancel} />
      <Text style={s.title}>{t('apply.title')}</Text>
      <Text style={s.body}>{t('apply.intro', { school: cleanName(school.name) })}</Text>

      <View style={[s.card, { marginTop: 12 }]}>
        <Text style={s.h2}>{t('apply.aboutChild')}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput testID="apply-child-first" style={[s.input, { flex: 1 }]} placeholder={t('apply.childFirstName')} value={form.child_first_name} onChangeText={(v) => set({ child_first_name: v })} />
          <TextInput testID="apply-child-last" style={[s.input, { flex: 1 }]} placeholder={t('apply.childLastName')} value={form.child_last_name} onChangeText={(v) => set({ child_last_name: v })} />
        </View>
        <Field label={t('apply.dob')} hint={t('apply.dobHint')}>
          <TextInput testID="apply-dob" style={s.input} placeholder="2021-06-30" value={form.child_dob} onChangeText={(v) => set({ child_dob: v.replace(/[^0-9-]/g, '').slice(0, 10) })} />
        </Field>
        <Text style={s.label}>{t('apply.gender')}</Text>
        <View style={s.wrap}>
          {APPLY_GENDERS.map((g) => <Chip key={g} testID={`apply-gender-${g}`} label={t(`gender.${g}`)} selected={form.child_gender === g} onPress={() => set({ child_gender: form.child_gender === g ? '' : g })} />)}
        </View>
        <Text style={s.label}>{t('apply.class')}</Text>
        <View style={s.wrap}>
          {APPLY_CLASSES.map((c) => <Chip key={c} testID={`apply-class-${c}`} label={classLabel(c)} selected={form.class_applying === c} onPress={() => set({ class_applying: c })} />)}
        </View>
        <Text style={s.label}>{t('apply.year')}</Text>
        <View style={s.wrap}>
          {academicYearChoices().map((y) => <Chip key={y} testID={`apply-year-${y}`} label={y} selected={form.academic_year === y} onPress={() => set({ academic_year: y })} />)}
        </View>
        <TextInput testID="apply-current-school" style={s.input} placeholder={t('apply.currentSchool')} value={form.current_school} onChangeText={(v) => set({ current_school: v })} />
      </View>

      <View style={s.card}>
        <Text style={s.h2}>{t('apply.aboutYou')}</Text>
        <TextInput testID="apply-parent-name" style={s.input} placeholder={t('apply.yourName')} value={form.parent_name} onChangeText={(v) => set({ parent_name: v })} />
        <View style={s.wrap}>
          {APPLY_RELATIONS.map((r) => <Chip key={r} testID={`apply-relation-${r}`} label={t(`relation.${r}`)} selected={form.parent_relation === r} onPress={() => set({ parent_relation: r })} />)}
        </View>
        <TextInput testID="apply-phone" style={s.input} placeholder={t('apply.phone')} keyboardType="phone-pad" value={form.parent_phone} onChangeText={(v) => set({ parent_phone: v })} />
        <TextInput testID="apply-email" style={s.input} placeholder={t('apply.email')} autoCapitalize="none" keyboardType="email-address" value={form.parent_email} onChangeText={(v) => set({ parent_email: v })} />
        <TextInput testID="apply-address" style={[s.input, { minHeight: 70, textAlignVertical: 'top' }]} multiline placeholder={t('apply.address')} value={form.address} onChangeText={(v) => set({ address: v })} />
        <TextInput testID="apply-pincode" style={s.input} placeholder={t('apply.pincode')} keyboardType="number-pad" value={form.pincode} onChangeText={(v) => set({ pincode: v.replace(/[^0-9]/g, '').slice(0, 6) })} />
        <TextInput testID="apply-notes" style={[s.input, { minHeight: 70, textAlignVertical: 'top' }]} multiline placeholder={t('apply.notes')} value={form.notes} onChangeText={(v) => set({ notes: v })} />
        <Text style={s.muted}>{t('apply.notesHint')}</Text>
      </View>

      <View style={s.card}>
        <Pressable testID="apply-consent" accessibilityRole="checkbox" accessibilityState={{ checked: form.consent }} onPress={() => set({ consent: !form.consent })}
          style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
          <Text style={{ fontSize: 20 }}>{form.consent ? '\u2611' : '\u2610'}</Text>
          <Text style={[s.body, { flex: 1 }]}>{t('apply.consent', { school: cleanName(school.name) })}</Text>
        </Pressable>
        <Text style={s.muted}>{t('apply.consentNote')}</Text>
      </View>

      {!!error && <Notice text={error} testID="apply-error" />}
      <Btn testID="apply-send" label={busy ? t('sending') : t('apply.send')} onPress={submit} disabled={busy} />
      <Btn testID="apply-cancel" kind="quiet" label={t('cancel')} onPress={onCancel} />
    </ScrollView>
  );
}

function ApplicationsScreen({ onBack, onChanged }) {
  const [rows, setRows] = useState(null);
  const [events, setEvents] = useState({});
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    const res = await loadApplications(supabase);
    if (res.error) setError(isMissingApplications(res.error) ? t('apply.notOn') : friendlyError(res.error));
    else setError('');
    setRows(res.rows);
    onChanged?.(res.rows);
  }, [onChanged]);
  useEffect(() => { load(); }, [load]);

  async function open(id) {
    setOpenId(openId === id ? null : id);
    setNotice('');
    if (!events[id]) {
      const res = await loadApplicationEvents(supabase, id);
      setEvents((e) => ({ ...e, [id]: res.rows }));
    }
  }

  async function withdraw(row) {
    const res = await withdrawApplication(supabase, row.id);
    if (res?.error) setError(friendlyError(res.error));
    else { setNotice(t('apply.withdrawn')); setEvents((e) => ({ ...e, [row.id]: undefined })); await load(); }
  }

  async function remove(row) {
    const res = await deleteApplication(supabase, row.id);
    if (res?.error) setError(friendlyError(res.error));
    else { setConfirmDelete(null); setNotice(t('apply.deleted')); await load(); }
  }

  return (
    <ScrollView testID="applications-screen" contentContainerStyle={{ padding: 16 }}>
      <Btn testID="applications-back" kind="quiet" label={t('backToSchools')} onPress={onBack} />
      <Text style={s.title}>{t('apply.yours')}</Text>
      {!!error && <Notice text={error} testID="applications-error" />}
      {!!notice && <Notice tone="green" text={notice} testID="applications-notice" />}
      {rows === null && <ActivityIndicator testID="applications-loading" style={{ marginTop: 12 }} />}
      {rows !== null && rows.length === 0 && !error && <Text testID="applications-empty" style={s.empty}>{t('apply.noneYet')}</Text>}
      {(rows ?? []).map((row) => (
        <View key={row.id} style={s.card} testID={`application-${row.id}`}>
          <Pressable accessibilityRole="button" testID={`application-open-${row.id}`} onPress={() => open(row.id)}>
            <Text style={s.schoolName}>{cleanName(row.school_name || t('thisSchool'))}</Text>
            <Text style={[s.badge, { alignSelf: 'flex-start', backgroundColor: row.status === 'accepted' ? C.greenSoft : row.status === 'declined' ? C.redSoft : C.blueSoft, color: row.status === 'accepted' ? C.green : row.status === 'declined' ? C.red : C.blue }]}>
              {stageText(row.status)}
            </Text>
            <Text style={s.body}>{t('apply.forChild', { child: `${row.child_first_name} ${row.child_last_name}`, class: classLabel(row.class_applying), year: row.academic_year })}</Text>
            {!!row.status_note && <Text style={s.muted}>{t('apply.schoolSays', { note: row.status_note })}</Text>}
          </Pressable>
          {openId === row.id && (
            <View testID={`application-detail-${row.id}`}>
              <Text style={s.label}>{t('apply.whatHappened')}</Text>
              {(events[row.id] ?? []).map((e) => (
                <Text key={e.id} style={s.muted}>{`${stageText(e.status)} \u00b7 ${dayText(e.at)}${e.note ? ` \u00b7 ${e.note}` : ''}`}</Text>
              ))}
              <Text style={s.muted}>{t('apply.sharedOn', { date: dayText(row.consent_at) })}</Text>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {row.status !== 'withdrawn' && <Btn testID={`withdraw-${row.id}`} kind="quiet" label={t('apply.withdraw')} onPress={() => withdraw(row)} />}
                {confirmDelete === row.id
                  ? <Btn testID={`delete-confirm-${row.id}`} kind="quiet" label={t('apply.deleteConfirm')} onPress={() => remove(row)} />
                  : <Btn testID={`delete-${row.id}`} kind="quiet" label={t('apply.delete')} onPress={() => setConfirmDelete(row.id)} />}
              </View>
              <Text style={s.muted}>{t('apply.deleteNote')}</Text>
            </View>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------------------------- settings
// Who you are: the picture a school sees, your name, and how you would like to be described. It sits at the top of
// this screen because that is where someone looks for "my profile", and everything else here belongs to it anyway.
function ProfileCard({ settings, userId, onSaved }) {
  const [first, setFirst] = useState(settings?.first_name ?? '');
  const [last, setLast] = useState(settings?.last_name ?? '');
  const [gender, setGender] = useState(settings?.gender ?? null);
  const [avatar, setAvatar] = useState(settings?.avatar ?? 'auto');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [done, setDone] = useState('');
  const shown = avatarFor({ avatar, gender });
  const complete = profileComplete({ first_name: first, last_name: last, gender });

  async function save() {
    setProblem(''); setDone('');
    if (!first.trim() || !last.trim()) { setProblem(t('auth.needName')); return; }
    if (!PROFILE_GENDERS.includes(gender)) { setProblem(t('profile.needGender')); return; }
    setBusy(true);
    const res = await saveProfile(supabase, userId, { first_name: first, last_name: last, gender, avatar });
    setBusy(false);
    if (res.error) { setProblem(friendlyError(res.error)); return; }
    setDone(t('profile.saved'));
    onSaved?.(res.saved);
  }

  return (
    <View style={s.card} testID="profile-card">
      <Text style={s.h2}>{t('profile.title')}</Text>
      {!complete && <Notice tone="amber" text={t('profile.welcome')} testID="profile-welcome" />}
      <View style={{ alignItems: 'center', paddingVertical: 6 }}>
        <ParentAvatar look={shown} size={76} testID="profile-avatar" />
      </View>
      <Text style={s.label}>{t('profile.picture')}</Text>
      <View style={s.wrap}>
        {PROFILE_AVATARS.map((look) => (
          <Pressable key={look} testID={`avatar-${look}`} accessibilityRole="button" onPress={() => setAvatar(look)}
            style={[s.avatarChoice, avatar === look && s.avatarChosen]}>
            <ParentAvatar look={look} size={40} />
          </Pressable>
        ))}
      </View>
      <Text style={s.muted}>{t('profile.pictureHelp')}</Text>
      <TextInput testID="profile-first" style={s.input} placeholder={t('auth.firstName')} value={first} onChangeText={setFirst} />
      <TextInput testID="profile-last" style={s.input} placeholder={t('auth.lastName')} value={last} onChangeText={setLast} />
      <Text style={s.label}>{t('profile.gender')}</Text>
      <View style={s.wrap}>
        {PROFILE_GENDERS.map((g) => (
          <Chip key={g} testID={`profile-gender-${g}`} label={t(`profile.gender.${g}`)} selected={gender === g} onPress={() => setGender(g)} />
        ))}
      </View>
      {!!problem && <Notice text={problem} testID="profile-problem" />}
      {!!done && <Notice tone="green" text={done} testID="profile-done" />}
      <Btn testID="profile-save" label={busy ? t('saving') : t('saveChanges')} onPress={save} disabled={busy} />
    </View>
  );
}

function SettingsScreen({ language, onPickLanguage, settings, onSavePush, biometrics, unlockOn, onSetUnlock, onDeleted, onBack, email, onProfileSaved, userId, addresses, addressBookOn, onAddressesChanged }) {
  const [password, setPassword] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function remove() {
    setBusy(true);
    setError('');
    const res = await deleteAccount(supabase, email, password);
    setBusy(false);
    if (res.error) { setError(res.error.message); return; }
    onDeleted();
  }

  return (
    <ScrollView testID="settings-screen" contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Btn testID="settings-back" kind="quiet" label={t('backToSchools')} onPress={onBack} />
      <Text style={s.title}>{t('profile.title')}</Text>
      {!!error && <Notice text={error} testID="settings-error" />}
      {!!notice && <Notice tone="green" text={notice} testID="settings-notice" />}

      <ProfileCard settings={settings} userId={userId} onSaved={onProfileSaved} />
      <AddressBook rows={addresses} available={addressBookOn} onChanged={onAddressesChanged} />

      <View style={s.card}>
        <Text style={s.h2}>{t('settings.language')}</Text>
        <Text style={s.muted}>{t('settings.languageHelp')}</Text>
        <Btn testID="settings-language" kind="outline" label={`\ud83c\udf10 ${languageName(language)}`} onPress={onPickLanguage} />
      </View>

      <View style={s.card}>
        <Text style={s.h2}>{t('settings.notifications')}</Text>
        <View style={s.switchRow}>
          <Text style={[s.body, { flex: 1, paddingRight: 8 }]}>{t('settings.notificationsHelp')}</Text>
          <Switch testID="settings-push" value={!!settings?.notify_push} onValueChange={onSavePush} />
        </View>
      </View>

      {biometrics !== 'none' && (
        <View style={s.card}>
          <Text style={s.h2}>{t('settings.unlock')}</Text>
          <View style={s.switchRow}>
            <Text style={[s.body, { flex: 1, paddingRight: 8 }]}>
              {biometrics === 'face' ? t('settings.unlockFace') : t('settings.unlockFingerprint')}
            </Text>
            <Switch testID="settings-unlock" value={!!unlockOn} onValueChange={onSetUnlock} />
          </View>
          <Text style={s.muted}>{t('settings.unlockHelp')}</Text>
        </View>
      )}

      <View style={s.card}>
        <Text style={s.h2}>{t('settings.yourData')}</Text>
        <Text style={s.muted}>{t('settings.yourDataHelp')}</Text>
        {!confirming ? (
          <Btn testID="settings-delete" kind="quiet" label={t('settings.deleteAccount')} onPress={() => { setConfirming(true); setError(''); }} />
        ) : (
          <View>
            <Text style={s.body}>{t('settings.deleteWarning')}</Text>
            <TextInput testID="settings-password" style={s.input} secureTextEntry placeholder={t('settings.yourPassword')} value={password} onChangeText={setPassword} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn testID="settings-delete-confirm" label={busy ? t('pleaseWait') : t('settings.deleteForGood')} onPress={remove} disabled={busy || password.length < 1} />
              <Btn testID="settings-delete-cancel" kind="quiet" label={t('cancel')} onPress={() => { setConfirming(false); setPassword(''); }} />
            </View>
          </View>
        )}
      </View>

      <Btn testID="settings-signout" kind="outline" label={t('signOut')} onPress={() => supabase.auth.signOut()} />
      <Text style={s.muted}>{t('settings.privacy')}</Text>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------------------------- one school's page
function FeeTable({ rows, level }) {
  if (!rows.length) return null;
  const chosen = rows.find((r) => r.level === level) ?? rows[0];
  return (
    <View testID="fees">
      <Text style={[s.h2, { marginTop: 20 }]}>{t('fees.title')}</Text>
      <View style={s.wrap}>
        {rows.map((r) => (
          <Text key={r.level} testID={`fee-level-${r.level}`} style={[s.badge, r.level === chosen.level && { backgroundColor: C.blue, color: '#fff' }]}>
            {`${t(`level.${r.level}`)}: ${rupees(r.first_year_total)}`}
          </Text>
        ))}
      </View>
      <View style={[s.card, { marginTop: 8 }]} testID="fee-breakdown">
        <Text style={s.schoolName}>{t('fees.forLevel', { level: t(`level.${chosen.level}`), year: chosen.academic_year })}</Text>
        {FEE_PARTS.filter(([key]) => chosen[key] > 0).map(([key, label, when]) => (
          <View key={key} style={s.feeRow} testID={`fee-part-${key}`}>
            <Text style={s.body}>{t(label)}{when === 'once' ? ` (${t('fees.once')})` : ''}</Text>
            <Text style={s.body}>{rupees(chosen[key])}</Text>
          </View>
        ))}
        <View style={[s.feeRow, { borderTopWidth: 1, borderTopColor: C.line, paddingTop: 6, marginTop: 4 }]}>
          <Text style={s.schoolName}>{t('fees.firstYearTotal')}</Text>
          <Text style={s.schoolName}>{rupees(chosen.first_year_total)}</Text>
        </View>
        <View style={s.feeRow}>
          <Text style={s.body}>{t('fees.thenEachYear')}</Text>
          <Text style={s.body}>{rupees(chosen.annual_total)}</Text>
        </View>
        {chosen.deposit > 0 && <Text style={s.muted}>{t('fees.deposit', { amount: rupees(chosen.deposit) })}</Text>}
        {!!chosen.note && <Text style={s.muted}>{chosen.note}</Text>}
        <Text style={s.muted}>{sourcesText(rows)}</Text>
      </View>
    </View>
  );
}

function SchoolScreen({ school, profile, level, comparing, onBack, onOpenEnquiries, onApply, onCompare }) {
  const [stats, setStats] = useState(school.community);
  const [reviews, setReviews] = useState(null);
  const [mine, setMine] = useState(undefined);
  const [error, setError] = useState('');
  const [form, setForm] = useState(false);
  const [message, setMessage] = useState('');
  const [reporting, setReporting] = useState(null);
  const [reportMsg, setReportMsg] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [enquiry, setEnquiry] = useState(undefined);
  const [askForm, setAskForm] = useState(false);
  const [askDone, setAskDone] = useState('');
  const [facilities, setFacilities] = useState([]);
  const [achievements, setAchievements] = useState([]);
  const [fees, setFees] = useState([]);

  const reload = useCallback(async () => {
    const [r, m, st, en, fa, ac, fe] = await Promise.all([
      loadReviews(supabase, school.id), loadMyReview(supabase, school.id), loadStats(supabase, [school.id]),
      loadEnquiryForSchool(supabase, school.id), loadFacilities(supabase, school.id), loadAchievements(supabase, school.id),
      loadFeeSchedules(supabase, school.id),
    ]);
    if (r.error) setError(friendlyError(r.error));
    setReviews(r.rows);
    setMine(m.review);
    setStats(st[school.id] ?? null);
    setEnquiry(en.error ? null : en.thread);
    setFacilities(fa.rows);
    setAchievements(ac.groups);
    setFees(fe.rows);
  }, [school.id]);
  useEffect(() => { reload(); }, [reload]);

  async function report(reviewId, reason) {
    const res = await reportReview(supabase, reviewId, reason);
    setReportMsg((m) => ({ ...m, [reviewId]: res.error ? friendlyError(res.error, 'report') : t('review.reported') }));
    setReporting(null);
  }

  async function remove() {
    const res = await deleteReview(supabase, mine.id);
    if (res.error) setError(friendlyError(res.error));
    else { setConfirmDelete(false); setMessage(t('review.deleted')); reload(); }
  }

  function openSite(url, kind) {
    noteOutboundClick(supabase, school.id, kind);
    Linking.openURL(url);
  }

  const site = safeUrl(school.website);
  const community = communityText(stats);

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Btn testID="back" kind="quiet" label={t('backToSchools')} onPress={onBack} />
      <View style={s.heroPhoto}><SchoolPicture school={school} height={190} testID="hero" /></View>
      {!!photoCreditText(school) && (
        <Text testID="photo-credit" style={s.credit}>
          {photoCreditText(school)}
          {!!safeUrl(school.photo_page_url) && <Text testID="photo-source" style={{ color: C.blue }} onPress={() => Linking.openURL(safeUrl(school.photo_page_url))}> ({t('source')})</Text>}
        </Text>
      )}
      <Text testID="page-title" style={s.title}>{cleanName(school.name)}</Text>
      {!!distanceText(school.distance_km) && <Text testID="school-distance" style={s.distance}>{distanceText(school.distance_km)}</Text>}
      {!!driveTimeText(school.drive) && (
        <Text testID="page-drive" style={s.distance}>
          {`${driveTimeText(school.drive)}, ${t(DRIVE_MODES.find((m) => m.key === school.driveMode)?.long ?? 'drive.nowLong')}`}
        </Text>
      )}
      {!!leaveByText(school.drive) && <Text testID="page-leaveby" style={s.distance}>{leaveByText(school.drive)}</Text>}
      {!!cleanAddress(school.address) && <Text style={s.body}>{cleanAddress(school.address)}</Text>}
      <View style={s.badgeRow}>
        {isSchoolPlace(school) && levelBadges(school.levels).map((b) => <Text key={b} style={s.badge}>{b}</Text>)}
        {!!school.board && <Text style={[s.badge, { backgroundColor: C.greenSoft, color: C.green }]}>{school.board}</Text>}
      </View>
      {!!school.board && !!boardSourceText(school.board_source) && (
        <Text testID="page-board-source" style={s.muted}>
          {t('board.line', { board: school.board, source: boardSourceText(school.board_source) })}
          {!!safeUrl(school.board_source_url) && <Text testID="board-source-link" style={{ color: C.blue }} onPress={() => Linking.openURL(safeUrl(school.board_source_url))}> {t('seeWhere')}</Text>}
        </Text>
      )}
      {!!admissionText(school) && (
        <Text testID="page-admission" style={[s.rating, { color: school.admissions_open ? C.green : C.grey }]}>
          {admissionText(school)}
          {!!safeUrl(school.admissions_source_url) && <Text testID="admission-source-link" style={{ color: C.blue }} onPress={() => openSite(safeUrl(school.admissions_source_url), 'admission_page')}> {t('seeThePage')}</Text>}
        </Text>
      )}
      <Text style={s.rating}>{googleRatingText(school.google_rating, school.google_review_count)}</Text>
      {!school.google_rating && <Text style={s.muted}>{t('rating.noneHelp')}</Text>}
      {!!school.start_time && <Text testID="school-start" style={s.muted}>{t('school.startsAt', { time: String(school.start_time).slice(0, 5) })}</Text>}
      {!!site && <Btn testID="website" kind="outline" label={t('school.visitWebsite')} onPress={() => openSite(site, 'website')} />}
      {isSchoolPlace(school) && (
        <Btn testID="compare-toggle" kind="quiet" label={comparing ? t('compare.added') : t('compare.add')} onPress={onCompare} />
      )}

      <FeeTable rows={fees} level={level} />

      {facilities.length > 0 && (
        <View testID="facilities">
          <Text style={[s.h2, { marginTop: 20 }]}>{t('facilities.title')}</Text>
          <View style={s.wrap}>
            {facilities.map((f) => <Text key={f.facility} testID={`facility-${f.facility}`} style={s.facility}>{`${FACILITY_INFO[f.facility][1]} ${facilityText(f)}`}</Text>)}
          </View>
          <Text style={s.muted}>{sourcesText(facilities)}</Text>
        </View>
      )}

      {achievements.length > 0 && (
        <View testID="achievements">
          <Text style={[s.h2, { marginTop: 20 }]}>{t('achievements.title')}</Text>
          {achievements.map((g) => (
            <View key={g.kind} testID={`achievements-${g.kind}`} style={[s.card, s.achievementCard]}>
              <Text style={s.schoolName}>{`${g.icon} ${g.label}`}</Text>
              {g.items.map((a) => (
                <Text key={a.id} testID={`achievement-${a.id}`} style={s.body}>
                  {a.year ? `${a.year}: ` : ''}{a.text}
                  <Text style={s.muted}>{` (${t(SOURCE_TEXT[a.source] ?? 'source.unknown')})`}</Text>
                  {!!safeUrl(a.source_url) && <Text testID={`achievement-link-${a.id}`} style={{ color: C.blue }} onPress={() => Linking.openURL(safeUrl(a.source_url))}> {t('seeIt')}</Text>}
                </Text>
              ))}
            </View>
          ))}
          <Text style={s.muted}>{t('achievements.note')}</Text>
        </View>
      )}

      {isSchoolPlace(school) && (<>
        <Text style={[s.h2, { marginTop: 20 }]}>{t('admissions.title')}</Text>
        {!!askDone && <Notice tone="green" text={askDone} testID="enquiry-sent" />}
        {enquiry === undefined ? <ActivityIndicator style={{ marginTop: 8 }} /> : (
          <>
            {!!enquiry && (
              <View style={s.card} testID="enquiry-existing">
                <Text style={s.body}>{t('enquiry.already', { status: enquiryStatusText(enquiry.status) })}</Text>
                <Btn testID="open-enquiry" kind="outline" label={t('enquiry.openConversation')} onPress={onOpenEnquiries} />
              </View>
            )}
            {(!enquiry || enquiry.status === 'closed') && !askForm && (
              <View style={s.card}>
                <Text style={s.body}>{enquiry ? t('enquiry.closedAskAgain') : t('enquiry.intro2')}</Text>
                <Btn testID="ask-school" label={enquiry ? t('enquiry.askAgain') : t('enquiry.ask')} onPress={() => { setAskForm(true); setAskDone(''); }} />
              </View>
            )}
          </>
        )}
        {askForm && (
          <EnquiryForm schoolId={school.id} schoolName={school.name} onCancel={() => setAskForm(false)}
            onSent={() => { setAskForm(false); setAskDone(t('enquiry.sent')); reload(); }} />
        )}
        <View style={s.card} testID="apply-card">
          <Text style={s.schoolName}>{t('apply.cardTitle')}</Text>
          <Text style={s.body}>{t('apply.cardText')}</Text>
          <Btn testID="apply-start" label={t('apply.start')} onPress={() => onApply(school)} />
        </View>
      </>)}

      <Text style={[s.h2, { marginTop: 20 }]}>{t('reviews.title')}</Text>
      {community ? <Text testID="community-summary" style={[s.rating, { color: C.green }]}>{community}</Text> : <Text style={s.muted}>{t('reviews.none')}</Text>}
      {!!error && <Notice text={error} testID="school-error" />}
      {!!message && <Notice tone="green" text={message} testID="review-message" />}

      {mine === undefined ? <ActivityIndicator style={{ marginTop: 12 }} /> : mine ? (
        <View style={[s.card, { marginTop: 12 }]} testID="my-review">
          <Text style={s.label}>{t('reviews.yours')}</Text>
          <Text style={s.stars}>{stars(mine.rating)}</Text>
          {!!mine.title && <Text style={s.schoolName}>{mine.title}</Text>}
          <Text style={s.body}>{mine.body}</Text>
          <Notice tone={mine.status === 'published' ? 'green' : mine.status === 'pending' ? 'amber' : 'red'} text={statusLine(mine.status, mine.moderation_note)} testID="my-review-status" />
          {!form && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {mine.status !== 'removed' && <Btn testID="edit-review" kind="outline" label={t('edit')} onPress={() => { setForm(true); setMessage(''); }} />}
              {!confirmDelete
                ? <Btn testID="delete-review" kind="quiet" label={t('delete')} onPress={() => setConfirmDelete(true)} />
                : <Btn testID="confirm-delete" kind="quiet" label={t('review.deleteConfirm')} onPress={remove} />}
            </View>
          )}
        </View>
      ) : !form && <Btn testID="write-review" label={t('review.write')} onPress={() => { setForm(true); setMessage(''); }} />}

      {form && <ReviewForm schoolId={school.id} initial={mine || undefined} onCancel={() => setForm(false)} onSaved={(m) => { setForm(false); setMessage(m); reload(); }} />}

      {(reviews ?? []).map((r) => (
        <View key={r.id} style={s.card} testID={`review-${r.id}`}>
          <Text style={s.stars}>{stars(r.rating)}</Text>
          {!!r.title && <Text style={s.schoolName}>{r.title}</Text>}
          <Text style={s.body}>{r.body}</Text>
          <Text style={s.muted}>{`${t(RELATIONSHIPS.find((x) => x.key === r.relationship)?.label ?? 'relationship.other')} \u00b7 ${monthYear(r.created_at)}`}</Text>
          {!!reportMsg[r.id] && <Text testID={`report-msg-${r.id}`} style={[s.muted, { color: C.green }]}>{reportMsg[r.id]}</Text>}
          {mine?.id !== r.id && !reportMsg[r.id] && (reporting === r.id ? (
            <View style={s.wrap}>
              {REPORT_REASONS.map((x) => <Chip key={x.key} testID={`reason-${x.key}`} label={t(x.label)} onPress={() => report(r.id, x.key)} />)}
            </View>
          ) : <Btn testID={`report-${r.id}`} kind="quiet" label={t('report')} onPress={() => setReporting(r.id)} />)}
        </View>
      ))}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------------------------- the app
// The app proper. It is wrapped below in a SafeAreaProvider, which is what lets it know how much of the screen the
// phone has taken for its own status bar and navigation buttons.
function AppBody() {
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  const [language, setLanguage] = useState('en');
  const [languageReady, setLanguageReady] = useState(false);
  const [screen, setScreen] = useState('discover');   // discover | school | compare | enquiries | applications | apply | settings | language
  const [school, setSchool] = useState(null);
  const [applyTo, setApplyTo] = useState(null);
  const [compare, setCompare] = useState([]);
  const [compareNote, setCompareNote] = useState('');
  const [unread, setUnread] = useState(0);
  const [liveApps, setLiveApps] = useState(0);
  const [settings, setSettings] = useState(null);
  const [addresses, setAddresses] = useState([]);
  // false only when the address-book migration has not been run: the app then hides the whole thing
  const [addressBookOn, setAddressBookOn] = useState(true);
  const [biometrics, setBiometrics] = useState('none');
  const [unlockOn, setUnlockOn] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [lockError, setLockError] = useState('');
  const leftAt = useRef(null);

  // ---- language: what was chosen last time, then what the profile says ----
  const applyLanguage = useCallback((code) => {
    setTranslator(makeTranslator(code));
    setMoneyLocale(localeFor(code));
    setDateLocale(localeFor(code));
    setLanguage(code);
    if (I18nManager?.allowRTL) { try { I18nManager.allowRTL(true); } catch { /* not on web */ } }
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(LANGUAGE_SETTING).then((saved) => {
      applyLanguage(LANGUAGES.some((l) => l.code === saved) ? saved : 'en');
      setLanguageReady(true);
    });
  }, [applyLanguage]);

  const chooseLanguage = useCallback(async (code) => {
    applyLanguage(code);
    await AsyncStorage.setItem(LANGUAGE_SETTING, code);
    if (session?.user?.id) await saveLanguage(supabase, session.user.id, code);
    setScreen('discover');
  }, [applyLanguage, session]);

  // a steady handler, so the applications screen does not reload itself on every render
  const onApplicationsChanged = useCallback((rows) => setLiveApps(liveApplications(rows)), []);

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
      // Signing out hands the phone back. The next person starts fresh, including the choice to use a location:
      // it was this person's answer, not the phone's.
      if (!next) { setSchool(null); setScreen('discover'); setUnread(0); setCompare([]); setSettings(null); setLocked(false); AsyncStorage.removeItem(LOCATION_SETTING).catch(() => {}); }
    });
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        supabase.auth.startAutoRefresh();
        if (shouldLock(unlockOn, leftAt.current)) setLocked(true);
        leftAt.current = null;
      } else {
        supabase.auth.stopAutoRefresh();
        leftAt.current = Date.now();
      }
    });
    return () => { data?.subscription?.unsubscribe(); app?.remove?.(); };
  }, [unlockOn]);

  const refreshAddresses = useCallback(async () => {
    const res = await loadAddresses(supabase);
    if (res.error) {
      if (isMissingAddresses(res.error)) setAddressBookOn(false);
      return;
    }
    setAddressBookOn(true);
    setAddresses(res.rows);
  }, []);

  // ---- what this person has asked for before ----
  useEffect(() => {
    if (!session?.user?.id) return undefined;
    let alive = true;
    refreshUnread();
    refreshAddresses();
    loadApplications(supabase).then((res) => { if (alive && !res.error) setLiveApps(liveApplications(res.rows)); });
    loadSettings(supabase, session.user.id).then((res) => {
      if (!alive || !res.settings) return;
      setSettings(res.settings);
      if (res.settings.language && res.settings.language !== language) {
        applyLanguage(res.settings.language);
        AsyncStorage.setItem(LANGUAGE_SETTING, res.settings.language);
      } else if (!res.settings.language) {
        saveLanguage(supabase, session.user.id, language);
      }
    });
    AsyncStorage.getItem(BIOMETRIC_SETTING).then((v) => { if (alive) setUnlockOn(v === 'on'); });
    biometricKind(LocalAuthentication).then((kind) => { if (alive) setBiometrics(kind); });
    return () => { alive = false; };
    // language is left out on purpose: this runs when the person signs in, not every time they switch language
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, refreshUnread, refreshAddresses, applyLanguage]);

  // ---- notifications on the phone ----
  useEffect(() => {
    if (!session?.user?.id || !settings) return undefined;
    let alive = true;
    if (settings.notify_push) {
      const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? null;
      registerForPush(Notifications, supabase, Platform.OS, projectId).then(() => { /* nothing to show: it is quiet on purpose */ });
    }
    const sub = Notifications.addNotificationResponseReceivedListener?.((response) => {
      const kind = response?.notification?.request?.content?.data?.kind;
      if (!alive) return;
      if (kind === 'enquiry_reply') { setScreen('enquiries'); refreshUnread(); }
      if (kind === 'application_status') setScreen('applications');
    });
    return () => { alive = false; sub?.remove?.(); };
  }, [session, settings, refreshUnread]);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const target = backTargetFor(screen);
    if (!target) return undefined;   // on the list, back leaves the app, as it does in every other app
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setScreen(target);
      return true;
    });
    return () => sub.remove();
  }, [screen]);

  async function unlock() {
    setLockBusy(true);
    setLockError('');
    const res = await unlockWithBiometrics(LocalAuthentication, t('lock.prompt'));
    setLockBusy(false);
    if (res.ok) setLocked(false); else setLockError(t('lock.failed'));
  }

  async function setUnlockChoice(on) {
    if (on) {
      const res = await unlockWithBiometrics(LocalAuthentication, t('lock.prompt'));
      if (!res.ok) return;
    }
    setUnlockOn(on);
    await AsyncStorage.setItem(BIOMETRIC_SETTING, on ? 'on' : 'off');
  }

  async function setPushChoice(on) {
    setSettings((cur) => ({ ...cur, notify_push: on }));
    if (session?.user?.id) await savePushChoice(supabase, session.user.id, on);
    if (on) await registerForPush(Notifications, supabase, Platform.OS, Constants?.expoConfig?.extra?.eas?.projectId ?? null);
    else await forgetPush(Notifications, supabase, Platform.OS, Constants?.expoConfig?.extra?.eas?.projectId ?? null);
  }

  function toggleCompareSchool(item) {
    const res = toggleCompare(compare, item);
    setCompare(res.list);
    setCompareNote(res.full ? t('compare.full', { max: MAX_COMPARE }) : '');
  }

  if (!KEY_IS_SET) {
    return (
      <View style={[s.root, s.center]} testID="setup">
        <Text style={s.h2}>One quick step</Text>
        <Text style={[s.body, { textAlign: 'center', marginTop: 8 }]}>
          Open App.js and replace PASTE_YOUR_PUBLISHABLE_KEY_HERE with your Supabase publishable key (it starts with
          sb_publishable_). Never use a secret key here.
        </Text>
      </View>
    );
  }
  if (!ready || !languageReady) return <View style={[s.root, s.center]}><ActivityIndicator testID="boot" /></View>;

  const rtl = isRightToLeft(language);
  // Android draws this app under its own status bar and navigation buttons. Without these two the top bar sits under
  // the clock and the last button on every screen sits under the back / home / recents row, where it cannot be pressed.
  const frame = [s.root, { paddingTop: insets.top, paddingBottom: insets.bottom }, rtl && { direction: 'rtl' }];
  const backTo = backTargetFor(screen);

  if (!session) {
    return (
      <View style={frame} testID="frame">
        {screen === 'language'
          ? <LanguageScreen current={language} onPick={chooseLanguage} onClose={() => setScreen('discover')} />
          : <AuthScreen language={language} onPickLanguage={() => setScreen('language')} />}
      </View>
    );
  }
  if (locked) {
    return (
      <View style={frame} testID="frame">
        <LockScreen kind={biometrics} busy={lockBusy} error={lockError} onUnlock={unlock} onSignOut={() => { setLocked(false); supabase.auth.signOut(); }} />
      </View>
    );
  }

  return (
    <View style={frame} testID="frame">
      {/* Two rows, so nothing is ever pushed off the side of a narrow phone. The brand and the way out of the screen
          you are on go on top; the places you can go to sit underneath and wrap if the words are long. */}
      <View style={s.topBar}>
        <View style={s.topBarRow}>
          <View style={s.brandRow}>
            {backTo ? (
              <Btn testID="top-back" kind="quiet" label={t('back')} onPress={() => setScreen(backTo)} />
            ) : (
              <LogoMark size={26} />
            )}
            <Text style={s.topTitle} numberOfLines={1}>Kidscover</Text>
          </View>
          <Pressable testID="settings" accessibilityRole="button" accessibilityLabel={t('profile.title')} onPress={() => setScreen('settings')} style={s.profileButton}>
            {settings ? <ParentAvatar look={avatarFor(settings)} size={36} testID="top-avatar" /> : <Text style={s.profileInitials}>{initialsOf(settings)}</Text>}
            {settings && !profileComplete(settings) && <View style={s.profileDot} testID="profile-dot" />}
          </Pressable>
        </View>
        <View style={s.topBarTabs}>
          <Btn testID="applications" kind="quiet" label={liveApps > 0 ? t('nav.applicationsCount', { count: liveApps }) : t('nav.applications')} onPress={() => setScreen('applications')} />
          <Btn testID="enquiries" kind="quiet" label={unread > 0 ? t('nav.enquiriesCount', { count: unread }) : t('nav.enquiries')} onPress={() => setScreen('enquiries')} />
        </View>
      </View>
      {!!compareNote && <Notice tone="amber" text={compareNote} testID="compare-note" />}
      {/* Said once, on the list, and never in the way: an unfinished profile is worth mentioning but is nobody's
          emergency. The button goes straight to the part that needs finishing. */}
      {screen === 'discover' && settings && !profileComplete(settings) && (
        <View style={s.profileNudge} testID="profile-nudge">
          <Text style={[s.body, { flex: 1, paddingRight: 8 }]}>{t('profile.incomplete')}</Text>
          <Btn testID="profile-finish" label={t('profile.finish')} onPress={() => setScreen('settings')} />
        </View>
      )}

      {screen === 'language' && <LanguageScreen current={language} onPick={chooseLanguage} onClose={() => setScreen('settings')} />}
      {screen === 'settings' && (
        <SettingsScreen
          language={language}
          onPickLanguage={() => setScreen('language')}
          settings={settings}
          onSavePush={setPushChoice}
          biometrics={biometrics}
          unlockOn={unlockOn}
          onSetUnlock={setUnlockChoice}
          email={session?.user?.email ?? settings?.email ?? ''}
          userId={session?.user?.id ?? null}
          onProfileSaved={(saved) => setSettings((old) => ({ ...(old ?? {}), ...saved }))}
          addresses={addresses}
          addressBookOn={addressBookOn}
          onAddressesChanged={refreshAddresses}
          onDeleted={() => { setScreen('discover'); supabase.auth.signOut(); }}
          onBack={() => setScreen('discover')}
        />
      )}
      {screen === 'enquiries' && (
        <EnquiriesScreen myId={session?.user?.id} onBack={() => { setScreen('discover'); refreshUnread(); }} onChanged={refreshUnread} />
      )}
      {screen === 'applications' && (
        <ApplicationsScreen onBack={() => setScreen('discover')} onChanged={onApplicationsChanged} />
      )}
      {screen === 'apply' && applyTo && (
        <ApplyScreen school={applyTo} profile={{ ...settings, email: session?.user?.email }}
          onCancel={() => setScreen(school ? 'school' : 'discover')}
          onDone={async () => { setScreen('applications'); const res = await loadApplications(supabase); if (!res.error) setLiveApps(liveApplications(res.rows)); }} />
      )}
      {screen === 'compare' && (
        <CompareScreen schools={compare} level={null} onBack={() => setScreen('discover')}
          onOpen={(x) => { setSchool(x); setScreen('school'); }} onRemove={(x) => toggleCompareSchool(x)} />
      )}
      <View style={{ flex: 1, display: screen === 'discover' ? 'flex' : 'none' }}>
        <DiscoverScreen onOpen={(x) => { setSchool(x); setScreen('school'); }} compare={compare}
          onToggleCompare={toggleCompareSchool} onOpenCompare={() => setScreen('compare')}
          addresses={addressBookOn ? addresses : null} onSavedAddress={refreshAddresses} userId={session?.user?.id ?? null} />
      </View>
      {screen === 'school' && school && (
        <SchoolScreen
          key={school.id}
          school={school}
          profile={settings}
          level={null}
          comparing={compare.some((x) => x.id === school.id)}
          onCompare={() => toggleCompareSchool(school)}
          onBack={() => setScreen('discover')}
          onOpenEnquiries={() => setScreen('enquiries')}
          onApply={(x) => { setApplyTo(x); setScreen('apply'); }}
        />
      )}
    </View>
  );
}

// SafeAreaProvider measures what the phone has taken for itself - the status bar at the top, the navigation buttons
// or home bar at the bottom - so the app can keep its own buttons clear of them.
export default function App() {
  return (
    <SafeAreaProvider>
      <AppBody />
    </SafeAreaProvider>
  );
}

// ---------------------------------------------------------------------------------------------- styles
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  topBar: { paddingHorizontal: 12, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: C.card },
  topBarRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  topBarTabs: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  topTitle: { fontSize: 20, fontWeight: '900', color: C.blue, letterSpacing: 0.3, flexShrink: 1 },
  profileButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.blueSoft, borderWidth: 1, borderColor: C.blue, alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  profileNudge: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.amberSoft, paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  profileDot: { position: 'absolute', top: -1, right: -1, width: 12, height: 12, borderRadius: 6, backgroundColor: C.coral, borderWidth: 2, borderColor: C.card },
  profileInitials: { color: C.blue, fontWeight: '900', fontSize: 14 },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, flexShrink: 1 },
  authWrap: { padding: 20, paddingTop: 28 },
  authArt: { borderRadius: 24, overflow: 'hidden', marginBottom: 18, backgroundColor: C.blueSoft },
  authCard: { borderRadius: 20, padding: 18, shadowColor: C.blue, shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  logo: { fontSize: 34, fontWeight: '900', color: C.blue, textAlign: 'center' },
  tagline: { color: C.grey, textAlign: 'center', marginTop: 6, marginBottom: 8, fontSize: 15 },
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
  tileRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  tile: { flex: 1, borderRadius: 16, padding: 10, alignItems: 'center' },
  tileNumber: { fontSize: 22, fontWeight: '900' },
  tileLabel: { fontSize: 11, color: C.grey, textAlign: 'center' },
  feeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  compareBar: { backgroundColor: C.card, borderTopWidth: 2, borderTopColor: C.blue, paddingHorizontal: 16, paddingVertical: 10, gap: 6, shadowColor: C.blue, shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: -3 }, elevation: 8 },
  compareCell: { width: 150, padding: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.card },
  compareHead: { backgroundColor: C.blueSoft },
  compareName: { fontSize: 14, fontWeight: '700', color: C.ink },
  compareTag: { backgroundColor: C.blueSoft, color: C.blue, fontSize: 12, fontWeight: '700', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, overflow: 'hidden' },
  h2: { fontSize: 18, fontWeight: '700', color: C.ink },
  title: { fontSize: 24, fontWeight: '800', color: C.ink, marginTop: 4 },
  schoolName: { fontSize: 16, fontWeight: '700', color: C.ink },
  body: { fontSize: 15, color: C.ink },
  muted: { fontSize: 13, color: C.grey },
  label: { fontSize: 12, fontWeight: '700', color: C.grey, textTransform: 'uppercase', marginTop: 6 },
  rating: { fontSize: 14, fontWeight: '600', color: C.ink },
  stars: { fontSize: 18, color: '#F59E0B' },
  empty: { textAlign: 'center', color: C.grey, marginTop: 24 },
  avatarChoice: { borderRadius: 24, borderWidth: 2, borderColor: 'transparent', padding: 2 },
  avatarChosen: { borderColor: C.blue, backgroundColor: C.blueSoft },
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
  addressRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: C.line, paddingVertical: 6 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 6 },
  notice: { borderRadius: 10, padding: 10, marginVertical: 6 },
});
