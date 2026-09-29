# Running GOOYA

## On your iPhone (the real app)

1. Plug the iPhone into this Mac with its cable and unlock it. Tap **Trust** if it asks. Developer Mode must be on (Settings → Privacy & Security → Developer Mode).
2. In Terminal, in this folder: `npm run iphone`.

The first time it makes the native project (`npx expo prebuild`), fetches the libraries (CocoaPods), builds a **Release** build (10–20 minutes), registers the iPhone with HyberTec LLC's team, installs the app and opens it. Later runs rebuild only what changed. The app is signed by the paid team, so it keeps opening for a year without the Mac.

Sign in with Google (goochoi913@gmail.com or evapark7147@gmail.com; any other account is refused). Notifications: allow them when asked (Settings → Notifications in the app turns them on later).

**Apple Reminders:** Settings (the gear) → Calendar integrations → Apple Reminders → turn on **Show My Reminders** → **Allow** when iOS asks. Your reminders appear in the “Apple Reminders” list and on the calendar (for both of you), and completing, renaming or re-dating one in GOOYA changes it in Reminders. It syncs whenever GOOYA opens; **Sync Now** does it on the spot. Pick which Reminders lists show under **Reminders lists**. (No Shortcut is needed any more.)

**The widget:** touch and hold an empty spot on the Home Screen → **Edit** (top left) → **Add Widget** → search **GOOYA** → pick a size → **Add Widget**. Small: today (or what is next). Medium: today's date and schedules, then the week's tasks. Large: the month with a dot per person and day, then the next tasks. It also offers Lock Screen sizes. Touch and hold the widget → **Edit Widget** → **Show** picks both of you, only you or only 은비. It updates within seconds of a change in the app, and on its own every half hour (from the server, so 은비's additions show up with the app closed).

## On the iPhone Simulator

- `npm run iphone:sim` — **demo mode**: made-up tasks and schedules, no sign-in, nothing written to Firestore. Edits to the code show up as you save (Fast Refresh).
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
npm test            # shared/ unit tests (recurrence, normalisation, widget feed)
cd functions && npx tsc --noEmit -p tsconfig.json
```
