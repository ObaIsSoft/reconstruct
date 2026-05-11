// HTML signal extraction — the raw evidence layer
// Extracts what is structurally present in the HTML:
//   - every class and ID, with occurrence counts
//   - class-name prefix clusters that reveal component library boundaries
//   - script/link URLs parsed for exact CDN package names
//   - custom element (web component) tag names
//   - data-attribute namespaces (data-radix-*, data-sveltekit-*, etc.)
//   - build tool fingerprint from asset URL patterns
//
// NO hardcoded vocabulary of library names drives detection here.
// Detection is structural: CDN URLs are parsed, prefixes are clustered,
// element names are read. The only fixed table is PREFIX_BRANDS — a
// human-readable name lookup for known cluster prefixes. Libraries not in
// that table are still reported under their prefix, never silently dropped.

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PrefixCluster {
  prefix: string;
  occurrences: number;      // total element occurrences across all classes in this prefix
  unique_classes: number;   // distinct class names found under this prefix
  sample: string[];         // up to 6 example class names
  library: string | null;   // resolved from PREFIX_BRANDS, null if unknown
}

export interface ScriptLibrary {
  url: string;
  package: string;          // extracted directly from CDN URL or bundle filename
  version: string | null;
  cdn: string | null;       // "jsdelivr" | "unpkg" | "cdnjs" | "skypack" | "esm.sh" | null
}

export interface ContentStyling {
  // What CSS properties are declared on text-bearing selectors
  text_selectors: SelectorStyle[];
  // What CSS properties are declared on image/media selectors
  image_selectors: SelectorStyle[];
}

export interface SelectorStyle {
  selector: string;
  properties: Record<string, string>;   // property → value
}

export interface HTMLSignals {
  // Raw class inventory
  class_counts: Map<string, number>;    // class → total occurrences in the HTML
  // Prefix clusters — component/library boundaries
  prefix_clusters: PrefixCluster[];     // sorted by unique_classes desc
  // IDs
  ids: string[];                        // all unique IDs found in the HTML
  // Web components: any tag with a hyphen that isn't an HTML5 element
  custom_elements: string[];            // e.g. ["media-player", "swiper-container"]
  // data-X compound namespaces: data-sveltekit-* → "sveltekit"
  data_namespaces: string[];
  // Libraries parsed from <script src> CDN URLs
  script_libraries: ScriptLibrary[];
  // Build tool inferred from asset URL structure
  build_tool: string | null;
  // Raw asset URLs (scripts + stylesheets) for downstream use
  asset_urls: { url: string; type: "script" | "style" }[];
}

// ── Prefix → library branding ─────────────────────────────────────────────────
// This is NOT detection logic. Detection is structural (prefix clustering).
// This table only provides human-readable names for detected prefixes.
// Any prefix NOT in this table is still reported — just without a brand name.
// Extend this as new libraries are encountered; the detection itself needs no change.

const PREFIX_BRANDS: Record<string, string> = {
  // Media players
  "vds-": "vidstack",
  "plyr-": "plyr",
  "mux-": "mux-player",
  // Carousels / sliders
  "swiper-": "swiper",
  "embla-": "embla-carousel",
  "flickity-": "flickity",
  "splide-": "splide",
  // Component libraries
  "radix-": "radix-ui",
  "headlessui-": "headless-ui",
  "arco-": "arco-design",
  "ant-": "ant-design",
  "mantine-": "mantine",
  "chakra-": "chakra-ui",
  "nextui-": "nextui",
  "daisyui-": "daisyui",
  "flowbite-": "flowbite",
  "preline-": "preline",
  "shadcn-": "shadcn-ui",
  // Motion / animation
  "motion-": "motion-one",
  "aos-": "aos",
  // Maps
  "mapboxgl-": "mapbox-gl",
  "leaflet-": "leaflet",
  // Rich text
  "ql-": "quill",
  "tox-": "tinymce",
  "ProseMirror": "prosemirror",
  // Chat / support
  "intercom-": "intercom",
  // CMS / page builders
  "elementor-": "elementor",
  "fl-": "beaver-builder",
  // Icons
  "lucide-": "lucide",
  "heroicon-": "heroicons",
  "tabler-": "tabler-icons",
};

