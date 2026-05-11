// DOM extractor — page structure, sections, layout patterns, component inference
// Works from raw HTML strings (no live DOM needed)

import type { ComponentToken, NavItem, PageNode, CSSBlock } from "../schema/types.js";
import { allText, firstPartyText } from "../schema/types.js";
import { classifyUrl } from "../scrapers/cascade.js";
import type { CascadePage } from "../scrapers/cascade.js";

// ── Section detection ─────────────────────────────────────────────────────────

interface SectionSignal {
  name: string;
  patterns: RegExp[];
}

const SECTION_SIGNALS: SectionSignal[] = [
  { name: "hero",          patterns: [/class="[^"]*hero[^"]*"/i, /id="hero"/i, /role="banner"/i] },
  { name: "nav",           patterns: [/<nav\b/i, /role="navigation"/i, /class="[^"]*navbar[^"]*"/i] },
  { name: "features",      patterns: [/class="[^"]*feature[^"]*"/i, /id="features"/i, /class="[^"]*benefits[^"]*"/i] },
  { name: "pricing",       patterns: [/class="[^"]*pric[^"]*"/i, /id="pricing"/i] },
  { name: "testimonials",  patterns: [/class="[^"]*testimonial[^"]*"/i, /class="[^"]*review[^"]*"/i, /class="[^"]*quote[^"]*"/i] },
  { name: "cta",           patterns: [/class="[^"]*cta[^"]*"/i, /class="[^"]*call-to-action[^"]*"/i] },
  { name: "faq",           patterns: [/class="[^"]*faq[^"]*"/i, /id="faq"/i] },
  { name: "team",          patterns: [/class="[^"]*team[^"]*"/i, /id="team"/i] },
  { name: "blog",          patterns: [/class="[^"]*blog[^"]*"/i, /class="[^"]*posts[^"]*"/i, /class="[^"]*articles[^"]*"/i] },
  { name: "gallery",       patterns: [/class="[^"]*gallery[^"]*"/i, /class="[^"]*grid[^"]*"/i] },
  { name: "stats",         patterns: [/class="[^"]*stat[^"]*"/i, /class="[^"]*metric[^"]*"/i, /class="[^"]*number[^"]*"/i] },
  { name: "logos",         patterns: [/class="[^"]*logo[^"]*"/i, /class="[^"]*partner[^"]*"/i, /class="[^"]*brand[^"]*"/i] },
  { name: "footer",        patterns: [/<footer\b/i, /role="contentinfo"/i] },
  { name: "sidebar",       patterns: [/class="[^"]*sidebar[^"]*"/i, /role="complementary"/i] },
  { name: "modal",         patterns: [/role="dialog"/i, /class="[^"]*modal[^"]*"/i, /class="[^"]*overlay[^"]*"/i] },
  { name: "table",         patterns: [/<table\b/i, /role="grid"/i, /role="table"/i] },
  { name: "form",          patterns: [/<form\b/i] },
  { name: "video",         patterns: [/<video\b/i, /class="[^"]*video[^"]*"/i] },
  { name: "map",           patterns: [/class="[^"]*map[^"]*"/i, /id="map"/i] },
];

export function detectSections(html: string): string[] {
  return SECTION_SIGNALS
    .filter(({ patterns }) => patterns.some((p) => p.test(html)))
    .map(({ name }) => name);
}

// ── Layout pattern detection ──────────────────────────────────────────────────

export function detectLayoutPattern(html: string, sections: string[]): string {
  const hasSidebar = sections.includes("sidebar") ||
    /class="[^"]*(?:sidebar|aside|left-col|right-col)[^"]*"/i.test(html);
  const hasFullWidthHero = sections.includes("hero") &&
    /class="[^"]*(?:full|w-full|100vw|full-width)[^"]*"/i.test(html);
  const hasCentered =
    /class="[^"]*(?:container|max-w|mx-auto|centered)[^"]*"/i.test(html);
  const hasGrid =
    /class="[^"]*(?:grid|columns|col-)[^"]*"/i.test(html);

  if (hasSidebar) return "sidebar-content";
  if (hasFullWidthHero && hasCentered) return "full-width-hero";
  if (hasGrid && !hasSidebar) return "grid-layout";
  if (hasCentered) return "centered-narrow";
  return "unknown";
}

// ── Grid detection ────────────────────────────────────────────────────────────

