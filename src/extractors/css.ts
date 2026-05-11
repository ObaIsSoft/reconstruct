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
  CSSBlock,
} from "../schema/types.js";
import { allText, firstPartyText } from "../schema/types.js";

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

// ── Gradient color extraction ─────────────────────────────────────────────────
// Extracts hex/rgb/hsl color stops from linear/radial/conic-gradient().
// These are often the primary chromatic expression of a design but invisible to
// flat CSS rule scanning because they live inside property values, not names.

function addHexFromText(text: string, map: Map<string, number>, weight: number): void {
  for (const hm of text.matchAll(/#([0-9a-fA-F]{3,6})\b/g)) {
    if (hm[1].length === 3 || hm[1].length === 6) {
      const hex = `#${normalizeHex(hm[1])}`;
      map.set(hex, (map.get(hex) ?? 0) + weight);
    }
  }
  for (const rm of text.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
    const hex = rgbToHex(+rm[1], +rm[2], +rm[3]);
    map.set(hex, (map.get(hex) ?? 0) + weight);
  }
  for (const hm of text.matchAll(/hsla?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%/g)) {
    const hex = hslToHex(+hm[1], +hm[2], +hm[3]);
    map.set(hex, (map.get(hex) ?? 0) + weight);
  }
}

function extractGradientColors(cssAll: string, varMap?: Map<string, string>): Map<string, number> {
  const gradientColors = new Map<string, number>();
  const gradRe = /(?:linear|radial|conic)-gradient\(/gi;
  let m: RegExpExecArray | null;
  while ((m = gradRe.exec(cssAll)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < cssAll.length && depth > 0) {
      if (cssAll[i] === "(") depth++;
      else if (cssAll[i] === ")") depth--;
      i++;
    }
    const content = cssAll.slice(m.index + m[0].length, i - 1);

    // Direct color literals in the gradient content
    addHexFromText(content, gradientColors, 2);

    // Tailwind gradient system: linear-gradient(to right, var(--tw-gradient-stops))
    // where --tw-gradient-stops expands to --tw-gradient-from ... --tw-gradient-to.
    // Resolve the actual color variables to surface the real gradient palette.
    if (varMap && /var\(--tw-gradient-stops\)/.test(content)) {
      for (const varName of ["--tw-gradient-from", "--tw-gradient-via", "--tw-gradient-to"]) {
        const resolved = resolveVar(varName, varMap);
        if (resolved) addHexFromText(resolved, gradientColors, 3);
      }
    }

    // Generic var() references in gradient stops
    if (varMap) {
      for (const vm of content.matchAll(/var\((--[\w-]+)\)/g)) {
        const resolved = resolveVar(vm[1], varMap);
        if (resolved) addHexFromText(resolved, gradientColors, 2);
      }
    }
  }
  return gradientColors;
}

// ── CSS variable resolution ───────────────────────────────────────────────────
// Modern sites define colors/fonts as CSS custom properties and reference them
// via var(). Without resolving these, the extractor misses most active usages.

function buildCssVarMap(cssText: string): Map<string, string> {
  const vars = new Map<string, string>();
  // Scan ALL rule blocks — custom properties can be defined on any selector:
  // :root, html, .dark, [data-theme="dark"], component classes, etc.
  // :root/:html definitions win — they're the canonical light-mode values.
  // Collect both so non-root-only vars (dark theme overrides, component vars) are captured.
  const ruleRe = /([^{}]*)\{([^{}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(cssText)) !== null) {
    const selector = m[1].trim();
    const block = m[2];
    const isRoot = /^(?::root|html)$/.test(selector);
    for (const prop of block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      const name = `--${prop[1].trim()}`;
      const value = prop[2].trim();
      if (isRoot || !vars.has(name)) {
        vars.set(name, value);
      }
    }
  }
  return vars;
}

function resolveVar(ref: string, vars: Map<string, string>, depth = 0): string | null {
  if (depth > 6) return null;
  const val = vars.get(ref);
  if (!val) return null;
  const inner = val.match(/^var\((--[\w-]+)\)/);
  if (inner) return resolveVar(inner[1], vars, depth + 1);
  return val;
}

// ── Color context helpers ─────────────────────────────────────────────────────

// Infer usage from the CSS property the color appears in
function inferColorUsage(context: string): ColorUsage {
  const ctx = context.toLowerCase();
  if (ctx.includes("background")) return "background";
  if (ctx.includes("border") || ctx.includes("outline")) return "border";
  if (ctx.includes("color")) return "text";
  if (ctx.includes("fill") || ctx.includes("stroke")) return "primary";
  return "unknown";
}

function hexToHSL(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function inferColorName(hex: string, usage: ColorUsage, index: number): string {
  if (hex.length !== 7) return `${usage}-${index}`;
  const { h, s, l } = hexToHSL(hex);

  if (l > 90) return "white";
  if (l < 10) return "black";
  if (s < 15) return `gray-${Math.round((100 - l) / 10) * 100}`;

  if (h < 15 || h >= 345) return `red-${index}`;
  if (h < 45) return `orange-${index}`;
  if (h < 75) return `yellow-${index}`;
  if (h < 150) return `green-${index}`;
  if (h < 195) return `teal-${index}`;
  if (h < 255) return `blue-${index}`;
  if (h < 285) return `purple-${index}`;
  if (h < 345) return `pink-${index}`;
  return `${usage}-${index}`;
}

export function extractColors(
  cssTexts: string[],
  fallbackContext?: string,
  varMap?: Map<string, string>
): ColorToken[] {
  const full = cssTexts.join("\n");
  const counts = new Map<string, { count: number; contexts: string[] }>();

  const addColor = (hex: string, context: string, weight = 1) => {
    const existing = counts.get(hex) ?? { count: 0, contexts: [] };
    existing.count += weight;
    if (existing.contexts.length < 5) existing.contexts.push(context);
    counts.set(hex, existing);
  };

  // Pass 1: direct hex/rgb/hsl values in CSS rule blocks
  const ruleRe = /([^{}]+)\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = ruleRe.exec(full)) !== null) {
    const ctx = (match[1] ?? "").trim();
    const block = match[2] ?? "";
    for (const hm of block.matchAll(HEX_RE)) {
      if (hm[1].length === 3 || hm[1].length === 6 || hm[1].length === 8) {
        addColor(`#${normalizeHex(hm[1])}`, ctx);
      }
    }
    for (const rm of block.matchAll(RGB_RE)) addColor(rgbToHex(+rm[1], +rm[2], +rm[3]), ctx);
    for (const hm of block.matchAll(HSL_RE)) addColor(hslToHex(+hm[1], +hm[2], +hm[3]), ctx);
  }

  // Pass 2: resolve var() references — each usage of a CSS variable counts as
  // an active usage of the underlying color, weighted higher than a definition.
  if (varMap && varMap.size > 0) {
    const ruleRe2 = /([^{}]+)\{([^}]+)\}/g;
    while ((match = ruleRe2.exec(full)) !== null) {
      const ctx = (match[1] ?? "").trim();
      // Skip :root definitions — those are already counted in pass 1
      if (/^:root/.test(ctx.trim())) continue;
      const block = match[2] ?? "";
      for (const vm of block.matchAll(/var\((--[\w-]+)\)/g)) {
        const resolved = resolveVar(vm[1], varMap);
        if (!resolved) continue;
        for (const hm of resolved.matchAll(HEX_RE)) {
          if (hm[1].length === 3 || hm[1].length === 6) {
            // Weight = 3: active usage outweighs a single :root definition
            addColor(`#${normalizeHex(hm[1])}`, ctx, 3);
          }
        }
        for (const rm of resolved.matchAll(RGB_RE)) addColor(rgbToHex(+rm[1], +rm[2], +rm[3]), ctx, 3);
      }
    }
  }

  // Pass 3: gradient color stops — linear/radial/conic-gradient() colors
  const gradColors = extractGradientColors(full, varMap);
  for (const [hex, weight] of gradColors) {
    addColor(hex, "gradient", weight);
  }

  // Fallback: if no CSS was extracted, sniff raw HTML/markdown for color values
  if (counts.size < 3 && fallbackContext && fallbackContext.length > 0) {
    for (const hm of fallbackContext.matchAll(HEX_RE)) {
      if (hm[1].length === 3 || hm[1].length === 6 || hm[1].length === 8) {
        addColor(`#${normalizeHex(hm[1])}`, "html");
      }
    }
    for (const rm of fallbackContext.matchAll(/rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/gi)) {
      addColor(rgbToHex(+rm[1], +rm[2], +rm[3]), "html");
    }
  }

  const minOccurrences = counts.size > 20 ? 2 : 1;

  return Array.from(counts.entries())
    .filter(([, v]) => v.count >= minOccurrences)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 40)
    .map(([hex, { count, contexts }], i) => {
      const usage = inferColorUsage(contexts[0] ?? "");
      return {
        value: hex,
        usage,
        name_inferred: inferColorName(hex, usage, i),
        occurrences: count,
      };
    });
}

