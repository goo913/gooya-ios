import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

/**
 * GOOYA on the Mac (ios/GooyaMacModule.swift): the menus' commands and state, the agenda in the Mac's menu bar, and
 * opening at login. On an iPhone or iPad `isMac` is false and the rest does nothing.
 */

/**
 * A menu or toolbar command: "settings", "new.task" / "new.schedule" / "new.routine", "search", "lists",
 * "view.day" … "view.year", "sidebar", "today", "next", "previous".
 */
export type MacCommand = string;

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
  setMenuState(view: string, sidebar: boolean): void;
  setAgenda(sections: AgendaSection[], actions: { key: string; title: string }[]): void;
  hideAgenda(): void;
  bringForward(): void;
  openAtLogin(): boolean;
  setOpenAtLogin(on: boolean): Promise<boolean>;
  addListener(event: "onCommand", listener: (e: { id: MacCommand }) => void): EventSubscription;
  addListener(event: "onAgendaSelect", listener: (e: { key: string }) => void): EventSubscription;
}

const native = requireOptionalNativeModule<GooyaMacModule>("GooyaMac");

/** This is GOOYA's Mac app (Mac Catalyst). */
export const isMac = !!native?.isMac;

/** The view shown (the toolbar's and the View menu's choice) and the sidebar's Show/Hide. */
export function setMenuState(view: string, sidebar: boolean): void {
  if (isMac) native?.setMenuState(view, sidebar);
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
