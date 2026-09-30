#!/usr/bin/env node
/**
 * Share (the switch in each editor, on by default) is kept as `private: false` on tasks, schedules and routines, and
 * the other person's phone asks only for shared ones (owner == them and private == false). Documents written before
 * Share have no such field: this writes `private: false` on each of them, once, so the other person keeps seeing them
 * (after that, the server marks anything written without it: functions/src/privacy.ts and onTaskWritten). Nothing else
 * in a document changes, and a document that says either is left alone. Uses the gcloud login (Firestore REST).
 *
 *   node scripts/backfill-shared.mjs            write, and print how many
 *   node scripts/backfill-shared.mjs --dry-run  only print how many would be written
 */
import { execSync } from "node:child_process";

const PROJECT = "gooya-37d79";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const token = execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
const headers = { Authorization: `Bearer ${token}`, "x-goog-user-project": PROJECT, "Content-Type": "application/json" };
const dryRun = process.argv.includes("--dry-run");

async function call(method, path, body) {
  const res = await fetch(`${BASE}/${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function list(collection) {
  const out = [];
  let page = "";
  do {
    const json = await call("GET", `${collection}?pageSize=300&mask.fieldPaths=private&mask.fieldPaths=owner${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`);
    out.push(...(json?.documents ?? []));
    page = json?.nextPageToken ?? "";
  } while (page);
  return out;
}

for (const collection of ["tasks", "schedules", "routines"]) {
  const docs = await list(collection);
  const missing = docs.filter((d) => d.fields?.private?.booleanValue === undefined);
  if (!dryRun) {
    for (const d of missing) {
      // Only `private` changes; the document must still be there (one deleted meanwhile is not made again).
      await call("PATCH", `${d.name.split("/documents/")[1]}?updateMask.fieldPaths=private&currentDocument.exists=true`, { fields: { private: { booleanValue: false } } });
    }
  }
  console.log(`${collection}: ${docs.length} documents, ${missing.length} ${dryRun ? "would be" : ""} marked shared`.replace("  ", " "));
}
