// reconstruct_explain — tier-aware, signal-grounded site explanation
// Tiers: newbie (detailed + why, both lenses) | professional (notable decisions) | succinct (critical facts) | ai (JSON)
// Dynamic: derives meaning from token combinations, flags unconventional signals

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../schema/config.js";
import { readCache } from "../cache/store.js";
import type { ReconstructSchema } from "../schema/types.js";

type Tier = "newbie" | "professional" | "succinct" | "ai";

// ── KB key normalization ───────────────────────────────────────────────────────
// tech.ts stores framework names lowercase; KB keys use display casing.

function normalizeFwKey(fw: string): string {
  const aliases: Record<string, string> = {
    "next.js": "Next.js", nuxt: "Nuxt", sveltekit: "SvelteKit",
    astro: "Astro", remix: "Remix", gatsby: "Gatsby",
    react: "React", vue: "Vue", angular: "Angular", htmx: "HTMX",
  };
  return aliases[fw.toLowerCase()] ?? fw;
}

function normalizeStylingKey(s: string): string {
  if (s === "sass/scss") return "scss";
  return s;
}

export function registerExplainTool(server: McpServer): void {
  server.tool(
    "reconstruct_explain",
    "Explain a website's design choices, tech stack, and philosophy at a specified depth tier. All tiers convey critical information — the tier governs how it's framed and how much 'why' is included. Produces dynamic, signal-grounded interpretations rather than just listing values. Requires reconstruct_analyze first.",
    {
      url: z.string().url().describe("Website URL (must be analyzed first)"),
      tier: z
        .enum(["newbie", "professional", "succinct", "ai"])
        .default("professional")
        .describe(
          "newbie = very detailed with WHY, designer + developer perspectives | " +
          "professional = assumes knowledge, focuses on notable decisions and what they signal | " +
          "succinct = condensed but complete, critical facts only | " +
          "ai = structured JSON for machine consumption"
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
          content: [
            {
              type: "text",
              text: `No analysis found for ${url}. Run reconstruct_analyze("${url}") first.`,
            },
          ],
          isError: true,
        };
      }

      const output = buildExplanation(schema, tier, focus);
      return { content: [{ type: "text", text: output }] };
    }
  );
}

// ── Knowledge base — meaning over enumeration ─────────────────────────────────
// Not hardcoded output. These are semantic annotations the interpreter draws from.

const FRAMEWORK_KB: Record<
  string,
  { role: string; implies: string; dev_note: string; tradeoff: string }
> = {
  "Next.js": {
    role: "React framework that adds SSR, file-based routing, and API routes",
    implies:
      "The team wanted React's component ecosystem plus server control. Standard for content-heavy products that need SEO without sacrificing interactivity. Strongly implies a JavaScript-first team and likely Vercel deployment.",
    dev_note:
      "Check for ISR vs full SSR per-route. If Next 13+, RSC may replace getServerSideProps. Absence of state management may mean server components handle data without client stores.",
    tradeoff:
      "Ties you to Node.js on the server. Cold starts on serverless. The App Router (Next 13+) split the community — check which router is in use.",
  },
  "Nuxt": {
    role: "Vue's full-stack framework — routing, SSR, and server layer built in",
    implies:
      "A Vue-first team that outgrew a plain SPA. Common in European product companies, agencies, and Laravel shops moving to the frontend. Often chosen over Next.js when JSX is a barrier.",
    dev_note:
      "Nuxt 3 with Nitro server layer if hybrid/ISR detected. useServerData and auto-imports are core patterns. Composition API with setup() is standard.",
    tradeoff: "Smaller ecosystem than React. Vue's reactivity model is elegant but has edge cases with reactive destructuring.",
  },
  "SvelteKit": {
    role: "Svelte's application framework — compiles to vanilla JS, zero runtime overhead",
    implies:
      "Raw performance was a priority. No virtual DOM — components compile away. Usually chosen by performance-conscious teams or those who found React/Vue too abstract for their needs.",
    dev_note:
      "No hydration overhead. SvelteKit handles routing and transitions natively. Bundle sizes are notably smaller than React equivalents for the same UI complexity.",
    tradeoff: "Smaller talent pool. Svelte's compiler magic can surprise contributors unfamiliar with it. Fewer mature libraries.",
  },
  "Astro": {
    role: "Content-first framework — zero JS by default, Islands Architecture for interactivity",
    implies:
      "The site is primarily content: marketing, docs, blog, or landing pages. A deliberate choice to ship no JavaScript unless a specific component needs it. Strong performance statement.",
    dev_note:
      "Partial hydration via client:load / client:idle / client:visible directives. Each interactive island hydrates independently. Can embed React, Vue, Svelte components together.",
    tradeoff:
      "Not suitable for highly interactive applications. Build times can be slow for large content sets.",
  },
  "Remix": {
    role: "React framework built around web primitives — forms, URLs, HTTP caching",
    implies:
      "Progressive enhancement is a design principle: forms work without JS, data is co-located with routes via loaders/actions. Produces resilient UIs but requires a persistent server (not purely serverless).",
    dev_note:
      "Loader/action model replaces API routes + data fetching hooks. Nested routing enables layout composition. HTTP cache headers from loaders are first-class.",
    tradeoff: "Less flexible deployment than Next.js. Stronger opinions on data flow.",
  },
  "Gatsby": {
    role: "React static site generator with a GraphQL data layer",
    implies:
      "Content-heavy, SEO-critical. Pre-generates all pages at build time. Common in marketing sites, blogs, documentation. Popularity peaked around 2020 — newer projects often choose Astro instead.",
    dev_note:
      "GraphQL for data including local files. Gatsby Image for optimized images. Plugin ecosystem handles most integrations. Long build times on large sites.",
    tradeoff: "Heavy build process. Incremental builds are complex to configure. The move away from Gatsby toward Astro is ongoing.",
  },
  "React": {
    role: "UI library without built-in routing, SSR, or data fetching — architecture is custom",
    implies:
      "A mature team building their own architecture on React. More flexible than a full framework, but more decisions deferred to the team. Often found in SPAs where SEO isn't critical or in products with existing backend infrastructure.",
    dev_note:
      "Custom routing (React Router / TanStack Router). Client-side data fetching patterns likely (React Query, SWR, or custom hooks). No SSR unless explicitly added.",
    tradeoff: "Higher upfront architectural cost. Easier to accumulate inconsistency without framework guardrails.",
  },
  "Vue": {
    role: "Progressive JavaScript framework — component-based, template-syntax-first",
    implies:
      "Teams who prefer Vue's template syntax over JSX, or who need to embed interactive components into existing HTML. Very common in agencies, CMS-driven projects, and non-SPA products. Often an easier entry point than React for backend developers.",
    dev_note:
      "Composition API with setup() is modern standard. Vue Router + Pinia for routing/state. Vite is the standard build tool for Vue 3.",
    tradeoff: "Smaller ecosystem than React. Enterprise adoption significantly lower.",
  },
  "Angular": {
    role: "Full opinionated framework — DI, routing, forms, HTTP client, TypeScript all built in",
    implies:
      "Enterprise context, long maintenance horizon, or strong preference for convention over configuration. TypeScript is non-optional. Prescriptive architecture reduces debates but increases ceremony.",
    dev_note:
      "Module or standalone component model. RxJS Observables for async data. HTTP interceptors for auth/logging. Angular CLI enforces structure.",
    tradeoff:
      "Steep learning curve for new developers. Verbose. Slower to iterate than React/Vue for small changes.",
  },
  "HTMX": {
    role: "HTML-over-the-wire — AJAX, WebSockets, and SSE as HTML attributes, no JS framework",
    implies:
      "A deliberate rejection of JavaScript complexity. Interactivity is server-rendered HTML fragments. Typically a backend-first team (Python/Go/Ruby/PHP) who wants dynamic UIs without a JS framework.",
    dev_note:
      "Server returns HTML partials, not JSON. Browser history via hx-push-url. Works with any backend. No client-side state management needed.",
    tradeoff:
      "Interactivity ceiling lower than JS frameworks. Complex client-side state (optimistic UI, offline) is hard. Not suitable for app-like experiences.",
  },
};

