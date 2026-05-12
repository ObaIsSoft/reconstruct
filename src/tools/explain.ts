// reconstruct_explain — fully dynamic narrative explanations
// Every observation is derived from actual schema values, not category-name lookups.
// No hardcoded per-font or per-school strings — meaning is derived from token evidence.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../schema/config.js";
import { readCache } from "../cache/store.js";
import type { ReconstructSchema } from "../schema/types.js";

type Tier = "newbie" | "professional" | "succinct" | "ai";

// ── KB key normalization ───────────────────────────────────────────────────────
function normalizeFwKey(fw: string): string {
  const aliases: Record<string, string> = {
    "next.js": "Next.js", nuxt: "Nuxt", sveltekit: "SvelteKit",
    astro: "Astro", remix: "Remix", gatsby: "Gatsby",
    react: "React", vue: "Vue", angular: "Angular", htmx: "HTMX",
    "hubspot-cms": "hubspot-cms", ghost: "ghost",
    squarespace: "squarespace", wix: "wix", "contentful-cms": "contentful-cms",
  };
  return aliases[fw.toLowerCase()] ?? fw;
}

function normalizeStylingKey(s: string): string {
  if (s === "sass/scss") return "scss";
  return s;
}

// CSS generic fallback families — not design decisions
const CSS_GENERICS = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy",
  "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace",
]);

