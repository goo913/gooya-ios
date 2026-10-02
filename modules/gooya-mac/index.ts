import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

/**
 * GOOYA on the Mac (ios/GooyaMacModule.swift): the menus' commands and state, the agenda in the Mac's menu bar, and
 * opening at login. On an iPhone or iPad `isMac` is false and the rest does nothing.
 */

/**
 * A menu, toolbar or key command: "settings", "new" (a schedule or task), "new.routine", "new.category", "search",
 * "view.day" … "view.year", "today", "next", "previous", "zoom.in", "zoom.out", "escape" (while asked for).
 */
export type MacCommand = string;

/** A row of the sidebar's calendar list: a tick in its colour (`color`), or a link with a symbol and a count. */
export interface SidebarRow {
  id: string;
  title: string;
  color?: string;
  checked?: boolean;
  icon?: string;
  iconColor?: string;
  count?: string;
}

export interface SidebarSection {
  id: string;
  title: string;
  rows: SidebarRow[];
}

/** From the sidebar: a tick changed, a row chosen, a day chosen in its month, or the sidebar shown or hidden. */
export type SidebarEvent =
  | { type: "toggle"; id: string }
  | { type: "select"; id: string }
  | { type: "date"; date: string }
  | { type: "shown"; shown: boolean };

export interface AgendaRow {
  /** Given back when the row is chosen. */
  key: string;
  title: string;
  /** Under the title: the time, or "all-day". */
  detail?: string;
  /** "#rrggbb": the dot beside it. */
  color?: string;
}

export interface AgendaSection {
  title: string;
  /** None: the section says "Nothing scheduled". */
  rows: AgendaRow[];
}

interface GooyaMacModule {
  isMac: boolean;
  setMenuState(view: string): void;
  setAgenda(sections: AgendaSection[], actions: { key: string; title: string }[]): void;
  hideAgenda(): void;
  setToolbar(shown: boolean): void;
  setSplit(shown: boolean): void;
  setSidebar(sections: SidebarSection[], today: string): void;
  setEscape(on: boolean): void;
  windowActive(): boolean;
  bringForward(): void;
  openAtLogin(): boolean;
  setOpenAtLogin(on: boolean): Promise<boolean>;
  addListener(event: "onCommand", listener: (e: { id: MacCommand }) => void): EventSubscription;
  addListener(event: "onAgendaSelect", listener: (e: { key: string }) => void): EventSubscription;
  addListener(event: "onSidebar", listener: (e: SidebarEvent) => void): EventSubscription;
  addListener(event: "onWindowActive", listener: (e: { active: boolean }) => void): EventSubscription;
}

const native = requireOptionalNativeModule<GooyaMacModule>("GooyaMac");

/** This is GOOYA's Mac app (Mac Catalyst). */
export const isMac = !!native?.isMac;

/** The window's toolbar (Day · Week · Month · Year and the rest): while the calendar shows, not over signing in. */
export function setToolbar(shown: boolean): void {
  if (isMac) native?.setToolbar(shown);
}

/** The window as Apple Calendar's: macOS's sidebar beside the calendar (true), or the content alone (signing in). */
export function setSplit(shown: boolean): void {
  if (isMac) native?.setSplit(shown);
}

/** The view shown (the toolbar's and the View menu's choice). */
export function setMenuState(view: string): void {
  if (isMac) native?.setMenuState(view);
}

/** The sidebar's calendar list, and today for its month. */
export function setSidebar(sections: SidebarSection[], today: string): void {
  if (isMac) native?.setSidebar(sections, today);
}

export function onSidebar(listener: (e: SidebarEvent) => void): EventSubscription | null {
  return isMac && native ? native.addListener("onSidebar", listener) : null;
}

/** Whether GOOYA's window is the one in front (its key window). */
export function windowActive(): boolean {
  return isMac && native ? native.windowActive() : true;
}

export function onWindowActive(listener: (active: boolean) => void): EventSubscription | null {
  return isMac && native ? native.addListener("onWindowActive", (e) => listener(e.active)) : null;
}

/** Escape comes to `onCommand` as "escape" while this is on (something to cancel: a drag, a new item's popover). */
export function setEscape(on: boolean): void {
  if (isMac) native?.setEscape(on);
}

export function onCommand(listener: (id: MacCommand) => void): EventSubscription | null {
  return isMac && native ? native.addListener("onCommand", (e) => listener(e.id)) : null;
}

/** The menu bar's agenda: its sections, then its actions. */
export function setAgenda(sections: AgendaSection[], actions: { key: string; title: string }[]): void {
  if (isMac) native?.setAgenda(sections, actions);
}

export function hideAgenda(): void {
  if (isMac) native?.hideAgenda();
}

export function onAgendaSelect(listener: (key: string) => void): EventSubscription | null {
  return isMac && native ? native.addListener("onAgendaSelect", (e) => listener(e.key)) : null;
}

/** GOOYA in front, its window opened again if it was closed. */
export function bringForward(): void {
  if (isMac) native?.bringForward();
}

/** Whether GOOYA opens when you log in to the Mac (System Settings → General → Login Items). */
export function openAtLogin(): boolean {
  return isMac && native ? native.openAtLogin() : false;
}

export async function setOpenAtLogin(on: boolean): Promise<boolean> {
  return isMac && native ? native.setOpenAtLogin(on) : false;
}