const STYLING_KB: Record<
  string,
  { role: string; implies: string; tradeoff: string }
> = {
  tailwind: {
    role: "utility-first CSS — small atomic classes applied directly in markup",
    implies:
      "Design is enforced through constraints: the only spacings, colors, and type sizes available are what's defined in the config. This produces consistency and development speed but can push designs toward Tailwind's defaults rather than a genuinely custom system.",
    tradeoff:
      "Long class lists in HTML. Style is inseparable from markup. Theming requires config discipline. Teams without a design system can misuse the escape hatches (arbitrary values).",
  },
  "css-modules": {
    role: "scoped CSS files per component — no global class leakage",
    implies:
      "The team values style isolation. Styles travel with their component. Common in mature React teams that want structured CSS without runtime overhead or class collision risk.",
    tradeoff:
      "No global design tokens without extra setup (CSS custom properties). Composing responsive layouts is less ergonomic than Tailwind. Refactoring involves moving both file and import.",
  },
  "styled-components": {
    role: "CSS-in-JavaScript — styles co-located with component logic, reactive to props",
    implies:
      "Dynamic theming and prop-driven style variations are first-class. The ThemeProvider pattern means design tokens flow from a single JS source. Common in design-system-heavy teams.",
    tradeoff:
      "Runtime cost and larger bundles than static CSS. SSR requires additional setup. Migration away is painful. The ecosystem is moving toward zero-runtime alternatives.",
  },
  emotion: {
    role: "CSS-in-JS library with a flexible API — css prop, styled API, or keyframe helpers",
    implies:
      "Similar signal to styled-components — component-level dynamic styling. Often chosen for its css prop flexibility or as the underlying engine for MUI/Chakra UI.",
    tradeoff:
      "Same runtime/bundle tradeoffs as styled-components. Both are losing ground to zero-runtime CSS-in-JS (Linaria, vanilla-extract).",
  },
  scss: {
    role: "CSS superset — variables, nesting, and mixins before they existed natively",
    implies:
      "Likely an older codebase or a team with established SCSS conventions. Still fully capable but modern CSS has caught up on most SCSS features. Often indicates stability preference over modernity.",
    tradeoff:
      "Build step required. The variables/nesting that justified SCSS are now native CSS. May indicate technical debt or a deliberate conservative choice.",
  },
  "shadcn/ui": {
    role: "Radix UI primitives + Tailwind — component collection you own (copy, don't install)",
    implies:
      "Fast, accessible component system for B2B SaaS. Teams get correct ARIA behavior without the cost of a custom design system. The 'copy not install' model means full control over component code.",
    tradeoff:
      "Components need manual updates. Customizing beyond Tailwind's design language requires effort. Becoming a monoculture in B2B SaaS.",
  },
};

const FONT_KB: Record<string, { character: string; signal: string }> = {
  Inter: {
    character: "neutral neo-grotesque optimised for screen rendering",
    signal:
      "developer-facing or technically-minded product — Inter is the default choice of teams who value clarity and legibility over typographic personality",
  },
  "Geist": {
    character: "Vercel's custom typeface — clean, technical, modern",
    signal: "close alignment with Vercel's design language, or a deliberate signal of technical modernity",
  },
  "DM Sans": {
    character: "geometric humanist sans-serif with a professional warmth",
    signal: "modern trustworthiness — common in fintech, health tech, and 'serious but approachable' B2B products",
  },
  "Space Grotesk": {
    character: "geometric grotesque with quirky details and strong character",
    signal: "technical personality with a human edge — popular in developer tools and modern startups that want to stand out from Inter-everything",
  },
  "Söhne": {
    character: "premium geometric grotesque by Klim Type Foundry",
    signal: "deliberate investment in typography as brand — Söhne is expensive and not the default, which signals that type is a designed decision, not an afterthought",
  },
  "GT Walsheim": {
    character: "rounded geometric sans-serif with warmth",
    signal: "friendly, approachable brand — the rounded letterforms soften what might otherwise be a cold technical product",
  },
  "Playfair Display": {
    character: "high-contrast editorial serif with ink-trap details",
    signal: "editorial authority and cultural seriousness — common in media, luxury, fashion, and brands that want gravitas through historical type associations",
  },
  "Tiempos": {
    character: "contemporary text serif built for long-form reading",
    signal: "reading experience is a core product value — editorial or content-heavy product that treats typography as UX, not just aesthetics",
  },
  "Helvetica Neue": {
    character: "classic Swiss grotesque — neutral, authoritative, ubiquitous",
    signal: "established brand, heritage aesthetic, or a deliberate choice of convention over experimentation — 'neutral' is itself a statement",
  },
  "Clash Display": {
    character: "high-contrast variable display typeface with strong visual weight",
    signal: "type-led design — headlines are the hero, the typeface is carrying the design work that color and illustration would do elsewhere",
  },
};

