// reconstruct_clone — generate a codebase that recreates a site's design + structure
// Outputs: vanilla HTML/CSS, React+Tailwind, Vue, Svelte, or design tokens JSON

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../schema/config.js";
import { readCache } from "../cache/store.js";
import type { ReconstructSchema } from "../schema/types.js";

const FRAMEWORKS = ["html", "react", "vue", "svelte", "tokens"] as const;
type Framework = typeof FRAMEWORKS[number];

export function registerCloneTool(server: McpServer): void {
  server.tool(
    "reconstruct_clone",
    "Generate a codebase that recreates a website's design system, layout, and components. Choose your output framework. Requires reconstruct_analyze first.",
    {
      url: z.string().url().describe("Website URL to clone"),
      framework: z.enum(FRAMEWORKS).describe(
        "Output format: html=vanilla HTML+CSS, react=React+Tailwind, vue=Vue3+Tailwind, svelte=SvelteKit, tokens=Design tokens JSON"
      ),
      scope: z.enum(["tokens", "components", "full"]).default("full").describe(
        "tokens=design system only, components=component library, full=complete page scaffold"
      ),
    },
    async ({ url, framework, scope }) => {
      const config = loadConfig();
      const schema = readCache(url, config.output.cache_dir);

      if (!schema) {
        return {
          content: [{
            type: "text",
            text: `No analysis found for ${url}. Run reconstruct_analyze("${url}") first.`,
          }],
          isError: true,
        };
      }

      const output = buildCloneOutput(schema, framework, scope);

      return {
        content: [{ type: "text", text: output }],
      };
    }
  );
}

// ── Output builders ───────────────────────────────────────────────────────────

function buildCloneOutput(
  schema: ReconstructSchema,
  framework: Framework,
  scope: string
): string {
  const header = [
    `# Clone: ${schema.meta.url}`,
    `**Framework:** ${framework} | **Scope:** ${scope}`,
    `**Based on analysis:** ${schema.meta.captured_at}`,
    "",
  ].join("\n");

  if (framework === "tokens") return header + buildDesignTokens(schema);
  if (scope === "tokens") return header + buildDesignTokens(schema);

  const tokens = buildDesignTokens(schema);
  const components = buildComponents(schema, framework);
  const layout = scope === "full" ? buildLayout(schema, framework) : "";

  return [header, tokens, components, layout].filter(Boolean).join("\n\n---\n\n");
}

function buildDesignTokens(schema: ReconstructSchema): string {
  const { design } = schema;

  const cssVars = [
    "## Design Tokens (CSS Custom Properties)",
    "```css",
    ":root {",
    "  /* Colors */",
    ...design.colors.palette.slice(0, 20).map(
      (c) => `  --color-${c.name_inferred}: ${c.value};`
    ),
    "",
    "  /* Typography */",
    ...design.typography.families.map(
      (f, i) => `  --font-${f.role || i}: ${f.family};`
    ),
    ...design.typography.scale.map(
      (s, i) => `  --text-${i + 1}: ${s}px;`
    ),
    `  --leading-base: ${design.typography.line_height_base};`,
    "",
    "  /* Spacing */",
    ...design.spacing.scale.map(
      (s, i) => `  --space-${i + 1}: ${s}px;`
    ),
    "",
    "  /* Border Radius */",
    ...design.border_radius.map(
      (r, i) => `  --radius-${i + 1}: ${r}px;`
    ),
    "",
    "  /* Motion */",
    ...design.motion.durations_ms.map(
      (d, i) => `  --duration-${i + 1}: ${d}ms;`
    ),
    ...design.motion.easings.map(
      (e, i) => `  --ease-${i + 1}: ${e};`
    ),
    "}",
    "```",
  ].join("\n");

  const jsonTokens = [
    "",
    "## Design Tokens (JSON — for Figma / Style Dictionary)",
    "```json",
    JSON.stringify(
      {
        colors: Object.fromEntries(
          design.colors.palette.slice(0, 20).map((c) => [
            c.name_inferred,
            { value: c.value, type: "color", usage: c.usage },
          ])
        ),
        typography: {
          families: Object.fromEntries(
            design.typography.families.map((f) => [f.role, { value: f.family, type: "fontFamily" }])
          ),
          scale: Object.fromEntries(
            design.typography.scale.map((s, i) => [`size-${i + 1}`, { value: `${s}px`, type: "fontSize" }])
          ),
        },
        spacing: Object.fromEntries(
          design.spacing.scale.map((s, i) => [`space-${i + 1}`, { value: `${s}px`, type: "spacing" }])
        ),
        radius: Object.fromEntries(
          design.border_radius.map((r, i) => [`radius-${i + 1}`, { value: `${r}px`, type: "borderRadius" }])
        ),
        motion: {
          durations: design.motion.durations_ms.map((d) => `${d}ms`),
          easings: design.motion.easings,
        },
      },
      null,
      2
    ),
    "```",
  ].join("\n");

  return cssVars + jsonTokens;
}

