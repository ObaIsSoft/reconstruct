# CLAUDE.md — reconstruct-mcp

## What this project is

**reconstruct-mcp** is a Model Context Protocol (MCP) server that forensically deconstructs websites. It crawls, extracts, and semantically models a site's design tokens, tech stack, component tree, and design philosophy — then lets you explain, clone, cannibalize, or diff the result.

## Commands

```bash
npm run build      # tsc → dist/
npm run dev        # tsx watch src/index.ts (hot reload)
npm run start      # node dist/index.js
npm run init       # write reconstruct.config.json with defaults
```

## Architecture

```
src/
  index.ts              # MCP server entry — registers all tools
  tools/
    analyze.ts          # reconstruct_analyze — crawl + extract → cache + schema
    explain.ts          # reconstruct_explain — schema → human narrative
    hypothetical.ts     # reconstruct_hypothetical — "what if" reasoning
    clone.ts            # reconstruct_clone — schema → codebase scaffold
    cannibalize.ts      # reconstruct_cannibalize — splice N sites into one spec
    diff.ts             # reconstruct_diff — compare vs Wayback Machine snapshot
  scrapers/
    cascade.ts          # Orchestrates scraper selection (the waterfall)
    webfetch.ts         # Cheapest: plain HTTP fetch, Wayback API
    lightpanda.ts       # JS SPAs: connects to local Lightpanda on :9222
    firecrawl.ts        # Bulk crawls: Firecrawl API
    browserbase.ts      # Auth-walled: Browserbase API
  extractors/
    css.ts              # CSS token extraction (colors, spacing, typography, motion)
    dom.ts              # DOM → semantic structure (sections, nav, page layout)
    tech.ts             # Detects framework, rendering strategy, libs
    philosophy.ts       # Infers design school, density, personality
    interactions.ts     # Hover/focus states, transitions
    merge.ts            # Assembles CrawlResult → ReconstructSchema
  schema/
    types.ts            # All TypeScript types (ReconstructSchema and friends)
    config.ts           # Zod schemas + loadConfig() + config merge logic
  cache/
    store.ts            # Read/write .reconstruct/cache/<url-hash>.json
  cli/
    init.ts             # Writes reconstruct.config.json to cwd
```

### Data flow

```
reconstruct_analyze:
  crawlSite() [cascade.ts]
    → WebFetch / Lightpanda / Firecrawl / Browserbase
  mergeCrawlToSchema() [merge.ts]
    → extractCSSTokens, detectTechStack, inferPhilosophy, extractDOMStructure
  writeCache() → .reconstruct/cache/

reconstruct_explain / clone / cannibalize / diff / hypothetical:
  readCache() → build output from cached ReconstructSchema
```

## Key invariants

- **Every tool** must return `{ content: [{ type: "text", text }], isError: true }` on failure — never throw out of a tool handler.
- **Always use `loadConfig()`** from `src/schema/config.ts`. Never hardcode keys or paths.
- **ESM imports** require `.js` extensions: `import { x } from "./file.js"`.
- **Zod validates everything**: tool inputs, config, and schema shapes.
- `reconstruct_analyze` must run before any other tool (cache must exist).

## Adding a tool

1. Create `src/tools/mytool.ts` — export `registerMyTool(server: McpServer): void`
2. Add `import { registerMyTool } from "./tools/mytool.js"` to `src/index.ts`
3. Call `registerMyTool(server)` in `src/index.ts`
4. Input schema via Zod inline in `server.tool(name, description, schema, handler)`

## Updating the data model

- **`src/schema/types.ts`** — TypeScript types for `ReconstructSchema` and all sub-tokens
- **`src/extractors/merge.ts`** — assembles the final schema; update here if fields change
- **`src/schema/config.ts`** — config structure; update Zod schemas + `loadConfig()` merge logic if new config keys added

## Config resolution order

```
~/.reconstruct/config.json     (global)
  ← reconstruct.config.json   (project root)
    ← environment variables   (FIRECRAWL_API_KEY, BROWSERBASE_API_KEY, etc.)
      ← loadConfig(overrides) (per-call)
```

## Environment variables

| Variable | Maps to |
|---|---|
| `FIRECRAWL_API_KEY` | `scrapers.firecrawl_api_key` |
| `FIRECRAWL_API_URL` | `scrapers.firecrawl_api_url` |
| `BROWSERBASE_API_KEY` | `scrapers.browserbase_api_key` |
| `BROWSERBASE_PROJECT_ID` | `scrapers.browserbase_project_id` |
| `LIGHTPANDA_URL` | `scrapers.lightpanda_url` |
| `RECONSTRUCT_PREFER` | `scrapers.prefer` |
| `RECONSTRUCT_MAX_PAGES` | `crawl.max_pages` |
| `RECONSTRUCT_CACHE_DIR` | `output.cache_dir` |

## TypeScript notes

- Strict mode is on — no implicit any.
- Zod v4: `.default({})` on nested schemas does **not** cascade field defaults. Parse each sub-schema individually first (see `loadConfig` in `config.ts`).
- `ReconstructSchemaSurface` (`types.ts`) is a `Pick<ReconstructSchema, "meta" | "technology" | "design" | "philosophy">` for surface-level / homepage-only analysis.