// ── Typography extraction ─────────────────────────────────────────────────────

function inferFontRoleFromSelectors(selectors: string[]): FontRole {
  let headingScore = 0, bodyScore = 0, monoScore = 0, displayScore = 0;
  for (const s of selectors) {
    const low = s.toLowerCase();
    // Semantic HTML elements — high certainty
    if (/\bh[1-6]\b/.test(low)) headingScore += 3;
    if (/\bcode\b|\bpre\b/.test(low)) monoScore += 3;
    if (/\bbody\b|\bp\b/.test(low)) bodyScore += 3;
    // Class/id naming — lower weight, inferred
    if (/heading|title/.test(low)) headingScore += 1;
    if (/\bdisplay\b/.test(low)) displayScore += 1;
    if (/mono/.test(low)) monoScore += 1;
    if (/\.body\b|\.text\b/.test(low)) bodyScore += 1;
  }
  const max = Math.max(headingScore, bodyScore, monoScore, displayScore);
  if (max === 0) return "body";
  if (monoScore === max) return "mono";
  if (displayScore === max && displayScore > headingScore) return "display";
  if (headingScore === max) return "heading";
  return "body";
}

const SYSTEM_FONTS_RE = /^(system-ui|-apple-system|blinkmacsystemfont|segoe ui|roboto|arial|helvetica neue|helvetica|georgia|times new roman|times|verdana|tahoma|trebuchet ms|courier new|courier|monospace|sans-serif|serif|cursive|fantasy|ui-monospace|ui-sans-serif|ui-serif)$/i;

