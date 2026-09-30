# Running GOOYA

## On your iPhone (the real app)

1. Plug the iPhone into this Mac with its cable and unlock it. Tap **Trust** if it asks. Developer Mode must be on (Settings → Privacy & Security → Developer Mode).
2. In Terminal, in this folder: `npm run iphone`.

The first time it makes the native project (`npx expo prebuild`), fetches the libraries (CocoaPods), builds a **Release** build (10–20 minutes), registers the iPhone with HyberTec LLC's team, installs the app and opens it. Later runs rebuild only what changed. The app is signed by the paid team, so it keeps opening for a year without the Mac.

Sign in with Google (goochoi913@gmail.com or evapark7147@gmail.com; any other account is refused). Notifications: allow them when asked (Settings → Notifications in the app turns them on later).

**Tasks, schedules and routines:** the + button makes any of the three. A **task** is something to do (a reminder: done or not). A **schedule** is something happening at a time, like lunch with a friend at 12 PM: it usually has a start and an end, may have only a start, and can repeat. A **routine** is the background of a day (sleep, work): it shades the day view and never goes to Google Calendar, iCloud, the subscription feed or the widget. The day view opens as **Single Day**; the view menu switches to Multi Day or List.

**Apple Reminders (two-way):** Settings (the gear) → Calendar integrations → Apple Reminders → turn on **Sync My Reminders** → **Allow** when iOS asks. Each of your Reminders lists becomes a list in GOOYA, in its own colour (Lists → **My Reminders**; 은비 sees them as “구야's Reminders”). Complete, rename, re-date, re-prioritise, move or delete a reminder in GOOYA and it changes in Reminders; a task added to one of those lists in GOOYA (new tasks go to your default Reminders list) is added to Reminders; a task moved to one of GOOYA's own lists leaves Reminders. Changes made in Reminders come in when GOOYA opens, and at once while it is open; **Sync Now** does it on the spot, and the list under it says what GOOYA last changed in Reminders. When 은비 changes one of your reminders, GOOYA's server wakes your iPhone with a silent push so the change is in Reminders within seconds (this needs the APNs key uploaded in Firebase, see below; iOS may still hold it back, and then it goes the next time GOOYA opens). Only one device per person syncs Reminders: the one where Sync My Reminders was turned on last. Untick lists under **Reminders lists** to leave them out; lists shared with you for viewing are read-only. Repeats are set in the Reminders app. Reminders alerts at a reminder's due time itself, so GOOYA's push is only for early reminders.

**Google Calendar and iCloud (two-way):** Settings → Calendar integrations → connect an account, then choose per calendar: **Import** shows its events in GOOYA; **Two-way** also lets you change, add (the + button → Event) and delete them in GOOYA, and the change is in Google or iCloud within seconds (Google's changes come back as fast; iCloud's within 5 minutes). Read-only calendars (holidays, subscriptions, shared for viewing) offer only Import. **Tasks / Schedules in a GOOYA calendar** keep a calendar named GOOYA in that account with your tasks and schedules (never routines); moving, renaming or deleting one there changes it in GOOYA, and an event you add to that calendar becomes a GOOYA schedule. Only GOOYA's own tasks go there: your reminders are in Apple Calendar already, as Scheduled Reminders.

**The widget:** touch and hold an empty spot on the Home Screen → **Edit** (top left) → **Add Widget** → search **GOOYA** → pick a size → **Add Widget**. It shows tasks, schedules and the events of connected calendars, never routines. Small: today (or what is next). Medium: today's date and what is on now or next, beside the coming days. Large, by **Layout**: **Two Weeks & List** (the default: this week and the next with what is on each day, the list of what is coming under them), **Month & List** (the month with a dot per person and day, then the list) or **Month** (the whole month with up to three things on each day, “+2” when there are more). Something over several days is on each of its days, not one bar across them. Touch and hold the widget → **Edit Widget**: **Show** picks both of you, only you or only 은비; **Appearance** keeps the widget Light or Dark whatever the iPhone's mode is (System follows the iPhone). It also offers Lock Screen sizes. It updates within seconds of a change in the app, and on its own every half hour (from the server, so 은비's additions show up with the app closed); calendars unticked in the app's Calendars screen are left out of it too.

**When things sync:**

| | GOOYA → there | there → GOOYA |
| --- | --- | --- |
| Apple Reminders | seconds (your iPhone writes it) | when GOOYA opens or is open on your iPhone |
| Google Calendar | seconds | seconds (Google tells GOOYA's server), at worst 10 minutes |
| iCloud Calendar | seconds | within 5 minutes (iCloud tells no one; the server looks every 5 minutes) |
| 은비's phone | seconds (both apps read the same data) | seconds |

**Push notifications (alerts, and the silent push that syncs Reminders)** need the APNs key uploaded once: Firebase console → Project settings → **Cloud Messaging** → Apple app configuration (com.hybertec.gooya) → APNs Authentication Key → Upload `AuthKey_U4G9ZZC38S.p8`, Key ID `U4G9ZZC38S`, Team ID `YSK7CHH56P`.

## On the iPhone Simulator

- `npm run iphone:sim` — **demo mode**: made-up tasks, schedules and routines, no sign-in, nothing written to Firestore. Edits to the code show up as you save (Fast Refresh).
- `npm run iphone:sim:live` — the real project. Google sign-in works through the Simulator's browser.

Both make their own simulator ("GOOYA Demo", "GOOYA Live"). Ctrl+C stops the development server; the simulator stays open. Logs: `.expo/logs/`.

## When it won't build

- **"No profiles for com.hybertec.gooya"** / **"Your team has no devices"** — no iPhone was plugged in: Xcode registers the phone and makes the profile the first time `npm run iphone` runs with it connected.
- **"Xcode isn't signed in"** — Xcode → Settings… → Accounts → + → the Apple ID that is on HyberTec LLC's team.
- **Anything native changed** (a package with native code, `app.config.ts`, the Firebase file) — the scripts notice and run `prebuild` again. To force it: `npm run iphone -- --rebuild`.
- **The demo simulator shows stale code after a relaunch** — the development server runs without lazy chunks for this reason; if it still happens, stop it (Ctrl+C) and run `npm run iphone:sim` again.
- **The widget shows "Open GOOYA and sign in"** — the app writes the widget's data when it runs signed in; open the app once. On the Simulator the demo app writes sample data the same way.
- **"Personal development teams do not support the App Groups capability"** — a build for a free Apple team (`APPLE_PERSONAL_TEAM=1`) leaves the widget out on purpose; the HyberTec build has it.

## Checks

```bash
npm run typecheck   # the app, with shared/
npm run lint
npm test            # unit tests: shared/ (recurrence, Reminders merge, calendar copies, widget feed) and the iCloud calendar-data edits
cd functions && npx tsc --noEmit -p tsconfig.json
```
