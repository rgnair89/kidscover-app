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
| `20260921000200_parent_addresses.sql` | the address book: the places a parent searches from |
| `20260921000300_people_photos.sql` | photographs of parents and children, in a private bucket |
| `20260925000100_send_push_schedule.sql` | asks send-push, once a minute, to empty the queue - read its notes first |

Edge functions (paste each into the Supabase dashboard): `commute-times`, `read-school-websites`, `send-push`,
`crm-deliver`, `delete-account`. The last three need the secret `SB_SECRET_KEY` (a `sb_secret_…` key) set in
Supabase → Edge Functions → Secrets.

---

## The icons

The app's icons are drawn in code, like everything else in it: a school under a sunshine roof, with a flag, a row
of windows and a coral door, on the brand violet. Nothing is licensed and nothing is downloaded.

```bash
node scripts/make-icons.cjs   # redraws assets/*.png
```

Change the shapes in that one file and every size follows. The same shapes are drawn again in App.js as `LogoMark`,
which is the mark you see beside the name inside the app.

---

## Running it while you work

```bash
npm install
npm start          # then press w for the browser, or scan the QR code with Expo Go
npm test           # the app's own checks: 349 on the logic, 461 on the screens, plus the language packs
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

**2. Notifications on Android (once).** Android delivers notifications only through Firebase, so until this is done
everything else works and the notifications simply stay quiet.

- In the [Firebase console](https://console.firebase.google.com), make a project. Any name; Analytics is not needed.
- In it: **Add app → Android**, with the package name `in.kidscover.app`, spelled exactly like that. Leave the SHA-1
  fingerprint blank; it is only needed for Google sign-in, which Kidscover does not use.
- Download **`google-services.json`** and put it in this folder, beside `app.json`. Commit it. It is not a secret: it
  holds your Firebase project's numbers and an Android key tied to that package name, and a copy sits inside every APK
  you hand out. Commit it because `eas build` sends Expo what git has, so a file left uncommitted never reaches the
  build. Nothing else to change: `app.config.js` notices the file and points the build at it.
- Then Firebase → **Project settings → Service accounts → Generate new private key**. That file *is* secret - it can
  send notifications to anyone's phone as you. Hand it straight to Expo and delete your copy:

```bash
npx eas-cli credentials --platform android
```

  Pick the build profile, then **Push Notifications: Manage your FCM V1 service account key** → *Upload a new service
  account key*. It never goes near this repository, and there is nothing to commit afterwards.

- Worth doing while you are there: in [expo.dev](https://expo.dev) → your project → **Notifications**, switch on
  *Enhanced Security for Push*, make an access token, and put it in Supabase → Edge Functions → Secrets as
  `EXPO_ACCESS_TOKEN`. Without it, anyone who learned a push token could send to that phone; with it, only
  `send-push` can.
- Build again (step 3) and install. The first time the app opens, Android asks whether Kidscover may send
  notifications. If someone says no, Android remembers it: the switch in Settings will not bring it back, only the
  phone's own settings for the app will.

To see that it works, reply to one of your own enquiries from the Partner Portal. The phone shows the school's name
and one line - never the words of the message.

(If you would rather the Firebase file stayed out of git: `eas secret:create --name GOOGLE_SERVICES_JSON --type file
--value ./google-services.json`, and add `google-services.json` to `.gitignore`. `app.config.js` reads that too.)

**3. Build the APK.**

```bash
npx eas-cli build --platform android --profile preview
```

It takes 10–20 minutes. When it finishes, the terminal (and expo.dev) gives a link and a QR code. Open that link on
your phone, allow "install unknown apps" for your browser when Android asks, and install it.

**4. Later versions.** Raise both `"version"` and `"versionCode"` in `app.json`, then build again. The
`versionCode` is the number Android compares when installing over an older build, and `version` is what a person
sees. Because `runtimeVersion` follows `version`, changing it also means this build takes its own over-the-air
updates rather than the previous build's - which is what you want when the app itself has changed.

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
| `app.config.js` | adds the Firebase file to the Android build, but only once there is one |
| `tests/logic.test.mjs` | the logic on its own, against a stand-in database |
| `tests/ui.test.mjs` | the real screens in a simulated browser, against a stand-in database and a stand-in phone |
| `tests/mutate.mjs` | breaks the app on purpose, to prove the tests notice |
