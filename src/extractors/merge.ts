// Deduplication + merge pass
// Takes all per-page CascadePages and produces a unified ReconstructSchema
// This is the final step before caching — all extractors converge here.

import type { ReconstructSchema, ComponentToken, NavItem, CoverageReport } from "../schema/types.js";
import type { CrawlResult, CascadePage } from "../scrapers/cascade.js";
import { extractCSSTokens } from "./css.js";
import { buildPageNode, detectGridSystem, parseNavItems, detectAccessibilityGrade } from "./dom.js";
import { detectTechStack } from "./tech.js";
import { extractInteractions } from "./interactions.js";
import { inferPhilosophy } from "./philosophy.js";
import { createHash } from "crypto";

// ── Shared component detection ────────────────────────────────────────────────
// A component is "shared" if it appears on 3+ pages

function deduplicateComponents(allComponents: ComponentToken[]): ComponentToken[] {
  const byName = new Map<string, ComponentToken>();

  for (const comp of allComponents) {
    const existing = byName.get(comp.name_inferred);
    if (!existing) {
      byName.set(comp.name_inferred, { ...comp });
    } else {
      // Merge pages_present
      const pages = new Set([...existing.pages_present, ...comp.pages_present]);
      existing.pages_present = [...pages];
      existing.is_shared = pages.size >= 3;
    }
  }

  return [...byName.values()];
}

// ── Nav deduplication ─────────────────────────────────────────────────────────

function mergeNavLinks(
  pages: CascadePage[]
): { primary: NavItem[]; footer: NavItem[]; mobile: NavItem[]; utility: NavItem[] } {
  // Use first page (homepage) nav/footer as canonical
  const home = pages[0];
  return {
    primary: parseNavItems(home?.nav_links ?? []),
    footer: parseNavItems(home?.footer_links ?? []),
    mobile: [],   // populated if Lightpanda captures mobile menu state
    utility: [],
  };
}

// ── CSS aggregation ───────────────────────────────────────────────────────────

function aggregateCss(pages: CascadePage[]): string[] {
  const seenContent = new Set<string>();
  const cssTexts: string[] = [];

  for (const page of pages) {
    // 1. Process explicit CSS text from the scraper (e.g. captured browser rules)
    for (const css of page.css_text) {
      if (!css) continue;
      const hash = css.trim().slice(0, 1000); // 1000 chars for safe dedupe
      if (!seenContent.has(hash)) {
        seenContent.add(hash);
        cssTexts.push(css);
      }
    }

    // 2. Process inline styles
    for (const css of page.inline_styles) {
      if (!css) continue;
      const hash = css.trim().slice(0, 500);
      if (!seenContent.has(hash)) {
        seenContent.add(hash);
        cssTexts.push(css);
      }
    }
  }

  return cssTexts.filter(Boolean);
}

// ── Content hash ──────────────────────────────────────────────────────────────

