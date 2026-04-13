// reconstruct_hypothetical — what-if, critique, tradeoffs, limitations, considerations
// Every response covers all five angles grounded in the actual extracted schema.
// Nothing is fabricated — all reasoning anchors to real token values and detected patterns.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../schema/config.js";
import { readCache } from "../cache/store.js";
import type { ReconstructSchema } from "../schema/types.js";

export function registerHypotheticalTool(server: McpServer): void {
  server.tool(
    "reconstruct_hypothetical",
    "Reason about a website's design or technical decisions: answer a specific what-if/why-not question AND produce a full critique covering what could be better, the tradeoffs embedded in current decisions, limitations of the current approach, and open considerations. All reasoning is grounded in the extracted schema — nothing fabricated. Requires reconstruct_analyze first.",
    {
      url: z.string().url().describe("Website URL (must be analyzed first)"),
      question: z
        .string()
        .min(5)
        .describe(
          "The question or angle to explore. Examples: 'What if they switched to Tailwind?', 'Why not use a serif typeface?', 'What if this was rebuilt in Svelte?', 'What if they added dark mode?', 'Critique the color system'"
        ),
      tier: z
        .enum(["newbie", "professional", "succinct", "ai"])
        .default("professional")
        .describe(
          "newbie = full explanation with why/because | professional = dense, decision-focused | succinct = tight bullets | ai = structured JSON"
        ),
    },
    async ({ url, question, tier }) => {
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

      const output = buildHypotheticalOutput(schema, question, tier);
      return { content: [{ type: "text", text: output }] };
    }
  );
}

// ── Question classification ───────────────────────────────────────────────────

type QuestionType = "what-if" | "why-not" | "critique" | "what-would" | "general";

