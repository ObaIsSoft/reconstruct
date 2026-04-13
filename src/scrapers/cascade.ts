// Cascade orchestrator — URL classification, tool selection, discovery, full crawl
// Decides which scraper(s) to use based on site characteristics and config.

import { loadConfig, type ReconstructConfig } from "../schema/config.js";
import { type URLClass } from "../schema/types.js";
import {
  fetchUrl,
  fetchStylesheets,
  extractStylesheetUrls,
  discoverUrls,
  type FetchResult,
} from "./webfetch.js";
import { scrapePage, type LightpandaPage } from "./lightpanda.js";
import { createFirecrawlClient, type FirecrawlPage } from "./firecrawl.js";
import { scrapeWithBrowserbase, type BrowserbasePage } from "./browserbase.js";

// ── URL Classification ────────────────────────────────────────────────────────

const DYNAMIC_PATTERNS = [
  /\/[^/]*\[.*?\]/,          // Next.js [slug]
  /\/:[a-z_]+/,              // Express :param
  /\/\{[^}]+\}/,             // OpenAPI {param}
  /\/\d{4,}/,                // numeric IDs
  /\/[a-f0-9]{24,}/,         // MongoDB ObjectId-style
];

const AUTH_PATTERNS = [
  /\/(login|signin|sign-in|auth|authenticate)/i,
  /\/(dashboard|account|profile|settings|admin)/i,
  /\/(app)\//i,
];

const ASSET_EXTENSIONS = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
  ".ico", ".mp4", ".mp3", ".zip", ".tar", ".gz",
]);

export function classifyUrl(url: string, baseHostname: string): URLClass {
  try {
    const parsed = new URL(url);

    if (parsed.hostname !== baseHostname) return "external";

    const path = parsed.pathname;
    const ext = path.slice(path.lastIndexOf("."));

    if (ASSET_EXTENSIONS.has(ext.toLowerCase())) return "asset";
    if (parsed.hash && !parsed.pathname.replace("/", "")) return "anchor";
    if (parsed.searchParams.has("page") || parsed.searchParams.has("p")) return "paginated";
    if (AUTH_PATTERNS.some((p) => p.test(path))) return "auth-walled";
    if (DYNAMIC_PATTERNS.some((p) => p.test(path))) return "dynamic";

    return "static";
  } catch {
    return "external";
  }
}

// ── SPA detection from raw HTML ───────────────────────────────────────────────

