#!/usr/bin/env node
/**
 * Publishing GOOYA to App Store Connect with one command (docs/publishing.md explains every step around it):
 *
 *   npm run publish:iphone     builds the App Store version of GOOYA, signed by HyberTec LLC's Apple team, and uploads
 *                              it to App Store Connect (TestFlight, then the App Store as an unlisted app)
 *   npm run publish:mac        the same for the Mac app (the same app, built for the Mac): TestFlight on the Mac
 *
 * Options, after `--` (npm run publish:iphone -- --dry-run):
 *   --dry-run          build and sign, but upload nothing (ends with "Ready to upload" and where the file is)
 *   --no-bump          keep the build number in release.json as it is (every upload normally raises it by one)
 *   --version 1.1.0    set the version people see (release.json) as well; Apple needs a new one per App Store release
 *
 * What the command needs, in .publish/ (git-ignored; back the folder up, it holds a key nothing can replace):
 *   AuthKey_<KEY ID>.p8 and appstore.json { "keyId", "issuerId", "appleId" }   an App Store Connect API key, and the
 *                                                                            app's numeric Apple ID (docs/publishing.md, part 1)
 *
 * The native project is prepared by scripts/phone.mjs (`prepare ios`), exactly as for a phone. Logs go to .expo/logs/.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = (name) => path.join(root, "node_modules", ".bin", name);
const stateDir = path.join(root, ".expo");
const logDir = path.join(stateDir, "logs");
const buildDir = path.join(stateDir, "publish");
const secrets = path.join(root, ".publish");
const releaseFile = path.join(root, "release.json");

const APP_ID = "com.hybertec.gooya";
const APP_NAME = "GOOYA";

/** What differs between publishing the iPhone and iPad app and the Mac app (the same app, built for the Mac). */
const TARGETS = {
  ios: { label: "iPhone and iPad", destination: "generic/platform=iOS", archive: `${APP_NAME}.xcarchive`, exportDir: "ios", ext: ".ipa", type: "ios", logs: "publish-ios", derived: "iphone-build", command: "publish:iphone" },
  // Apple silicon only, as npm run mac builds it (scripts/phone.mjs, MAC_ARCHS).
  mac: { label: "Mac", destination: "generic/platform=macOS,variant=Mac Catalyst", archive: `${APP_NAME}-mac.xcarchive`, exportDir: "mac", ext: ".pkg", type: "macos", logs: "publish-mac", derived: "mac-build", command: "publish:mac", settings: ["ARCHS=arm64"] },
};
/** Where altool looks for an App Store Connect key. */
const ALTOOL_KEYS = path.join(os.homedir(), ".appstoreconnect", "private_keys");

const [command = "help", ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith("--")));
const option = (name) => {
  const i = rest.indexOf(name);
  return i >= 0 && rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[i + 1] : null;
};
const dryRun = flags.has("--dry-run");
const noBump = flags.has("--no-bump");
const newVersion = option("--version");

const step = (text) => console.log(`\n▸ ${text}`);
const ok = (text) => console.log(`  ✓ ${text}`);
const note = (text) => console.log(`  • ${text}`);

class Stop extends Error {}
const stop = (lines) => {
  throw new Stop([lines].flat().join("\n"));
};

function run(cmd, args, { cwd = root, env = process.env, problem } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, stdio: "inherit" });
  if (r.signal === "SIGINT" || r.status === 130) process.exit(130);
  if (r.status === 0) return true;
  if (problem) stop(problem);
  return false;
}
function tail(file, lines = 25) {
  try {
    return fs.readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}
function logFile(name) {
  fs.mkdirSync(logDir, { recursive: true });
  return path.join(logDir, name);
}
const secret = (file) => path.join(secrets, file);
const relative = (file) => path.relative(root, file);

// ---------------------------------------------------------------------------------------------------------------
// The version and build number (release.json), which app.config.ts puts in the native project.

function readRelease() {
  try {
    return JSON.parse(fs.readFileSync(releaseFile, "utf8"));
  } catch {
    stop(`release.json is missing or unreadable. It should say, for example: { "version": "1.0.0", "build": 1 }`);
  }
}

function bumpRelease() {
  const release = readRelease();
  if (newVersion) {
    if (!/^\d+\.\d+\.\d+$/.test(newVersion)) stop(`--version wants three numbers with dots, like 1.1.0 (not "${newVersion}").`);
    release.version = newVersion;
  }
  if (!noBump) release.build = Number(release.build) + 1;
  fs.writeFileSync(releaseFile, `${JSON.stringify(release, null, 2)}\n`);
  ok(`${APP_NAME} ${release.version} (build ${release.build})${noBump ? "" : ": the build number went up in release.json"}`);
  return release;
}

const bumpReminder = (release) => `The version and build number (${release.version}, build ${release.build}) are in release.json: commit that file, so the next release counts on from here.`;

function prepareNative() {
  step("Getting the iPhone project ready (as for a phone)");
  run("node", [path.join(root, "scripts", "phone.mjs"), "prepare", "ios"], { problem: "The project didn't get ready; the lines above say what to do." });
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir, "publish-ios.json"), "utf8"));
  } catch {
    stop("scripts/phone.mjs prepare ios left no .expo/publish-ios.json. Ask Claude Code: \"npm run publish:iphone fails\".");
  }
}

