// Behavioral pattern detector — infers interactive capabilities from HTML structure
// Sources: ARIA roles, HTML5 elements, data-* attributes, inline script patterns.
// Does NOT execute JavaScript — all inference is from static HTML analysis.

export interface BehaviorPattern {
  pattern: string;
  evidence: string[];
  elements: string[];
  confidence: "definite" | "strong" | "possible";
}

// ARIA role → behavioral capability name
const ARIA_ROLE_BEHAVIORS: Record<string, string> = {
  dialog: "modal-dialog",
  alertdialog: "modal-alert",
  menu: "dropdown-menu",
  menuitem: "dropdown-menu",
  menuitemcheckbox: "dropdown-menu",
  menuitemradio: "dropdown-menu",
  listbox: "combobox-or-listbox",
  option: "combobox-or-listbox",
  combobox: "combobox-or-listbox",
  tablist: "tabbed-interface",
  tab: "tabbed-interface",
  tabpanel: "tabbed-interface",
  slider: "range-input",
  progressbar: "progress-indicator",
  tooltip: "tooltip",
  tree: "tree-navigation",
  treeitem: "tree-navigation",
  grid: "data-grid",
  row: "data-grid",
  gridcell: "data-grid",
  log: "live-region",
  status: "live-region",
  alert: "live-region",
  search: "search",
  searchbox: "search",
  spinbutton: "numeric-input",
  switch: "toggle-switch",
  toolbar: "toolbar",
  navigation: "navigation-landmark",
  banner: "header-landmark",
  contentinfo: "footer-landmark",
  complementary: "sidebar-landmark",
  form: "form",
};

interface DataSpec {
  pattern: RegExp;
  behavior: string;
  evidence: string;
}

const DATA_PATTERNS: DataSpec[] = [
  { pattern: /data-(?:toggle|target|dismiss|trigger)=/i, behavior: "toggle-component", evidence: "data-toggle/target/dismiss" },
  { pattern: /data-modal(?:-[a-z]+)?=/i, behavior: "modal-dialog", evidence: "data-modal" },
  { pattern: /data-tab(?:s|-[a-z]+)?=/i, behavior: "tabbed-interface", evidence: "data-tab" },
  { pattern: /data-accordion(?:-[a-z]+)?=/i, behavior: "accordion", evidence: "data-accordion" },
  { pattern: /data-carousel(?:-[a-z]+)?=/i, behavior: "carousel", evidence: "data-carousel" },
  { pattern: /data-tooltip(?:-[a-z]+)?=/i, behavior: "tooltip", evidence: "data-tooltip" },
  { pattern: /data-popover(?:-[a-z]+)?=/i, behavior: "popover", evidence: "data-popover" },
  { pattern: /data-aos=/i, behavior: "animate-on-scroll", evidence: "data-aos (AOS library)" },
  { pattern: /data-parallax=/i, behavior: "parallax-scroll", evidence: "data-parallax" },
  { pattern: /data-(?:lazy|src)=/i, behavior: "lazy-loading", evidence: "data-lazy/data-src" },
  { pattern: /data-infinite(?:-[a-z]+)?=/i, behavior: "infinite-scroll", evidence: "data-infinite" },
  { pattern: /data-filter(?:s|-[a-z]+)?=/i, behavior: "content-filtering", evidence: "data-filter" },
  { pattern: /data-sort(?:able)?=/i, behavior: "content-sorting", evidence: "data-sort" },
  { pattern: /data-search(?:-[a-z]+)?=/i, behavior: "search", evidence: "data-search" },
  { pattern: /data-drag(?:gable)?=/i, behavior: "drag-and-drop", evidence: "data-drag" },
  { pattern: /data-chart(?:-[a-z]+)?=/i, behavior: "data-visualization", evidence: "data-chart" },
  { pattern: /data-counter(?:-[a-z]+)?=/i, behavior: "animated-counter", evidence: "data-counter" },
  { pattern: /data-theme(?:-[a-z]+)?=/i, behavior: "theme-switching", evidence: "data-theme" },
  { pattern: /data-scroll(?:-[a-z]+)?=/i, behavior: "scroll-behavior", evidence: "data-scroll" },
];

