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
];

// ── Styling signals ───────────────────────────────────────────────────────────

interface StylingSignal {
  name: string;
  signals: Array<{ in: "html" | "css"; pattern: RegExp }>;
}

const STYLING_SIGNALS: StylingSignal[] = [
  {
    name: "tailwind",
    signals: [
      { in: "html", pattern: /class="[^"]*(?:flex|grid|bg-|text-|p-\d|rounded|border-|shadow-|space-)[^"]*"/ },
      { in: "css", pattern: /@tailwind\s+(?:base|components|utilities)/ },
    ],
  },
  {
    name: "bootstrap",
    signals: [
      { in: "html", pattern: /class="[^"]*(?:col-|row|container|btn-|navbar-)[^"]*"/ },
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
  { name: "splittype",        pattern: /split-type|SplitType/ },
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

  // Framework
  let framework = "unknown";
  for (const fw of FRAMEWORK_SIGNALS) {
    const matched = fw.signals.every((sig) => {
      const source = sig.in === "css" ? cssAll : html;
      return sig.pattern.test(source);
    }) || fw.signals.some((sig) => {
      const source = sig.in === "css" ? cssAll : html;
      return sig.pattern.test(source);
    });
    if (matched) {
      framework = fw.name;
      break;
    }
  }

  // Styling (can be multiple)
  const styling = STYLING_SIGNALS
    .filter(({ signals }) =>
      signals.some((sig) => {
        const source = sig.in === "css" ? cssAll : html;
        return sig.pattern.test(source);
      })
    )
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