// Tailwind utility prefixes — single-word utility tokens that are NOT library namespaces.
// These are excluded from cluster reporting because they reflect Tailwind's design
// system, not a third-party component library boundary.
// This set is an explicit noise filter, not detection logic.
const TAILWIND_UTILITY_PREFIXES = new Set([
  "bg-", "text-", "font-", "leading-", "tracking-", "indent-",
  "p-", "px-", "py-", "pt-", "pr-", "pb-", "pl-",
  "m-", "mx-", "my-", "mt-", "mr-", "mb-", "ml-",
  "w-", "h-", "min-", "max-", "size-",
  "flex-", "basis-", "grow-", "shrink-",
  "grid-", "col-", "row-", "gap-",
  "space-", "divide-",
  "border-", "ring-", "outline-", "shadow-",
  "rounded-", "opacity-", "z-",
  "top-", "right-", "bottom-", "left-", "inset-",
  "align-", "justify-", "items-", "content-", "self-",
  "overflow-", "object-", "cursor-", "resize-", "appearance-",
  "transition-", "duration-", "ease-", "delay-", "animate-",
  "scale-", "rotate-", "translate-", "skew-", "origin-",
  "sr-", "not-", "fill-", "stroke-",
  "decoration-", "underline-", "line-", "list-", "placeholder-",
  "accent-", "caret-", "scroll-", "snap-", "touch-", "will-",
  "aspect-", "columns-", "break-", "box-", "table-", "caption-",
  "float-", "clear-", "isolate-", "mix-", "blur-", "backdrop-",
  "contrast-", "brightness-", "grayscale-", "hue-", "invert-",
  "saturate-", "sepia-",
]);

// ── Class extraction ──────────────────────────────────────────────────────────

function extractClassInventory(html: string): {
  counts: Map<string, number>;
  clusters: PrefixCluster[];
} {
  const counts = new Map<string, number>();

  for (const m of html.matchAll(/\bclass=["']([^"']*)["']/g)) {
    for (const cls of m[1].split(/\s+/)) {
      const c = cls.trim();
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }

  // Cluster classes by their leading kebab prefix (e.g. "vds-" from "vds-button")
  const prefixMap = new Map<string, { occurrences: number; classes: Set<string> }>();

  for (const [cls, count] of counts) {
    const match = cls.match(/^([a-z][a-z0-9]*-)/);
    if (!match) continue;
    const prefix = match[1];
    if (TAILWIND_UTILITY_PREFIXES.has(prefix)) continue;
    const existing = prefixMap.get(prefix) ?? { occurrences: 0, classes: new Set() };
    existing.occurrences += count;
    existing.classes.add(cls);
    prefixMap.set(prefix, existing);
  }

  // Only surface prefixes with 3+ distinct class names — single-class prefixes
  // are usually site-specific one-offs, not library boundaries
  const clusters: PrefixCluster[] = [...prefixMap.entries()]
    .filter(([, data]) => data.classes.size >= 3)
    .map(([prefix, data]) => ({
      prefix,
      occurrences: data.occurrences,
      unique_classes: data.classes.size,
      sample: [...data.classes].slice(0, 6),
      library: PREFIX_BRANDS[prefix] ?? null,
    }))
    .sort((a, b) => b.unique_classes - a.unique_classes);

  return { counts, clusters };
}

// ── ID extraction ─────────────────────────────────────────────────────────────

function extractIds(html: string): string[] {
  const ids = new Set<string>();
  for (const m of html.matchAll(/\bid=["']([^"']+)["']/g)) {
    ids.add(m[1].trim());
  }
  return [...ids];
}

// ── Custom element detection ──────────────────────────────────────────────────
// HTML spec: custom elements must contain a hyphen. Every hyphenated tag name
// that isn't a standard SVG/MathML element is a web component.

const KNOWN_HYPHENATED_STANDARDS = new Set([
  // SVG elements with hyphens — none in HTML5 proper, but be safe
  "accept-charset", // not an element but keep the set for extension
]);

function extractCustomElements(html: string): string[] {
  const elements = new Set<string>();
  // Match opening tags with hyphened names
  for (const m of html.matchAll(/<([a-z][a-z0-9]*(?:-[a-z0-9]+)+)[\s/>]/g)) {
    const tag = m[1].toLowerCase();
    if (!KNOWN_HYPHENATED_STANDARDS.has(tag)) {
      elements.add(tag);
    }
  }
  return [...elements].sort();
}

// ── Data-attribute namespace extraction ───────────────────────────────────────
// data-sveltekit-preload-data → "sveltekit"
// data-radix-collection-item → "radix"
// data-headlessui-state → "headlessui"

function extractDataNamespaces(html: string): string[] {
  const namespaces = new Set<string>();
  // Match compound data attributes: data-X-Y or data-X-Y-Z...
  for (const m of html.matchAll(/\bdata-([a-z][a-z0-9]*)(?:-[a-z0-9]+)+=/g)) {
    namespaces.add(m[1]);
  }
  return [...namespaces].sort();
}

// ── Script/link URL extraction and CDN parsing ────────────────────────────────

function extractAssetUrls(html: string, baseUrl: string): { url: string; type: "script" | "style" }[] {
  const assets: { url: string; type: "script" | "style" }[] = [];
  const base = new URL(baseUrl);

  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
    try { assets.push({ url: new URL(m[1], base).href, type: "script" }); } catch { /* skip */ }
  }
  for (const m of html.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]*/gi)) {
    try { assets.push({ url: new URL(m[1], base).href, type: "style" }); } catch { /* skip */ }
  }

  return assets;
}