export function registerExplainTool(server: McpServer): void {
  server.tool(
    "reconstruct_explain",
    "Explain a website's design choices, tech stack, and philosophy at a specified depth tier. Produces dynamic, evidence-grounded narrative — every observation is derived from detected signals. Requires reconstruct_analyze first.",
    {
      url: z.string().url().describe("Website URL (must be analyzed first)"),
      tier: z
        .enum(["newbie", "professional", "succinct", "ai"])
        .default("professional")
        .describe(
          "newbie = full narrative with designer + developer perspectives | " +
          "professional = dense evidence-grounded prose | " +
          "succinct = condensed critical facts | " +
          "ai = structured JSON"
        ),
      focus: z
        .enum(["design", "tech", "interactions", "philosophy", "all"])
        .default("all")
        .describe("Which aspect to focus on"),
    },
    async ({ url, tier, focus }) => {
      const config = loadConfig();
      const schema = readCache(url, config.output.cache_dir);
      if (!schema) {
        return {
          content: [{ type: "text", text: `No analysis found for ${url}. Run reconstruct_analyze("${url}") first.` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: buildExplanation(schema, tier, focus) }] };
    }
  );
}

// ── Knowledge base — frameworks, styling, libraries ────────────────────────────
// These are appropriate as KBs because they are finite, known technologies.
// Fonts and design schools are NOT in a KB — meaning is derived from detected signals.

const FRAMEWORK_KB: Record<string, { role: string; implies: string; dev_note: string; tradeoff: string }> = {
  "Next.js": {
    role: "React framework adding SSR, file-based routing, and API routes",
    implies: "The team wanted React's component ecosystem plus server control — standard for content-heavy products that need SEO without sacrificing interactivity. Strongly implies a JavaScript-first team and likely Vercel deployment.",
    dev_note: "Check for ISR vs full SSR per-route. If Next 13+, RSC may replace getServerSideProps. Absence of state management may mean server components handle data without client stores.",
    tradeoff: "Ties you to Node.js on the server. Cold starts on serverless. The App Router (Next 13+) split the community.",
  },
  "Nuxt": {
    role: "Vue's full-stack framework — routing, SSR, and server layer built in",
    implies: "A Vue-first team that outgrew a plain SPA. Common in European product companies, agencies, and Laravel shops moving frontend. Often chosen over Next.js when JSX is a barrier.",
    dev_note: "Nuxt 3 with Nitro server layer if hybrid/ISR detected. Composition API with setup() is standard. useServerData and auto-imports are core patterns.",
    tradeoff: "Smaller ecosystem than React. Vue's reactivity model has edge cases with reactive destructuring.",
  },
  "SvelteKit": {
    role: "Svelte's application framework — compiles to vanilla JS, zero runtime overhead",
    implies: "Raw performance was a priority. No virtual DOM — components compile away. Usually chosen by performance-conscious teams or those who found React/Vue too abstract.",
    dev_note: "No hydration overhead. SvelteKit handles routing and transitions natively. Bundle sizes are notably smaller than React equivalents.",
    tradeoff: "Smaller talent pool. Svelte's compiler magic can surprise contributors. Fewer mature libraries.",
  },
  "Astro": {
    role: "Content-first framework — zero JS by default, Islands Architecture for interactivity",
    implies: "The site is primarily content: marketing, docs, blog, or landing pages. A deliberate choice to ship no JavaScript unless a specific component needs it.",
    dev_note: "Partial hydration via client:load / client:idle / client:visible. Each interactive island hydrates independently. Can embed React, Vue, Svelte together.",
    tradeoff: "Not suitable for highly interactive applications. Build times slow for large content sets.",
  },
  "Remix": {
    role: "React framework built around web primitives — forms, URLs, HTTP caching",
    implies: "Progressive enhancement is a design principle: forms work without JS, data is co-located with routes via loaders/actions. Produces resilient UIs but requires a persistent server.",
    dev_note: "Loader/action model replaces API routes + data fetching hooks. Nested routing enables layout composition. HTTP cache headers from loaders are first-class.",
    tradeoff: "Less flexible deployment than Next.js. Stronger opinions on data flow.",
  },
  "Gatsby": {
    role: "React static site generator with a GraphQL data layer",
    implies: "Content-heavy, SEO-critical. Pre-generates all pages at build time. Common in marketing sites, blogs, documentation.",
    dev_note: "GraphQL for data including local files. Gatsby Image for optimized images. Long build times on large sites.",
    tradeoff: "Heavy build process. The move toward Astro from Gatsby is ongoing in the ecosystem.",
  },
  "React": {
    role: "UI library without built-in routing, SSR, or data fetching — architecture is custom",
    implies: "A mature team building their own architecture on React. More flexible than a full framework but more decisions deferred to the team. Often found in SPAs where SEO isn't critical.",
    dev_note: "Custom routing (React Router / TanStack Router). Client-side data fetching patterns likely (React Query, SWR, or custom hooks). No SSR unless explicitly added.",
    tradeoff: "Higher upfront architectural cost. Easier to accumulate inconsistency without framework guardrails.",
  },
  "Vue": {
    role: "Progressive JavaScript framework — component-based, template-syntax-first",
    implies: "Teams who prefer Vue's template syntax over JSX, or who need to embed interactive components into existing HTML. Very common in agencies, CMS-driven projects, and non-SPA products.",
    dev_note: "Composition API with setup() is modern standard. Vue Router + Pinia for routing/state. Vite is the standard build tool for Vue 3.",
    tradeoff: "Smaller ecosystem than React. Enterprise adoption significantly lower.",
  },
  "Angular": {
    role: "Full opinionated framework — DI, routing, forms, HTTP client, TypeScript built in",
    implies: "Enterprise context, long maintenance horizon, or strong preference for convention over configuration. TypeScript is non-optional. Prescriptive architecture reduces debates but increases ceremony.",
    dev_note: "Module or standalone component model. RxJS Observables for async data. HTTP interceptors for auth/logging.",
    tradeoff: "Steep learning curve. Verbose. Slower to iterate than React/Vue for small changes.",
  },
  "HTMX": {
    role: "HTML-over-the-wire — AJAX, WebSockets, and SSE as HTML attributes, no JS framework",
    implies: "A deliberate rejection of JavaScript complexity. Typically a backend-first team (Python/Go/Ruby/PHP) who wants dynamic UIs without a JS framework.",
    dev_note: "Server returns HTML partials, not JSON. Browser history via hx-push-url. No client-side state management needed.",
    tradeoff: "Interactivity ceiling lower than JS frameworks. Complex client-side state is hard.",
  },
  "hubspot-cms": {
    role: "HubSpot CMS Hub — content management tightly integrated with HubSpot CRM, marketing, and sales tools",
    implies: "Marketing is running the site, not engineering. Drag-and-drop editor, HubL templating, and tight integration with HubSpot email, forms, and analytics. The site likely drives lead capture and nurture flows rather than being a product interface.",
    dev_note: "Templates are HubL (HubSpot's Jinja-like language). CDN-served from HubSpot infrastructure (/hubfs/ paths). Custom modules are possible but design control is constrained by the CMS drag-and-drop model.",
    tradeoff: "Deep HubSpot lock-in. Limited layout flexibility without developer involvement. High cost relative to alternatives. Performance can be inconsistent.",
  },
  "ghost": {
    role: "Ghost CMS — headless publishing platform for blogs, newsletters, and membership sites",
    implies: "Content is the product. Ghost is built around editorial publishing workflows: posts, tags, members, and Stripe-powered paid subscriptions. Typically used by independent creators, publishers, or teams that want a fast, minimal editorial CMS.",
    dev_note: "Themes are Handlebars templates. Ghost's Content API enables headless consumption. Built-in email newsletter delivery. Member authentication and paywalling are first-class features.",
    tradeoff: "Limited to content publishing. No custom data models or complex application logic. Less flexible than a headless CMS paired with a custom frontend.",
  },
  "squarespace": {
    role: "Squarespace — all-in-one website builder for design-forward small businesses and creatives",
    implies: "A non-technical owner built and maintains the site. Design templates are the primary differentiator — Squarespace's aesthetic is polished but constrained. Common for portfolios, restaurants, small retail, and service businesses.",
    dev_note: "No direct code access at the framework level. Custom CSS and limited JS injection possible in settings. Pages are server-rendered by Squarespace infrastructure. Exporting to another platform requires a full rebuild.",
    tradeoff: "No custom backend logic. Template constraints limit differentiation. Ongoing subscription required. Performance is platform-controlled.",
  },
  "wix": {
    role: "Wix — visual drag-and-drop website builder with optional Wix Velo JavaScript layer",
    implies: "Built by a non-technical owner or agency using Wix's visual editor. Wix Velo (previously Corvid) enables server-side JavaScript, database collections, and APIs — bridging the gap between a builder and a lightweight app platform.",
    dev_note: "Wix Velo enables custom backend logic (.jsw serverless functions), database collections, and dynamic pages. All assets served from Wix CDN (wixstatic.com). Design is tied to Wix's rendering engine — migrating away requires a full rebuild.",
    tradeoff: "Wix Velo is capable but non-standard. Deep platform lock-in. SEO and performance constrained relative to custom-built sites.",
  },
  "contentful-cms": {
    role: "Contentful — API-first headless CMS used as a content backend, decoupled from the frontend",
    implies: "Content is managed separately from presentation. The frontend (Next.js, Astro, or similar) fetches content from Contentful's APIs at build or request time. Signals a team that wanted editorial workflow and structured content without coupling it to a specific frontend stack.",
    dev_note: "Content is modeled as Content Types in Contentful and consumed via REST or GraphQL APIs. Rich text is delivered as a JSON AST requiring a renderer. Preview environments use draft/published states. Contentful SDK or fetch calls will be in the frontend codebase.",
    tradeoff: "No visual page building — layout and design are entirely frontend-controlled. Cost scales with usage. Migrating content models is painful.",
  },
};

const STYLING_KB: Record<string, { role: string; implies: string; tradeoff: string }> = {
  tailwind: {
    role: "utility-first CSS — small atomic classes applied directly in markup",
    implies: "Design is enforced through constraints: the only spacings, colors, and type sizes available are what's in the config. Produces consistency and speed but can push toward Tailwind's defaults rather than a genuinely custom system.",
    tradeoff: "Long class lists in HTML. Style is inseparable from markup. Teams without a design system can misuse arbitrary values.",
  },
  "css-modules": {
    role: "scoped CSS files per component — no global class leakage",
    implies: "The team values style isolation. Styles travel with their component. Common in mature React teams that want structured CSS without runtime overhead.",
    tradeoff: "No global design tokens without extra setup. Composing responsive layouts is less ergonomic than Tailwind.",
  },
  "styled-components": {
    role: "CSS-in-JavaScript — styles co-located with component logic, reactive to props",
    implies: "Dynamic theming and prop-driven style variations are first-class. The ThemeProvider pattern means design tokens flow from a single JS source.",
    tradeoff: "Runtime cost and larger bundles than static CSS. SSR requires additional setup. Ecosystem moving toward zero-runtime alternatives.",
  },
  emotion: {
    role: "CSS-in-JS library — css prop, styled API, or keyframe helpers",
    implies: "Component-level dynamic styling. Often chosen for its css prop flexibility or as the underlying engine for MUI/Chakra UI.",
    tradeoff: "Same runtime/bundle tradeoffs as styled-components.",
  },
  scss: {
    role: "CSS superset — variables, nesting, and mixins before they existed natively",
    implies: "Likely an older codebase or a team with established SCSS conventions. Still capable but modern CSS has caught up on most SCSS features.",
    tradeoff: "Build step required. Variables and nesting that justified SCSS are now native CSS.",
  },
  "shadcn/ui": {
    role: "Radix UI primitives + Tailwind — component collection you own (copy, don't install)",
    implies: "Fast, accessible component system for B2B SaaS. Teams get correct ARIA behavior without building a custom design system. The 'copy not install' model means full control over component code.",
    tradeoff: "Components need manual updates. Customising beyond Tailwind's design language requires effort.",
  },
};

const LIB_KB: Record<string, string> = {
  "framer-motion": "Spring-based animation — physicality and perceived responsiveness are design priorities. Motion is component-level and declarative, not CSS keyframes.",
  gsap: "Professional animation budget — scroll-triggered sequences, SVG morphing, or complex timeline choreography. If GSAP is present, animation is a feature, not a detail.",
  "three.js": "3D rendering in-browser — immersive hero, product showcase, or interactive 3D. Significant performance and complexity investment; not incidental.",
  "radix-ui": "Unstyled accessible primitives — custom design system built on correct ARIA semantics. Accessibility-first without sacrificing visual control.",
  "shadcn/ui": "Radix + Tailwind component collection — accessible, fast design system for B2B SaaS. Not a library; components live in the codebase.",
  "react-query": "Server state management — async data, caching, background refetching handled declaratively. Signals a data-heavy UI with real synchronisation requirements.",
  zustand: "Minimal global state — a deliberate step away from Redux complexity. Signals the team values simplicity in client state management.",
  redux: "Centralised state management — complex client-side state, or a large team that needs strict unidirectional patterns.",
  lenis: "Custom smooth scroll — scroll experience is a design priority, likely paired with scroll-triggered animations or parallax.",
  "locomotive-scroll": "Scroll-jacking library — the scroll experience is a designed narrative, not just navigation.",
  stripe: "Payment processing — the site handles transactions, expect checkout flows and billing pages.",
  clerk: "Auth delegated to a managed service — sessions, OAuth, and user management are out of scope for the core codebase.",
  supabase: "Supabase backend — Postgres + realtime + auth from a managed platform. Signals a product that needs a database without building a custom backend.",
};

// ── Dynamic font characterization ──────────────────────────────────────────────
// Derives meaning from structural properties — works for any font, not a KB lookup.

type FontFamily = ReconstructSchema["design"]["typography"]["families"][number];

function classifyFont(family: string): {
  type: "monospace" | "serif" | "slab-serif" | "display" | "script" | "rounded" | "geometric" | "humanist" | "sans-serif";
  isDisplay: boolean;
} {
  const n = family.toLowerCase();
  const isMonospace = /mono|code|courier|consolas|jetbrains|fira code|ibm plex mono|inconsolata|source code|roboto mono|spacemono|commit|cascadia/i.test(family);
  const isSerif = /\bserif\b|garamond|georgia|times|baskerville|caslon|bodoni|minion|palatino|cormorant|playfair|tiempos|spectral|lora|merriweather|literata|eb garamond|libre baskerville/i.test(family) && !/sans/i.test(n);
  const isSlab = /slab|rockwell|clarendon|arvo|zilla|crete|chivo/i.test(n) && !isMonospace;
  const isScript = /script|hand|pacifico|dancing|great vibes|caveat|satisfy|sacramento|yellowtail/i.test(n);
  const isRounded = /rounded|poppins rounded|nunito(?! sans)/i.test(n) || /quicksand|varela round|rounded mplus/i.test(n);
  const isGeometric = /\bgeo\b|futura|avant garde|neutra|europa|montserrat|raleway|josefin|poiret|comfortaa/i.test(n);
  const isHumanist = /\binter\b|dm sans|work sans|nunito sans|source sans|gill|myriad|frutiger|trebuchet|optima|cabin|lato|open sans|mulish|rubik|outfit|figtree/i.test(n);
  const isDisplay = /display|headline|hero|poster|banner|title|clamp|clash|cabinet|satoshi|zodiak|array|nippo|melodrama/i.test(n) || /light|ultra|black|heavy|extra/i.test(family);

  if (isMonospace) return { type: "monospace", isDisplay: false };
  if (isScript) return { type: "script", isDisplay: true };
  if (isSlab) return { type: "slab-serif", isDisplay };
  if (isSerif) return { type: "serif", isDisplay };
  if (isRounded) return { type: "rounded", isDisplay };
  if (isGeometric) return { type: "geometric", isDisplay };
  if (isHumanist) return { type: "humanist", isDisplay };
  return { type: "sans-serif", isDisplay };
}

function characterizeFont(f: FontFamily, tier: Tier): string {
  const { family, role, source, weights } = f;
  const { type, isDisplay } = classifyFont(family);

  const srcLabel = source === "google" ? "Google Fonts"
    : source === "self-hosted" ? "self-hosted"
    : source === "cdn" ? "CDN-loaded"
    : source === "system" ? "system font"
    : source;

  // Variable fonts loaded via Google Fonts may support a full weight range even when
  // only one explicit font-weight value appears in CSS rules. Flag this rather than
  // asserting "single weight" which implies the font lacks weight range.
  const isLikelyVariable = source === "google" && weights.length <= 1 &&
    /inter|montserrat|playfair|roboto|outfit|raleway|nunito|poppins|manrope|plus jakarta|dm sans|work sans|figtree|space grotesk/i.test(family);

  const weightNote = weights.length >= 5
    ? `${weights.length} weights — expressive typographic range`
    : weights.length >= 3
    ? `${weights.length} weights in use`
    : weights.length === 2
    ? `2 weights in use`
    : isLikelyVariable
    ? `variable font (full weight range available, ${weights.length > 0 ? weights[0] + "wt" : "default weight"} used explicitly in CSS)`
    : `single weight — hierarchy relies entirely on size and spacing`;

  // Derive meaning from type classification + role + source
  let typeDesc = "";
  let signalDesc = "";

  switch (type) {
    case "monospace":
      typeDesc = "monospace";
      signalDesc = role === "body"
        ? `Monospace type in a body role is outside its conventional use (code blocks, terminals). ` +
          `It carries associations with code editors, terminal interfaces, and typewriter aesthetics.`
        : `A monospace heading face foregrounds technical identity. It signals developer tooling, CLI-adjacent products, or a brand that treats precision as its primary character.`;
      break;

    case "serif":
      typeDesc = isDisplay ? "display serif" : "text serif";
      signalDesc = role === "heading"
        ? `Serif headings carry typographic gravitas and editorial authority — letterforms with historical associations to print, publishing, and credibility. ` +
          (source === "google" ? "Freely available but used here as a considered choice for character, not convention." : source === "self-hosted" ? "Self-hosted signals a licensed choice — an investment in typographic differentiation." : "")
        : `A serif body typeface prioritises reading experience and editorial character. Uncommon in product interfaces — signals a content-first product where reading is the primary activity.`;
      break;

    case "slab-serif":
      typeDesc = "slab serif";
      signalDesc = `Slab serifs combine the structure of a sans-serif with the visual weight of serif terminals. They project confidence and readability at display sizes — popular in branding that wants presence without the formality of a classic serif.`;
      break;

    case "script":
      typeDesc = "script / handwriting";
      signalDesc = `Script typefaces introduce informality and personal expression. In ${role} context, this signals warmth, creativity, or a brand identity built around a human voice rather than institutional authority. They rarely appear in product UIs without a specific personality reason.`;
      break;

    case "rounded":
      typeDesc = "rounded sans-serif";
      signalDesc = `Rounded terminal letterforms take a geometric or humanist structure and soften it — approachable, friendly, consumer-facing. ` +
        `The rounding communicates warmth without sacrificing the clarity of a sans-serif. Common in lifestyle, wellness, and consumer apps.`;
      break;

    case "geometric":
      typeDesc = "geometric sans-serif";
      signalDesc = `Geometric sans-serifs derive their forms from pure circles and squares — precise, contemporary, and neutral. ` +
        `They signal modernism and clarity, though at the cost of warmth. Common in tech, fintech, and brands that want to project precision.`;
      break;

    case "humanist":
      typeDesc = "humanist sans-serif";
      signalDesc = `Humanist sans-serifs borrow proportions from classical calligraphy — warmer and more legible than geometric alternatives at body sizes. ` +
        `They signal professionalism with approachability. Common in products where trustworthiness and readability must coexist.`;
      break;

    default:
      typeDesc = isDisplay ? "display sans-serif" : "sans-serif";
      if (isDisplay) {
        signalDesc = role === "heading"
          ? `A display-weight typeface — designed to perform at large sizes where the letterform itself becomes the visual event. ` +
            (source === "cdn" ? `CDN-loaded suggests an external font service (Adobe Fonts, Fontshare, or similar) rather than Google Fonts.`
              : source === "self-hosted" ? `Self-hosted signals a licensing investment — type is treated as a brand asset.`
              : ``)
          : `Using a display typeface for body copy is an unconventional choice — these faces are designed for headlines, and at body sizes their letterforms make a stronger visual statement than text serifs or humanist sans-serifs.`;
      } else if (source === "self-hosted") {
        signalDesc = `Self-hosting signals a licensing investment — a paid or proprietary typeface rather than a free alternative. Type is treated as a brand asset, not a utility choice.`;
      } else if (source === "cdn") {
        signalDesc = `CDN-loaded suggests an external font service (Adobe Fonts, Fontshare, or similar) rather than Google Fonts — implies a curated or paid type selection.`;
      } else {
        // Derive from role + source with what we know
        signalDesc = role === "heading"
          ? `A sans-serif heading typeface. ` +
            (source === "google" ? `Sourced from Google Fonts — widely available, chosen here for a specific character among the many options available.`
              : `Its character in context is determined by letterform details and how it pairs with the body typeface.`)
          : `A sans-serif body typeface. ` +
            (source === "google" ? `Freely available from Google Fonts — the choice within the large Google library says more than the choice of the library itself.`
              : ``) +
            ` ${weights.length > 2 ? `${weights.length} weights give typographic range within this face.` : ``}`;
      }
  }

  const investmentNote = source === "self-hosted" && type !== "sans-serif"
    ? ` (self-hosted — a licensing and infrastructure investment)`
    : source === "cdn" && type !== "sans-serif"
    ? ` (CDN-loaded — likely a licensed font service)`
    : "";

  return `**${family}** _(${role}, ${srcLabel}, ${weightNote})_: ${typeDesc}${investmentNote}. ${signalDesc}`;
}

// ── Dynamic color palette analysis ────────────────────────────────────────────
// Derives mood, warmth, and character from actual hex values — not from strategy label alone.

function parseHex(hex: string): [number, number, number] | null {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return null;
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function analyzeHex(hex: string): { warmth: "warm" | "cool" | "neutral"; sat: "vivid" | "muted" | "greyscale"; lum: "dark" | "mid" | "light" } | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;

  const sat: "vivid" | "muted" | "greyscale" = delta < 0.05 ? "greyscale" : delta < 0.25 ? "muted" : "vivid";
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  const lum: "dark" | "mid" | "light" = luminance < 0.3 ? "dark" : luminance > 0.7 ? "light" : "mid";

  let warmth: "warm" | "cool" | "neutral" = "neutral";
  if (delta > 0.05) {
    let hue = 0;
    if (max === r) hue = ((g - b) / delta + 6) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = hue * 60;
    warmth = (hue < 90 || hue > 300) ? "warm" : (hue > 170 && hue < 300) ? "cool" : "neutral";
  } else {
    warmth = rgb[0] > rgb[2] + 15 ? "warm" : rgb[2] > rgb[0] + 15 ? "cool" : "neutral";
  }

  return { warmth, sat, lum };
}

type ColorEntry = ReconstructSchema["design"]["colors"]["palette"][number];

function narratePalette(palette: ColorEntry[], strategy: string, darkMode: boolean, tier: Tier): string {
  const count = palette.length;
  const top = palette.slice(0, 6);
  const analyzed = top.map(c => ({ ...c, analysis: analyzeHex(c.value) })).filter(c => c.analysis);

  const warmCount = analyzed.filter(c => c.analysis!.warmth === "warm").length;
  const coolCount = analyzed.filter(c => c.analysis!.warmth === "cool").length;
  const darkCount = analyzed.filter(c => c.analysis!.lum === "dark").length;
  const lightCount = analyzed.filter(c => c.analysis!.lum === "light").length;
  const vividCount = analyzed.filter(c => c.analysis!.sat === "vivid").length;
  const mutedCount = analyzed.filter(c => c.analysis!.sat === "muted").length;
  const greyCount = analyzed.filter(c => c.analysis!.sat === "greyscale").length;

  const moodParts: string[] = [];
  if (warmCount > coolCount + 1) moodParts.push("warm-leaning");
  else if (coolCount > warmCount + 1) moodParts.push("cool-leaning");
  if (mutedCount >= vividCount && greyCount < mutedCount) moodParts.push("muted and restrained");
  else if (vividCount > mutedCount) moodParts.push("vivid and saturated");
  else if (greyCount >= analyzed.length - 1) moodParts.push("near-monochrome");
  if (darkCount > lightCount + 1) moodParts.push("dark-dominant");
  else if (lightCount > darkCount + 1) moodParts.push("light-dominant");

  const strategyMeaning: Record<string, string> = {
    monochrome: "all hierarchy comes from lightness and scale — maximum chromatic restraint, maximum demand on typography and spacing.",
    analogous: "adjacent hues create harmony and brand coherence — feels unified rather than assembled.",
    complementary: "opposite hues produce the contrast needed to make calls-to-action unmissable against a dominant neutral field.",
    triadic: "three evenly-spaced hues create visual energy — maintaining coherence across a triadic palette requires discipline.",
  };

  const topHexes = top.slice(0, 5).map(c => `\`${c.value}\``).join(" ");
  const mood = moodParts.length > 0 ? moodParts.join(", ") : "balanced";

  // When hex analysis and strategy contradict (e.g., hex says near-monochrome but strategy says analogous),
  // lead with what we can actually see in the tokens rather than asserting both.
  const hexDominates = moodParts.includes("near-monochrome") && strategy !== "monochrome";
  const strategyNote = hexDominates
    ? `Formally classified as ${strategy}, but the dominant tokens are near-neutral — the chromatic variation is subtle, not structural.`
    : (strategyMeaning[strategy] ?? "A custom color arrangement.");

  if (tier === "succinct") {
    return `${count} tokens · ${strategy} · ${mood} · ${darkMode ? "dark mode" : "light only"} · ${topHexes}`;
  }

  return [
    `${count} color tokens, ${darkMode ? "dark mode supported" : "light mode only"}.`,
    strategyNote,
    `The palette reads as ${mood}: ${topHexes}.`,
  ].join(" ");
}

// ── Design character evidence extraction ──────────────────────────────────────
// The descriptor strings produced by deriveDesignCharacter ARE the evidence —
// they're named after what the tokens showed, not after a fixed taxonomy.
// This function extracts supporting token data to render alongside each descriptor.

type Design = ReconstructSchema["design"];

function getDescriptorEvidence(descriptor: string, design: Design): string[] {
  const ev: string[] = [];
  const d = descriptor.toLowerCase();

  if (d.includes("monochrome") || d.includes("chromatic")) {
    const count = design.colors.palette.length;
    if (count > 0) ev.push(`${count} color tokens`);
    const topHex = design.colors.palette.slice(0, 3).map(c => c.value).join(", ");
    if (topHex) ev.push(`dominant: ${topHex}`);
  }
  if (d.includes("flat surface") || d.includes("hard-edge shadow") || d.includes("layered elevation") || d.includes("translucent") || d.includes("extruded") || d.includes("coloured elevation")) {
    if (design.elevation.length > 0) {
      ev.push(`${design.elevation.length} elevation layer(s)`);
      ev.push(design.elevation[0].value.slice(0, 60));
    } else {
      ev.push("no box-shadow declarations");
    }
  }
  if (d.includes("type") || d.includes("editorial") || d.includes("serif") || d.includes("display") || d.includes("monospace")) {
    const named = design.typography.families.filter(f => !CSS_GENERICS.has(f.family));
    if (named.length > 0) ev.push(named.map(f => `${f.family} (${f.role})`).join(", "));
    const max = design.typography.scale.length > 0 ? Math.max(...design.typography.scale) : 0;
    if (max > 0) ev.push(`${design.typography.scale.length}-step scale, ${max}px ceiling`);
  }
  if (d.includes("motion") || d.includes("transition") || d.includes("choreograph") || d.includes("microinteraction") || d.includes("static")) {
    if (design.motion.durations_ms.length > 0) {
      const min = Math.min(...design.motion.durations_ms);
      const max = Math.max(...design.motion.durations_ms);
      ev.push(`${design.motion.durations_ms.length} durations, ${min}–${max}ms`);
      if (design.motion.patterns.length > 0) ev.push(`patterns: ${design.motion.patterns.join(", ")}`);
    } else {
      ev.push("no animation/transition durations detected");
    }
  }
  if (d.includes("corner") || d.includes("round") || d.includes("sharp") || d.includes("pill") || d.includes("circular") || d.includes("rounding")) {
    if (design.border_radius.length > 0) ev.push(`border-radius: [${design.border_radius.join(", ")}]px`);
  }
  if (d.includes("spacing") || d.includes("density") || d.includes("breathing")) {
    ev.push(`${design.spacing.base_unit}px base unit, scale: [${design.spacing.scale.slice(0, 6).join(", ")}]px`);
  }
  if (d.includes("dark") || d.includes("warm palette") || d.includes("cool palette")) {
    const topHex = design.colors.palette.slice(0, 5).map(c => c.value).join(", ");
    if (topHex) ev.push(topHex);
  }

  return ev.slice(0, 3);
}

// Personality traits have known design meanings — these are stable vocabulary,
// not fixed school names. New traits from derivePersonality() get a fallback.
const PERSONALITY_MEANING: Record<string, string> = {
  clinical: "precision and expertise over warmth — the design says 'this works, trust it'",
  warm: "human connection — color and form invite rather than instruct",
  playful: "delight is a feature — personality earns engagement",
  authoritative: "gravitas through restraint — hierarchy and serif type signal credibility",
  energetic: "fast, high-contrast, action-oriented — every element pushes the user forward",
  elegant: "restraint as luxury — the design says 'we don't need to try hard'",
  bold: "big type, strong color, confident statements — commands attention",
  technical: "for people who know what they're doing — density and precision over explanation",
  neutral: "utility first — the design doesn't impose personality",
};

// ── Site synthesis ─────────────────────────────────────────────────────────────

function synthesizeSite(schema: ReconstructSchema): string {
  const { technology, design, philosophy } = schema;
  const fwDisplay = normalizeFwKey(technology.framework);
  const namedFamilies = design.typography.families.filter(f => !CSS_GENERICS.has(f.family));
  const monoBody = namedFamilies.find(f =>
    f.role === "body" && /mono|code|courier|consolas|jetbrains|fira|ibm plex/i.test(f.family)
  );
  const maxType = design.typography.scale.length > 0 ? Math.max(...design.typography.scale) : 0;
  const motionCount = design.motion.durations_ms.length;
  const schools = philosophy.design_school.filter(s => s !== "unknown");
  const personality = philosophy.personality.filter(p => p !== "neutral");

  const renderingLabels: Record<string, string> = {
    ssr: "server-rendered", ssg: "statically generated", csr: "client-side rendered",
    isr: "incrementally generated", hybrid: "hybrid-rendered", unknown: "web",
  };
  const renderLabel = renderingLabels[technology.rendering] ?? "web";

  const paragraphs: string[] = [];

  // ── P1: What is this, how is it built ─────────────────────────────────────
  const customStyling = technology.styling.every(s => s === "unknown");
  const rendering = technology.rendering;

  // Rendering-mode-aware description — never assert SSR/SSG facts for a CSR site
  const renderingContext: Record<string, string> = {
    ssr: "The server assembles HTML on every request — good for search engines and first-paint performance.",
    ssg: "Pages are pre-built at deploy time — fastest possible delivery, content updates require a rebuild.",
    isr: "Pages are pre-built but regenerate automatically — static speed with content freshness.",
    hybrid: "Different pages use different rendering strategies — some pre-built, some server-rendered per request.",
    csr: "Pages arrive as a minimal shell; all content is built in the browser by JavaScript. First paint is fast but the page is empty until JS runs.",
    unknown: "The rendering strategy couldn't be determined from the available signals.",
  };
  const renderCtx = renderingContext[rendering] ?? "";

  if (technology.framework === "unknown") {
    paragraphs.push(
      `A ${renderLabel} site with no detectable JavaScript framework fingerprint. ` +
      renderCtx + " " +
      (rendering !== "csr"
        ? `Despite the server-side delivery, no known framework signatures appear in the markup or URL structure. `
        : `No known framework signatures appear in the markup — this is likely vanilla JavaScript, a module bundler (Vite, Rollup, esbuild) with no component framework, or a lightweight tool that leaves no fingerprint. `) +
      (customStyling
        ? `The CSS is equally fingerprint-free — no utility class patterns, CSS-in-JS tokens, or module hashes.`
        : ``)
    );
  } else {
    const fw = FRAMEWORK_KB[fwDisplay];
    const stylingList = technology.styling.filter(s => s !== "unknown");
    paragraphs.push(
      `A ${renderLabel} site built on ${fwDisplay}` +
      (technology.meta_framework ? `, deployed via ${technology.meta_framework}` : "") +
      (stylingList.length ? `, styled with ${stylingList.join(" + ")}` : "") +
      `. ` +
      (fw ? fw.implies : "")
    );
  }

  // ── P2: Most distinctive design decisions ────────────────────────────────
  const notable: string[] = [];

  if (monoBody) {
    const { type } = classifyFont(monoBody.family);
    notable.push(
      `${monoBody.family} (${type}) as the primary body typeface — ` +
      `monospace type in a body role is outside its conventional use (code blocks, terminals)`
    );
  }

  if (maxType >= 72) {
    notable.push(
      `a type scale ceiling of ${maxType}px — at that size letterforms stop functioning as text labels and become graphic architecture`
    );
  }

  if (motionCount >= 8) {
    const minMs = Math.min(...design.motion.durations_ms);
    const maxMs = Math.max(...design.motion.durations_ms);
    notable.push(
      `${motionCount} distinct animation durations across a ${minMs}ms–${maxMs}ms range (${maxMs - minMs}ms spread)`
    );
  }

  if (namedFamilies.length >= 3 && !monoBody) {
    notable.push(
      `${namedFamilies.length} named typefaces: ${namedFamilies.map(f => `${f.family} (${f.role})`).join(", ")}`
    );
  }

  if (notable.length > 0) {
    paragraphs.push(`What distinguishes this from the category default: ${notable.slice(0, 2).join("; ")}.`);
  }

  // ── P3: Philosophy synthesis ───────────────────────────────────────────────
  if (schools.length >= 4) {
    paragraphs.push(
      `The design character spans ${schools.length} dimensions: ${schools.join("; ")}. ` +
      `These aren't contradictions — they're independent dimensions of the same design system operating simultaneously. ` +
      (personality.length > 0 ? `The overall personality reads as ${personality.slice(0, 2).join(" and ")}.` : "")
    );
  } else if (schools.length > 0) {
    const ev = getDescriptorEvidence(schools[0], design);
    const evNote = ev.length > 0 ? ` (${ev.join("; ")})` : "";
    paragraphs.push(
      `Design character: ${schools.join(" · ")}${evNote}. ` +
      (personality.length > 0 ? `The design communicates a ${personality.slice(0, 2).join(" and ")} character.` : "")
    );
  }

  return paragraphs.filter(Boolean).join("\n\n");
}

// ── Standout signal detector ───────────────────────────────────────────────────

function findStandouts(schema: ReconstructSchema): string[] {
  const notes: string[] = [];
  const { design, technology, philosophy } = schema;
  const namedFamilies = design.typography.families.filter(f => !CSS_GENERICS.has(f.family));

  const maxType = design.typography.scale.length > 0 ? Math.max(...design.typography.scale) : 0;
  if (maxType >= 80) {
    notes.push(`Type scale reaches ${maxType}px — ${(maxType / 16).toFixed(1)}× the standard 16px body size. At this scale, type carries significant visual weight alongside other layout elements.`);
  }

  const monoBody = namedFamilies.find(f => f.role === "body" && /mono|code|courier|consolas|jetbrains|fira/i.test(f.family));
  if (monoBody) {
    const { type } = classifyFont(monoBody.family);
    notes.push(`${monoBody.family} (${type}) used for body text — monospace type in a body role is outside its conventional use (code blocks, terminals).`);
  }

  if (design.border_radius.length > 0 && design.border_radius.every(r => r === 0)) {
    notes.push(`Zero border radius throughout — every element is perfectly rectangular. A precise, formal aesthetic; also a component of neo-brutalism and utilitarian design.`);
  }

  const maxRadius = design.border_radius.length > 0 ? Math.max(...design.border_radius) : 0;
  // Only flag as "pill shapes" when 50 is one of multiple large radii or the only radius —
  // 50% on a 6×6px dot is circular dots, not pill cards. Require that 50 coexists with
  // at least one other non-trivial radius (>8px) to indicate it's on real shape elements.
  const otherLargeRadii = design.border_radius.filter(r => r > 8 && r < 50);
  if (maxRadius >= 50 && otherLargeRadii.length > 0) {
    notes.push(`Pill shapes and rounded elements coexist — radius values: ${design.border_radius.join(", ")}px. Both circular forms (${maxRadius}px) and large rounding (${otherLargeRadii.join(", ")}px) are present.`);
  } else if (maxRadius >= 50 && design.border_radius.length === 1) {
    notes.push(`Border radius reaches ${maxRadius}px — the only radius value, suggesting circular elements (avatars, badges, dots) rather than pill-shaped cards.`);
  }

  if (technology.detected_libs.includes("framer-motion") && design.motion.durations_ms.length === 0) {
    notes.push(`Framer Motion detected but no CSS transition durations — animations are spring-physics-based (JS-driven), invisible to static CSS analysis. The motion system is richer than the extracted tokens suggest.`);
  }

  if (technology.detected_libs.includes("three.js")) {
    notes.push(`Three.js detected — 3D rendering in the browser. Significant performance and bundle size cost. Static CSS analysis cannot capture what the 3D scenes contain.`);
  }

  if (
    (philosophy.accessibility_grade === "none" || philosophy.accessibility_grade === "unknown") &&
    ["Next.js", "Nuxt", "Astro", "Remix", "SvelteKit"].includes(technology.framework)
  ) {
    notes.push(`No detected accessibility grade despite ${technology.framework}'s strong a11y tooling. The infrastructure supports it; the investment hasn't been made.`);
  }

  // (dark-mode-first named school removed — covered by darkInPalette check below)

  if (technology.framework === "unknown" && technology.detected_libs.length === 0) {
    notes.push(`No framework or library fingerprints — hand-coded HTML/CSS, a build pipeline that strips all identifiers, or a lightweight tool that leaves no runtime markers.`);
  }

  if (design.motion.durations_ms.length >= 10) {
    const minMs = Math.min(...design.motion.durations_ms);
    const maxMs = Math.max(...design.motion.durations_ms);
    notes.push(`${design.motion.durations_ms.length} distinct animation durations (${minMs}ms–${maxMs}ms) — values: [${design.motion.durations_ms.slice(0, 10).join(", ")}]ms${design.motion.durations_ms.length > 10 ? "…" : ""}.`);
  }

  // Observe monochrome character vs palette size contradiction from actual token values
  const paletteCount = design.colors.palette.length;
  const saturatedInPalette = design.colors.palette.filter(c => {
    const rgb = c.value.replace("#",""); if (rgb.length !== 6) return false;
    const r = parseInt(rgb.slice(0,2),16)/255, g = parseInt(rgb.slice(2,4),16)/255, b = parseInt(rgb.slice(4,6),16)/255;
    return Math.max(r,g,b) - Math.min(r,g,b) > 0.35;
  });
  if (paletteCount > 10 && saturatedInPalette.length === 0) {
    notes.push(`${paletteCount} color tokens but all near-neutral — the palette is large because of opacity/tint variations, not chromatic range. The visual experience is monochrome despite the token count.`);
  }

  // Observe dark-dominant palette without prefers-color-scheme
  const darkInPalette = design.colors.palette.filter(c => {
    const rgb = c.value.replace("#",""); if (rgb.length !== 6) return false;
    const r = parseInt(rgb.slice(0,2),16), g = parseInt(rgb.slice(2,4),16), b = parseInt(rgb.slice(4,6),16);
    return (0.299*r + 0.587*g + 0.114*b)/255 < 0.35;
  });
  if (!design.colors.dark_mode && darkInPalette.length > design.colors.palette.length * 0.5) {
    notes.push(`Dark-dominant palette (${darkInPalette.length} of ${paletteCount} tokens are dark) without prefers-color-scheme — this is a hardcoded dark aesthetic, not a system-responsive one. Users on light mode preference cannot override it.`);
  }

  return notes;
}

// ── Technology section ─────────────────────────────────────────────────────────

function interpretTech(schema: ReconstructSchema, tier: Tier): string {
  const { technology } = schema;
  const fwDisplay = normalizeFwKey(technology.framework);
  const fw = FRAMEWORK_KB[fwDisplay];
  const customStyling = technology.styling.every(s => s === "unknown");
  const stylingEntries = technology.styling
    .filter(s => s !== "unknown")
    .map(s => ({ key: s, ...STYLING_KB[normalizeStylingKey(s)] }))
    .filter(e => e.role);
  const libs = technology.detected_libs.map(l => ({ name: l, note: LIB_KB[l] })).filter(l => l.note);

  if (tier === "ai") return `## Technology\n\`\`\`json\n${JSON.stringify(technology, null, 2)}\n\`\`\``;

  if (tier === "succinct") {
    return [
      "## Tech Stack",
      `**Framework:** ${technology.framework === "unknown" ? "none detected (likely static generator or hand-coded)" : technology.framework} · **Rendering:** ${technology.rendering}${technology.meta_framework ? ` via ${technology.meta_framework}` : ""}`,
      `**Styling:** ${customStyling ? "custom CSS" : technology.styling.filter(s => s !== "unknown").join(" + ")}`,
      technology.state.length ? `**State:** ${technology.state.join(", ")}` : "",
      libs.length ? `**Notable libs:** ${libs.map(l => l.name).join(", ")}` : "",
    ].filter(Boolean).join("\n");
  }

  if (tier === "professional") {
    const lines: string[] = ["## Technology", ""];

    if (technology.framework === "unknown") {
      const r = technology.rendering;
      const techCtx = r === "csr"
        ? `No JavaScript framework fingerprint detected. This is client-side rendered — content is built in the browser by JavaScript — ` +
          `but no component framework (React, Vue, Svelte, Angular) left identifying signatures in the markup. ` +
          `Likely a vanilla JS project with a module bundler (Vite, Rollup, esbuild) or a minimal framework like Alpine.js or Petite Vue. `
        : `No JavaScript framework fingerprint detected. The HTML is ${r === "ssg" ? "statically pre-built" : r === "ssr" ? "server-rendered" : "pre-rendered"} ` +
          `but no known framework signatures appear in the markup or URL patterns. ` +
          `Likely candidates: Eleventy, Hugo, Jekyll, or aggressive build-time obfuscation from a framework like Astro. `;
      lines.push(techCtx + (customStyling ? `CSS is equally framework-free — entirely custom, with no utility class or module hash signatures.` : ``));
    } else {
      lines.push(
        `**${fwDisplay}** · ${technology.rendering}${technology.meta_framework ? ` via ${technology.meta_framework}` : ""}. ` +
        (fw ? `${fw.implies} _Tradeoff:_ ${fw.tradeoff}` : "")
      );
    }

    if (stylingEntries.length > 0) {
      lines.push("");
      for (const e of stylingEntries) {
        lines.push(`**${e.key}:** ${e.implies} _Tradeoff:_ ${e.tradeoff}`);
      }
    }

    if (libs.length > 0) {
      lines.push("", "**Library signals:**");
      for (const l of libs) lines.push(`- **${l.name}:** ${l.note}`);
    }

    if (technology.state.length > 0) {
      lines.push(`\n**State (${technology.state.join(", ")}):** client-side state is present — UI complexity exceeds what server rendering alone can handle.`);
    }

    if (fw?.dev_note) lines.push(`\n**Developer notes:** ${fw.dev_note}`);

    return lines.join("\n");
  }

  // Newbie — full narrative
  const lines = ["## How This Site Is Built", ""];
  const renderingMap: Record<string, string> = {
    ssr: "Pages are assembled on the server before they reach you. Fast first loads, great for search engines, works without JavaScript. The server does work on every single request.",
    ssg: "All pages were pre-built at deploy time, not per-request. Fastest possible delivery — content can only change when the site rebuilds and redeploys.",
    csr: "The page arrives mostly empty; JavaScript builds the UI in your browser after it loads. First load is slower; the app feels instant afterward. Search engines may struggle.",
    isr: "Hybrid: pages are pre-built but regenerate automatically after a time window. Static speeds with the ability to update content without a full rebuild.",
    hybrid: "Different pages use different strategies — some pre-built for speed, some server-rendered for freshness.",
    unknown: "The rendering strategy couldn't be determined. It may use a custom or mixed approach.",
  };

  if (technology.framework === "unknown") {
    const r = technology.rendering;
    const unknownFwDesc = r === "csr"
      ? `**No framework fingerprint detected.** The site is client-side rendered — JavaScript builds the UI in the browser — ` +
        `but no component framework (React, Vue, Svelte) left identifying traces. ` +
        `This typically means vanilla JavaScript with a module bundler like Vite, or a micro-framework (Alpine.js, Petite Vue, Lit) that doesn't assert identity in its output. ` +
        `Each option implies something different: vanilla JS suggests deep preference for direct control; a micro-framework suggests wanting just enough reactivity without the cost of a full framework.`
      : `**No framework fingerprint detected.** This is either hand-coded HTML, a build pipeline that strips all identifying markers, ` +
        `or a lightweight static generator (Eleventy, Hugo, Jekyll) that doesn't embed runtime signatures. ` +
        `Each option implies something different: hand-coded suggests preference for direct control; ` +
        `a static generator suggests optimising for simplicity and build-time performance over runtime flexibility.`;
    lines.push(
      unknownFwDesc,
      "",
      `${renderingMap[technology.rendering] ?? technology.rendering}`
    );
    if (customStyling) {
      lines.push(
        "",
        `**Styling is also framework-free.** No utility classes (Tailwind), no CSS-in-JS tokens, no scoped module hashes. ` +
        `Visual consistency is maintained through hand-authored CSS — a meaningful investment given the coherence of the extracted design system.`
      );
    }
  } else if (fw) {
    lines.push(
      `**${fwDisplay}** — ${fw.role}.`,
      "",
      `**Why this choice:** ${fw.implies}`,
      "",
      `**What you'd notice as a developer:** ${fw.dev_note}`,
      "",
      `**What you'd notice as a designer:** The framework choice shapes how design tokens flow. ` +
      (technology.styling.includes("tailwind")
        ? "Tailwind means the design system lives in a config file — spacing, colors, and type are constrained to a predefined grid."
        : technology.styling.some(s => ["styled-components", "emotion"].includes(s))
        ? "CSS-in-JS means styles live next to component logic — designers and developers share one file per component."
        : technology.styling.includes("css-modules")
        ? "CSS Modules means each component has its own scoped stylesheet — easy to reason about in isolation."
        : "Custom styling means every design decision is maintained manually."),
      "",
      `**What they traded:** ${fw.tradeoff}`,
      "",
      `**How content reaches your browser (${technology.rendering}):** ${renderingMap[technology.rendering] ?? technology.rendering}`
    );
  }

  if (stylingEntries.length > 0) {
    lines.push("", "**How visual design is managed:**");
    for (const e of stylingEntries) {
      lines.push(`**${e.key}** — ${e.role}. ${e.implies}`, `_What they traded:_ ${e.tradeoff}`, "");
    }
  }

  if (libs.length > 0) {
    lines.push("**Libraries that shape the experience:**");
    for (const l of libs) lines.push(`- **${l.name}:** ${l.note}`);
  }

  if (technology.state.length > 0) {
    lines.push(
      "",
      `**State management (${technology.state.join(", ")}):** Part of this UI holds information that isn't on the server — ` +
      `open panels, cart state, live search results. A dedicated library means this complexity was real enough that component-local state wasn't sufficient.`
    );
  }

  return lines.join("\n");
}

// ── Design section ─────────────────────────────────────────────────────────────

function interpretDesign(schema: ReconstructSchema, tier: Tier): string {
  const { design } = schema;
  if (tier === "ai") return `## Design\n\`\`\`json\n${JSON.stringify(design, null, 2)}\n\`\`\``;

  const namedFamilies = design.typography.families.filter(f => !CSS_GENERICS.has(f.family));
  const maxType = design.typography.scale.length > 0 ? Math.max(...design.typography.scale) : 0;
  const minType = design.typography.scale.length > 0 ? Math.min(...design.typography.scale) : 0;

  const colorText = narratePalette(design.colors.palette, design.colors.strategy, design.colors.dark_mode, tier);

  const motionNarrative = (): string => {
    if (design.motion.durations_ms.length === 0) return "No CSS animations or transitions detected.";
    const minMs = Math.min(...design.motion.durations_ms);
    const maxMs = Math.max(...design.motion.durations_ms);
    const count = design.motion.durations_ms.length;
    const patterns = design.motion.patterns.join(", ") || "standard transitions";
    const hasRM = design.motion.has_reduced_motion_support;
    return (
      `${count} distinct timing durations (${minMs}ms–${maxMs}ms) across patterns: ${patterns}. ` +
      (count >= 8 ? `${count} timing values spanning a ${maxMs - minMs}ms range. ` : "") +
      (hasRM
        ? `Reduced-motion preference is respected.`
        : `No reduced-motion support — users with vestibular sensitivity aren't accommodated.`)
    );
  };

  if (tier === "succinct") {
    return [
      "## Design System",
      colorText,
      `**Type:** ${namedFamilies.map(f => f.family).join(", ")} · Scale: [${design.typography.scale.join(", ")}]px`,
      `**Spacing:** ${design.spacing.base_unit}px base · ${design.spacing.strategy}`,
      `**Radius:** [${design.border_radius.join(", ")}]px · **Elevation:** ${design.elevation.length} shadow levels`,
      `**Motion:** ${design.motion.durations_ms.length > 0 ? `${design.motion.durations_ms.length} durations, ${Math.min(...design.motion.durations_ms)}ms–${Math.max(...design.motion.durations_ms)}ms` : "none"}`,
      `**Grid:** ${design.grid.layout} · max-width ${design.grid.max_width_px ?? "unset"}px`,
    ].join("\n");
  }

  if (tier === "professional") {
    const lines = ["## Design System", ""];

    lines.push("### Color");
    lines.push(colorText);

    lines.push("", "### Typography");
    for (const f of namedFamilies) lines.push(characterizeFont(f, tier));
    lines.push(
      "",
      `Scale: [${design.typography.scale.join(", ")}]px — ${design.typography.scale.length} steps, ${minType}px–${maxType}px. ` +
      `Base: ${design.typography.base_size}px at ${design.typography.line_height_base} line height. Letter spacing: ${design.typography.letter_spacing_pattern}.`
    );

    lines.push("", "### Spacing & Layout");
    lines.push(
      `${design.spacing.base_unit}px base unit · ${design.spacing.strategy}. ` +
      `Grid: ${design.grid.layout}, max-width ${design.grid.max_width_px ?? "unset"}px, ` +
      `${design.grid.columns ?? "unknown"} columns, breakpoints [${design.grid.breakpoints_px.join(", ")}]px.`
    );

    lines.push("", "### Surface & Motion");
    lines.push(
      `Border radius: [${design.border_radius.join(", ")}]px. ` +
      `${design.elevation.length} elevation layers. Dark mode: ${design.colors.dark_mode ? "yes" : "no"}.`
    );
    lines.push(motionNarrative());

    return lines.join("\n");
  }

  // Newbie — full narrative with both lenses
  const lines = ["## The Visual Design System", ""];

  lines.push("### Color");
  lines.push(colorText);
  // Derive color designer/developer notes from actual palette measurements
  const saturatedTokens = design.colors.palette.filter(c => {
    const rgb = c.value.replace("#",""); if (rgb.length !== 6) return false;
    const r = parseInt(rgb.slice(0,2),16)/255, g = parseInt(rgb.slice(2,4),16)/255, b = parseInt(rgb.slice(4,6),16)/255;
    return Math.max(r,g,b) - Math.min(r,g,b) > 0.35;
  });
  const topHexes = design.colors.palette.slice(0, 4).map(c => `\`${c.value}\``).join(", ");
  const chromaticPct = design.colors.palette.length > 0
    ? Math.round(saturatedTokens.length / design.colors.palette.length * 100) : 0;
  lines.push(
    "",
    `**Chromatic breakdown:** ${saturatedTokens.length} of ${design.colors.palette.length} tokens have chromatic saturation (${chromaticPct}%). ` +
    (saturatedTokens.length > 0
      ? `Chromatic: ${saturatedTokens.slice(0, 3).map(c => `\`${c.value}\``).join(", ")}. `
      : ``) +
    `Neutrals: ${topHexes}.`,
    `**What colour is doing:** ` +
    (saturatedTokens.length === 0
      ? `No chromatic contrast in the palette. Lightness, weight, and spacing carry all hierarchy — colour is absent from that toolkit.`
      : `${chromaticPct}% of tokens are chromatic; the remaining ${100 - chromaticPct}% are neutrals. ` +
        `Whether this is intentional restraint or a minimal palette is a design context question the tokens alone can't answer.`),
    `**Tokens:** ${design.colors.palette.length}${design.colors.dark_mode ? " · dark-mode via prefers-color-scheme" : " · light mode only"}.`
  );

  lines.push("", "### Typography");
  if (namedFamilies.length >= 2) {
    lines.push(`${namedFamilies.length} typefaces in active use — each with a distinct role:`, "");
  }
  for (const f of namedFamilies) lines.push(characterizeFont(f, tier), "");

  const scaleRatio = minType > 0 ? (maxType / minType).toFixed(1) : "?";
  const baseToMax = maxType > 0 ? (maxType / (design.typography.base_size || 16)).toFixed(1) : "?";

  lines.push(
    `**Type scale:** [${design.typography.scale.join(", ")}]px — ${design.typography.scale.length} steps, ${minType}–${maxType}px (${scaleRatio}× span).`,
    `Base to ceiling ratio: ${baseToMax}× — the largest type is ${baseToMax}× the body size.`,
    design.typography.letter_spacing_pattern !== "normal"
      ? `Letter spacing: ${design.typography.letter_spacing_pattern}.`
      : ""
  );

  lines.push("", "### Spacing");
  const spMin = design.spacing.scale.length > 0 ? Math.min(...design.spacing.scale) : 0;
  const spMax = design.spacing.scale.length > 0 ? Math.max(...design.spacing.scale) : 0;
  const spMed = design.spacing.scale.length > 0 ? design.spacing.scale[Math.floor(design.spacing.scale.length / 2)] : 0;
  lines.push(
    `**${design.spacing.base_unit}px base unit, ${design.spacing.strategy} scale.** ` +
    `Scale: [${design.spacing.scale.slice(0, 8).join(", ")}]px${design.spacing.scale.length > 8 ? "…" : ""}. ` +
    `Min: ${spMin}px · Median: ${spMed}px · Max: ${spMax}px.`,
    `Grid: ${design.grid.layout}, max-width ${design.grid.max_width_px ?? "unset"}px, ${design.grid.columns ?? "unknown"} columns, breakpoints at [${design.grid.breakpoints_px.join(", ")}]px.`
  );

  if (design.elevation.length > 0) {
    lines.push("", "### Depth");
    const shadowSamples = design.elevation.slice(0, 2).map(e => `\`${e.value.slice(0, 50)}\``).join(", ");
    lines.push(
      `${design.elevation.length} distinct shadow value(s): ${shadowSamples}. ` +
      (design.elevation.some(e => e.value.includes("inset"))
        ? `Inset shadows detected (recessed appearance).`
        : design.elevation.length >= 4
        ? `${design.elevation.length} distinct shadow levels.`
        : `${design.elevation.length} shadow level(s).`)
    );
  }

  if (design.border_radius.length > 0) {
    const maxRadius = Math.max(...design.border_radius);
    const otherLargeRadii = design.border_radius.filter(r => r > 8 && r < 50);
    lines.push("", "### Shape");
    lines.push(
      `Border radius: [${design.border_radius.join(", ")}]px. ` +
      (maxRadius === 0 ? `Zero radius — every element is perfectly rectangular. Precision, formality, or a neo-brutalist rejection of decorative softening.`
        : maxRadius >= 50 && otherLargeRadii.length > 0
          ? `Pill and rounded shapes coexist (up to ${maxRadius}px) — extreme rounding alongside ${otherLargeRadii.join(", ")}px shapes signals a consumer-friendly, approachable brand language.`
          : maxRadius >= 50
          ? `Border radius reaches ${maxRadius}px — likely circular elements (avatars, badges, dots) rather than pill-shaped cards. The actual shape language is determined by the other values.`
          : maxRadius >= 20 ? `Generous rounding (up to ${maxRadius}px) softens edges significantly. Warm and approachable without going full-pill.`
          : `Subtle rounding — edges are softened without dominating the aesthetic.`)
    );
  }

  if (design.motion.durations_ms.length > 0) {
    lines.push("", "### Motion");
    lines.push(motionNarrative());
    lines.push(
      "",
      `**Patterns detected:** ${design.motion.patterns.length > 0 ? design.motion.patterns.join(", ") : "standard easing transitions"}. ` +
      (design.motion.patterns.includes("spring") ? `Spring easing is physics-based — the value overshoots the target before settling, unlike fixed CSS cubic-bezier curves. ` : "") +
      (design.motion.patterns.includes("pulse") ? `Pulse is a repeating animation. ` : "") +
      (!design.motion.has_reduced_motion_support ? "No prefers-reduced-motion support detected." : "prefers-reduced-motion respected.")
    );
  }

  return lines.filter(l => l !== undefined).join("\n");
}

