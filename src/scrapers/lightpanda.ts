// Lightpanda scraper — DOM, semantic tree, JS evaluation, shadow DOM
// Calls Lightpanda's local HTTP API (runs on configurable port, default 9222)
// The Lightpanda MCP wraps the same underlying service.

export interface LightpandaPage {
  url: string;
  title: string;
  semantic_tree: string;
  interactive_elements: InteractiveElement[];
  shadow_roots: ShadowRoot[];
  stylesheet_urls: string[];
  inline_styles: string[];
  links: PageLink[];
  nav_links: PageLink[];
  footer_links: PageLink[];
  is_spa: boolean;          // detected from DOM structure
  error?: string;
}

export interface InteractiveElement {
  tag: string;
  role: string;
  label: string;
  selector: string;
  attributes: Record<string, string>;
}

export interface ShadowRoot {
  host_tag: string;
  host_selector: string;
  inner_html: string;
}

export interface PageLink {
  href: string;
  label: string;
  rel?: string;
}

// ── Lightpanda API client ─────────────────────────────────────────────────────

// Type guard for API responses
function isRecord(obj: unknown): obj is Record<string, unknown> {
  return obj !== null && typeof obj === "object";
}

export class LightpandaClient {
  private baseUrl: string;
  private sessionId: string | null = null;

