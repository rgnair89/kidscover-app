# Kidscover parent app (first version)

The whole app is one file, `App.js`, so it can be pasted straight into [snack.expo.dev](https://snack.expo.dev).

## What it does
- Sign in / create an account (email + password)
- Search schools by name or area, filter by **level** (Preschool / Primary / Secondary / not stated), **daycare available**, **Google rating** (with an "include schools with no rating" switch, on by default because most K-12 schools have none), and sort
- **Schools near me**: a "Use my location" button (the phone asks permission), the distance on every school, "Nearest first", and "Within 2 / 5 / 10 km"
- School page: address, level badges, Google rating, website link, **parent reviews**
- Write a review (anonymous, checked by a moderator before it shows), edit or delete your own, report someone else's

Not in this version: travel time by car (that needs Google's Routes API, called from the server), compare, Google / Microsoft / phone sign-in, push notifications, admissions forms and chat. Those come next.

## Schools near me: what it does and does not do
- Distance is **in a straight line**, not by road. The app says so on screen.
- The position is used only to measure distance. It is rounded to about 100 m, sent to the database function `schools_nearby` (which only reads), and kept in memory: it is not stored in the database, not saved on the phone, and forgotten on sign out or when the app closes.
- If the parent says no to the permission, everything else still works (search by name or area).
- Schools without coordinates are left out of "near me" lists (a distance to them would be a guess) but still show in the normal list.
- A parent outside Mumbai / Thane still gets distances, plus a note that Kidscover only lists that area so far.
- For a real app build (not Snack or Expo Go) the iOS permission text has to be set in `app.json` through the `expo-location` plugin (`locationWhenInUsePermission`).

## Before you try it: the database
Run these in the Supabase SQL Editor (they live in the kidscover-admin repo, `supabase/migrations/`), then paste the app:
- `20260919000200_school_quality_rules.sql` and `20260919000300_school_quality_rules_v2.sql` - the app asks the database to leave out places that are not schools
- `20260919000400_school_name_sort.sql` - the A to Z list sorts on the `name_sort` column, which does not exist until this is run
- `20260919000500_schools_nearby.sql` - the distance function used by "Use my location". Run it **before** pasting this version of the app. If it is missing the app still works; the button just says that nearby search is not switched on yet

If the app shows an error mentioning a missing column, one of these has not been run yet.

## Run it in Snack
1. Open <https://snack.expo.dev> (no account needed).
2. Open `App.js` from this folder, select everything, copy it, and paste it over the Snack's `App.js`.
3. Near the top, replace `PASTE_YOUR_PUBLISHABLE_KEY_HERE` with your **publishable** key (`sb_publishable_...`, the same value as `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the admin project's `.env.local`). Never a secret key.
4. Snack notices the packages the file imports and shows an "Add dependency" prompt for each. Accept them: `@supabase/supabase-js`, `@react-native-async-storage/async-storage`, `react-native-url-polyfill`, `expo-location`.
5. Use the **Web** preview, or scan the QR code with the Expo Go app on a phone.

Snack has no way to keep a secret, so the key is pasted into the code. That is fine for the publishable key (it is meant to be public; the database rules protect the data), and it is the reason a secret key must never go there.

## Trying reviews
- A newly written review is **pending**: only its author sees it. An admin publishes it from the **Parent Reviews** tab of the Partner Portal (the kidscover-admin app). While testing you can also do it in the SQL Editor:
  ```sql
  update public.school_reviews set status = 'published' where status = 'pending';
  ```
- Your account has to have a confirmed email to write or report a review.
- A parent can review each school once; editing sends the review back to pending.

## Tests
```
npm install
npm test          # 116 logic checks + 125 screen checks
node tests/mutate.mjs   # breaks the app 50 ways on purpose and checks the tests notice (takes a while)
```
The screen tests run the real `App.js` in a simulated browser against a stand-in database that follows the same rules as the real one (unverified accounts blocked, one review per school, pending reviews hidden, distances from schools that have coordinates) and a stand-in for the phone's location (allowed, refused, blocked, switched off, never answers, outside Mumbai). The database function `schools_nearby` was tested separately against an in-memory Postgres engine (63 checks); those tests are not part of this repo.
