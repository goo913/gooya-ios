#!/usr/bin/env node
/**
 * Imported calendar events now carry their details (invitees and their answers, the organizer, the video call, busy or
 * free, alerts, attachments: functions/src/integrations/eventDetails.ts), but a sync only reads what changed in a
 * calendar since the last one, so events that do not change would never get them. This clears what each imported
 * calendar remembers of its last sync, in integrations/{person}/accounts/{account}, so the next sync reads it all again:
 *
 *   Google  calendars.<id>.syncToken  The next sync lists the calendar's events from 120 days ago on and writes each one
 *                                     again (the poll runs every 10 minutes; a change in the calendar syncs it sooner).
 *   iCloud  calendars.<id>.ctag       The next sync fetches the calendar's events (120 days back, 400 ahead) and writes
 *                                     each one read before GOOYA read these details (the poll runs every 5 minutes).
 *
 * Run it once the functions that read these details are deployed: a sync by the functions before them would read
 * everything again without them. Nothing else is touched: no event is written or deleted here, and the accounts keep
 * every other field (directions, the GOOYA calendar's own sync state, push channels). Events keep their ids when read
 * again, so each is replaced by its new version, never added twice. A sync running at that moment may put its token
 * back when it ends; running this again then is harmless. Uses the gcloud login (Firestore REST).
 *
 *   node scripts/refresh-event-details.mjs            clear, and print what was cleared
 *   node scripts/refresh-event-details.mjs --dry-run  only print what would be cleared
 */
import { execSync } from "node:child_process";

const PROJECT = "gooya-37d79";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const token = execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
const headers = { Authorization: `Bearer ${token}`, "x-goog-user-project": PROJECT, "Content-Type": "application/json" };
const dryRun = process.argv.includes("--dry-run");
/** What marks a calendar as read up to some point: Google's sync token, iCloud's ctag. */
const MARKS = ["syncToken", "ctag"];

async function call(method, path, body) {
  const res = await fetch(`${BASE}/${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (res.status === 404 && method === "GET") return null;
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function list(collection, query = "") {
  const out = [];
  let page = "";
  do {
    const json = await call("GET", `${collection}?pageSize=300${query}${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`);
    out.push(...(json?.documents ?? []));
    page = json?.nextPageToken ?? "";
  } while (page);
  return out;
}

const idOf = (doc) => doc.name.split("/").pop();
/** A field name in a field path: calendar ids have dots, @ and # in them, so each is quoted. */
const quoted = (name) => "`" + name.replace(/\\/g, "\\\\").replace(/`/g, "\\`") + "`";

// integrations/{person} has no fields of its own, only the accounts under it: Firestore lists it as "missing".
const people = (await list("integrations", "&showMissing=true")).map(idOf);
let accounts = 0;
let calendars = 0;
for (const person of people) {
  for (const doc of await list(`integrations/${person}/accounts`)) {
    const f = doc.fields ?? {};
    const label = `${person} · ${f.source?.stringValue ?? "?"} ${f.email?.stringValue ?? ""} (${idOf(doc)})`;
    const paths = [];
    const cleared = [];
    for (const [id, value] of Object.entries(f.calendars?.mapValue?.fields ?? {})) {
      const c = value.mapValue?.fields ?? {};
      const marks = MARKS.filter((m) => m in c);
      if (!marks.length) continue;
      paths.push(...marks.map((m) => `calendars.${quoted(id)}.${m}`));
      cleared.push(`${c.name?.stringValue ?? id} (${c.direction?.stringValue ?? "?"}: ${marks.join(", ")})`);
    }
    if (!paths.length) {
      console.log(`${label}: nothing to clear`);
      continue;
    }
    if (!dryRun) {
      // Only the fields in the mask change, and being absent from the body they are deleted. The account must still
      // exist: an account disconnected meanwhile is not made again.
      const mask = paths.map((p) => `updateMask.fieldPaths=${encodeURIComponent(p)}`).join("&");
      try {
        await call("PATCH", `${doc.name.split("/documents/")[1]}?${mask}&currentDocument.exists=true`, { fields: {} });
      } catch (e) {
        console.log(`${label}: not cleared (${String(e.message ?? e).slice(0, 200)})`);
        continue;
      }
    }
    accounts++;
    calendars += cleared.length;
    console.log(`${label}: ${dryRun ? "would clear" : "cleared"} ${cleared.join(", ")}`);
  }
}

console.log(
  `${dryRun ? "Would clear" : "Cleared"} the sync state of ${calendars} calendar(s) in ${accounts} account(s).` +
    (dryRun || !calendars ? "" : " Their events are read again at the next sync: Google within 10 minutes, iCloud within 5."),
);