function inferFontSource(primaryFamily: string, cssText: string): FontSource {
  if (SYSTEM_FONTS_RE.test(primaryFamily.trim())) return "system";
  // If Google Fonts CSS was fetched (contains gstatic.com) and this family has @font-face
  const escapedFamily = primaryFamily.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hasFontFace = new RegExp(`@font-face[^}]*font-family\\s*:\\s*['"]?${escapedFamily}['"]?`, "i").test(cssText);
  if (hasFontFace && cssText.includes("fonts.gstatic.com")) return "google";
  if (hasFontFace) return "self-hosted";
  if (cssText.includes("fonts.googleapis.com")) return "google";
  return "cdn";
}

export interface TypographySchema {
  families: FontToken[];
  scale: number[];
  base_size: number;
  line_height_base: number;
  letter_spacing_pattern: string;
}

export function extractTypography(
  cssTexts: string[],
  fallbackContext?: string,
  varMap?: Map<string, string>,
  htmlContext?: string,
): TypographySchema {
  const full = cssTexts.join("\n");
  const analysisContext = full.length > 50 ? full : (fallbackContext ?? "");

  // primaryName → { weights, selectors, occurrences }
  const familyMap = new Map<string, { weights: Set<number>; selectors: string[]; count: number }>();
  const sizes = new Set<number>();
  const lineHeights: number[] = [];
  const letterSpacings: string[] = [];

  const ruleRe = /([^{}]+)\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = ruleRe.exec(analysisContext)) !== null) {
    const selector = match[1] ?? "";
    const block = match[2] ?? "";

    // font-family — resolve CSS variable references before storing
    // Skip @font-face blocks — those are font definitions, not element usages.
    // Fonts referenced only in @font-face but never in rules are loaded but unused.
    if (/@font-face/.test(selector)) continue;
    const ffMatch = block.match(/font-family\s*:\s*([^;]+)/i);
    if (ffMatch) {
      let raw = ffMatch[1].trim();

      // Resolve var() chain up to depth 6
      const varRef = raw.match(/^var\((--[\w-]+)\)/);
      if (varRef && varMap) {
        const resolved = resolveVar(varRef[1], varMap);
        if (!resolved) {
          // Unresolvable var — skip entirely, don't store "var(--foo)" as a font name
        } else {
          raw = resolved;
        }
      }

      // Skip still-unresolved var() references
      if (/^var\(/.test(raw)) {
        // don't store
      } else {
        // Extract primary font name from the stack: "'Quicksand', sans-serif" → "Quicksand"
        const primary = raw.split(",")[0].replace(/['"]/g, "").trim();
        if (/^(inherit|initial|unset|revert|none)$/i.test(primary)) {
          // CSS keyword — not a font name, skip
        } else if (primary && primary.length > 0 && !SYSTEM_FONTS_RE.test(primary)) {
          const existing = familyMap.get(primary) ?? { selectors: [], weights: new Set(), count: 0 };
          existing.selectors.push(selector.trim());
          existing.count++;
          familyMap.set(primary, existing);
        } else if (primary && SYSTEM_FONTS_RE.test(primary)) {
          // Still store system fonts if they're the only option
          const existing = familyMap.get(primary) ?? { selectors: [], weights: new Set(), count: 0 };
          existing.selectors.push(selector.trim());
          existing.count++;
          familyMap.set(primary, existing);
        }
      }
    }

    // font-weight — attribute to the most recently seen family
    const fwMatch = block.match(/font-weight\s*:\s*(\d+)/i);
    if (fwMatch) {
      const family = [...familyMap.keys()].at(-1);
      if (family) familyMap.get(family)!.weights.add(parseInt(fwMatch[1]));
    }

    // font-size
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

  const sortedLh = [...lineHeights].sort((a, b) => a - b);
  const line_height_base = sortedLh[Math.floor(sortedLh.length / 2)] ?? 1.5;

  const lsUniq = [...new Set(letterSpacings)];
  const letter_spacing_pattern = lsUniq.length === 0
    ? "normal"
    : lsUniq.some((s) => s.includes("em") && parseFloat(s) < 0) ? "tight"
    : lsUniq.some((s) => parseFloat(s) > 0.05) ? "loose"
    : "normal";

  // Fallback for sites where rule-scanning found no fonts (e.g. all font-family
  // declarations are behind unresolvable CSS variables, or the CSS was minimal).
  // Extract from Google Fonts link tags in the HTML — these are explicit, intentional
  // imports: fonts.googleapis.com/css2?family=Inter:wght@400;700
  // This is detection, not guessing: if the browser requests it from Google Fonts, it's used.
  // htmlContext is the raw HTML page — always search there for Google Fonts links.
  // fallbackContext is CSS text when CSS exists, so it won't contain link tags.
  const gfSource = htmlContext ?? (fallbackContext ?? "");
  if (familyMap.size === 0 && gfSource) {
    const gfRe = /fonts\.googleapis\.com\/css2?\?([^"'\s>]+)/gi;
    for (const gfm of gfSource.matchAll(gfRe)) {
      const qs = gfm[1];
      for (const familyParam of qs.matchAll(/family=([^&:]+)/gi)) {
        const name = decodeURIComponent(familyParam[1]).replace(/\+/g, " ").trim();
        if (name && !SYSTEM_FONTS_RE.test(name)) {
          const existing = familyMap.get(name) ?? { selectors: [], weights: new Set(), count: 0 };
          existing.count++;
          familyMap.set(name, existing);
        }
      }
    }
  }

  // Sort by occurrence count descending, cap at 5
  const families: FontToken[] = [...familyMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([primary, data]) => ({
      family: primary,
      source: inferFontSource(primary, full),
      weights: data.weights.size > 0 ? [...data.weights].sort() : [400],
      role: inferFontRoleFromSelectors(data.selectors),
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
    for (const dm of val.matchAll(/([\d.]+)(ms|s)\b/g)) {
      const ms = dm[2] === "s" ? Math.round(parseFloat(dm[1]) * 1000) : Math.round(parseFloat(dm[1]));
      if (ms > 0 && ms < 5000) durations.add(ms);
    }
    const easingMatch = val.match(/(?:ease[\w-]*|linear|cubic-bezier\([^)]+\)|steps\([^)]+\))/i);
    if (easingMatch) easings.add(easingMatch[0].trim());
  }

  // animations
  for (const m of full.matchAll(/animation\s*:\s*([^;}]+)/gi)) {
    const val = m[1];
    for (const dm of val.matchAll(/([\d.]+)(ms|s)\b/g)) {
      const ms = dm[2] === "s" ? Math.round(parseFloat(dm[1]) * 1000) : Math.round(parseFloat(dm[1]));
      if (ms > 0 && ms < 10000) durations.add(ms);
    }
  }

  // @keyframes — use the actual name defined in CSS, not an inferred label.
  // The keyframe name is what the author chose; it's more accurate than any mapping.
  for (const m of full.matchAll(/@keyframes\s+([\w-]+)/gi)) {
    patterns.add(m[1]);
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

// ── Dark mode detection ───────────────────────────────────────────────────────
// Count CSS declarations inside @media (prefers-color-scheme: dark) blocks.
// A single-declaration block is typically a third-party component override (e.g.
// a media player's focus ring variable). Site-level dark mode support produces
// many declarations; requiring ≥ 3 eliminates false positives from embedded widgets.

function countDarkModeDeclarations(css: string): number {
  const mediaRe = /@media\s*\([^)]*prefers-color-scheme\s*:\s*dark[^)]*\)\s*\{/gi;
  let total = 0;
  let m: RegExpExecArray | null;
  while ((m = mediaRe.exec(css)) !== null) {
    // Walk the braces to find the end of this @media block
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    const block = css.slice(m.index + m[0].length, i - 1);
    // Count declarations: lines containing "property: value"
    const declarations = block.match(/[\w-]+\s*:/g);
    total += declarations ? declarations.length : 0;
  }
  return total;
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface CSSTokens {
  colors: ColorToken[];
  color_strategy: "monochrome" | "analogous" | "complementary" | "triadic" | "unknown";
  dark_mode: boolean;
  gradient_function_count: number;  // count of *-gradient() calls in first-party CSS
  typography: TypographySchema;
  spacing: ReturnType<typeof extractSpacing>;
  elevation: ShadowToken[];
  border_radius: number[];
  motion: ReturnType<typeof extractMotion>;
}

export function extractCSSTokens(blocks: CSSBlock[], rawContext?: string): CSSTokens {
  const allTexts = allText(blocks);
  const fpTexts = firstPartyText(blocks);

  const allCss = allTexts.join("\n");
  const fpCss = fpTexts.join("\n");
  const analysisContext = allCss.length > 0 ? allCss : (rawContext ?? "");
  const fpContext = fpCss.length > 0 ? fpCss : analysisContext;

  console.log(`[Reconstruct] Extracting tokens from ${blocks.length} CSS blocks (${fpTexts.length} first-party, ${allTexts.length - fpTexts.length} third-party, total chars: ${allCss.length})`);
  if (allCss.length === 0 && analysisContext.length > 0) {
    console.log(`[Reconstruct] Low-fidelity fallback: Sniffing Design DNA from raw context (${analysisContext.length} chars)`);
  }

  // Build CSS variable map from all CSS — vars defined anywhere may be used anywhere
  const varMap = buildCssVarMap(analysisContext);

  const colors = extractColors(allTexts, analysisContext, varMap);
  const typography = extractTypography(allTexts, analysisContext, varMap, rawContext);

  // Dark mode: count declarations only in first-party CSS to avoid third-party
  // components (media players, widgets) falsely triggering dark_mode: true.
  const dark_mode = countDarkModeDeclarations(fpContext) >= 3;

  // Count actual CSS gradient function calls in first-party CSS.
  // This is more reliable than counting "gradient" mentions in HTML which picks up
  // class names, script content, and other non-CSS text.
  const gradient_function_count = (fpContext.match(/(?:linear|radial|conic)-gradient\s*\(/gi) ?? []).length;

  return {
    colors,
    color_strategy: detectColorStrategy(colors),
    dark_mode,
    gradient_function_count,
    typography,
    // Elevation and motion use first-party only — third-party player/widget CSS
    // inflates these with its own animation values and shadow layers.
    spacing: extractSpacing(fpTexts.length > 0 ? fpTexts : allTexts),
    elevation: extractElevation(fpTexts.length > 0 ? fpTexts : allTexts),
    border_radius: extractBorderRadius(fpTexts.length > 0 ? fpTexts : allTexts),
    motion: extractMotion(fpTexts.length > 0 ? fpTexts : allTexts),
  };
}
