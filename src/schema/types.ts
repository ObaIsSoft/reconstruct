// Central data model — all 6 Reconstruct layers derive from this

// ── CSS source attribution ─────────────────────────────────────────────────────
// Every CSS string in the pipeline carries its source URL and origin.
// Origin is computed once at fetch time: same hostname as the site = first-party,
// anything else = third-party. Inline <style> tags are always first-party.
// This flows through every extractor so any analysis can filter by origin.

export type CSSOrigin = "first-party" | "third-party";

export interface CSSBlock {
  url: string;        // Absolute URL of the stylesheet, "inline:<pageUrl>" for <style> tags,
                      // or "captured:<pageUrl>" for browser-engine-captured rules
  text: string;       // Full CSS text content
  origin: CSSOrigin;  // Determined at fetch time from URL hostname vs. site hostname
}

// ── Helpers — used by every extractor ────────────────────────────────────────

export function allText(blocks: CSSBlock[]): string[] {
  return blocks.map((b) => b.text);
}

export function firstPartyBlocks(blocks: CSSBlock[]): CSSBlock[] {
  return blocks.filter((b) => b.origin === "first-party");
}

export function firstPartyText(blocks: CSSBlock[]): string[] {
  return blocks.filter((b) => b.origin === "first-party").map((b) => b.text);
}

export function blockOrigin(url: string, siteHostname: string): CSSOrigin {
  if (url.startsWith("inline:") || url.startsWith("captured:")) return "first-party";
  try {
    return new URL(url).hostname === siteHostname ? "first-party" : "third-party";
  } catch {
    return "third-party";
  }
}

export type URLClass =
  | "static"      // /about, /pricing
  | "dynamic"     // /blog/[slug], /product/[id]
  | "auth-walled" // redirects to /login
  | "paginated"   // /blog?page=2
  | "asset"       // .pdf, .png
  | "external"    // different domain
  | "anchor";     // #section

export type RenderingStrategy = "csr" | "ssr" | "ssg" | "isr" | "hybrid" | "unknown";

export type DesignDensity = "sparse" | "moderate" | "dense";

export type AccessibilityGrade = "A" | "AA" | "AAA" | "none" | "unknown";

export type ColorUsage =
  | "primary"
  | "secondary"
  | "accent"
  | "background"
  | "surface"
  | "text"
  | "text-muted"
  | "border"
  | "success"
  | "warning"
  | "error"
  | "unknown";

export type SpacingStrategy = "linear" | "fibonacci" | "modular" | "mixed" | "unknown";

export type FontRole = "heading" | "body" | "mono" | "display" | "unknown";

export type FontSource = "google" | "system" | "self-hosted" | "cdn" | "unknown";

export interface ColorToken {
  value: string;           // hex or hsl
  usage: ColorUsage;
  name_inferred: string;   // e.g. "brand-blue"
  occurrences: number;
  dark_variant?: string;
}

export interface FontToken {
  family: string;
  source: FontSource;
  weights: number[];
  role: FontRole;
  url?: string;            // CDN or self-hosted URL if detectable
}

export interface ShadowToken {
  value: string;           // full box-shadow CSS value
  level: number;           // inferred elevation: 1 (lowest) to 5 (highest)
}

export interface MotionToken {
  property: string;        // "opacity", "transform", "all"
  duration_ms: number;
  easing: string;          // cubic-bezier or keyword
  trigger: string;         // "hover", "enter", "scroll", "click"
}

export interface InteractionToken {
  element: string;         // "button", "card", "nav-link"
  state: string;           // CSS pseudo-class name: "hover", "focus", "active", "checked", "focus-visible", etc.
  changes: string[];       // ["background-color", "transform", "box-shadow"]
  motion?: MotionToken;
}

export interface TransitionToken {
  selector: string;
  properties: string[];
  duration_ms: number;
  easing: string;
}

export interface ComponentToken {
  name_inferred: string;   // "Navbar", "ProductCard", "HeroSection"
  selector_patterns: string[];  // CSS selectors seen
  variants: string[];      // inferred from class modifiers
  pages_present: string[]; // which page URLs this component appears on
  is_shared: boolean;      // appears on 3+ pages
  props_inferred: string[]; // e.g. ["variant", "size", "disabled"]
  styling_approach: "tailwind" | "css-modules" | "inline" | "css-in-js" | "plain-css" | "mixed" | "unknown";
}

export interface NavItem {
  label: string;
  href: string;
  children?: NavItem[];
}

export interface PageNode {
  url: string;
  class: URLClass;
  title: string;
  sections: string[];           // ["hero", "feature-grid", "testimonials", "cta"]
  unique_components: ComponentToken[];
  layout_pattern: string;       // "full-width-hero", "sidebar-content", "centered-narrow"
  has_embedded: boolean;        // iframes, web components
  has_shadow_dom: boolean;
  interactions: InteractionToken[];
  confidence: number;           // 0-1
}

export type ImageRole = "portrait" | "hero" | "product" | "illustration" | "icon" | "decoration" | "portfolio" | "unknown";

export interface ImageAsset {
  src: string;
  alt: string;
  role: ImageRole;
  is_gif: boolean;
  pages_present: string[];
}