// ── Interactions section ───────────────────────────────────────────────────────

function interpretInteractions(schema: ReconstructSchema, tier: Tier): string {
  const { interactions, design } = schema;
  if (tier === "ai") return `## Interactions\n\`\`\`json\n${JSON.stringify(interactions, null, 2)}\n\`\`\``;

  const hoverCount = interactions.global_hover_patterns.length;
  const uniqueHoverElements = [...new Set(interactions.global_hover_patterns.map(p => p.element))];
  const allHoverChanges = [...new Set(interactions.global_hover_patterns.flatMap(p => p.changes))];

  const focusNarrative: Record<string, string> = {
    native: "browser-default focus outlines — functional but unbranded",
    custom: "custom focus styling — accessibility is designed into the visual language, not left to browser defaults",
    hidden: "focus outlines hidden — keyboard and assistive-technology users have no visual indicator. An accessibility failure.",
    mixed: "inconsistent focus handling — some elements are styled, others fall back to browser defaults",
  };

  if (tier === "succinct") {
    return [
      "## Interactions",
      `**Focus:** ${interactions.focus_strategy}`,
      hoverCount > 0 ? `**Hover:** ${hoverCount} patterns (${uniqueHoverElements.slice(0, 4).join(", ")})` : "**Hover:** minimal",
      interactions.scroll_behaviors.length > 0 ? `**Scroll:** ${interactions.scroll_behaviors.join(", ")}` : "",
      interactions.transitions.length > 0 ? `**Transitions:** ${interactions.transitions.length}` : "",
    ].filter(Boolean).join("\n");
  }

  if (tier === "professional") {
    const lines = ["## Interactions", ""];
    lines.push(`**Focus:** ${interactions.focus_strategy} — ${focusNarrative[interactions.focus_strategy] ?? interactions.focus_strategy}.`);

    if (hoverCount > 0) {
      lines.push(
        "",
        `**Hover (${hoverCount} patterns, ${uniqueHoverElements.length} element type(s)):** ` +
        `Elements: ${uniqueHoverElements.slice(0, 5).join(", ")}. ` +
        `Properties: ${allHoverChanges.slice(0, 6).join(", ")}.`
      );
      for (const p of interactions.global_hover_patterns.slice(0, 5)) {
        lines.push(`  - \`${p.element}\`: ${p.changes.join(", ")}${p.motion ? ` · ${p.motion.duration_ms}ms ${p.motion.easing}` : ""}`);
      }
    }

    if (interactions.scroll_behaviors.length > 0) {
      lines.push(`\n**Scroll:** ${interactions.scroll_behaviors.join(", ")}.`);
    }

    if (interactions.transitions.length > 0) {
      lines.push(`\n**Transitions (${interactions.transitions.length}):**`);
      interactions.transitions.slice(0, 5).forEach(t => {
        lines.push(`  - \`${t.properties.join(", ")}\` · ${t.duration_ms}ms · ${t.easing}`);
      });
    }

    return lines.join("\n");
  }

  // Newbie
  const lines = ["## How the Site Responds to You", ""];

  lines.push(
    "### Focus and keyboard",
    `**${interactions.focus_strategy}:** ${focusNarrative[interactions.focus_strategy] ?? interactions.focus_strategy}.`,
    "",
    `Focus outlines tell keyboard users — including power users and people with motor disabilities — where they are on the page. ` +
    (interactions.focus_strategy === "hidden"
      ? "Hiding them is a common oversight with real accessibility consequences."
      : interactions.focus_strategy === "custom"
      ? "Custom styles signal that someone invested in making keyboard navigation feel polished, not just functional."
      : "Browser-native outlines work but often look out of place against a designed system.")
  );

  if (hoverCount > 0) {
    lines.push(
      "",
      "### Hover behaviour",
      `${hoverCount} hover patterns across ${uniqueHoverElements.length} element type(s): ${uniqueHoverElements.slice(0, 5).join(", ")}.`,
      `Properties that change on hover: ${allHoverChanges.slice(0, 6).join(", ")}.`,
      "",
      `**Designer's read:** Hover states are micro-feedback moments — they confirm interactivity before the click. ` +
      (design.motion.durations_ms.length > 0
        ? `The motion system (${Math.min(...design.motion.durations_ms)}ms–${Math.max(...design.motion.durations_ms)}ms) gives each hover type its own timing.`
        : `Fast, imperceptible transitions keep responses feeling instant.`),
      `**Developer's read:** CSS :hover rules, not JavaScript. No scripting cost, no hydration dependency.`
    );
  }

  if (interactions.scroll_behaviors.length > 0) {
    lines.push(
      "",
      "### Scroll behaviour",
      `${interactions.scroll_behaviors.join(", ")}.`,
      "",
      (interactions.scroll_behaviors.includes("sticky") ? "Sticky elements keep navigation or key actions always reachable — trading layout space for persistent access. " : "") +
      (interactions.scroll_behaviors.includes("scroll-snap") ? "Scroll-snap creates section-by-section pagination — immersive but can surprise users expecting free scroll. " : "") +
      (interactions.scroll_behaviors.includes("smooth-scroll") ? "Smooth scroll turns instant position jumps into animated glides — a subtle but effective polish signal." : "")
    );
  }

  if (interactions.transitions.length > 0) {
    lines.push(
      "",
      "### Transitions",
      `${interactions.transitions.length} CSS transition definitions. ` +
      `Top: ${interactions.transitions.slice(0, 3).map(t => `${t.properties.join("/")} ${t.duration_ms}ms ${t.easing}`).join(" · ")}.`,
      "",
      `Transition timing is how the site communicates responsiveness. ` +
      (interactions.transitions.some(t => t.easing.includes("cubic-bezier"))
        ? "Custom cubic-bezier easings signal that someone hand-tuned these — standard ease/ease-in-out wasn't precise enough."
        : "Standard easings (ease, linear) are functional and predictable.")
    );
  }

  return lines.join("\n");
}