function xcodebuild(args, { cwd, env, log }) {
  return new Promise((resolve) => {
    const file = fs.createWriteStream(log);
    const build = spawn("xcodebuild", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const pretty = fs.existsSync(bin("excpretty")) ? spawn(bin("excpretty"), [], { stdio: ["pipe", "inherit", "inherit"] }) : null;
    let status = null;
    let shown = !pretty;
    const done = () => status !== null && shown && file.end(() => resolve(status === 0));
    for (const stream of [build.stdout, build.stderr]) {
      stream.on("data", (chunk) => {
        file.write(chunk);
        if (pretty) pretty.stdin.write(chunk);
        else process.stdout.write(chunk);
      });
    }
    pretty?.on("close", () => {
      shown = true;
      done();
    });
    build.on("close", (code) => {
      status = code ?? 1;
      pretty?.stdin.end();
      done();
    });
  });
}

function explainXcodeProblem(log, target = TARGETS.ios) {
  const text = fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter((l) => /error|fail|denied|unable|invalid|requires/i.test(l)).join("\n") : "";
  const known = [
    [/PLA Update|Program License Agreement|agreement.*(accept|updated)/i, "Apple needs the team's account holder to accept an updated agreement: sign in at https://developer.apple.com/account and accept it. Then run this again."],
    [/No Accounts?\b|No account for team|not signed in|sign in with your Apple ID/i, "Xcode isn't signed in to the Apple ID that is on HyberTec LLC's team: Xcode → Settings… → Accounts → +. Then run this again."],
    [/Cloud signing permission error|cloud-managed distribution certificates/i, "Apple refused to sign with the team's cloud-managed App Store certificate: the Apple ID signed in to Xcode must be the Account Holder or an Admin of HyberTec LLC."],
    [/Apple Distribution|distribution certificate|No signing certificate "iOS Distribution"/i, "Your Apple ID may not create the team's App Store signing certificate. As the team's Account Holder or Admin this works by itself; otherwise ask for the Admin role."],
    [/No profiles for|requires a provisioning profile|provisioning profile/i, "Xcode couldn't set up the App Store signing. Check Xcode → Settings… → Accounts lists the Apple ID with HyberTec LLC, then run this again."],
    [/authentication|Unable to authenticate|invalid API key|AuthKey|issuer/i, "App Store Connect refused the API key. Check .publish/appstore.json (keyId, issuerId) and that AuthKey_<keyId>.p8 is the key downloaded for it (docs/publishing.md, part 1)."],
    [/Bundle ID .* not (found|registered)|No App ID|application identifier .* not found/i, `App Store Connect has no app with the bundle id ${APP_ID} yet: create it first (docs/publishing.md, part 2), then run this again.`],
  ];
  const match = known.find(([pattern]) => pattern.test(text));
  return [...(match ? [match[1]] : ["The lines above say what went wrong."]), `The whole log: ${relative(log)}. Or ask Claude Code: "npm run ${target.command} fails", with that file.`];
}

const API_KEY_STEPS = [
  "  1. Sign in at https://appstoreconnect.apple.com → Users and Access → Integrations → App Store Connect API → Team Keys → + .",
  '  2. Name it "GOOYA publishing", access App Manager, Generate. Click Download API Key (Apple offers it once only).',
  "  3. Move the downloaded AuthKey_XXXXXXXXXX.p8 into .publish/ (make the folder if it isn't there).",
  "  4. Create .publish/appstore.json with the Key ID, the Issuer ID (top of that page) and the app's Apple ID (App Store Connect → the app → App Information):",
  '     { "keyId": "XXXXXXXXXX", "issuerId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", "appleId": "1234567890" }',
  "  Then run this again. docs/publishing.md, part 1, has the same in detail.",
];

function appStoreCredentials() {
  const file = secret("appstore.json");
  if (!fs.existsSync(file)) {
    if (dryRun) {
      note("No App Store Connect key yet (.publish/appstore.json): fine for a dry run, which builds and signs with the Apple ID Xcode is signed in to and uploads nothing.");
      return null;
    }
    stop(["Uploading to App Store Connect needs an App Store Connect API key, made once:", ...API_KEY_STEPS]);
  }
  let creds;
  try {
    creds = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    stop([".publish/appstore.json isn't valid JSON. It should look like:", API_KEY_STEPS[4]]);
  }
  const keyId = String(creds.keyId ?? "").trim();
  const issuerId = String(creds.issuerId ?? "").trim();
  const appleId = String(creds.appleId ?? "").trim();
  if (!keyId || !issuerId) stop([".publish/appstore.json needs keyId and issuerId:", ...API_KEY_STEPS]);
  const key = secret(`AuthKey_${keyId}.p8`);
  if (!fs.existsSync(key)) stop([`The key file for ${keyId} is missing: it should be ${relative(key)} (the .p8 downloaded when the key was made; if it is lost, make a new key).`, ...API_KEY_STEPS]);
  if (!appleId && !dryRun) stop(['.publish/appstore.json needs "appleId": the app\'s numeric Apple ID, from App Store Connect → the app → App Information → General Information. Create the app there first if it isn\'t (docs/publishing.md, part 2).']);
  return { keyId, issuerId, appleId, key };
}

async function publish(target) {
  step("The version and build number");
  const release = bumpRelease();
  const creds = appStoreCredentials();
  const prepared = prepareNative();
  const env = { ...process.env, ...prepared.env };
  const iosDir = path.join(root, "ios");
  fs.mkdirSync(buildDir, { recursive: true });
  const archive = path.join(buildDir, target.archive);
  const exportDir = path.join(buildDir, target.exportDir);
  fs.rmSync(archive, { recursive: true, force: true });
  fs.rmSync(exportDir, { recursive: true, force: true });
  // Signing goes through the Apple ID Xcode is signed in to (HyberTec LLC's Account Holder may use Apple's cloud-managed
  // App Store certificate). The API key is for the upload; it signs only when Xcode's account can't.
  const keyAuth = creds ? ["-authenticationKeyPath", creds.key, "-authenticationKeyID", creds.keyId, "-authenticationKeyIssuerID", creds.issuerId] : [];
  const signed = async (args, log) => {
    if (await xcodebuild(args, { cwd: iosDir, env, log })) return { ok: true, log };
    if (!creds) return { ok: false, log };
    note("Xcode's Apple ID couldn't do it; trying again with the App Store Connect key.");
    return { ok: await xcodebuild([...args, ...keyAuth], { cwd: iosDir, env, log: log.replace(/\.log$/, "-key.log") }), log };
  };

  step(`Building ${APP_NAME} ${release.version} (build ${release.build}) for the App Store (${target.label}), signed by ${prepared.team.name} (10 to 20 minutes the first time)`);
  const archived = await signed(
    ["-workspace", prepared.workspace, "-scheme", prepared.scheme, "-configuration", "Release", "-destination", target.destination, "-archivePath", archive,
      "-derivedDataPath", path.join(stateDir, target.derived), "-allowProvisioningUpdates", `DEVELOPMENT_TEAM=${prepared.team.id}`, "CODE_SIGN_STYLE=Automatic", "COMPILER_INDEX_STORE_ENABLE=NO", ...(target.settings ?? []), "archive"],
    logFile(`${target.logs}-archive.log`),
  );
  if (!archived.ok) stop(["The App Store build didn't finish.", ...explainXcodeProblem(archived.log, target)]);
  ok(`Archived: ${relative(archive)}`);

  step(`Signing it for the App Store (the ${target.ext} Apple takes)`);
  const options = path.join(buildDir, "ExportOptions.plist");
  fs.writeFileSync(
    options,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>export</string>
  <key>teamID</key><string>${prepared.team.id}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
`,
  );
  const exported = await signed(["-exportArchive", "-archivePath", archive, "-exportPath", exportDir, "-exportOptionsPlist", options, "-allowProvisioningUpdates"], logFile(`${target.logs}-export.log`));
  const built = fs.existsSync(exportDir) ? fs.readdirSync(exportDir).find((f) => f.endsWith(target.ext)) : null;
  if (!exported.ok || !built) stop(["The build didn't get signed for the App Store.", ...explainXcodeProblem(exported.log, target)]);
  const file = path.join(exportDir, built);
  ok(`Signed: ${relative(file)}`);

  if (dryRun) {
    console.log(`\n✓ Ready to upload: ${relative(file)} (${APP_NAME} ${release.version}, build ${release.build}). Nothing was sent to Apple (--dry-run).`);
    console.log(`  ${bumpReminder(release)}\n`);
    return;
  }

  step("Uploading it to App Store Connect");
  fs.mkdirSync(ALTOOL_KEYS, { recursive: true });
  fs.copyFileSync(creds.key, path.join(ALTOOL_KEYS, path.basename(creds.key)));
  const uploadLog = logFile(`${target.logs}-upload.log`);
  const upload = spawnSync(
    "xcrun",
    ["altool", "--upload-package", file, "--type", target.type, "--apple-id", creds.appleId, "--bundle-id", APP_ID, "--bundle-version", String(release.build), "--bundle-short-version-string", release.version,
      "--api-key", creds.keyId, "--api-issuer", creds.issuerId, "--output-format", "json"],
    { env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  fs.writeFileSync(uploadLog, `${upload.stdout ?? ""}\n${upload.stderr ?? ""}`);
  let result = null;
  try {
    result = JSON.parse(upload.stdout);
  } catch {
    /* not JSON: the log has it */
  }
  const errors = result?.["product-errors"] ?? [];
  if (upload.status !== 0 || errors.length) {
    const messages = errors.map((e) => e.message ?? JSON.stringify(e));
    const known = messages.find((m) => /already been used|bundle version must be higher|previously uploaded/i.test(m))
      ? "Apple already has a build with this number: run the command again without --no-bump, so the build number goes up."
      : messages.find((m) => /No suitable application records|could not find|not found/i.test(m))
        ? target === TARGETS.mac
          ? `App Store Connect has no Mac version of ${APP_NAME} yet: in App Store Connect open ${APP_NAME}, add the macOS platform (the + beside "iOS App" in the sidebar, then macOS), and run this again.`
          : `App Store Connect has no app for this Apple ID (${creds.appleId}) and bundle id: check "appleId" in .publish/appstore.json against App Store Connect → the app → App Information.`
        : messages.find((m) => /authentic|API key|issuer|unauthorized|403|401/i.test(m))
          ? "App Store Connect refused the API key: check keyId and issuerId in .publish/appstore.json, and that the key has App Manager access."
          : null;
    stop(["The upload to App Store Connect didn't go through:", ...messages.map((m) => `  ${m}`), ...(known ? [known] : []), tail(uploadLog, 6), `The whole answer: ${relative(uploadLog)}. Or ask Claude Code: "npm run ${target.command} fails".`]);
  }
  console.log(`\n✓ Uploaded ${APP_NAME} ${release.version} (build ${release.build}) to App Store Connect. In 10–30 minutes it appears under TestFlight; Apple emails when it is ready.`);
  console.log(`  ${bumpReminder(release)}\n`);
}

function help() {
  const header = fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0];
  console.log(header.replace(/^#!.*\n\/\*\*\n/, "").replace(/^ \* ?/gm, ""));
}

try {
  if (process.platform !== "darwin") stop("Publishing runs on a Mac (Xcode).");
  if (command === "iphone" || command === "ios") await publish(TARGETS.ios);
  else if (command === "mac") await publish(TARGETS.mac);
  else help();
} catch (e) {
  if (!(e instanceof Stop)) throw e;
  console.error(`\n✗ ${e.message}\n`);
  process.exit(1);
}
