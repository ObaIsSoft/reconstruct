// Live pipeline test — bypasses MCP, calls analysis functions directly
import { crawlSite } from "./dist/scrapers/cascade.js";
import { mergeCrawlToSchema } from "./dist/extractors/merge.js";
import { inferPhilosophy } from "./dist/extractors/philosophy.js";

const URL = "https://www.inioluwaadebakin.com/";

console.log(`\n🔍 Analyzing ${URL}\n${"─".repeat(60)}`);

let crawl;
try {
  crawl = await crawlSite(URL, { crawl: { max_pages: 5 } });
} catch (err) {
  console.error("Crawl failed:", err.message);
  process.exit(1);
}

console.log(`\n✅ Crawl complete`);
console.log(`  Pages crawled : ${crawl.urls_crawled}`);
console.log(`  URLs found    : ${crawl.urls_discovered}`);
console.log(`  Errors        : ${crawl.urls_errored}`);
console.log(`  Scraper used  : ${crawl.pages[0]?.used_scraper ?? "unknown"}`);

const page = crawl.pages[0];
console.log(`\n📄 Homepage snapshot`);
console.log(`  Title         : ${page?.title}`);
console.log(`  HTML length   : ${page?.html?.length ?? 0} chars`);
console.log(`  CSS files     : ${page?.stylesheet_urls?.length ?? 0}`);
console.log(`  CSS text len  : ${page?.css_text?.reduce((a, c) => a + c.length, 0) ?? 0} chars`);
console.log(`  Inline styles : ${page?.inline_styles?.length ?? 0}`);
console.log(`  Is SPA        : ${page?.is_spa}`);

let schema;
try {
  schema = await mergeCrawlToSchema(URL, crawl);
} catch (err) {
  console.error("Merge failed:", err.message);
  process.exit(1);
}

const { design, technology, philosophy, components } = schema;

console.log(`\n🎨 Design tokens`);
console.log(`  Colors        : ${design.colors.palette.length} (${design.colors.strategy})`);
console.log(`  Color sample  : ${design.colors.palette.slice(0, 5).map(c => c.value).join("  ")}`);
console.log(`  Dark mode     : ${design.colors.dark_mode}`);
console.log(`  Fonts         : ${design.typography.families.map(f => `${f.family} (${f.role})`).join(", ")}`);
console.log(`  Type scale    : [${design.typography.scale.join(", ")}]px`);
console.log(`  Base size     : ${design.typography.base_size}px`);
console.log(`  Spacing unit  : ${design.spacing.base_unit}px (${design.spacing.strategy})`);
console.log(`  Border radii  : [${design.border_radius.join(", ")}]px`);
console.log(`  Elevation     : ${design.elevation.length} shadow levels`);
console.log(`  Motion        : ${design.motion.durations_ms.length} durations [${design.motion.durations_ms.join(", ")}ms]`);
console.log(`  Grid          : ${design.grid.layout}, max ${design.grid.max_width_px ?? "unset"}px`);

console.log(`\n⚙️  Technology`);
console.log(`  Framework     : ${technology.framework}`);
console.log(`  Rendering     : ${technology.rendering}`);
console.log(`  Styling       : ${technology.styling.join(", ")}`);
console.log(`  State         : ${technology.state.join(", ") || "none"}`);
console.log(`  Libs          : ${technology.detected_libs.join(", ") || "none"}`);
console.log(`  Meta fw       : ${technology.meta_framework ?? "none"}`);

console.log(`\n🧠 Philosophy`);
console.log(`  Design school : ${philosophy.design_school.join(", ")}`);
console.log(`  Personality   : ${philosophy.personality.join(", ")}`);
console.log(`  Density       : ${philosophy.density}`);
console.log(`  Whitespace    : ${philosophy.whitespace_use}`);
console.log(`  Hierarchy     : ${philosophy.visual_hierarchy_method.join(", ")}`);
console.log(`  Accessibility : ${philosophy.accessibility_grade}`);

console.log(`\n🧩 Components`);
if (components.length === 0) {
  console.log(`  None detected as shared (need 3+ pages)`);
} else {
  for (const c of components) {
    console.log(`  ${c.name_inferred} — ${c.styling_approach}, shared: ${c.is_shared}, props: [${c.props_inferred.join(", ")}]`);
  }
}

console.log(`\n📊 Coverage`);
console.log(`  Confidence    : ${Math.round(schema.meta.confidence * 100)}%`);
console.log(`  Notice        : ${schema.meta.coverage.notice ?? "none"}`);
console.log(`\n${"─".repeat(60)}\n`);