// ── Philosophy section ─────────────────────────────────────────────────────────

function interpretPhilosophy(schema: ReconstructSchema, tier: Tier): string {
  const { philosophy, design } = schema;
  if (tier === "ai") return `## Philosophy\n\`\`\`json\n${JSON.stringify(philosophy, null, 2)}\n\`\`\``;

  // design_school now contains dimension descriptors derived from actual tokens — not named schools.
  // Each descriptor is self-explanatory; display it with its supporting token evidence.
  const descriptors = philosophy.design_school.filter(s => !s.includes("undetermined"));
  const personality = philosophy.personality.filter(p => p !== "neutral");

  // Accessibility — factual WCAG level descriptions
  const accessibilityContext: Record<string, string> = {
    AAA: "Exceeds WCAG baseline — ARIA, landmarks, focus management, and motion preferences all addressed.",
    AA: "Meets WCAG AA — core accessibility fundamentals present.",
    A: "WCAG A only — basic patterns present but inconsistently applied. Assistive technology users will encounter friction.",
    none: "No accessibility signals detected — missing ARIA, landmarks, or keyboard support.",
    unknown: "Accessibility level couldn't be determined from the extracted signals.",
  };

  // Density description derived from actual spacing measurements, not from the label alone
  const densityDesc = (): string => {
    const { base_unit, scale, strategy } = design.spacing;
    const maxSp = scale.length > 0 ? Math.max(...scale) : 0;
    const medSp = scale.length > 0 ? scale[Math.floor(scale.length / 2)] : 0;
    if (philosophy.density === "sparse") {
      return `${base_unit}px base unit, median spacing ${medSp}px, max ${maxSp}px — the scale reaches far enough that generous space around focal elements is the norm, not the exception.`;
    }
    if (philosophy.density === "dense") {
      return `${base_unit}px base unit, median spacing ${medSp}px — tight grid, information per screen is prioritised.`;
    }
    return `${base_unit}px base unit, ${strategy} spacing scale, median ${medSp}px — balanced density.`;
  };

  if (tier === "succinct") {
    return [
      "## Design Philosophy",
      `**Character:** ${descriptors.length > 0 ? descriptors.join(" · ") : "undetermined"}`,
      `**Personality:** ${personality.length > 0 ? personality.join(", ") : "neutral"}`,
      `**Density:** ${philosophy.density} · **Whitespace:** ${philosophy.whitespace_use}`,
      `**Hierarchy via:** ${philosophy.visual_hierarchy_method.join(", ")}`,
      `**Accessibility:** ${philosophy.accessibility_grade}`,
    ].join("\n");
  }

  if (tier === "professional") {
    const lines = ["## Design Philosophy", ""];

    if (descriptors.length > 0) {
      lines.push("**Design character:**");
      for (const d of descriptors) {
        const ev = getDescriptorEvidence(d, design);
        const evStr = ev.length ? ` _(${ev.join("; ")})_` : "";
        lines.push(`- ${d}${evStr}`);
      }
    }

    if (personality.length > 0) {
      lines.push("");
      lines.push(`**Personality:** ${personality.map(p => `_${p}_ — ${PERSONALITY_MEANING[p] ?? p}`).join("; ")}.`);
    }

    lines.push(
      "",
      `**Density / whitespace:** ${philosophy.density} · ${philosophy.whitespace_use}. ${densityDesc()}`,
      `Hierarchy via: ${philosophy.visual_hierarchy_method.join(", ")}.`,
      "",
      `**Accessibility (${philosophy.accessibility_grade}):** ${accessibilityContext[philosophy.accessibility_grade] ?? philosophy.accessibility_grade}`
    );

    return lines.join("\n");
  }

  // Newbie — full evidence-grounded explanation
  const lines = ["## The Design's Character and Intent", ""];

  if (descriptors.length === 0) {
    lines.push("The extracted tokens don't produce a clear design character signal — the site may use very minimal CSS or the extraction coverage was low.", "");
  } else {
    lines.push(
      "### Design dimensions",
      `${descriptors.length} design dimensions characterised from the extracted tokens:`,
      ""
    );
    for (const d of descriptors) {
      const ev = getDescriptorEvidence(d, design);
      const evStr = ev.length ? ` Evidence: ${ev.join("; ")}.` : "";
      lines.push(`**${d.charAt(0).toUpperCase() + d.slice(1)}**${evStr}`, "");
    }
    lines.push(
      `These dimensions are independent of any named design school — they describe what the CSS tokens actually show, not what aesthetic tradition they most resemble.`,
      ""
    );
  }

  if (personality.length > 0) {
    lines.push("### Personality");
    lines.push(`The design communicates: ${personality.map(p => `**${p}** — ${PERSONALITY_MEANING[p] ?? p}`).join("; ")}.`, "");
    lines.push(
      `Personality is the emotional contract the design makes with its audience. ` +
      `Each trait above is derived from a specific combination of tokens — not a label applied from the outside. ` +
      `If the personality reads as unexpected for the product context, that's a signal worth examining.`,
      ""
    );
  }

  lines.push(
    "### Density and space",
    densityDesc(),
    "",
    `Whitespace classified as **${philosophy.whitespace_use}** — ` +
    (design.spacing.scale.length > 0
      ? `spacing values range from ${Math.min(...design.spacing.scale)}px to ${Math.max(...design.spacing.scale)}px (${design.spacing.scale.length} steps).`
      : `spacing scale not extracted.`),
    "",
    "### Visual hierarchy",
    `Hierarchy achieved through: **${philosophy.visual_hierarchy_method.join(", ")}**.`,
    "",
    ...philosophy.visual_hierarchy_method.map(m => {
      const hierarchyEv: Record<string, string> = {
        size: `**Size** — the ${design.typography.scale.length}-step type scale (${design.typography.scale.length > 0 ? Math.min(...design.typography.scale) : "?"}–${design.typography.scale.length > 0 ? Math.max(...design.typography.scale) : "?"}px) creates ${design.typography.scale.length >= 6 ? "many distinct" : "a focused set of"} levels of visual importance.`,
        weight: `**Weight** — ${design.typography.families.filter(f => f.weights.length > 2).map(f => `${f.family} (${f.weights.length} weights)`).join(", ") || "multiple font weights"} create emphasis without colour change.`,
        color: `**Color** — ${design.colors.palette.length} tokens provide chromatic differentiation; ${design.colors.palette.filter(c => { const r=parseInt(c.value.slice(1,3),16)/255,g=parseInt(c.value.slice(3,5),16)/255,b=parseInt(c.value.slice(5,7),16)/255; return Math.max(r,g,b)-Math.min(r,g,b)>0.35; }).length} are saturated (chromatic) vs the rest which are neutrals.`,
        spacing: `**Spacing** — the ${design.spacing.base_unit}px grid and scale up to ${design.spacing.scale.length > 0 ? Math.max(...design.spacing.scale) : "?"}px create proximity groupings that signal relationship and importance.`,
        elevation: `**Elevation** — ${design.elevation.length} shadow level(s) create a depth axis; elevated elements read as active or interactive.`,
        motion: `**Motion** — ${design.motion.durations_ms.length} animation duration(s) direct attention through temporal priority.`,
      };
      return hierarchyEv[m] ?? `**${m}**`;
    }).filter(Boolean),
    "",
    "### Accessibility",
    `${accessibilityContext[philosophy.accessibility_grade] ?? philosophy.accessibility_grade}`,
    (philosophy.accessibility_grade === "none" || philosophy.accessibility_grade === "A")
      ? "\nUsers relying on screen readers, keyboard navigation, or motor-input assistive technology will encounter real barriers. This is both an ethical concern and, in many jurisdictions, a legal one."
      : ""
  );

  return lines.filter(l => l !== undefined).join("\n");
}

