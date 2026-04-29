// reconstruct_cannibalize — splice design elements from multiple sites into one synthesis
// Takes N analyzed sites + a creative intent, resolves conflicts, outputs a unified spec

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { CreateMessageRequestSchema, CreateMessageResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig, type DeepPartial, type ReconstructConfig } from "../schema/config.js";
import { readCache, writeCache } from "../cache/store.js";
import { crawlSite } from "../scrapers/cascade.js";
import { mergeCrawlToSchema } from "../extractors/merge.js";
import type { ReconstructSchema } from "../schema/types.js";

export function registerCannibalizeTool(server: McpServer): void {
  server.tool(
    "reconstruct_cannibalize",
    "Extract and splice design elements from multiple websites into a new synthesis. Specify what to take from each source and provide a creative intent to resolve conflicts. Returns a combined design spec and component scaffold.",
    {
      sources: z.array(z.object({
        url: z.string().url().describe("Source website URL"),
      take: z.array(z.enum([
        "colors", "typography", "spacing", "motion", "components",
        "layout", "interactions", "philosophy", "elevation", "border_radius", "all"
      ])).describe("What design elements to take from this source"),
      })).min(1).max(6).describe("Source websites and what to take from each"),
      intent: z.string().min(10).describe(
        "Creative direction for the synthesis. E.g. 'A dashboard that feels like Linear but breathes like Notion, with Vercel's deployment card animations'"
      ),
      output_framework: z.enum(["html", "react", "vue", "svelte", "tokens"]).default("react"),
      constraints: z.string().optional().describe(
        "Any constraints to apply. E.g. 'must be dark mode first', 'no animations', 'accessibility AA required'"
      ),
    },
    async ({ sources, intent, output_framework, constraints }, extra) => {
      const config = loadConfig();
      const cacheDir = config.output.cache_dir;

      // Resolve schemas — use cache if available, else analyze
      const schemas: Array<{ url: string; take: string[]; schema: ReconstructSchema }> = [];

      for (const source of sources) {
        let schema = readCache(source.url, cacheDir);

        if (!schema) {
          try {
            const crawl = await crawlSite(source.url, { crawl: { max_pages: 10 } } as DeepPartial<ReconstructConfig>);
            schema = await mergeCrawlToSchema(source.url, crawl);
            writeCache(source.url, schema, cacheDir, config.output.cache_ttl_hours);
          } catch (err) {
            return {
              content: [{
                type: "text",
                text: `Failed to analyze ${source.url}: ${err instanceof Error ? err.message : String(err)}`,
              }],
              isError: true,
            };
          }
        }

        schemas.push({ url: source.url, take: source.take, schema });
      }

      const output = await buildCannibalizeOutput(extra, schemas, intent, output_framework, constraints);

      return {
        content: [{ type: "text", text: output }],
      };
    }
  );
}

// ── Cannibalize synthesis ─────────────────────────────────────────────────────

interface SourcedToken {
  value: unknown;
  source_url: string;
  rationale: string;
}

interface CannibalizedSpec {
  colors: SourcedToken[];
  typography: SourcedToken[];
  spacing: SourcedToken | null;
  motion: SourcedToken | null;
  elevation: SourcedToken | null;
  border_radius: SourcedToken | null;
  layout: SourcedToken | null;
  philosophy: SourcedToken[];
  conflicts: Array<{ property: string; options: string[]; resolution: string }>;
  ai_strategy?: string;
  ai_rationale?: string;
}

