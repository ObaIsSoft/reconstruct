// Philosophy inferencer — design character, density, personality, whitespace, hierarchy
// All outputs are derived from measured token dimensions — no fixed school vocabulary,
// no hardcoded named traits. The description emerges from what the CSS actually says.

import type { DesignDensity, AccessibilityGrade } from "../schema/types.js";
import type { CSSTokens } from "./css.js";
import type { ContentTokens } from "./content.js";

export interface DesignPhilosophy {
  design_school: string[];
  density: DesignDensity;
  personality: string[];
  accessibility_grade: AccessibilityGrade;
  whitespace_use: "generous" | "moderate" | "tight";
  visual_hierarchy_method: string[];
}

// ── Color utilities ───────────────────────────────────────────────────────────

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

function chromaSaturation(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => v / 255);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function hueAngle(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  if (delta < 0.05) return null;
  let h = 0;
  if (max === r) h = ((g - b) / delta + 6) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  return h * 60;
}

function isWarm(hex: string): boolean {
  const h = hueAngle(hex);
  // Warm = reds, oranges, yellows (hue 0–75° and 300–360°)
  return h !== null && (h < 75 || h > 300);
}

function isCool(hex: string): boolean {
  const h = hueAngle(hex);
  return h !== null && h > 160 && h < 280;
}

function isSaturated(hex: string): boolean {
  return chromaSaturation(hex) > 0.35;
}

function isDark(hex: string): boolean {
  return luminance(hex) < 0.35;
}

function isLight(hex: string): boolean {
  return luminance(hex) > 0.75;
}

function isNeutral(hex: string): boolean {
  return chromaSaturation(hex) < 0.08;
}

// ── CSS generic family detection ──────────────────────────────────────────────

const CSS_GENERICS = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy",
  "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace",
  "-apple-system", "blinkmacsystemfont",
]);

function isGenericFamily(name: string): boolean {
  return CSS_GENERICS.has(name.toLowerCase().trim());
}

// ── Serif family detection ────────────────────────────────────────────────────
// Pattern-free: any font whose name contains "serif" but NOT "sans" is a serif.
// Common serif names are also matched; this catches unlisted custom/variable serifs.

function isSerifFamily(family: string): boolean {
  const n = family.toLowerCase();
  if (/\bsans\b/.test(n)) return false;
  if (/\bserif\b/.test(n)) return true;
  // Well-known serif faces — this list is a fallback, not the primary mechanism
  return /garamond|georgia|baskerville|caslon|bodoni|palatino|cormorant|playfair|lora|merriweather|eb garamond|libre baskerville|tiempos|literata|spectral|freight|canela|domaine|lyon text|newsreader/i.test(family);
}

function isMonoFamily(family: string, role: string): boolean {
  if (role === "mono") return true;
  return /mono|code|ibm plex mono|jetbrains|fira code|cascadia|courier|consolas|inconsolata|source code|commit|spacemono/i.test(family);
}

function isDisplayFace(family: string): boolean {
  return /display|poster|headline|banner|clash|cabinet|satoshi|zodiak|array|nippo|melodrama|editorial/i.test(family);
}

// ── Design character derivation ───────────────────────────────────────────────
// Characterises each design dimension independently. Output is an array of
// descriptors derived purely from measured token values — no named school vocabulary.

