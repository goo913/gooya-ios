#!/usr/bin/env node
/**
 * GOOYA on an iPhone or the iPhone Simulator with one command (docs/running.md explains every step):
 *
 *   npm run ipad              the same on the iPad plugged into this Mac (GOOYA is one app for both; the iPad has its layout)
 *   npm run mac               GOOYA's Mac app on this Mac: a Release build for the Mac (Mac Catalyst), signed by HyberTec
 *                             LLC's Apple team, put in your Applications folder (~/Applications) and opened
 *   npm run iphone            the iPhone plugged into this Mac: a Release build of the real app, signed by HyberTec LLC's
 *                             Apple team, installed over the cable. Runs on its own afterwards, no Mac needed.
 *   npm run iphone:sim        the iPhone Simulator, in demo mode (sample data, no sign-in), with the development server
 *   npm run iphone:sim:live   the iPhone Simulator on the real project (Google sign-in in the Simulator's browser)
 *   npm run phone:setup       gets this Mac ready (Firebase file, CocoaPods, Xcode) and says what is left
 *
 * scripts/publish.mjs uses `prepare ios` here to get the native project ready the same way, so the App Store gets
 * what a phone gets.
 *
 * Options, after `--`: --rebuild makes the native project again and builds the app from scratch.
 */
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = (name) => path.join(root, "node_modules", ".bin", name);
const stateDir = path.join(root, ".expo");
const logDir = path.join(stateDir, "logs");
const stateFile = path.join(stateDir, "phone.json");

/** The real app's id (app.config.ts), registered in Firebase as "GOOYA iPhone". */
const APP_ID = "com.hybertec.gooya";
const APP_NAME = "GOOYA";
const PROJECT = "gooya-37d79";
const FIREBASE_IOS_APP = "1:557110398546:ios:cc1ab8ac295062675e598b";
/** HyberTec LLC's Apple team: the one that signs the real app. */
const TEAM = { id: process.env.APPLE_TEAM_ID || "YSK7CHH56P", name: "HyberTec LLC" };
const SIMULATOR = { demo: "GOOYA Demo", live: "GOOYA Live" };
const METRO_PORT = 8081;
const PLIST = path.join(root, "firebase", "GoogleService-Info.plist");

const [command = "help", ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith("--")));
const names = rest.filter((a) => !a.startsWith("--"));
const onSim = flags.has("--sim");
const live = flags.has("--live") || !onSim;
const rebuild = flags.has("--rebuild");

const step = (text) => console.log(`\n▸ ${text}`);
const ok = (text) => console.log(`  ✓ ${text}`);
const note = (text) => console.log(`  • ${text}`);

class Stop extends Error {}
const stop = (lines) => {
  throw new Stop([lines].flat().join("\n"));
};
class Interrupted extends Error {}

function run(cmd, args, { cwd = root, env = process.env, problem, input } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, input, stdio: [input === undefined ? "inherit" : "pipe", "inherit", "inherit"] });
  if (r.signal === "SIGINT" || r.signal === "SIGTERM" || r.status === 130) throw new Interrupted();
  if (r.status === 0) return true;
  if (problem) stop(problem);
  return false;
}
function read(cmd, args, { cwd = root, env = process.env, input } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, input, encoding: "utf8", stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
  return r.status === 0 ? r.stdout : null;
}
const has = (cmd) => spawnSync("/bin/sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" }).status === 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function responds(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
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
const readState = () => {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return {};
  }
};
const writeState = (state) => {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
};

// ---------------------------------------------------------------------------------------------------------------
// What every command checks first: the packages and the real project's Firebase file.

function ensurePackages() {
  if (fs.existsSync(path.join(root, "node_modules", "expo", "package.json"))) return;
  step("Installing the app's packages (npm install)");
  run("npm", ["install"], { problem: "npm install failed (the lines above say why)." });
}

const complete = (f) => fs.existsSync(f) && /<key>REVERSED_CLIENT_ID<\/key>/.test(fs.readFileSync(f, "utf8"));