async function buildCannibalizeOutput(
  extra: RequestHandlerExtra<any, any>,
  sources: Array<{ url: string; take: string[]; schema: ReconstructSchema }>,
  intent: string,
  framework: string,
  constraints?: string
): Promise<string> {
  // Use AI if possible, else fallback to rule-based
  const spec = await synthesizeWithAI(extra, sources, intent, constraints);
  const lines: string[] = [];

  lines.push(`# Cannibalized Design Spec`);
  lines.push(`**Intent:** ${intent}`);
  if (constraints) lines.push(`**Constraints:** ${constraints}`);
  lines.push(`**Sources:** ${sources.map((s) => s.url).join(", ")}`);
  lines.push("");

  // Lineage table — what was taken from where
  lines.push("## Design Lineage");
  lines.push("| Element | Source | Value |");
  lines.push("|---------|--------|-------|");

  for (const c of spec.colors.slice(0, 8)) {
    lines.push(`| Color \`${String(c.value)}\` | ${shortUrl(c.source_url)} | ${c.rationale} |`);
  }
  for (const t of spec.typography) {
    lines.push(`| Typography: ${String(t.value)} | ${shortUrl(t.source_url)} | ${t.rationale} |`);
  }
  if (spec.spacing) lines.push(`| Spacing | ${shortUrl(spec.spacing.source_url)} | ${spec.spacing.rationale} |`);
  if (spec.motion) lines.push(`| Motion | ${shortUrl(spec.motion.source_url)} | ${spec.motion.rationale} |`);
  if (spec.layout) lines.push(`| Layout | ${shortUrl(spec.layout.source_url)} | ${spec.layout.rationale} |`);
  lines.push("");

  // Conflict resolutions
  if (spec.conflicts.length > 0) {
    lines.push("## Conflict Resolutions");
    for (const conflict of spec.conflicts) {
      lines.push(`### ${conflict.property}`);
      lines.push(`Options considered: ${conflict.options.join(" vs ")}`);
      lines.push(`**Resolution:** ${conflict.resolution}`);
      lines.push("");
    }
  }

  // Synthesised design tokens
  lines.push("## Synthesised Design Tokens");
  lines.push("```css");
  lines.push(":root {");

  // Colors
  lines.push("  /* Colors — sourced from lineage above */");
  spec.colors.slice(0, 12).forEach((c, i) => {
    lines.push(`  --color-${i + 1}: ${String(c.value)};  /* from ${shortUrl(c.source_url)} */`);
  });

  // Typography
  lines.push("  /* Typography */");
  spec.typography.forEach((t, i) => {
    lines.push(`  --font-${i + 1}: ${String(t.value)};  /* from ${shortUrl(t.source_url)} */`);
  });

  // Spacing
  if (spec.spacing) {
    const spacingData = spec.spacing.value as ReconstructSchema["design"]["spacing"];
    lines.push(`  /* Spacing — ${spec.spacing.rationale} */`);
    spacingData.scale?.slice(0, 8).forEach((s: number, i: number) => {
      lines.push(`  --space-${i + 1}: ${s}px;`);
    });
  }

  // Motion
  if (spec.motion) {
    const motionData = spec.motion.value as ReconstructSchema["design"]["motion"];
    lines.push(`  /* Motion — ${spec.motion.rationale} */`);
    motionData.durations_ms?.forEach((d: number, i: number) => {
      lines.push(`  --duration-${i + 1}: ${d}ms;`);
    });
    if (motionData.easings?.[0]) {
      lines.push(`  --ease-primary: ${motionData.easings[0]};`);
    }
  }

  // Radius
  if (spec.border_radius) {
    const radii = spec.border_radius.value as number[];
    lines.push(`  /* Border radius — ${spec.border_radius.rationale} */`);
    radii.forEach((r: number, i: number) => {
      lines.push(`  --radius-${i + 1}: ${r}px;`);
    });
  }

  lines.push("}");
  lines.push("```");
  lines.push("");

  // Creative synthesis brief
  lines.push("## Creative Brief");
  if (spec.ai_strategy) {
    lines.push(`### Synthesis Strategy (AI)`);
    lines.push(spec.ai_strategy);
    lines.push("");
  }
  lines.push(buildCreativeBrief(sources, spec, intent, constraints));
  lines.push("");
  
  if (spec.ai_rationale) {
    lines.push(`### Implementation Rationale (AI)`);
    lines.push(spec.ai_rationale);
    lines.push("");
  }

  // Component scaffold — AI-driven from real detected schema data
  lines.push("## Component Scaffold");
  lines.push(await generateComponentCode(extra, spec, sources, framework, intent, constraints));

  return lines.join("\n");
}