const LIB_KB: Record<string, string> = {
  "framer-motion":
    "Spring-based animation — physicality and perceived responsiveness are design priorities. Motion is component-level and declarative, not CSS keyframes.",
  gsap: "Professional animation — meaningful animation budget. Scroll-triggered sequences, SVG morphing, or complex timeline choreography.",
  "three.js":
    "3D rendering in-browser — immersive hero, product showcase, or interactive 3D. Significant performance and complexity investment; not incidental.",
  "radix-ui":
    "Unstyled accessible primitives — custom design system built on correct ARIA semantics. Accessibility-first without sacrificing visual control.",
  "shadcn/ui":
    "Radix + Tailwind component collection — accessible, fast design system for B2B SaaS. Not a library, components live in the codebase.",
  "react-query":
    "Server state management — async data, caching, background refetching handled declaratively. Signals a data-heavy UI with real synchronisation requirements.",
  zustand:
    "Minimal global state — a deliberate step away from Redux complexity. Signals the team values simplicity in client state management.",
  redux:
    "Centralised state management — complex client-side state requirements, or a large team that needs strict unidirectional patterns.",
  lenis:
    "Custom smooth scroll — scroll experience is a design priority, likely paired with scroll-triggered animations or parallax.",
  stripe: "Payment processing — the site handles transactions, expect checkout flows and billing pages.",
};

// ── Standout signal detector ──────────────────────────────────────────────────
// Flags unconventional, contradictory, or exceptionally notable combinations.
// Only flags things that are genuinely observable in the schema — no hallucination.

function findStandouts(schema: ReconstructSchema): string[] {
  const notes: string[] = [];
  const { design, technology, philosophy } = schema;

  // Philosophy vs token contradictions
  if (philosophy.design_school.includes("minimalism") && design.colors.palette.length > 8) {
    notes.push(
      `Minimalism classification but ${design.colors.palette.length} color tokens — the minimalism may be spatial (layout restraint), not chromatic (color restraint). These are different things.`
    );
  }

  if (philosophy.personality.includes("playful") && design.motion.durations_ms.length === 0) {
    notes.push(
      `'Playful' personality with no detected animations — the energy is visual (color, shape, illustration) rather than kinetic. The personality is signalled through form, not motion.`
    );
  }

  if (philosophy.density === "dense" && design.spacing.base_unit >= 8) {
    notes.push(
      `Dense layout despite a ${design.spacing.base_unit}px base unit — the density comes from content volume and information architecture, not compressed spacing tokens.`
    );
  }

  // Exceptional type scale
  const maxType = design.typography.scale.length > 0 ? Math.max(...design.typography.scale) : 0;
  if (maxType >= 80) {
    notes.push(
      `Type scale reaches ${maxType}px — type IS the design. Either a display-heavy brand statement where headlines carry the visual weight, or an editorial site where reading at scale is the experience itself.`
    );
  }

  // Monospace body font
  const monoBody = design.typography.families.find(
    (f) => f.role === "body" && /mono|code|courier|consolas|jetbrains|fira|ibm plex mono/i.test(f.family)
  );
  if (monoBody) {
    notes.push(
      `Monospace font (${monoBody.family}) for body text — unconventional and intentional. Signals a developer-native or deliberately technical brand identity. Common in dev tools and coding-adjacent products.`
    );
  }

  // Absolute zero border radius
  if (design.border_radius.length > 0 && design.border_radius.every((r) => r === 0)) {
    notes.push(
      `Zero border radius throughout — every element is perfectly rectangular. A deliberate aesthetic statement: precision, formality, neo-brutalism, or utilitarian design that refuses decorative softening.`
    );
  }

  // Very large border radius (pill shapes)
  const maxRadius = design.border_radius.length > 0 ? Math.max(...design.border_radius) : 0;
  if (maxRadius >= 50) {
    notes.push(
      `Pill/fully-circular shapes (${maxRadius}px radius) — extreme rounding. Signals a deliberately approachable, friendly, consumer-facing brand language. Unusual in enterprise/technical products.`
    );
  }

  // Framer Motion with no CSS motion detected
  if (technology.detected_libs.includes("framer-motion") && design.motion.durations_ms.length === 0) {
    notes.push(
      `Framer Motion present but no CSS transition durations detected — animations are spring-physics-based (JS), not CSS transitions. The motion system is invisible to static CSS analysis.`
    );
  }

  // 3D or heavy animation libraries
  if (technology.detected_libs.includes("three.js")) {
    notes.push(
      `Three.js detected — 3D in the browser. This is a deliberate experience investment, not incidental. Expect immersive hero sections or interactive 3D product visualisation.`
    );
  }
  if (technology.detected_libs.includes("gsap")) {
    notes.push(
      `GSAP detected — professional animation budget. Scroll-triggered sequences, SVG morphing, or complex timeline choreography are likely features, not embellishments.`
    );
  }

  // Poor a11y despite capable framework
  if (
    (philosophy.accessibility_grade === "none" || philosophy.accessibility_grade === "unknown") &&
    ["Next.js", "Nuxt", "Astro", "Remix", "SvelteKit"].includes(technology.framework)
  ) {
    notes.push(
      `No detected accessibility grade despite using ${technology.framework}, which has good a11y tooling available. The infrastructure supports it; the investment hasn't been made.`
    );
  }

  // Hardcoded dark theme vs responsive dark mode
  if (!design.colors.dark_mode && philosophy.design_school.includes("dark-mode-first")) {
    notes.push(
      `Classified as dark-mode-first school but no CSS prefers-color-scheme detected — this may be a hardcoded dark theme rather than a system-responsive one. Users can't toggle.`
    );
  }

  // Zero framework fingerprint
  if (technology.framework === "unknown" && technology.detected_libs.length === 0) {
    notes.push(
      `No framework or library fingerprints — either hand-coded HTML/CSS/JS, a framework that obfuscates itself (some Astro/Eleventy builds do), or an exceptionally lean stack. Rare and deliberate if intentional.`
    );
  }

  // Very few colors carrying full hierarchy
  if (design.colors.strategy === "monochrome" && design.colors.palette.length < 3) {
    notes.push(
      `Monochrome with only ${design.colors.palette.length} color token(s) — extreme chromatic restraint. Typography scale, spacing, and weight carry all visual hierarchy. Every design decision costs more when color isn't available.`
    );
  }

  // Large motion library presence but no scroll behaviors
  if (
    technology.detected_libs.some((l) => ["lenis", "locomotive-scroll"].includes(l)) &&
    schema.interactions.scroll_behaviors.length === 0
  ) {
    notes.push(
      `Smooth scroll library detected but no CSS-observable scroll behaviors — effects are JS-driven, likely invisible to static CSS analysis.`
    );
  }

  return notes;
}

