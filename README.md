# Kidscover — the parent app

An Expo (React Native) app. `App.js` is the whole app; `i18n/` holds its words in 31 languages.

Parents can find schools near them, filter by level, board, rating, distance and cost, see the drive time (including
when to leave home to be there for the start of school), open a school (photo, levels, board, fees, facilities,
achievements, parent reviews), compare four schools side by side, ask a school about admissions, apply with the
Kidscover Standard form and follow it, and read all of it in their own language.

---

## The key

`SUPABASE_KEY` near the top of `App.js` holds this project's Supabase **publishable** key, and it is committed on
purpose. That key is meant to be in the app: every installed copy carries it and anyone can read it out of one. What
keeps data safe is row level security in the database, not hiding the key.

It also has to be committed for a real build to work. `eas build` uploads what git has, not what is on your laptop, so
a key that only exists in your working copy produces an app that opens on "One quick step" and goes no further.

Never put a **secret** key (`sb_secret_…`, `service_role`) here. That one grants everything and belongs only in
Supabase's own secrets, where the edge functions read it.

Pointing this app at a different Supabase project means changing `SUPABASE_URL` and `SUPABASE_KEY` together.

## What the database needs first

Run these in the Supabase SQL editor, in order, from the `kidscover-admin` repository. Each is safe to run twice.

| Migration | What it gives the app |
|---|---|
| `20260919000500` … `20260919001400` | schools near me, drive times, boards and admissions, categories, photos, facilities, achievements, levels |
| `20260920000100_languages_and_settings.sql` | each person's language and push setting |
| `20260920000200_fees_and_start_times.sql` | fees, the first-year cost, the start of the school day, the dashboard counts |
| `20260920000300_partner_schools.sql` | the admission form, the school's own admissions system, click counts |
| `20260920000400_notifications.sql` | push notifications |
| `20260920000500_account_and_security.sql` | deleting your account, two-step sign-in for the portal |
| `20260920000600_privileges_tightened.sql` | takes away every right nobody needs |
| `20260921000100_profile_gender_and_avatar.sql` | the profile: how a parent is addressed, and the picture shown for them |

Edge functions (paste each into the Supabase dashboard): `commute-times`, `read-school-websites`, `send-push`,
`crm-deliver`, `delete-account`. The last three need the secret `SB_SECRET_KEY` (a `sb_secret_…` key) set in
Supabase → Edge Functions → Secrets.

---

## Running it while you work

```bash
npm install
npm start          # then press w for the browser, or scan the QR code with Expo Go
npm test           # the app's own checks: 223 on the logic, 321 on the screens, plus the language packs
```

In Expo Go the fingerprint unlock works, but **push notifications do not** (Android stopped allowing them in Expo Go).
For those you need the installable app below.

---

## Building the app for your phone (the APK)

Expo builds it in the cloud; nothing needs installing on your machine but Node.

**1. An Expo account (once).** Sign up at [expo.dev](https://expo.dev), then, in this folder:

```bash
npx eas-cli login
npx eas-cli init
```

`init` writes your own project id into `app.json`, as `extra.eas.projectId`. Commit that change. Run `init` before
the first build: without it `eas build` stops with "Invalid UUID appId", because there is no project to build into.

**2. Notifications on Android (once, optional).** Push needs Firebase:

- In the [Firebase console](https://console.firebase.google.com), create a project (any name).
- Add an **Android app** with the package name `in.kidscover.app`. Download `google-services.json`.
- In Firebase → Project settings → Service accounts → **Generate new private key**: a `.json` file.
- Give that service-account file to Expo: `npx eas-cli credentials` → Android → *FCM V1 service account key* → upload.
- In [expo.dev](https://expo.dev) → your project → Notifications, switch on **Enhanced Security for Push**, make an
  access token, and set it in Supabase → Edge Functions → Secrets as `EXPO_ACCESS_TOKEN`.

Skip this and everything else still works; only the notifications stay quiet.

**3. Build the APK.**

```bash
npx eas-cli build --platform android --profile preview
```

It takes 10–20 minutes. When it finishes, the terminal (and expo.dev) gives a link and a QR code. Open that link on
your phone, allow "install unknown apps" for your browser when Android asks, and install it.

**4. Later versions.** Raise `"versionCode"` in `app.json` and build again.

> An APK is not the Play Store. It installs only on phones you give the link to, which is what you want for testing.
> For a public release you would use `--profile production` (an .aab), a Play Console account, a privacy policy and
> Google's review.

---

## Languages

31 in all: English, the 22 languages of the Eighth Schedule, and Arabic, Chinese, French, German, Japanese,
Portuguese, Russian and Spanish. A parent picks one on the sign-in screen or in Settings; it is saved with their
profile, so it follows them to a new phone. Arabic, Urdu, Kashmiri and Sindhi lay the screen out right to left.

Each language is one file in `i18n/`, with `en.json` as the original. Anything not translated falls back to English,
so a half-finished language can never leave a blank screen. `node i18n/check.cjs` checks that every language has
exactly the English keys and that the `{placeholders}` survived.

All 31 are now translated, so nothing falls back to English any more. **Before a public launch, have a native
speaker read each language.** These were translated carefully, but a school application is not the place for a
clumsy sentence, and the smaller languages (Bodo, Santali, Dogri, Manipuri, Konkani, Maithili, Kashmiri, Sindhi,
Sanskrit) deserve a second pair of eyes most.

---

## What the app keeps, and where

| What | Where | Why |
|---|---|---|
| The sign-in token | Encrypted with a key in the phone's own keystore (Keychain / Android Keystore); only the encrypted text is in ordinary storage | So a lost phone does not hand over the account |
| The chosen language, and whether to unlock with a fingerprint | Ordinary storage | They are not secrets |
| Where the parent is | Nowhere. It is used to measure distance and sent to Google for a drive time, and never written down | It is the most sensitive thing the app touches |
| Anything about a child | Nowhere, until the parent sends an admission form to a school themselves, with a tick to say so | Less data about a child, less to protect |

Notifications never carry the words of a message: "the school replied", never what was said. Nothing shows on a
locked screen that a stranger should not read.

---

## The files

| File | What it is |
|---|---|
| `App.js` | the whole app: the logic between the BEGIN/END markers, then the screens |
| `i18n/` | `index.js` (the languages and the translator), one `.json` per language, `check.cjs` |
| `index.js` | where the app starts on a phone |
| `app.json`, `eas.json` | the Expo and build settings (Android package `in.kidscover.app`) |
| `tests/logic.test.mjs` | the logic on its own, against a stand-in database |
| `tests/ui.test.mjs` | the real screens in a simulated browser, against a stand-in database and a stand-in phone |
| `tests/mutate.mjs` | breaks the app on purpose, to prove the tests notice |