export interface MediaAsset {
  type: "video" | "audio" | "embedded-video";
  src: string;
  pages_present: string[];
}

export interface FaviconInfo {
  url: string;
  format: "svg" | "png" | "ico" | "webp" | "unknown";
  is_default: boolean;   // true when it's a framework placeholder (vite.svg, next.svg, etc.)
}

export interface CoverageReport {
  urls_discovered: number;
  urls_crawled: number;
  urls_skipped: number;
  urls_auth_walled: number;
  urls_errored: number;
  limit_reached: boolean;
  confidence: number;           // 0-1, drops as limit_reached approaches
  notice: string | null;
}

export interface ReconstructSchema {
  meta: {
    url: string;
    title: string;
    captured_at: string;        // ISO 8601
    content_hash: string;       // used for cache invalidation
    confidence: number;         // overall 0-1
    coverage: CoverageReport;
  };

  technology: {
    framework: string;          // "next.js@14", "vanilla", "nuxt@3", "unknown"
    styling: string[];          // ["tailwind", "css-modules"]
    state: string[];            // ["zustand", "context-api"]
    rendering: RenderingStrategy;
    detected_libs: string[];    // ["framer-motion", "radix-ui", "gsap"]
    meta_framework: string | null;  // "vercel", "netlify-edge", null
  };

  design: {
    colors: {
      palette: ColorToken[];
      strategy: "monochrome" | "analogous" | "complementary" | "triadic" | "unknown";
      dark_mode: boolean;
    };
    typography: {
      families: FontToken[];
      scale: number[];          // pixel sizes found e.g. [12, 14, 16, 20, 24, 32, 48]
      base_size: number;
      line_height_base: number;
      letter_spacing_pattern: string;  // "tight", "normal", "loose", or raw value
    };
    spacing: {
      base_unit: number;        // 4 or 8 most common
      scale: number[];
      strategy: SpacingStrategy;
    };
    motion: {
      durations_ms: number[];
      easings: string[];
      patterns: string[];       // ["fade-up", "scale-in", "slide-left"]
      has_reduced_motion_support: boolean;
    };
    elevation: ShadowToken[];
    border_radius: number[];
    grid: {
      layout: "grid" | "flexbox" | "mixed" | "table" | "unknown";
      columns: number | null;
      max_width_px: number | null;
      breakpoints_px: number[];
      strictness: "strict" | "organic" | "unknown";
    };
  };

  structure: {
    page_count: number;
    sections_global: string[];  // sections present across most pages
    nav: {
      primary: NavItem[];
      footer: NavItem[];
      mobile: NavItem[];
      utility: NavItem[];
    };
    pages: PageNode[];
  };

  interactions: {
    global_hover_patterns: InteractionToken[];
    focus_strategy: "native" | "custom" | "hidden" | "mixed";
    scroll_behaviors: string[];   // derived from CSS properties: ["position:sticky", "scroll-behavior:smooth", "scroll-snap", ...]
    transitions: TransitionToken[];
  };

  components: ComponentToken[];  // shared_components (appear on 3+ pages)

  content?: {
    site_purpose: string;        // from title + h1 + meta description
    headings: string[];          // sampled H1/H2 text across pages
    images: ImageAsset[];
    background_images: string[]; // CSS background-image URLs
    media: MediaAsset[];
    favicon: FaviconInfo | null;
  };

  philosophy: {
    design_school: string[];    // ["minimalism", "neo-brutalism", "glassmorphism"]
    density: DesignDensity;
    personality: string[];      // ["clinical", "warm", "playful", "authoritative"]
    accessibility_grade: AccessibilityGrade;
    whitespace_use: "generous" | "moderate" | "tight";
    visual_hierarchy_method: string[];  // ["size", "color", "weight", "spacing"]
  };

  understanding?: {
    visual_patterns: VisualPattern[];       // composite CSS idioms (frosted-glass, hover-lift, etc.)
    component_definitions: ComponentDefinition[];  // CSS-derived component system
    behavior_patterns: BehaviorPattern[];   // interactive capabilities from HTML/ARIA/scripts
  };

  raw: {
    css_text: string[];         // full CSS contents (escape hatch for deep queries)
    dom_snapshot: string;       // semantic tree text
    asset_urls: string[];
    stylesheet_urls: string[];
  };
}

// ── Understanding layer — patterns, component system, behavioral capabilities ──

export interface VisualPattern {
  id: string;
  label: string;
  confidence: "definite" | "strong" | "possible";
  selectors: string[];
  evidence: string[];
}

export interface ComponentDefinition {
  name: string;
  selector_root: string;
  states: string[];
  variants: string[];
  sub_elements: string[];
  key_properties: string[];
  is_interactive: boolean;
  selector_count: number;
}

export interface BehaviorPattern {
  pattern: string;
  evidence: string[];
  elements: string[];
  confidence: "definite" | "strong" | "possible";
}

// Partial schema for incremental/surface-level analysis
export type ReconstructSchemaSurface = Pick<
  ReconstructSchema,
  "meta" | "technology" | "design" | "philosophy"
>;
