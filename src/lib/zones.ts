import { fieldsInZone, formatHHmm, makeKey, offsetMinutes, zonedMs } from "@shared/time";
import type { PersonKey } from "@shared/people";
import { tzAbbrev } from "./format";
import { useMe, usePerson } from "./people";
import { viewerTz } from "./useNow";

/** "New York" for "America/New_York". */
export function zoneCity(tz: string): string {
  return (tz.split("/").pop() ?? tz).replace(/_/g, " ");
}

export interface EditZone {
  zone: string;
  /** "구야 · New York (EDT)" */
  label: string;
}

/**
 * The clocks an editor shows a time on: the owner's (the item is theirs, and kept in their zone), then this phone's
 * when it reads differently at `at`: the other person making something for them, or the owner away from home. Changing
 * the time on either clock changes it on both.
 */
export function useEditZones(owner: PersonKey, at: number, ownZone?: string): EditZone[] {
  const me = useMe();
  const ownerInfo = usePerson(owner);
  const mine = usePerson(me);
  const primary = ownZone || ownerInfo.timezone;
  const label = (name: string, zone: string) => `${name} · ${zoneCity(zone)} (${tzAbbrev(zone, at)})`;
  const zones: EditZone[] = [{ zone: primary, label: label(ownerInfo.name, primary) }];
  if (offsetMinutes(at, viewerTz) !== offsetMinutes(at, primary)) zones.push({ zone: viewerTz, label: label(owner === me ? "Here" : mine.name, viewerTz) });
  return zones;
}

/** The day and time an instant reads on a zone's clock. */
export function clockOf(ms: number, zone: string): { date: string; time: string } {
  const f = fieldsInZone(ms, zone);
  return { date: makeKey(f.y, f.m, f.d), time: formatHHmm(f.h, f.min) };
}

/** A day picked on a zone's calendar, at the time `was` reads there; or a time picked on its clock, on that day. */
export function pickedOn(was: number, picked: number, zone: string, what: "date" | "time"): number {
  const w = clockOf(was, zone);
  const p = clockOf(picked, zone);
  return zonedMs(what === "date" ? p.date : w.date, what === "date" ? w.time : p.time, zone);
}

/** A day and time on one clock as the day and time on another (the same moment). */
export function onClock(date: string, time: string, from: string, to: string): { date: string; time: string } {
  if (from === to) return { date, time };
  const f = fieldsInZone(zonedMs(date, time, from), to);
  return { date: makeKey(f.y, f.m, f.d), time: formatHHmm(f.h, f.min) };
}