  constructor(baseUrl = "http://localhost:9222") {
    this.baseUrl = baseUrl;
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Lightpanda API error ${res.status} on ${path}`);
    }
    return res.json();
  }

  async navigate(url: string, cookies?: string): Promise<void> {
    const result = await this.post("/navigate", {
      url,
      cookies: cookies ?? "",
    });
    if (isRecord(result) && typeof result.session_id === "string") {
      this.sessionId = result.session_id;
    }
  }

  async evaluate(script: string): Promise<string> {
    const result = await this.post("/evaluate", {
      session_id: this.sessionId,
      script,
    });
    if (isRecord(result) && typeof result.result === "string") {
      return result.result;
    }
    return "";
  }

  async getSemanticTree(): Promise<string> {
    const result = await this.post("/semantic-tree", {
      session_id: this.sessionId,
    });
    if (isRecord(result) && typeof result.tree === "string") {
      return result.tree;
    }
    return "";
  }

  async getInteractiveElements(): Promise<InteractiveElement[]> {
    const result = await this.post("/interactive-elements", {
      session_id: this.sessionId,
    });
    if (isRecord(result) && Array.isArray(result.elements)) {
      return result.elements as InteractiveElement[];
    }
    return [];
  }

  async close(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await this.post("/close", { session_id: this.sessionId });
    } catch (err) {
      console.warn(`[lightpanda] Close session error:`, err instanceof Error ? err.message : String(err));
    }
    this.sessionId = null;
  }
}

// ── JS snippets run via evaluate() ───────────────────────────────────────────

const SCRIPTS = {
  stylesheetUrls: `
    (function() {
      const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .map(l => l.href).filter(Boolean);
      return JSON.stringify(links);
    })()
  `,

  inlineStyles: `
    (function() {
      const styles = Array.from(document.querySelectorAll('style'))
        .map(s => s.textContent || '').filter(Boolean);
      return JSON.stringify(styles);
    })()
  `,

  shadowRoots: `
    (function() {
      const roots = [];
      document.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) {
          roots.push({
            host_tag: el.tagName.toLowerCase(),
            host_selector: el.id ? '#' + el.id : el.className ? '.' + el.className.split(' ')[0] : el.tagName.toLowerCase(),
            inner_html: el.shadowRoot.innerHTML
          });
        }
      });
      return JSON.stringify(roots);
    })()
  `,

  allLinks: `
    (function() {
      const links = Array.from(document.querySelectorAll('a[href]')).map(a => ({
        href: a.href,
        label: (a.textContent || a.getAttribute('aria-label') || '').trim().slice(0, 100),
        rel: a.getAttribute('rel') || ''
      }));
      return JSON.stringify(links);
    })()
  `,

  navLinks: `
    (function() {
      const navEl = document.querySelector('nav, [role="navigation"], header');
      if (!navEl) return JSON.stringify([]);
      const links = Array.from(navEl.querySelectorAll('a[href]')).map(a => ({
        href: a.href,
        label: (a.textContent || '').trim().slice(0, 100),
        rel: ''
      }));
      return JSON.stringify(links);
    })()
  `,

  footerLinks: `
    (function() {
      const footer = document.querySelector('footer, [role="contentinfo"]');
      if (!footer) return JSON.stringify([]);
      const links = Array.from(footer.querySelectorAll('a[href]')).map(a => ({
        href: a.href,
        label: (a.textContent || '').trim().slice(0, 100),
        rel: ''
      }));
      return JSON.stringify(links);
    })()
  `,

  isSpa: `
    (function() {
      const body = document.body;
      const children = Array.from(body.children).filter(el =>
        !['script','style','noscript'].includes(el.tagName.toLowerCase())
      );
      // SPA signal: single root div with id="root" or id="app" and little else
      const isSingleRoot = children.length === 1 &&
        ['root','app','__next','__nuxt'].includes(children[0].id?.toLowerCase());
      const hasMinimalContent = document.body.innerText.trim().length < 200;
      return JSON.stringify(isSingleRoot && hasMinimalContent);
    })()
  `,

  expandInteractions: `
    (function() {
      // Click all disclosure buttons (accordions, tabs, dropdowns)
      const triggers = document.querySelectorAll(
        '[aria-expanded="false"], details:not([open]) > summary, [data-state="closed"]'
      );
      triggers.forEach(el => { try { el.click(); } catch {} });
      // Scroll to bottom to trigger lazy loads
      window.scrollTo(0, document.body.scrollHeight);
      return JSON.stringify({ expanded: triggers.length });
    })()
  `,
};

// ── Main scrape function ──────────────────────────────────────────────────────

export async function scrapePage(
  url: string,
  options: {
    lightpanda_url?: string;
    cookies?: string;
    trigger_interactions?: boolean;
    scroll_to_load?: boolean;
    timeout_ms?: number;
  } = {}
): Promise<LightpandaPage> {
  const client = new LightpandaClient(options.lightpanda_url ?? "http://localhost:9222");

  try {
    await client.navigate(url, options.cookies);

    // Check SPA first — if SPA signal and minimal content, wait for JS
    const isSpaRaw = await client.evaluate(SCRIPTS.isSpa);
    const is_spa: boolean = JSON.parse(isSpaRaw || "false");

    // Expand interactions (accordions, tabs, scroll) to surface hidden content
    if (options.trigger_interactions !== false) {
      await client.evaluate(SCRIPTS.expandInteractions);
      // Small pause for JS to settle after expansions
      await new Promise((r) => setTimeout(r, 300));
    }

    // Parallel extraction after page is ready
    const [
      stylesheetUrlsRaw,
      inlineStylesRaw,
      shadowRootsRaw,
      allLinksRaw,
      navLinksRaw,
      footerLinksRaw,
      semanticTree,
      interactiveElements,
    ] = await Promise.all([
      client.evaluate(SCRIPTS.stylesheetUrls),
      client.evaluate(SCRIPTS.inlineStyles),
      client.evaluate(SCRIPTS.shadowRoots),
      client.evaluate(SCRIPTS.allLinks),
      client.evaluate(SCRIPTS.navLinks),
      client.evaluate(SCRIPTS.footerLinks),
      client.getSemanticTree(),
      client.getInteractiveElements(),
    ]);

    const parse = <T>(raw: string, fallback: T): T => {
      try { return JSON.parse(raw) as T; } catch { return fallback; }
    };

    const title =
      semanticTree.match(/^#\s+(.+)/m)?.[1]?.trim() ?? "";

    return {
      url,
      title,
      semantic_tree: semanticTree,
      interactive_elements: interactiveElements,
      shadow_roots: parse<ShadowRoot[]>(shadowRootsRaw, []),
      stylesheet_urls: parse<string[]>(stylesheetUrlsRaw, []),
      inline_styles: parse<string[]>(inlineStylesRaw, []),
      links: parse<PageLink[]>(allLinksRaw, []),
      nav_links: parse<PageLink[]>(navLinksRaw, []),
      footer_links: parse<PageLink[]>(footerLinksRaw, []),
      is_spa,
    };
  } catch (err) {
    return {
      url,
      title: "",
      semantic_tree: "",
      interactive_elements: [],
      shadow_roots: [],
      stylesheet_urls: [],
      inline_styles: [],
      links: [],
      nav_links: [],
      footer_links: [],
      is_spa: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await client.close();
  }
}
