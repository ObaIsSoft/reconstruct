import type { ImageAsset, ImageRole, MediaAsset, FaviconInfo, CSSBlock } from "../schema/types.js";
import { allText } from "../schema/types.js";
import type { CascadePage } from "../scrapers/cascade.js";

const DEFAULT_FAVICON_PATTERNS = [
  "vite.svg", "next.svg", "nuxt.svg", "remix.svg",
  "favicon.ico", "favicon.png",  // generic defaults (not branded)
  "logo192.png", "logo512.png",  // CRA defaults
];

function faviconFormat(url: string): FaviconInfo["format"] {
  if (url.endsWith(".svg")) return "svg";
  if (url.endsWith(".png")) return "png";
  if (url.endsWith(".ico")) return "ico";
  if (url.endsWith(".webp")) return "webp";
  return "unknown";
}

function isDefaultFavicon(url: string): boolean {
  const lower = url.toLowerCase();
  return DEFAULT_FAVICON_PATTERNS.some((p) => lower.includes(p));
}

function extractFavicon(html: string): FaviconInfo | null {
  const match =
    html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i) ||
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["']/i);
  if (!match) return null;
  const url = match[1];
  return { url, format: faviconFormat(url), is_default: isDefaultFavicon(url) };
}

function inferImageRole(src: string, alt: string): ImageRole {
  // Only test src path and alt text — not the surrounding HTML attrs string,
  // which contains CSS utility classes (object-cover, object-fill, etc.) that
  // share tokens with role keywords and cause mass false positives.
  // Decode percent-encoding so "Quote%20Logo%20(1).png" matches \blogo\b.
  let srcDecoded = src;
  try { srcDecoded = decodeURIComponent(src); } catch { /* keep raw */ }
  const srcLower = srcDecoded.toLowerCase();
  const altLower = alt.toLowerCase();
  const combined = srcLower + " " + altLower;
  if (/\bhero\b|\bbanner\b/.test(combined)) return "hero";
  if (/avatar|profile-pic|headshot/.test(combined)) return "portrait";
  if (/portrait/.test(altLower)) return "portrait";
  if (/\bproduct\b|\bitem\b|\bshop\b|\bstore\b|\bcart\b/.test(combined)) return "product";
  if (/\bicon\b|\blogo\b|\bbadge\b|\bsymbol\b/.test(combined)) return "icon";
  if (/illustration|drawing/.test(combined)) return "illustration";
  if (/portfolio|gallery|project|case-study|work\b/.test(combined)) return "portfolio";
  if (/\bbg[-_]|\bbackground[-_]|decor|pattern|texture/.test(srcLower)) return "decoration";
  if (srcLower.endsWith(".gif")) return "decoration";
  return "unknown";
}

function extractImages(html: string, pageUrl: string): ImageAsset[] {
  const assets: ImageAsset[] = [];
  const seen = new Set<string>();

  // <img> tags
  const imgRe = /<img([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const attrs = m[1];
    const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
    const altMatch = attrs.match(/alt=["']([^"']*)["']/i);
    if (!srcMatch) continue;
    const src = srcMatch[1];
    if (seen.has(src)) continue;
    seen.add(src);
    const alt = altMatch ? altMatch[1] : "";
    const role = inferImageRole(src, alt);
    assets.push({
      src,
      alt,
      role,
      is_gif: src.toLowerCase().endsWith(".gif"),
      pages_present: [pageUrl],
    });
  }

  return assets;
}

function extractBackgroundImages(cssTexts: string[]): string[] {
  const urls = new Set<string>();
  for (const css of cssTexts) {
    const re = /background(?:-image)?\s*:[^;]*url\(["']?([^"')]+)["']?\)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) {
      const url = m[1].trim();
      if (url && !url.startsWith("data:")) urls.add(url);
    }
  }
  return [...urls];
}

function extractMedia(html: string, pageUrl: string): MediaAsset[] {
  const assets: MediaAsset[] = [];

  // <video>
  const videoRe = /<(?:video|source)[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = videoRe.exec(html)) !== null) {
    assets.push({ type: "video", src: m[1], pages_present: [pageUrl] });
  }

  // <audio>
  const audioRe = /<audio[^>]+src=["']([^"']+)["'][^>]*>/gi;
  while ((m = audioRe.exec(html)) !== null) {
    assets.push({ type: "audio", src: m[1], pages_present: [pageUrl] });
  }

  // YouTube / Vimeo iframes
  const iframeRe = /<iframe[^>]+src=["']([^"']*(?:youtube|vimeo)[^"']*)["'][^>]*>/gi;
  while ((m = iframeRe.exec(html)) !== null) {
    assets.push({ type: "embedded-video", src: m[1], pages_present: [pageUrl] });
  }

  // Web component video players: lite-youtube, mux-video, wistia-player, etc.
  const wcVideoRe = /<(lite-youtube|mux-video|wistia-player|video-player|hls-video)[^>]*(?:videoid|src|video-id)=["']([^"']+)["'][^>]*>/gi;
  while ((m = wcVideoRe.exec(html)) !== null) {
    assets.push({ type: "embedded-video", src: m[2], pages_present: [pageUrl] });
  }

  return assets;
}

function extractHeadings(html: string): string[] {
  const headings: string[] = [];
  const re = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, "").trim();
    if (text) headings.push(text);
  }
  return headings.slice(0, 20);
}

