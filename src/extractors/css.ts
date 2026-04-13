// CSS extractor — pulls design tokens from raw CSS text
// Input: string[] of CSS file contents + inline <style> blocks
// Output: colors, typography, spacing, motion, elevation, border-radius

import type {
  ColorToken,
  ColorUsage,
  FontToken,
  FontRole,
  FontSource,
  ShadowToken,
  MotionToken,
  SpacingStrategy,
} from "../schema/types.js";

// ── Color extraction ──────────────────────────────────────────────────────────

const HEX_RE = /#([0-9a-fA-F]{3,8})\b/g;
const RGB_RE = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)/g;
const HSL_RE = /hsla?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%(?:\s*,\s*[\d.]+)?\s*\)/g;

// Resolve 3-digit hex to 6-digit
function normalizeHex(hex: string): string {
  if (hex.length === 3) {
    return hex.split("").map((c) => c + c).join("");
  }
  return hex.toLowerCase();
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

// Infer usage from the CSS property the color appears in
function inferColorUsage(context: string): ColorUsage {
  const ctx = context.toLowerCase();
  if (ctx.includes("background")) return "background";
  if (ctx.includes("border") || ctx.includes("outline")) return "border";
  if (ctx.includes("color")) return "text";
  if (ctx.includes("fill") || ctx.includes("stroke")) return "primary";
  return "unknown";
}

function inferColorName(hex: string, usage: ColorUsage, index: number): string {
  const hue = parseInt(hex.slice(1, 3), 16);
  const saturation = parseInt(hex.slice(3, 5), 16);
  const brightness = parseInt(hex.slice(5, 7), 16);
  const avg = (parseInt(hex.slice(1, 3), 16) + saturation + brightness) / 3;

  // Near-white / near-black
  if (avg > 230) return "white";
  if (avg < 30) return "black";
  if (avg > 180 && saturation < 30) return `gray-${Math.round((255 - avg) / 25) * 100}`;

  // Hue-based naming
  if (hue < 30) return `red-${index}`;
  if (hue < 60) return `orange-${index}`;
  if (hue < 90) return `yellow-${index}`;
  if (hue < 150) return `green-${index}`;
  if (hue < 200) return `teal-${index}`;
  if (hue < 260) return `blue-${index}`;
  if (hue < 290) return `purple-${index}`;
  if (hue < 330) return `pink-${index}`;
  return `${usage}-${index}`;
}

export function extractColors(cssTexts: string[]): ColorToken[] {
  const full = cssTexts.join("\n");
  const counts = new Map<string, { count: number; contexts: string[] }>();

  // Process rule blocks to capture property context
  const ruleRe = /([^{}]+)\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = ruleRe.exec(full)) !== null) {
    const property = match[1] ?? "";
    const block = match[2] ?? "";

    const extractFromBlock = (colorHex: string) => {
      const existing = counts.get(colorHex) ?? { count: 0, contexts: [] };
      existing.count++;
      if (existing.contexts.length < 5) existing.contexts.push(property.trim());
      counts.set(colorHex, existing);
    };

    // Hex
    for (const hm of block.matchAll(HEX_RE)) {
      if (hm[1].length === 3 || hm[1].length === 6) {
        extractFromBlock(`#${normalizeHex(hm[1])}`);
      }
    }
    // RGB
    for (const rm of block.matchAll(RGB_RE)) {
      extractFromBlock(rgbToHex(+rm[1], +rm[2], +rm[3]));
    }
    // HSL
    for (const hm of block.matchAll(HSL_RE)) {
      extractFromBlock(hslToHex(+hm[1], +hm[2], +hm[3]));
    }
  }

  // Filter outliers (< 2 occurrences unless very few total)
  const minOccurrences = counts.size > 20 ? 2 : 1;

  return Array.from(counts.entries())
    .filter(([, v]) => v.count >= minOccurrences)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 40)  // cap palette at 40 colors
    .map(([hex, { count, contexts }], i) => {
      const primaryContext = contexts[0] ?? "";
      const usage = inferColorUsage(primaryContext);
      return {
        value: hex,
        usage,
        name_inferred: inferColorName(hex, usage, i),
        occurrences: count,
      };
    });
}

// ── Typography extraction ─────────────────────────────────────────────────────

