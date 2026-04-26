import { cascade } from "../src/scrapers/cascade";
import { loadConfig } from "../src/config";

async function debug() {
  const config = await loadConfig();
  const url = "https://www.iru.com/";
  
  console.log("--- DEBUG START ---");
  console.log("Config Scrapers:", config.scrapers.prefer);
  
  try {
    const result = await (cascade as any).scrapeSinglePage(url, config);
    console.log("Scraper Used:", result.used_scraper);
    console.log("HTML Length:", result.html?.length || 0);
    console.log("CSS Text count:", result.css_text?.length || 0);
    console.log("Stylesheet URLs count:", result.stylesheet_urls?.length || 0);
    console.log("Error:", result.error || "none");
    
    if (result.html) {
      console.log("HTML Snippet:", result.html.slice(0, 500));
    }
  } catch (e) {
    console.error("Cascade failed:", e);
  }
}

debug();