/** firebase/GoogleService-Info.plist for the real app, downloaded once with the Firebase CLI. */
async function ensureFirebaseFile() {
  if (complete(PLIST)) return;
  step("Downloading the Firebase file for GOOYA iPhone (firebase/GoogleService-Info.plist)");
  if (!has("firebase")) stop(["The Firebase CLI is needed once: npm install -g firebase-tools, then firebase login (with goochoi913@gmail.com). Then run this again."]);
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  const temp = `${PLIST}.download`;
  for (let i = 0; i < 6 && !complete(PLIST); i++) {
    fs.rmSync(temp, { force: true });
    const out = read("firebase", ["apps:sdkconfig", "IOS", FIREBASE_IOS_APP, "--project", PROJECT]);
    if (out) {
      const xml = out.slice(out.indexOf("<?xml"));
      fs.writeFileSync(temp, xml);
      if (complete(temp)) fs.renameSync(temp, PLIST);
    }
    if (!complete(PLIST)) await sleep(5000);
  }
  fs.rmSync(temp, { force: true });
  if (!complete(PLIST)) stop(["The Firebase file couldn't be downloaded. Run: firebase login, then run this again."]);
  ok("firebase/GoogleService-Info.plist");
}

// ---------------------------------------------------------------------------------------------------------------
// Xcode, CocoaPods, the simulator's system.

function developerDir() {
  if (process.env.DEVELOPER_DIR) return process.env.DEVELOPER_DIR;
  const selected = read("xcode-select", ["-p"])?.trim();
  if (selected?.includes(".app/")) return selected;
  return fs.existsSync("/Applications/Xcode.app") ? "/Applications/Xcode.app/Contents/Developer" : null;
}

function xcode() {
  const dir = developerDir();
  if (!dir || !fs.existsSync(dir)) stop(["Xcode isn't installed. Install it from the Mac App Store, open it once and click Agree. Then run this again."]);
  const env = { ...process.env, DEVELOPER_DIR: dir };
  const version = spawnSync("xcodebuild", ["-version"], { env, encoding: "utf8" });
  if (version.status !== 0) stop(["Xcode needs you to agree to its licence once: open Xcode, click Agree. Then run this again."]);
  return env;
}

function ensureCocoaPods() {
  if (has("pod")) return;
  if (!has("brew")) stop(["The iPhone app needs CocoaPods, which Homebrew installs. Install Homebrew (https://brew.sh), then run this again."]);
  step("Installing CocoaPods (it fetches the iPhone app's libraries)");
  run("brew", ["install", "cocoapods"], { problem: "Installing CocoaPods failed (the lines above say why)." });
}

function iosRuntimes(env) {
  const json = read("xcrun", ["simctl", "list", "--json", "runtimes", "available"], { env });
  const runtimes = JSON.parse(json ?? '{"runtimes":[]}').runtimes.filter((r) => r.platform === "iOS" || r.name?.startsWith("iOS"));
  const key = (r) => r.version.split(".").map((n) => n.padStart(4, "0")).join(".");
  return runtimes.sort((a, b) => key(b).localeCompare(key(a)));
}

/** The newest standard iPhone Pro the newest iOS runs (the size the owner carries). */
function pickIphone(runtime) {
  const iphones = (runtime.supportedDeviceTypes ?? []).filter((t) => t.productFamily === "iPhone");
  const number = (t) => Number(/\d+/.exec(t.name)?.[0] ?? 0);
  const wanted = iphones.filter((t) => /^iPhone \d+ Pro$/.test(t.name)).sort((a, b) => number(b) - number(a));
  return wanted[0] ?? iphones.at(-1);
}

// ---------------------------------------------------------------------------------------------------------------
// The native project (ios/), made again only when what it is built from changed.

/** What the app is told when it starts (EXPO_PUBLIC_* values src/lib/env.ts reads). */
function appSettings(mode) {
  return mode === "demo" ? { EXPO_PUBLIC_DEMO: "1", EXPO_PUBLIC_DEMO_ME: process.env.EXPO_PUBLIC_DEMO_ME || "gooya" } : { EXPO_PUBLIC_DEMO: "0" };
}