function inferFontRole(selector: string): FontRole {
  const s = selector.toLowerCase();
  if (/h[1-6]|\.heading|\.title|\.display/.test(s)) return "heading";
  if (/code|pre|mono|\.mono/.test(s)) return "mono";
  if (/body|p\b|\.body|\.text/.test(s)) return "body";
  if (/\.display|hero/.test(s)) return "display";
  return "body";
}

function inferFontSource(family: string, cssText: string): FontSource {
  const f = family.toLowerCase();
  if (/system-ui|-apple-system|segoe ui|roboto|arial|helvetica|georgia|times/.test(f)) return "system";
  if (cssText.includes("fonts.googleapis.com") && cssText.includes(family.split(",")[0].replace(/['"]/g, ""))) return "google";
  if (cssText.includes("@font-face")) return "self-hosted";
  return "cdn";
}

export function extractTypography(cssTexts: string[]): {
  families: FontToken[];
  scale: number[];
  base_size: number;
  line_height_base: number;
  letter_spacing_pattern: string;
} {
  const full = cssTexts.join("\n");
  const familyMap = new Map<string, { selectors: string[]; weights: Set<number> }>();
  const sizes = new Set<number>();
  const lineHeights: number[] = [];
  const letterSpacings: string[] = [];

  const ruleRe = /([^{}]+)\{([^}]+)\}/g;
  let m: RegExpExecArray | null;

  while ((m = ruleRe.exec(full)) !== null) {
    const selector = m[1].trim();
    const block = m[2];

    // font-family
    const ffMatch = block.match(/font-family\s*:\s*([^;]+)/i);
    if (ffMatch) {
      const family = ffMatch[1].trim();
      const existing = familyMap.get(family) ?? { selectors: [], weights: new Set() };
      existing.selectors.push(selector);
      familyMap.set(family, existing);
    }

    // font-weight
    const fwMatch = block.match(/font-weight\s*:\s*(\d+)/i);
    if (fwMatch) {
      const family = [...familyMap.keys()].at(-1);
      if (family) {
        const existing = familyMap.get(family)!;
        existing.weights.add(parseInt(fwMatch[1]));
      }
    }

    // font-size in px/rem
    for (const sm of block.matchAll(/font-size\s*:\s*([\d.]+)(px|rem)/gi)) {
      const val = parseFloat(sm[1]);
      const px = sm[2] === "rem" ? Math.round(val * 16) : Math.round(val);
      if (px >= 8 && px <= 128) sizes.add(px);
    }

    // line-height
    const lhMatch = block.match(/line-height\s*:\s*([\d.]+)/i);
    if (lhMatch) {
      const val = parseFloat(lhMatch[1]);
      if (val > 0.5 && val < 4) lineHeights.push(val);
    }

    // letter-spacing
    const lsMatch = block.match(/letter-spacing\s*:\s*([^;]+)/i);
    if (lsMatch) letterSpacings.push(lsMatch[1].trim());
  }

  const scale = [...sizes].sort((a, b) => a - b);
  const base_size = scale.find((s) => s >= 14 && s <= 18) ?? 16;

  // Median line height
  const sortedLh = [...lineHeights].sort((a, b) => a - b);
  const line_height_base = sortedLh[Math.floor(sortedLh.length / 2)] ?? 1.5;

  // Letter spacing summary
  const lsUniq = [...new Set(letterSpacings)];
  const letter_spacing_pattern = lsUniq.length === 0
    ? "normal"
    : lsUniq.some((s) => s.includes("em") && parseFloat(s) < 0)
      ? "tight"
      : lsUniq.some((s) => parseFloat(s) > 0.05)
        ? "loose"
        : "normal";

  const families: FontToken[] = [...familyMap.entries()].slice(0, 5).map(([family, data]) => ({
    family: family.replace(/['"]/g, "").trim(),
    source: inferFontSource(family, full),
    weights: data.weights.size > 0 ? [...data.weights].sort() : [400],
    role: inferFontRole(data.selectors[0] ?? ""),
  }));

  return { families, scale, base_size, line_height_base, letter_spacing_pattern };
}

// ── Spacing extraction ────────────────────────────────────────────────────────

export function extractSpacing(cssTexts: string[]): {
  base_unit: number;
  scale: number[];
  strategy: SpacingStrategy;
} {
  const full = cssTexts.join("\n");
  const values = new Map<number, number>(); // px value → count

  const spacingRe = /(?:margin|padding|gap|top|right|bottom|left)\s*:\s*([^;]+)/gi;
  for (const m of full.matchAll(spacingRe)) {
    for (const valStr of m[1].split(/\s+/)) {
      const num = parseFloat(valStr);
      const isPx = valStr.endsWith("px");
      const isRem = valStr.endsWith("rem");
      if (!isNaN(num) && num > 0 && num < 500) {
        const px = isRem ? Math.round(num * 16) : isPx ? Math.round(num) : Math.round(num);
        values.set(px, (values.get(px) ?? 0) + 1);
      }
    }
  }

  // Find base unit (most common GCD-like value)
  const sorted = [...values.entries()]
    .filter(([v]) => v >= 2 && v <= 64)
    .sort((a, b) => b[1] - a[1])
    .map(([v]) => v);

  // Check if values cluster on 4px or 8px grid
  const on4 = sorted.filter((v) => v % 4 === 0).length;
  const on8 = sorted.filter((v) => v % 8 === 0).length;
  const base_unit = on8 > on4 * 0.7 ? 8 : 4;

  // Detect spacing strategy
  const uniqueSorted = [...new Set(sorted)].sort((a, b) => a - b);
  let strategy: SpacingStrategy = "mixed";

  if (uniqueSorted.length >= 3) {
    // Check linear: constant difference
    const diffs = uniqueSorted.slice(1).map((v, i) => v - uniqueSorted[i]);
    const isLinear = diffs.every((d) => Math.abs(d - diffs[0]) < 2);

    // Check modular: constant ratio
    const ratios = uniqueSorted.slice(1).map((v, i) => v / uniqueSorted[i]);
    const isModular = ratios.every((r) => Math.abs(r - ratios[0]) < 0.15);

    // Check fibonacci-ish
    const isFib = uniqueSorted.slice(2).every(
      (v, i) => Math.abs(v - (uniqueSorted[i] + uniqueSorted[i + 1])) < 4
    );

    if (isLinear) strategy = "linear";
    else if (isModular) strategy = "modular";
    else if (isFib) strategy = "fibonacci";
  }

  return {
    base_unit,
    scale: uniqueSorted.slice(0, 12),
    strategy,
  };
}

// ── Elevation (box-shadow) extraction ────────────────────────────────────────

export function extractElevation(cssTexts: string[]): ShadowToken[] {
  const full = cssTexts.join("\n");
  const shadows = new Map<string, number>();

  for (const m of full.matchAll(/box-shadow\s*:\s*([^;}]+)/gi)) {
    const val = m[1].trim();
    if (val === "none") continue;
    shadows.set(val, (shadows.get(val) ?? 0) + 1);
  }

  return [...shadows.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([value], i) => ({
      value,
      level: Math.min(i + 1, 5),
    }));
}

// ── Border radius extraction ──────────────────────────────────────────────────

export function extractBorderRadius(cssTexts: string[]): number[] {
  const full = cssTexts.join("\n");
  const radii = new Map<number, number>();

  for (const m of full.matchAll(/border-radius\s*:\s*([\d.]+)(px|rem|%)/gi)) {
    const val = parseFloat(m[1]);
    const px = m[2] === "rem" ? Math.round(val * 16) : Math.round(val);
    if (px >= 0 && px <= 100) {
      radii.set(px, (radii.get(px) ?? 0) + 1);
    }
  }

  return [...radii.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([v]) => v)
    .sort((a, b) => a - b);
}

// ── Motion / animation extraction ─────────────────────────────────────────────

export function extractMotion(cssTexts: string[]): {
  durations_ms: number[];
  easings: string[];
  patterns: string[];
  has_reduced_motion_support: boolean;
} {
  const full = cssTexts.join("\n");
  const durations = new Set<number>();
  const easings = new Set<string>();
  const patterns = new Set<string>();

  // transitions
  for (const m of full.matchAll(/transition\s*:\s*([^;}]+)/gi)) {
    const val = m[1];
    // duration in ms or s
    for (const dm of val.matchAll(/([\d.]+)(ms|s)\b/g)) {
      const ms = dm[2] === "s" ? Math.round(parseFloat(dm[1]) * 1000) : Math.round(parseFloat(dm[1]));
      if (ms > 0 && ms < 5000) durations.add(ms);
    }
    // easing
    const easingMatch = val.match(/(?:ease[\w-]*|linear|cubic-bezier\([^)]+\)|steps\([^)]+\))/i);
    if (easingMatch) easings.add(easingMatch[0].trim());
    // property pattern
    const propMatch = val.match(/^([\w-]+)/);
    if (propMatch) {
      const prop = propMatch[1];
      if (prop === "transform") patterns.add("scale-or-move");
      else if (prop === "opacity") patterns.add("fade");
      else if (prop === "all") patterns.add("all-properties");
    }
  }

  // animations
  for (const m of full.matchAll(/animation\s*:\s*([^;}]+)/gi)) {
    const val = m[1];
    for (const dm of val.matchAll(/([\d.]+)(ms|s)\b/g)) {
      const ms = dm[2] === "s" ? Math.round(parseFloat(dm[1]) * 1000) : Math.round(parseFloat(dm[1]));
      if (ms > 0 && ms < 10000) durations.add(ms);
    }
  }

  // @keyframes names → infer animation pattern names
  for (const m of full.matchAll(/@keyframes\s+([\w-]+)/gi)) {
    const name = m[1].toLowerCase();
    if (/fade/.test(name)) patterns.add("fade");
    if (/slide/.test(name)) patterns.add("slide");
    if (/scale|zoom/.test(name)) patterns.add("scale-in");
    if (/spin|rotate/.test(name)) patterns.add("spin");
    if (/bounce/.test(name)) patterns.add("bounce");
    if (/shake|wiggle/.test(name)) patterns.add("shake");
    if (/pulse/.test(name)) patterns.add("pulse");
    if (/float|hover/.test(name)) patterns.add("float");
  }

  const has_reduced_motion_support =
    full.includes("prefers-reduced-motion");

  return {
    durations_ms: [...durations].sort((a, b) => a - b),
    easings: [...easings].slice(0, 8),
    patterns: [...patterns],
    has_reduced_motion_support,
  };
}

