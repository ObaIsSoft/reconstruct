// Visual idiom recognizer — detects composite CSS patterns from CSS blocks
// These are higher-order signals: individual CSS properties combine into recognizable design idioms.
// Runs on first-party CSS only; falls back to all CSS when no first-party blocks are present.

import type { CSSBlock } from "../schema/types.js";

export interface VisualPattern {
  id: string;
  label: string;
  confidence: "definite" | "strong" | "possible";
  selectors: string[];
  evidence: string[];
}

interface RuleBlock {
  selector: string;
  properties: string;
}

function parseRuleBlocks(css: string): RuleBlock[] {
  const blocks: RuleBlock[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}@][^{}]*)\{([^{}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    blocks.push({ selector: m[1].trim(), properties: m[2].trim() });
  }
  return blocks;
}

interface PatternResult {
  matched: boolean;
  confidence: "definite" | "strong" | "possible";
  selectors: string[];
  evidence: string[];
}

interface PatternSpec {
  id: string;
  label: string;
  detect(css: string): PatternResult;
}

const UNMATCHED: PatternResult = { matched: false, confidence: "possible", selectors: [], evidence: [] };

const PATTERN_SPECS: PatternSpec[] = [
  {
    id: "frosted-glass",
    label: "Frosted glass / backdrop blur",
    detect(css) {
      if (!/backdrop-filter\s*:\s*blur\s*\(/.test(css)) return UNMATCHED;
      const hasBgAlpha = /background(?:-color)?\s*:[^;]*(?:rgba|hsla|color-mix)\s*\(/.test(css);
      return {
        matched: true,
        confidence: hasBgAlpha ? "definite" : "strong",
        selectors: [],
        evidence: ["backdrop-filter: blur(...)", ...(hasBgAlpha ? ["semi-transparent background"] : [])],
      };
    },
  },

  {
    id: "sticky-nav",
    label: "Sticky navigation",
    detect(css) {
      if (!/position\s*:\s*sticky/.test(css)) return UNMATCHED;
      const blocks = parseRuleBlocks(css);
      const stickyNavSelectors: string[] = [];
      for (const { selector, properties } of blocks) {
        if (/position\s*:\s*sticky/.test(properties) &&
            /nav|header|toolbar|topbar|navbar/.test(selector.toLowerCase())) {
          stickyNavSelectors.push(selector);
        }
      }
      if (stickyNavSelectors.length > 0) {
        return { matched: true, confidence: "definite", selectors: stickyNavSelectors.slice(0, 4), evidence: ["position: sticky on nav/header"] };
      }
      return { matched: true, confidence: "possible", selectors: [], evidence: ["position: sticky (non-nav element)"] };
    },
  },

  {
    id: "text-gradient",
    label: "Gradient text",
    detect(css) {
      const hasClip = /background-clip\s*:\s*text|-webkit-background-clip\s*:\s*text/.test(css);
      const hasGradientBg = /background(?:-image)?\s*:[^;]*gradient/.test(css);
      if (!hasClip || !hasGradientBg) return UNMATCHED;
      const hasFill = /-webkit-text-fill-color\s*:\s*transparent|color\s*:\s*transparent/.test(css);
      return {
        matched: true,
        confidence: hasFill ? "definite" : "strong",
        selectors: [],
        evidence: [
          "background-clip: text",
          "gradient background",
          ...(hasFill ? ["-webkit-text-fill-color: transparent"] : []),
        ],
      };
    },
  },

  {
    id: "hover-lift",
    label: "Hover lift / elevation on hover",
    detect(css) {
      const blocks = parseRuleBlocks(css);
      const liftSelectors: string[] = [];
      const evidence = new Set<string>();
      for (const { selector, properties } of blocks) {
        if (!/:hover/.test(selector)) continue;
        const hasTranslate = /transform\s*:[^;]*translateY\s*\(-/.test(properties);
        const hasScale = /transform\s*:[^;]*scale\s*\(1\.[1-9]/.test(properties);
        if (hasTranslate || hasScale) {
          liftSelectors.push(selector);
          if (hasTranslate) evidence.add("translateY (upward) on hover");
          if (hasScale) evidence.add("scale(>1) on hover");
          if (/box-shadow/.test(properties)) evidence.add("box-shadow deepens on hover");
        }
      }
      if (liftSelectors.length === 0) return UNMATCHED;
      return {
        matched: true,
        confidence: liftSelectors.length >= 3 ? "definite" : "strong",
        selectors: liftSelectors.slice(0, 5),
        evidence: [...evidence],
      };
    },
  },

  {
    id: "scroll-snap",
    label: "Scroll snap / section paging",
    detect(css) {
      if (!/scroll-snap-type/.test(css)) return UNMATCHED;
      const hasAlign = /scroll-snap-align/.test(css);
      return {
        matched: true,
        confidence: hasAlign ? "definite" : "strong",
        selectors: [],
        evidence: ["scroll-snap-type", ...(hasAlign ? ["scroll-snap-align"] : [])],
      };
    },
  },

  {
    id: "grid-auto-fill",
    label: "Responsive auto-fill grid",
    detect(css) {
      const matches = css.match(/grid-template-columns\s*:[^;]*repeat\s*\(\s*auto-(?:fill|fit)\s*,[^)]+\)/g);
      if (!matches) return UNMATCHED;
      return { matched: true, confidence: "definite", selectors: [], evidence: matches.slice(0, 2) };
    },
  },

  {
    id: "pill-shape",
    label: "Pill-shaped elements",
    detect(css) {
      if (!/border-radius\s*:\s*(?:9999px|999px|100px|50%|100%)/.test(css)) return UNMATCHED;
      const blocks = parseRuleBlocks(css);
      const pillSelectors: string[] = [];
      for (const { selector, properties } of blocks) {
        if (/border-radius\s*:\s*(?:9999px|999px|100px|50%|100%)/.test(properties) &&
            /button|btn|tag|badge|chip|pill/.test(selector.toLowerCase())) {
          pillSelectors.push(selector);
        }
      }
      return {
        matched: true,
        confidence: pillSelectors.length > 0 ? "definite" : "strong",
        selectors: pillSelectors.slice(0, 4),
        evidence: ["border-radius ≥ 100px or 50%"],
      };
    },
  },

  {
    id: "gradient-button",
    label: "Gradient-filled buttons",
    detect(css) {
      const blocks = parseRuleBlocks(css);
      const gradSelectors: string[] = [];
      for (const { selector, properties } of blocks) {
        if (/background(?:-image)?\s*:[^;]*gradient/.test(properties) &&
            /button|btn|cta|submit/.test(selector.toLowerCase())) {
          gradSelectors.push(selector);
        }
      }
      if (gradSelectors.length === 0) return UNMATCHED;
      return { matched: true, confidence: "strong", selectors: gradSelectors.slice(0, 4), evidence: ["gradient background on button selectors"] };
    },
  },

  {
    id: "animated-gradient-bg",
    label: "Animated gradient background",
    detect(css) {
      const hasLargeSize = /background-size\s*:\s*(?:\d{3,}%|200%|300%|400%)/.test(css);
      const hasGradient = /background(?:-image)?\s*:[^;]*gradient/.test(css);
      const hasAnimation = /animation\s*:/.test(css);
      if (!hasLargeSize || !hasGradient || !hasAnimation) return UNMATCHED;
      return { matched: true, confidence: "strong", selectors: [], evidence: ["background-size > 200%", "gradient background", "animation property"] };
    },
  },

  {
    id: "image-overlay",
    label: "Image overlay / scrim",
    detect(css) {
      // ::before/::after with absolute positioning and gradient/rgba over an image container
      const hasPseudoOverlay = /::(?:before|after)[^{]*\{[^}]*background(?:-image)?\s*:[^;]*(?:gradient|rgba|hsla)/.test(css) &&
        /position\s*:\s*absolute/.test(css);
      if (!hasPseudoOverlay) return UNMATCHED;
      return { matched: true, confidence: "strong", selectors: [], evidence: ["::before/::after with gradient + position:absolute"] };
    },
  },

  {
    id: "skeleton-loading",
    label: "Skeleton loading / shimmer",
    detect(css) {
      const hasShimmerKf = /@keyframes\s+(?:shimmer|skeleton|loading|shine|placeholder)\b/.test(css);
      const hasShimmerAnim = /background\s*:[^;]*linear-gradient\s*\([^)]*(?:transparent|rgba)/.test(css) &&
        /@keyframes/.test(css) && /animation/.test(css);
      if (!hasShimmerKf && !hasShimmerAnim) return UNMATCHED;
      return { matched: true, confidence: "strong", selectors: [], evidence: ["@keyframes shimmer/skeleton", "animated gradient"] };
    },
  },

  {
    id: "neumorphism",
    label: "Neumorphism / soft UI",
    detect(css) {
      // Inset + outset box-shadows with multiple layers (the defining neumorphic signature)
      const shadowClauses = css.match(/box-shadow\s*:[^;]+/gi) ?? [];
      const hasInset = shadowClauses.some(b => b.includes("inset"));
      const hasOutset = shadowClauses.some(b => !b.includes("inset"));
      const hasMultiple = shadowClauses.some(b => (b.match(/,/g) ?? []).length >= 1);
      if (!hasInset || !hasOutset || !hasMultiple) return UNMATCHED;
      return { matched: true, confidence: "possible", selectors: [], evidence: ["inset + outset box-shadows", "multi-layer shadow system"] };
    },
  },

  {
    id: "fixed-fullscreen-overlay",
    label: "Fixed fullscreen overlay (modal/drawer pattern)",
    detect(css) {
      const blocks = parseRuleBlocks(css);
      const overlaySelectors: string[] = [];
      for (const { selector, properties } of blocks) {
        const isFixed = /position\s*:\s*fixed/.test(properties);
        const isFullscreen = /(?:width|height)\s*:\s*100(?:vw|vh|%)/.test(properties) ||
          /(?:inset|top|left|right|bottom)\s*:\s*0/.test(properties);
        if (isFixed && isFullscreen) overlaySelectors.push(selector);
      }
      if (overlaySelectors.length === 0) return UNMATCHED;
      return { matched: true, confidence: "strong", selectors: overlaySelectors.slice(0, 4), evidence: ["position: fixed", "100vw/100vh or inset: 0"] };
    },
  },
];

export function detectVisualPatterns(blocks: CSSBlock[]): VisualPattern[] {
  const fpTexts = blocks.filter(b => b.origin === "first-party").map(b => b.text);
  const allTexts = blocks.map(b => b.text);
  const css = (fpTexts.length > 0 ? fpTexts : allTexts).join("\n");

  const results: VisualPattern[] = [];
  for (const spec of PATTERN_SPECS) {
    const result = spec.detect(css);
    if (result.matched) {
      results.push({ id: spec.id, label: spec.label, confidence: result.confidence, selectors: result.selectors, evidence: result.evidence });
    }
  }
  return results;
}
