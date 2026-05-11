// Tech stack detector — framework fingerprinting, lib detection, rendering strategy
// Primary evidence: HTMLSignals (class prefixes, custom elements, script URLs, data namespaces)
// Secondary evidence: HTML attribute patterns for things that have no structural equivalent
//
// Design principle: no hardcoded library name lists drive detection.
// Libraries are detected from what the HTML structurally contains:
//   - CDN <script> URLs → exact package names
//   - Class prefix clusters → component library boundaries
//   - Custom element tags → web components
//   - data-* namespaces → framework annotations
// The only fixed vocabulary is FRAMEWORK_ATTR_SIGNALS — attributes so framework-specific
// they have no structural analogue (e.g. __NEXT_DATA__, data-sveltekit-*).

import type { RenderingStrategy } from "../schema/types.js";
import type { HTMLSignals } from "./signals.js";

export interface TechStack {
  framework: string;
  styling: string[];
  state: string[];
  rendering: RenderingStrategy;
  detected_libs: string[];
  meta_framework: string | null;
}

// ── Framework detection ───────────────────────────────────────────────────────
// Each framework leaves distinctive HTML attributes or global JS markers.
// These are high-specificity signals — a single match is enough.

interface FrameworkAttrSignal {
  name: string;
  patterns: RegExp[];   // all must appear OR any (controlled by `require`)
  require: "any" | "all";
}

const FRAMEWORK_ATTR_SIGNALS: FrameworkAttrSignal[] = [
  // Next.js embeds a JSON payload with its own key — unmistakable
  { name: "next.js",    patterns: [/__NEXT_DATA__/],                    require: "any" },
  // Nuxt injects window.__nuxt__ or its JSON payload
  { name: "nuxt",       patterns: [/window\.__nuxt__|__NUXT_JSONLD__/], require: "any" },
  // SvelteKit: data-sveltekit-* attributes on <a> tags + __sveltekit global
  { name: "sveltekit",  patterns: [/data-sveltekit-|__sveltekit/],      require: "any" },
  // Remix: __remixContext JSON
  { name: "remix",      patterns: [/__remixContext/],                    require: "any" },
  // Astro: astro-island web component
  { name: "astro",      patterns: [/astro-island|data-astro-/],         require: "any" },
  // Gatsby: ___gatsby global
  { name: "gatsby",     patterns: [/___gatsby/],                        require: "any" },
  // Angular: ng-version attribute on root element
  { name: "angular",    patterns: [/ng-version/],                       require: "any" },
  // React: data-reactroot (legacy) or __react internal
  { name: "react",      patterns: [/data-reactroot|__react/],           require: "any" },
  // Vue: data-v-* scoped CSS attributes
  { name: "vue",        patterns: [/data-v-[a-f0-9]+/],                 require: "any" },
  // HTMX: hx-* directives
  { name: "htmx",       patterns: [/hx-get=|hx-post=|hx-target=/],     require: "any" },
  // Webflow: data-wf-* attributes
  { name: "webflow",    patterns: [/data-wf-/],                         require: "any" },
  // Framer: framerusercontent.com assets
  { name: "framer",     patterns: [/framerusercontent\.com/],           require: "any" },
  // WordPress: wp-content path
  { name: "wordpress",  patterns: [/wp-content\/themes/],               require: "any" },
  // Shopify: cdn.shopify.com
  { name: "shopify",    patterns: [/cdn\.shopify\.com/],                require: "any" },
  // HubSpot CMS: /hubfs/ path or hs-scripts
  { name: "hubspot-cms",patterns: [/\/hubfs\/|hs-scripts|hsCta/],       require: "any" },
  // Ghost: content.ghost.io
  { name: "ghost",      patterns: [/content\.ghost\.io|ghost\.io/],     require: "any" },
  // Squarespace: squarespace.com CDN
  { name: "squarespace",patterns: [/squarespace\.com|sqsp\.net/],       require: "any" },
  // Wix: wixstatic.com
  { name: "wix",        patterns: [/wixstatic\.com|data-mesh-id/],      require: "any" },
];

function detectFramework(html: string, signals: HTMLSignals): string {
  // 1. HTML attribute patterns (framework-injected markers)
  for (const { name, patterns, require: req } of FRAMEWORK_ATTR_SIGNALS) {
    const matches = patterns.filter((p) => p.test(html));
    if (req === "any" && matches.length > 0) return name;
    if (req === "all" && matches.length === patterns.length) return name;
  }

  // 2. Build tool → implies meta-framework (e.g. sveltekit/vite → sveltekit already caught above)
  // If we reach here and have a build tool, use it as a hint
  if (signals.build_tool?.startsWith("next")) return "next.js";
  if (signals.build_tool?.startsWith("sveltekit")) return "sveltekit";
  if (signals.build_tool?.startsWith("nuxt")) return "nuxt";
  if (signals.build_tool?.startsWith("astro")) return "astro";
  if (signals.build_tool?.startsWith("gatsby")) return "gatsby";

  // 3. Custom elements can disambiguate SPA frameworks
  if (signals.custom_elements.includes("astro-island")) return "astro";

  return "unknown";
}