async function synthesizeWithAI(
    extra: RequestHandlerExtra<any, any>,
    sources: Array<{ url: string; take: string[]; schema: ReconstructSchema }>,
    intent: string,
    constraints?: string
): Promise<CannibalizedSpec> {
    const baseline = synthesize(sources);

    try {
        const dnaSummary = sources.map(s => {
            return `Source: ${s.url}\nTech: ${s.schema.technology.framework}, ${s.schema.technology.styling.join(", ")}\n` +
                   `Colors: ${s.schema.design.colors.palette.map(p => p.value).join(", ")}\n` +
                   `Typography: ${s.schema.design.typography.families.map(f => f.family).join(", ")}\n` +
                   `Personality: ${s.schema.philosophy.personality.join(", ")}`;
        }).join("\n\n---\n\n");

        const prompt = `You are the Reconstruct Design Synthesis Architect. Your task is to perform a cross-site design cannibalization.

# Input DNA Manifest:
${dnaSummary}

# User's Creative Intent:
${intent}

# Constraints:
${constraints || "None"}

# Existing Baseline Choice:
${JSON.stringify({ 
    colors: baseline.colors.map(c => c.value), 
    spacing: baseline.spacing?.value,
    philosophy: baseline.philosophy.map(p => p.value)
}, null, 2)}

# Objective:
Return a sophisticated, reasoned design spec. Resolve conflicts based on the intent.

# Requirements:
1. Explain your strategy (why this blend works).
2. For each major decision (primary color, typography, radius), provide a rationale linked back to a source's DNA.
3. Return the result in the following JSON format ONLY:
{
  "strategy": "...",
  "rationale": "...",
  "spec": {
      "colors": [{"value": "#...", "source_url": "...", "rationale": "..."}],
      "typography": [{"value": "...", "source_url": "...", "rationale": "..."}],
      "spacing_base": 4,
      "border_radius": 8
  }
}`;

        const response = await extra.sendRequest(
            {
                method: "sampling/createMessage",
                params: {
                    messages: [{
                        role: "user",
                        content: {
                            type: "text",
                            text: prompt
                        }
                    }],
                    systemPrompt: "You are the Reconstruct Design Synthesis Engine. Your job is to resolve design conflicts between multiple source sites and output a unified, premium design specification. You must return ONLY valid JSON matching the schema.",
                    maxTokens: 4000
                }
            } as any,
            CreateMessageResultSchema
        );

        if (response.content && "text" in response.content) {
            const raw = response.content.text;
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    const ai = JSON.parse(jsonMatch[0]);
                    // Apply AI spec overrides — don't discard them
                    if (Array.isArray(ai.spec?.colors) && ai.spec.colors.length > 0) {
                        baseline.colors = ai.spec.colors.map((c: any) => ({
                            value: c.value,
                            source_url: c.source_url ?? sources[0].url,
                            rationale: c.rationale ?? "AI-selected",
                        }));
                    }
                    if (ai.spec?.border_radius != null) {
                        baseline.border_radius = {
                            value: [ai.spec.border_radius],
                            source_url: sources[0].url,
                            rationale: "AI-selected radius",
                        };
                    }
                    if (ai.spec?.spacing_base != null) {
                        const existing = baseline.spacing?.value as any;
                        baseline.spacing = {
                            value: { ...(existing ?? {}), base_unit: ai.spec.spacing_base },
                            source_url: sources[0].url,
                            rationale: `${ai.spec.spacing_base}px base — AI-selected`,
                        };
                    }
                    if (Array.isArray(ai.spec?.typography) && ai.spec.typography.length > 0) {
                        baseline.typography = ai.spec.typography.map((t: any) => ({
                            value: t.value,
                            source_url: t.source_url ?? sources[0].url,
                            rationale: t.rationale ?? "AI-selected",
                        }));
                    }
                    return { ...baseline, ai_strategy: ai.strategy, ai_rationale: ai.rationale };
                } catch (e) {
                    console.error("[cannibalize] JSON parse failed:", e);
                }
            }
        }
    } catch (err) {
        console.error("[cannibalize] AI synthesis failed, falling back to rules:", err);
    }

    return baseline;
}

