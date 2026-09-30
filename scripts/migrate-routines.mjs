#!/usr/bin/env node
/**
 * Routines (sleep, work, …) moved from the Firestore collection "schedules" to "routines" when "schedules" became
 * GOOYA's schedules (lunch at noon, a dentist appointment). Builds before that read routines from "schedules", so the
 * old copies stay there until every phone runs a newer build; the app and the server leave them out meanwhile
 * (shared/normalize.ts isLegacyRoutine). Uses the gcloud login (Firestore REST); documents are copied field for field.
 *
 *   node scripts/migrate-routines.mjs            copy each routine in "schedules" to "routines" (same id; again when
 *                                                the old one was changed since), and settings.scheduleIntensity to
 *                                                settings.routineIntensity
 *   node scripts/migrate-routines.mjs cleanup    copy once more, then delete the routines in "schedules" and the old
 *                                                setting (once both phones run a build from 2026-09-30 or later)
 */
import { execSync } from "node:child_process";

const PROJECT = "gooya-37d79";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const token = execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
const headers = { Authorization: `Bearer ${token}`, "x-goog-user-project": PROJECT, "Content-Type": "application/json" };
const cleanup = process.argv[2] === "cleanup";

async function call(method, path, body) {
  const res = await fetch(`${BASE}/${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (res.status === 404 && method === "GET") return null;
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function list(collection) {
  const out = [];
  let page = "";
  do {
    const json = await call("GET", `${collection}?pageSize=300${page ? `&pageToken=${page}` : ""}`);
    out.push(...(json?.documents ?? []));
    page = json?.nextPageToken ?? "";
  } while (page);
  return out;
}

const idOf = (doc) => doc.name.split("/").pop();
const numberOf = (v) => (v ? Number(v.integerValue ?? v.doubleValue ?? 0) : 0);
/** A routine as the old builds wrote it: times of day, no start instant (a schedule has one). */
const isRoutine = (f) => !("integerValue" in (f.start ?? {}) || "doubleValue" in (f.start ?? {})) && typeof f.startTime?.stringValue === "string";

let copied = 0;
let same = 0;
let deleted = 0;
for (const doc of await list("schedules")) {
  const fields = doc.fields ?? {};
  if (!isRoutine(fields)) continue;
  const id = idOf(doc);
  const there = await call("GET", `routines/${id}`);
  if (!there || numberOf(there.fields?.updatedAt) < numberOf(fields.updatedAt)) {
    // No update mask: the whole document, as it is in "schedules".
    await call("PATCH", `routines/${id}`, { fields });
    copied++;
    console.log(`routines/${id} ← schedules/${id} (${fields.owner?.stringValue} · ${fields.title?.stringValue})`);
  } else same++;
  if (cleanup) {
    await call("DELETE", `schedules/${id}`);
    deleted++;
  }
}

for (const doc of await list("users")) {
  const settings = doc.fields?.settings?.mapValue?.fields ?? {};
  const id = idOf(doc);
  if (settings.scheduleIntensity && !settings.routineIntensity) {
    await call("PATCH", `users/${id}?updateMask.fieldPaths=settings.routineIntensity`, { fields: { settings: { mapValue: { fields: { routineIntensity: settings.scheduleIntensity } } } } });
    console.log(`users/${id}: settings.routineIntensity ← settings.scheduleIntensity`);
  }
  if (cleanup && settings.scheduleIntensity) {
    // A field in the mask and not in the body is deleted.
    await call("PATCH", `users/${id}?updateMask.fieldPaths=settings.scheduleIntensity`, { fields: {} });
    console.log(`users/${id}: settings.scheduleIntensity deleted`);
  }
}

console.log(`${copied} routine(s) copied, ${same} already in "routines"${cleanup ? `, ${deleted} deleted from "schedules"` : ""}.`);
