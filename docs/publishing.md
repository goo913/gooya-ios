# Publishing GOOYA

How GOOYA gets onto both iPhones through Apple: **TestFlight** first (so 은비 can install it in Korea), then the **App Store as an unlisted app** (installed from a link; never in search, charts or categories; updates arrive by themselves like any App Store app). Everything below is under **HyberTec LLC** (team `YSK7CHH56P`). Written so you can do it alone; nothing needs Claude Code except where it says so.

## What each stage costs and takes

| Stage | Money | Your time | Waiting |
| --- | --- | --- | --- |
| App record, API key, first TestFlight build | Included in the $99/year HyberTec pays | 1 hour | Build processing 10–30 min |
| TestFlight internal testers (you and 은비) | – | 15 min | None: builds reach you within minutes |
| Listing texts, screenshots, privacy policy | – | 1–2 hours | – |
| App Review, first submission | – | 30 min | Usually 24–48 hours |
| Unlisted request | – | 10 min | 1–3 days for Apple's email |
| Every update afterwards | – | 5 min (one command) plus 2 min in App Store Connect | Apple 24–48 h; TestFlight: minutes |

TestFlight alone is not a way to distribute for good: every build stops working after 90 days. The unlisted App Store app has no such limit.

## Part 1: One-time setup on your Mac

1. **Xcode is signed in to the right Apple ID.** Xcode → Settings… → Accounts: the Apple ID that belongs to HyberTec LLC (it already lists Young Corporation of America and your personal team; the scripts always pick HyberTec, never the others).
2. **An App Store Connect API key**, so the publishing command can upload builds without a password. Sign in at https://appstoreconnect.apple.com **as HyberTec LLC** (the team switcher is under your name, top right) → **Users and Access** → **Integrations** → **App Store Connect API** → **Team Keys** → **+** (Generate API Key): name `GOOYA publishing`, access **App Manager** → Generate. Click **Download API Key** (offered once only). Note the **Issuer ID** (top of the page) and the key's **Key ID**. The very first key on a team needs the Account Holder to click **Request Access** on that page first.
3. Put the key where the command looks:

   ```bash
   mkdir -p .publish
   mv ~/Downloads/AuthKey_*.p8 .publish/
   ```

   and create `.publish/appstore.json`:

   ```json
   { "keyId": "XXXXXXXXXX", "issuerId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", "appleId": "" }
   ```

   Leave `appleId` empty until part 2 creates the app. Back the folder up (a password manager): it is the only copy.
4. **Check the Mac can archive and sign:** `npm run publish:iphone -- --dry-run --no-bump`. It builds the App Store version without uploading (10–20 minutes the first time) and ends with `✓ Ready to upload: .expo/publish/ios/GOOYA.ipa`. If it stops at signing with "cloud-managed", the Apple ID in Xcode must be the Account Holder or an Admin of HyberTec LLC. The app carries its Home Screen widget as an extension (`com.hybertec.gooya.widget`) sharing the App Group `group.com.hybertec.gooya`; Xcode registers both, and the group, with the team by itself the first time it signs — nothing to create by hand, and App Store Connect needs no separate record for it.

## Part 2: TestFlight, for you and 은비

