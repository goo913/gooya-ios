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

function toHsl({ r, g, b }: RGBA): { h: number; s: number; l: number } {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: h / 6, s, l };
}

function fromHsl(h: number, s: number, l: number): string {
  if (s === 0) return toHex({ r: l * 255, g: l * 255, b: l * 255, a: 1 });
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p;
  };
  return toHex({ r: f(h + 1 / 3) * 255, g: f(h) * 255, b: f(h - 1 / 3) * 255, a: 1 });
}

/**
 * A calendar's colour as text on its own tinted block, as Apple Calendar draws event titles: the colour itself, made
 * light enough to read in dark mode (or dark enough in light mode). Dark calendar colours (indigo, navy) need it.
 */
export function readableTint(base: string, dark: boolean): string {
  const { h, s, l } = toHsl(parseColor(base));
  return fromHsl(h, s, dark ? Math.max(l, 0.6) : Math.min(l, 0.38));
}

/** The text tint over a coloured fill: a bright tint in dark mode, a deep one in light mode. */
export function tintText(base: string, dark: boolean): string {
  return dark ? mix(base, "#ffffff", 0.58) : mix(base, "#000000", 0.58);
}