export function deriveDesignCharacter(tokens: CSSTokens, html: string): string[] {
  const descriptors: string[] = [];
  const colors = tokens.colors;

  // ── Chromatic character ──────────────────────────────────────────────────────
  const saturated = colors.filter((c) => isSaturated(c.value));
  const neutral = colors.filter((c) => isNeutral(c.value));
  const warm = colors.filter((c) => isWarm(c.value));
  const cool = colors.filter((c) => isCool(c.value));
  const dark = colors.filter((c) => isDark(c.value));
  const light = colors.filter((c) => isLight(c.value));
  const satRatio = colors.length > 0 ? saturated.length / colors.length : 0;
  const neutralRatio = colors.length > 0 ? neutral.length / colors.length : 0;
  // Use the CSS gradient function count from the token extractor — this counts actual
  // CSS *-gradient() calls in first-party stylesheets, not arbitrary "gradient" text in HTML.
  const gradientCount = tokens.gradient_function_count;

  if (gradientCount > 5) {
    descriptors.push("gradient-led color");
  } else if (neutralRatio > 0.85 || saturated.length === 0) {
    descriptors.push("monochrome");
  } else if (satRatio < 0.2) {
    const accentNote = warm.length >= 1 ? " with warm accent" : cool.length >= 1 ? " with cool accent" : "";
    descriptors.push(`chromatic restraint${accentNote}`);
  } else if (satRatio > 0.55) {
    descriptors.push("chromatic expression");
  }

  // Determine dark-first from actual color luminance balance, not from whether
  // dark: Tailwind utilities are present (they appear in all dark-mode-capable Tailwind sites).
  const isDarkFirst = dark.length > light.length + 1;
  if (isDarkFirst && tokens.dark_mode) {
    descriptors.push("dark-first");
  } else if (isDarkFirst && !tokens.dark_mode) {
    descriptors.push("dark palette, light-mode only");
  }

  if (warm.length >= 3 && warm.length >= cool.length * 2) {
    descriptors.push("warm palette");
  } else if (cool.length >= 3 && cool.length >= warm.length * 2) {
    descriptors.push("cool palette");
  }

  // ── Surface language ─────────────────────────────────────────────────────────
  const hasBackdropFilter = /backdrop-filter/.test(html);
  // Require actual pixel-value inset shadow — CSS variable names (e.g. var(--tw-inset-shadow))
  // contain "inset" as a substring but are not neumorphic shadows.
  const hasInsetShadow = tokens.elevation.some(
    (e) => /\binset\b/.test(e.value) && /\d+px\s+\d+px/.test(e.value)
  );
  const hasFlatShadow = tokens.elevation.some((e) => /\d+px \d+px 0(?:px)?\b/.test(e.value));
  const hasColouredShadow = tokens.elevation.some((e) => /rgba\([^)]*[1-9],/.test(e.value) && !/rgba\(\s*0\s*,\s*0\s*,\s*0/.test(e.value));
  const elevationLevels = tokens.elevation.length;

  if (hasBackdropFilter) {
    descriptors.push("translucent layering");
  } else if (hasInsetShadow && elevationLevels >= 2) {
    descriptors.push("extruded surface (neumorphic shadow)");
  } else if (hasFlatShadow) {
    descriptors.push("hard-edge shadow");
  } else if (hasColouredShadow) {
    descriptors.push("coloured elevation");
  } else if (elevationLevels >= 4) {
    descriptors.push("layered elevation");
  } else if (elevationLevels === 0) {
    descriptors.push("flat surface");
  }

  // ── Typography character ──────────────────────────────────────────────────────
  const scale = tokens.typography.scale;
  const namedFamilies = tokens.typography.families.filter((f) => !isGenericFamily(f.family));
  const hasSerif = namedFamilies.some((f) => isSerifFamily(f.family));
  const hasMono = namedFamilies.some((f) => isMonoFamily(f.family, f.role));
  const hasDisplay = namedFamilies.some((f) => isDisplayFace(f.family));
  const maxScale = scale.length > 0 ? Math.max(...scale) : 0;
  const minScale = scale.length > 0 ? Math.min(...scale) : 0;
  // Scale ratio = how wide the type range is — high ratio means expressive, not just more steps
  const scaleRatio = minScale > 0 ? maxScale / minScale : 1;

  if (namedFamilies.length >= 2 && hasSerif) {
    descriptors.push("editorial type pairing");
  } else if (hasDisplay && namedFamilies.length >= 2) {
    descriptors.push("display-led type pairing");
  } else if (hasSerif) {
    descriptors.push("serif typographic character");
  } else if (hasDisplay) {
    descriptors.push("display typographic character");
  }

  if (hasMono) {
    descriptors.push("monospace identity");
  }

  // A wide scale ratio (4×+) or very large ceiling signals expressive type intent
  if (scaleRatio >= 4 || maxScale >= 48) {
    descriptors.push("expressive type scale");
  } else if (scale.length >= 5) {
    descriptors.push("structured type hierarchy");
  }

  // ── Motion character ─────────────────────────────────────────────────────────
  const durCount = tokens.motion.durations_ms.length;
  const minDur = durCount > 0 ? Math.min(...tokens.motion.durations_ms) : null;
  const maxDur = durCount > 0 ? Math.max(...tokens.motion.durations_ms) : null;
  const hasPhysical = tokens.motion.patterns.some((p) => ["bounce", "spring", "float"].includes(p));
  const hasCustomEasing = tokens.motion.easings.some((e) => /cubic-bezier/.test(e));
  const durRange = minDur !== null && maxDur !== null ? maxDur - minDur : 0;

  if (durCount === 0) {
    descriptors.push("static — no CSS transitions");
  } else if (durCount >= 8 || durRange > 1000) {
    descriptors.push(hasPhysical ? "choreographed physical motion" : "choreographed motion");
  } else if (durCount >= 4 || hasCustomEasing) {
    descriptors.push(hasPhysical ? "considered motion with physical feel" : "considered transitions");
  } else if (minDur !== null && minDur < 150) {
    descriptors.push("snappy microinteractions");
  } else {
    descriptors.push("functional transitions");
  }

  // ── Form language ─────────────────────────────────────────────────────────────
  const nonCircular = tokens.border_radius.filter((r) => r < 50);
  const maxRadius = nonCircular.length > 0 ? Math.max(...nonCircular) : 0;
  const minRadius = nonCircular.length > 0 ? Math.min(...nonCircular) : 0;
  const allSharp = tokens.border_radius.length > 0 && tokens.border_radius.every((r) => r === 0);
  const hasCircular = tokens.border_radius.some((r) => r >= 50);

  if (allSharp) {
    descriptors.push("pure sharp geometry");
  } else if (maxRadius >= 48) {
    descriptors.push("pill-shaped forms");
  } else if (maxRadius >= 20) {
    descriptors.push("rounded forms");
  } else if (maxRadius >= 8) {
    descriptors.push("softened corners");
  } else if (maxRadius > 0) {
    descriptors.push("minimal rounding");
  }
  if (hasCircular && !allSharp && maxRadius < 48) {
    descriptors.push("circular elements present");
  }

  // ── Spacing philosophy ────────────────────────────────────────────────────────
  // Derived from the actual spacing scale values, not assumed thresholds
  const spacingScale = tokens.spacing.scale;
  if (spacingScale.length >= 3) {
    const maxSp = spacingScale[spacingScale.length - 1];
    const medianSp = spacingScale[Math.floor(spacingScale.length / 2)];
    const tightSp = spacingScale.filter((s) => s <= 4).length;
    const largeSp = spacingScale.filter((s) => s >= 40).length;

    if (largeSp >= 2 || maxSp >= 80) {
      descriptors.push("generous spatial breathing room");
    } else if (tightSp >= spacingScale.length * 0.5 && maxSp < 24) {
      descriptors.push("tight information density");
    }
    // moderate spacing is the default — don't add a descriptor for it
  }

  return descriptors;
}

// ── Personality derivation ────────────────────────────────────────────────────
// Personality traits emerge from dimensional combinations, not threshold matching
// against a fixed vocabulary. The dimension evidence determines the trait.

// Returns true when site content signals a serious/editorial/literary context
// that should suppress personality traits inferred from incidental CSS alone
function isSeriousContentContext(content?: ContentTokens): boolean {
  if (!content) return false;
  const text = (content.site_purpose + " " + content.headings.join(" ")).toLowerCase();
  return /portfolio|essay|writing|editorial|literary|journal|story|stories|art|poetry|prose|fiction|nonfiction|memoir|author|writer|photography|film|gallery|museum|archive|research|academic|thesis|dissertation|publication|magazine|review|criticism/.test(text);
}

export function derivePersonality(tokens: CSSTokens, html: string, content?: ContentTokens): string[] {
  const traits: string[] = [];
  const colors = tokens.colors;
  const namedFamilies = tokens.typography.families.filter((f) => !isGenericFamily(f.family));

  const saturated = colors.filter((c) => isSaturated(c.value));
  const warm = colors.filter((c) => isWarm(c.value));
  const dark = colors.filter((c) => isDark(c.value));
  const light = colors.filter((c) => isLight(c.value));
  const hasSerif = namedFamilies.some((f) => isSerifFamily(f.family));
  const hasMono = namedFamilies.some((f) => isMonoFamily(f.family, f.role));
  const maxScale = tokens.typography.scale.length > 0 ? Math.max(...tokens.typography.scale) : 0;
  const minDur = tokens.motion.durations_ms.length > 0 ? Math.min(...tokens.motion.durations_ms) : null;
  const hasPhysicalMotion = tokens.motion.patterns.some((p) => ["bounce", "spring", "float"].includes(p));
  const hasCustomEasing = tokens.motion.easings.some((e) => /cubic-bezier/.test(e));
  const seriousContent = isSeriousContentContext(content);

  // Authoritative: serif type + restrained saturation + structured hierarchy
  if (hasSerif && saturated.length <= 1 && tokens.typography.scale.length >= 4) {
    traits.push("authoritative");
  }

  // Warm: requires genuinely warm-dominant palette (multiple warm tokens), not just an accent
  if (warm.length >= 2 && warm.length >= saturated.length * 0.4) {
    traits.push("warm");
  }

  // Playful: physical/bouncy motion + any chromatic saturation
  // OR expressive radius (rounded forms) + multi-color palette
  // Suppressed when content signals serious/editorial context (bounce animation ≠ playful editorial site)
  // Also suppressed on dark-dominant palettes — playful associations are light-mode traits.
  const isDarkDominant = dark.length > light.length + 3;
  if (!seriousContent && !isDarkDominant) {
    const hasExpressiveRadius = tokens.border_radius.filter((r) => r >= 16 && r < 50).length > 0;
    if (hasPhysicalMotion && saturated.length >= 1) {
      traits.push("playful");
    } else if (hasExpressiveRadius && saturated.length >= 2) {
      traits.push("playful");
    }
  }

  // Energetic: fast transitions are the required signal — animations existing isn't enough
  if (minDur !== null && minDur < 200) {
    traits.push("energetic");
  }

  // Elegant: serif or display type + restrained palette + custom easing suggests craft
  if ((hasSerif || namedFamilies.some((f) => isDisplayFace(f.family)))
    && colors.length <= 8
    && hasCustomEasing) {
    traits.push("elegant");
  }

  // Clinical: no decoration whatsoever — no elevation, no animation, no saturation
  if (tokens.elevation.length === 0
    && tokens.motion.durations_ms.length === 0
    && saturated.length === 0) {
    traits.push("clinical");
  }

  // Bold: dramatic type ceiling — not just any large heading, needs real scale
  if (maxScale >= 72) {
    traits.push("bold");
  }

  // Technical: mono font choice is the defining signal — dark palette alone is not technical
  if (hasMono) {
    traits.push("technical");
  }

  return traits;
}

// ── Density ───────────────────────────────────────────────────────────────────

export function inferDensity(tokens: CSSTokens): DesignDensity {
  const { scale } = tokens.spacing;
  if (scale.length === 0) return "moderate";

  const sorted = [...scale].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const maxSpacing = sorted[sorted.length - 1];
  const largeRatio = sorted.filter((s) => s >= 32).length / sorted.length;

  // Use relative thresholds derived from the scale itself, not fixed px cutoffs
  const p75 = sorted[Math.floor(sorted.length * 0.75)];
  if (median > p75 * 0.6 && (largeRatio > 0.25 || maxSpacing >= 80)) return "sparse";
  if (median < sorted[Math.floor(sorted.length * 0.25)] * 1.5 && largeRatio < 0.1) return "dense";
  return "moderate";
}

// ── Whitespace use ────────────────────────────────────────────────────────────

export function inferWhitespace(tokens: CSSTokens): "generous" | "moderate" | "tight" {
  const { scale } = tokens.spacing;
  if (scale.length === 0) return "moderate";

  const maxSpacing = Math.max(...scale);
  // 32px is the conventional CSS section-level spacing break; 80px signals generous hero/section gaps
  const largeSpacings = scale.filter((s) => s >= 32).length;
  const largeRatio = largeSpacings / scale.length;

  if (largeRatio > 0.3 || maxSpacing >= 80) return "generous";
  if (largeRatio < 0.1 && maxSpacing < 32) return "tight";
  return "moderate";
}

// ── Visual hierarchy method ───────────────────────────────────────────────────

export function inferHierarchyMethods(tokens: CSSTokens): string[] {
  const methods: string[] = [];
  if (tokens.typography.scale.length >= 4) methods.push("size");
  if (tokens.typography.families.some((f) => f.weights.length > 2)) methods.push("weight");
  if (tokens.colors.filter((c) => !isNeutral(c.value)).length >= 2) methods.push("color");
  if (tokens.spacing.scale.some((s) => s >= 32)) methods.push("spacing");
  if (tokens.elevation.length >= 2) methods.push("elevation");
  if (tokens.motion.durations_ms.length > 0) methods.push("motion");
  return methods;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function inferPhilosophy(
  tokens: CSSTokens,
  html: string,
  accessibilityGrade: AccessibilityGrade,
  content?: ContentTokens
): DesignPhilosophy {
  // Data quality gate — don't infer design character from thin signal.
  // If we have fewer than 3 colors OR no typography data, the CSS we captured
  // is insufficient for reliable inference. Return a diagnostic output instead.
  const hasAdequateColorData = tokens.colors.length >= 3;
  const hasAdequateTypeData = tokens.typography.families.length >= 1 || tokens.typography.scale.length >= 3;

  if (!hasAdequateColorData || !hasAdequateTypeData) {
    return {
      design_school: ["undetermined — insufficient CSS signal (too few colors or no typography data captured)"],
      density: "moderate",
      personality: ["neutral"],
      accessibility_grade: accessibilityGrade,
      whitespace_use: "moderate",
      visual_hierarchy_method: inferHierarchyMethods(tokens),
    };
  }

  const design_school = deriveDesignCharacter(tokens, html);
  const personality = derivePersonality(tokens, html, content);

  return {
    design_school: design_school.length > 0 ? design_school : ["undetermined — token signal insufficient for characterization"],
    density: inferDensity(tokens),
    personality: personality.length > 0 ? personality : ["neutral"],
    accessibility_grade: accessibilityGrade,
    whitespace_use: inferWhitespace(tokens),
    visual_hierarchy_method: inferHierarchyMethods(tokens),
  };
}