// ── Colour strategy detection ─────────────────────────────────────────────────

export function detectColorStrategy(
  colors: ColorToken[]
): "monochrome" | "analogous" | "complementary" | "triadic" | "unknown" {
  if (colors.length < 3) return "monochrome";

  // Convert hex → hue
  const hues = colors
    .filter((c) => c.value.length === 7)
    .map((c) => {
      const r = parseInt(c.value.slice(1, 3), 16) / 255;
      const g = parseInt(c.value.slice(3, 5), 16) / 255;
      const b = parseInt(c.value.slice(5, 7), 16) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      if (d === 0) return -1;
      let h = 0;
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      return Math.round(h * 60 + 360) % 360;
    })
    .filter((h) => h >= 0);

  if (hues.length < 2) return "monochrome";

  const spread = Math.max(...hues) - Math.min(...hues);
  if (spread < 30) return "monochrome";
  if (spread < 60) return "analogous";

  // Check for complementary (~180° apart)
  const hasComplement = hues.some((h1) =>
    hues.some((h2) => Math.abs(Math.abs(h1 - h2) - 180) < 30)
  );
  if (hasComplement) return "complementary";

  // Check triadic (~120° apart)
  const hasTriadic = hues.some((h1) =>
    hues.some((h2) => Math.abs(Math.abs(h1 - h2) - 120) < 30)
  );
  if (hasTriadic) return "triadic";

  return "analogous";
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface CSSTokens {
  colors: ColorToken[];
  color_strategy: ReturnType<typeof detectColorStrategy>;
  dark_mode: boolean;
  typography: ReturnType<typeof extractTypography>;
  spacing: ReturnType<typeof extractSpacing>;
  elevation: ShadowToken[];
  border_radius: number[];
  motion: ReturnType<typeof extractMotion>;
}

export function extractCSSTokens(cssTexts: string[]): CSSTokens {
  const colors = extractColors(cssTexts);
  const full = cssTexts.join("\n");

  return {
    colors,
    color_strategy: detectColorStrategy(colors),
    dark_mode: full.includes("prefers-color-scheme") || full.includes("dark:"),
    typography: extractTypography(cssTexts),
    spacing: extractSpacing(cssTexts),
    elevation: extractElevation(cssTexts),
    border_radius: extractBorderRadius(cssTexts),
    motion: extractMotion(cssTexts),
  };
}