export function detectGridSystem(html: string, cssBlocks: CSSBlock[]): {
  layout: "grid" | "flexbox" | "mixed" | "table" | "unknown";
  columns: number | null;
  max_width_px: number | null;
  breakpoints_px: number[];
  strictness: "strict" | "organic" | "unknown";
} {
  const full = allText(cssBlocks).join("\n");
  const usesGrid = /display\s*:\s*grid/.test(full);
  const usesFlex = /display\s*:\s*flex/.test(full);
  const usesTable = /display\s*:\s*table/.test(full);

  const layout = usesGrid && usesFlex
    ? "mixed"
    : usesGrid
      ? "grid"
      : usesFlex
        ? "flexbox"
        : usesTable
          ? "table"
          : "unknown";

  // Column count from CSS grid-template-columns or Tailwind grid-cols-N utilities in HTML
  let columns: number | null = null;
  const colMatch = full.match(/grid-template-columns\s*:\s*repeat\(\s*(\d+)/);
  if (colMatch) {
    columns = parseInt(colMatch[1]);
  } else {
    // Tailwind: class="grid grid-cols-3" or class="sm:grid-cols-4"
    const twColMatch = html.match(/\bgrid-cols-(\d+)\b/);
    if (twColMatch) columns = parseInt(twColMatch[1]);
  }

  // Max-width — scan all rule blocks, prefer layout-level container selectors,
  // ignore component/utility values (< 500px)
  let max_width_px: number | null = null;
  const LAYOUT_SELECTOR_RE = /(?:body|main|\.(?:container|wrapper|layout|page|content|inner|site|center|max-w)|#(?:root|app|main|content|wrapper))\b/i;
  const mwLayoutValues: number[] = [];
  const mwFallbackValues: number[] = [];
  for (const rm of full.matchAll(/([^{}]+)\{([^{}]*?)max-width\s*:\s*([\d.]+)(px|rem)[^{}]*?\}/gis)) {
    const selector = rm[1].trim();
    const raw = parseFloat(rm[3]);
    const px = rm[4] === "rem" ? Math.round(raw * 16) : Math.round(raw);
    if (px < 500 || px > 2560) continue;
    if (LAYOUT_SELECTOR_RE.test(selector)) {
      mwLayoutValues.push(px);
    } else {
      mwFallbackValues.push(px);
    }
  }
  if (mwLayoutValues.length > 0) {
    max_width_px = Math.max(...mwLayoutValues);
  } else {
    const layoutRange = mwFallbackValues.filter(v => v >= 900 && v <= 1600);
    if (layoutRange.length > 0) {
      // Most common value in layout range
      const freq = new Map<number, number>();
      for (const v of layoutRange) freq.set(v, (freq.get(v) ?? 0) + 1);
      max_width_px = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
    } else if (mwFallbackValues.length > 0) {
      max_width_px = Math.max(...mwFallbackValues);
    }
  }

  // Breakpoints from media queries
  const breakpoints = new Set<number>();
  for (const m of full.matchAll(/@media[^{]*\((?:min|max)-width\s*:\s*([\d.]+)(px|rem)/gi)) {
    const px = m[2] === "rem"
      ? Math.round(parseFloat(m[1]) * 16)
      : Math.round(parseFloat(m[1]));
    if (px > 320 && px < 2560) breakpoints.add(px);
  }

  // Strictness: strict = uses a column system consistently
  const strictness: "strict" | "organic" | "unknown" =
    columns !== null || /col-(?:span-)?\d+/.test(html) ? "strict" : "organic";

  return {
    layout,
    columns,
    max_width_px,
    breakpoints_px: [...breakpoints].sort((a, b) => a - b),
    strictness,
  };
}

// ── Nav link parsing ──────────────────────────────────────────────────────────

export function parseNavItems(links: Array<{ href: string; label: string }>): NavItem[] {
  // Deduplicate by href, filter blanks
  const seen = new Set<string>();
  return links
    .filter((l) => {
      if (!l.href || !l.label || seen.has(l.href)) return false;
      seen.add(l.href);
      return true;
    })
    .map(({ href, label }) => ({ href, label }));
}

// ── Component inference from class names ──────────────────────────────────────

// BEM / utility / component-style class name patterns
const COMPONENT_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "Button",       pattern: /class="[^"]*\b(?:btn|button)(?:-|\s|")[^"]*"/i },
  { name: "Card",         pattern: /class="[^"]*\b(?:card)(?:-|\s|")[^"]*"/i },
  { name: "Modal",        pattern: /class="[^"]*\b(?:modal|dialog)(?:-|\s|")[^"]*"/i },
  { name: "Navbar",       pattern: /class="[^"]*\b(?:navbar|nav-bar|nav-menu)(?:-|\s|")[^"]*"/i },
  { name: "Dropdown",     pattern: /class="[^"]*\b(?:dropdown|select-menu)(?:-|\s|")[^"]*"/i },
  { name: "Badge",        pattern: /class="[^"]*\b(?:badge|chip|tag)(?:-|\s|")[^"]*"/i },
  { name: "Avatar",       pattern: /class="[^"]*\b(?:avatar|profile-pic)(?:-|\s|")[^"]*"/i },
  { name: "Table",        pattern: /<table\b/i },
  { name: "Form",         pattern: /<form\b/i },
  { name: "Input",        pattern: /<input\b/i },
  { name: "Tooltip",      pattern: /class="[^"]*\b(?:tooltip|popover)(?:-|\s|")[^"]*"/i },
  { name: "Tabs",         pattern: /class="[^"]*\b(?:tabs|tab-list|tab-panel)(?:-|\s|")[^"]*"/i },
  { name: "Accordion",    pattern: /class="[^"]*\b(?:accordion|collapse)(?:-|\s|")[^"]*"/i },
  { name: "Breadcrumb",   pattern: /class="[^"]*\b(?:breadcrumb)(?:-|\s|")[^"]*"/i },
  { name: "Pagination",   pattern: /class="[^"]*\b(?:pagination|pager)(?:-|\s|")[^"]*"/i },
  { name: "Spinner",      pattern: /class="[^"]*\b(?:spinner|loader|loading)(?:-|\s|")[^"]*"/i },
  { name: "Alert",        pattern: /class="[^"]*\b(?:alert|toast|notification)(?:-|\s|")[^"]*"/i },
  { name: "Sidebar",      pattern: /class="[^"]*\b(?:sidebar|drawer|side-panel)(?:-|\s|")[^"]*"/i },
  { name: "HeroSection",  pattern: /class="[^"]*\b(?:hero)(?:-|\s|")[^"]*"/i },
  { name: "PricingCard",  pattern: /class="[^"]*\b(?:pricing|plan)(?:-|\s|")[^"]*"/i },
  { name: "TestimonialCard", pattern: /class="[^"]*\b(?:testimonial|review|quote)(?:-|\s|")[^"]*"/i },
  { name: "FeatureCard",  pattern: /class="[^"]*\b(?:feature)(?:-|\s|")[^"]*"/i },
  { name: "StatBlock",    pattern: /class="[^"]*\b(?:stat|metric|counter)(?:-|\s|")[^"]*"/i },
];

// Detect styling approach from class names
function inferStylingApproach(html: string): ComponentToken["styling_approach"] {
  // Tailwind: lots of utility classes (flex, bg-, text-, p-, m-, etc.)
  const tailwindMatches = (html.match(/class="[^"]*(?:flex|grid|bg-|text-|p-\d|m-\d|rounded|border|shadow)[^"]*"/g) ?? []).length;
  // CSS Modules: hashed classes like _Button_abc123
  const cssModulesMatches = (html.match(/class="[^"]*_[A-Z][^_]+_[a-z0-9]{4,}/g) ?? []).length;
  // CSS-in-JS: emotion/styled-components (css-HASH or sc-HASH)
  const cssInJsMatches = (html.match(/class="[^"]*(?:css-|sc-)[a-zA-Z0-9]+/g) ?? []).length;

  if (tailwindMatches > 10) return "tailwind";
  if (cssModulesMatches > 3) return "css-modules";
  if (cssInJsMatches > 3) return "css-in-js";
  return "plain-css";
}