function contentHash(pages: CascadePage[]): string {
  const content = pages.map((p) => p.url + p.html.slice(0, 500)).join("");
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// ── Coverage report ───────────────────────────────────────────────────────────

function buildCoverageReport(crawl: CrawlResult): CoverageReport {
  const confidence = crawl.limit_reached
    ? Math.max(0.3, 1 - crawl.urls_skipped / Math.max(crawl.urls_discovered, 1))
    : crawl.urls_errored > crawl.urls_crawled * 0.3
      ? 0.6
      : 0.9;

  const notice = crawl.limit_reached
    ? `Limit reached: analyzed ${crawl.urls_crawled} of ${crawl.urls_discovered} discovered URLs. ` +
      `Increase max_pages in reconstruct.config.json for fuller coverage.`
    : crawl.urls_auth_walled > 0
      ? `${crawl.urls_auth_walled} auth-walled page(s) skipped. Provide session cookies to include them.`
      : null;

  return {
    urls_discovered: crawl.urls_discovered,
    urls_crawled: crawl.urls_crawled,
    urls_skipped: crawl.urls_skipped,
    urls_auth_walled: crawl.urls_auth_walled,
    urls_errored: crawl.urls_errored,
    limit_reached: crawl.limit_reached,
    confidence,
    notice,
  };
}

// ── Main merge function ───────────────────────────────────────────────────────

export async function mergeCrawlToSchema(
  startUrl: string,
  crawl: CrawlResult
): Promise<ReconstructSchema> {
  const { pages } = crawl;

  if (pages.length === 0) {
    throw new Error(`No pages crawled from ${startUrl}`);
  }

  const homePage = pages[0];
  const allCss = aggregateCss(pages);
  const baseHostname = new URL(startUrl).hostname;

  // Run all extractors
  const cssTokens = extractCSSTokens(allCss, homePage.html);
  const techStack = detectTechStack(homePage.html, allCss);
  const interactions = extractInteractions(allCss, homePage.html);
  const grid = detectGridSystem(homePage.html, allCss);
  const accessibilityGrade = detectAccessibilityGrade(homePage.html, allCss);
  const philosophy = inferPhilosophy(cssTokens, homePage.html, accessibilityGrade);

  // Build per-page nodes
  const pageNodes = pages.map((p) => buildPageNode(p, baseHostname));

  // Collect and deduplicate all components
  const allComponents = pages.flatMap((p, i) =>
    pageNodes[i].unique_components.map((c) => ({
      ...c,
      pages_present: [p.url],
    }))
  );
  const deduped = deduplicateComponents(allComponents);
  const sharedComponents = deduped.filter((c) => c.is_shared);
  const uniquePerPage = deduped.filter((c) => !c.is_shared);

  // Update page nodes to reference only their unique components
  for (const node of pageNodes) {
    node.unique_components = node.unique_components.filter(
      (c) => !sharedComponents.some((s) => s.name_inferred === c.name_inferred)
    );
    node.interactions = interactions.global_hover_patterns;
  }

  // Global section list (present on 50%+ of pages)
  const sectionCounts = new Map<string, number>();
  for (const node of pageNodes) {
    for (const section of node.sections) {
      sectionCounts.set(section, (sectionCounts.get(section) ?? 0) + 1);
    }
  }
  const threshold = pages.length * 0.5;
  const globalSections = [...sectionCounts.entries()]
    .filter(([, count]) => count >= threshold)
    .map(([s]) => s);

  // Asset URLs across all pages
  const assetUrls = [...new Set(
    pages.flatMap((p) =>
      [...p.html.matchAll(/src=["']([^"']+\.(?:png|jpg|jpeg|gif|svg|webp|ico|mp4|mp3|woff2?))[^"']*/gi)]
        .map((m) => m[1])
    )
  )];

  const coverage = buildCoverageReport(crawl);
  const overallConfidence =
    (coverage.confidence + pageNodes.reduce((a, n) => a + n.confidence, 0) / pageNodes.length) / 2;

  return {
    meta: {
      url: startUrl,
      title: homePage.title,
      captured_at: new Date().toISOString(),
      content_hash: contentHash(pages),
      confidence: Math.round(overallConfidence * 100) / 100,
      coverage,
    },

    technology: techStack,

    design: {
      colors: {
        palette: cssTokens.colors,
        strategy: cssTokens.color_strategy,
        dark_mode: cssTokens.dark_mode,
      },
      typography: {
        families: cssTokens.typography.families,
        scale: cssTokens.typography.scale,
        base_size: cssTokens.typography.base_size,
        line_height_base: cssTokens.typography.line_height_base,
        letter_spacing_pattern: cssTokens.typography.letter_spacing_pattern,
      },
      spacing: cssTokens.spacing,
      motion: cssTokens.motion,
      elevation: cssTokens.elevation,
      border_radius: cssTokens.border_radius,
      grid,
    },

    structure: {
      page_count: pages.length,
      sections_global: globalSections,
      nav: mergeNavLinks(pages),
      pages: pageNodes,
    },

    interactions: {
      global_hover_patterns: interactions.global_hover_patterns,
      focus_strategy: interactions.focus_strategy,
      scroll_behaviors: interactions.scroll_behaviors,
      transitions: interactions.transitions,
    },

    components: sharedComponents,

    philosophy,

    raw: {
      css_text: allCss,
      dom_snapshot: homePage.semantic_tree,
      asset_urls: assetUrls.slice(0, 100),
      stylesheet_urls: [...new Set(pages.flatMap((p) => p.stylesheet_urls))],
    },
  };
}

// re-export so diff.ts can import from one place
export { detectAccessibilityGrade } from "./dom.js";