function buildComponents(schema: ReconstructSchema, framework: Framework): string {
  const components = schema.components.length
    ? schema.components
    : [{ name_inferred: "Button" }, { name_inferred: "Card" }, { name_inferred: "Navbar" }];

  const primaryColor = schema.design.colors.palette[0]?.value ?? "#000";
  const radius = schema.design.border_radius[0] ?? 4;
  const duration = schema.design.motion.durations_ms[0] ?? 200;
  const fontFamily = schema.design.typography.families[0]?.family ?? "system-ui";
  const maxWidth = schema.design.grid.max_width_px ?? 1200;

  if (framework === "html") {
    return [
      "## Core Components (Vanilla HTML + CSS)",
      "",
      "### Button",
      "```html",
      `<button class="btn btn-primary">Click me</button>`,
      "```",
      "```css",
      `.btn {`,
      `  font-family: ${fontFamily};`,
      `  padding: ${schema.design.spacing.scale[2] ?? 8}px ${schema.design.spacing.scale[4] ?? 16}px;`,
      `  border-radius: ${radius}px;`,
      `  border: none;`,
      `  cursor: pointer;`,
      `  transition: all ${duration}ms ${schema.design.motion.easings[0] ?? "ease"};`,
      `}`,
      `.btn-primary {`,
      `  background: ${primaryColor};`,
      `  color: white;`,
      `}`,
      `.btn-primary:hover {`,
      `  opacity: 0.9;`,
      `  transform: translateY(-1px);`,
      `}`,
      "```",
      "",
      "### Card",
      "```html",
      `<div class="card">`,
      `  <div class="card-body">`,
      `    <h3 class="card-title">Card Title</h3>`,
      `    <p class="card-text">Card content goes here.</p>`,
      `  </div>`,
      `</div>`,
      "```",
      "```css",
      `.card {`,
      `  border-radius: ${radius}px;`,
      `  padding: ${schema.design.spacing.scale[4] ?? 24}px;`,
      `  background: white;`,
      schema.design.elevation[0] ? `  box-shadow: ${schema.design.elevation[0].value};` : "",
      `  transition: box-shadow ${duration}ms ease;`,
      `}`,
      schema.design.elevation[1]
        ? `.card:hover { box-shadow: ${schema.design.elevation[1].value}; }`
        : "",
      "```",
    ].filter((l) => l !== undefined).join("\n");
  }

  if (framework === "react") {
    return [
      "## Core Components (React + Tailwind)",
      "",
      "### Button",
      "```tsx",
      `import { cn } from "@/lib/utils";`,
      ``,
      `interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {`,
      `  variant?: "primary" | "secondary" | "ghost";`,
      `  size?: "sm" | "md" | "lg";`,
      `}`,
      ``,
      `export function Button({ variant = "primary", size = "md", className, children, ...props }: ButtonProps) {`,
      `  return (`,
      `    <button`,
      `      className={cn(`,
      `        "inline-flex items-center justify-center font-medium transition-all",`,
      `        "focus-visible:outline-none focus-visible:ring-2",`,
      `        size === "sm" && "px-3 py-1.5 text-sm rounded",`,
      `        size === "md" && "px-4 py-2 text-base rounded-md",`,
      `        size === "lg" && "px-6 py-3 text-lg rounded-lg",`,
      `        variant === "primary" && "bg-[${primaryColor}] text-white hover:opacity-90 hover:-translate-y-px",`,
      `        variant === "secondary" && "border border-current hover:bg-gray-50",`,
      `        variant === "ghost" && "hover:bg-gray-100",`,
      `        className`,
      `      )}`,
      `      {...props}`,
      `    >`,
      `      {children}`,
      `    </button>`,
      `  );`,
      `}`,
      "```",
      "",
      "### Card",
      "```tsx",
      `interface CardProps {`,
      `  children: React.ReactNode;`,
      `  className?: string;`,
      `}`,
      ``,
      `export function Card({ children, className }: CardProps) {`,
      `  return (`,
      `    <div className={cn(`,
      `      "rounded-[${radius}px] bg-white p-6",`,
      `      "${schema.design.elevation[0] ? "shadow-md hover:shadow-lg" : "border border-gray-200"}",`,
      `      "transition-shadow duration-[${duration}ms]",`,
      `      className`,
      `    )}>`,
      `      {children}`,
      `    </div>`,
      `  );`,
      `}`,
      "```",
    ].join("\n");
  }

  if (framework === "vue") {
    return [
      "## Core Components (Vue 3 + Tailwind)",
      "",
      "### Button.vue",
      "```vue",
      `<script setup lang="ts">`,
      `defineProps<{ variant?: 'primary' | 'secondary'; size?: 'sm' | 'md' | 'lg' }>()`,
      `</script>`,
      `<template>`,
      `  <button :class="[`,
      `    'inline-flex items-center font-medium transition-all focus-visible:outline-none focus-visible:ring-2',`,
      `    variant === 'primary' ? 'bg-[${primaryColor}] text-white hover:opacity-90' : 'border border-current hover:bg-gray-50',`,
      `    size === 'sm' ? 'px-3 py-1.5 text-sm rounded' : size === 'lg' ? 'px-6 py-3 text-lg rounded-lg' : 'px-4 py-2 rounded-md'`,
      `  ]">`,
      `    <slot />`,
      `  </button>`,
      `</template>`,
      "```",
      "",
      "### Card.vue",
      "```vue",
      `<script setup lang="ts">`,
      `defineProps<{ title?: string }>()`,
      `</script>`,
      `<template>`,
      `  <div class="rounded-[${radius}px] bg-white p-6 ${schema.design.elevation[0] ? "shadow-md hover:shadow-lg" : "border border-gray-200"} transition-shadow duration-[${duration}ms]">`,
      `    <h3 v-if="title" class="font-semibold text-base mb-2">{{ title }}</h3>`,
      `    <slot />`,
      `  </div>`,
      `</template>`,
      "```",
      "",
      "### Layout.vue (App Shell)",
      "```vue",
      `<script setup lang="ts">`,
      `// Root layout — wrap pages with this`,
      `</script>`,
      `<template>`,
      `  <div :style="{ fontFamily: '${fontFamily}', fontSize: '${schema.design.typography.base_size}px' }">`,
      `    <nav class="sticky top-0 z-50 border-b border-gray-200 bg-white/80 backdrop-blur">`,
      `      <div class="mx-auto max-w-[${maxWidth}px] px-4 flex items-center justify-between h-16">`,
      `        <slot name="nav" />`,
      `      </div>`,
      `    </nav>`,
      `    <main class="mx-auto max-w-[${maxWidth}px] px-4 py-12">`,
      `      <slot />`,
      `    </main>`,
      `    <footer class="border-t border-gray-200 py-12">`,
      `      <div class="mx-auto max-w-[${maxWidth}px] px-4">`,
      `        <slot name="footer" />`,
      `      </div>`,
      `    </footer>`,
      `  </div>`,
      `</template>`,
      "```",
    ].join("\n");
  }

  if (framework === "svelte") {
    return [
      "## Core Components (SvelteKit)",
      "",
      "### Button.svelte",
      "```svelte",
      `<script lang="ts">`,
      `  export let variant: 'primary' | 'secondary' = 'primary';`,
      `  export let size: 'sm' | 'md' | 'lg' = 'md';`,
      `</script>`,
      `<button class="{variant} {size}">`,
      `  <slot />`,
      `</button>`,
      `<style>`,
      `  button { font-family: ${fontFamily}; border-radius: ${radius}px; cursor: pointer; transition: all ${duration}ms ease; }`,
      `  .primary { background: ${primaryColor}; color: white; border: none; }`,
      `  .secondary { background: transparent; border: 1px solid ${primaryColor}; color: ${primaryColor}; }`,
      `  .sm { padding: 6px 12px; font-size: 0.875rem; }`,
      `  .md { padding: 8px 16px; font-size: 1rem; }`,
      `  .lg { padding: 12px 24px; font-size: 1.125rem; }`,
      `  button:hover { opacity: 0.9; transform: translateY(-1px); }`,
      `</style>`,
      "```",
      "",
      "### Card.svelte",
      "```svelte",
      `<script lang="ts">`,
      `  export let title: string = '';`,
      `</script>`,
      `<div class="card">`,
      `  {#if title}<h3>{title}</h3>{/if}`,
      `  <slot />`,
      `</div>`,
      `<style>`,
      `  .card {`,
      `    border-radius: ${radius}px;`,
      `    padding: ${schema.design.spacing.scale[4] ?? 24}px;`,
      `    background: white;`,
      schema.design.elevation[0] ? `    box-shadow: ${schema.design.elevation[0].value};` : `    border: 1px solid #e5e7eb;`,
      `    transition: box-shadow ${duration}ms ease;`,
      `  }`,
      schema.design.elevation[1] ? `  .card:hover { box-shadow: ${schema.design.elevation[1].value}; }` : "",
      `  h3 { font-weight: 600; margin: 0 0 8px; }`,
      `</style>`,
      "```",
      "",
      "### +layout.svelte (SvelteKit root layout)",
      "```svelte",
      `<script lang="ts">`,
      `  // Root layout — src/routes/+layout.svelte`,
      `</script>`,
      `<div class="root" style="font-family: ${fontFamily}; font-size: ${schema.design.typography.base_size}px;">`,
      `  <nav>`,
      `    <div class="container">`,
      `      <slot name="nav" />`,
      `    </div>`,
      `  </nav>`,
      `  <main class="container">`,
      `    <slot />`,
      `  </main>`,
      `  <footer>`,
      `    <div class="container"><slot name="footer" /></div>`,
      `  </footer>`,
      `</div>`,
      `<style>`,
      `  .container { max-width: ${maxWidth}px; margin: 0 auto; padding: 0 16px; }`,
      `  nav { position: sticky; top: 0; z-index: 50; border-bottom: 1px solid #e5e7eb; background: rgba(255,255,255,0.8); backdrop-filter: blur(8px); }`,
      `  main { padding: 48px 0; }`,
      `  footer { border-top: 1px solid #e5e7eb; padding: 48px 0; }`,
      `</style>`,
      "```",
    ].filter(Boolean).join("\n");
  }

  return "";
}

