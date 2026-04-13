// reconstruct_diff — temporal comparison via Wayback CDX
// Compares a site's current design to a past snapshot

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../schema/config.js";
import { readCache, writeCache } from "../cache/store.js";
import { fetchWaybackSnapshots, fetchUrl, extractStylesheetUrls, fetchStylesheets } from "../scrapers/webfetch.js";
import { extractCSSTokens } from "../extractors/css.js";
import { detectTechStack } from "../extractors/tech.js";
import { inferPhilosophy } from "../extractors/philosophy.js";
import { detectAccessibilityGrade } from "../extractors/merge.js";
import type { ReconstructSchema } from "../schema/types.js";

export function registerDiffTool(server: McpServer): void {
  server.tool(
    "reconstruct_diff",
    "Compare a website's current design and tech stack to a past snapshot via the Wayback Machine. Shows what changed in colors, typography, tech stack, and philosophy over time.",
    {
      url: z.string().url().describe("Website URL to compare"),
      snapshot_date: z.string().optional().describe(
        "Target date for historical snapshot (YYYYMMDD format, e.g. '20220101'). Omit for most recent archived version."
      ),
    },
    async ({ url, snapshot_date }) => {
      const config = loadConfig();

      // Get current schema (from cache or error)
      const current = readCache(url, config.output.cache_dir);
      if (!current) {
        return {
          content: [{
            type: "text",
            text: `No current analysis found for ${url}. Run reconstruct_analyze("${url}") first, then diff.`,
          }],
          isError: true,
        };
      }

      // Find Wayback snapshot
      const snapshots = await fetchWaybackSnapshots(url, 10);
      if (snapshots.length === 0) {
        return {
          content: [{
            type: "text",
            text: `No Wayback Machine snapshots found for ${url}.`,
          }],
          isError: true,
        };
      }

      // Pick closest snapshot to requested date, or most recent if no date given
      let target = snapshots[0];
      if (snapshot_date) {
        const sorted = snapshots
          .map((s) => ({ ...s, delta: Math.abs(parseInt(s.timestamp) - parseInt(snapshot_date + "000000")) }))
          .sort((a, b) => a.delta - b.delta);
        target = sorted[0];
      }

      // Fetch the archived page
      const archived = await fetchUrl(target.snapshot_url, { timeout_ms: 20000 });
      if (!archived.ok) {
        return {
          content: [{
            type: "text",
            text: `Could not fetch Wayback snapshot at ${target.snapshot_url}. Status: ${archived.status}`,
          }],
          isError: true,
        };
      }

      // Extract minimal schema from archived HTML
      const archivedCssUrls = extractStylesheetUrls(archived.body, target.snapshot_url);
      const archivedCss = await fetchStylesheets(archivedCssUrls);
      const archivedTokens = extractCSSTokens(archivedCss);
      const archivedTech = detectTechStack(archived.body, archivedCss);
      const archivedAccessibility = detectAccessibilityGrade(archived.body, archivedCss);
      const archivedPhilosophy = inferPhilosophy(archivedTokens, archived.body, archivedAccessibility);

      // Build diff report
      const report = buildDiffReport(current, {
        tokens: archivedTokens,
        tech: archivedTech,
        philosophy: archivedPhilosophy,
        timestamp: target.timestamp,
        snapshot_url: target.snapshot_url,
      });

      return {
        content: [{ type: "text", text: report }],
      };
    }
  );
}

// ── Diff report ───────────────────────────────────────────────────────────────

interface ArchivedSnapshot {
  tokens: ReturnType<typeof extractCSSTokens>;
  tech: ReturnType<typeof detectTechStack>;
  philosophy: ReturnType<typeof inferPhilosophy>;
  timestamp: string;
  snapshot_url: string;
}

