# Usage Guide — reconstruct-mcp

## Quick start

1. Install and configure (see [README](./README.md))
2. Run `reconstruct_analyze` on any URL first — all other tools read from its cache
3. Then run `explain`, `clone`, `cannibalize`, `diff`, or `hypothetical`

---

## Tools

### `reconstruct_analyze`

Full deconstruction of a website. Crawls pages, extracts design tokens, tech stack, components, interactions, and design philosophy. Writes results to the local cache. **Run this first.**

```
reconstruct_analyze({
  url: "https://linear.app",
  depth: "deep",           // "surface" = homepage only, "deep" = full crawl
  max_pages: 50,           // optional: override config.crawl.max_pages
  force_refresh: false     // true = ignore cache and re-scrape
})
```

**Returns:** A markdown report with technology, design system, philosophy, components, and site structure summaries, followed by the full `ReconstructSchema` JSON.

**Coverage warnings:** If `max_pages` is hit before all pages are crawled, you'll see a `⚠️` notice. Increase the limit for fuller coverage.

---

### `reconstruct_explain`

Converts a cached schema into a human-readable explanation at a chosen audience level.

```
reconstruct_explain({
  url: "https://linear.app",
  audience: 3,             // 1=newbie, 2=student, 3=designer, 4=developer, 5=AI/agent
  focus: "design"          // optional: "design" | "tech" | "structure" | "all"
})
```

**Audience levels:**

| Level | For | Output style |
|---|---|---|
| 1 | Newbie | Plain language, zero jargon |
| 2 | Student | Concepts explained with analogies |
| 3 | Designer | Visual and aesthetic language |
| 4 | Developer | Technical, implementation-focused |
| 5 | AI / Agent | Pure JSON blocks, machine-readable |

---

### `reconstruct_hypothetical`

Reasons about "what if" changes against the site's current design state.

```
reconstruct_hypothetical({
  url: "https://linear.app",
  question: "What if we switched to a warm color palette?"
})
```

More examples:
```
"Why doesn't Linear use a serif font?"
"What would happen if they added a sidebar navigation?"
"How would this site look with glassmorphism instead of minimalism?"
```

---

### `reconstruct_clone`

Generates a codebase scaffold that recreates the site's design system, layout, and components.

```
reconstruct_clone({
  url: "https://linear.app",
  framework: "react",      // "html" | "react" | "vue" | "svelte" | "tokens"
  scope: "full"            // "tokens" | "components" | "full"
})
```

**Framework options:**

| Value | Output |
|---|---|
| `html` | Vanilla HTML + CSS |
| `react` | React + Tailwind (Next.js App Router layout) |
| `vue` | Vue 3 + Tailwind |
| `svelte` | SvelteKit components |
| `tokens` | Design tokens only (CSS custom properties + Style Dictionary JSON) |

**Scope options:**

| Value | Includes |
|---|---|
| `tokens` | Design token CSS vars + JSON (colors, typography, spacing, motion, radius) |
| `components` | Token output + component library scaffold |
| `full` | Tokens + components + full page layout |

---

### `reconstruct_cannibalize`

Splices design elements from multiple sites into one unified design spec. Surfaces conflicts and resolves them.

```
reconstruct_cannibalize({
  sources: [
    { url: "https://linear.app",    take: ["colors", "spacing"] },
    { url: "https://www.notion.so", take: ["typography", "philosophy"] },
    { url: "https://vercel.com",    take: ["motion", "elevation"] }
  ],
  intent: "A task manager that feels like Linear but breathes like Notion, with Vercel's animations",
  output_framework: "react",
  constraints: "dark mode first, accessibility AA required"
})
```

**`take` values per source:**

`colors`, `typography`, `spacing`, `motion`, `components`, `layout`, `interactions`, `philosophy`, `elevation`, `border_radius`, `all`

**Returns:** Design lineage table, conflict resolutions, synthesised CSS tokens, creative brief, and a component scaffold.

**Note:** If a source URL is not cached, it will be analyzed automatically (up to 10 pages). For best results, run `reconstruct_analyze` on each source first.

---

### `reconstruct_diff`

Compares the current cached analysis against a Wayback Machine snapshot to show what changed over time.