// ── Visual language synthesis ─────────────────────────────────────────────────
// Answers: what does this design COMMUNICATE? Grounded in actual schema values —
// image role distribution, color character, type choices, structure, media presence.

type ContentSection = {
  site_purpose: string;
  headings: string[];
  images: Array<{ src: string; alt: string; role: string; is_gif: boolean; pages_present: string[] }>;
  background_images: string[];
  media: Array<{ type: string; src: string }>;
  favicon: { url: string; format: string; is_default: boolean } | null;
};

function inferDomain(purpose: string): string {
  const p = purpose.toLowerCase();
  if (/\b(?:security|endpoint|compliance|threat|vulnerability|siem|soc|xdr|edr|mdm|identity|sso|iam)\b/.test(p)) return "security/IT";
  if (/\b(?:shop|buy|cart|store|checkout|ecommerce|e-commerce)\b/.test(p)) return "e-commerce";
  if (/\b(?:portfolio|creative|designer|photographer|filmmaker|artist|writer|author)\b/.test(p)) return "creative-portfolio";
  if (/\b(?:saas|platform|software|dashboard|analytics|crm|erp)\b/.test(p)) return "b2b-saas";
  if (/\b(?:agency|studio|consulting|services|solutions)\b/.test(p)) return "agency/services";
  if (/\b(?:blog|magazine|editorial|journal|publication|news|media)\b/.test(p)) return "editorial/media";
  return "";
}

