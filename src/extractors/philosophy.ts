// Philosophy inferencer — design school, density, personality, whitespace, hierarchy
// Synthesises signals from CSS tokens + DOM structure into human-readable design intent

import type { DesignDensity, AccessibilityGrade } from "../schema/types.js";
import type { CSSTokens } from "./css.js";

export interface DesignPhilosophy {
  design_school: string[];
  density: DesignDensity;
  personality: string[];
  accessibility_grade: AccessibilityGrade;
  whitespace_use: "generous" | "moderate" | "tight";
  visual_hierarchy_method: string[];
}

// ── Design school inference ───────────────────────────────────────────────────

// Score-based: each signal returns 0-N points; threshold determines match.
// This prevents strict AND conditions from blocking most real sites.
interface SchoolSignal {
  name: string;
  score: (tokens: CSSTokens, html: string) => number;
  threshold: number;
}

const SCHOOL_SIGNALS: SchoolSignal[] = [
  {
    name: "minimalism",
    threshold: 2,
    score: (t) => {
      let s = 0;
      if (t.colors.length < 5) s++;
      if (t.colors.length < 3) s++;
      if (t.elevation.length === 0) s++;
      if (t.border_radius.length === 0 || t.border_radius.every((r) => r <= 8)) s++;
      if (t.spacing.base_unit >= 8) s++;
      if (t.motion.durations_ms.length === 0) s++;
      return s;
    },
  },
  {
    name: "neo-brutalism",
    threshold: 2,
    score: (t, html) => {
      let s = 0;
      if (t.elevation.some((sh) => /\d+px \d+px 0/.test(sh.value))) s += 2;
      if (t.colors.some((c) => isHighContrast(c.value))) s++;
      if (t.border_radius.some((r) => r === 0)) s++;
      if (/border.*\d+px.*solid/i.test(html)) s++;
      return s;
    },
  },
  {
    name: "glassmorphism",
    threshold: 1,
    score: (_, html) => {
      let s = 0;
      if (/backdrop-filter/.test(html)) s += 2;
      if (/blur\(\d+px\)/.test(html)) s++;
      if (/rgba\([^)]+,\s*0\.\d\)/.test(html)) s++;
      return s;
    },
  },
  {
    name: "neumorphism",
    threshold: 1,
    score: (t) => {
      let s = 0;
      if (t.elevation.some((sh) => sh.value.includes("inset") && (sh.value.match(/rgba/g) ?? []).length >= 2)) s += 2;
      if (t.elevation.length >= 2 && t.elevation.some((sh) => sh.value.includes("inset"))) s++;
      return s;
    },
  },
  {
    name: "flat-design",
    threshold: 2,
    score: (t) => {
      let s = 0;
      if (t.elevation.length === 0) s += 2;
      if (t.colors.length >= 3) s++;
      if (t.motion.durations_ms.length === 0) s++;
      if (t.border_radius.length > 0 && t.border_radius.every((r) => r < 6)) s++;
      return s;
    },
  },
  {
    name: "material-design",
    threshold: 2,
    score: (t, html) => {
      let s = 0;
      if (t.elevation.length >= 3) s += 2;
      if (t.motion.easings.some((e) => /cubic-bezier\(0\.4/.test(e))) s++;
      if (/ripple|MuiButton|MuiCard/.test(html)) s += 2;
      if (t.motion.durations_ms.some((d) => d === 200 || d === 300)) s++;
      return s;
    },
  },
  {
    name: "claymorphism",
    threshold: 2,
    score: (t) => {
      let s = 0;
      if (t.border_radius.some((r) => r >= 16)) s++;
      if (t.border_radius.some((r) => r >= 24)) s++;
      if (t.elevation.some((sh) => /rgba/.test(sh.value))) s++;
      if (t.colors.some((c) => isSaturated(c.value))) s++;
      return s;
    },
  },
  {
    name: "dark-mode-first",
    threshold: 2,
    score: (t) => {
      let s = 0;
      if (t.dark_mode) s++;
      if (t.colors.filter((c) => isDark(c.value)).length > t.colors.filter((c) => !isDark(c.value)).length) s++;
      if (t.colors.some((c) => isDark(c.value) && c.occurrences > 3)) s++;
      return s;
    },
  },
  {
    name: "typography-led",
    threshold: 2,
    score: (t) => {
      let s = 0;
      if (t.typography.families.length >= 2) s++;
      if (t.typography.scale.length >= 6) s++;
      if (t.typography.scale.some((sz) => sz >= 48)) s++;
      if (t.colors.length < 5) s++;
      return s;
    },
  },
  {
    name: "gradient-heavy",
    threshold: 1,
    score: (_, html) => {
      const count = (html.match(/gradient/g) ?? []).length;
      return count > 5 ? 2 : count > 2 ? 1 : 0;
    },
  },
  {
    name: "editorial",
    threshold: 2,
    score: (t) => {
      let s = 0;
      if (t.typography.families.some((f) => /serif/i.test(f.family))) s++;
      if (t.typography.scale.length >= 5) s++;
      if (t.typography.families.length >= 2) s++;
      if (t.spacing.scale.some((sp) => sp >= 48)) s++;
      if (t.colors.length < 5) s++;
      return s;
    },
  },
  {
    name: "data-dense",
    threshold: 2,
    score: (t) => {
      let s = 0;
      if (t.spacing.base_unit <= 4) s += 2;
      if (t.typography.base_size <= 13) s++;
      if (t.typography.families.some((f) => f.role === "mono")) s++;
      if (t.colors.length >= 8) s++;
      return s;
    },
  },
];

