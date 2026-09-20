// The words of Kidscover, in 31 languages: English, the 22 languages of the Eighth Schedule of the Indian
// Constitution, and eight widely spoken international ones.
//
// Each language is one file of key/value pairs, with English as the original. A missing word falls back to English,
// so a half-finished translation can never leave a blank screen.
//
// Adding a language: add its file here, add a line to LANGUAGES with the name in its own script, and (if it is written
// right to left) to RIGHT_TO_LEFT. Everything else follows.
import en from './en.json';
import as from './as.json';
import bn from './bn.json';
import brx from './brx.json';
import doi from './doi.json';
import gu from './gu.json';
import hi from './hi.json';
import kn from './kn.json';
import ks from './ks.json';
import kok from './kok.json';
import mai from './mai.json';
import ml from './ml.json';
import mni from './mni.json';
import mr from './mr.json';
import ne from './ne.json';
import or from './or.json';
import pa from './pa.json';
import sa from './sa.json';
import sat from './sat.json';
import sd from './sd.json';
import ta from './ta.json';
import te from './te.json';
import ur from './ur.json';
import ar from './ar.json';
import de from './de.json';
import es from './es.json';
import fr from './fr.json';
import ja from './ja.json';
import pt from './pt.json';
import ru from './ru.json';
import zh from './zh.json';

const PACKS = { en, as, bn, brx, doi, gu, hi, kn, ks, kok, mai, ml, mni, mr, ne, or, pa, sa, sat, sd, ta, te, ur, ar, de, es, fr, ja, pt, ru, zh };

// name: what the language is called in English; endonym: what it calls itself; locale: for numbers and dates.
export const LANGUAGES = [
  { code: 'en', name: 'English', endonym: 'English', locale: 'en-IN' },
  { code: 'hi', name: 'Hindi', endonym: 'हिन्दी', locale: 'hi-IN' },
  { code: 'bn', name: 'Bengali', endonym: 'বাংলা', locale: 'bn-IN' },
  { code: 'mr', name: 'Marathi', endonym: 'मराठी', locale: 'mr-IN' },
  { code: 'te', name: 'Telugu', endonym: 'తెలుగు', locale: 'te-IN' },
  { code: 'ta', name: 'Tamil', endonym: 'தமிழ்', locale: 'ta-IN' },
  { code: 'gu', name: 'Gujarati', endonym: 'ગુજરાતી', locale: 'gu-IN' },
  { code: 'kn', name: 'Kannada', endonym: 'ಕನ್ನಡ', locale: 'kn-IN' },
  { code: 'ml', name: 'Malayalam', endonym: 'മലയാളം', locale: 'ml-IN' },
  { code: 'pa', name: 'Punjabi', endonym: 'ਪੰਜਾਬੀ', locale: 'pa-IN' },
  { code: 'or', name: 'Odia', endonym: 'ଓଡ଼ିଆ', locale: 'or-IN' },
  { code: 'as', name: 'Assamese', endonym: 'অসমীয়া', locale: 'as-IN' },
  { code: 'ur', name: 'Urdu', endonym: 'اردو', locale: 'ur-IN' },
  { code: 'ne', name: 'Nepali', endonym: 'नेपाली', locale: 'ne-NP' },
  { code: 'sa', name: 'Sanskrit', endonym: 'संस्कृतम्', locale: 'sa-IN' },
  { code: 'kok', name: 'Konkani', endonym: 'कोंकणी', locale: 'kok-IN' },
  { code: 'mai', name: 'Maithili', endonym: 'मैथिली', locale: 'mai-IN' },
  { code: 'doi', name: 'Dogri', endonym: 'डोगरी', locale: 'doi-IN' },
  { code: 'brx', name: 'Bodo', endonym: 'बरे', locale: 'brx-IN' },
  { code: 'sat', name: 'Santali', endonym: 'ᱥᱟᱱᱛᱟᱲᱤ', locale: 'sat-IN' },
  { code: 'ks', name: 'Kashmiri', endonym: 'كٲشُر', locale: 'ks-IN' },
  { code: 'sd', name: 'Sindhi', endonym: 'سنڌي', locale: 'sd-IN' },
  { code: 'mni', name: 'Manipuri', endonym: 'ꯃꯤꯇꯩꯂꯣꯟ', locale: 'mni-IN' },
  { code: 'ar', name: 'Arabic', endonym: 'العربية', locale: 'ar' },
  { code: 'zh', name: 'Chinese', endonym: '中文', locale: 'zh-CN' },
  { code: 'es', name: 'Spanish', endonym: 'Español', locale: 'es' },
  { code: 'fr', name: 'French', endonym: 'Français', locale: 'fr' },
  { code: 'de', name: 'German', endonym: 'Deutsch', locale: 'de' },
  { code: 'pt', name: 'Portuguese', endonym: 'Português', locale: 'pt' },
  { code: 'ru', name: 'Russian', endonym: 'Русский', locale: 'ru' },
  { code: 'ja', name: 'Japanese', endonym: '日本語', locale: 'ja' },
];

// Written from right to left (Arabic, and the Indian languages written in the Perso-Arabic script).
const RIGHT_TO_LEFT = ['ar', 'ur', 'ks', 'sd'];

export const isRightToLeft = (code) => RIGHT_TO_LEFT.includes(code);
export const languageOf = (code) => LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
export const languageName = (code) => languageOf(code).endonym;
export const localeFor = (code) => languageOf(code).locale;

// Puts the values into a line of words: "{count} reviews" with { count: 3 } becomes "3 reviews".
function fill(line, values) {
  if (!values) return line;
  return String(line).replace(/\{(\w+)\}/g, (whole, name) => (name in values ? String(values[name]) : whole));
}

// The words for one language, falling back to English for anything not translated yet.
export function makeTranslator(code) {
  const pack = PACKS[code] ?? PACKS.en;
  return (key, values) => fill(pack[key] ?? PACKS.en[key] ?? key, values);
}

export const packFor = (code) => PACKS[code] ?? PACKS.en;
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);
