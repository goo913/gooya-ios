# GOOYA (구야) — the iPhone, iPad and Mac app

A private calendar for two: 구야 (America/New_York) and 은비 (Asia/Seoul). This repository holds the **native app** for iPhone, iPad and Mac (Expo / React Native; the Mac app is the same app built with Mac Catalyst) and the **backend** it shares with the earlier web app: the Cloud Functions in `functions/`, the Firestore rules, and the data model and recurrence logic in `shared/`. Same Firebase project (`gooya-37d79`), same two Google accounts, same data.

The app is published through **HyberTec LLC**'s Apple Developer team (`YSK7CHH56P`), as an **unlisted App Store app** (installed from a link, invisible in search), with TestFlight before that. `docs/publishing.md` walks through it.

## What is where

| Path | What |
| --- | --- |
| `src/app/` | The screens (Expo Router): month (`index`), `year`, `day/[date]`, `lists/`, `search`, and the sheets (`sheet/edit`, `sheet/detail`, `settings`, `calendars`, `integrations`, …) |
| `src/views/` | The month grid, the agenda list and the day timeline |
| `src/sheets/` | The task (Reminders-style) and schedule editors |
| `src/components/` | Glass pills (iOS 26 Liquid Glass), grouped rows, segmented control, chips, icons (SF Symbols) |
| `src/lib/` | Firebase (auth, Firestore, push), the occurrence hooks, task/schedule operations, demo data |
| `src/store/` | zustand stores: data, session, preferences (per phone), sheets |
| `src/pad/` | The iPad's calendar (Apple Calendar for iPad), also the Mac's, with the Mac's sidebar |
| `modules/` | GOOYA's native modules: `gooya-reminders` (Apple Reminders, EventKit) and `gooya-mac` (the Mac's toolbar, menus, shortcuts, menu bar agenda, open at login) |
| `plugins/` | `withMac.js`: the config plugin that builds the app for the Mac too |
| `targets/widget/` | The Home Screen widget (WidgetKit, Swift), built into the app by `@bacons/apple-targets`; it reads the feed the app writes into the App Group (`src/lib/widget.ts`). On the Mac it is a desktop widget |
| `shared/` | The model, recurrence (RRULE, time zones), normalisation, the widget feed — shared with the functions |
| `functions/` | Cloud Functions: alerts, push, calendar integrations (Google, iCloud, Reminders bridge, ICS feed), the widget feed |
| `scripts/` | `phone.mjs` (simulator, iPhone, iPad and Mac builds), `publish.mjs` (App Store Connect), `mac-frameworks.sh` (a Mac build step) |
| `docs/` | `running.md`, `publishing.md` |

## Running it

- `npm run iphone` — a Release build on the iPhone plugged into this Mac, signed by HyberTec LLC (keeps running for a year, no Mac needed afterwards). `npm run ipad` the same on an iPad.
- `npm run mac` — the Mac app on this Mac (`~/Applications/GOOYA.app`), with Apple Calendar's window, menus, shortcuts, sidebar and a menu bar agenda.
- `npm run iphone:sim` — the iPhone Simulator in **demo mode** (sample data, no sign-in), with Fast Refresh.
- `npm run iphone:sim:live` — the Simulator on the real project (Google sign-in in the Simulator's browser).
- `npm run phone:setup` — gets a new Mac ready (Firebase file, CocoaPods, Xcode) and says what is left.
- `npm run widget:preview` — draws the Home Screen widget's three sizes (light and dark) into `.expo/widget-preview/` on this Mac, from the demo simulator's calendar, to check its layout without a phone.

See `docs/running.md`. `npm run typecheck`, `npm run lint` and `npm test` (the shared logic's unit tests) run the checks.

## Backend

`npm run deploy:backend` deploys the functions and the Firestore rules/indexes. The functions need their secrets in Secret Manager (`INTEGRATIONS_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`), already set on the project.

Never committed: `firebase/GoogleService-Info.plist` (downloaded by the scripts), `.publish/` (the App Store Connect key), `functions/.env*`, `ios/` (generated).
