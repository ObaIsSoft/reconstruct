import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../schema/config.js";
import { listCache, pruneExpiredCache, invalidateCache, readCache } from "../cache/store.js";

export function registerStatusTool(server: McpServer): void {
  server.tool(
    "reconstruct_status",
    "List all cached website analyses, their age, confidence, and which scraper was used. Optionally invalidate a specific URL.",
    {
      action: z.enum(["list", "invalidate", "prune"]).default("list").describe(
        "list = show all cached analyses | invalidate = remove one URL from cache | prune = remove all expired entries"
      ),
      url: z.string().url().optional().describe("URL to invalidate (required for action=invalidate)"),
    },
    async ({ action, url }) => {
      const config = loadConfig();
      const cacheDir = config.output.cache_dir;

      if (action === "invalidate") {
        if (!url) {
          return {
            content: [{ type: "text", text: "URL is required for action=invalidate" }],
            isError: true,
          };
        }
        const removed = invalidateCache(url, cacheDir);
        return {
          content: [{
            type: "text",
            text: removed ? `Cache invalidated for ${url}` : `No cache entry found for ${url}`,
          }],
        };
      }

      if (action === "prune") {
        const count = pruneExpiredCache(cacheDir);
        return {
          content: [{ type: "text", text: `Pruned ${count} expired cache entries from ${cacheDir}` }],
        };
      }

      // list
      const entries = listCache(cacheDir);

      if (entries.length === 0) {
        return {
          content: [{
            type: "text",
            text: `No cached analyses found in ${cacheDir}.\nRun reconstruct_analyze(url) to start.`,
          }],
        };
      }

      const now = Date.now();
      const lines: string[] = [
        `# Reconstruct Cache — ${entries.length} entr${entries.length === 1 ? "y" : "ies"}`,
        `*Cache dir: ${cacheDir}*`,
        "",
      ];

      for (const entry of entries.sort((a, b) => b.cached_at.localeCompare(a.cached_at))) {
        const schema = readCache(entry.url, cacheDir);
        const ageMs = now - new Date(entry.cached_at).getTime();
        const ageHours = Math.round(ageMs / 3600000);
        const ageStr = ageHours < 1 ? "< 1h ago" : ageHours < 24 ? `${ageHours}h ago` : `${Math.round(ageHours / 24)}d ago`;
        const expiresMs = new Date(entry.expires_at).getTime() - now;
        const expiresHours = Math.round(expiresMs / 3600000);
        const freshness = expiresMs < 0 ? "EXPIRED" : expiresHours < 2 ? "expiring soon" : "fresh";

        lines.push(`## ${entry.url}`);
        lines.push(`- **Cached:** ${ageStr} | **Status:** ${freshness}`);
        lines.push(`- **Size:** ${entry.size_kb}KB`);

        if (schema) {
          const scraper = schema.raw?.stylesheet_urls?.length > 0 ? "with CSS" : "no CSS";
          lines.push(`- **Confidence:** ${Math.round(schema.meta.confidence * 100)}%`);
          lines.push(`- **Pages analyzed:** ${schema.meta.coverage.urls_crawled}`);
          lines.push(`- **Framework:** ${schema.technology.framework} · ${schema.technology.rendering}`);
          lines.push(`- **Styling:** ${schema.technology.styling.join(", ")}`);
          lines.push(`- **Extraction:** ${scraper}`);
          if (schema.meta.coverage.notice) {
            lines.push(`- ⚠️ ${schema.meta.coverage.notice}`);
          }
        }

        lines.push("");
      }

      lines.push(`---`);
      lines.push(`To re-analyze: \`reconstruct_analyze(url, force_refresh=true)\``);
      lines.push(`To invalidate: \`reconstruct_status(action="invalidate", url="...")\``);

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