// CDN URL parsers — structured extraction, no regex guessing against names
const CDN_PARSERS: Array<{ cdn: string; re: RegExp }> = [
  // https://cdn.jsdelivr.net/npm/swiper@11.0.5/swiper.min.js
  { cdn: "jsdelivr", re: /jsdelivr\.net\/npm\/(@?[^/@\s]+(?:\/[^/@\s]+)?)(?:@([^/?&#\s]+))?/i },
  // https://unpkg.com/swiper@11/swiper-bundle.min.js
  { cdn: "unpkg",    re: /unpkg\.com\/(@?[^/@\s]+(?:\/[^/@\s]+)?)(?:@([^/?&#\s]+))?/i },
  // https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js
  { cdn: "cdnjs",    re: /cdnjs\.cloudflare\.com\/ajax\/libs\/([^/\s]+)\/([^/\s]+)/i },
  // https://cdn.skypack.dev/three@r128
  { cdn: "skypack",  re: /cdn\.skypack\.dev\/(@?[^@/?&#\s]+)(?:@([^/?&#\s]+))?/i },
  // https://esm.sh/framer-motion@10
  { cdn: "esm.sh",   re: /esm\.sh\/(@?[^@/?&#\s]+)(?:@([^/?&#\s]+))?/i },
];

function parseScriptLibraries(html: string, baseUrl: string): ScriptLibrary[] {
  const libs: ScriptLibrary[] = [];
  const base = new URL(baseUrl);

  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
    const raw = m[1];

    // 1. Try CDN parsers — exact package name from URL structure
    let matched = false;
    for (const { cdn, re } of CDN_PARSERS) {
      const cm = raw.match(re);
      if (cm) {
        libs.push({
          url: raw,
          package: cm[1].replace(/\/$/, ""),
          version: cm[2] ?? null,
          cdn,
        });
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // 2. Same-origin bundled scripts — extract from filename if it looks like a package name
    // Bundlers often preserve names: /_app/immutable/chunks/swiper.BcD3fg.js → "swiper"
    // Only report if the name segment looks like a valid package identifier
    try {
      const parsed = new URL(raw, base);
      const filename = parsed.pathname.split("/").pop() ?? "";
      // Strip content-hash fingerprint and extension
      // e.g. "swiper.BcD3fg12.js" → "swiper"
      // e.g. "index.abc12345.js" → skip (too generic)
      const nameSegment = filename.replace(/\.[A-Za-z0-9_-]{6,}\.(js|mjs|css)$/i, "").replace(/\.(js|mjs|css)$/i, "");
      if (
        nameSegment.length > 2 &&
        /^(@?[a-z][a-z0-9]*(?:[/-][a-z0-9]+)*)$/i.test(nameSegment) &&
        !["index", "main", "app", "bundle", "vendor", "runtime", "chunk", "entry", "polyfill", "common"].includes(nameSegment.toLowerCase())
      ) {
        libs.push({ url: raw, package: nameSegment, version: null, cdn: null });
      }
    } catch { /* ignore malformed URL */ }
  }

  return libs;
}

// ── Build tool detection ──────────────────────────────────────────────────────
// Inferred from asset URL path patterns — no text matching against bundler names.
// Each major build tool/meta-framework produces a distinctive URL structure.

function detectBuildTool(assets: { url: string; type: string }[]): string | null {
  const paths = assets.map((a) => a.url).join("\n");

  // Meta-framework path markers (most specific first)
  if (/_next\/static/.test(paths)) return "next.js";
  if (/_app\/immutable/.test(paths)) return "sveltekit";
  if (/\/_nuxt\//.test(paths)) return "nuxt";
  if (/\/_astro\//.test(paths)) return "astro";
  if (/\/gatsby-chunk/.test(paths) || /\/static\/[a-f0-9]{20,}\//.test(paths)) return "gatsby";

  // Generic bundler fingerprints
  // Vite: /assets/name.AbcDef12.js (content hash = 8 alphanumeric chars mixed case)
  if (/\/assets\/[^/]+\.[A-Za-z0-9]{8,}\.(js|mjs|css)/.test(paths)) return "vite";
  // Webpack: *.chunk.js or runtime.*.js or *.bundle.js
  if (/\.(chunk|bundle)\.(js|min\.js)$/.test(paths) || /webpack/.test(paths)) return "webpack";
  // Parcel
  if (/parcel/.test(paths)) return "parcel";
  // Rollup (usually embedded in other tools but sometimes standalone)
  if (/rollup/.test(paths)) return "rollup";

  return null;
}

// ── Content-aware CSS selector analysis ──────────────────────────────────────
// Answers: "what CSS is actually applied to text elements?" and
// "what CSS is actually applied to images and media?"
// This is separate from global token extraction which aggregates all CSS without
// awareness of what the selector targets.

const TEXT_SELECTOR_RE = /\b(p|h[1-6]|span|a|li|td|th|blockquote|figcaption|label|caption|article|section|main|header|footer|nav|cite|q|abbr|time|strong|em|small|mark|del|ins|sub|sup)\b/i;
const IMAGE_SELECTOR_RE = /\b(img|picture|figure|video|audio|canvas|svg|iframe)\b/i;

export function extractContentStyling(cssTexts: string[]): ContentStyling {
  const full = cssTexts.join("\n");
  const text_selectors: SelectorStyle[] = [];
  const image_selectors: SelectorStyle[] = [];

  const ruleRe = /([^{}]+)\{([^{}]+)\}/g;
  let m: RegExpExecArray | null;

  while ((m = ruleRe.exec(full)) !== null) {
    const selector = (m[1] ?? "").trim();
    const block = (m[2] ?? "").trim();

    // Skip pseudo-elements and keyframes
    if (/::[\w-]+|@keyframes/.test(selector)) continue;

    const props: Record<string, string> = {};
    for (const prop of block.matchAll(/([\w-]+)\s*:\s*([^;]+)/g)) {
      props[prop[1].trim()] = prop[2].trim();
    }
    if (Object.keys(props).length === 0) continue;

    const entry: SelectorStyle = { selector, properties: props };

    if (TEXT_SELECTOR_RE.test(selector)) text_selectors.push(entry);
    if (IMAGE_SELECTOR_RE.test(selector)) image_selectors.push(entry);
  }

  return { text_selectors, image_selectors };
}

// ── Main export ───────────────────────────────────────────────────────────────

export function extractHTMLSignals(html: string, baseUrl: string): HTMLSignals {
  const { counts, clusters } = extractClassInventory(html);
  const assets = extractAssetUrls(html, baseUrl);

  return {
    class_counts: counts,
    prefix_clusters: clusters,
    ids: extractIds(html),
    custom_elements: extractCustomElements(html),
    data_namespaces: extractDataNamespaces(html),
    script_libraries: parseScriptLibraries(html, baseUrl),
    build_tool: detectBuildTool(assets),
    asset_urls: assets,
  };
}
