// Explain test — runs full pipeline then explains at all tiers
import { crawlSite } from "./dist/scrapers/cascade.js";
import { mergeCrawlToSchema } from "./dist/extractors/merge.js";
import { buildExplanation } from "./dist/tools/explain.js";
import { writeCache } from "./dist/cache/store.js";
import { homedir } from "os";
import { join } from "path";

const URL = "https://www.inioluwaadebakin.com/";
const CACHE_DIR = join(homedir(), ".reconstruct", "cache");

console.log(`Analyzing ${URL}...\n`);

const crawl = await crawlSite(URL, { crawl: { max_pages: 5 } });
const schema = await mergeCrawlToSchema(URL, crawl);

// Write to cache so MCP tools can use it later
writeCache(URL, schema, CACHE_DIR, 24);
console.log(`Schema cached at ${CACHE_DIR}\n`);

const DIVIDER = "\n" + "═".repeat(70) + "\n";

// Run all tiers
for (const tier of ["succinct", "professional", "newbie"]) {
  console.log(`${DIVIDER}TIER: ${tier.toUpperCase()}${DIVIDER}`);
  console.log(buildExplanation(schema, tier, "all"));
}
