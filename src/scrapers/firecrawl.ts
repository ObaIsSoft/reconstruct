// Firecrawl scraper — full site crawl, multi-page markdown extraction
// Docs: https://docs.firecrawl.dev

type FirecrawlRecord = Record<string, unknown>;

function isFirecrawlRecord(obj: unknown): obj is FirecrawlRecord {
  return obj !== null && typeof obj === "object";
}

function isScrapeResponse(obj: unknown): obj is {
  success: boolean;
  data?: {
    markdown?: string;
    html?: string;
    metadata?: Record<string, unknown>;
    links?: string[];
  };
} {
  return isFirecrawlRecord(obj);
}

export interface FirecrawlPage {
  url: string;
  markdown: string;
  html: string;
  title: string;
  links: string[];
  metadata: {
    description?: string;
    og_image?: string;
    og_title?: string;
    status_code?: number;
  };
}

export interface FirecrawlCrawlResult {
  pages: FirecrawlPage[];
  total_pages: number;
  crawl_id: string;
}

export interface FirecrawlScrapeResult {
  page: FirecrawlPage;
  success: boolean;
  error?: string;
}

// ── Client ────────────────────────────────────────────────────────────────────

export class FirecrawlClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = "https://api.firecrawl.dev") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Firecrawl ${res.status} on ${path}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers });
    if (!res.ok) {
      throw new Error(`Firecrawl GET ${res.status} on ${path}`);
    }
    return res.json() as Promise<T>;
  }

  // Single page scrape
  async scrape(url: string, cookies?: string): Promise<FirecrawlScrapeResult> {
    try {
      const body: Record<string, unknown> = {
        url,
        formats: ["markdown", "html", "links"],
        onlyMainContent: false,
        includeTags: ["nav", "footer", "header", "main", "article", "section"],
      };
      if (cookies) {
        body.headers = { Cookie: cookies };
      }

      const raw = await this.post<unknown>("/v1/scrape", body);
      const data = isScrapeResponse(raw) ? raw : null;

      if (!data || !data.success) {
        return {
          success: false,
          page: {
            url,
            markdown: "",
            html: "",
            title: "",
            links: [],
            metadata: {},
          },
          error: "Firecrawl request failed",
        };
      }

      return {
        success: data.success,
        page: {
          url,
          markdown: data.data?.markdown ?? "",
          html: data.data?.html ?? "",
          title: String(data.data?.metadata?.["title"] ?? ""),
          links: Array.isArray(data.data?.links) 
            ? data.data.links.filter((l): l is string => typeof l === "string")
            : [],
          metadata: {
            description: String(data.data?.metadata?.["description"] ?? ""),
            og_image: String(data.data?.metadata?.["ogImage"] ?? ""),
            og_title: String(data.data?.metadata?.["ogTitle"] ?? ""),
            status_code: Number(data.data?.metadata?.["statusCode"] ?? 200),
          },
        },
      };
    } catch (err) {
      return {
        success: false,
        page: {
          url,
          markdown: "",
          html: "",
          title: "",
          links: [],
          metadata: {},
        },
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Full site crawl — async, polls until complete
  async crawl(
    url: string,
    options: {
      max_pages?: number;
      max_depth?: number;
      exclude_patterns?: string[];
      include_patterns?: string[];
      cookies?: string;
      timeout_ms?: number;
    } = {}
  ): Promise<FirecrawlCrawlResult> {
    const body: Record<string, unknown> = {
      url,
      limit: options.max_pages ?? 50,
      maxDepth: options.max_depth ?? 3,
      scrapeOptions: {
        formats: ["markdown", "html", "links"],
        onlyMainContent: false,
        includeTags: ["nav", "footer", "header", "main", "article", "section"],
      },
    };

    if (options.exclude_patterns?.length) {
      body.excludePaths = options.exclude_patterns;
    }
    if (options.include_patterns?.length) {
      body.includePaths = options.include_patterns;
    }
    if (options.cookies) {
      (body.scrapeOptions as Record<string, unknown>).headers = {
        Cookie: options.cookies,
      };
    }

    // Start crawl job
    const job = await this.post<{ id: string; success: boolean }>("/v1/crawl", body);
    if (!job.success || !job.id) {
      throw new Error("Firecrawl crawl job failed to start");
    }

    const crawlId = job.id;
    const timeout = options.timeout_ms ?? 300_000;  // 5 min default
    const deadline = Date.now() + timeout;

    // Poll until done
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));

      const status = await this.get<{
        status: string;
        total?: number;
        data?: Array<{
          markdown?: string;
          html?: string;
          metadata?: Record<string, unknown>;
          links?: string[];
        }>;
      }>(`/v1/crawl/${crawlId}`);

      if (status.status === "completed" && status.data) {
        const pages: FirecrawlPage[] = status.data.map((item, i) => ({
          url: String(item.metadata?.["sourceURL"] ?? `${url}#page-${i}`),
          markdown: item.markdown ?? "",
          html: item.html ?? "",
          title: String(item.metadata?.["title"] ?? ""),
          links: Array.isArray(item.links) 
            ? item.links.filter((l): l is string => typeof l === "string")
            : [],
          metadata: {
            description: String(item.metadata?.["description"] ?? ""),
            og_image: String(item.metadata?.["ogImage"] ?? ""),
            og_title: String(item.metadata?.["ogTitle"] ?? ""),
            status_code: Number(item.metadata?.["statusCode"] ?? 200),
          },
        }));

        return { pages, total_pages: pages.length, crawl_id: crawlId };
      }

      if (status.status === "failed") {
        throw new Error(`Firecrawl crawl ${crawlId} failed`);
      }
    }

    throw new Error(`Firecrawl crawl ${crawlId} timed out after ${timeout}ms`);
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createFirecrawlClient(
  apiKey: string,
  apiUrl?: string
): FirecrawlClient {
  if (!apiKey) throw new Error("Firecrawl API key is required");
  return new FirecrawlClient(apiKey, apiUrl);
}