function colorCharacter(colors: Array<{ value: string }>): { warm: number; cool: number; neutral: number; saturated: number } {
  let warm = 0, cool = 0, neutral = 0, saturated = 0;
  for (const c of colors) {
    const hex = c.value.replace("#", "");
    if (hex.length !== 6) continue;
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d < 0.08) { neutral++; continue; }
    saturated++;
    const h = (max === r ? ((g - b) / d + 6) % 6
             : max === g ? (b - r) / d + 2
             : (r - g) / d + 4) * 60;
    if (h < 75 || h > 300) warm++;
    else if (h > 160 && h < 280) cool++;
  }
  return { warm, cool, neutral, saturated };
}

function interpretVisualLanguage(schema: ReconstructSchema, tier: Tier): string {
  if (tier === "succinct" || tier === "ai") return "";
  const content = (schema as any).content as ContentSection | undefined;
  if (!content) return "";

  const { design } = schema;
  const namedFamilies = design.typography.families.filter(f => !CSS_GENERICS.has(f.family));
  const lines: string[] = ["## What This Design Communicates"];

  // ── Core message ──────────────────────────────────────────────────────────
  if (content.site_purpose) {
    const domain = inferDomain(content.site_purpose);
    lines.push(`**Core message:** "${content.site_purpose}"${domain ? `  \nDomain: **${domain}**` : ""}`);
  }

  // ── Image strategy ─────────────────────────────────────────────────────────
  const imgs = content.images;
  if (imgs.length > 0) {
    const roleCount: Record<string, number> = {};
    for (const img of imgs) roleCount[img.role] = (roleCount[img.role] ?? 0) + 1;
    const sorted = Object.entries(roleCount).sort((a, b) => b[1] - a[1]);
    const topRole = sorted[0]?.[0] ?? "unknown";
    const topCount = sorted[0]?.[1] ?? 0;
    const gifCount = imgs.filter(i => i.is_gif).length;
    const hasFileBackgrounds = content.background_images.some(u => /\.(jpg|jpeg|png|webp|gif|svg)/i.test(u));

    const strategyMap: Record<string, string> = {
      "product":     `Product screenshots and UI captures dominate (${topCount} of ${imgs.length}). The primary visual argument is the product itself — show before tell.`,
      "hero":        `Hero images lead (${topCount} of ${imgs.length}). Emotional or contextual first impression before product detail.`,
      "portrait":    `Portrait photography leads (${topCount} of ${imgs.length}). Human presence is the primary visual weight — faces carry trust.`,
      "illustration":`Illustration is the dominant type (${topCount} of ${imgs.length}). Abstract or complex concepts are visualized rather than photographed.`,
      "icon":        `Icons dominate (${topCount} of ${imgs.length}) — a complex feature taxonomy communicated through symbol, not photography.`,
      "decoration":  `Decorative images lead (${topCount} of ${imgs.length}) — visual atmosphere over direct product communication.`,
      "unknown":     `${imgs.length} images across mixed or unclassified roles.`,
    };
    const secondary = sorted[1] ? ` Supported by ${sorted[1][1]} ${sorted[1][0]} image${sorted[1][1] > 1 ? "s" : ""}.` : "";
    lines.push(`**Image strategy:** ${strategyMap[topRole] ?? strategyMap["unknown"]}${secondary}`);
    if (gifCount > 0) lines.push(`  ${gifCount} animated GIF${gifCount > 1 ? "s" : ""} — motion used inline, outside CSS animation.`);
    if (!hasFileBackgrounds) lines.push(`  Background fills are CSS-only (gradients or flat color) — no photographic backgrounds.`);
  } else {
    lines.push(`**Image strategy:** No inline images detected. Visual identity relies on CSS-only treatments (color, gradient, type).`);
  }

  // ── Color as tone ─────────────────────────────────────────────────────────
  const char = colorCharacter(design.colors.palette);
  const domain = inferDomain(content.site_purpose ?? "");
  const dominant = char.warm >= char.cool && char.warm > char.neutral ? "warm"
    : char.cool > char.warm && char.cool > char.neutral ? "cool"
    : "neutral";

  let colorReading = "";
  if (dominant === "warm" && char.saturated > 0) {
    colorReading = `Warm, chromatic palette (${char.warm} warm vs ${char.cool} cool tokens in the ${design.colors.palette.length}-token set).`;
    if (domain === "security/IT") colorReading += ` Security and IT products most commonly use cool blues and grays for authority — warm palette is a less common chromatic approach in this category.`;
    else if (domain === "b2b-saas") colorReading += ` Warm tones create energy and approachability against the category's typical cool-neutral defaults.`;
  } else if (dominant === "cool" && char.saturated > 0) {
    colorReading = `Cool, chromatic palette (${char.cool} cool vs ${char.warm} warm tokens).`;
    if (domain === "security/IT" || domain === "b2b-saas") colorReading += ` Aligns with category convention — cool tones signal stability and precision.`;
  } else if (char.neutral > char.saturated * 1.5) {
    colorReading = `Neutral-dominant palette (${char.neutral} near-neutral vs ${char.saturated} chromatic tokens). Contrast and type carry hierarchy rather than hue.`;
  }
  if (colorReading) lines.push(`**Color tone:** ${colorReading}`);

  // ── Type as brand signal ───────────────────────────────────────────────────
  const typeSignals: string[] = [];
  for (const f of namedFamilies.slice(0, 3)) {
    const isMono = /mono|code|courier|consolas|jetbrains|fira|ibm plex/i.test(f.family);
    const isSerif = /serif|garamond|georgia|baskerville|cormorant|playfair|lora|merriweather/i.test(f.family) && !/sans/i.test(f.family);
    const isDisplay = /display|poster|clash|cabinet|satoshi|zodiak|editorial/i.test(f.family);
    if (isMono && f.role !== "mono") {
      typeSignals.push(`**${f.family}** (monospace in ${f.role} role) — positions as technical, precision-oriented, developer-adjacent`);
    } else if (isSerif) {
      typeSignals.push(`**${f.family}** (serif, ${f.role}) — signals editorial authority or traditional craft`);
    } else if (isDisplay) {
      typeSignals.push(`**${f.family}** (display, ${f.role}) — signals brand distinctiveness`);
    } else if (f.source === "self-hosted") {
      typeSignals.push(`**${f.family}** (${f.role}, self-hosted) — paid or proprietary license; type treated as a brand asset, not a utility choice`);
    }
  }
  if (typeSignals.length > 0) lines.push(`**Type as brand:** ${typeSignals.join("; ")}.`);

  // ── Media investment ───────────────────────────────────────────────────────
  if (content.media.length > 0) {
    const videos = content.media.filter(m => m.type === "video" || m.type === "embedded-video").length;
    const audio = content.media.filter(m => m.type === "audio").length;
    const parts = [
      videos > 0 ? `${videos} video${videos > 1 ? "s" : ""}` : "",
      audio > 0 ? `${audio} audio` : "",
    ].filter(Boolean).join(", ");
    lines.push(`**Media investment:** ${parts} alongside ${imgs.length} images. Video presence signals investment in product narrative, demos, or storytelling beyond static documentation.`);
  }

  // ── Structural confidence ─────────────────────────────────────────────────
  const maxType = design.typography.scale.length > 0 ? Math.max(...design.typography.scale) : 0;
  const spacingMax = design.spacing.scale.length > 0 ? Math.max(...design.spacing.scale) : 0;
  const structParts: string[] = [];
  if (maxType >= 64) structParts.push(`${maxType}px type ceiling — type at this scale functions as graphic architecture, not just a text label`);
  if (spacingMax >= 80) structParts.push(`${spacingMax}px maximum spacing value — generous vertical rhythm between sections`);
  if (design.grid.max_width_px && design.grid.max_width_px >= 1200) structParts.push(`${design.grid.max_width_px}px content max-width — wide enough for feature-dense marketing layouts`);
  if (structParts.length > 0) lines.push(`**Structure:** ${structParts.join("; ")}.`);

  return lines.join("\n\n");
}