function synthesize(
  sources: Array<{ url: string; take: string[]; schema: ReconstructSchema }>
): CannibalizedSpec {
  const spec: CannibalizedSpec = {
    colors: [],
    typography: [],
    spacing: null,
    motion: null,
    elevation: null,
    border_radius: null,
    layout: null,
    philosophy: [],
    conflicts: [],
  };

  for (const { url, take, schema } of sources) {
    const takeAll = take.includes("all");

    // Colors
    if (takeAll || take.includes("colors")) {
      const primary = schema.design.colors.palette[0];
      const accent = schema.design.colors.palette.find((c) => c.usage === "accent");
      if (primary) spec.colors.push({ value: primary.value, source_url: url, rationale: "primary brand color" });
      if (accent) spec.colors.push({ value: accent.value, source_url: url, rationale: "accent color" });
    }

    // Typography
    if (takeAll || take.includes("typography")) {
      for (const font of schema.design.typography.families.slice(0, 2)) {
        spec.typography.push({ value: font.family, source_url: url, rationale: `${font.role} typeface` });
      }
    }

    // Spacing (last writer wins per priority order in sources array)
    if (takeAll || take.includes("spacing")) {
      if (!spec.spacing) {
        spec.spacing = { value: schema.design.spacing, source_url: url, rationale: `${schema.design.spacing.base_unit}px base grid (${schema.design.spacing.strategy})` };
      } else {
        // Conflict
        const existing = spec.spacing.value as ReconstructSchema["design"]["spacing"];
        const incoming = schema.design.spacing;
        if (existing.base_unit !== incoming.base_unit) {
          spec.conflicts.push({
            property: "Spacing base unit",
            options: [`${existing.base_unit}px (${shortUrl(spec.spacing.source_url)})`, `${incoming.base_unit}px (${shortUrl(url)})`],
            resolution: `Use ${Math.min(existing.base_unit, incoming.base_unit)}px — tighter grid gives more flexibility`,
          });
          // Take the more granular grid
          if (incoming.base_unit < existing.base_unit) {
            spec.spacing = { value: incoming, source_url: url, rationale: `${incoming.base_unit}px base grid — more granular` };
          }
        }
      }
    }

    // Motion
    if (takeAll || take.includes("motion")) {
      if (!spec.motion) {
        spec.motion = { value: schema.design.motion, source_url: url, rationale: `${schema.design.motion.patterns.join(", ")} patterns` };
      }
    }

    // Elevation
    if (takeAll || take.includes("elevation")) {
      if (!spec.elevation && schema.design.elevation.length > 0) {
        spec.elevation = { value: schema.design.elevation, source_url: url, rationale: `${schema.design.elevation.length} shadow levels` };
      }
    }

    // Border radius
    if (takeAll || take.includes("border_radius")) {
      if (!spec.border_radius && schema.design.border_radius.length > 0) {
        spec.border_radius = { value: schema.design.border_radius, source_url: url, rationale: `radius scale: ${schema.design.border_radius.join(", ")}px` };
      }
    }

    // Layout
    if (takeAll || take.includes("layout")) {
      if (!spec.layout) {
        spec.layout = { value: schema.structure, source_url: url, rationale: `${schema.design.grid.layout} layout, max-width ${schema.design.grid.max_width_px ?? "unset"}px` };
      }
    }

    // Philosophy
    if (takeAll || take.includes("philosophy")) {
      for (const school of schema.philosophy.design_school) {
        spec.philosophy.push({ value: school, source_url: url, rationale: `design school: ${school}` });
      }
    }
  }

  // Deduplicate typography by family name
  const seenFonts = new Set<string>();
  spec.typography = spec.typography.filter((t) => {
    if (seenFonts.has(String(t.value))) return false;
    seenFonts.add(String(t.value));
    return true;
  });

  return spec;
}

function buildCreativeBrief(
  sources: Array<{ url: string; take: string[]; schema: ReconstructSchema }>,
  spec: CannibalizedSpec,
  intent: string,
  constraints?: string
): string {
  const philosophies = spec.philosophy.map((p) => String(p.value));
  const personalities = [...new Set(sources.flatMap((s) => s.schema.philosophy.personality))];

  const lines = [
    `**Intent:** ${intent}`,
    "",
    `**Design DNA:**`,
    spec.colors.slice(0, 3).map((c) => `- Color \`${String(c.value)}\` from ${shortUrl(c.source_url)}: ${c.rationale}`).join("\n"),
    spec.typography.map((t) => `- Font \`${String(t.value)}\` from ${shortUrl(t.source_url)}: ${t.rationale}`).join("\n"),
    spec.spacing ? `- Spacing from ${shortUrl(spec.spacing.source_url)}: ${spec.spacing.rationale}` : "",
    spec.motion ? `- Motion from ${shortUrl(spec.motion.source_url)}: ${spec.motion.rationale}` : "",
    "",
    philosophies.length ? `**Design schools blended:** ${[...new Set(philosophies)].join(" + ")}` : "",
    personalities.length ? `**Personality synthesis:** ${[...new Set(personalities)].join(", ")}` : "",
    constraints ? `**Constraints applied:** ${constraints}` : "",
  ];

  return lines.filter(Boolean).join("\n");
}