```
reconstruct_diff({
  url: "https://stripe.com",
  snapshot_date: "20230101"   // YYYYMMDD — omit for most recent Wayback snapshot
})
```

**Returns:** A diff report covering:
- Tech stack changes (framework, rendering strategy, libraries added/removed)
- Design changes (color palette size, font family, base font size, spacing unit, dark mode)
- Philosophy drift (design school, density)

**Prerequisite:** `reconstruct_analyze` must have been run first so a current schema is cached.

---

## Configuration

Create `reconstruct.config.json` in your project root (or run `npx reconstruct-mcp init`):

```json
{
  "_note": "Reconstruct crawls up to max_pages. Coverage completeness is your responsibility.",
  "crawl": {
    "max_pages": 50,
    "max_depth": 3,
    "timeout_per_page": 10000
  },
  "scrapers": {
    "prefer": "auto",
    "lightpanda_url": "http://localhost:9222",
    "firecrawl_api_key": "",
    "browserbase_api_key": "",
    "browserbase_project_id": ""
  },
  "output": {
    "default_audience": 4,
    "cache_ttl_hours": 24,
    "cache_dir": ".reconstruct/cache"
  },
  "auth": {
    "cookies": {
      "app.example.com": "session=abc123"
    }
  }
}
```

A global config at `~/.reconstruct/config.json` is merged under the project config.

### Environment variables

All scraper keys can be injected via environment variables (useful in Claude Desktop / Cursor `"env"` blocks):

| Variable | Effect |
|---|---|
| `FIRECRAWL_API_KEY` | Enables Firecrawl scraper |
| `FIRECRAWL_API_URL` | Firecrawl API base URL (default: `https://api.firecrawl.dev`) |
| `BROWSERBASE_API_KEY` | Enables Browserbase scraper |
| `BROWSERBASE_PROJECT_ID` | Browserbase project |
| `LIGHTPANDA_URL` | Lightpanda WebSocket URL (default: `http://localhost:9222`) |
| `RECONSTRUCT_PREFER` | Force a specific scraper (`auto` / `webfetch` / `lightpanda` / `firecrawl` / `browserbase`) |
| `RECONSTRUCT_MAX_PAGES` | Override `crawl.max_pages` |
| `RECONSTRUCT_CACHE_DIR` | Override `output.cache_dir` |

Example `claude_desktop_config.json` with env injection:

```json
{
  "mcpServers": {
    "reconstruct": {
      "command": "npx",
      "args": ["reconstruct-mcp"],
      "env": {
        "FIRECRAWL_API_KEY": "fc-...",
        "RECONSTRUCT_MAX_PAGES": "100"
      }
    }
  }
}
```

---

## Scraper cascade

When `scrapers.prefer` is `"auto"`, Reconstruct picks the cheapest scraper that works:

| Priority | Scraper | Best for | Requires |
|---|---|---|---|
| 1 | **WebFetch** | Static sites, CSS extraction | Nothing |
| 2 | **Lightpanda** | JS-heavy SPAs | Local Lightpanda on `:9222` |
| 3 | **Firecrawl** | Multi-page bulk crawls | `FIRECRAWL_API_KEY` |
| 4 | **Browserbase** | Auth-walled pages | `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` |

Force a specific scraper:
```json
{ "scrapers": { "prefer": "firecrawl" } }
```

---

## Cache

Analysis results are stored in `.reconstruct/cache/` (or `output.cache_dir` from config) as JSON files keyed by URL hash. The TTL is `output.cache_ttl_hours` (default 24 hours).

Force a fresh analysis with `force_refresh: true`:
```
reconstruct_analyze({ url: "https://example.com", force_refresh: true })
```

---

## Authenticated sites

Pass cookies per hostname in config:

```json
{
  "auth": {
    "cookies": {
      "app.myproduct.com": "session=abc123; __cf_bm=xyz"
    }
  }
}
```

For complex authentication flows, use the Browserbase scraper with `scrapers.prefer: "browserbase"`.

---

## Building from source

```bash
npm install
npm run build      # outputs to dist/
node dist/index.js
```

For local development with hot reload:
```bash
npm run dev
```
