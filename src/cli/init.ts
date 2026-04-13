#!/usr/bin/env node
// npx reconstruct-mcp init
// Scaffolds reconstruct.config.json in the current directory

import { writeFileSync, existsSync } from "fs";
import { join } from "path";

const CONFIG_PATH = join(process.cwd(), "reconstruct.config.json");

const DEFAULT_CONFIG = {
  _note:
    "Reconstruct crawls up to max_pages. Increase for larger sites. Coverage completeness is your responsibility.",
  crawl: {
    max_pages: 50,
    max_depth: 3,
    dynamic_sample_size: 5,
    trigger_interactions: true,
    scroll_to_load: true,
    timeout_per_page: 10000,
    exclude_patterns: [],
    include_patterns: [],
  },
  scrapers: {
    prefer: "auto",
    lightpanda_url: "http://localhost:9222",
    firecrawl_api_key: "",
    firecrawl_api_url: "https://api.firecrawl.dev",
    browserbase_api_key: "",
    browserbase_project_id: "",
  },
  output: {
    default_audience: 4,
    cache_ttl_hours: 24,
    cache_dir: ".reconstruct/cache",
  },
  auth: {
    cookies: {},
  },
};

if (existsSync(CONFIG_PATH)) {
  console.log(`reconstruct.config.json already exists at ${CONFIG_PATH}`);
  console.log("Remove it first if you want to reinitialise.");
  process.exit(0);
}

writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", "utf-8");

console.log(`
✓ Created reconstruct.config.json

Quick start:
  1. Set your API keys in reconstruct.config.json (Firecrawl, Browserbase)
  2. Add to Claude Desktop / Cursor:
     {
       "mcpServers": {
         "reconstruct": {
           "command": "npx",
           "args": ["reconstruct-mcp"]
         }
       }
     }
  3. In Claude: reconstruct_analyze("https://yoursite.com")

Coverage note: The default max_pages=50 covers most marketing sites.
Increase it for large apps. Completeness is configured by you.
`);