// ── Dynamic AI-driven component generation ─────────────────────────────────────
// Compiles actual detected components, sections, interactions, and tokens from
// the real schema data and sends them to AI. No hardcoded templates.

async function generateComponentCode(
  extra: RequestHandlerExtra<any, any>,
  spec: CannibalizedSpec,
  sources: Array<{ url: string; take: string[]; schema: ReconstructSchema }>,
  framework: string,
  intent: string,
  constraints?: string
): Promise<string> {
  if (framework === "tokens") {
    return buildW3CTokens(spec);
  }

  // Build a deduplicated component manifest from every component detected across all source schemas
  const seen = new Set<string>();
  const componentManifest = sources.flatMap(({ url, schema }) => {
    const hostname = shortUrl(url);
    const all = [
      ...schema.components,
      ...schema.structure.pages.flatMap((p) => p.unique_components),
    ];
    return all.filter((c) => {
      const key = `${hostname}:${c.name_inferred}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((c) => ({
      name: c.name_inferred,
      from: hostname,
      variants: c.variants,
      props: c.props_inferred,
      styling: c.styling_approach,
      shared: c.is_shared,
    }));
  });

  // Page structure: what sections exist and what layout patterns are used
  const sections = [...new Set(sources.flatMap((s) => s.schema.structure.sections_global))];
  const layouts = [...new Set(
    sources.flatMap((s) => s.schema.structure.pages.map((p) => p.layout_pattern))
  )].filter(Boolean);

  // Real interaction patterns from the schema (hover states, transitions)
  const hoverPatterns = sources.flatMap((s) =>
    s.schema.interactions.global_hover_patterns.slice(0, 5).map((p) => ({
      element: p.element,
      changes: p.changes,
      duration_ms: p.motion?.duration_ms,
      easing: p.motion?.easing,
    }))
  );

  // Synthesized token summary
  const colors = spec.colors.slice(0, 10)
    .map((c) => `${String(c.value)} — ${c.rationale} (from ${shortUrl(c.source_url)})`)
    .join("\n  ");
  const fonts = spec.typography
    .map((t) => `${String(t.value)} — ${t.rationale}`)
    .join(", ");
  const spacingData = spec.spacing?.value as ReconstructSchema["design"]["spacing"] | undefined;
  const spacingBase = spacingData?.base_unit ?? 8;
  const radii = spec.border_radius?.value as number[] | undefined;
  const motionData = spec.motion?.value as ReconstructSchema["design"]["motion"] | undefined;
  const durations = motionData?.durations_ms?.join("ms, ") ?? "";
  const easings = motionData?.easings?.join(", ") ?? "";
  const dominantStyling = mostCommonStyling(sources);

  const prompt = `Generate ${framework} components for a new project.

## Creative Intent
${intent}

## Constraints
${constraints ?? "None"}

## Synthesized Design Tokens
Colors:
  ${colors}
Typography: ${fonts}
Spacing base unit: ${spacingBase}px
Border radius scale: ${(radii ?? []).join(", ")}px
${durations ? `Transitions: ${durations}ms | Easings: ${easings}` : ""}

## Components detected in source sites
${componentManifest.length > 0
    ? JSON.stringify(componentManifest, null, 2)
    : "No shared components detected in source sites."}

## Global page sections found across sources
${sections.length > 0 ? sections.join(", ") : "none detected"}

## Layout patterns found
${layouts.length > 0 ? layouts.join(", ") : "none detected"}

## Interaction patterns (from real CSS/hover analysis)
${hoverPatterns.length > 0 ? JSON.stringify(hoverPatterns, null, 2) : "none detected"}

## Dominant styling approach used by sources
${dominantStyling}

## Requirements
- Generate the components most relevant to the intent AND the components actually detected in source sites above
- Use the synthesized design tokens exactly — do not invent colors, sizes, or fonts
- Match the variants and prop signatures detected in the source data
- Use ${framework} with TypeScript where appropriate
- Apply the detected interaction patterns (hover transitions, focus states) using the exact durations and easings above
- Styling: match the dominant approach (${dominantStyling}) unless constraints override
- Component content should be props, not hardcoded text
- Include a layout/shell component if page sections or layout patterns were detected

Return ONLY code, fenced with \`\`\`${frameworkLang(framework)}\`\`\`.`;

  try {
    const response = await extra.sendRequest(
      {
        method: "sampling/createMessage",
        params: {
          messages: [{ role: "user", content: { type: "text", text: prompt } }],
          systemPrompt: `You are a UI engineer generating ${framework} components from a multi-site design synthesis. Build from the real detected component data and design tokens provided — do not use generic placeholder templates.`,
          maxTokens: 6000,
        },
      } as any,
      CreateMessageResultSchema
    );

    if (response.content && "text" in response.content && response.content.text.trim()) {
      return response.content.text;
    }
  } catch (err) {
    console.error("[cannibalize] Component generation failed:", err);
  }

  return buildTokenFallback(spec, framework, intent);
}

function frameworkLang(framework: string): string {
  const map: Record<string, string> = {
    react: "tsx", vue: "vue", svelte: "svelte", html: "html", tokens: "json",
  };
  return map[framework] ?? "typescript";
}

function mostCommonStyling(sources: Array<{ schema: ReconstructSchema }>): string {
  const counts = new Map<string, number>();
  for (const { schema } of sources) {
    for (const s of schema.technology.styling) {
      if (s !== "unknown") counts.set(s, (counts.get(s) ?? 0) + 1);
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] ?? "plain CSS";
}

// W3C Design Token format (works with Style Dictionary, Figma Tokens, etc.)
function buildW3CTokens(spec: CannibalizedSpec): string {
  const tokens: Record<string, Record<string, unknown>> = {};

  tokens.color = {};
  spec.colors.slice(0, 12).forEach((c, i) => {
    tokens.color[`color-${i + 1}`] = { $value: String(c.value), $type: "color", $description: c.rationale };
  });

  tokens.fontFamily = {};
  spec.typography.forEach((t, i) => {
    tokens.fontFamily[`font-${i + 1}`] = { $value: String(t.value), $type: "fontFamily", $description: t.rationale };
  });

  const spacingData = spec.spacing?.value as ReconstructSchema["design"]["spacing"] | undefined;
  if (spacingData?.scale?.length) {
    tokens.spacing = {};
    spacingData.scale.slice(0, 10).forEach((s, i) => {
      (tokens.spacing as Record<string, unknown>)[`space-${i + 1}`] = { $value: `${s}px`, $type: "dimension" };
    });
  }

  const radii = spec.border_radius?.value as number[] | undefined;
  if (radii?.length) {
    tokens.borderRadius = {};
    radii.forEach((r, i) => {
      (tokens.borderRadius as Record<string, unknown>)[`radius-${i + 1}`] = { $value: `${r}px`, $type: "dimension" };
    });
  }

  const motionData = spec.motion?.value as ReconstructSchema["design"]["motion"] | undefined;
  if (motionData?.durations_ms?.length) {
    tokens.duration = {};
    motionData.durations_ms.forEach((d, i) => {
      (tokens.duration as Record<string, unknown>)[`duration-${i + 1}`] = { $value: `${d}ms`, $type: "duration" };
    });
  }

  return "```json\n" + JSON.stringify(tokens, null, 2) + "\n```";
}

function buildTokenFallback(spec: CannibalizedSpec, framework: string, intent: string): string {
  const colors = spec.colors.slice(0, 12);
  const spacingData = spec.spacing?.value as ReconstructSchema["design"]["spacing"] | undefined;
  const radii = spec.border_radius?.value as number[] | undefined;
  const motionData = spec.motion?.value as ReconstructSchema["design"]["motion"] | undefined;

  const lines = [
    "```css",
    `/* AI component generation unavailable — design tokens only */`,
    `/* Intent: ${intent.slice(0, 80)} */`,
    `:root {`,
    ...colors.map((c, i) => `  --color-${i + 1}: ${String(c.value)}; /* ${c.rationale} */`),
    ...spec.typography.map((t, i) => `  --font-${i + 1}: "${String(t.value)}"; /* ${t.rationale} */`),
    ...(spacingData?.scale?.slice(0, 8)?.map((s, i) => `  --space-${i + 1}: ${s}px;`) ?? []),
    ...(radii?.map((r, i) => `  --radius-${i + 1}: ${r}px;`) ?? []),
    ...(motionData?.durations_ms?.map((d, i) => `  --duration-${i + 1}: ${d}ms;`) ?? []),
    `}`,
    "```",
    "",
    `> Component generation requires MCP sampling support (\`sampling/createMessage\`). Connect via Claude Desktop or Cursor to enable.`,
  ];
  return lines.join("\n");
}

function shortUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