function buildLayout(schema: ReconstructSchema, framework: Framework): string {
  const sections = schema.structure.sections_global;
  const maxWidth = schema.design.grid.max_width_px ?? 1200;
  const fontFamily = schema.design.typography.families[0]?.family ?? "system-ui";
  const primaryColor = schema.design.colors.palette[0]?.value ?? "#000";

  if (framework === "html") {
    return [
      "## Page Layout Scaffold (Vanilla HTML)",
      "```html",
      `<!DOCTYPE html>`,
      `<html lang="en">`,
      `<head>`,
      `  <meta charset="UTF-8">`,
      `  <meta name="viewport" content="width=device-width, initial-scale=1.0">`,
      `  <title>Clone of ${schema.meta.url}</title>`,
      `  <link rel="stylesheet" href="styles.css">`,
      `</head>`,
      `<body>`,
      sections.includes("nav") ? `  <nav class="navbar"><!-- Navigation --></nav>` : "",
      sections.includes("hero") ? `  <section class="hero"><!-- Hero section --></section>` : "",
      sections.includes("features") ? `  <section class="features"><!-- Features --></section>` : "",
      sections.includes("pricing") ? `  <section class="pricing"><!-- Pricing --></section>` : "",
      sections.includes("testimonials") ? `  <section class="testimonials"><!-- Testimonials --></section>` : "",
      `  <footer class="footer"><!-- Footer --></footer>`,
      `</body>`,
      `</html>`,
      "```",
      "",
      "```css",
      `/* Base styles cloned from ${schema.meta.url} */`,
      `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }`,
      `body { font-family: ${fontFamily}; font-size: ${schema.design.typography.base_size}px; line-height: ${schema.design.typography.line_height_base}; }`,
      `.container { max-width: ${maxWidth}px; margin: 0 auto; padding: 0 ${schema.design.spacing.scale[3] ?? 16}px; }`,
      schema.design.colors.dark_mode
        ? `@media (prefers-color-scheme: dark) { body { background: #0a0a0a; color: #fafafa; } }`
        : "",
      schema.design.motion.has_reduced_motion_support
        ? `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }`
        : "",
      "```",
    ].filter((l) => l !== undefined).join("\n");
  }

  if (framework === "react") {
    return [
      "## App Layout (React + Tailwind)",
      "```tsx",
      `// app/layout.tsx (Next.js App Router)`,
      `export default function RootLayout({ children }: { children: React.ReactNode }) {`,
      `  return (`,
      `    <html lang="en">`,
      `      <body style={{ fontFamily: '${fontFamily}', fontSize: '${schema.design.typography.base_size}px' }}>`,
      `        <nav className="sticky top-0 z-50 border-b border-gray-200 bg-white/80 backdrop-blur">`,
      `          <div className="mx-auto max-w-[${maxWidth}px] px-4">`,
      `            {/* Navigation */}`,
      `          </div>`,
      `        </nav>`,
      `        <main>{children}</main>`,
      `        <footer className="border-t border-gray-200 py-12">`,
      `          <div className="mx-auto max-w-[${maxWidth}px] px-4">`,
      `            {/* Footer */}`,
      `          </div>`,
      `        </footer>`,
      `      </body>`,
      `    </html>`,
      `  );`,
      `}`,
      "```",
    ].join("\n");
  }

  return `## Layout\n*Scaffold for ${framework} — sections detected: ${sections.join(", ")}*`;
}