// ── Content section ───────────────────────────────────────────────────────────

function interpretContent(schema: ReconstructSchema, tier: Tier): string {
  const content = (schema as any).content as {
    site_purpose: string;
    headings: string[];
    images: Array<{ src: string; alt: string; role: string; is_gif: boolean; pages_present: string[] }>;
    background_images: string[];
    media: Array<{ type: string; src: string; pages_present: string[] }>;
    favicon: { url: string; format: string; is_default: boolean } | null;
  } | undefined;

  if (!content) return "";

  if (tier === "ai") {
    return `## Content\n\`\`\`json\n${JSON.stringify(content, null, 2)}\n\`\`\``;
  }

  const lines: string[] = ["## Content & Visual Assets"];

  // Site purpose
  if (content.site_purpose) {
    lines.push(`**Site purpose:** ${content.site_purpose}`);
  }

  // Favicon
  if (content.favicon) {
    const fav = content.favicon;
    if (fav.is_default) {
      lines.push(`**Favicon:** \`${fav.url}\` — framework default placeholder, no custom brand icon set.`);
    } else {
      lines.push(`**Favicon:** \`${fav.url}\` (${fav.format.toUpperCase()}) — custom brand icon present.`);
    }
  } else {
    lines.push(`**Favicon:** none detected.`);
  }

  // Images
  const imgs = content.images;
  if (imgs.length > 0) {
    const roleCount: Record<string, number> = {};
    for (const img of imgs) roleCount[img.role] = (roleCount[img.role] ?? 0) + 1;
    const gifCount = imgs.filter(i => i.is_gif).length;
    const roleSummary = Object.entries(roleCount)
      .sort((a, b) => b[1] - a[1])
      .map(([role, n]) => `${n} ${role}`)
      .join(", ");
    lines.push(
      `**Images:** ${imgs.length} found — ${roleSummary}` +
      (gifCount > 0 ? ` (${gifCount} animated GIF${gifCount > 1 ? "s" : ""})` : "") + "."
    );
    const noAlt = imgs.filter(i => !i.alt).length;
    const altGapRatio = imgs.length > 0 ? noAlt / imgs.length : 0;
    if (noAlt > 0) {
      const flagStr = altGapRatio > 0.25
        ? ` **⚠ accessibility gap** — ${Math.round(altGapRatio * 100)}% of images are missing alt text.`
        : ` (${noAlt} missing alt text)`;
      lines.push(`  ${flagStr}`);
    }
    if (tier !== "succinct") {
      const heroes = imgs.filter(i => i.role === "hero");
      if (heroes.length > 0) {
        const decodeAmp = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
        const heroNames = heroes.slice(0, 8).map(h => decodeAmp(h.src.split("/").pop() ?? h.src));
        const more = heroes.length > 8 ? ` (+${heroes.length - 8} more)` : "";
        lines.push(`  Hero image(s): ${heroNames.join(", ")}${more}.`);
      }
    }
  } else {
    lines.push(`**Images:** none detected in HTML (background-image via CSS: ${content.background_images.length > 0 ? content.background_images.length + " found" : "none"}).`);
  }

  // Background images — separate CSS gradient backgrounds from file images
  if (content.background_images.length > 0 && tier !== "succinct") {
    const decodeAmp = (s: string) => s.replace(/&amp;/g, "&");
    const bgFiles = content.background_images.filter(u => !u.startsWith("data:"));
    const sample = bgFiles.slice(0, 3).map(u => decodeAmp(u.split("/").pop() ?? u));
    const more = bgFiles.length > 3 ? `…` : "";
    lines.push(`**CSS background-images:** ${bgFiles.length} file-based — ${sample.join(", ")}${more}.`);
  }

  // Media
  if (content.media.length > 0) {
    const videos = content.media.filter(m => m.type === "video").length;
    const audio = content.media.filter(m => m.type === "audio").length;
    const embedded = content.media.filter(m => m.type === "embedded-video").length;
    const parts = [
      videos > 0 ? `${videos} video${videos > 1 ? "s" : ""}` : "",
      audio > 0 ? `${audio} audio` : "",
      embedded > 0 ? `${embedded} embedded video${embedded > 1 ? "s" : ""} (YouTube/Vimeo)` : "",
    ].filter(Boolean);
    lines.push(`**Media:** ${parts.join(", ")}.`);
  } else {
    lines.push(`**Media:** no video or audio detected.`);
  }

  // Sub-brand / content cluster signals
  const subBrands = (content as any).sub_brand_signals as string[] | undefined;
  if (subBrands && subBrands.length > 0 && tier !== "succinct") {
    lines.push(
      `**Content clusters detected:** \`${subBrands.join("`, `")}\`` +
      ` — repeated path segments in image URLs suggesting product lines, campaigns, or editorial sections.`
    );
  }

  // Headings sample
  if (content.headings.length > 0 && tier !== "succinct") {
    const sample = content.headings.slice(0, 5);
    lines.push(`**Page headings (sample):**`);
    for (const h of sample) lines.push(`  - "${h}"`);
  }

  return lines.join("\n");
}

