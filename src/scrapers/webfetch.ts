// WebFetch scraper — raw HTML, CSS, robots.txt, sitemap
// Uses native fetch. No external dependencies.

export interface FetchResult {
  url: string;
  status: number;
  content_type: string;
  body: string;
  ok: boolean;
  error?: string;
}

export interface SitemapResult {
  urls: string[];
  sitemap_urls: string[];   // nested sitemaps found
}

export interface RobotsResult {
  sitemap_urls: string[];
  disallowed: string[];
  crawl_delay?: number;
}

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; Reconstruct-MCP/0.1; +https://github.com/reconstruct-mcp)",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// ── Core fetch ───────────────────────────────────────────────────────────────

export async function fetchUrl(
  url: string,
  options: { cookies?: string; timeout_ms?: number } = {}
): Promise<FetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeout_ms ?? 15000
  );

  try {
    const headers: Record<string, string> = { ...DEFAULT_HEADERS };
    if (options.cookies) headers["Cookie"] = options.cookies;

    const res = await fetch(url, {
      headers,
      signal: controller.signal,
      redirect: "follow",
    });

    const body = await res.text();
    return {
      url: res.url,
      status: res.status,
      content_type: res.headers.get("content-type") ?? "",
      body,
      ok: res.ok,
    };
  } catch (err) {
    return {
      url,
      status: 0,
      content_type: "",
      body: "",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ── CSS fetching ─────────────────────────────────────────────────────────────

export async function fetchStylesheets(
  stylesheetUrls: string[],
  cookies?: string
): Promise<string[]> {
  const results = await Promise.all(
    stylesheetUrls.map((url) => fetchUrl(url, { cookies }))
  );
  return results.filter((r) => r.ok).map((r) => r.body);
}

// Extract <link rel="stylesheet"> hrefs from raw HTML
export function extractStylesheetUrls(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const matches = [
    ...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi),
    ...html.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']stylesheet["']/gi),
  ];

  return [...new Set(
    matches
      .map((m) => {
        try {
          return new URL(m[1], base).href;
        } catch {
          return null;
        }
      })
      .filter((u): u is string => u !== null)
  )];
}

// ── robots.txt ───────────────────────────────────────────────────────────────

export async function fetchRobots(baseUrl: string): Promise<RobotsResult> {
  const robotsUrl = new URL("/robots.txt", baseUrl).href;
  const result = await fetchUrl(robotsUrl);

  if (!result.ok) return { sitemap_urls: [], disallowed: [] };

  const lines = result.body.split("\n").map((l) => l.trim());
  const sitemap_urls: string[] = [];
  const disallowed: string[] = [];
  let crawl_delay: number | undefined;

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith("sitemap:")) {
      const url = line.slice("sitemap:".length).trim();
      if (url) sitemap_urls.push(url);
    } else if (lower.startsWith("disallow:")) {
      const path = line.slice("disallow:".length).trim();
      if (path) disallowed.push(path);
    } else if (lower.startsWith("crawl-delay:")) {
      const val = parseFloat(line.slice("crawl-delay:".length).trim());
      if (!isNaN(val)) crawl_delay = val;
    }
  }

  return { sitemap_urls, disallowed, crawl_delay };
}

// ── sitemap.xml ──────────────────────────────────────────────────────────────

export async function fetchSitemap(
  sitemapUrl: string,
  depth = 0
): Promise<SitemapResult> {
  if (depth > 2) return { urls: [], sitemap_urls: [] };  // guard against deep nesting

  const result = await fetchUrl(sitemapUrl);
  if (!result.ok) return { urls: [], sitemap_urls: [] };

  const body = result.body;
  const urls: string[] = [];
  const sitemap_urls: string[] = [];

  // Sitemap index: contains <sitemap><loc>...</loc></sitemap>
  const sitemapLocs = [...body.matchAll(/<sitemap>[\s\S]*?<loc>(.*?)<\/loc>/gi)].map(
    (m) => m[1].trim()
  );

  if (sitemapLocs.length > 0) {
    sitemap_urls.push(...sitemapLocs);
    // Recursively fetch nested sitemaps
    const nested = await Promise.all(
      sitemapLocs.map((u) => fetchSitemap(u, depth + 1))
    );
    for (const n of nested) urls.push(...n.urls);
  }

  // Regular sitemap: contains <url><loc>...</loc></url>
  const urlLocs = [...body.matchAll(/<url>[\s\S]*?<loc>(.*?)<\/loc>/gi)].map(
    (m) => m[1].trim()
  );
  urls.push(...urlLocs);

  return { urls: [...new Set(urls)], sitemap_urls };
}

// ── Discovery: all URLs from a site ─────────────────────────────────────────

export async function discoverUrls(baseUrl: string): Promise<{
  urls: string[];
  sitemap_urls: string[];
  disallowed: string[];
}> {
  const base = new URL(baseUrl);

  // 1. robots.txt
  const robots = await fetchRobots(baseUrl);

  // 2. Try common sitemap paths if robots didn't list one
  let sitemapUrls = robots.sitemap_urls;
  if (sitemapUrls.length === 0) {
    const fallbacks = ["/sitemap.xml", "/sitemap_index.xml", "/sitemap/sitemap.xml"];
    const checks = await Promise.all(
      fallbacks.map(async (path) => {
        const url = new URL(path, base).href;
        const r = await fetchUrl(url);
        return r.ok ? url : null;
      })
    );
    sitemapUrls = checks.filter((u): u is string => u !== null);
  }

  // 3. Fetch all sitemaps in parallel
  const sitemapResults = await Promise.all(
    sitemapUrls.map((u) => fetchSitemap(u))
  );

  const allUrls = sitemapResults.flatMap((r) => r.urls);

  // 4. Filter to same-origin only
  const sameOrigin = allUrls.filter((u) => {
    try {
      return new URL(u).hostname === base.hostname;
    } catch {
      return false;
    }
  });

  return {
    urls: [...new Set(sameOrigin)],
    sitemap_urls: sitemapUrls,
    disallowed: robots.disallowed,
  };
}

// ── Wayback CDX — temporal diff ──────────────────────────────────────────────

export interface WaybackSnapshot {
  timestamp: string;    // YYYYMMDDHHmmss
  url: string;
  status: string;
  snapshot_url: string;
}

export async function fetchWaybackSnapshots(
  url: string,
  limit = 5
): Promise<WaybackSnapshot[]> {
  const cdxUrl =
    `http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json&limit=${limit}&fl=timestamp,original,statuscode&filter=statuscode:200&collapse=timestamp:6`;

  const result = await fetchUrl(cdxUrl);
  if (!result.ok) return [];

  try {
    const rows: string[][] = JSON.parse(result.body);
    // First row is headers
    return rows.slice(1).map(([timestamp, original, status]) => ({
      timestamp,
      url: original,
      status,
      snapshot_url: `https://web.archive.org/web/${timestamp}/${original}`,
    }));
  } catch {
    return [];
  }
}
