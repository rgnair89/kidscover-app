# Kidscover parent app (first version)

The whole app is one file, `App.js`, so it can be pasted straight into [snack.expo.dev](https://snack.expo.dev).

## What it does
- Sign in / create an account (email + password)
- **Schools, After-school classes, Colleges**: the list shows schools (preschool to class 12, junior colleges included) by default; music, dance, sports and tuition classes, and degree / engineering / business colleges, each have their own list one tap away
- Search schools by name or area, filter by **level** (Preschool / Primary / Secondary / not stated), **daycare available**, **Google rating** (with an "include schools with no rating" switch, on by default because most K-12 schools have none), and sort
- **Schools near me**: a "Use my location" button (the phone asks permission), the distance on every school, "Nearest first", and "Within 2 / 5 / 10 km"
- **Drive time by car** (after "Use my location"): "Weekday 7:30 am" (school-run traffic) or "Right now", from Google Maps, shown on each school
- A friendlier look: a drawing of a parent walking a child to school on the sign-in screen, warm colours, a welcome banner, and a picture on every school (its photo, or a drawn school in its own colours)
- School page: photo (with its credit), address, level badges, Google rating, website link, **facilities** (library, labs, pool, school bus, teacher-student ratio ...), **achievements** (class 10 / 12 results, placements, alumni, awards, each saying where it came from), **parent reviews**
- Write a review (anonymous, checked by a moderator before it shows), edit or delete your own, report someone else's
- **Ask a school about admissions**: a short form (which class, roughly when, your question), then a conversation with the school under **Enquiries**, with a count of unread replies

Not in this version: compare, Google / Microsoft / phone sign-in, push notifications. Those come next.

## Photos, facilities and achievements
- A school's photo is one the school uploaded, or a free-licensed Wikimedia Commons photo shown with its author and licence. With no photo (or one that does not load) the app shows a drawn school, in colours of its own. The drawings are made in code, so there is nothing to license.
- Facilities and achievements come from the school's own staff, from Kidscover, or from the school's website once an admin accepts them; each says where it came from. If they cannot be read the page simply leaves them out.

## Schools, after-school classes and colleges
- Every place has a category, worked out in the database from its name and Google's type: **school** (preschools, schools, junior colleges), **after-school class** (music, dance, karate, swimming, sports, art, abacus, tuition) or **college** (degree colleges, universities, engineering, business / management, law, medicine, teacher training). A name like "School of Music" or "School of Business" goes by what it teaches, not by the word "school".
- The app opens on Schools. Level, daycare and board filters apply to schools only; on the other two lists they are set aside (not cleared) and come back on Schools. Classes and colleges show no level badges and no "Ask about admissions".
- Places that are not for children stay hidden (driving schools, gyms, IELTS and typing classes, shops, offices).
- The rules will get some places wrong. The Partner Portal's **Categories** tab lists each category and the hidden places with the reason, and an admin can move any place (or hide it, or hand it back to the rules).

## Boards and admission status
- A **Board** filter (CBSE, ICSE, IB, IGCSE, State Board). By default it shows only schools whose board is known; a switch adds the schools whose board is not known yet.
- The school page says where the board comes from ("confirmed by CBSE's own record", "from the school's website", "from the school's name") with a link to the source, and shows an admission notice ("Admissions open for 2027-28, from the school's website, checked Sep 2026") with a link to that page. Cards show an "Admissions open" badge.
- These facts come from the Partner Portal's **School Data** tab: the `read-school-websites` function reads each school's own website, checks CBSE affiliation numbers against CBSE's public record, and an admin accepts or rejects each finding. Nothing is shown to parents without an admin accepting it, and an admission status without a source (the old "closed" default) is never shown.

## Asking about admissions
- An enquiry deliberately does **not** ask for a child's name or date of birth. A class and a rough start year are enough to start a conversation; the school can ask for the rest once it is talking to the family.
- Kidscover staff answer from the Partner Portal for now. The parent sees replies as coming from "the school", never a staff member's name.
- One open enquiry per school at a time (the existing conversation is the place to carry on), at most 10 new enquiries a day, and the account's email has to be confirmed &mdash; the same bar as writing a review.
- Either side can close an enquiry; writing again reopens it.

## Schools near me: what it does and does not do
- Distance is **in a straight line**, not by road. The app says so on screen.
- The position is used only to measure distance. It is rounded to about 100 m, sent to the database function `schools_nearby` (which only reads), and kept in memory: it is not stored in the database, not saved on the phone, and forgotten on sign out or when the app closes.
- If the parent says no to the permission, everything else still works (search by name or area).
- Schools without coordinates are left out of "near me" lists (a distance to them would be a guess) but still show in the normal list.
- A parent outside Mumbai / Thane still gets distances, plus a note that Kidscover only lists that area so far.
- For a real app build (not Snack or Expo Go) the iOS permission text has to be set in `app.json` through the `expo-location` plugin (`locationWhenInUsePermission`).

## Drive time by car
- Nothing goes to Google until the parent taps "Weekday 7:30 am" or "Right now". Then the app asks the `commute-times` edge function (kidscover-admin repo) about the schools on screen, 20 at a time.
- "Weekday 7:30 am" means leaving at 7:30 am India time on the next weekday. Google can plan car trips by departure time only (not "arrive by"), and this is when school-run traffic happens.
- The position (rounded to about 100 m) goes to Google for that calculation only. Kidscover stores a count of lookups per parent per day, never where anyone was. The screen says so.
- Google charges per school looked up, so there are limits (in the database, changeable by an admin): 20 lookups a parent a day and 500 schools a day for the whole app by default. When a parent is down to 3 lookups the app says how many are left.
- A school Google finds no road to shows no drive time rather than a guess. Results are kept in memory while the app is open, so going back to a list costs nothing.
- Setup (once): run `20260919000700_drive_times.sql`, deploy the `commute-times` function, and switch on "Routes API" in Google Cloud for the key already in `GOOGLE_MAPS_API_KEY`. The Partner Portal's "Test drive times" button says which step is missing. Until then the app says drive times are not switched on yet, and distances still work.

## Before you try it: the database
Run these in the Supabase SQL Editor (they live in the kidscover-admin repo, `supabase/migrations/`), then paste the app:
- `20260919000200_school_quality_rules.sql` and `20260919000300_school_quality_rules_v2.sql` - the app asks the database to leave out places that are not schools
- `20260919000400_school_name_sort.sql` - the A to Z list sorts on the `name_sort` column, which does not exist until this is run
- `20260919000500_schools_nearby.sql` - the distance function used by "Use my location". Run it **before** pasting this version of the app. If it is missing the app still works; the button just says that nearby search is not switched on yet
- `20260919000600_admissions_enquiries.sql` - the admissions enquiries and their messages. Run it **before** pasting this version too. Without it, "Ask about admissions" says it is not switched on yet
- `20260919000700_drive_times.sql` - the daily limits for drive times (and deploy the `commute-times` function). Without them drive times say they are not switched on yet
- `20260919000800_school_website_findings.sql` - boards and admission status (and deploy `read-school-websites` for the School Data tab). Run it **before** pasting this version: the app asks for the new columns
- `20260919000900_enquiry_read_marks_for_old_threads.sql` - enquiries made before 600 no longer count as unread for the parent who wrote them
- `20260919001000_school_categories.sql` - sorts every place into school / after-school class / college. Run it and paste this version **together**: the app asks for the category, and an older app would show the newly visible classes and colleges in its one list
- `20260919001200_school_profiles.sql` - photos, facilities and achievements (edited by schools and Kidscover in the Partner Portal, every change logged). Run it **before** pasting this version: the list asks for the photo columns

If the app shows an error mentioning a missing column, one of these has not been run yet.

## Run it in Snack
1. Open <https://snack.expo.dev> (no account needed).
2. Open `App.js` from this folder, select everything, copy it, and paste it over the Snack's `App.js`.
3. Near the top, replace `PASTE_YOUR_PUBLISHABLE_KEY_HERE` with your **publishable** key (`sb_publishable_...`, the same value as `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the admin project's `.env.local`). Never a secret key.
4. Snack notices the packages the file imports and shows an "Add dependency" prompt for each. Accept them: `@supabase/supabase-js`, `@react-native-async-storage/async-storage`, `react-native-url-polyfill`, `expo-location`, `react-native-svg` (the drawings).
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
npm test          # 199 logic checks + 244 screen checks
node tests/mutate.mjs   # breaks the app 141 ways on purpose and checks the tests notice (takes a while;
                        # MUT_RANGE=1-25 runs part of it, so several copies can share the work)
```
The screen tests run the real `App.js` in a simulated browser against a stand-in database that follows the same rules as the real one (unverified accounts blocked, one review per school, pending reviews hidden, distances from schools that have coordinates) a stand-in for the phone's location (allowed, refused, blocked, switched off, never answers, outside Mumbai), and a stand-in for the drive-time function (answers, no road, daily limit, not deployed, no connection). The database side was tested separately against an in-memory Postgres engine &mdash; `schools_nearby` (63 checks), the enquiries rules (88 checks) and the categories (87 checks); those tests are not part of this repo.
