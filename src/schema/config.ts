import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// ── Zod Schemas ──────────────────────────────────────────────────────────────

export const CrawlConfigSchema = z.object({
  max_pages: z.number().min(1).max(10000).default(50),
  max_depth: z.number().min(1).max(10).default(3),
  dynamic_sample_size: z.number().min(1).max(50).default(5),
  trigger_interactions: z.boolean().default(true),
  scroll_to_load: z.boolean().default(true),
  timeout_per_page: z.number().min(1000).max(60000).default(10000),
  exclude_patterns: z.array(z.string()).default([]),
  include_patterns: z.array(z.string()).default([]),
});

export const ScraperConfigSchema = z.object({
  // "auto" = cascade logic picks the right tool
  prefer: z.enum(["auto", "webfetch", "lightpanda", "firecrawl", "browserbase"]).default("auto"),
  lightpanda_url: z.string().url().default("http://localhost:9222"),
  firecrawl_api_key: z.string().default(""),
  firecrawl_api_url: z.string().url().default("https://api.firecrawl.dev"),
  browserbase_api_key: z.string().default(""),
  browserbase_project_id: z.string().default(""),
});

export const OutputConfigSchema = z.object({
  // 1=newbie, 2=student, 3=designer, 4=developer, 5=AI/agent
  default_audience: z.number().min(1).max(5).default(4),
  cache_ttl_hours: z.number().min(0).max(8760).default(24),
  cache_dir: z.string().default(".reconstruct/cache"),
});

export const AuthConfigSchema = z.object({
  // Map of hostname → cookie string
  cookies: z.record(z.string(), z.string()).default({}),
});

export const ReconstructConfigSchema = z.object({
  _note: z.string().optional(),
  crawl: CrawlConfigSchema.default({}),
  scrapers: ScraperConfigSchema.default({}),
  output: OutputConfigSchema.default({}),
  auth: AuthConfigSchema.default({}),
});

export type CrawlConfig = z.infer<typeof CrawlConfigSchema>;
export type ScraperConfig = z.infer<typeof ScraperConfigSchema>;
export type OutputConfig = z.infer<typeof OutputConfigSchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
export type ReconstructConfig = z.infer<typeof ReconstructConfigSchema>;

// ── Loader ───────────────────────────────────────────────────────────────────

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (
    typeof base !== "object" || base === null ||
    typeof override !== "object" || override === null
  ) {
    return override ?? base;
  }
  const result = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    result[k] = deepMerge(result[k], v);
  }
  return result;
}

let _config: ReconstructConfig | null = null;

export function loadConfig(overrides?: Partial<ReconstructConfig>): ReconstructConfig {
  if (_config && !overrides) return _config;

  // Global config: ~/.reconstruct/config.json
  const globalPath = join(homedir(), ".reconstruct", "config.json");
  const globalRaw = existsSync(globalPath) ? readJsonFile(globalPath) : {};

  // Project config: ./reconstruct.config.json
  const projectPath = join(process.cwd(), "reconstruct.config.json");
  const projectRaw = existsSync(projectPath) ? readJsonFile(projectPath) : {};

  // Merge: global → project → call-level overrides
  const merged = deepMerge(deepMerge(globalRaw, projectRaw), overrides ?? {});

  const result = ReconstructConfigSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`reconstruct.config.json is invalid:\n${issues}`);
  }

  _config = result.data;
  return _config;
}

// Reset cache (used in tests or after init)
export function resetConfig(): void {
  _config = null;
}