interface ScriptSpec {
  pattern: RegExp;
  behavior: string;
  evidence: string;
  confidence: "definite" | "strong" | "possible";
}

const SCRIPT_PATTERNS: ScriptSpec[] = [
  { pattern: /IntersectionObserver/, behavior: "scroll-triggered-animation", evidence: "IntersectionObserver API", confidence: "definite" },
  { pattern: /addEventListener\s*\(\s*['"]scroll['"]/, behavior: "scroll-event-listener", evidence: "scroll event listener", confidence: "definite" },
  { pattern: /addEventListener\s*\(\s*['"](?:click|mousedown|touchstart)['"]/, behavior: "click-interaction", evidence: "click/touch event listener", confidence: "definite" },
  { pattern: /addEventListener\s*\(\s*['"](?:keydown|keyup|keypress)['"]/, behavior: "keyboard-interaction", evidence: "keyboard event listener", confidence: "definite" },
  { pattern: /customElements\.define/, behavior: "web-components", evidence: "customElements.define", confidence: "definite" },
  { pattern: /MutationObserver/, behavior: "dom-observation", evidence: "MutationObserver API", confidence: "definite" },
  { pattern: /ResizeObserver/, behavior: "resize-responsive", evidence: "ResizeObserver API", confidence: "definite" },
  { pattern: /requestAnimationFrame/, behavior: "frame-animation", evidence: "requestAnimationFrame", confidence: "definite" },
  { pattern: /new\s+WebSocket|WebSocket\s*\(/, behavior: "realtime-websocket", evidence: "WebSocket API", confidence: "definite" },
  { pattern: /EventSource\s*\(/, behavior: "server-sent-events", evidence: "EventSource (SSE)", confidence: "definite" },
  { pattern: /navigator\.geolocation/, behavior: "geolocation", evidence: "navigator.geolocation", confidence: "definite" },
  { pattern: /navigator\.serviceWorker|ServiceWorkerRegistration/, behavior: "service-worker", evidence: "ServiceWorker API", confidence: "definite" },
  { pattern: /WebGLRenderingContext|new THREE\b/, behavior: "webgl-3d", evidence: "WebGL or Three.js", confidence: "definite" },
  { pattern: /\bfetch\s*\(|axios\.(?:get|post|put|delete)|\.ajax\s*\(/, behavior: "async-data-fetch", evidence: "fetch/axios/ajax", confidence: "strong" },
  { pattern: /localStorage\.|sessionStorage\./, behavior: "client-storage", evidence: "localStorage/sessionStorage", confidence: "definite" },
  { pattern: /indexedDB/, behavior: "indexed-db", evidence: "IndexedDB API", confidence: "definite" },
  { pattern: /window\.ethereum|ethers\.(?:providers|Contract)|Web3\s*\(/, behavior: "web3-blockchain", evidence: "Web3/ethers.js", confidence: "definite" },
  { pattern: /gtag\s*\(|ga\s*\(|analytics\.track|fbq\s*\(/, behavior: "analytics-tracking", evidence: "analytics API calls", confidence: "strong" },
  { pattern: /Stripe\s*\(|stripe\.elements/, behavior: "payment-processing", evidence: "Stripe.js", confidence: "definite" },
  { pattern: /mapboxgl\.|google\.maps\.|L\.map\s*\(/, behavior: "map", evidence: "Mapbox/Google Maps/Leaflet", confidence: "definite" },
  { pattern: /Chart\.js|new Chart\s*\(|echarts\.|highcharts\.|d3\.select/, behavior: "data-visualization", evidence: "charting library", confidence: "definite" },
  { pattern: /new\s+(?:Swiper|Splide|Glide|Flickity)\s*\(/, behavior: "carousel", evidence: "carousel library init", confidence: "definite" },
  { pattern: /MediaRecorder|getUserMedia/, behavior: "media-capture", evidence: "MediaRecorder/getUserMedia", confidence: "definite" },
  { pattern: /SpeechRecognition|webkitSpeechRecognition/, behavior: "speech-recognition", evidence: "Speech Recognition API", confidence: "definite" },
  { pattern: /Notification\.requestPermission|PushManager/, behavior: "push-notifications", evidence: "Push/Notification API", confidence: "definite" },
];

export function detectBehaviorPatterns(html: string): BehaviorPattern[] {
  const results = new Map<string, BehaviorPattern>();

  function merge(
    pattern: string,
    evidence: string,
    element: string,
    confidence: "definite" | "strong" | "possible"
  ) {
    const ex = results.get(pattern);
    if (ex) {
      if (!ex.evidence.includes(evidence)) ex.evidence.push(evidence);
      if (element && !ex.elements.includes(element)) ex.elements.push(element);
      if (confidence === "definite") ex.confidence = "definite";
      else if (confidence === "strong" && ex.confidence === "possible") ex.confidence = "strong";
    } else {
      results.set(pattern, {
        pattern,
        evidence: [evidence],
        elements: element ? [element] : [],
        confidence,
      });
    }
  }

  // 1. ARIA roles
  const roleCounts = new Map<string, number>();
  for (const m of html.matchAll(/role=["']([^"']+)["']/gi)) {
    for (const role of m[1].split(/\s+/)) {
      const behavior = ARIA_ROLE_BEHAVIORS[role.toLowerCase()];
      if (behavior) roleCounts.set(behavior, (roleCounts.get(behavior) ?? 0) + 1);
    }
  }
  for (const [behavior, count] of roleCounts) {
    merge(behavior, `ARIA role (${count} instance${count > 1 ? "s" : ""})`, "", "definite");
  }

  // 2. HTML5 interactive / semantic elements
  const htmlSigs: Array<[RegExp, string, string, string]> = [
    [/<dialog\b/i, "modal-dialog", "<dialog> element", "dialog"],
    [/<details\b/i, "accordion", "<details> element", "details"],
    [/<video\b/i, "media-player", "<video> element", "video"],
    [/<audio\b/i, "media-player", "<audio> element", "audio"],
    [/<canvas\b/i, "canvas-rendering", "<canvas> element", "canvas"],
    [/<form\b/i, "form", "<form> element", "form"],
    [/<input[^>]+type=["']range["']/i, "range-input", 'input[type="range"]', "input"],
    [/<input[^>]+type=["']search["']/i, "search", 'input[type="search"]', "input"],
    [/<input[^>]+type=["']file["']/i, "file-upload", 'input[type="file"]', "input"],
    [/<input[^>]+type=["']color["']/i, "color-picker", 'input[type="color"]', "input"],
  ];
  for (const [re, behavior, evidence, element] of htmlSigs) {
    if (re.test(html)) merge(behavior, evidence, element, "definite");
  }

  // 3. Custom elements (web components)
  const customElementsSeen = new Set<string>();
  for (const m of html.matchAll(/<([a-z]+-[a-z][a-z0-9-]*)\b/gi)) {
    const el = m[1].toLowerCase();
    if (!customElementsSeen.has(el)) {
      customElementsSeen.add(el);
      merge("web-components", `<${el}> custom element`, el, "definite");
    }
  }

  // 4. data-* patterns
  for (const spec of DATA_PATTERNS) {
    if (spec.pattern.test(html)) merge(spec.behavior, spec.evidence, "", "strong");
  }

  // 5. Inline script patterns
  const scriptContent = [...html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/gi)]
    .map(m => m[1])
    .join("\n");

  for (const spec of SCRIPT_PATTERNS) {
    if (spec.pattern.test(scriptContent)) merge(spec.behavior, spec.evidence, "", spec.confidence);
  }

  const confOrder = { definite: 0, strong: 1, possible: 2 };
  return [...results.values()].sort((a, b) =>
    confOrder[a.confidence] - confOrder[b.confidence] || a.pattern.localeCompare(b.pattern)
  );
}
