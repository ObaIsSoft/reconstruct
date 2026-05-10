// reconstruct_analyze — full site deconstruction
// Orchestrates: crawl → extract → merge → cache → return schema

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig, type DeepPartial } from "../schema/config.js";
import { crawlSite } from "../scrapers/cascade.js";
import { mergeCrawlToSchema } from "../extractors/merge.js";
import { readCache, writeCache } from "../cache/store.js";
import type { ReconstructSchema } from "../schema/types.js";

const AnalyzeInputSchema = z.object({
  url: z.string().url(),
  depth: z.enum(["surface", "deep"]).default("deep"),
  max_pages: z.number().min(1).max(10000).optional(),
  force_refresh: z.boolean().default(false),
});

export function registerAnalyzeTool(server: McpServer): void {
  server.tool(
    "reconstruct_analyze",
    "Fully deconstruct a website: crawl all pages, extract design tokens, tech stack, components, interactions, and philosophy. Returns a structured ReconstructSchema. Use this first before any other tool.",
    {
      url: z.string().url().describe("Website URL to analyze"),
      depth: z.enum(["surface", "deep"]).default("deep").describe(
        "surface = homepage only, deep = full site crawl"
      ),
      max_pages: z.number().min(1).max(10000).optional().describe(
        "Override max_pages from config for this call"
      ),
      force_refresh: z.boolean().default(false).describe(
        "Ignore cache and re-scrape even if cached result exists"
      ),
    },
    async ({ url, depth, max_pages, force_refresh }) => {
      const config = loadConfig(max_pages ? { crawl: { max_pages } } : undefined);
      const cacheDir = config.output.cache_dir;

      // Check cache first (unless forced)
      if (!force_refresh) {
        const cached = readCache(url, cacheDir);
        if (cached) {
          return {
            content: [
              {
                type: "text",
                text: formatSchema(cached, { fromCache: true }),
              },
            ],
          };
        }
      }

      // Surface mode: crawl homepage only
      const crawlConfig: DeepPartial<{ crawl: { max_pages: number; max_depth: number } }> | undefined = depth === "surface"
        ? { crawl: { max_pages: 1, max_depth: 1 } }
        : max_pages
          ? { crawl: { max_pages } }
          : undefined;

      const finalConfig = loadConfig(crawlConfig);

      let schema: ReconstructSchema;
      try {
        const crawl = await crawlSite(url, crawlConfig);
        schema = await mergeCrawlToSchema(url, crawl);
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Analysis failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }

      // Write to cache
      writeCache(url, schema, cacheDir, finalConfig.output.cache_ttl_hours);

      return {
        content: [
          {
            type: "text",
            text: formatSchema(schema, { fromCache: false }),
          },
        ],
      };
    }
  );
}

// ── Response truncation ───────────────────────────────────────────────────────
// The full schema is written to cache before formatSchema is called.
// Strip raw.css_text from the MCP response to keep it within context limits.

function truncateForResponse(schema: ReconstructSchema): ReconstructSchema {
  return {
    ...schema,
    raw: {
      ...schema.raw,
      css_text: schema.raw.css_text.map((c) =>
        c.length > 500 ? c.slice(0, 500) + `… [${c.length - 500} chars truncated — full text in cache]` : c
      ),
    },
  };
}

// ── Output formatter ──────────────────────────────────────────────────────────

function formatSchema(
  schema: ReconstructSchema,
  meta: { fromCache: boolean }
): string {
  const { coverage } = schema.meta;
  const cacheNote = meta.fromCache ? " *(from cache)*" : "";

  const lines: string[] = [
    `# Reconstruct Analysis: ${schema.meta.url}${cacheNote}`,
    `**Captured:** ${schema.meta.captured_at}`,
    `**Confidence:** ${Math.round(schema.meta.confidence * 100)}%`,
    `**Pages analyzed:** ${coverage.urls_crawled} / ${coverage.urls_discovered} discovered`,
    coverage.limit_reached ? `⚠️ ${coverage.notice}` : "",
    coverage.urls_auth_walled > 0 ? `🔒 ${coverage.notice}` : "",
    "",
    "## Technology",
    `- **Framework:** ${schema.technology.framework}`,
    `- **Rendering:** ${schema.technology.rendering}`,
    `- **Styling:** ${schema.technology.styling.join(", ")}`,
    schema.technology.state.length
      ? `- **State:** ${schema.technology.state.join(", ")}`
      : "",
    schema.technology.detected_libs.length
      ? `- **Libraries:** ${schema.technology.detected_libs.join(", ")}`
      : "",
    "",
    "## Design System",
    `- **Colors:** ${schema.design.colors.palette.length} tokens (${schema.design.colors.strategy}${schema.design.colors.dark_mode ? ", dark mode" : ""})`,
    `  ${schema.design.colors.palette.slice(0, 8).map((c) => `\`${c.value}\``).join(" ")}`,
    `- **Typography:** ${schema.design.typography.families.map((f) => f.family).join(", ")}`,
    `  Scale: ${schema.design.typography.scale.join("px, ")}px`,
    `- **Spacing:** base unit ${schema.design.spacing.base_unit}px (${schema.design.spacing.strategy})`,
    `- **Border radius:** ${schema.design.border_radius.join("px, ")}px`,
    schema.design.motion.durations_ms.length
      ? `- **Motion:** ${schema.design.motion.durations_ms.join("ms, ")}ms | ${schema.design.motion.patterns.join(", ")}`
      : "- **Motion:** none detected",
    "",
    "## Philosophy",
    `- **Design school:** ${schema.philosophy.design_school.join(", ")}`,
    `- **Personality:** ${schema.philosophy.personality.join(", ")}`,
    `- **Density:** ${schema.philosophy.density}`,
    `- **Whitespace:** ${schema.philosophy.whitespace_use}`,
    `- **Hierarchy via:** ${schema.philosophy.visual_hierarchy_method.join(", ")}`,
    `- **Accessibility:** ${schema.philosophy.accessibility_grade}`,
    "",
    "## Components",
    schema.components.length
      ? schema.components.map((c) => `- **${c.name_inferred}** (shared, ${c.pages_present.length} pages) — ${c.styling_approach}`).join("\n")
      : "- No shared components detected",
    "",
    "## Site Structure",
    `- **Pages:** ${schema.structure.page_count}`,
    schema.structure.sections_global.length
      ? `- **Global sections:** ${schema.structure.sections_global.join(", ")}`
      : "",
    schema.structure.nav.primary.length
      ? `- **Nav items:** ${schema.structure.nav.primary.slice(0, 8).map((n) => n.label).join(", ")}`
      : "",
    "",
    "---",
    "```json",
    JSON.stringify(truncateForResponse(schema), null, 2),
    "```",
  ];

  return lines.filter((l) => l !== "").join("\n");
}
