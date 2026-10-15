---
name: web-vitals-audit
description: Audit Core Web Vitals (LCP/INP/CLS) and loading/rendering/network cost — never fabricating metrics.
---

# Web Vitals audit

Use for a performance pass on a web app. Identify the framework/rendering model
first and only apply idioms from the stack in use.

## Metric honesty (non-negotiable)
Reading source cannot measure LCP/INP/CLS. Without a Lighthouse/CrUX/DevTools
artifact, mark the scorecard "not measured" and tag findings as *potential impact*.
With data, label each value by source (field vs lab) and never conflate them.

## What to scan
- **LCP** — hero image preloaded with `fetchpriority=high`, not lazy-loaded; TTFB < 800ms.
- **CLS** — explicit width/height on media/embeds; font swap without reflow.
- **INP** — long tasks (>50ms) broken up; heavy handlers yield to the main thread.
- **Loading** — bundle split, JS < ~200KB gz initial, fonts subset + preload, modern image formats.
- **Network** — long-cache hashed assets, brotli/gzip, no N+1 or sequential awaits, paginated lists.
- **AI anti-patterns** — state not lifted, memo-everything, over-fetching "just in case".

## Output
Scorecard first (or "not measured"), then findings ranked Critical→Info, each with
a concrete, framework-appropriate fix.