1. **Create the app record:** App Store Connect (as HyberTec LLC) → **Apps** → **+** → **New App**: Platforms **iOS**; Name **GOOYA** (if Apple says the name is taken, use **GOOYA 구야**); Primary Language **English (U.S.)**; Bundle ID **com.hybertec.gooya** (it is in the list once a build has been signed; if not, register it at https://developer.apple.com/account/resources/identifiers → + → App IDs, with **Push Notifications** ticked); SKU **gooya**; User Access **Full Access** → **Create**.
2. Click the app → **App Information** → the **General Information** box shows **Apple ID**, a ten-digit number. Put it into `.publish/appstore.json` as `"appleId": "6740123456"`.
3. **Push notifications need an APNs key** (once): https://developer.apple.com/account/resources/authkeys/list (as HyberTec LLC) → **+** → name `GOOYA push`, tick **Apple Push Notifications service (APNs)** → Continue → Register → **Download** (once only). Then Firebase console → project **gooya-37d79** → **Project settings** (gear) → **Cloud Messaging** → under **Apple app configuration**, the iOS app **GOOYA iPhone** → **APNs Authentication Key** → **Upload**: the .p8 file, the Key ID shown on Apple's page, and the Team ID `YSK7CHH56P`. Without this, the app installs fine but alerts never arrive on iPhones.
4. **Upload the first build:** `npm run publish:iphone`. It raises the build number in `release.json`, builds, signs and uploads (15–25 minutes), and ends with `✓ Uploaded GOOYA 1.0.0 (build 2) to App Store Connect`. Commit `release.json` afterwards (ask Claude Code, or it goes with the next change).
5. **Export compliance:** the app says it uses only standard HTTPS encryption, so no question appears. If one does, answer **No** to non-exempt encryption.
6. **Add 은비 as an internal tester** (no Apple review, builds within minutes):
   1. **Users and Access** → **+** → her name, the email of **her Apple ID** (the one on her iPhone), role **Marketing** (the least Apple allows), Apps: **Specific Apps → GOOYA** → **Invite**. She accepts Apple's email and signs in once.
   2. **TestFlight** tab → **+** next to **Internal Testing** → group `Us` → tick **Enable automatic distribution** → **Create**. Add both of you as testers. If the build doesn't show in the group, **+** next to **Builds** → choose it.
   3. On her iPhone (Korea is fine): install **TestFlight** from the App Store, open Apple's invitation → **View in TestFlight** → **Install**. On yours the same, or keep the `npm run iphone` copy.
7. Each build lasts 90 days; with automatic distribution every upload reaches both phones by itself.

## Part 3: The App Store, as an unlisted app

Do this once a TestFlight build is the one you want to keep.

1. **What Apple asks that is not code:**
   - **Sign in with Apple** (guideline 4.8): apps with Google sign-in must offer Sign in with Apple too, unless the app "requires the user to sign in with an existing" account of a specific kind. GOOYA accepts exactly two Google accounts, so say so in the review notes (below); if the reviewer still insists, ask Claude Code to add Sign in with Apple (about a day).
   - **Account deletion** (5.1.1): the app has no sign-up, so nothing to add; the review notes say so.
   - A **privacy policy URL** and a **support URL**: the web app's site (https://gooya-eunbee.web.app/privacy — ask Claude Code to publish a one-page policy there) or any page you control.
2. **Screenshots:** iPhone 6.9" (1320 × 2868). Take them on the Simulator in demo mode: `npm run iphone:sim`, then in the Simulator's menu File → Save Screen (⌘S) on the month, a day, the task editor, lists, settings. Five are plenty.
3. **The store page:** App Store Connect → GOOYA → **1.0 Prepare for Submission**: the screenshots; **Description** ("A private shared calendar for two. Not for the public."); **Keywords** `calendar`; Support and Marketing URL; **Version** `1.0.0`; **Copyright** `2026 HyberTec LLC`; **Build**: the TestFlight build; **App Review Information**: Sign-in required **Yes**, and the demo account (below); contact name, phone, email; **Notes** (paste and adjust):

   > GOOYA is a private calendar for two named people. Sign-in is Google only and accepts exactly two pre-approved Google accounts; there is no sign-up, so no account creation or deletion inside the app. We intend to distribute it as an unlisted app. Reviewer account: <the demo Google account below>.

   **Version Release:** Manually release this version.
4. **The demo account for the reviewer:** a Google account you control, with 2-step verification off. Ask Claude Code to allow it in the app (the allowed emails live in `shared/people.ts`; a third, review-only person is a small change) before submitting, and to remove it after.
5. **App Information:** Category **Productivity**; Content Rights: no third-party content; Age Rating: all "None" → 4+; Privacy Policy URL.
6. **App Privacy** (left menu → Get Started): Contact info (email, name) linked to the user, for app functionality; Identifiers (user ID); no tracking.
7. **Pricing and Availability:** Free; the US and Korea (or all countries).
8. **Submit for Review**. Apple answers within 24–48 hours in most cases; a rejection quotes a guideline number — reply in the same thread or ask Claude Code with the message pasted in.
9. **Ask for unlisted distribution** right after submitting: https://developer.apple.com/contact/request/unlisted-app/ → the app's name, Apple ID number, and why it is for a limited audience ("a private calendar for two family members; sign-in accepts only their two accounts"). Apple emails within a few days.
10. **Release:** when both are approved, **Release This Version**. **Pricing and Availability → App Distribution Methods** then shows the **unlisted link**: send it to 은비; she installs it like any App Store app and gets updates automatically. The TestFlight copy can then go.

## Part 4: Updates

1. Ask Claude Code for the change; it lands in `main`.
2. `npm run publish:iphone` — raises the build number, builds, uploads. Add `-- --version 1.1.0` for a new *version number*, which Apple needs for every App Store release (build numbers alone are enough for TestFlight).
3. App Store Connect → GOOYA → **+** next to iOS App → the new version → pick the build → "What's New" → Submit for Review. TestFlight testers get every build without any of this.
4. Commit `release.json`.

The server (`npm run deploy:backend`) can be deployed the moment code changes; the app reaches phones days later, so the functions keep accepting the previous app version.

## Testing notifications from Firebase itself

Firebase console → **Engage → Messaging** → New campaign → Firebase Notification messages → title and text → **Send test message** → paste the phone's FCM token (ask Claude Code to show it in Settings if needed) → **Test**. The phone shows it within seconds, app closed or open. If the test arrives but the app's own alerts don't, the fault is in the functions or the token stored on the user document; if neither arrives, check the APNs key in Firebase (part 2, step 3) and that the app on the phone is a HyberTec-signed install (TestFlight, App Store or `npm run iphone`).
