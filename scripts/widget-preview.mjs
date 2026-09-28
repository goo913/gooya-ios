#!/usr/bin/env node
/**
 * Pictures of the Home Screen widget (targets/widget) without a phone: the widget's SwiftUI views are compiled for
 * this Mac and drawn at the iPhone's three widget sizes, in light and dark, into .expo/widget-preview/.
 *
 *   npm run widget:preview                 with the calendar the demo simulator's app last wrote (or sample data)
 *   npm run widget:preview -- feed.json    with a saved feed (what GET /widgetFeed returns)
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, ".expo", "widget-preview");
fs.mkdirSync(outDir, { recursive: true });

const APP_ID = "com.hybertec.gooya";
const GROUP = `group.${APP_ID}`;

/** The feed the demo simulator's app wrote into its App Group, when one is booted. */
function simulatorFeed() {
  try {
    const devices = JSON.parse(execFileSync("xcrun", ["simctl", "list", "--json", "devices", "booted"], { encoding: "utf8" })).devices;
    for (const d of Object.values(devices).flat()) {
      const groups = spawnSync("xcrun", ["simctl", "get_app_container", d.udid, APP_ID, "groups"], { encoding: "utf8" });
      if (groups.status !== 0) continue;
      const line = groups.stdout.split("\n").find((l) => l.startsWith(GROUP));
      if (!line) continue;
      const plist = path.join(line.split("\t")[1].trim(), "Library", "Preferences", `${GROUP}.plist`);
      if (!fs.existsSync(plist)) continue;
      const json = spawnSync("plutil", ["-extract", "feed", "raw", "-o", "-", plist], { encoding: "utf8" });
      if (json.status !== 0 || !json.stdout.trim().startsWith("{")) continue;
      const file = path.join(outDir, "feed.json");
      fs.writeFileSync(file, json.stdout);
      console.log(`Feed from the simulator "${d.name}"`);
      return file;
    }
  } catch {}
  return null;
}

const feed = process.argv[2] ? path.resolve(process.argv[2]) : simulatorFeed();
if (!feed) console.log("No simulator feed; drawing the sample calendar.");

const sdk = execFileSync("xcrun", ["--sdk", "macosx", "--show-sdk-path"], { encoding: "utf8" }).trim();
const sources = ["Feed.swift", "Model.swift", "Views.swift"].map((f) => path.join(root, "targets", "widget", f));
const bin = path.join(outDir, "render");
const compile = spawnSync(
  "swiftc",
  ["-O", "-parse-as-library", "-target", "arm64-apple-macos14.0", "-sdk", sdk, ...sources, path.join(root, "scripts", "widget-preview", "main.swift"), "-o", bin],
  { stdio: "inherit" },
);
if (compile.status !== 0) process.exit(compile.status ?? 1);
for (const f of fs.readdirSync(outDir)) if (f.endsWith(".png")) fs.rmSync(path.join(outDir, f));
const run = spawnSync(bin, [outDir, ...(feed ? [feed] : [])], { stdio: "inherit" });
process.exit(run.status ?? 1);
