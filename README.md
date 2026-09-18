# Kidscover parent app (first version)

The whole app is one file, `App.js`, so it can be pasted straight into [snack.expo.dev](https://snack.expo.dev).

## What it does
- Sign in / create an account (email + password)
- Search schools by name or area, filter by **level** (Preschool / Primary / Secondary / not stated), **daycare available**, **Google rating** (with an "include schools with no rating" switch, on by default because most K-12 schools have none), and sort
- School page: address, level badges, Google rating, website link, **parent reviews**
- Write a review (anonymous, checked by a moderator before it shows), edit or delete your own, report someone else's

Not in this version: location / "near me", compare, Google / Microsoft / phone sign-in, push notifications, admissions forms and chat. Those come next.

## Before you try it: the database
Run `supabase/migrations/20260919000200_school_quality_rules.sql` (in the kidscover-admin repo) in the Supabase SQL Editor. The app asks the database to leave out places that are not schools, and that column does not exist until the migration is run.

## Run it in Snack
1. Open <https://snack.expo.dev> (no account needed).
2. Open `App.js` from this folder, select everything, copy it, and paste it over the Snack's `App.js`.
3. Near the top, replace `PASTE_YOUR_PUBLISHABLE_KEY_HERE` with your **publishable** key (`sb_publishable_...`, the same value as `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the admin project's `.env.local`). Never a secret key.
4. Snack notices the packages the file imports and shows an "Add dependency" prompt for each. Accept them: `@supabase/supabase-js`, `@react-native-async-storage/async-storage`, `react-native-url-polyfill`.
5. Use the **Web** preview, or scan the QR code with the Expo Go app on a phone.

Snack has no way to keep a secret, so the key is pasted into the code. That is fine for the publishable key (it is meant to be public; the database rules protect the data), and it is the reason a secret key must never go there.

## Trying reviews
- A newly written review is **pending**: only its author sees it. To make it appear publicly while testing, run this in the SQL Editor (moderation screens for admins come later):
  ```sql
  update public.school_reviews set status = 'published' where status = 'pending';
  ```
- Your account has to have a confirmed email to write or report a review.
- A parent can review each school once; editing sends the review back to pending.

## Tests
```
npm install
npm test          # 55 logic checks + 65 screen checks
node tests/mutate.mjs   # breaks the app 14 ways on purpose and checks the tests notice
```
The screen tests run the real `App.js` in a simulated browser against a stand-in database that follows the same rules as the real one (unverified accounts blocked, one review per school, pending reviews hidden).