function nativeFingerprint(env) {
  const h = crypto.createHash("sha256");
  for (const f of ["package.json", "package-lock.json", "app.config.ts", "release.json"]) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) h.update(fs.readFileSync(p));
  }
  if (fs.existsSync(PLIST)) h.update(fs.readFileSync(PLIST));
  // The widget's Swift code and settings (targets/), GOOYA's own native modules (modules/) and config plugins (plugins/,
  // the Mac's) shape the native project.
  for (const dir of ["targets", "modules", "plugins"]) {
    const base = path.join(root, dir);
    if (!fs.existsSync(base)) continue;
    for (const f of fs.readdirSync(base, { recursive: true }).map(String).sort()) {
      const file = path.join(base, f);
      if (fs.statSync(file).isFile()) h.update(`${dir}/${f}\n`).update(fs.readFileSync(file));
    }
  }
  for (const key of ["APP_ID", "APPLE_TEAM_ID", "APPLE_PERSONAL_TEAM", "GOOGLE_SERVICES_PLIST"]) h.update(`${key}=${env[key] ?? ""}\n`);
  return h.digest("hex").slice(0, 16);
}

function ensureNativeProject(env) {
  const fingerprint = nativeFingerprint(env);
  const state = readState();
  if (rebuild || state.project !== fingerprint || !fs.existsSync(path.join(root, "ios"))) {
    step("Making the iPhone project (npx expo prebuild) and fetching its libraries (pod install)");
    run(bin("expo"), ["prebuild", "--platform", "ios", "--clean"], { env: { ...env, CI: "1" }, problem: ["The iPhone project couldn't be made; the lines above say why.", "Or ask Claude Code: \"npm run iphone fails at prebuild\"."] });
    writeState({ ...state, project: fingerprint, installed: {} });
  }
  return fingerprint;
}

function workspace() {
  const iosDir = path.join(root, "ios");
  const ws = fs.readdirSync(iosDir).find((f) => f.endsWith(".xcworkspace"));
  if (!ws) stop("ios/ has no .xcworkspace: run npm run iphone -- --rebuild.");
  return { iosDir, workspace: ws, scheme: ws.replace(/\.xcworkspace$/, "") };
}

/** xcodebuild with its output whole in `log` and readable on screen. */
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

/** What to do when a device says Developer Mode is off (iOS asks twice: the switch, then Turn On after the restart). */
const developerModeSteps = (kind) => [
  `Developer Mode is off on the ${kind}, as far as Xcode can tell. On the ${kind}:`,
  "  1. Settings → Privacy & Security → Developer Mode (at the bottom) → on → Restart.",
  `  2. After it restarts, unlock it: it asks "Turn On Developer Mode?" → Turn On, and enter the passcode.`,
  `  3. Unplug the cable and plug it in again (Xcode reads the setting when the ${kind} connects), keep the ${kind} unlocked, and run this again.`,
];

function explainXcodeProblem(log, kind = "iPhone") {
  const text = fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter((l) => /error|fail|denied|unable|invalid|requires/i.test(l)).join("\n") : "";
  const known = [
    [/PLA Update|Program License Agreement|agreement.*(accept|updated)/i, "Apple needs the team's account holder to accept an updated agreement: sign in at https://developer.apple.com/account and accept it. Then run this again."],
    [/No Accounts?\b|No account for team|not signed in|sign in with your Apple ID/i, "Xcode isn't signed in to the Apple ID that is on HyberTec LLC's team: Xcode → Settings… → Accounts → +. Then run this again."],
    [/Developer Mode/i, developerModeSteps(kind).join("\n")],
    [/device is locked|is passcode protected/i, `Unlock the ${kind} and keep it unlocked while the app installs, then run this again.`],
    [/cannot be registered to your development team|identifier .* is not available/i, `The app id ${APP_ID} is taken by another Apple team. Ask Claude Code: "the app id is taken".`],
    [/No profiles for|requires a provisioning profile|provisioning profile|No signing certificate/i, `Xcode couldn't set up the signing for team ${TEAM.id} (${TEAM.name}). Check Xcode → Settings… → Accounts lists the Apple ID with that team, then run this again.`],
    [/Cloud signing permission error|cloud-managed distribution certificates/i, "Apple refused the team's cloud-managed App Store certificate: the Apple ID in Xcode must be an Admin on HyberTec LLC's team, or have \"Access to Cloud Managed Distribution Certificate\" in App Store Connect → Users and Access."],
  ];
  const match = known.find(([pattern]) => pattern.test(text));
  return [...(match ? [match[1]] : ["The lines above say what went wrong."]), `The whole log: ${path.relative(root, log)}. Or ask Claude Code: "npm run ${kind.toLowerCase()} fails", with that file.`];
}

// ---------------------------------------------------------------------------------------------------------------
// The simulator: a development build, and the development server (Metro) feeding it the app's code.