// ── Styling system detection ──────────────────────────────────────────────────
// Evidence hierarchy:
//   1. CSS @tailwind directive (definitive)
//   2. Tailwind responsive/state prefixes in class attributes (sm:, hover:, dark:)
//   3. Tailwind arbitrary value syntax (w-[320px])
//   4. CSS Modules hashed class names
//   5. CSS-in-JS runtime class names (css-HASH, sc-HASH)

function detectStyling(html: string, cssAll: string): string[] {
  const found: string[] = [];

  // Tailwind
  const hasTwDirective = /@tailwind\s+(?:base|components|utilities)/.test(cssAll);
  const hasTwPrefixes = /class=["'][^"']*(?:sm:|md:|lg:|xl:|2xl:|hover:|focus:|dark:)[\w-]+/.test(html);
  const hasTwArbitrary = /class=["'][^"']*[\w-]+\[[\w#%.,\s-]+\]/.test(html);
  if (hasTwDirective || hasTwPrefixes || hasTwArbitrary) found.push("tailwind");

  // Bootstrap: requires col-{breakpoint}-{n} grid classes AND btn-* classes
  const hasBootstrapGrid = /class=["'][^"']*col-(?:xs|sm|md|lg|xl|xxl)-\d+/.test(html);
  const hasBootstrapBtn  = /class=["'][^"']*btn-(?:primary|secondary|success|danger|warning|info|dark|light|outline)/.test(html);
  if (hasBootstrapGrid && hasBootstrapBtn) found.push("bootstrap");

  // CSS Modules: hashed class names like _Button_abc123_4xyz
  if (/class=["'][^"']*_[A-Z][a-zA-Z]+_[a-z0-9]{4,}/.test(html)) found.push("css-modules");

  // styled-components: sc-* runtime classes
  if (/class=["'][^"']*sc-[a-zA-Z0-9]+/.test(html)) found.push("styled-components");

  // Emotion: css-* runtime classes
  if (/class=["'][^"']*css-[a-zA-Z0-9]+/.test(html)) found.push("emotion");

  // UnoCSS
  if (/__unocss/.test(html)) found.push("unocss");

  // Vanilla Extract: _[a-z0-9]+__ pattern
  if (/class=["'][^"']*[a-z0-9]+__[a-z0-9]+/.test(html)) found.push("vanilla-extract");

  return found.length > 0 ? found : ["unknown"];
}

// ── Library detection ─────────────────────────────────────────────────────────
// Built entirely from HTMLSignals — no hardcoded name list.
//
// Sources (in priority order):
//   1. CDN script URLs  → exact package name (most reliable)
//   2. Class prefix clusters → resolved library name or raw prefix
//   3. Custom element names → library hint from element tag
//   4. data-* namespaces → framework/library annotation

const CUSTOM_ELEMENT_BRANDS: Record<string, string> = {
  // Media players
  "media-player": "vidstack",
  "media-provider": "vidstack",
  "lite-youtube": "lite-youtube",
  "mux-player": "mux-player",
  "wistia-player": "wistia",
  // Carousels
  "swiper-container": "swiper",
  "swiper-slide": "swiper",
  "embla-carousel": "embla-carousel",
  // Maps
  "mapbox-gl": "mapbox-gl",
  // Lottie
  "lottie-player": "lottie",
  "dotlottie-player": "dotlottie",
};

const DATA_NS_BRANDS: Record<string, string> = {
  "radix": "radix-ui",
  "headlessui": "headless-ui",
  "framer": "framer-motion",
  "aos": "aos",
};

function detectLibraries(signals: HTMLSignals): string[] {
  const libs = new Set<string>();

  // 1. CDN script URLs → exact package names (highest confidence)
  for (const lib of signals.script_libraries) {
    if (lib.cdn) {
      // From a CDN — the package name is exactly what the URL says
      libs.add(lib.version ? `${lib.package}@${lib.version}` : lib.package);
    }
  }

  // 2. Class prefix clusters → component library detection
  for (const cluster of signals.prefix_clusters) {
    if (cluster.library) {
      libs.add(cluster.library);
    } else {
      // Unknown prefix with 3+ unique classes — report as-is, don't drop it
      libs.add(`${cluster.prefix}* (${cluster.unique_classes} classes)`);
    }
  }

  // 3. Custom elements → web component library detection
  for (const el of signals.custom_elements) {
    const brand = CUSTOM_ELEMENT_BRANDS[el];
    if (brand) {
      libs.add(brand);
    } else {
      // Unknown custom element — report the element name so it's visible
      libs.add(`<${el}>`);
    }
  }

  // 4. data-* namespaces → framework/library annotations
  for (const ns of signals.data_namespaces) {
    const brand = DATA_NS_BRANDS[ns];
    if (brand && !libs.has(brand)) libs.add(brand);
    // Known framework namespaces that aren't "libraries" — skip
    // (sveltekit, astro, etc. are framework-level, already in framework field)
  }

  return [...libs];
}

// ── State management detection ────────────────────────────────────────────────
// Detected from inline script content and script src filenames.
// These are bundled and minified in production — only detectable from named chunks
// or global markers left in HTML.

const STATE_MARKERS: Array<{ name: string; pattern: RegExp }> = [
  { name: "redux",       pattern: /redux(?:js)?/i },
  { name: "zustand",     pattern: /zustand/i },
  { name: "jotai",       pattern: /jotai/i },
  { name: "recoil",      pattern: /recoil/i },
  { name: "mobx",        pattern: /mobx/i },
  { name: "valtio",      pattern: /valtio/i },
  { name: "pinia",       pattern: /pinia/i },
  { name: "vuex",        pattern: /vuex/i },
  { name: "xstate",      pattern: /xstate/i },
  { name: "tanstack-query", pattern: /@tanstack\/(react-)?query/i },
  { name: "swr",         pattern: /['"]swr['"]/i },
];

function detectState(html: string, signals: HTMLSignals): string[] {
  const state: string[] = [];

  // Check script libraries from CDN (exact)
  for (const lib of signals.script_libraries) {
    for (const { name, pattern } of STATE_MARKERS) {
      if (pattern.test(lib.package) && !state.includes(name)) state.push(name);
    }
  }

  // Check bundled chunk names
  for (const asset of signals.asset_urls) {
    for (const { name, pattern } of STATE_MARKERS) {
      if (pattern.test(asset.url) && !state.includes(name)) state.push(name);
    }
  }

  // Inline HTML markers (globals, JSX context)
  for (const { name, pattern } of STATE_MARKERS) {
    if (pattern.test(html) && !state.includes(name)) state.push(name);
  }

  return state;
}

// ── Rendering strategy ────────────────────────────────────────────────────────

export function detectRendering(html: string): RenderingStrategy {
  const bodyContent = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? "";
  const textContent = bodyContent.replace(/<[^>]+>/g, "").trim();

  const hasNextData    = /__NEXT_DATA__/.test(html);
  const hasStaticProps = /"__N_SSG":true/.test(html);
  const hasServerProps = /"__N_SSP":true/.test(html);
  const isISR          = hasStaticProps && /x-nextjs-cache/.test(html);
  const isPureSpa      = textContent.length < 300 &&
    /<div\s+id=["'](root|app|__next)["']/i.test(bodyContent);

  if (isISR) return "isr";
  if (hasNextData && hasStaticProps) return "ssg";
  if (hasNextData && hasServerProps) return "ssr";
  if (hasNextData) return "hybrid";
  if (isPureSpa) return "csr";
  if (textContent.length > 500) return "ssr";
  return "unknown";
}

// ── Meta-framework / hosting ──────────────────────────────────────────────────

function detectMetaFramework(html: string, signals: HTMLSignals): string | null {
  // Check asset URLs for hosting-specific patterns
  const assetStr = signals.asset_urls.map((a) => a.url).join("\n");
  if (/vercel\.app|x-vercel-id/.test(html + assetStr)) return "vercel";
  if (/netlify\.app|netlify\.com/.test(html + assetStr)) return "netlify";
  if (/cloudflare\.com|\.pages\.dev/.test(assetStr)) return "cloudflare-pages";
  if (/amazonaws\.com/.test(assetStr)) return "aws";
  if (/fly\.io/.test(assetStr)) return "fly.io";
  return null;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function detectTechStack(html: string, cssTexts: string[], signals: HTMLSignals): TechStack {
  const cssAll = cssTexts.join("\n");

  return {
    framework:     detectFramework(html, signals),
    styling:       detectStyling(html, cssAll),
    state:         detectState(html, signals),
    rendering:     detectRendering(html),
    detected_libs: detectLibraries(signals),
    meta_framework: detectMetaFramework(html, signals),
  };
}
