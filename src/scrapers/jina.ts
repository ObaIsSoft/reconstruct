// Jina AI Reader scraper — Free, lightweight Markdown/HTML extraction
// Documentation: https://jina.ai/reader/

export interface JinaPage {
  url: string;
  title: string;
  markdown: string;
  html: string;
  error?: string;
}

export async function scrapeWithJina(
  url: string,
  options: { apiKey?: string; timeout_ms?: number } = {}
): Promise<JinaPage> {
  const jinaUrl = `https://r.jina.ai/${url}`;
  
  const headers: Record<string, string> = {
    "Accept": "text/plain", // Default reader format
    "X-Return-Format": "markdown" // Explicitly request markdown
  };

  if (options.apiKey) {
    headers["Authorization"] = `Bearer ${options.apiKey}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeout_ms ?? 30000
  );

  try {
    const res = await fetch(jinaUrl, {
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      // Handle rate limits or errors
      const errorBody = await res.text().catch(() => "");
      throw new Error(`Jina AI failed (${res.status}): ${errorBody || res.statusText}`);
    }

    const markdown = await res.text();
    
    // Extract title from the first level 1 header if possible
    const titleMatch = markdown.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : "";

    return {
      url,
      title,
      markdown,
      html: "", // Jina Reader primarily returns Markdown in this mode
    };
  } catch (err) {
    return {
      url,
      title: "",
      markdown: "",
      html: "",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeout);
  }
}