// ── Personality inference ─────────────────────────────────────────────────────

interface PersonalitySignal {
  trait: string;
  score: (tokens: CSSTokens, html: string) => number;
  threshold: number;
}

const PERSONALITY_SIGNALS: PersonalitySignal[] = [
  {
    trait: "clinical",
    threshold: 2,
    score: (t) => {
      let s = 0;
      if (t.colors.length < 5) s++;
      if (t.border_radius.length === 0 || t.border_radius.every((r) => r <= 6)) s++;
      if (t.spacing.base_unit >= 8) s++;
      if (t.motion.durations_ms.length === 0) s++;
      if (t.typography.families.every((f) => !/serif/i.test(f.family))) s++;
      return s;
    },
  },
  {
    trait: "warm",
    threshold: 1,
    score: (t) => {
      let s = 0;
      if (t.colors.some((c) => isWarm(c.value))) s++;
      if (t.colors.filter((c) => isWarm(c.value)).length >= 2) s++;
      if (t.border_radius.some((r) => r >= 8)) s++;
      return s;
    },
  },
  {
    trait: "playful",
    threshold: 2,
    score: (t, html) => {
      let s = 0;
      if (t.border_radius.some((r) => r >= 16)) s++;
      if (t.colors.length >= 5) s++;
      if (t.colors.some((c) => isSaturated(c.value))) s++;
      if (t.motion.patterns.includes("bounce")) s++;
      if (/emoji|🎉|🚀|✨/.test(html)) s++;
      if (t.motion.durations_ms.length > 0) s++;
      return s;
    },
  },
  {
    trait: "authoritative",
    threshold: 2,
    score: (t) => {
      let s = 0;
      if (t.typography.families.some((f) => /serif/i.test(f.family))) s++;
      if (t.colors.some((c) => isDark(c.value))) s++;
      if (t.spacing.base_unit >= 8) s++;
      if (t.typography.scale.length >= 4) s++;
      if (t.colors.length < 5) s++;
      return s;
    },
  },
  {
    trait: "energetic",
    threshold: 2,
    score: (t) => {
      let s = 0;
      if (t.motion.durations_ms.some((d) => d < 200)) s++;
      if (t.motion.durations_ms.length > 0) s++;
      if (t.colors.some((c) => isSaturated(c.value))) s++;
      if (t.typography.scale.some((sz) => sz >= 48)) s++;
      return s;
    },
  },
  {
    trait: "elegant",
    threshold: 2,
    score: (t) => {
      let s = 0;
      if (t.typography.families.some((f) => /serif|italic/i.test(f.family))) s++;
      if (t.spacing.base_unit >= 8) s++;
      if (t.colors.length < 6) s++;
      if (t.elevation.length > 0 && t.elevation.length < 4) s++;
      if (t.motion.easings.some((e) => /cubic-bezier/.test(e))) s++;
      return s;
    },
  },
  {
    trait: "bold",
    threshold: 1,
    score: (t) => {
      let s = 0;
      if (t.typography.scale.some((sz) => sz >= 48)) s++;
      if (t.typography.scale.some((sz) => sz >= 72)) s++;
      if (t.colors.some((c) => isSaturated(c.value))) s++;
      return s;
    },
  },
  {
    trait: "technical",
    threshold: 1,
    score: (t, html) => {
      let s = 0;
      if (t.typography.families.some((f) => f.role === "mono")) s += 2;
      if (t.colors.some((c) => isDark(c.value))) s++;
      if (/code|pre|kbd/.test(html)) s++;
      return s;
    },
  },
];