export function inferComponents(
  html: string,
  pageUrl: string
): ComponentToken[] {
  const stylingApproach = inferStylingApproach(html);

  return COMPONENT_PATTERNS
    .filter(({ pattern }) => pattern.test(html))
    .map(({ name }) => ({
      name_inferred: name,
      selector_patterns: [],
      variants: [],
      pages_present: [pageUrl],
      is_shared: false,
      props_inferred: [],
      styling_approach: stylingApproach,
    }));
}

// ── Accessibility signals ─────────────────────────────────────────────────────

export function detectAccessibilityGrade(
  html: string,
  cssBlocks: CSSBlock[]
): "A" | "AA" | "AAA" | "none" | "unknown" {
  const hasAriaLabels = /aria-label=/i.test(html);
  const hasAriaRoles = /role=["']\w+["']/i.test(html);
  const hasAltText = /<img[^>]+alt=["'][^"']+["']/i.test(html);
  const hasLandmarks = /<(?:main|nav|header|footer|aside)\b/i.test(html);
  const hasSkipLink = /skip(?:\s+to)?\s+(?:main|content)/i.test(html);
  // Use first-party CSS only — third-party components (media players, widgets)
  // implement their own focus/motion styles which would inflate our accessibility score.
  const fpCss = firstPartyText(cssBlocks).join("");
  const hasFocusStyles = fpCss.includes(":focus");
  const hasReducedMotion = fpCss.includes("prefers-reduced-motion");

  const score =
    (hasAriaLabels ? 1 : 0) +
    (hasAriaRoles ? 1 : 0) +
    (hasAltText ? 1 : 0) +
    (hasLandmarks ? 1 : 0) +
    (hasSkipLink ? 1 : 0) +
    (hasFocusStyles ? 1 : 0) +
    (hasReducedMotion ? 1 : 0);

  if (score >= 6) return "AAA";
  if (score >= 4) return "AA";
  if (score >= 2) return "A";
  if (score === 0) return "none";
  return "unknown";
}

// ── Per-page node builder ─────────────────────────────────────────────────────

export function buildPageNode(
  page: CascadePage,
  baseHostname: string
): PageNode {
  const sections = detectSections(page.html);
  const components = inferComponents(page.html, page.url);

  return {
    url: page.url,
    class: classifyUrl(page.url, baseHostname),
    title: page.title,
    sections,
    unique_components: components,
    layout_pattern: detectLayoutPattern(page.html, sections),
    has_embedded: /<iframe\b/i.test(page.html),
    has_shadow_dom: page.shadow_roots?.length > 0,
    interactions: [],   // filled by interaction extractor
    confidence: page.error ? 0.3 : page.html.length > 1000 ? 0.85 : 0.5,
  };
}