// ── Core interpretation functions ─────────────────────────────────────────────
// Each produces a self-contained section string based on tier.

function interpretTech(schema: ReconstructSchema, tier: Tier): string {
  const { technology } = schema;

  if (tier === "ai") {
    return `## Technology\n\`\`\`json\n${JSON.stringify(technology, null, 2)}\n\`\`\``;
  }

  const fw = FRAMEWORK_KB[normalizeFwKey(technology.framework)];
  const stylingEntries = technology.styling
    .map((s) => ({ key: s, ...STYLING_KB[normalizeStylingKey(s)] }))
    .filter((e) => e.role);
  const libs = technology.detected_libs
    .map((l) => ({ name: l, note: LIB_KB[l] }))
    .filter((l) => l.note);

  if (tier === "succinct") {
    return [
      "## Tech Stack",
      `**Framework:** ${technology.framework} (${technology.rendering})${technology.meta_framework ? ` via ${technology.meta_framework}` : ""}`,
      `**Styling:** ${technology.styling.join(" + ")}`,
      technology.state.length ? `**State:** ${technology.state.join(", ")}` : "",
      libs.length ? `**Notable libs:** ${libs.map((l) => l.name).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (tier === "professional") {
    const lines = [
      "## Technology",
      `\`${technology.framework}\` · \`${technology.rendering}\` · ${technology.styling.join(" + ")}`,
      "",
    ];

    if (fw) {
      lines.push(fw.implies);
      lines.push(`_Tradeoff:_ ${fw.tradeoff}`);
    }

    if (stylingEntries.length) {
      lines.push("");
      for (const e of stylingEntries) {
        lines.push(`**${e.key}:** ${e.implies}`);
        lines.push(`_Tradeoff:_ ${e.tradeoff}`);
      }
    }

    if (libs.length) {
      lines.push("");
      lines.push("**Library signals:**");
      for (const l of libs) lines.push(`- **${l.name}:** ${l.note}`);
    }

    if (technology.state.length) {
      lines.push(`\n**State management (${technology.state.join(", ")}):** client-side state is present — UI complexity exceeds server-rendered content.`);
    }

    if (fw?.dev_note) {
      lines.push(`\n**Dev notes:** ${fw.dev_note}`);
    }

    return lines.filter((l) => l !== undefined).join("\n");
  }

  // Newbie — full narrative with both perspectives
  const lines = ["## How This Site is Built"];

  if (fw) {
    lines.push(
      `**${technology.framework}** is ${fw.role}.`,
      "",
      `**Why this choice matters:** ${fw.implies}`,
      "",
      `**What you'd notice as a developer:** ${fw.dev_note}`,
      `**What you'd notice as a designer:** The framework choice affects how design tokens are managed. ${
        technology.styling.includes("tailwind")
          ? "Tailwind means your design system lives in a config file — spacing, colors, and type are locked to a grid."
          : technology.styling.some((s) => ["styled-components", "emotion"].includes(s))
          ? "CSS-in-JS means styles live next to component logic — designers and developers share one file per component."
          : technology.styling.includes("css-modules")
          ? "CSS Modules means each component has its own scoped stylesheet — easy to reason about in isolation."
          : "The styling approach shapes how design changes propagate."
      }`,
      "",
      `**Tradeoff they accepted:** ${fw.tradeoff}`
    );
  } else if (technology.framework !== "unknown") {
    // Not in KB — derive what we can from the signals we actually have
    const stylingDesc = technology.styling.filter((s) => s !== "unknown").join(" + ") || "custom CSS";
    const libsNote = technology.detected_libs.length > 0
      ? ` Libraries present: ${technology.detected_libs.slice(0, 4).join(", ")}.`
      : "";
    const stateNote = technology.state.length > 0
      ? ` State management: ${technology.state.join(", ")} — client-side complexity is present.`
      : "";
    lines.push(
      `Built with **${technology.framework}**. Styling: ${stylingDesc}.${libsNote}${stateNote}`,
      `Rendering: ${technology.rendering}. No detailed profile for this framework — characteristics above are derived from the detected signals.`
    );
  } else {
    lines.push(
      "The framework couldn't be fingerprinted. This might be a hand-coded site, a framework that obfuscates its identity, or an unusually lean stack."
    );
  }

  lines.push("", `**How content reaches your browser (${technology.rendering}):**`);
  const renderingMap: Record<string, string> = {
    ssr:  "Pages are assembled on the server before they reach you. Fast first loads, good for search engines, and content is visible even if JavaScript fails. The server does work on every request.",
    ssg:  "All pages were pre-built at deploy time, not on each request. This is the fastest possible delivery method but content can only change when the site rebuilds and redeploys.",
    csr:  "The page arrives mostly empty; JavaScript builds the UI in your browser. First load is slower but the app feels instant after that. Search engines may struggle with this approach.",
    isr:  "A hybrid: pages are pre-built but regenerate automatically after a time window. You get static speeds with the ability to update content without a full rebuild.",
    hybrid: "Different pages use different strategies — some pre-built for speed, some server-rendered for freshness, depending on what each page contains.",
    unknown: "The rendering strategy couldn't be determined from the HTML. It may use a custom approach or a mix.",
  };
  lines.push(renderingMap[technology.rendering] ?? technology.rendering);

  if (stylingEntries.length) {
    lines.push("", "**How visual design is managed:**");
    for (const e of stylingEntries) {
      lines.push(`**${e.key}:** ${e.role}. ${e.implies}`, `_Tradeoff:_ ${e.tradeoff}`, "");
    }
  }

  if (libs.length) {
    lines.push("**Libraries that shape the experience:**");
    for (const l of libs) lines.push(`- **${l.name}:** ${l.note}`);
  }

  if (technology.state.length) {
    lines.push(
      "",
      `**State management (${technology.state.join(", ")}):** This manages information that lives in the browser — which panel is open, what's in your cart, live search results — using a dedicated system rather than just asking the server. Its presence signals the UI has non-trivial interactivity.`
    );
  }

  return lines.join("\n");
}

