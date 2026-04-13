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

interface SchoolSignal {
  name: string;
  test: (tokens: CSSTokens, html: string) => boolean;
}

const SCHOOL_SIGNALS: SchoolSignal[] = [
  {
    name: "minimalism",
    test: (t) =>
      t.colors.length < 5 &&
      t.elevation.length === 0 &&
      t.border_radius.every((r) => r <= 4) &&
      t.spacing.base_unit >= 8,
  },
  {
    name: "neo-brutalism",
    test: (t, html) =>
      t.elevation.some((s) => /\d+px \d+px 0/.test(s.value)) &&
      t.colors.some((c) => isHighContrast(c.value)) &&
      t.border_radius.some((r) => r === 0),
  },
  {
    name: "glassmorphism",
    test: (_, html) =>
      /backdrop-filter/.test(html) ||
      /blur\(\d+px\)/.test(html),
  },
  {
    name: "neumorphism",
    test: (t) =>
      t.elevation.some(
        (s) =>
          s.value.includes("inset") &&
          (s.value.match(/rgba/g) ?? []).length >= 2
      ),
  },
  {
    name: "flat-design",
    test: (t) =>
      t.elevation.length === 0 &&
      t.colors.length >= 3 &&
      t.motion.durations_ms.length === 0,
  },
  {
    name: "material-design",
    test: (t, html) =>
      t.elevation.length >= 3 &&
      t.motion.easings.some((e) => /cubic-bezier\(0\.4/.test(e)) &&
      /ripple|MuiButton|MuiCard/.test(html),
  },
  {
    name: "claymorphism",
    test: (t) =>
      t.border_radius.some((r) => r >= 20) &&
      t.elevation.some((s) => /rgba/.test(s.value)) &&
      t.colors.some((c) => isSaturated(c.value)),
  },
  {
    name: "dark-mode-first",
    test: (t) =>
      t.dark_mode &&
      t.colors.filter((c) => isDark(c.value)).length >
        t.colors.filter((c) => !isDark(c.value)).length,
  },
  {
    name: "typography-led",
    test: (t) =>
      t.typography.families.length >= 2 &&
      t.typography.scale.length >= 6 &&
      t.colors.length < 4,
  },
  {
    name: "gradient-heavy",
    test: (_, html) => (html.match(/gradient/g) ?? []).length > 5,
  },
];

// ── Personality inference ─────────────────────────────────────────────────────

interface PersonalitySignal {
  trait: string;
  test: (tokens: CSSTokens, html: string) => boolean;
}

const PERSONALITY_SIGNALS: PersonalitySignal[] = [
  {
    trait: "clinical",
    test: (t) =>
      t.colors.length < 4 &&
      t.spacing.base_unit === 8 &&
      t.border_radius.every((r) => r <= 4),
  },
  {
    trait: "warm",
    test: (t) =>
      t.colors.some((c) => isWarm(c.value)),
  },
  {
    trait: "playful",
    test: (t) =>
      t.border_radius.some((r) => r >= 16) &&
      t.colors.length >= 5 &&
      t.motion.patterns.includes("bounce"),
  },
  {
    trait: "authoritative",
    test: (t) =>
      t.typography.families.some((f) => /serif/i.test(f.family)) &&
      t.colors.some((c) => isDark(c.value)) &&
      t.spacing.base_unit >= 8,
  },
  {
    trait: "energetic",
    test: (t) =>
      t.motion.durations_ms.some((d) => d < 200) &&
      t.colors.some((c) => isSaturated(c.value)),
  },
  {
    trait: "elegant",
    test: (t) =>
      t.typography.families.some(
        (f) => /serif|italic/i.test(f.family)
      ) &&
      t.spacing.base_unit >= 8 &&
      t.colors.length < 6,
  },
  {
    trait: "bold",
    test: (t) =>
      t.typography.scale.some((s) => s >= 48) &&
      t.colors.some((c) => isSaturated(c.value)),
  },
  {
    trait: "technical",
    test: (t) =>
      t.typography.families.some((f) => f.role === "mono") &&
      t.colors.some((c) => isDark(c.value)),
  },
];

// ── Density ───────────────────────────────────────────────────────────────────

export function inferDensity(tokens: CSSTokens): DesignDensity {
  const { scale, base_unit } = tokens.spacing;
  const avgSpacing = scale.reduce((a, b) => a + b, 0) / (scale.length || 1);

  if (avgSpacing > 24 || base_unit >= 8) return "sparse";
  if (avgSpacing < 12 || base_unit <= 4) return "dense";
  return "moderate";
}

// ── Whitespace use ────────────────────────────────────────────────────────────

export function inferWhitespace(tokens: CSSTokens): "generous" | "moderate" | "tight" {
  const largeSpacings = tokens.spacing.scale.filter((s) => s >= 32).length;
  const totalSpacings = tokens.spacing.scale.length;

  if (largeSpacings / Math.max(totalSpacings, 1) > 0.4) return "generous";
  if (largeSpacings / Math.max(totalSpacings, 1) < 0.15) return "tight";
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
    .filter(({ test }) => {
      try { return test(tokens, html); } catch { return false; }
    })
    .map(({ name }) => name);

  const personality = PERSONALITY_SIGNALS
    .filter(({ test }) => {
      try { return test(tokens, html); } catch { return false; }
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