function simulator(mode, env) {
  const name = SIMULATOR[mode];
  const listed = read("xcrun", ["simctl", "list", "--json", "devices", "available"], { env });
  const found = Object.values(JSON.parse(listed ?? '{"devices":{}}').devices).flat().find((d) => d.name === name);
  let udid = found?.udid;
  if (!udid) {
    const runtime = iosRuntimes(env)[0];
    const type = runtime && pickIphone(runtime);
    if (!type) stop("Xcode has no iPhone simulators. Open Xcode → Settings… → Components, click Get next to iOS, then run this again.");
    udid = read("xcrun", ["simctl", "create", name, type.identifier, runtime.identifier], { env })?.trim();
    if (!udid) stop(`Making the simulator "${name}" failed.`);
    ok(`Made the simulator "${name}": ${type.name}, ${runtime.name}`);
  }
  step(`Opening the iPhone Simulator ("${name}")`);
  read("xcrun", ["simctl", "boot", udid], { env });
  read("xcrun", ["simctl", "bootstatus", udid], { env });
  spawnSync("open", ["-a", path.join(env.DEVELOPER_DIR, "Applications", "Simulator.app"), "--args", "-CurrentDeviceUDID", udid]);
  return { udid, name, hasApp: () => read("xcrun", ["simctl", "get_app_container", udid, APP_ID], { env }) !== null };
}

function devClientUrl(port) {
  return `gooya://expo-development-client/?url=${encodeURIComponent(`http://127.0.0.1:${port}`)}`;
}