function buildDiffReport(
  current: ReconstructSchema,
  archived: ArchivedSnapshot
): string {
  const date = formatTimestamp(archived.timestamp);
  const lines: string[] = [
    `# Temporal Diff: ${current.meta.url}`,
    `**Now** (${current.meta.captured_at.slice(0, 10)}) vs **${date}**`,
    `*Archived snapshot: ${archived.snapshot_url}*`,
    "",
  ];

  // Tech stack changes
  const techChanges: string[] = [];
  if (current.technology.framework !== archived.tech.framework) {
    techChanges.push(`**Framework:** ${archived.tech.framework} → ${current.technology.framework}`);
  }
  if (current.technology.rendering !== archived.tech.rendering) {
    techChanges.push(`**Rendering:** ${archived.tech.rendering} → ${current.technology.rendering}`);
  }
  const addedLibs = current.technology.detected_libs.filter(
    (l) => !archived.tech.detected_libs.includes(l)
  );
  const removedLibs = archived.tech.detected_libs.filter(
    (l) => !current.technology.detected_libs.includes(l)
  );
  if (addedLibs.length) techChanges.push(`**Libraries added:** ${addedLibs.join(", ")}`);
  if (removedLibs.length) techChanges.push(`**Libraries removed:** ${removedLibs.join(", ")}`);

  if (techChanges.length) {
    lines.push("## Tech Stack Changes");
    lines.push(...techChanges.map((c) => `- ${c}`));
    lines.push("");
  }

  // Design changes
  const designChanges: string[] = [];
  const oldColorCount = archived.tokens.colors.length;
  const newColorCount = current.design.colors.palette.length;
  if (Math.abs(oldColorCount - newColorCount) > 2) {
    const direction = newColorCount > oldColorCount ? "expanded" : "reduced";
    designChanges.push(`**Color palette ${direction}:** ${oldColorCount} → ${newColorCount} colors`);
  }

  const oldBaseFont = archived.tokens.typography.families[0]?.family ?? "unknown";
  const newBaseFont = current.design.typography.families[0]?.family ?? "unknown";
  if (oldBaseFont !== newBaseFont) {
    designChanges.push(`**Primary font changed:** ${oldBaseFont} → ${newBaseFont}`);
  }

  const oldBaseSize = archived.tokens.typography.base_size;
  const newBaseSize = current.design.typography.base_size;
  if (oldBaseSize !== newBaseSize) {
    designChanges.push(`**Base font size:** ${oldBaseSize}px → ${newBaseSize}px`);
  }

  const oldSpacing = archived.tokens.spacing.base_unit;
  const newSpacing = current.design.spacing.base_unit;
  if (oldSpacing !== newSpacing) {
    designChanges.push(`**Spacing base unit:** ${oldSpacing}px → ${newSpacing}px`);
  }

  const oldDarkMode = archived.tokens.dark_mode;
  const newDarkMode = current.design.colors.dark_mode;
  if (oldDarkMode !== newDarkMode) {
    designChanges.push(
      newDarkMode ? "**Dark mode support added**" : "**Dark mode support removed**"
    );
  }

  const oldMotionCount = archived.tokens.motion.durations_ms.length;
  const newMotionCount = current.design.motion.durations_ms.length;
  if (oldMotionCount === 0 && newMotionCount > 0) {
    designChanges.push(`**Animations added** (${newMotionCount} duration values)`);
  } else if (oldMotionCount > 0 && newMotionCount === 0) {
    designChanges.push("**Animations removed**");
  }

  if (designChanges.length) {
    lines.push("## Design Changes");
    lines.push(...designChanges.map((c) => `- ${c}`));
    lines.push("");
  }

  // Philosophy drift
  const philosophyChanges: string[] = [];
  const addedSchools = current.philosophy.design_school.filter(
    (s) => !archived.philosophy.design_school.includes(s)
  );
  const removedSchools = archived.philosophy.design_school.filter(
    (s) => !current.philosophy.design_school.includes(s)
  );
  if (addedSchools.length) philosophyChanges.push(`**New design schools:** ${addedSchools.join(", ")}`);
  if (removedSchools.length) philosophyChanges.push(`**Dropped design schools:** ${removedSchools.join(", ")}`);

  if (archived.philosophy.density !== current.philosophy.density) {
    philosophyChanges.push(
      `**Density:** ${archived.philosophy.density} → ${current.philosophy.density}`
    );
  }

  if (philosophyChanges.length) {
    lines.push("## Philosophy Drift");
    lines.push(...philosophyChanges.map((c) => `- ${c}`));
    lines.push("");
  }

  // Summary
  const totalChanges =
    techChanges.length + designChanges.length + philosophyChanges.length;

  if (totalChanges === 0) {
    lines.push("## Summary");
    lines.push("No significant changes detected between the archived snapshot and current state.");
  } else {
    lines.push("## Summary");
    lines.push(
      `${totalChanges} change(s) detected across tech (${techChanges.length}), ` +
      `design (${designChanges.length}), and philosophy (${philosophyChanges.length}).`
    );
  }

  return lines.join("\n");
}

function formatTimestamp(ts: string): string {
  // YYYYMMDDHHmmss → YYYY-MM-DD
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
}
