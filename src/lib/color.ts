/** Colour arithmetic the web app did with CSS color-mix(): hex/rgb(a) strings in, hex out. */

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseColor(c: string): RGBA {
  const s = c.trim();
  if (s.startsWith("#")) {
    const h = s.slice(1);
    const full = h.length === 3 || h.length === 4 ? h.split("").map((x) => x + x).join("") : h;
    const n = parseInt(full.slice(0, 6), 16);
    const a = full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a };
  }
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (m) {
    const [r, g, b, a] = m[1].split(",").map((x) => parseFloat(x));
    return { r, g, b, a: a ?? 1 };
  }
  return { r: 128, g: 128, b: 128, a: 1 };
}

const hex2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");

export function toHex({ r, g, b, a }: RGBA): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 1 ? hex2(a * 255) : ""}`;
}

/** `amount` of `a` mixed into `b` (0 = all b, 1 = all a), like color-mix(in srgb, a amount, b). */
export function mix(a: string, b: string, amount: number): string {
  const x = parseColor(a);
  const y = parseColor(b);
  const t = Math.min(1, Math.max(0, amount));
  return toHex({ r: x.r * t + y.r * (1 - t), g: x.g * t + y.g * (1 - t), b: x.b * t + y.b * (1 - t), a: 1 });
}

export function withAlpha(c: string, alpha: number): string {
  const x = parseColor(c);
  return `rgba(${Math.round(x.r)},${Math.round(x.g)},${Math.round(x.b)},${alpha})`;
}

/** The text tint over a coloured fill: a bright tint in dark mode, a deep one in light mode. */
export function tintText(base: string, dark: boolean): string {
  return dark ? mix(base, "#ffffff", 0.58) : mix(base, "#000000", 0.58);
}
