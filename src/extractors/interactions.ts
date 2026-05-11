// Interaction extractor — hover states, focus strategy, scroll behaviors, transitions
// Input: CSS texts + HTML
// Output: InteractionToken[], TransitionToken[], scroll behaviors, focus strategy

import type { InteractionToken, TransitionToken, CSSBlock } from "../schema/types.js";
import { firstPartyText, allText } from "../schema/types.js";

// ── Rule block parser ─────────────────────────────────────────────────────────

interface RuleBlock {
  selector: string;
  properties: string;
}

function parseRuleBlocks(css: string): RuleBlock[] {
  const blocks: RuleBlock[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}@][^{}]*)\{([^{}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    blocks.push({ selector: m[1].trim(), properties: m[2].trim() });
  }
  return blocks;
}

function changedProperties(block: string): string[] {
  const props: string[] = [];
  const propRe = /([\w-]+)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = propRe.exec(block)) !== null) {
    const prop = m[1];
    if (!prop.startsWith("-") && !["animation", "content", "cursor"].includes(prop)) {
      props.push(prop);
    }
  }
  return [...new Set(props)];
}

function inferElementFromSelector(selector: string): string {
  const s = selector.toLowerCase();
  if (/button|\.btn/.test(s)) return "button";
  if (/a\b|\.link/.test(s)) return "link";
  if (/input|textarea|select/.test(s)) return "input";
  if (/\.card/.test(s)) return "card";
  if (/nav|\.nav/.test(s)) return "nav";
  if (/img|\.image/.test(s)) return "image";
  if (/li\b/.test(s)) return "list-item";
  return "element";
}

// ── Hover / focus / active patterns ──────────────────────────────────────────

export function extractHoverPatterns(cssTexts: string[]): InteractionToken[] {
  const tokens: InteractionToken[] = [];

  for (const css of cssTexts) {
    const blocks = parseRuleBlocks(css);

    for (const { selector, properties } of blocks) {
      const isHover = /:hover/.test(selector);
      const isFocus = /:focus/.test(selector) || /:focus-visible/.test(selector);
      const isActive = /:active/.test(selector);

      if (!isHover && !isFocus && !isActive) continue;

      const changes = changedProperties(properties);
      if (changes.length === 0) continue;

      const state: InteractionToken["state"] = isHover
        ? "hover"
        : isFocus
        ? "focus"
        : "active";

      const durationMatch = properties.match(/([\d.]+)(ms|s)/);
      const durationMs = durationMatch
        ? durationMatch[2] === "s"
          ? Math.round(parseFloat(durationMatch[1]) * 1000)
          : Math.round(parseFloat(durationMatch[1]))
        : undefined;

      tokens.push({
        element: inferElementFromSelector(selector),
        state,
        changes,
        motion: durationMs
          ? {
              property: changes[0] ?? "all",
              duration_ms: durationMs,
              easing:
                properties.match(
                  /(?:ease[\w-]*|linear|cubic-bezier\([^)]+\))/i
                )?.[0] ?? "ease",
              trigger: state,
            }
          : undefined,
      });
    }
  }

  const seen = new Set<string>();
  return tokens.filter((t) => {
    const key = `${t.element}:${t.state}:${t.changes.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Focus strategy ────────────────────────────────────────────────────────────

export function detectFocusStrategy(
  cssTexts: string[],
  html: string
): "native" | "custom" | "hidden" | "mixed" {
  const css = cssTexts.join("\n");
  const hasOutlineNone = /outline\s*:\s*(?:none|0)/.test(css);
  const hasFocusVisible = /:focus-visible/.test(css);
  const hasCustomFocus =
    /:focus\s*\{[^}]*(?:box-shadow|border|ring|background)[^}]*\}/.test(css);
  const hasFocusIndicator = /focus(?:ring|outline|border)/i.test(html + css);

  if (hasOutlineNone && !hasFocusVisible && !hasCustomFocus) return "hidden";
  if (hasOutlineNone && (hasFocusVisible || hasCustomFocus)) return "mixed";
  if (hasFocusVisible || hasCustomFocus || hasFocusIndicator) return "custom";
  return "native";
}

// ── Transitions ───────────────────────────────────────────────────────────────

export function extractTransitions(cssTexts: string[]): TransitionToken[] {
  const tokens: TransitionToken[] = [];
  const seen = new Set<string>();

  for (const css of cssTexts) {
    const blocks = parseRuleBlocks(css);

    for (const { selector, properties } of blocks) {
      const transMatch = properties.match(/transition\s*:\s*([^;]+)/i);
      if (!transMatch) continue;

      const val = transMatch[1].trim();
      const durationMatch = val.match(/([\d.]+)(ms|s)/);
      if (!durationMatch) continue;

      const duration_ms =
        durationMatch[2] === "s"
          ? Math.round(parseFloat(durationMatch[1]) * 1000)
          : Math.round(parseFloat(durationMatch[1]));

      const easing =
        val.match(
          /(?:ease[\w-]*|linear|cubic-bezier\([^)]+\)|steps\([^)]+\))/i
        )?.[0] ?? "ease";

      const propPart = val
        .replace(/([\d.]+)(ms|s)/g, "")
        .replace(/(?:ease[\w-]*|linear|cubic-bezier\([^)]+\)|steps\([^)]+\))/gi, "")
        .trim();

      const transitionedProps = propPart
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);

      const key = `${transitionedProps.join(",")}:${duration_ms}:${easing}`;
      if (seen.has(key)) continue;
      seen.add(key);

      tokens.push({ selector, properties: transitionedProps, duration_ms, easing });
    }
  }

  return tokens.slice(0, 30);
}

// ── Scroll behaviors ──────────────────────────────────────────────────────────

export function detectScrollBehaviors(
  html: string,
  cssTexts: string[]
): string[] {
  const css = cssTexts.join("\n");
  const behaviors: string[] = [];

  if (/position\s*:\s*sticky/.test(css)) behaviors.push("sticky-nav");
  if (/scroll-behavior\s*:\s*smooth/.test(css) || /scroll-behavior="smooth"/.test(html))
    behaviors.push("smooth-scroll");
  if (/parallax/i.test(html + css)) behaviors.push("parallax");
  if (/data-aos/.test(html) || /aos\.js/.test(html)) behaviors.push("scroll-reveal");
  if (/locomotive-scroll/.test(html)) behaviors.push("locomotive-scroll");
  if (/scroll-snap/.test(css)) behaviors.push("scroll-snap");
  if (/IntersectionObserver/.test(html)) behaviors.push("intersection-observer");
  if (/loading="lazy"/.test(html)) behaviors.push("lazy-load-images");
  if (/scroll.*progress|progress.*scroll/i.test(html + css))
    behaviors.push("scroll-progress");

  return [...new Set(behaviors)];
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface InteractionProfile {
  global_hover_patterns: InteractionToken[];
  focus_strategy: "native" | "custom" | "hidden" | "mixed";
  scroll_behaviors: string[];
  transitions: TransitionToken[];
}

export function extractInteractions(
  blocks: CSSBlock[],
  html: string
): InteractionProfile {
  // Interaction patterns extracted from first-party CSS only — third-party components
  // define their own hover/focus/transition rules which don't reflect the site's design.
  const fpTexts = firstPartyText(blocks);
  const useTexts = fpTexts.length > 0 ? fpTexts : allText(blocks);
  return {
    global_hover_patterns: extractHoverPatterns(useTexts),
    focus_strategy: detectFocusStrategy(useTexts, html),
    scroll_behaviors: detectScrollBehaviors(html, useTexts),
    transitions: extractTransitions(useTexts),
  };
}
