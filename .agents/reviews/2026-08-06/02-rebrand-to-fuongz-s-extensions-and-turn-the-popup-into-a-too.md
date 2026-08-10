---
status: done
assignees: []
created_at: 2026-08-06 00:00:00Z
priority: medium
tags: ["popup", "refactor", "branding"]
---

# Review: Rebrand to "fuongz's Extensions" and turn the popup into a tool dashboard

Rename the extension to "fuongz's Extensions" and restructure the popup from a single-purpose Pinterest Dark/Light toggle into a dashboard that lists multiple tools. Pinterest Dark/Light mode becomes the first entry in that tool registry.

**How to review:** flip `- [ ]` to `- [x]` for each item you agree with; add a `> note` under any you don't. Implementation starts only after every box is `[x]`.

## Decisions

- [x] **D1.** Update the extension name to "fuongz's Extensions" in the manifest, package.json, and any UI strings.
- [x] **D2.** Define a tool registry (id, name, description, icon, enabled state) as the single source of truth for the dashboard.
- [x] **D3.** Move the Pinterest Dark/Light mode logic behind that registry as the first registered tool.
- [x] **D4.** Redesign the popup as a dashboard listing tool cards with per-tool enable/disable toggles.
- [x] **D5.** Persist per-tool enabled state in chrome.storage and have content scripts respect it.
- [x] **D6.** Add a detail/settings view so a tool can expose its own options (Pinterest theme choice lives here).
- [x] **D7.** Keep the popup sized and styled for a browser action, with an empty/placeholder state for future tools.
- [x] **D8.** Update README, icons, and store description to match the new naming and scope.