function interpretDesign(schema: ReconstructSchema, tier: Tier): string {
  const { design } = schema;

  if (tier === "ai") {
    return `## Design\n\`\`\`json\n${JSON.stringify(design, null, 2)}\n\`\`\``;
  }

  // Font interpretation
  const fontReadings = design.typography.families.map((f) => {
    const known = FONT_KB[f.family] ?? FONT_KB[f.family.split(" ")[0]];
    if (known) return `**${f.family}** (${f.role}): ${known.character}. ${known.signal}.`;
    // Dynamic fallback — derive meaning from what we actually know about this font
    const isSerif = /serif/i.test(f.family);
    const isMono = /mono|code|courier|consolas|jetbrains|fira|ibm plex/i.test(f.family);
    const isRounded = /rounded|soft/i.test(f.family);
    const isVariable = f.weights.length > 4;
    const src = f.source === "google" ? "Google Fonts" : f.source === "self-hosted" ? "self-hosted (brand investment)" : f.source;
    const weightNote = f.weights.length > 2 ? `${f.weights.length} weights available — typographic hierarchy through weight is possible.` : "limited weights — hierarchy relies on size and spacing.";
    if (isMono) return `**${f.family}** (${f.role}, ${src}): monospace — technical, developer-native, or deliberately lo-fi brand identity. ${weightNote}`;
    if (isSerif) return `**${f.family}** (${f.role}, ${src}): serif — signals authority, editorial gravitas, or a brand investing in typographic character. ${isVariable ? "Variable-weight serif gives fine expressive control." : weightNote}`;
    if (isRounded) return `**${f.family}** (${f.role}, ${src}): rounded sans-serif — approachable, consumer-facing, softens what might otherwise read as cold or corporate. ${weightNote}`;
    if (f.source === "self-hosted") return `**${f.family}** (${f.role}, self-hosted): a paid or proprietary typeface — self-hosting signals deliberate type investment, not a default choice. ${weightNote}`;
    return `**${f.family}** (${f.role}, ${src}): ${isVariable ? "variable-weight" : ""} sans-serif. ${weightNote}`;
  });

  // Color system reading
  const colorRead = (() => {
    const count = design.colors.palette.length;
    const strategy = design.colors.strategy;
    const dark = design.colors.dark_mode;
    const top = design.colors.palette.slice(0, 5).map((c) => `\`${c.value}\``).join(" ");

    const strategyMeaning: Record<string, string> = {
      monochrome: "Single hue — all visual hierarchy comes from lightness/darkness and size. Maximum restraint, maximum demand on typography and spacing to carry weight.",
      analogous: "Adjacent hues — harmonious and cohesive, feels like a unified brand rather than a collection of decisions.",
      complementary: "Opposite hues — contrast-driven. Usually a dominant neutral + a single accent that makes calls-to-action unmissable.",
      triadic: "Three evenly-spaced hues — lively and balanced, but harder to maintain coherence at this scale.",
    };

    return `${count} color tokens · ${strategy} strategy · ${dark ? "dark mode supported" : "light mode only"}.\n${strategyMeaning[strategy] ?? "Color strategy could not be classified."}\nTop colors: ${top}`;
  })();

  // Spacing reading
  const spacingRead = (() => {
    const { base_unit, strategy } = design.spacing;
    const strategyMeaning: Record<string, string> = {
      "8px-grid": "Every spacing value is a multiple of 8px — the standard grid that aligns with most display densities and produces predictable visual rhythm.",
      "4px-grid": "A 4px base gives finer control than 8px — common in dense data-heavy UIs like dashboards or tables where small spacing differences matter.",
      fibonacci: "Spacing values follow a Fibonacci sequence — grows non-linearly, creating a sense of natural proportion between small and large spaces.",
      modular: "Spacing scaled by a multiplier (often 1.5× or 2×) — produces harmonious jumps between steps.",
    };
    return `Base unit: ${base_unit}px · ${strategy}\n${strategyMeaning[strategy] ?? "Custom spacing scale."}`;
  })();

  // Motion reading
  const motionRead = (() => {
    if (design.motion.durations_ms.length === 0) return "No CSS animations or transitions detected.";
    const durations = design.motion.durations_ms.join("ms, ") + "ms";
    const patterns = design.motion.patterns.join(", ") || "standard transitions";
    const hasReducedMotion = design.motion.has_reduced_motion_support;
    return `Durations: ${durations} · Patterns: ${patterns} · Reduced motion support: ${hasReducedMotion ? "yes" : "no (potential accessibility concern)"}.`;
  })();

  if (tier === "succinct") {
    return [
      "## Design System",
      colorRead.split("\n")[0],
      `**Type:** ${design.typography.families.map((f) => f.family).join(", ")} · Scale: [${design.typography.scale.join(", ")}]px`,
      `**Spacing:** ${design.spacing.base_unit}px base · ${design.spacing.strategy}`,
      `**Radius:** [${design.border_radius.join(", ")}]px · **Elevation:** ${design.elevation.length} shadow levels`,
      `**Motion:** ${design.motion.durations_ms.length > 0 ? motionRead.split("\n")[0] : "none"}`,
      `**Grid:** ${design.grid.layout} · max-width ${design.grid.max_width_px ?? "unset"}px`,
    ].join("\n");
  }

  if (tier === "professional") {
    const lines = [
      "## Design System",
      "",
      "**Colors**",
      colorRead,
      "",
      "**Typography**",
      ...fontReadings,
      `Scale: [${design.typography.scale.join(", ")}]px · Base: ${design.typography.base_size}px · Line height: ${design.typography.line_height_base} · Letter spacing: ${design.typography.letter_spacing_pattern}`,
      "",
      "**Spacing & Layout**",
      spacingRead,
      `Grid: ${design.grid.layout} · max-width ${design.grid.max_width_px ?? "unset"}px · columns ${design.grid.columns ?? "undetected"} · breakpoints [${design.grid.breakpoints_px.join(", ")}]px`,
      "",
      "**Surface & Motion**",
      `Border radius: [${design.border_radius.join(", ")}]px · Elevation: ${design.elevation.length} shadow levels · Dark mode: ${design.colors.dark_mode ? "yes" : "no"}`,
      motionRead,
    ];
    return lines.join("\n");
  }

  // Newbie — narrative with both lenses
  const lines = ["## The Visual Design System"];

  lines.push("### Colors");
  lines.push(colorRead);
  lines.push(
    "",
    `**Designer's read:** The ${design.colors.strategy} strategy ${design.colors.strategy === "complementary" ? "creates a dominant neutral field with a high-contrast accent — every CTA stands out because the rest of the palette steps back." : design.colors.strategy === "monochrome" ? "means color is not doing hierarchy work — size, weight, and spacing carry everything. A disciplined but demanding constraint." : "balances brand cohesion with enough contrast to establish hierarchy."}`,
    `**Developer's read:** ${design.colors.palette.length} tokens ${design.colors.dark_mode ? "with dark mode CSS (prefers-color-scheme)" : "without dark mode support"}. These map to CSS custom properties in the design system.`
  );

  lines.push("", "### Typography");
  for (const reading of fontReadings) lines.push(reading);
  lines.push(
    "",
    `**Type scale:** [${design.typography.scale.join(", ")}]px — ${design.typography.scale.length} steps. ${design.typography.scale.length >= 6 ? "A large scale gives designers many distinct levels of hierarchy. More expressive but harder to constrain." : "A tight scale means every size step is meaningful."}`,
    `**Base size:** ${design.typography.base_size}px at ${design.typography.line_height_base} line height. ${design.typography.base_size >= 18 ? "Generous base size — prioritising readability, possibly targeting older users or long-form content." : design.typography.base_size <= 13 ? "Compact base size — dense UI, likely a data-heavy dashboard or productivity tool." : "Standard base size for interface text."}`,
    design.typography.letter_spacing_pattern !== "normal"
      ? `Letter spacing is ${design.typography.letter_spacing_pattern} — ${design.typography.letter_spacing_pattern === "wide" ? "wide tracking often signals ALL-CAPS labels or a premium aesthetic." : "custom letter spacing shapes the reading rhythm and brand feel."}`
      : ""
  );

  lines.push("", "### Spacing System");
  lines.push(spacingRead);
  lines.push(
    `**Why this matters:** The base unit is the atomic unit of all spatial decisions — margins, padding, gaps. When everything is a multiple of ${design.spacing.base_unit}px, the layout feels coherent even if you can't say why. When it's arbitrary, it doesn't.`
  );

  if (design.motion.durations_ms.length > 0) {
    lines.push("", "### Motion");
    lines.push(motionRead);
    lines.push(
      `**Designer's read:** ${design.motion.patterns.includes("spring") ? "Spring animations feel physical — they overshoot slightly before settling, which signals quality and care. They're harder to implement but perceptibly better." : "Linear/ease transitions are functional and invisible — good for utility, not for brand personality."} ${!design.motion.has_reduced_motion_support ? "No reduced-motion support detected — users who experience motion sickness or have vestibular disorders aren't accommodated." : "Reduced-motion support means the site respects user system preferences — good accessibility practice."}`
    );
  }

  if (design.elevation.length > 0) {
    lines.push("", `### Depth & Surface`);
    lines.push(
      `${design.elevation.length} shadow levels detected. Elevation creates a visual 'stack' — shadows tell users which elements are closer and more interactive. ${design.elevation.length >= 4 ? "A deep elevation system (4+ levels) suggests a complex layering model: drawers, modals, dropdowns, and cards all have distinct depths." : "A shallow elevation system keeps the design grounded and flat — shadow is used for function, not decoration."}`
    );
  }

  return lines.filter((l) => l !== undefined).join("\n");
}

