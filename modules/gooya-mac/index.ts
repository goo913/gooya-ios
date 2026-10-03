import { requireNativeViewManager, requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";
import type { ComponentType } from "react";
import type { ViewProps } from "react-native";

/**
 * GOOYA on the Mac (ios/GooyaMacModule.swift): the menus' commands and state, the window's sidebar, the Settings
 * window, the agenda in the Mac's menu bar, and opening at login. On an iPhone or iPad `isMac` is false and the rest
 * does nothing.
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
  /** "category": dragged into an order; right-click edits, recolours or deletes it. */
  menu?: "category";
  deletable?: boolean;
}

export interface SidebarSection {
  id: string;
  title: string;
  /** A + by its heading (Categories: a new one). */
  addable?: boolean;
  rows: SidebarRow[];
}

/**
 * From the sidebar: a tick changed, a row chosen, a day chosen in its month, the sidebar shown or hidden, + by a heading,
 * the categories dragged into a new order (their ids), or a category's menu (edit, a colour, delete).
 */
export type SidebarEvent =
  | { type: "toggle"; id: string }
  | { type: "select"; id: string }
  | { type: "date"; date: string }
  | { type: "shown"; shown: boolean }
  | { type: "add"; id: string }
  | { type: "order"; ids: string[] }
  | { type: "menu"; id: string; action: "edit" | "color" | "delete"; color?: string };

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

/** The Settings window's tabs (its toolbar), as Apple Calendar's. */
export type SettingsTab = "general" | "accounts" | "alerts" | "advanced";

/**
 * A control the Mac draws itself (ios/GooyaControlView.swift): a checkbox with its title, a pop-up button (⌃⌄) of
 * `options` showing `selected`, a pull-down button (`title`, then a menu of `options`) or a push button.
 */
export interface MacControlProps extends ViewProps {
  kind: "checkbox" | "popup" | "pulldown" | "button";
  title?: string;
  options?: string[];
  selected?: number;
  checked?: boolean;
  enabled?: boolean;
  /** As wide as the view (a pop-up button as wide as the others in its column), not its own width. */
  stretch?: boolean;
  /** { checked } for a checkbox, { index } for a pop-up or pull-down button, {} for a push button. */
  onAction?: (e: { nativeEvent: { checked?: boolean; index?: number } }) => void;
  /** The control's own size, for its place in the layout. */
  onMeasure?: (e: { nativeEvent: { width: number; height: number } }) => void;
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
  openSettings(tab: SettingsTab | null): void;
  closeSettings(): void;
  setSettingsSize(tab: SettingsTab, width: number, height: number): void;
  showMainWindow(): void;
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

/** The Settings window (GOOYA → Settings…), at `tab` if given; brought forward if it is open. */
export function openSettings(tab?: SettingsTab): void {
  if (isMac) native?.openSettings(tab ?? null);
}

export function closeSettings(): void {
  if (isMac) native?.closeSettings();
}

/** The size of a tab's content: the Settings window takes it (below its toolbar). */
export function setSettingsSize(tab: SettingsTab, width: number, height: number): void {
  if (isMac) native?.setSettingsSize(tab, width, height);
}

/** GOOYA's window in front of Settings (a button in Settings opened something there). */
export function showMainWindow(): void {
  if (isMac) native?.showMainWindow();
}

/** One item of a right-click menu: a command, or a group of them (a submenu, or `inline`: a section between lines). */
export type MacMenuItem =
  | { id: string; title: string; symbol?: string; destructive?: boolean; disabled?: boolean; checked?: boolean }
  | { title?: string; symbol?: string; inline?: boolean; children: MacMenuItem[] };

export interface MacMenuViewProps extends ViewProps {
  items: MacMenuItem[];
  /** The command chosen, and where the right-click was: in the view (x, y) and in the window (wx, wy), in points. */
  onPick?: (e: { nativeEvent: { id: string; x: number; y: number; wx: number; wy: number } }) => void;
}

let menuView: ComponentType<MacMenuViewProps> | null = null;

/** The view that gives what it wraps a right-click menu (only on the Mac: ios/GooyaMenuView.swift). */
export function macMenuView(): ComponentType<MacMenuViewProps> {
  menuView ??= requireNativeViewManager<MacMenuViewProps>("GooyaMac", "GooyaMenuView");
  return menuView;
}

let controlView: ComponentType<MacControlProps> | null = null;

/** The Mac's own controls' view (only on the Mac). */
export function macControlView(): ComponentType<MacControlProps> {
  controlView ??= requireNativeViewManager<MacControlProps>("GooyaMac");
  return controlView;
}

/** Whether GOOYA opens when you log in to the Mac (System Settings → General → Login Items). */
export function openAtLogin(): boolean {
  return isMac && native ? native.openAtLogin() : false;
}

export async function setOpenAtLogin(on: boolean): Promise<boolean> {
  return isMac && native ? native.setOpenAtLogin(on) : false;
}
