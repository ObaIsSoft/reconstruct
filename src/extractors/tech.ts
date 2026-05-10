// Tech stack detector — framework fingerprinting, lib detection, rendering strategy
// Works from raw HTML + CSS text (no JS execution needed for most signals)

import type { RenderingStrategy } from "../schema/types.js";

export interface TechStack {
  framework: string;
  styling: string[];
  state: string[];
  rendering: RenderingStrategy;
  detected_libs: string[];
  meta_framework: string | null;
}

// ── Framework signals ─────────────────────────────────────────────────────────

interface FrameworkSignal {
  name: string;
  version_pattern?: RegExp;
  signals: Array<{ in: "html" | "css" | "url"; pattern: RegExp }>;
}

const FRAMEWORK_SIGNALS: FrameworkSignal[] = [
  {
    name: "next.js",
    version_pattern: /"version"\s*:\s*"([^"]+)"/,
    signals: [
      { in: "html", pattern: /__NEXT_DATA__/ },
      { in: "html", pattern: /next\/static/ },
      { in: "html", pattern: /_next\/static/ },
    ],
  },
  {
    name: "nuxt",
    signals: [
      { in: "html", pattern: /window\.__nuxt__/ },
      { in: "html", pattern: /__NUXT_JSONLD__/ },
      { in: "html", pattern: /nuxt-link/ },
      { in: "url", pattern: /\/_nuxt\// },
    ],
  },
  {
    name: "sveltekit",
    signals: [
      { in: "html", pattern: /data-sveltekit-/ },
      { in: "html", pattern: /__sveltekit/ },
      { in: "html", pattern: /svelte:component/ },
    ],
  },
  {
    name: "remix",
    signals: [
      { in: "html", pattern: /__remixContext/ },
      { in: "html", pattern: /data-remix-/ },
    ],
  },
  {
    name: "gatsby",
    signals: [
      { in: "html", pattern: /___gatsby/ },
      { in: "html", pattern: /gatsby-image/ },
      { in: "url", pattern: /\/static\/[a-f0-9]+\// },
    ],
  },
  {
    name: "astro",
    signals: [
      { in: "html", pattern: /astro-island/ },
      { in: "html", pattern: /data-astro-/ },
      { in: "html", pattern: /astro:page-load/ },
    ],
  },
  {
    name: "vue",
    signals: [
      { in: "html", pattern: /data-v-[a-f0-9]+/ },
      { in: "html", pattern: /v-bind:|v-on:|v-if|v-for/ },
      { in: "html", pattern: /id="app"/ },
    ],
  },
  {
    name: "react",
    signals: [
      { in: "html", pattern: /data-reactroot/ },
      { in: "html", pattern: /data-react-/ },
      { in: "html", pattern: /react-dom/ },
      { in: "html", pattern: /__react/ },
    ],
  },
  {
    name: "angular",
    signals: [
      { in: "html", pattern: /ng-version/ },
      { in: "html", pattern: /\bang-/ },
      { in: "html", pattern: /\[\(ngModel\)\]/ },
    ],
  },
  {
    name: "htmx",
    signals: [
      { in: "html", pattern: /hx-get|hx-post|hx-target/ },
      { in: "html", pattern: /htmx\.js/ },
    ],
  },
  {
    name: "wordpress",
    signals: [
      { in: "html", pattern: /wp-content\/themes/ },
      { in: "html", pattern: /wp-includes/ },
    ],
  },
  {
    name: "shopify",
    signals: [
      { in: "html", pattern: /cdn\.shopify\.com/ },
      { in: "html", pattern: /Shopify\.theme/ },
    ],
  },
  {
    name: "webflow",
    signals: [
      { in: "html", pattern: /data-wf-/ },
      { in: "html", pattern: /webflow\.js/ },
    ],
  },
  {
    name: "framer",
    signals: [
      { in: "html", pattern: /framerusercontent\.com/ },
      { in: "html", pattern: /data-framer-/ },
    ],
  },
  {
    name: "hubspot-cms",
    signals: [
      { in: "html", pattern: /\/hubfs\// },
      { in: "html", pattern: /hs-scripts|hsforms|_hsp=|hsCta/ },
      { in: "html", pattern: /hubspot\.com|hub\.spot/ },
    ],
  },
  {
    name: "ghost",
    signals: [
      { in: "html", pattern: /content\.ghost\.io|ghost\.io/ },
      { in: "html", pattern: /ghost-theme/ },
    ],
  },
  {
    name: "squarespace",
    signals: [
      { in: "html", pattern: /squarespace\.com|sqsp\.net/ },
      { in: "html", pattern: /data-wid=|squarespace-cdn/ },
    ],
  },
  {
    name: "wix",
    signals: [
      { in: "html", pattern: /wixstatic\.com|wix\.com/ },
      { in: "html", pattern: /data-mesh-id|wixui-/ },
    ],
  },
  {
    name: "contentful-cms",
    signals: [
      { in: "html", pattern: /contentful\.com/ },
      { in: "html", pattern: /ctfl-/ },
    ],
  },
];

// ── Styling signals ───────────────────────────────────────────────────────────

interface StylingSignal {
  name: string;
  minSignals?: number; // default 1 — how many signals must match
  signals: Array<{ in: "html" | "css"; pattern: RegExp }>;
}

const STYLING_SIGNALS: StylingSignal[] = [
  {
    name: "tailwind",
    signals: [
      // Responsive/state prefixes are Tailwind-exclusive — sm:, md:, lg:, hover:, dark: etc.
      { in: "html", pattern: /class="[^"]*(?:sm:|md:|lg:|xl:|2xl:|hover:|focus:|dark:)[\w-]+[^"]*"/ },
      { in: "css", pattern: /@tailwind\s+(?:base|components|utilities)/ },
      // Tailwind arbitrary value syntax: w-[320px], bg-[#ff5733]
      { in: "html", pattern: /class="[^"]*[\w-]+\[[\w#%.,\s]+\][^"]*"/ },
    ],
  },
  {
    name: "bootstrap",
    // Bootstrap requires 2+ signals — btn-primary alone is used by many custom CSS frameworks
    minSignals: 2,
    signals: [
      { in: "html", pattern: /class="[^"]*col-(?:xs|sm|md|lg|xl|xxl)-\d+[^"]*"/ },
      { in: "html", pattern: /class="[^"]*btn-(?:primary|secondary|success|danger|warning|info|dark|light|outline-\w+)[^"]*"/ },
      { in: "html", pattern: /bootstrap(?:\.min)?\.css/ },
    ],
  },
  {
    name: "css-modules",
    signals: [
      { in: "html", pattern: /class="[^"]*_[A-Z][a-zA-Z]+_[a-z0-9]{4,}/ },
    ],
  },
  {
    name: "styled-components",
    signals: [
      { in: "html", pattern: /class="[^"]*sc-[a-zA-Z0-9]+/ },
    ],
  },
  {
    name: "emotion",
    signals: [
      { in: "html", pattern: /class="[^"]*css-[a-zA-Z0-9]+/ },
    ],
  },
  {
    name: "sass/scss",
    signals: [
      { in: "css", pattern: /\/\*.*\.scss.*\*\// },
      { in: "html", pattern: /\.scss/ },
    ],
  },
  {
    name: "unocss",
    signals: [
      { in: "html", pattern: /__unocss/ },
      { in: "html", pattern: /data-vite-dev-id="[^"]*unocss/ },
    ],
  },
  {
    name: "shadcn/ui",
    signals: [
      { in: "html", pattern: /class="[^"]*(?:radix-|data-\[state\])[^"]*"/ },
      { in: "html", pattern: /data-radix-/ },
    ],
  },
];

// ── State management signals ──────────────────────────────────────────────────

const STATE_SIGNALS: Array<{ name: string; pattern: RegExp }> = [
  { name: "zustand",      pattern: /zustand/ },
  { name: "redux",        pattern: /redux(?:js)?/ },
  { name: "mobx",         pattern: /mobx/ },
  { name: "jotai",        pattern: /jotai/ },
  { name: "recoil",       pattern: /recoil/ },
  { name: "valtio",       pattern: /valtio/ },
  { name: "pinia",        pattern: /pinia/ },
  { name: "vuex",         pattern: /vuex/ },
  { name: "context-api",  pattern: /React\.createContext|useContext/ },
  { name: "xstate",       pattern: /xstate/ },
];

// ── Library signals ───────────────────────────────────────────────────────────

const LIB_SIGNALS: Array<{ name: string; pattern: RegExp }> = [
  { name: "framer-motion",    pattern: /framer-motion/ },
  { name: "gsap",             pattern: /gsap(?:\.min)?\.js|TweenMax|TimelineMax/ },
  { name: "three.js",         pattern: /three(?:\.min)?\.js/ },
  { name: "d3",               pattern: /d3(?:\.min)?\.js/ },
  { name: "chart.js",         pattern: /chart(?:\.min)?\.js/ },
  { name: "swiper",           pattern: /swiper/ },
  { name: "embla-carousel",   pattern: /embla-carousel/ },
  { name: "radix-ui",         pattern: /radix-ui|@radix/ },
  { name: "headlessui",       pattern: /headlessui/ },
  { name: "react-query",      pattern: /react-query|@tanstack\/react-query/ },
  { name: "swr",              pattern: /swr/ },
  { name: "axios",            pattern: /axios/ },
  { name: "stripe",           pattern: /js\.stripe\.com/ },
  { name: "mapbox",           pattern: /mapbox-gl/ },
  { name: "google-maps",      pattern: /maps\.googleapis\.com/ },
  { name: "intercom",         pattern: /intercom-snippet/ },
  { name: "segment",          pattern: /cdn\.segment\.com/ },
  { name: "hotjar",           pattern: /hotjar/ },
  { name: "google-analytics", pattern: /gtag|ga\.js|analytics\.js/ },
  { name: "vercel-analytics", pattern: /vercel\.com\/insights/ },
  { name: "lottie",           pattern: /lottie(?:-web)?/ },
  { name: "aos",              pattern: /aos\.js|data-aos=/ },
  { name: "locomotive-scroll",pattern: /locomotive-scroll/ },
  { name: "lenis",            pattern: /lenis(?:\.min)?\.js|from\s+['"]@studio-freight\/lenis['"]|new\s+Lenis\(/ },
  { name: "splittype",        pattern: /split-type|SplitType/ },
  { name: "shadcn/ui",        pattern: /data-radix-|class="[^"]*(?:radix-|cmdk-)[^"]*"/ },
  { name: "tanstack/query",   pattern: /@tanstack\/(?:react-)?query/ },
  { name: "clerk",            pattern: /clerk(?:\.dev|\.com|js)|ClerkProvider/ },
  { name: "supabase",         pattern: /supabase(?:\.com|\.js)|createClient.*supabase/ },
  { name: "prismic",          pattern: /prismic(?:\.io|\.js)|@prismicio/ },
  { name: "contentful",       pattern: /contentful(?:\.com)?|createClient.*contentful/ },
];

// ── Rendering strategy detection ──────────────────────────────────────────────

export function detectRendering(html: string): RenderingStrategy {
  // SSG/SSR: meaningful content in HTML (not just a root div)
  const bodyContent = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? "";
  const textContent = bodyContent.replace(/<[^>]+>/g, "").trim();

  const hasNextData = /__NEXT_DATA__/.test(html);
  const hasStaticProps = /"__N_SSG":true/.test(html);
  const hasServerProps = /"__N_SSP":true/.test(html);
  const isISR = /"__N_SSG":true/.test(html) && /x-nextjs-cache/.test(html);
  const isPureSpa =
    textContent.length < 300 &&
    /<div\s+id=["'](root|app|__next)["']/i.test(bodyContent);

  if (isISR) return "isr";
  if (hasNextData && hasStaticProps) return "ssg";
  if (hasNextData && hasServerProps) return "ssr";
  if (hasNextData) return "hybrid";
  if (isPureSpa) return "csr";
  if (textContent.length > 500) return "ssr";
  return "unknown";
}

// ── Meta framework ────────────────────────────────────────────────────────────

export function detectMetaFramework(html: string): string | null {
  if (/x-vercel-id|vercel\.app/.test(html)) return "vercel";
  if (/netlify/.test(html)) return "netlify";
  if (/cloudflare/.test(html)) return "cloudflare-pages";
  if (/amazonaws\.com/.test(html)) return "aws";
  return null;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function detectTechStack(html: string, cssTexts: string[]): TechStack {
  const cssAll = cssTexts.join("\n");

  // Framework — require at least 2 matching signals for frameworks with many weak patterns,
  // but allow a single strong (dedicated) signal to match alone.
  // Single-signal frameworks (remix, sveltekit) have distinctive enough tokens.
  let framework = "unknown";
  for (const fw of FRAMEWORK_SIGNALS) {
    const matchCount = fw.signals.filter((sig) => {
      const source = sig.in === "css" ? cssAll : html;
      return sig.pattern.test(source);
    }).length;
    const needed = fw.signals.length === 1 ? 1 : Math.min(2, fw.signals.length);
    if (matchCount >= needed) {
      framework = fw.name;
      break;
    }
  }

  // Styling (can be multiple) — respect minSignals threshold per entry
  const styling = STYLING_SIGNALS
    .filter(({ signals, minSignals = 1 }) => {
      const matchCount = signals.filter((sig) => {
        const source = sig.in === "css" ? cssAll : html;
        return sig.pattern.test(source);
      }).length;
      return matchCount >= minSignals;
    })
    .map(({ name }) => name);

  // State management
  const state = STATE_SIGNALS
    .filter(({ pattern }) => pattern.test(html))
    .map(({ name }) => name);

  // Libraries
  const detected_libs = LIB_SIGNALS
    .filter(({ pattern }) => pattern.test(html) || pattern.test(cssAll))
    .map(({ name }) => name);

  return {
    framework,
    styling: styling.length ? styling : ["unknown"],
    state,
    rendering: detectRendering(html),
    detected_libs,
    meta_framework: detectMetaFramework(html),
  };
}
