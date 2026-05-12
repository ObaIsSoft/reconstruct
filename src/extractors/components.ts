// Component assembler — groups CSS selectors into semantic component definitions
// Decompose BEM/utility selectors into base + states + variants + sub-elements.
// Input: first-party CSS blocks. Output: named components with their CSS surface area.

import type { CSSBlock } from "../schema/types.js";

export interface ComponentDefinition {
  name: string;
  selector_root: string;
  states: string[];
  variants: string[];
  sub_elements: string[];
  key_properties: string[];
  is_interactive: boolean;
  selector_count: number;
}

// Pseudo-classes that describe document structure, not user interaction.
const STRUCTURAL_PSEUDOS = new Set([
  "first-child", "last-child", "nth-child", "nth-last-child",
  "first-of-type", "last-of-type", "only-child", "only-of-type",
  "root", "empty", "is", "where", "not", "has",
  "before", "after", "placeholder", "selection", "marker", "backdrop",
]);

// Single-character HTML tag names we skip as component bases
const HTML_TAGS = new Set([
  "a", "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "div", "span", "section", "article",
  "main", "header", "footer", "nav", "aside", "form",
  "input", "select", "textarea", "button", "label",
  "table", "thead", "tbody", "tr", "th", "td",
  "img", "video", "audio", "canvas", "svg", "path",
]);

function extractPseudo(selector: string): string | undefined {
  const m = selector.match(/:([a-z][\w-]*)(?:\([^)]*\))?/i);
  if (!m) return undefined;
  const p = m[1].toLowerCase();
  return STRUCTURAL_PSEUDOS.has(p) ? undefined : p;
}

interface SelectorDecomposition {
  base: string;
  state?: string;
  variant?: string;
  sub_element?: string;
}

function decompose(selector: string): SelectorDecomposition | null {
  const s = selector.trim();
  // Skip @-rules, :root, html/body standalone, combinators without a class
  if (s.startsWith("@") || /^(?::root|html|body)\s*\{/.test(s)) return null;

  const classMatch = s.match(/\.([a-z][a-z0-9]*(?:-[a-z0-9]+)*)/i);
  if (!classMatch) return null;

  const fullClass = classMatch[1];

  // BEM element: block__element (and possibly block__element--modifier)
  const bemElMatch = fullClass.match(/^([a-z][a-z0-9-]+)__([a-z][a-z0-9-]+)/i);
  if (bemElMatch) {
    const base = bemElMatch[1];
    const sub = bemElMatch[2];
    const modMatch = fullClass.match(/__[a-z][a-z0-9-]+--([a-z][a-z0-9-]+)/i);
    const pseudo = extractPseudo(s);
    return { base, sub_element: sub, state: pseudo, variant: modMatch?.[1] };
  }

  // BEM modifier: block--modifier
  const bemModMatch = fullClass.match(/^([a-z][a-z0-9-]+)--([a-z][a-z0-9-]+)/i);
  if (bemModMatch) {
    const pseudo = extractPseudo(s);
    return { base: bemModMatch[1], variant: bemModMatch[2], state: pseudo };
  }

  // Base class with pseudo
  const pseudo = extractPseudo(s);
  if (pseudo) return { base: fullClass, state: pseudo };

  return { base: fullClass };
}

function inferKeyProperties(propertyBlocks: string[]): string[] {
  const props = new Set<string>();
  for (const block of propertyBlocks) {
    for (const m of block.matchAll(/([\w-]+)\s*:/g)) {
      const p = m[1];
      if (/^(?:display|position|flex|grid|background|border|padding|margin|color|font|width|height|max-width|min-width|border-radius|box-shadow|transition|transform|opacity|cursor)/.test(p)) {
        props.add(p);
      }
    }
  }
  return [...props].slice(0, 8);
}

const INTERACTIVE_NAMES = new Set([
  "button", "btn", "link", "input", "checkbox", "radio", "select", "toggle",
  "switch", "tab", "menu", "dropdown", "modal", "dialog", "tooltip",
  "accordion", "collapse", "carousel", "slider", "popover", "overlay",
]);

function toTitleCase(s: string): string {
  return s.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("");
}

export function assembleComponents(blocks: CSSBlock[]): ComponentDefinition[] {
  const fpTexts = blocks.filter(b => b.origin === "first-party").map(b => b.text);
  const allTexts = blocks.map(b => b.text);
  const css = (fpTexts.length > 0 ? fpTexts : allTexts).join("\n");

  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");

  interface GroupData {
    states: Set<string>;
    variants: Set<string>;
    sub_elements: Set<string>;
    property_blocks: string[];
    selector_count: number;
  }

  const groups = new Map<string, GroupData>();
  const ruleRe = /([^{}@][^{}]*)\{([^{}]+)\}/g;
  let m: RegExpExecArray | null;

  while ((m = ruleRe.exec(clean)) !== null) {
    const selector = m[1].trim();
    const properties = m[2].trim();
    if (!properties) continue;

    const dec = decompose(selector);
    if (!dec) continue;

    const { base, state, variant, sub_element } = dec;
    if (base.length < 2 || HTML_TAGS.has(base)) continue;

    if (!groups.has(base)) {
      groups.set(base, { states: new Set(), variants: new Set(), sub_elements: new Set(), property_blocks: [], selector_count: 0 });
    }
    const g = groups.get(base)!;
    g.selector_count++;
    g.property_blocks.push(properties);
    if (state) g.states.add(state);
    if (variant) g.variants.add(variant);
    if (sub_element) g.sub_elements.add(sub_element);
  }

  const results: ComponentDefinition[] = [];
  for (const [base, g] of groups) {
    if (g.selector_count < 2) continue;

    const isInteractive = INTERACTIVE_NAMES.has(base) ||
      g.states.has("hover") || g.states.has("focus") || g.states.has("active");

    results.push({
      name: toTitleCase(base),
      selector_root: `.${base}`,
      states: [...g.states].slice(0, 8),
      variants: [...g.variants].slice(0, 8),
      sub_elements: [...g.sub_elements].slice(0, 8),
      key_properties: inferKeyProperties(g.property_blocks),
      is_interactive: isInteractive,
      selector_count: g.selector_count,
    });
  }

  return results.sort((a, b) => b.selector_count - a.selector_count).slice(0, 30);
}