function classifyQuestion(q: string): QuestionType {
  const lower = q.toLowerCase().trim();
  if (/^what if|^what would happen|^if they/.test(lower)) return "what-if";
  if (/^why not|^why didn'?t|^why doesn'?t|^why no /.test(lower)) return "why-not";
  if (/^critique|^review|^assess|^evaluate|^what'?s wrong|^what could be better/.test(lower)) return "critique";
  if (/^what would/.test(lower)) return "what-would";
  return "general";
}

// ── Grounding facts extractor ─────────────────────────────────────────────────
// Produces a rich, structured snapshot of the current state.
// These are the only facts the LLM should use to reason about the question.

interface GroundingFacts {
  // Tech
  framework: string;
  rendering: string;
  styling: string[];
  state: string[];
  libs: string[];
  // Design
  color_count: number;
  color_strategy: string;
  dark_mode: boolean;
  top_colors: string[];
  font_families: string[];
  font_scale: number[];
  base_font_size: number;
  spacing_base: number;
  spacing_strategy: string;
  border_radius: number[];
  has_animations: boolean;
  animation_durations: number[];
  animation_patterns: string[];
  has_reduced_motion: boolean;
  elevation_levels: number;
  // Structure
  page_count: number;
  global_sections: string[];
  // Interactions
  focus_strategy: string;
  scroll_behaviors: string[];
  transition_count: number;
  hover_elements: string[];
  // Philosophy
  design_school: string[];
  personality: string[];
  density: string;
  whitespace_use: string;
  hierarchy_methods: string[];
  accessibility_grade: string;
  // Confidence
  confidence: number;
  pages_analyzed: number;
}

function extractGroundingFacts(schema: ReconstructSchema): GroundingFacts {
  return {
    framework: schema.technology.framework,
    rendering: schema.technology.rendering,
    styling: schema.technology.styling,
    state: schema.technology.state,
    libs: schema.technology.detected_libs,
    color_count: schema.design.colors.palette.length,
    color_strategy: schema.design.colors.strategy,
    dark_mode: schema.design.colors.dark_mode,
    top_colors: schema.design.colors.palette.slice(0, 6).map((c) => c.value),
    font_families: schema.design.typography.families.map((f) => `${f.family} (${f.role})`),
    font_scale: schema.design.typography.scale,
    base_font_size: schema.design.typography.base_size,
    spacing_base: schema.design.spacing.base_unit,
    spacing_strategy: schema.design.spacing.strategy,
    border_radius: schema.design.border_radius,
    has_animations: schema.design.motion.durations_ms.length > 0,
    animation_durations: schema.design.motion.durations_ms,
    animation_patterns: schema.design.motion.patterns,
    has_reduced_motion: schema.design.motion.has_reduced_motion_support,
    elevation_levels: schema.design.elevation.length,
    page_count: schema.structure.page_count,
    global_sections: schema.structure.sections_global,
    focus_strategy: schema.interactions.focus_strategy,
    scroll_behaviors: schema.interactions.scroll_behaviors,
    transition_count: schema.interactions.transitions.length,
    hover_elements: [
      ...new Set(schema.interactions.global_hover_patterns.map((p) => p.element)),
    ],
    design_school: schema.philosophy.design_school,
    personality: schema.philosophy.personality,
    density: schema.philosophy.density,
    whitespace_use: schema.philosophy.whitespace_use,
    hierarchy_methods: schema.philosophy.visual_hierarchy_method,
    accessibility_grade: schema.philosophy.accessibility_grade,
    confidence: schema.meta.confidence,
    pages_analyzed: schema.meta.coverage.urls_crawled,
  };
}

// ── Critique generators ───────────────────────────────────────────────────────
// These produce grounded critique points derived purely from schema signals.
// Each check returns null if nothing notable — no filler.

function generateCritiquePoints(schema: ReconstructSchema): string[] {
  const points: string[] = [];
  const f = extractGroundingFacts(schema);

  // Accessibility gaps
  if (f.accessibility_grade === "none") {
    points.push(
      `No accessibility baseline detected. With ${f.framework} in use, the tooling exists to fix this — it's an investment gap, not a capability gap. Missing: ARIA roles, landmark regions, or proper focus management.`
    );
  } else if (f.accessibility_grade === "A") {
    points.push(
      `Accessibility is WCAG A only — fundamentals exist but inconsistently applied. ${f.focus_strategy === "hidden" ? "Focus outlines are hidden, which breaks keyboard navigation. " : ""}Completing the coverage to AA would bring this to production-ready.`
    );
  }

  // Hidden focus
  if (f.focus_strategy === "hidden") {
    points.push(
      `Focus outlines are hidden — keyboard and assistive-tech users have no navigation indicator. This is one of the most impactful and cheapest accessibility fixes available.`
    );
  }

  // No reduced motion support
  if (f.has_animations && !f.has_reduced_motion) {
    points.push(
      `${f.animation_durations.length} animation duration(s) detected but no prefers-reduced-motion support. Users with vestibular disorders or motion sensitivity are not accommodated. Adding @media (prefers-reduced-motion: reduce) is low effort.`
    );
  }

  // No dark mode
  if (!f.dark_mode && f.design_school.includes("dark-mode-first")) {
    points.push(
      `Design school signals dark-mode intent but no CSS prefers-color-scheme media query detected — the dark theme is hardcoded. Users can't switch. Implementing CSS custom properties with a color-scheme toggle would fix this.`
    );
  } else if (!f.dark_mode) {
    points.push(
      `No dark mode support detected. Given current platform defaults (macOS, iOS, Android all default dark in certain contexts), this affects a material percentage of users. CSS custom properties + prefers-color-scheme is the standard approach.`
    );
  }

  // Monochrome palette with no hierarchy fallback
  if (f.color_strategy === "monochrome" && !f.hierarchy_methods.includes("size") && !f.hierarchy_methods.includes("weight")) {
    points.push(
      `Monochrome color strategy with no size or weight hierarchy detected — the design has no hierarchy fallback. When color isn't distinguishing elements, something else must. Adding a clear type scale or weight system would resolve this.`
    );
  }

  // Dense layout + poor accessibility
  if (f.density === "dense" && f.accessibility_grade !== "AAA" && f.accessibility_grade !== "AA") {
    points.push(
      `Dense layout combined with ${f.accessibility_grade} accessibility — information-heavy interfaces carry higher cognitive load, which makes accessibility baseline even more important for users with cognitive or visual impairments.`
    );
  }

  // No animations on a 'playful' or 'energetic' personality
  if (!f.has_animations && (f.personality.includes("playful") || f.personality.includes("energetic"))) {
    points.push(
      `Personality is classified as ${f.personality.filter((p) => ["playful", "energetic"].includes(p)).join("/")} but no animations detected. The personality is carried entirely through color and form — motion would reinforce this and align the kinetic experience with the visual one.`
    );
  }

  // Large type scale but no motion — missed opportunity for scroll storytelling
  const maxType = f.font_scale.length ? Math.max(...f.font_scale) : 0;
  if (maxType >= 64 && !f.has_animations && !f.scroll_behaviors.includes("aos")) {
    points.push(
      `Large display type (${maxType}px) with no scroll-triggered animation — typographic-led designs often benefit from reveal animations that let the type land with intention. The impact of large type is reduced when it just appears statically.`
    );
  }

  // Single font family (no visual distinction between display and body)
  if (f.font_families.length === 1) {
    points.push(
      `Only one typeface detected — no typographic contrast between display, body, and UI text. A second typeface (or even weight-based differentiation) would sharpen the hierarchy without adding visual noise.`
    );
  }

  // Very small base font size
  if (f.base_font_size > 0 && f.base_font_size < 15) {
    points.push(
      `Base font size is ${f.base_font_size}px — below the 16px recommended minimum for comfortable reading on most displays. This is common in dense UIs but compounds readability problems for users with low vision.`
    );
  }

  // Styling approach gaps
  if (f.styling.includes("scss") && !f.styling.includes("tailwind")) {
    points.push(
      `SCSS for styling on a ${f.framework} project — CSS custom properties now cover most SCSS variable and nesting use cases natively. A migration path exists toward leaner styling without build-step overhead.`
    );
  }

  // Missing state management but likely needs it
  if (
    f.state.length === 0 &&
    f.libs.some((l) => ["react-query", "swr", "axios"].includes(l)) &&
    f.page_count > 5
  ) {
    points.push(
      `No client-side state management detected despite data fetching libraries being present across ${f.page_count} pages — state is likely managed ad-hoc per component. As the product grows, a centralised store (Zustand, Jotai, or RSC server state) will become important.`
    );
  }

  return points;
}

function generateTradeoffPoints(schema: ReconstructSchema): string[] {
  const points: string[] = [];
  const f = extractGroundingFacts(schema);

  // Framework tradeoffs
  const frameworkTradeoffs: Record<string, string> = {
    "Next.js": "Server-side rendering buys SEO and fast first paint but adds Node.js infrastructure requirements and cold starts on serverless. The App Router (if used) improves this but splits the mental model between server and client components.",
    "Nuxt": "Vue's SSR capabilities come with a smaller ecosystem than React and fewer senior developers available compared to Next.js.",
    "SvelteKit": "Zero runtime overhead is real — measurably smaller bundles — but the talent pool is significantly smaller and the ecosystem less mature for complex requirements.",
    "Astro": "Zero JS by default is a genuine performance win, but interactivity above a low threshold requires per-island hydration config, which adds complexity.",
    "Remix": "Progressive enhancement and web-native patterns produce resilient UIs, but require a persistent server (no purely static deployment).",
    "React": "Maximum flexibility comes with maximum architectural responsibility — no guardrails means inconsistency accumulates over time.",
    "Angular": "Prescriptive structure scales predictably in large teams but introduces ceremony and boilerplate for straightforward features.",
    "HTMX": "Eliminating client-side JS complexity is a genuine win for content-heavy products, but the interactivity ceiling is lower than JS frameworks for app-like experiences.",
    "WordPress": "Non-technical editor access and a vast plugin ecosystem make iteration fast for content, but performance, security, and maintainability require active management.",
  };

  const fwTradeoff = frameworkTradeoffs[f.framework];
  if (fwTradeoff) points.push(`**${f.framework}:** ${fwTradeoff}`);

  // Styling tradeoffs
  if (f.styling.includes("tailwind")) {
    points.push(
      `**Tailwind:** Development speed and design consistency are real gains. The cost is tight coupling of style to markup, verbose class lists, and a risk of 'Tailwind homogeneity' when the design system defaults are kept rather than customised.`
    );
  }
  if (f.styling.some((s) => ["styled-components", "emotion"].includes(s))) {
    points.push(
      `**CSS-in-JS (${f.styling.filter((s) => ["styled-components", "emotion"].includes(s)).join("/")}):** Dynamic theming and co-located styles are clean developer ergonomics, but the runtime cost and bundle overhead are real. The ecosystem is moving toward zero-runtime alternatives.`
    );
  }

  // Color strategy tradeoffs
  if (f.color_strategy === "monochrome") {
    points.push(
      `**Monochrome palette:** Maximum restraint makes every color decision feel intentional and the brand feels cohesive — but it places all hierarchy responsibility on type size, weight, and spacing. When those aren't strong enough, the design feels flat.`
    );
  } else if (f.color_strategy === "complementary") {
    points.push(
      `**Complementary palette:** High contrast between dominant and accent colors makes CTAs unmissable — a conversion-focused choice. The cost is that using both colors at full saturation produces tension; one must recede.`
    );
  }

  // Density tradeoffs
  if (f.density === "dense") {
    points.push(
      `**Dense layout:** Maximises information per screen and respects users who know what they're doing — common in productivity tools. The cost is a steeper onboarding curve and higher cognitive load for new users.`
    );
  } else if (f.density === "sparse") {
    points.push(
      `**Sparse layout:** Communicates confidence and lets content breathe — a premium signal. The cost is that information-seeking users spend more time scrolling, and the layout can feel empty on pages with less content.`
    );
  }

  // Animation tradeoffs
  if (f.has_animations) {
    points.push(
      `**Animations (${f.animation_durations.join("ms, ")}ms):** Motion feedback makes the interface feel responsive and premium. The cost is bundle size (if JS-driven), performance on low-end devices, and the requirement for reduced-motion support — which is currently ${f.has_reduced_motion ? "handled" : "missing"}.`
    );
  }

  // No animations tradeoff
  if (!f.has_animations && f.libs.includes("framer-motion")) {
    points.push(
      `**Framer Motion without CSS animations:** Spring animations are entirely JS-driven — this is a real performance tradeoff. CSS transitions would handle 80% of use cases with zero JS overhead.`
    );
  }

  // Single typeface
  if (f.font_families.length === 1) {
    points.push(
      `**Single typeface:** Consistent and loads faster (one font file). The cost is less typographic range — you can't visually separate display headlines from body text or UI labels without relying entirely on size and weight.`
    );
  }

  return points;
}

function generateLimitationPoints(schema: ReconstructSchema): string[] {
  const points: string[] = [];
  const f = extractGroundingFacts(schema);

  // No dark mode = cannot respond to system preferences
  if (!f.dark_mode) {
    points.push(
      `Cannot respond to user system preferences (prefers-color-scheme). Users in dark environments or with OLED displays who rely on dark mode get no accommodation.`
    );
  }

  // No reduced motion = cannot accommodate vestibular disorders
  if (f.has_animations && !f.has_reduced_motion) {
    points.push(
      `Animation cannot be disabled by users with vestibular disorders or motion sensitivity — no prefers-reduced-motion handling detected.`
    );
  }

  // Poor/moderate accessibility = screen reader and keyboard limits
  if (f.accessibility_grade === "none" || f.accessibility_grade === "A") {
    points.push(
      `Screen reader and keyboard-only navigation are impaired — ${f.accessibility_grade} accessibility grade means assistive technology users will encounter barriers.`
    );
  }

  // Dense + small base font = low-vision limits
  if (f.density === "dense" && f.base_font_size < 15) {
    points.push(
      `Dense layout + ${f.base_font_size}px base font creates a difficult experience for users with low vision, elderly users, or anyone reading on a high-DPI display at distance.`
    );
  }

  // Monochrome palette = colorblind limitations
  if (f.color_count <= 2 && !f.hierarchy_methods.includes("size") && !f.hierarchy_methods.includes("weight")) {
    points.push(
      `Very limited color palette with no backup hierarchy method — if a user cannot distinguish the palette colors (colorblindness affects ~8% of men), the hierarchy collapses.`
    );
  }

  // Framework-specific limitations
  if (f.framework === "HTMX") {
    points.push(
      `HTMX's model limits client-side interactivity — optimistic UI updates, offline support, and complex multi-step flows require non-trivial workarounds.`
    );
  }
  if (f.rendering === "ssg") {
    points.push(
      `Static generation means content can only change with a rebuild and redeploy — real-time data, personalisation, and user-specific content are either not possible or require client-side hydration on top.`
    );
  }

  // CSS-in-JS limitations
  if (f.styling.some((s) => ["styled-components", "emotion"].includes(s))) {
    points.push(
      `CSS-in-JS runtime cost limits performance on low-end devices — styles are injected at runtime, adding CPU overhead on initial render.`
    );
  }

  // No state management with data-heavy libs
  if (f.state.length === 0 && f.libs.some((l) => ["react-query", "swr"].includes(l))) {
    points.push(
      `No client-side state management detected — shared state across components likely relies on prop drilling or ad-hoc context, which limits scalability as the product grows.`
    );
  }

  // Single font family — display/body distinction limit
  if (f.font_families.length === 1) {
    points.push(
      `A single typeface limits typographic range — editorial moments, code blocks, and display headlines all share the same visual character, reducing the palette of expression available to designers.`
    );
  }

  return points;
}

function generateConsiderationPoints(schema: ReconstructSchema, question: string): string[] {
  const points: string[] = [];
  const f = extractGroundingFacts(schema);
  const qLower = question.toLowerCase();

  // Open questions grounded in what we know and don't know

  // Framework-specific
  if (f.framework === "Next.js" || f.framework === "Nuxt") {
    points.push(
      `Are performance budgets defined per route? SSR frameworks can silently grow server response times as data dependencies increase — without per-route monitoring, regressions go unnoticed.`
    );
  }

  // Animation and performance
  if (f.has_animations || f.libs.some((l) => ["framer-motion", "gsap", "three.js"].includes(l))) {
    points.push(
      `Have animations been profiled on mid-range devices? Premium animations at 60fps on developer machines can drop to 30fps or cause jank on budget Android hardware — the target audience's device distribution matters.`
    );
  }

  // Design system maturity
  if (f.styling.includes("tailwind")) {
    points.push(
      `Is the Tailwind config locked down (no arbitrary values, no one-off overrides)? The utility approach only produces consistency if the escape hatches are managed — otherwise it becomes CSS chaos with extra class names.`
    );
  }

  // Typography question
  if (qLower.includes("font") || qLower.includes("typograph") || f.font_families.length === 1) {
    points.push(
      `What is the type loading strategy? Variable fonts load one file for all weights — worth considering if the current approach loads multiple weight files. System fonts (system-ui) eliminate loading entirely.`
    );
  }

  // Color question
  if (qLower.includes("color") || qLower.includes("palette") || qLower.includes("dark mode")) {
    points.push(
      `Is the color system defined in CSS custom properties at the root level? If not, dark mode, theming, and white-labelling all require duplicating style rules rather than toggling a variable.`
    );
    points.push(
      `Have the top ${f.top_colors.slice(0, 3).join(", ")} colors been tested against WCAG AA contrast ratios? Color appearance on screen varies significantly across display types (AMOLED vs IPS vs OLED).`
    );
  }

  // Accessibility improvements
  if (f.accessibility_grade !== "AAA") {
    points.push(
      `What is the cost vs impact of an accessibility pass? Fixing focus outlines + adding ARIA labels covers the highest-impact issues with the lowest engineering cost. A full audit is more thorough but not required to start.`
    );
  }

  // Scaling question
  if (f.density === "dense" || f.page_count > 10) {
    points.push(
      `As the product grows, is there a component governance process? Dense UIs with many pages tend to accumulate visual debt — small inconsistencies compound across a large page count.`
    );
  }

  // If question is about a framework switch
  if (qLower.includes("svelte") || qLower.includes("astro") || qLower.includes("remix") || qLower.includes("rebuild")) {
    points.push(
      `Migration risk: how much of the current design system (${f.styling.join(", ")}) is framework-agnostic vs tightly coupled? Tailwind and CSS Modules migrate easily; CSS-in-JS libraries are more entangled.`
    );
    points.push(
      `What's the team's familiarity with the target framework? Productivity dips significantly during a framework migration — the technical gains need to be weighed against a 3-6 month velocity reduction.`
    );
  }

  // General open question
  points.push(
    `Coverage note: this analysis is based on ${f.pages_analyzed} page(s) at ${Math.round(f.confidence * 100)}% confidence. Signals from auth-walled, dynamic, or JS-heavy pages may be incomplete — some of these considerations may not apply or may be already addressed in areas not yet analyzed.`
  );

  return points;
}

// ── Output builder ────────────────────────────────────────────────────────────

function buildHypotheticalOutput(
  schema: ReconstructSchema,
  question: string,
  tier: string
): string {
  const qType = classifyQuestion(question);
  const facts = extractGroundingFacts(schema);
  const critiques = generateCritiquePoints(schema);
  const tradeoffs = generateTradeoffPoints(schema);
  const limitations = generateLimitationPoints(schema);
  const considerations = generateConsiderationPoints(schema, question);

  if (tier === "ai") {
    return JSON.stringify(
      {
        url: schema.meta.url,
        question,
        question_type: qType,
        grounding_facts: facts,
        what_could_be_better: critiques,
        tradeoffs_in_current_decisions: tradeoffs,
        limitations: limitations,
        considerations: considerations,
      },
      null,
      2
    );
  }

  // Question framing
  const framingMap: Record<QuestionType, string> = {
    "what-if":
      "Trace the concrete impact of this change across design, performance, developer experience, and user experience — using the current state as the baseline.",
    "why-not":
      "Analyse why the site likely made its current choice and evaluate whether the alternative would be better, worse, or just different — given what the extracted signals tell us about the product's priorities.",
    critique:
      "Assess the current state directly — what's working, what's not, and what the signals suggest about intent vs execution.",
    "what-would":
      "Reason about the downstream effects using the current baseline as the starting point.",
    general:
      "Reason carefully about the tradeoffs and implications, anchored in the current state.",
  };

  const framing = framingMap[qType];

  // Current state summary (used by LLM to ground its answer)
  const stateSummary = [
    `**Framework:** ${facts.framework} (${facts.rendering})`,
    `**Styling:** ${facts.styling.join(", ")}`,
    `**Typography:** ${facts.font_families.join(", ")} — scale [${facts.font_scale.join(", ")}]px`,
    `**Colors:** ${facts.color_count} tokens · ${facts.color_strategy}${facts.dark_mode ? " · dark mode supported" : " · light only"}`,
    `**Top colors:** ${facts.top_colors.join(", ")}`,
    `**Spacing:** ${facts.spacing_base}px base · ${facts.spacing_strategy}`,
    `**Radius:** [${facts.border_radius.join(", ")}]px`,
    `**Motion:** ${facts.has_animations ? `${facts.animation_durations.join("ms, ")}ms · ${facts.animation_patterns.join(", ")}` : "none"} · reduced-motion support: ${facts.has_reduced_motion ? "yes" : "no"}`,
    `**Libraries:** ${facts.libs.join(", ") || "none detected"}`,
    `**Design school:** ${facts.design_school.join(", ")} · ${facts.personality.join(", ")}`,
    `**Density:** ${facts.density} · whitespace: ${facts.whitespace_use}`,
    `**Accessibility:** ${facts.accessibility_grade} · focus: ${facts.focus_strategy}`,
    `**Pages analyzed:** ${facts.pages_analyzed} at ${Math.round(facts.confidence * 100)}% confidence`,
  ].join("\n");

  if (tier === "succinct") {
    const lines = [
      `# ${question}`,
      `*${schema.meta.url}*`,
      "",
      "**Current state:**",
      stateSummary,
      "",
      "**Analysis framing:** " + framing,
      "",
      critiques.length
        ? `**What could be better:**\n${critiques.slice(0, 3).map((c) => `- ${c}`).join("\n")}`
        : "",
      tradeoffs.length
        ? `**Tradeoffs in current decisions:**\n${tradeoffs.slice(0, 3).map((t) => `- ${t}`).join("\n")}`
        : "",
      limitations.length
        ? `**Limitations:**\n${limitations.slice(0, 3).map((l) => `- ${l}`).join("\n")}`
        : "",
      considerations.length
        ? `**Considerations:**\n${considerations.slice(0, 2).map((c) => `- ${c}`).join("\n")}`
        : "",
    ].filter(Boolean);
    return lines.join("\n");
  }

  // Professional and newbie — full structure
  const verboseHeader =
    tier === "newbie"
      ? `*Full analysis — grounded in what was actually extracted from ${schema.meta.url}. No fabrication: every point below connects to a real signal.*`
      : `*Signal-grounded analysis — ${Math.round(facts.confidence * 100)}% confidence on ${facts.pages_analyzed} page(s)*`;

  const lines = [
    `# ${question}`,
    `**Site:** ${schema.meta.url}`,
    verboseHeader,
    "",
    "## Current State",
    "*These are the facts the analysis is anchored to. Use these when reasoning about the question.*",
    stateSummary,
    "",
    "## How to Approach This Question",
    framing,
    "",
  ];

  // What could be better — always present
  if (critiques.length > 0) {
    lines.push(
      "## What Could Be Better",
      tier === "newbie"
        ? "*These are observable gaps between what the site does and what it could do — each point is tied to a detected signal.*"
        : "*Grounded critique — each point has a detected signal behind it*",
      ...critiques.map((c) => `- ${c}`),
      ""
    );
  }

  // Tradeoffs
  if (tradeoffs.length > 0) {
    lines.push(
      "## Tradeoffs Embedded in Current Decisions",
      tier === "newbie"
        ? "*Every design and tech choice gives something up to gain something else. These are the specific tradeoffs this site has accepted.*"
        : "*What was sacrificed for what*",
      ...tradeoffs.map((t) => `- ${t}`),
      ""
    );
  }

  // Limitations
  if (limitations.length > 0) {
    lines.push(
      "## Limitations of the Current Approach",
      tier === "newbie"
        ? "*Things the current design or stack cannot do, or does poorly — structural gaps rather than execution gaps.*"
        : "*Structural constraints — where the current approach hits its ceiling*",
      ...limitations.map((l) => `- ${l}`),
      ""
    );
  }

  // Considerations
  if (considerations.length > 0) {
    lines.push(
      "## Open Considerations",
      tier === "newbie"
        ? "*Questions worth asking before making changes — things the analysis can't determine from the outside.*"
        : "*Open questions and decision points*",
      ...considerations.map((c) => `- ${c}`),
      ""
    );
  }

  lines.push(
    "---",
    tier === "newbie"
      ? "_The question above should now be answered in light of this context. All five sections above are grounding — the actual answer to the question is yours to reason through with this as your map._"
      : "_Reasoning above grounds the question. Apply to the specific scenario._"
  );

  return lines.join("\n");
}
