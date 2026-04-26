import { extractStylesheetUrls } from "../src/scrapers/webfetch.js";
import fs from "fs";

async function test() {
  const url = "https://www.iru.com/";
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html"
  };
  const res = await fetch(url, { headers });
  const html = await res.text();
  
  console.log("HTML length:", html.length);
  const urls = extractStylesheetUrls(html, url);
  console.log("Discovered CSS URLs:", urls.length);
  urls.forEach(u => console.log(" -", u));
}

test();
