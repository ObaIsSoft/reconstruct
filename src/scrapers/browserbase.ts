// Browserbase scraper — auth-walled sites, full SPA hydration, network request capture
// Docs: https://docs.browserbase.com

export interface BrowserbasePage {
  url: string;
  html: string;
  title: string;
  network_requests: NetworkRequest[];
  console_logs: string[];
  screenshot_base64?: string;
  error?: string;
}

export interface NetworkRequest {
  url: string;
  method: string;
  type: string;        // "fetch", "xhr", "stylesheet", "script", "image"
  status: number;
  size_bytes: number;
}

// ── Client ────────────────────────────────────────────────────────────────────

export class BrowserbaseClient {
  private apiKey: string;
  private projectId: string;
  private baseUrl = "https://www.browserbase.com";

  constructor(apiKey: string, projectId: string) {
    this.apiKey = apiKey;
    this.projectId = projectId;
  }

  private get headers() {
    return {
      "x-bb-api-key": this.apiKey,
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
      throw new Error(`Browserbase ${res.status} on ${path}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers });
    if (!res.ok) throw new Error(`Browserbase GET ${res.status}: ${path}`);
    return res.json() as Promise<T>;
  }

  private async del(path: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}${path}`, {
        method: "DELETE",
        headers: this.headers,
      });
    } catch (err) {
      console.warn(`[browserbase] DELETE ${path} error:`, err instanceof Error ? err.message : String(err));
    }
  }

  // Create a session and return its ID + connect URL
  async createSession(): Promise<{ id: string; connect_url: string }> {
    const data = await this.post<{ id: string; connectUrl: string }>(
      "/v1/sessions",
      { projectId: this.projectId }
    );
    return { id: data.id, connect_url: data.connectUrl };
  }

  async terminateSession(sessionId: string): Promise<void> {
    await this.del(`/v1/sessions/${sessionId}`);
  }

  // Retrieve logs/network from a completed session
  async getSessionLogs(sessionId: string): Promise<NetworkRequest[]> {
    try {
      const data = await this.get<{ requests?: NetworkRequest[] }>(
        `/v1/sessions/${sessionId}/network`
      );
      return data.requests ?? [];
    } catch {
      return [];
    }
  }
}

// ── CDP-based page scrape via Browserbase ─────────────────────────────────────
// Uses the connect URL to issue CDP commands over WebSocket

async function cdpCommand(
  ws: WebSocket,
  method: string,
  params: Record<string, unknown> = {},
  id: number
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 15000);
    ws.addEventListener("message", function handler(event: MessageEvent) {
      try {
        const msg = JSON.parse(event.data as string) as { id?: number; result?: unknown; error?: unknown };
        if (msg.id === id) {
          clearTimeout(timeout);
          ws.removeEventListener("message", handler);
          if (msg.error) reject(new Error(JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      } catch {}
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

export async function scrapeWithBrowserbase(
  url: string,
  options: {
    apiKey: string;
    projectId: string;
    cookies?: string;
    capture_network?: boolean;
    screenshot?: boolean;
    timeout_ms?: number;
  }
): Promise<BrowserbasePage> {
  const client = new BrowserbaseClient(options.apiKey, options.projectId);
  let sessionId: string | null = null;

  try {
    const session = await client.createSession();
    sessionId = session.id;

    // Connect via WebSocket CDP
    const ws = new WebSocket(session.connect_url);

    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", reject);
      setTimeout(() => reject(new Error("WebSocket connect timeout")), 10000);
    });

    let cmdId = 1;

    // Enable domains
    await cdpCommand(ws, "Network.enable", {}, cmdId++);
    await cdpCommand(ws, "Page.enable", {}, cmdId++);

    // Set cookies if provided
    if (options.cookies) {
      const cookiePairs = options.cookies.split(";").map((c) => {
        const [name, ...rest] = c.trim().split("=");
        return { name: name.trim(), value: rest.join("=").trim(), url };
      });
      await cdpCommand(ws, "Network.setCookies", { cookies: cookiePairs }, cmdId++);
    }

    // Capture network requests
    const networkRequests: NetworkRequest[] = [];
    if (options.capture_network !== false) {
      ws.addEventListener("message", (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            method?: string;
            params?: {
              type?: string;
              request?: { method?: string; url?: string };
              response?: { status?: number; encodedDataLength?: number };
            };
          };
          if (msg.method === "Network.responseReceived" && msg.params) {
            networkRequests.push({
              url: msg.params.request?.url ?? "",
              method: msg.params.request?.method ?? "GET",
              type: msg.params.type ?? "other",
              status: msg.params.response?.status ?? 0,
              size_bytes: msg.params.response?.encodedDataLength ?? 0,
            });
          }
        } catch {}
      });
    }

    // Navigate
    await cdpCommand(ws, "Page.navigate", { url }, cmdId++);

    // Wait for page load
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, options.timeout_ms ?? 10000);
      ws.addEventListener("message", (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string) as { method?: string };
          if (msg.method === "Page.loadEventFired") {
            clearTimeout(timeout);
            resolve();
          }
        } catch {}
      });
    });

    // Small settle time for SPA hydration
    await new Promise((r) => setTimeout(r, 1500));

    // Get full HTML
    const domResult = await cdpCommand(
      ws,
      "Runtime.evaluate",
      { expression: "document.documentElement.outerHTML", returnByValue: true },
      cmdId++
    ) as { result?: { value?: string } };
    const html = domResult?.result?.value ?? "";

    const titleResult = await cdpCommand(
      ws,
      "Runtime.evaluate",
      { expression: "document.title", returnByValue: true },
      cmdId++
    ) as { result?: { value?: string } };
    const title = titleResult?.result?.value ?? "";

    // Screenshot
    let screenshot_base64: string | undefined;
    if (options.screenshot) {
      const shot = await cdpCommand(ws, "Page.captureScreenshot", { format: "png" }, cmdId++) as { data?: string };
      screenshot_base64 = shot?.data;
    }

    ws.close();

    const network_requests = options.capture_network !== false
      ? await client.getSessionLogs(sessionId).catch(() => networkRequests)
      : networkRequests;

    return { url, html, title, network_requests, console_logs: [], screenshot_base64 };
  } catch (err) {
    return {
      url,
      html: "",
      title: "",
      network_requests: [],
      console_logs: [],
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (sessionId) {
      await client.terminateSession(sessionId).catch((err) => {
        console.error("[browserbase] Failed to terminate session:", err);
      });
    }
  }
}