function interpretInteractions(schema: ReconstructSchema, tier: Tier): string {
  const { interactions, design } = schema;

  if (tier === "ai") {
    return `## Interactions\n\`\`\`json\n${JSON.stringify(interactions, null, 2)}\n\`\`\``;
  }

  const hoverCount = interactions.global_hover_patterns.length;
  const uniqueHoverElements = [
    ...new Set(interactions.global_hover_patterns.map((p) => p.element)),
  ];
  const transitionCount = interactions.transitions.length;

  const focusRead = {
    native: "browser's default focus outlines — functional, not branded",
    custom: "custom focus styling — accessibility is designed, not an afterthought",
    hidden: "focus outlines are hidden — keyboard and assistive technology users have no visual indicator. This is an accessibility failure.",
    mixed: "inconsistent focus handling — some elements have custom styles, others rely on browser defaults",
  }[interactions.focus_strategy] ?? interactions.focus_strategy;

  if (tier === "succinct") {
    return [
      "## Interactions",
      `**Focus:** ${interactions.focus_strategy} (${focusRead.split(" — ")[1] ?? ""})`,
      hoverCount > 0 ? `**Hover patterns:** ${hoverCount} across ${uniqueHoverElements.slice(0, 4).join(", ")}` : "**Hover:** minimal/none",
      interactions.scroll_behaviors.length > 0
        ? `**Scroll:** ${interactions.scroll_behaviors.join(", ")}`
        : "",
      transitionCount > 0 ? `**Transitions:** ${transitionCount} defined` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (tier === "professional") {
    const lines = [
      "## Interactions",
      `**Focus strategy:** ${interactions.focus_strategy} — ${focusRead}`,
      "",
    ];

    if (hoverCount > 0) {
      lines.push(`**Hover patterns (${hoverCount}):**`);
      const topPatterns = interactions.global_hover_patterns.slice(0, 6);
      for (const p of topPatterns) {
        lines.push(
          `  - \`${p.element}\`: ${p.changes.join(", ")}${p.motion ? ` at ${p.motion.duration_ms}ms ${p.motion.easing}` : ""}`
        );
      }
    }

    if (interactions.scroll_behaviors.length > 0) {
      lines.push(`\n**Scroll behaviors:** ${interactions.scroll_behaviors.join(", ")}`);
    }

    if (interactions.transitions.length > 0) {
      lines.push(`\n**Transitions (${interactions.transitions.length}):**`);
      interactions.transitions.slice(0, 5).forEach((t) => {
        lines.push(`  - \`${t.properties.join(", ")}\` · ${t.duration_ms}ms · ${t.easing}`);
      });
    }

    return lines.join("\n");
  }

  // Newbie — both perspectives
  const lines = ["## How the Site Responds to You"];

  lines.push(
    "### Keyboard and focus",
    `**${interactions.focus_strategy}:** ${focusRead}.`,
    "",
    `**Why it matters:** Anyone navigating by keyboard — including power users and people with motor disabilities — relies on visible focus outlines to know where they are on the page. ${interactions.focus_strategy === "hidden" ? "Hiding these is a common performance-driven mistake that has real accessibility consequences." : interactions.focus_strategy === "custom" ? "Custom focus styles mean someone invested in making keyboard navigation feel polished, not just functional." : "Browser-native styles are functional but often don't match the brand."}`
  );

  if (hoverCount > 0) {
    lines.push(
      "",
      "### Hover behaviour",
      `${hoverCount} hover patterns detected across ${uniqueHoverElements.length} element types (${uniqueHoverElements.slice(0, 4).join(", ")}${uniqueHoverElements.length > 4 ? "…" : ""}).`,
      "",
      `**Designer's read:** Hover states are micro-feedback moments — they tell users 'this is interactive'. ${design.motion.durations_ms.length > 0 ? `The ${Math.min(...design.motion.durations_ms)}ms durations make responses feel instant but not jarring.` : "Fast, imperceptible transitions."}`,
      `**Developer's read:** These are CSS :hover / :focus-within rules, not JavaScript. Changes include: ${[...new Set(interactions.global_hover_patterns.flatMap((p) => p.changes))].slice(0, 5).join(", ")}.`
    );
  }

  if (interactions.scroll_behaviors.length > 0) {
    lines.push(
      "",
      "### Scroll behaviour",
      `${interactions.scroll_behaviors.join(", ")} detected.`,
      "",
      `**Why this is a design decision:** Scroll isn't just navigation — sticky elements, parallax, and scroll-snap all shape how users experience pacing and depth. ${interactions.scroll_behaviors.includes("sticky") ? "Sticky elements keep navigation or key actions always reachable, trading layout space for persistent access." : ""} ${interactions.scroll_behaviors.includes("snap") ? "Scroll snap creates section-by-section pagination — immersive but can surprise users who expect free scrolling." : ""}`
    );
  }

  if (interactions.transitions.length > 0) {
    lines.push(
      "",
      "### Transitions",
      `${interactions.transitions.length} CSS transition definitions.`,
      `**Top transitions:** ${interactions.transitions.slice(0, 3).map((t) => `${t.properties.join("/")} ${t.duration_ms}ms ${t.easing}`).join(" · ")}`,
      "",
      `**Designer's read:** Transition timing is how the site communicates responsiveness. ${interactions.transitions.some((t) => t.easing.includes("cubic-bezier")) ? "Custom cubic-bezier easings means someone hand-tuned these — standard ease/ease-in-out wasn't precise enough." : "Standard easings (ease, linear) are familiar and predictable."}`
    );
  }

  return lines.join("\n");
}

function interpretPhilosophy(schema: ReconstructSchema, tier: Tier): string {
  const { philosophy, design } = schema;

  if (tier === "ai") {
    return `## Philosophy\n\`\`\`json\n${JSON.stringify(philosophy, null, 2)}\n\`\`\``;
  }

  // Design school narratives — what each school actually means
  const schoolNarratives: Record<string, string> = {
    minimalism: "Form follows function: every element is there because it earns its place. The whitespace isn't empty — it's doing work, giving other elements room to breathe and making hierarchy legible without decoration.",
    "neo-brutalism": "Refuses refinement as a value signal. Thick outlines, flat shadows, and high contrast communicate directness and authenticity — 'we're not trying to impress you, we're trying to work with you.'",
    glassmorphism: "Translucency and blur create a sense of depth and layering. The glass effect signals modernity and a 'premium lite' aesthetic — sophisticated without heaviness.",
    neumorphism: "Extruded surfaces that feel tangible — inset and raised shadows simulate physical materials. Tactile, but notoriously low contrast, which creates accessibility tension.",
    "flat-design": "No shadows, no gradients, no decoration. Content and function are the design. Often chosen when clarity and information density matter more than visual richness.",
    "material-design": "Google's design language — elevation, shadow, and motion create a physical metaphor for the interface. Accessible, familiar, but distinctively 'Google-adjacent'.",
    claymorphism: "Soft, bubbly, toy-like surfaces. Rounded forms + saturated color + subtle shadows create a playful, friendly aesthetic. Popular in consumer apps.",
    "dark-mode-first": "Darkness as a primary aesthetic, not an optional toggle. Signals developer-native, premium, or nocturnal product contexts.",
    "typography-led": "Type does the design work that color and illustration would do elsewhere. Font choices, scale, and weight carry the entire visual hierarchy.",
    "gradient-heavy": "Color gradients create depth, energy, and modernity. Often signals a brand that wants to appear dynamic and premium without full illustration investment.",
  };

  const schoolDescriptions = philosophy.design_school
    .map((s) => schoolNarratives[s])
    .filter(Boolean);

  const personalityMeaning: Record<string, string> = {
    clinical: "precision and expertise over warmth — the design says 'this works, trust it'",
    warm: "human connection — color and form invite rather than instruct",
    playful: "delight is a feature — the design earns engagement through personality",
    authoritative: "gravitas through restraint — serif type and strong hierarchy signal credibility",
    energetic: "fast, high-contrast, action-oriented — every element pushes the user forward",
    elegant: "restraint as luxury — the design says 'we don't need to try hard'",
    bold: "big type, strong color, confident statements — the design commands attention",
    technical: "for people who know what they're doing — density and precision over explanation",
    neutral: "the design doesn't impose personality — utility and neutrality are the character",
  };

  const personalityDescriptions = philosophy.personality
    .map((p) => ({ trait: p, meaning: personalityMeaning[p] ?? p }))
    .filter((p) => p.meaning);

  const accessibilityContext = {
    AAA: "Accessibility is a first-class concern — ARIA, landmarks, focus, and motion preferences are all properly handled. Exceeds baseline requirements.",
    AA:  "Solid accessibility — meets the WCAG AA standard. Fundamentals are correct; edge cases may have minor gaps.",
    A:   "Partial accessibility — WCAG A level only. Major patterns are present but inconsistently applied. Users with assistive tech will find friction.",
    none: "Accessibility is not prioritised here — missing ARIA, landmarks, and/or keyboard support. Significant barrier for users with disabilities.",
    unknown: "Accessibility level could not be determined from the extracted signals.",
  }[philosophy.accessibility_grade] ?? String(philosophy.accessibility_grade);

  if (tier === "succinct") {
    return [
      "## Design Philosophy",
      `**Schools:** ${philosophy.design_school.join(", ")}`,
      `**Personality:** ${philosophy.personality.join(", ")}`,
      `**Density:** ${philosophy.density} · **Whitespace:** ${philosophy.whitespace_use}`,
      `**Hierarchy via:** ${philosophy.visual_hierarchy_method.join(", ")}`,
      `**Accessibility:** ${philosophy.accessibility_grade}`,
    ].join("\n");
  }

  if (tier === "professional") {
    const lines = [
      "## Design Philosophy",
      `**Design school(s):** ${philosophy.design_school.join(", ")}`,
    ];

    if (schoolDescriptions.length) {
      for (const d of schoolDescriptions) lines.push(`  _${d}_`);
    }

    lines.push(
      "",
      `**Personality:** ${philosophy.personality.join(", ")}`,
      personalityDescriptions.length ? personalityDescriptions.map((p) => `  _${p.trait}: ${p.meaning}_`).join("\n") : "",
      "",
      `**Density / whitespace:** ${philosophy.density} · ${philosophy.whitespace_use}`,
      `**Hierarchy achieved via:** ${philosophy.visual_hierarchy_method.join(", ")}`,
      "",
      `**Accessibility (${philosophy.accessibility_grade}):** ${accessibilityContext}`
    );

    return lines.filter((l) => l !== undefined).join("\n");
  }

  // Newbie — fullest treatment
  const lines = ["## The Design's Intent and Philosophy"];

  if (philosophy.design_school.includes("unknown") || philosophy.design_school.length === 0) {
    lines.push(
      "The design doesn't map cleanly to a named school — it's either deliberately eclectic or unique enough that the signals don't cluster around a known aesthetic."
    );
  } else {
    lines.push("### What design school(s) is this from?");
    for (let i = 0; i < philosophy.design_school.length; i++) {
      const school = philosophy.design_school[i];
      const narrative = schoolNarratives[school];
      if (narrative) {
        lines.push(`**${school}:** ${narrative}`);
      }
    }
  }

  if (personalityDescriptions.length) {
    lines.push("", "### What personality does the design communicate?");
    for (const { trait, meaning } of personalityDescriptions) {
      lines.push(`**${trait}:** ${meaning}`);
    }
    lines.push(
      "",
      "**Why this matters for designers:** Personality is the emotional contract the design makes with users. A mismatch between personality and product purpose creates cognitive dissonance — a 'playful' design on a legal compliance tool undermines trust.",
      "**Why this matters for developers:** Personality drives decisions you might think are arbitrary — animation spring values, font choices, and corner radius. When personality is defined, those decisions have a reason."
    );
  }

  lines.push(
    "",
    "### Density and space",
    `This design is **${philosophy.density}** with **${philosophy.whitespace_use}** whitespace use.`,
    "",
    `${philosophy.density === "sparse"
      ? "Sparse layout treats space as a resource — giving it to elements that deserve attention. This is a trust signal: it assumes users are willing to look rather than needing to be pushed."
      : philosophy.density === "dense"
      ? "Dense layout maximises information per screen. It respects users' time and assumes they can handle complexity — common in productivity tools, dashboards, and data-heavy products."
      : "Moderate density balances breathing room with information richness — the default for most professional products."
    }`,
    "",
    "### How visual hierarchy is created",
    `This design achieves hierarchy through: **${philosophy.visual_hierarchy_method.join(", ")}**.`,
    "",
    `${philosophy.visual_hierarchy_method.includes("size") ? "**Size:** Making important things bigger is the most fundamental hierarchy signal — it works without training or convention." : ""}`,
    `${philosophy.visual_hierarchy_method.includes("weight") ? "**Weight:** Bold vs regular text creates emphasis without adding visual noise — the classic way to differentiate labels from values." : ""}`,
    `${philosophy.visual_hierarchy_method.includes("color") ? "**Color:** Chromatic hierarchy guides attention — but it only works for users who can perceive color differences." : ""}`,
    `${philosophy.visual_hierarchy_method.includes("spacing") ? "**Spacing:** Grouping via proximity is a Gestalt principle — things close together are perceived as related." : ""}`,
    `${philosophy.visual_hierarchy_method.includes("elevation") ? "**Elevation:** Shadows create a 'closer to the user' signal — interactive elements float above the content layer." : ""}`,
    "",
    "### Accessibility",
    accessibilityContext,
    philosophy.accessibility_grade === "none" || philosophy.accessibility_grade === "A"
      ? "\n**What this means in practice:** Users who rely on screen readers, keyboard navigation, or assistive technology will encounter barriers. This is both an ethical concern and, depending on jurisdiction, a legal one."
      : ""
  );

  return lines.filter((l) => l !== undefined).join("\n");
}

// ── Main builder ──────────────────────────────────────────────────────────────

export function buildExplanation(schema: ReconstructSchema, tier: Tier, focus: string): string {
  const header =
    tier === "ai"
      ? `{"url":"${schema.meta.url}","tier":"${tier}","captured":"${schema.meta.captured_at}","confidence":${schema.meta.confidence}}`
      : [
          `# ${schema.meta.url}`,
          tier === "newbie"
            ? `*Full explanation — both designer and developer perspectives*`
            : tier === "professional"
            ? `*Professional read — notable decisions and what they signal*`
            : tier === "succinct"
            ? `*Critical facts*`
            : "",
          `Confidence: ${Math.round(schema.meta.confidence * 100)}% · ${schema.meta.coverage.urls_crawled} page(s) analyzed`,
        ]
          .filter(Boolean)
          .join("\n");

  const standouts = findStandouts(schema);

  const sections: string[] = [header];

  if (standouts.length > 0 && tier !== "ai") {
    sections.push(
      tier === "succinct"
        ? `**Notable:** ${standouts[0]}`
        : [
            "## Notable Signals",
            tier === "newbie"
              ? "*Things that stand out — either unconventional, contradictory, or worth highlighting*"
              : "*Unconventional or contradictory signals detected*",
            ...standouts.map((s) => `- ${s}`),
          ].join("\n")
    );
  }

  if (tier === "ai") {
    const aiOutput: Record<string, unknown> = { url: schema.meta.url, confidence: schema.meta.confidence };
    if (focus === "all" || focus === "tech") aiOutput.technology = schema.technology;
    if (focus === "all" || focus === "design") aiOutput.design = schema.design;
    if (focus === "all" || focus === "interactions") aiOutput.interactions = schema.interactions;
    if (focus === "all" || focus === "philosophy") aiOutput.philosophy = schema.philosophy;
    aiOutput.standouts = standouts;
    return `\`\`\`json\n${JSON.stringify(aiOutput, null, 2)}\n\`\`\``;
  }

  if (focus === "all" || focus === "tech") sections.push(interpretTech(schema, tier));
  if (focus === "all" || focus === "design") sections.push(interpretDesign(schema, tier));
  if (focus === "all" || focus === "interactions") sections.push(interpretInteractions(schema, tier));
  if (focus === "all" || focus === "philosophy") sections.push(interpretPhilosophy(schema, tier));

  return sections.join("\n\n---\n\n");
}