export function isSpaHtml(html: string): boolean {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? "";
  const hasRootDiv = /<div\s+id=["'](root|app|__next|__nuxt)["']/i.test(bodyMatch);
  const isMinimal = bodyMatch.replace(/<script[\s\S]*?<\/script>/gi, "").trim().length < 300;
  return hasRootDiv && isMinimal;
}

// Detect if site redirected to login (auth-walled)
export function isAuthWall(finalUrl: string, originalUrl: string): boolean {
  const final = new URL(finalUrl);
  return AUTH_PATTERNS.some((p) => p.test(final.pathname)) &&
    final.href !== new URL(originalUrl).href;
}

// ── Per-page scrape result (unified type) ─────────────────────────────────────

export interface CascadePage {
  url: string;
  title: string;
  html: string;
  markdown: string;
  css_text: string[];
  stylesheet_urls: string[];
  inline_styles: string[];
  semantic_tree: string;
  nav_links: Array<{ href: string; label: string }>;
  footer_links: Array<{ href: string; label: string }>;
  all_links: Array<{ href: string; label: string }>;
  network_requests: Array<{ url: string; method: string; type: string; status: number; size_bytes: number }>;
  is_spa: boolean;
  used_scraper: "webfetch" | "lightpanda" | "firecrawl" | "browserbase";
  error?: string;
}

// ── Single-page cascade ───────────────────────────────────────────────────────

export async function scrapeSinglePage(
  url: string,
  config: ReconstructConfig,
  forceMethod?: "webfetch" | "lightpanda" | "firecrawl" | "browserbase"
): Promise<CascadePage> {
  const prefer = forceMethod ?? config.scrapers.prefer;
  const hostname = new URL(url).hostname;
  const cookies = config.auth.cookies[hostname];

  // Step 1: Always start with a raw fetch to probe the page
  const raw: FetchResult = prefer !== "browserbase"
    ? await fetchUrl(url, { cookies, timeout_ms: config.crawl.timeout_per_page })
    : { url, status: 0, content_type: "", body: "", ok: false };

  const needsBrowser =
    prefer === "lightpanda" ||
    prefer === "browserbase" ||
    (prefer === "auto" && raw.ok && isSpaHtml(raw.body));

  const needsAuth =
    raw.ok && isAuthWall(raw.url, url);

  // Step 2: Decide tool
  if (needsAuth || prefer === "browserbase") {
    if (!config.scrapers.browserbase_api_key) {
      return emptyCascadePage(url, "browserbase", "Browserbase API key not configured");
    }
    const bb: BrowserbasePage = await scrapeWithBrowserbase(url, {
      apiKey: config.scrapers.browserbase_api_key,
      projectId: config.scrapers.browserbase_project_id,
      cookies,
      capture_network: true,
      timeout_ms: config.crawl.timeout_per_page,
    });

    const stylesheetUrls = extractStylesheetUrls(bb.html, url);
    const cssText = await fetchStylesheets(stylesheetUrls, cookies);

    return {
      url,
      title: bb.title,
      html: bb.html,
      markdown: "",
      css_text: cssText,
      stylesheet_urls: stylesheetUrls,
      inline_styles: extractInlineStyles(bb.html),
      semantic_tree: "",
      nav_links: [],
      footer_links: [],
      all_links: [],
      network_requests: bb.network_requests,
      is_spa: isSpaHtml(bb.html),
      used_scraper: "browserbase",
      error: bb.error,
    };
  }

  if (needsBrowser && prefer !== "firecrawl") {
    // Lightpanda
    const lp: LightpandaPage = await scrapePage(url, {
      lightpanda_url: config.scrapers.lightpanda_url,
      cookies,
      trigger_interactions: config.crawl.trigger_interactions,
      scroll_to_load: config.crawl.scroll_to_load,
      timeout_ms: config.crawl.timeout_per_page,
    });

    const cssText = await fetchStylesheets(lp.stylesheet_urls, cookies);

    return {
      url,
      title: lp.title,
      html: raw.body,
      markdown: "",
      css_text: [...cssText, ...lp.inline_styles],
      stylesheet_urls: lp.stylesheet_urls,
      inline_styles: lp.inline_styles,
      semantic_tree: lp.semantic_tree,
      nav_links: lp.nav_links,
      footer_links: lp.footer_links,
      all_links: lp.links,
      network_requests: [],
      is_spa: lp.is_spa,
      used_scraper: "lightpanda",
      error: lp.error,
    };
  }

  if (prefer === "firecrawl") {
    if (!config.scrapers.firecrawl_api_key) {
      return emptyCascadePage(url, "firecrawl", "Firecrawl API key not configured");
    }
    const fc = createFirecrawlClient(
      config.scrapers.firecrawl_api_key,
      config.scrapers.firecrawl_api_url
    );
    const result = await fc.scrape(url, cookies);
    const stylesheetUrls = extractStylesheetUrls(result.page.html, url);
    const cssText = await fetchStylesheets(stylesheetUrls, cookies);

    return {
      url,
      title: result.page.title,
      html: result.page.html,
      markdown: result.page.markdown,
      css_text: cssText,
      stylesheet_urls: stylesheetUrls,
      inline_styles: extractInlineStyles(result.page.html),
      semantic_tree: "",
      nav_links: [],
      footer_links: [],
      all_links: result.page.links.map((href) => ({ href, label: "" })),
      network_requests: [],
      is_spa: isSpaHtml(result.page.html),
      used_scraper: "firecrawl",
      error: result.error,
    };
  }

  // Default: WebFetch only (static site)
  const stylesheetUrls = extractStylesheetUrls(raw.body, url);
  const cssText = await fetchStylesheets(stylesheetUrls, cookies);

  return {
    url,
    title: extractTitle(raw.body),
    html: raw.body,
    markdown: "",
    css_text: cssText,
    stylesheet_urls: stylesheetUrls,
    inline_styles: extractInlineStyles(raw.body),
    semantic_tree: "",
    nav_links: extractNavLinks(raw.body, url),
    footer_links: extractFooterLinks(raw.body, url),
    all_links: extractAllLinks(raw.body, url),
    network_requests: [],
    is_spa: isSpaHtml(raw.body),
    used_scraper: "webfetch",
  };
}

// ── Full site crawl ───────────────────────────────────────────────────────────

export interface CrawlResult {
  pages: CascadePage[];
  urls_discovered: number;
  urls_crawled: number;
  urls_skipped: number;
  urls_auth_walled: number;
  urls_errored: number;
  limit_reached: boolean;
}

export async function crawlSite(
  startUrl: string,
  configOverrides?: Partial<ReconstructConfig>
): Promise<CrawlResult> {
  const config = loadConfig(configOverrides);
  const base = new URL(startUrl);
  const hostname = base.hostname;
  const cookies = config.auth.cookies[hostname];

  // Phase 1: URL discovery
  const { urls: sitemapUrls, disallowed } = await discoverUrls(startUrl);

  // Scrape homepage first to get nav + footer links
  const homePage = await scrapeSinglePage(startUrl, config);
  const navHrefs = homePage.nav_links.map((l) => l.href);
  const footerHrefs = homePage.footer_links.map((l) => l.href);
  const linkHrefs = homePage.all_links.map((l) => l.href);

  // Combine all discovered URLs, same-origin only
  const allDiscovered = [
    startUrl,
    ...sitemapUrls,
    ...navHrefs,
    ...footerHrefs,
    ...linkHrefs,
  ].filter((u) => {
    try {
      return new URL(u).hostname === hostname;
    } catch {
      return false;
    }
  });

  const uniqueUrls = [...new Set(allDiscovered)];
  const urlsDiscovered = uniqueUrls.length;

  // Phase 2: Classify + filter
  const isDisallowed = (u: string) => {
    try {
      const path = new URL(u).pathname;
      return (
        disallowed.some((d) => path.startsWith(d)) ||
        config.crawl.exclude_patterns.some((p) => new RegExp(p).test(u)) ||
        (config.crawl.include_patterns.length > 0 &&
          !config.crawl.include_patterns.some((p) => new RegExp(p).test(u)))
      );
    } catch {
      return true;
    }
  };

  // Group by class for smart sampling
  const classified = uniqueUrls.map((u) => ({
    url: u,
    class: classifyUrl(u, hostname),
  }));

  const dynamicGroups = new Map<string, string[]>();
  const toCrawl: string[] = [startUrl];

  for (const { url, class: cls } of classified) {
    if (url === startUrl) continue;
    if (isDisallowed(url)) continue;
    if (cls === "external" || cls === "asset" || cls === "anchor") continue;

    if (cls === "dynamic") {
      // Group dynamic routes by pattern and sample
      const pattern = url.replace(/\/\d+/g, "/:id").replace(/\/[a-f0-9]{24,}/g, "/:id");
      const group = dynamicGroups.get(pattern) ?? [];
      if (group.length < config.crawl.dynamic_sample_size) {
        group.push(url);
        dynamicGroups.set(pattern, group);
        toCrawl.push(url);
      }
    } else {
      toCrawl.push(url);
    }
  }

  // Phase 3: Crawl up to max_pages
  const pages: CascadePage[] = [homePage];
  let urlsSkipped = uniqueUrls.length - toCrawl.length;
  let urlsAuthWalled = 0;
  let urlsErrored = 0;
  let limitReached = false;

  const remaining = toCrawl.slice(1);  // homePage already done

  // Use Firecrawl for bulk if configured and preferred
  if (
    config.scrapers.prefer === "firecrawl" &&
    config.scrapers.firecrawl_api_key &&
    remaining.length > 5
  ) {
    const fc = createFirecrawlClient(
      config.scrapers.firecrawl_api_key,
      config.scrapers.firecrawl_api_url
    );
    try {
      const crawled = await fc.crawl(startUrl, {
        max_pages: config.crawl.max_pages,
        max_depth: config.crawl.max_depth,
        exclude_patterns: config.crawl.exclude_patterns,
        include_patterns: config.crawl.include_patterns,
        cookies,
        timeout_ms: config.crawl.timeout_per_page * config.crawl.max_pages,
      });

      for (const fp of crawled.pages) {
        if (fp.url === startUrl) continue;  // already have homepage
        const stylesheetUrls = extractStylesheetUrls(fp.html, fp.url);
        const cssText = await fetchStylesheets(stylesheetUrls, cookies);
        pages.push({
          url: fp.url,
          title: fp.title,
          html: fp.html,
          markdown: fp.markdown,
          css_text: cssText,
          stylesheet_urls: stylesheetUrls,
          inline_styles: extractInlineStyles(fp.html),
          semantic_tree: "",
          nav_links: [],
          footer_links: [],
          all_links: fp.links.map((href) => ({ href, label: "" })),
          network_requests: [],
          is_spa: isSpaHtml(fp.html),
          used_scraper: "firecrawl",
        });
      }

      limitReached = crawled.total_pages >= config.crawl.max_pages;
    } catch {
      // Fall through to per-page crawl
    }
  } else {
    // Per-page crawl with concurrency limit of 5
    const CONCURRENCY = 5;
    const queue = [...remaining];
    let crawledCount = 1;  // homepage already done

    while (queue.length > 0 && crawledCount < config.crawl.max_pages) {
      const batch = queue.splice(0, CONCURRENCY);
      const results = await Promise.all(
        batch.map((u) => scrapeSinglePage(u, config))
      );

      for (const page of results) {
        if (crawledCount >= config.crawl.max_pages) {
          limitReached = true;
          break;
        }
        if (page.error?.includes("auth") || isAuthWall(page.url, page.url)) {
          urlsAuthWalled++;
          continue;
        }
        if (page.error) {
          urlsErrored++;
          continue;
        }
        pages.push(page);
        crawledCount++;

        // Discover new links from this page and add to queue
        const newLinks = page.all_links
          .map((l) => l.href)
          .filter((u) => {
            try {
              return (
                new URL(u).hostname === hostname &&
                !toCrawl.includes(u) &&
                !isDisallowed(u) &&
                classifyUrl(u, hostname) !== "external" &&
                classifyUrl(u, hostname) !== "asset"
              );
            } catch {
              return false;
            }
          });

        queue.push(...newLinks);
        toCrawl.push(...newLinks);
      }
    }

    urlsSkipped += queue.length;  // anything still in queue = skipped
  }

  return {
    pages,
    urls_discovered: urlsDiscovered,
    urls_crawled: pages.length,
    urls_skipped: urlsSkipped,
    urls_auth_walled: urlsAuthWalled,
    urls_errored: urlsErrored,
    limit_reached: limitReached,
  };
}

// ── HTML parsing helpers (no DOM needed) ─────────────────────────────────────

function extractTitle(html: string): string {
  return html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? "";
}

function extractInlineStyles(html: string): string[] {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((m) => m[1].trim())
    .filter(Boolean);
}

function extractAllLinks(html: string, baseUrl: string): Array<{ href: string; label: string }> {
  const base = new URL(baseUrl);
  return [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => {
      try {
        return {
          href: new URL(m[1], base).href,
          label: m[2].replace(/<[^>]+>/g, "").trim().slice(0, 100),
        };
      } catch {
        return null;
      }
    })
    .filter((l): l is { href: string; label: string } => l !== null);
}

function extractNavLinks(html: string, baseUrl: string): Array<{ href: string; label: string }> {
  const navMatch = html.match(/<nav[\s\S]*?<\/nav>/i) ??
    html.match(/<header[\s\S]*?<\/header>/i);
  if (!navMatch) return [];
  return extractAllLinks(navMatch[0], baseUrl);
}

function extractFooterLinks(html: string, baseUrl: string): Array<{ href: string; label: string }> {
  const footerMatch = html.match(/<footer[\s\S]*?<\/footer>/i);
  if (!footerMatch) return [];
  return extractAllLinks(footerMatch[0], baseUrl);
}

function emptyCascadePage(
  url: string,
  scraper: CascadePage["used_scraper"],
  error: string
): CascadePage {
  return {
    url,
    title: "",
    html: "",
    markdown: "",
    css_text: [],
    stylesheet_urls: [],
    inline_styles: [],
    semantic_tree: "",
    nav_links: [],
    footer_links: [],
    all_links: [],
    network_requests: [],
    is_spa: false,
    used_scraper: scraper,
    error,
  };
}