// ── Density ───────────────────────────────────────────────────────────────────

export function inferDensity(tokens: CSSTokens): DesignDensity {
  const { scale } = tokens.spacing;
  if (scale.length === 0) return "moderate";

  // Median is more robust than average — large section spacings shouldn't be cancelled
  // by many small inline paddings, and vice versa.
  const sorted = [...scale].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const maxSpacing = sorted[sorted.length - 1];
  const largeRatio = sorted.filter((s) => s >= 32).length / sorted.length;

  if (median > 20 || largeRatio > 0.25 || maxSpacing >= 80) return "sparse";
  if (median < 8 && largeRatio < 0.1) return "dense";
  return "moderate";
}

// ── Whitespace use ────────────────────────────────────────────────────────────

export function inferWhitespace(tokens: CSSTokens): "generous" | "moderate" | "tight" {
  const { scale } = tokens.spacing;
  if (scale.length === 0) return "moderate";

  const largeSpacings = scale.filter((s) => s >= 32).length;
  const totalSpacings = scale.length;
  const maxSpacing = scale[scale.length - 1] ?? 0;

  if (largeSpacings / Math.max(totalSpacings, 1) > 0.3 || maxSpacing >= 80) return "generous";
  if (largeSpacings / Math.max(totalSpacings, 1) < 0.1 && maxSpacing < 32) return "tight";
  return "moderate";
}

// ── Visual hierarchy method ───────────────────────────────────────────────────

export function inferHierarchyMethods(tokens: CSSTokens): string[] {
  const methods: string[] = [];

  if (tokens.typography.scale.length >= 4) methods.push("size");
  if (tokens.typography.families.some((f) => f.weights.length > 2)) methods.push("weight");
  if (tokens.colors.length >= 4) methods.push("color");
  if (tokens.spacing.scale.some((s) => s >= 32)) methods.push("spacing");
  if (tokens.elevation.length >= 2) methods.push("elevation");
  if (tokens.motion.durations_ms.length > 0) methods.push("motion");

  return methods;
}

// ── Color utility helpers ─────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return null;
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
}

function isDark(hex: string): boolean {
  return luminance(hex) < 0.4;
}

function isSaturated(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min > 0.4;
}

function isWarm(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  return rgb[0] > rgb[2] + 20; // more red than blue
}

function isHighContrast(hex: string): boolean {
  const l = luminance(hex);
  return l > 0.85 || l < 0.15;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function inferPhilosophy(
  tokens: CSSTokens,
  html: string,
  accessibilityGrade: AccessibilityGrade
): DesignPhilosophy {
  const design_school = SCHOOL_SIGNALS
    .filter(({ score, threshold }) => {
      try { return score(tokens, html) >= threshold; } catch { return false; }
    })
    .map(({ name }) => name);

  const personality = PERSONALITY_SIGNALS
    .filter(({ score, threshold }) => {
      try { return score(tokens, html) >= threshold; } catch { return false; }
    })
    .map(({ trait }) => trait);

  return {
    design_school: design_school.length > 0 ? design_school : ["unknown"],
    density: inferDensity(tokens),
    personality: personality.length > 0 ? personality : ["neutral"],
    accessibility_grade: accessibilityGrade,
    whitespace_use: inferWhitespace(tokens),
    visual_hierarchy_method: inferHierarchyMethods(tokens),
  };
}