async function iphoneSim() {
  const mode = live ? "live" : "demo";
  ensurePackages();
  const xenv = xcode();
  ensureCocoaPods();
  if (live) await ensureFirebaseFile();
  else if (!complete(PLIST)) note("No firebase/GoogleService-Info.plist yet: the demo build carries the placeholder, which is fine for demo mode.");
  const env = { ...xenv, ...appSettings(mode) };
  const sim = simulator(mode, env);
  const fingerprint = ensureNativeProject(env);
  const state = readState();
  const installed = state.installed ?? {};
  if (rebuild || installed[sim.udid] !== fingerprint || !sim.hasApp()) {
    step(`Building ${APP_NAME} for the simulator (10 to 20 minutes the first time)`);
    run(bin("expo"), ["run:ios", "--device", sim.udid, "--no-bundler", ...(rebuild ? ["--no-build-cache"] : [])], { env, problem: ["The simulator build didn't finish; the lines above say why.", "Or ask Claude Code: \"npm run iphone:sim fails\"."] });
    installed[sim.udid] = fingerprint;
    writeState({ ...readState(), installed });
  } else ok("The app is already built for this simulator (nothing native changed)");

  step(`Starting the development server (${mode === "demo" ? "demo mode: sample data, no sign-in" : "the real project"})`);
  const log = logFile(`metro-${mode}.log`);
  const out = fs.openSync(log, "w");
  // One bundle per load (no lazy chunks): the development client otherwise keeps stale chunks across relaunches.
  // Not in CI mode: that turns file watching off, and edits would never reach the app. No terminal is attached, so it
  // asks nothing either way.
  const metro = spawn(bin("expo"), ["start", "--port", String(METRO_PORT), "--clear"], { env: { ...env, EXPO_NO_TELEMETRY: "1", EXPO_NO_METRO_LAZY: "1" }, stdio: ["ignore", out, out] });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    up = await responds(`http://127.0.0.1:${METRO_PORT}/status`);
    if (!up) await sleep(1000);
  }
  if (!up) {
    metro.kill("SIGINT");
    stop([`The development server didn't start. Its log: ${path.relative(root, log)}`, tail(log, 12)]);
  }
  read("xcrun", ["simctl", "terminate", sim.udid, APP_ID], { env });
  read("xcrun", ["simctl", "openurl", sim.udid, devClientUrl(METRO_PORT)], { env });
  console.log(`\n✓ ${APP_NAME} is open on ${sim.name} (${mode === "demo" ? "demo mode" : "the real project"}). Edits to the code show up as you save.`);
  console.log(`  Ctrl+C stops the development server; the simulator stays open. The server's log: ${path.relative(root, log)}\n`);
  await new Promise((resolve) => {
    const end = () => {
      metro.kill("SIGINT");
      resolve();
    };
    process.on("SIGINT", end);
    process.on("SIGTERM", end);
    metro.on("close", resolve);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// A real iPhone (or iPad: npm run ipad): a Release build, signed by HyberTec LLC, installed over the cable.

function connectedIphone(env, kind = "iPhone") {
  const out = path.join(os.tmpdir(), `gooya-devices-${process.pid}.json`);
  spawnSync("xcrun", ["devicectl", "list", "devices", "--json-output", out], { env, stdio: "ignore" });
  let devices = [];
  try {
    devices = JSON.parse(fs.readFileSync(out, "utf8")).result.devices;
  } catch {
    /* none */
  }
  fs.rmSync(out, { force: true });
  const iphones = devices.filter((d) => d.hardwareProperties?.deviceType === kind && !["virtual", "simulated"].includes(d.hardwareProperties?.reality) && d.connectionProperties?.transportType !== "sameMachine");
  const reachable = (d) => d.connectionProperties?.tunnelState === "connected" || d.connectionProperties?.transportType === "wired";
  const phone = iphones.find(reachable) ?? iphones.find((d) => d.connectionProperties?.transportType);
  if (!phone) {
    stop([
      `No ${kind} is plugged in. Plug your ${kind} into this Mac with its cable and unlock it.`,
      `If the ${kind} asks "Trust This Computer?", tap Trust and enter its passcode. If the Mac asks to allow the accessory to connect, click Allow.`,
      "Then run this again. (For the iPhone Simulator instead: npm run iphone:sim)",
    ]);
  }
  const name = phone.deviceProperties?.name ?? `your ${kind}`;
  if (phone.connectionProperties?.pairingState && phone.connectionProperties.pairingState !== "paired") stop([`${name} doesn't trust this Mac yet. Unlock it, and when it asks "Trust This Computer?", tap Trust. Then run this again.`]);
  if (phone.deviceProperties?.developerModeStatus === "disabled") stop(developerModeSteps(kind));
  const udid = phone.hardwareProperties?.udid ?? phone.identifier;
  // What Xcode itself says of the device (it can still call Developer Mode off after the switch was turned on, until
  // the device is plugged in again): said now, instead of after a build that waits for the device and gives up.
  const problem = xcodeDeviceProblem(env, udid);
  if (problem) stop(/Developer Mode/i.test(problem) ? developerModeSteps(kind) : [`Xcode can't use ${name} yet: ${problem}`, `Unlock the ${kind}, unplug it and plug it in again, then run this again.`]);
  return { name, udid };
}

/** Xcode's own reason a device can't be built for (xcdevice), or null. */
function xcodeDeviceProblem(env, udid) {
  const out = read("xcrun", ["xcdevice", "list", "--timeout", "8"], { env });
  if (!out) return null;
  try {
    const device = JSON.parse(out.slice(out.indexOf("["))).find((d) => d.identifier === udid);
    const error = device?.error;
    // "preparing the device for development" goes on by itself while it stays unlocked.
    if (!error || /prepar/i.test(`${error.description ?? ""} ${error.failureReason ?? ""}`)) return null;
    return [error.description, error.recoverySuggestion].filter(Boolean).join(" ");
  } catch {
    return null;
  }
}

function readProfile(file) {
  const plist = fs.existsSync(file) ? read("security", ["cms", "-D", "-i", file]) : null;
  if (!plist) return null;
  const expires = /<key>ExpirationDate<\/key>\s*<date>([^<]+)<\/date>/.exec(plist)?.[1];
  return { expires: expires ? new Date(expires) : null };
}

async function iphone(kind = "iPhone") {
  ensurePackages();
  const xenv = xcode();
  ensureCocoaPods();
  await ensureFirebaseFile();
  const env = { ...xenv, ...appSettings("live") };
  const phone = connectedIphone(env, kind);
  ensureNativeProject(env);
  const { iosDir, workspace: ws, scheme } = workspace();
  step(`Building ${APP_NAME} for ${phone.name}, signed by the Apple team "${TEAM.name}" (10 to 20 minutes the first time)`);
  const log = logFile("iphone-build.log");
  const derived = path.join(stateDir, "iphone-build");
  const built = await xcodebuild(
    ["-workspace", ws, "-scheme", scheme, "-configuration", "Release", "-destination", `id=${phone.udid}`, "-derivedDataPath", derived,
      "-allowProvisioningUpdates", "-allowProvisioningDeviceRegistration", `DEVELOPMENT_TEAM=${TEAM.id}`, "CODE_SIGN_STYLE=Automatic", "COMPILER_INDEX_STORE_ENABLE=NO", "build"],
    { cwd: iosDir, env, log },
  );
  if (!built) stop([`The app didn't build for ${phone.name}.`, ...explainXcodeProblem(log, kind)]);
  const app = path.join(derived, "Build", "Products", "Release-iphoneos", `${scheme}.app`);
  step(`Installing it on ${phone.name} (keep the ${kind} unlocked)`);
  const installLog = logFile("iphone-install.log");
  const installed = spawnSync("xcrun", ["devicectl", "device", "install", "app", "--device", phone.udid, app], { env, encoding: "utf8" });
  fs.writeFileSync(installLog, `${installed.stdout ?? ""}${installed.stderr ?? ""}`);
  if (installed.status !== 0) stop([`The app built but didn't install on ${phone.name}.`, tail(installLog, 8), ...explainXcodeProblem(installLog, kind)]);
  const launched = spawnSync("xcrun", ["devicectl", "device", "process", "launch", "--terminate-existing", "--device", phone.udid, APP_ID], { env, encoding: "utf8" });
  const expires = readProfile(path.join(app, "embedded.mobileprovision"))?.expires ?? null;
  console.log(`\n✓ ${APP_NAME} is on ${phone.name}, and runs without the Mac. Sign in with Google.`);
  if (launched.status !== 0) console.log(`  Open ${APP_NAME} on the ${kind} (it didn't open by itself).`);
  if (expires) console.log(`  This copy keeps opening until ${expires.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })} (a year, as the team is a paid one).`);
  console.log(`  After any change to the app, run npm run ${kind.toLowerCase()} again with the ${kind} plugged in: only what changed is rebuilt.\n`);
}

// ---------------------------------------------------------------------------------------------------------------
// This Mac (npm run mac): a Release build for the Mac, signed by HyberTec LLC (Xcode registers this Mac with the team
// the first time), in ~/Applications. /Applications is TestFlight's; the iPad app TestFlight may have put there runs
// only on a Mac set to Full or Reduced Security.

const MAC_APP = path.join(os.homedir(), "Applications", `${APP_NAME}.app`);
/**
 * The Mac app is built for Apple silicon only: React Native Firebase casts an object to BOOL (RNFBAppModule.mm), which
 * compiles where BOOL is a bool (arm64) but not where it is a signed char (Intel). scripts/publish.mjs builds it the same.
 */
const MAC_ARCHS = "ARCHS=arm64";

async function mac() {
  ensurePackages();
  const xenv = xcode();
  ensureCocoaPods();
  await ensureFirebaseFile();
  const env = { ...xenv, ...appSettings("live") };
  ensureNativeProject(env);
  const { iosDir, workspace: ws, scheme } = workspace();
  step(`Building ${APP_NAME} for this Mac, signed by the Apple team "${TEAM.name}" (10 to 20 minutes the first time)`);
  const log = logFile("mac-build.log");
  const derived = path.join(stateDir, "mac-build");
  const built = await xcodebuild(
    // This Mac itself (not any Mac): so Xcode registers it with the team for a development build. Apple silicon only
    // (MAC_ARCHS).
    ["-workspace", ws, "-scheme", scheme, "-configuration", "Release", "-destination", "platform=macOS,variant=Mac Catalyst", "-derivedDataPath", derived,
      "-allowProvisioningUpdates", "-allowProvisioningDeviceRegistration", `DEVELOPMENT_TEAM=${TEAM.id}`, "CODE_SIGN_STYLE=Automatic", "COMPILER_INDEX_STORE_ENABLE=NO", MAC_ARCHS, "build"],
    { cwd: iosDir, env, log },
  );
  if (!built) stop([`${APP_NAME} didn't build for the Mac.`, ...explainXcodeProblem(log, "Mac")]);
  const app = path.join(derived, "Build", "Products", "Release-maccatalyst", `${scheme}.app`);
  step(`Putting ${APP_NAME} in your Applications folder (${MAC_APP.replace(os.homedir(), "~")}) and opening it`);
  spawnSync("pkill", ["-f", `${MAC_APP}/Contents/MacOS/`]);
  fs.mkdirSync(path.dirname(MAC_APP), { recursive: true });
  fs.rmSync(MAC_APP, { recursive: true, force: true });
  run("ditto", [app, MAC_APP], { problem: `${APP_NAME} built but couldn't be copied to ${MAC_APP}.` });
  spawnSync("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", ["-f", MAC_APP]);
  spawnSync("open", [MAC_APP]);
  const expires = readProfile(path.join(app, "Contents", "embedded.provisionprofile"))?.expires ?? null;
  console.log(`\n✓ ${APP_NAME} is on this Mac, in ${MAC_APP.replace(os.homedir(), "~")} (Launchpad and Spotlight find it). Sign in with Google.`);
  if (expires) console.log(`  This copy keeps opening until ${expires.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}; npm run publish:mac puts it on TestFlight for good.`);
  if (fs.existsSync(path.join("/Applications", `${APP_NAME}.app`, "WrappedBundle"))) {
    console.log(`  /Applications/${APP_NAME}.app is the iPad app TestFlight put on this Mac: drag it to the Trash (it asks for your password), so links and widgets open the Mac app.`);
  }
  console.log(`  After any change to the app, run npm run mac again: only what changed is rebuilt.\n`);
}

// ---------------------------------------------------------------------------------------------------------------
// For scripts/publish.mjs: the native project as the App Store needs it.

async function prepare() {
  ensurePackages();
  const xenv = xcode();
  ensureCocoaPods();
  await ensureFirebaseFile();
  const env = { ...xenv, ...appSettings("live") };
  ensureNativeProject(env);
  const { workspace: ws, scheme } = workspace();
  const changed = Object.fromEntries(Object.entries(env).filter(([k, v]) => process.env[k] !== v));
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, "publish-ios.json"), JSON.stringify({ env: changed, workspace: ws, scheme, team: TEAM, appId: APP_ID }, null, 2));
  ok("The iPhone project is ready");
}

