# reconstruct-mcp

Forensically deconstruct, explain, recreate, and cannibalize websites — as an MCP server.

## Tools

| Tool | Description |
|------|-------------|
| `reconstruct_analyze` | Full site crawl → structured schema (design tokens, tech stack, components, philosophy) |
| `reconstruct_explain` | Schema → human explanation at 5 audience levels (newbie → AI/agent) |
| `reconstruct_hypothetical` | "What if we changed X?" / "Why not use Y?" — reasoned against current design state |
| `reconstruct_clone` | Schema → full codebase scaffold in HTML / React / Vue / Svelte / design tokens |
| `reconstruct_cannibalize` | Splice design elements from N sites into a unified synthesis |
| `reconstruct_diff` | Compare current site against a Wayback Machine snapshot — what changed, when |

## Setup

### Claude Desktop / Cursor

```json
{
  "mcpServers": {
    "reconstruct": {
      "command": "npx",
      "args": ["reconstruct-mcp"]
    }
  }
}
```

Config file location:
- macOS/Linux: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Cursor: `.cursor/mcp.json` in your project root or `~/.cursor/mcp.json` globally

### Init config

```bash
npx reconstruct-mcp init
```

Creates `reconstruct.config.json` with all defaults and comments.

### Local High-Power Setup (Optional)

To enable high-fidelity scraping for complex JS-heavy sites without using paid APIs:

```bash
npm run setup
```

**Requirements:**
- Python 3.10+
- ~500MB disk space (for Crawl4AI and Chromium)

## Configuration

`reconstruct.config.json` (project root) or `~/.reconstruct/config.json` (global):

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
    "jina_enabled": true,
    "jina_api_key": "",
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
      "app.example.com": "session=abc123; __cf_bm=xyz"
    }
  }
}
```

**Scraping cascade** (lazy escalation — uses cheapest tool that works):

1. **Jina AI** — instant Markdown (free, no setup)
2. **Crawl4AI** — high-fidelity local scraping (free, requires `npm run setup`)
3. **WebFetch** — static sites, CSS extraction
4. **Lightpanda** — JS-heavy SPAs
5. **Firecrawl** — bulk cloud crawls (requires API key)
6. **Browserbase** — auth-walled pages (requires API key)

All scrapers are optional. Set `prefer: "auto"` to let the cascade decide.

## Usage

```
# Full analysis
reconstruct_analyze({ url: "https://linear.app", depth: "deep" })

# Explain to a designer
reconstruct_explain({ url: "https://linear.app", audience: 3, focus: "design" })

# What-if question
reconstruct_hypothetical({ url: "https://linear.app", question: "What if we switched to a warm color palette?" })

# Clone as React
reconstruct_clone({ url: "https://linear.app", framework: "react", scope: "full" })

# Cannibalize two sites
reconstruct_cannibalize({
  sources: [
    { url: "https://linear.app", take: ["colors", "spacing"] },
    { url: "https://www.notion.so", take: ["typography", "philosophy"] }
  ],
  intent: "A task manager that feels like Linear but breathes like Notion",
  output_framework: "react"
})

# Diff against 2023 snapshot
reconstruct_diff({ url: "https://stripe.com", snapshot_date: "20230101" })
```

## Audience levels

| Level | Audience | Output style |
|-------|----------|-------------|
| 1 | Newbie | Plain language, no jargon |
| 2 | Student | Concepts explained |
| 3 | Designer | Visual + aesthetic focus |
| 4 | Developer | Technical, implementation-focused |
| 5 | AI/Agent | Pure JSON blocks, machine-readable |

## Coverage

Reconstruct reports how many pages it analyzed vs. discovered. When `max_pages` is hit, you'll see a warning. Increase the limit in config for fuller coverage — completeness is configured by you.

## Build from source

```bash
npm install
npm run build
node dist/index.js
```