// ── Understanding section ─────────────────────────────────────────────────────
// Visual idioms, CSS component system, behavioral capabilities.
// Every string is constructed from the actual data fields — no lookup tables.

function interpretUnderstanding(schema: ReconstructSchema, tier: Tier): string {
  const u = schema.understanding;
  if (!u) return "";

  const { visual_patterns, component_definitions, behavior_patterns } = u;
  if (!visual_patterns.length && !component_definitions.length && !behavior_patterns.length) return "";

  if (tier === "ai") return `## Understanding\n\`\`\`json\n${JSON.stringify(u, null, 2)}\n\`\`\``;

  const lines: string[] = ["## How It Works — Patterns & Capabilities"];

  // ── Visual CSS idioms ──────────────────────────────────────────────────────
  if (visual_patterns.length > 0) {
    if (tier === "succinct") {
      lines.push(`**Visual idioms (${visual_patterns.length}):** ${visual_patterns.map(p => p.label).join(", ")}`);
    } else {
      lines.push("", "### Visual CSS Idioms");
      const byConf = {
        definite: visual_patterns.filter(p => p.confidence === "definite"),
        strong:   visual_patterns.filter(p => p.confidence === "strong"),
        possible: visual_patterns.filter(p => p.confidence === "possible"),
      };
      for (const p of [...byConf.definite, ...byConf.strong, ...byConf.possible]) {
        const confTag = p.confidence !== "definite" ? ` _(${p.confidence})_` : "";
        const ev = p.evidence.join(" · ");
        const sel = p.selectors.length > 0 ? ` — \`${p.selectors.slice(0, 2).join("`, `")}\`` : "";
        lines.push(`- **${p.label}**${confTag}: ${ev}${sel}`);
      }
      if (tier === "newbie") {
        const total = visual_patterns.length;
        const defCount = byConf.definite.length;
        lines.push(
          "",
          defCount === total
            ? `All ${total} pattern${total > 1 ? "s" : ""} confirmed — each CSS property combination is unambiguous.`
            : byConf.possible.length > total / 2
            ? `${byConf.possible.length} of ${total} patterns are possible-confidence — the evidence is partial, likely due to minified or unconventionally structured CSS.`
            : `${defCount} confirmed · ${byConf.strong.length} strong · ${byConf.possible.length} possible.`
        );
      }
    }
  }

  // ── CSS component system ───────────────────────────────────────────────────
  if (tier !== "succinct" && component_definitions.length > 0) {
    const interactive = component_definitions.filter(c => c.is_interactive);
    const limit = tier === "professional" ? 10 : 15;
    const top = component_definitions.slice(0, limit);
    lines.push("", "### CSS Component System");
    lines.push(
      `${component_definitions.length} components from CSS selector analysis` +
      (interactive.length > 0 ? `, ${interactive.length} interactive` : "") + `:`
    );
    for (const c of top) {
      const parts: string[] = [];
      if (c.variants.length > 0) parts.push(`variants: ${c.variants.slice(0, 3).join(", ")}${c.variants.length > 3 ? "…" : ""}`);
      if (c.states.length > 0) parts.push(`states: ${c.states.join("/")}`);
      if (c.sub_elements.length > 0) parts.push(`sub: ${c.sub_elements.slice(0, 3).join(", ")}`);
      const meta = parts.length > 0 ? ` _(${parts.join("; ")})_` : "";
      lines.push(`- **${c.name}**${meta} · \`${c.selector_root}\` · ${c.selector_count} rules`);
    }
    if (tier === "newbie") {
      const totalRules = component_definitions.reduce((s, c) => s + c.selector_count, 0);
      const avgVariants = Math.round(
        component_definitions.reduce((s, c) => s + c.variants.length, 0) / component_definitions.length * 10
      ) / 10;
      const avgStates = Math.round(
        component_definitions.reduce((s, c) => s + c.states.length, 0) / component_definitions.length * 10
      ) / 10;
      lines.push(
        "",
        `${totalRules} CSS rules across ${component_definitions.length} components — ` +
        `avg ${avgVariants} variant${avgVariants !== 1 ? "s" : ""} and ${avgStates} state${avgStates !== 1 ? "s" : ""} each. ` +
        `${interactive.length} expose hover/focus/active states; ${component_definitions.length - interactive.length} are purely structural.`
      );
    }
  }

  // ── Behavioral capabilities ────────────────────────────────────────────────
  if (behavior_patterns.length > 0) {
    const definite = behavior_patterns.filter(p => p.confidence === "definite");
    const strong   = behavior_patterns.filter(p => p.confidence === "strong");
    const possible = behavior_patterns.filter(p => p.confidence === "possible");

    if (tier === "succinct") {
      lines.push(`**Capabilities (${behavior_patterns.length}):** ${definite.map(p => p.pattern).join(", ")}`);
    } else {
      lines.push("", "### Behavioral Capabilities");
      // Each entry: pattern name + its actual evidence strings + elements — evidence IS the explanation
      for (const b of behavior_patterns) {
        const confTag = b.confidence !== "definite" ? ` _(${b.confidence})_` : "";
        const ev = b.evidence.join(", ");
        const els = b.elements.length > 0 ? ` · elements: ${b.elements.slice(0, 3).join(", ")}` : "";
        lines.push(`- **${b.pattern}**${confTag}: ${ev}${els}`);
      }
      if (tier === "newbie") {
        // Source breakdown — counts derived from the evidence strings themselves
        const fromAria    = behavior_patterns.filter(b => b.evidence.some(e => e.startsWith("ARIA")));
        const fromHtml    = behavior_patterns.filter(b => b.evidence.some(e => e.startsWith("<")));
        const fromScripts = behavior_patterns.filter(b => b.evidence.some(e => /API|library|listener|init/.test(e)));
        const fromData    = behavior_patterns.filter(b => b.evidence.some(e => e.startsWith("data-")));
        const sourceParts = [
          fromAria.length    > 0 ? `${fromAria.length} from ARIA roles`            : "",
          fromHtml.length    > 0 ? `${fromHtml.length} from HTML5 elements`        : "",
          fromData.length    > 0 ? `${fromData.length} from data-* attributes`     : "",
          fromScripts.length > 0 ? `${fromScripts.length} from script/API patterns` : "",
        ].filter(Boolean);
        lines.push(
          "",
          `${definite.length} confirmed · ${strong.length} strong · ${possible.length} possible.` +
          (sourceParts.length > 0 ? ` Sources: ${sourceParts.join(", ")}.` : ""),
          `_Inferred from static HTML — JavaScript was not executed._`
        );
      }
    }
  }

  return lines.filter(Boolean).join("\n");
}

// ── Main builder ───────────────────────────────────────────────────────────────

export function buildExplanation(schema: ReconstructSchema, tier: string, focus: string): string {
  const t = tier as Tier;

  if (t === "ai") {
    const aiOutput: Record<string, unknown> = { url: schema.meta.url, confidence: schema.meta.confidence };
    if (focus === "all" || focus === "tech") aiOutput.technology = schema.technology;
    if (focus === "all" || focus === "design") aiOutput.design = schema.design;
    if (focus === "all" || focus === "interactions") aiOutput.interactions = schema.interactions;
    if (focus === "all" || focus === "philosophy") aiOutput.philosophy = schema.philosophy;
    if (focus === "all") aiOutput.content = (schema as any).content;
    aiOutput.standouts = findStandouts(schema);
    return `\`\`\`json\n${JSON.stringify(aiOutput, null, 2)}\n\`\`\``;
  }

  const tierLabel: Record<string, string> = {
    newbie: "Full explanation — designer and developer perspectives",
    professional: "Professional read — evidence-grounded, notable decisions",
    succinct: "Critical facts",
  };

  const header = [
    `# ${schema.meta.url}`,
    `_${tierLabel[t] ?? t}_`,
    `Confidence: ${Math.round(schema.meta.confidence * 100)}% · ${schema.meta.coverage.urls_crawled} page(s) analyzed`,
  ].join("\n");

  const sections: string[] = [header];

  if (focus === "all" && t !== "succinct") {
    sections.push(`## Overview\n\n${synthesizeSite(schema)}`);
  }

  const standouts = findStandouts(schema);
  if (standouts.length > 0 && focus === "all") {
    if (t === "succinct") {
      sections.push(`**Notable:** ${standouts[0]}`);
    } else {
      sections.push(
        [
          "## What's Unusual",
          t === "newbie"
            ? "_Signals that stand out — unconventional choices, evidence of specific intent_"
            : "_Unconventional or especially notable signals_",
          ...standouts.map(s => `- ${s}`),
        ].join("\n")
      );
    }
  }

  if (focus === "all" || focus === "tech") sections.push(interpretTech(schema, t));
  if (focus === "all" || focus === "design") sections.push(interpretDesign(schema, t));
  if (focus === "all" || focus === "interactions") sections.push(interpretInteractions(schema, t));
  if (focus === "all") {
    const understandingSection = interpretUnderstanding(schema, t);
    if (understandingSection) sections.push(understandingSection);
  }
  if (focus === "all" || focus === "philosophy") sections.push(interpretPhilosophy(schema, t));
  if (focus === "all") {
    const visualLang = interpretVisualLanguage(schema, t);
    if (visualLang) sections.push(visualLang);
    const contentSection = interpretContent(schema, t);
    if (contentSection) sections.push(contentSection);
  }

  return sections.join("\n\n---\n\n");
}