async function setup() {
  const left = [];
  const attempt = async (what, fn) => {
    try {
      await fn();
      ok(what);
    } catch (e) {
      if (!(e instanceof Stop)) throw e;
      left.push(`${what}:\n${e.message.replace(/^/gm, "     ")}`);
      console.log(`  ✗ ${what}`);
    }
  };
  step("This Mac");
  await attempt("The app's packages", () => ensurePackages());
  await attempt("Firebase's file for GOOYA iPhone (firebase/GoogleService-Info.plist)", () => ensureFirebaseFile());
  await attempt("Xcode", () => xcode());
  await attempt("CocoaPods", () => ensureCocoaPods());
  await attempt(`The Apple team ${TEAM.name} (${TEAM.id}) in Xcode's accounts`, () => {
    const exported = path.join(os.tmpdir(), `gooya-xcode-${process.pid}.plist`);
    const found = read("defaults", ["export", "com.apple.dt.Xcode", exported]) !== null && (fs.readFileSync(exported, "utf8").includes(TEAM.id) || fs.readFileSync(exported, "utf8").includes(TEAM.name));
    fs.rmSync(exported, { force: true });
    if (!found) stop(["Xcode → Settings… → Accounts → + → sign in with the Apple ID that is on HyberTec LLC's team."]);
  });
  if (!left.length) console.log("\n✓ This Mac is ready: npm run iphone puts GOOYA on the iPhone plugged in; npm run iphone:sim opens it on the Simulator.\n");
  else {
    console.log(`\nLeft for you:\n\n${left.map((l, i) => `  ${i + 1}. ${l}`).join("\n\n")}\n`);
    process.exitCode = 1;
  }
}

function help() {
  const header = fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0];
  console.log(header.replace(/^#!.*\n\/\*\*\n/, "").replace(/^ \* ?/gm, ""));
}

try {
  if (process.platform !== "darwin") stop("GOOYA's iPhone app is built on a Mac (Xcode).");
  if (command === "iphone" || command === "ios") await (onSim ? iphoneSim() : iphone());
  else if (command === "ipad") await iphone("iPad");
  else if (command === "mac") await mac();
  else if (command === "prepare") await prepare();
  else if (command === "setup") await setup();
  else help();
} catch (e) {
  if (e instanceof Interrupted) process.exit(130);
  if (!(e instanceof Stop)) throw e;
  console.error(`\n✗ ${e.message}\n`);
  process.exit(1);
}
void names;