function extractSitePurpose(html: string, title: string): string {
  const metaDesc =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)?.[1] ||
    "";

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1 = h1Match ? h1Match[1].replace(/<[^>]+>/g, "").trim() : "";

  const parts = [title, h1, metaDesc].filter(Boolean);
  return parts.slice(0, 2).join(" — ").slice(0, 200);
}

// ── Sub-brand / content cluster detection ────────────────────────────────────
// Repeated path segments across image URLs reveal content organisation:
// product lines, campaigns, client sub-brands, editorial sections.
// We only surface segments that appear in 3+ images and aren't generic
// infrastructure tokens (CDN folders, upload dirs, hash-like strings).

const GENERIC_PATH_SEGMENTS = new Set([
  "img", "imgs", "image", "images", "assets", "asset", "static", "media",
  "upload", "uploads", "files", "file", "public", "content", "contents",
  "cdn", "wp-content", "wp-uploads", "themes", "theme", "plugins", "plugin",
  "dist", "build", "out", "output", "resources", "resource", "includes",
  "misc", "general", "common", "shared", "global", "default", "original",
  "full", "thumb", "thumbnail", "thumbnails", "large", "medium", "small",
  "resize", "resized", "optimized", "compressed", "cache", "cached",
  "photos", "photo", "pics", "pic", "gallery", "galleries", "news",
  "en", "en-us", "en-gb", "us", "uk", "www", "web", "site", "page",
  // HubSpot CDN infrastructure paths — not sub-brands
  "hubfs", "hs-fs", "hs", "hubspot", "raw-assets", "website-images",
  // Generic branding/marketing folder names
  "brand", "branding", "marketing", "icons", "logos", "logo",
]);

function looksLikeHash(s: string): boolean {
  // UUIDs, short hex hashes, purely numeric segments, date-like strings
  return /^[0-9a-f]{6,}$/i.test(s) ||       // hex hash
    /^\d+$/.test(s) ||                        // purely numeric
    /^\d{4}[-_]\d{2}[-_]\d{2}$/.test(s) ||  // date
    /^[0-9a-f]{8}-[0-9a-f]{4}/.test(s);      // UUID
}

export function detectSubBrandSignals(images: ImageAsset[]): string[] {
  const segmentCount = new Map<string, number>();

  for (const img of images) {
    try {
      // Work with the path portion only — strip query strings and filenames
      let path = img.src;
      // Handle relative and absolute URLs
      const urlPath = path.includes("://")
        ? new URL(path).pathname
        : path.split("?")[0];
      const parts = urlPath.split("/").filter(Boolean).map((seg) => {
        try { return decodeURIComponent(seg); } catch { return seg; }
      });
      // Drop the filename (last segment)
      const dirs = parts.slice(0, -1);
      const seen = new Set<string>();
      for (const seg of dirs) {
        const s = seg.toLowerCase().replace(/[_\s-]+/g, "-");
        if (seen.has(s)) continue;
        seen.add(s);
        if (s.length < 3 || GENERIC_PATH_SEGMENTS.has(s) || looksLikeHash(s)) continue;
        segmentCount.set(s, (segmentCount.get(s) ?? 0) + 1);
      }
    } catch {
      // Malformed URL — skip
    }
  }

  return [...segmentCount.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([seg]) => seg);
}

// ── Main export ────────────────────────────────────────────────────────────────

export interface ContentTokens {
  site_purpose: string;
  headings: string[];
  images: ImageAsset[];
  background_images: string[];
  media: MediaAsset[];
  favicon: FaviconInfo | null;
  sub_brand_signals: string[];   // repeated path segments in image URLs (product lines, campaigns, etc.)
}

export function extractContent(pages: CascadePage[], allCss: CSSBlock[]): ContentTokens {
  const home = pages[0];
  const favicon = extractFavicon(home.html);

  // Deduplicate images across pages
  const imageMap = new Map<string, ImageAsset>();
  for (const page of pages) {
    for (const img of extractImages(page.html, page.url)) {
      const existing = imageMap.get(img.src);
      if (!existing) {
        imageMap.set(img.src, img);
      } else {
        const pages_set = new Set([...existing.pages_present, page.url]);
        existing.pages_present = [...pages_set];
      }
    }
  }

  // Deduplicate media
  const mediaMap = new Map<string, MediaAsset>();
  for (const page of pages) {
    for (const m of extractMedia(page.html, page.url)) {
      const existing = mediaMap.get(m.src);
      if (!existing) {
        mediaMap.set(m.src, m);
      } else {
        const pages_set = new Set([...existing.pages_present, page.url]);
        existing.pages_present = [...pages_set];
      }
    }
  }

  // Headings from home + up to 2 more pages
  const headingPages = pages.slice(0, 3);
  const allHeadings = [...new Set(headingPages.flatMap((p) => extractHeadings(p.html)))];

  const allImages = [...imageMap.values()];

  return {
    site_purpose: extractSitePurpose(home.html, home.title),
    headings: allHeadings,
    images: allImages,
    background_images: extractBackgroundImages(allText(allCss)),
    media: [...mediaMap.values()],
    favicon,
    sub_brand_signals: detectSubBrandSignals(allImages),
  };
}
