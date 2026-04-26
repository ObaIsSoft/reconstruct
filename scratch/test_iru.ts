
import { crawlSite } from "../src/scrapers/cascade.js";
import { mergeCrawlToSchema } from "../src/extractors/merge.js";
import { writeCache } from "../src/cache/store.js";
import { loadConfig } from "../src/schema/config.js";

async function main() {
  const url = "https://www.iru.com/";
  console.log(`Starting analysis for ${url}...`);

  try {
    const config = loadConfig();
    const crawl = await crawlSite(url, { crawl: { max_pages: 5 } });
    console.log(`Crawl complete. Pages found: ${crawl.pages.length}`);

    const schema = await mergeCrawlToSchema(url, crawl);
    console.log("Analysis complete. Design Schema extracted.");
    
    console.log("\n--- Design DNA ---");
    console.log("Primary Colors:", schema.design.colors.palette.slice(0, 3).map(c => c.value));
    console.log("Typography:", schema.design.typography.families.map(f => f.family));
    console.log("Personality:", schema.philosophy.personality);
    
    const cacheDir = ".reconstruct/cache";
    writeCache(url, schema, cacheDir, 24);
    console.log(`\nResults cached to ${cacheDir}`);
  } catch (err) {
    console.error("Analysis failed:", err);
  }
}

main();
