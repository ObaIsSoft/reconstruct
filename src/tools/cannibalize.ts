// reconstruct_cannibalize — splice design elements from multiple sites into one synthesis
// Takes N analyzed sites + a creative intent, resolves conflicts, outputs a unified spec

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../schema/config.js";
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
          "layout", "interactions", "philosophy", "elevation", "all"
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
    async ({ sources, intent, output_framework, constraints }) => {
      const config = loadConfig();
      const cacheDir = config.output.cache_dir;

      // Resolve schemas — use cache if available, else analyze
      const schemas: Array<{ url: string; take: string[]; schema: ReconstructSchema }> = [];

      for (const source of sources) {
        let schema = readCache(source.url, cacheDir);

        if (!schema) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const crawl = await crawlSite(source.url, { crawl: { max_pages: 10 } } as any);
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

      const output = buildCannibalizeOutput(schemas, intent, output_framework, constraints);

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
}

function buildCannibalizeOutput(
  sources: Array<{ url: string; take: string[]; schema: ReconstructSchema }>,
  intent: string,
  framework: string,
  constraints?: string
): string {
  const spec = synthesize(sources);
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
  lines.push(buildCreativeBrief(sources, spec, intent, constraints));
  lines.push("");

  // Component scaffold
  lines.push("## Component Scaffold");
  lines.push(buildCannibalizedComponent(spec, framework, intent));

  return lines.join("\n");
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
    if (takeAll || take.includes("elevation")) {
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

function buildCannibalizedComponent(
  spec: CannibalizedSpec,
  framework: string,
  intent: string
): string {
  const primaryColor = String(spec.colors[0]?.value ?? "#000");
  const accentColor = String(spec.colors[1]?.value ?? "#666");
  const fontFamily = String(spec.typography[0]?.value ?? "system-ui");
  const motionData = spec.motion?.value as ReconstructSchema["design"]["motion"] | undefined;
  const duration = motionData?.durations_ms?.[0] ?? 200;
  const easing = motionData?.easings?.[0] ?? "ease";
  const radii = spec.border_radius?.value as number[] | undefined;
  const radius = radii?.[0] ?? 8;

  if (framework === "react") {
    return [
      "```tsx",
      `// Cannibalized Button — DNA from ${spec.colors[0]?.source_url ? shortUrl(spec.colors[0].source_url) : "multiple sources"}`,
      `export function CannButton({ children, variant = "primary", ...props }) {`,
      `  return (`,
      `    <button`,
      `      style={{`,
      `        fontFamily: "${fontFamily}",`,
      `        borderRadius: "${radius}px",`,
      `        transition: \`all ${duration}ms ${easing}\`,`,
      `        background: variant === "primary" ? "${primaryColor}" : "transparent",`,
      `        color: variant === "primary" ? "white" : "${primaryColor}",`,
      `        border: variant === "primary" ? "none" : \`1px solid ${primaryColor}\`,`,
      `        padding: "10px 20px",`,
      `        cursor: "pointer",`,
      `      }}`,
      `      onMouseEnter={e => (e.currentTarget.style.opacity = "0.88")}`,
      `      onMouseLeave={e => (e.currentTarget.style.opacity = "1")}`,
      `      {...props}`,
      `    >`,
      `      {children}`,
      `    </button>`,
      `  );`,
      `}`,
      "```",
    ].join("\n");
  }

  return [
    "```css",
    `/* Cannibalized Button — intent: ${intent.slice(0, 60)} */`,
    `.cann-btn {`,
    `  font-family: ${fontFamily};`,
    `  border-radius: ${radius}px;`,
    `  background: ${primaryColor};`,
    `  color: white;`,
    `  border: none;`,
    `  padding: 10px 20px;`,
    `  transition: all ${duration}ms ${easing};`,
    `  cursor: pointer;`,
    `}`,
    `.cann-btn:hover { opacity: 0.88; transform: translateY(-1px); }`,
    `.cann-btn--accent { background: ${accentColor}; }`,
    "```",
  ].join("\n");
}

function shortUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
