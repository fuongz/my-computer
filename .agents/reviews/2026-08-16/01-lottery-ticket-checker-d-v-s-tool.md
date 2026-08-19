---
status: done
schema: 1
task_id: FE-01
category: frontend
assignees: ["fuongz"]
created_at: 2026-08-16 00:00:00Z
priority: medium
tags: ["tool", "popup-panel", "scraping"]
---

# Review: Lottery ticket checker (Dò vé số) tool

**How to review:** flip `- [ ]` to `- [x]` for each item you agree with; add a `> note` under any you don't. Implementation starts only after every box is `[x]`.

## Context

A fourth tool: check a Vietnamese lottery ticket. Inputs are **tỉnh/thành phố**, **ngày xổ** and the **6-digit ticket number**; the output is whether it won and for how much.

It is a popup-panel tool like T1 Esports Tracker — no content script, no manifest `content_scripts` entry, `hasPanel: true` — because it is a lookup, not a page tweak. It needs `https://xskt.com.vn/*` in `host_permissions`; an extension page with that permission fetches the site directly, so no background worker is involved.

**What the source looks like** (verified against live pages while writing this card):

- A draw lives at `https://xskt.com.vn/<slug>/ngay-D-M-YYYY`, e.g. `/xshg/ngay-15-8-2026`, and the result is one `table.result` whose rows are `<td title="Giải tám">G8</td><td><em>31</em></td>`. Miền Nam and Miền Trung use the identical table.
- **The trap:** asking for a date the province did not draw returns the *same day in other years* — `/xshg/ngay-16-8-2026` answers with the 16/8/**2025** table under a heading that still says 16/8. Each table carries its true date in `<i class="dockq" data-url="hau-giang/16-08-2025">`, so the parser keeps only the table whose `data-url` date is the one asked for and otherwise reports "chưa có kết quả".
- The 35 draw slots are fixed by weekday (Hồ Chí Minh on thứ 2 and thứ 7, Hậu Giang only thứ 7, …), read off `/xsmn/thu-N` and `/xsmt/thu-N`. Held as a table in the extension, a wrong weekday is caught before any request.

**The prize rules** (each one confirmed against `xskt.com.vn/do-ve-so`):

| | rule | value |
| --- | --- | --- |
| G8 → G1 | ticket's last N digits equal the prize number | 100,000 → 30,000,000 |
| ĐB | all six digits equal | 2,000,000,000 |
| Phụ ĐB | last five equal ĐB, first digit differs | 50,000,000 |
| Khuyến khích | exactly one of the last five digits differs from ĐB | 6,000,000 |

Prizes are **cumulative**: ticket `048531` against the 15/08/2026 HCM draw wins Giải Sáu + Giải Tám = 500,000, which is what the site itself returns.

## Decisions

- Pick ONE:
  - [x] **D1.** **Scoring — pick ONE.** Compute the result in the extension from the parsed draw table. *(recommended)*
    > Chosen: scoring runs in the extension. One request per draw, cached, and the parsed numbers are what the highlight is drawn from.
  - [ ] **D2.** **Scoring — pick ONE.** Fetch `xskt.com.vn/do-ve-so/...?d=&v=` and scrape its verdict sentence instead.
- [x] **D3.** Language: the panel is written in Vietnamese (Tỉnh/Thành phố, Ngày xổ, Số vé, Dò vé, and the win/miss copy), while the dashboard row that opens it stays English like its neighbours.
  > Chosen: Vietnamese panel, English dashboard row.
- [x] **D4.** The result is celebratory when it wins — a green card, a confetti burst, the total in full, then every prize hit as its own line — and gentle when it misses, with the ticket's digit tiles and the full draw table underneath, matched digits highlighted the way the site's yellow rows do.
  > Confirmed, and the full draw table stays visible under the verdict rather than behind a disclosure.
  > Three refinements asked for while it was being built, all in: (1) the province field is a searchable command palette rather than a `<select>` — 35 rows is a scroll, and search is diacritic-blind and reads the site's slugs, so "hau giang", "haugiang", "xshg" and "hcm" all land; (2) the draw is a fully ruled table with its numbers centred, and the đặc biệt and giải tám set large and red as the source sheet sets them; (3) the picker only ever drops downwards — a browser action's window is as tall as its document, so opening upwards ran off the top of the popup. The ticket's digits also moved inside the verdict card, which was two half-empty objects before.
- [x] **D5.** Picking a province snaps the date to that province's most recent draw day; typing a date the province does not draw shows an inline note ("Hậu Giang chỉ xổ Thứ Bảy") and holds the request rather than spending it.
- [x] **D6.** Miền Bắc is not offered — its draw has a different prize structure (7 giải, 27 numbers, 5-digit tickets) and would need its own parser and rules.
- [x] **D7.** A drawn result never changes, so each draw is cached in `chrome.storage.local` under `fz.xs.*` and re-read forever; only the "no result yet" answer is left uncached.

## Verify

- [x] **V1.** `bun run typecheck` and `bun run build` at the repo root.
  > Extension typecheck and build both clean. Root `bun run check` reports 21 formatting errors, all in `apps/webapp/` and the root configs — untracked work already in the tree, and `apps/chrome-extension` is excluded from biome by `biome.jsonc`, so none of them are this card's.
- [x] **V2.** `bun run preview:popup` drives the new panel against a fixture and screenshots the win, the miss and the no-draw-that-day states into `.preview/`.
  > 22 checks in `preview:popup`, all passing, with 6 screenshots. It earned its keep twice: the fixture caught giải tư's `<br>` running 65673 and 56983 together into one ten-digit number (the real page is written that way, so this was a live bug), and the short-window case reproduced the picker opening upwards off the top of the popup.
- [x] **V3.** Scoring is checked against the four live cases this card was written from: `004753` (miss), `004731` (Giải Tám), `140589` (Phụ ĐB), `048531` (Sáu + Tám = 500,000).
  > All four pinned, plus 040588 for khuyến khích: 004753 → miss, 004731 → Giải Tám 100.000, 140589 → Phụ ĐB 50.000.000, 048531 → Sáu + Tám 500.000, 040588 → Khuyến Khích 6.000.000. The parser was also run over the real saved pages for Hồ Chí Minh, Hậu Giang and Đắk Lắk, and over the no-draw page, which it correctly refused.
- [ ] **V4.** Yours: Load unpacked, run one real ticket, and confirm the request only goes out to xskt.com.vn.

## Out of scope

- Miền Bắc (XSMB), Vietlott, and the 3-digit/2-digit 'dò lô tô' style lookups.
- Saved tickets, history, or a reminder when a province draws.
- Statistics the site also sells — soi cầu, dự đoán, thống kê đầu đuôi.
- Any scraping outside the one result table: no ads, no article text, no third-party requests.

## Files touched

| File | Change |
| --- | --- |
| `apps/chrome-extension/src/tools/lottery/constants.ts` | New. The tool id and the storage-key prefix. |
| `apps/chrome-extension/src/tools/lottery/definition.ts` | New. Registry entry, `hasPanel: true`, ships switched off (it is what permits the first request). |
| `apps/chrome-extension/src/tools/lottery/provinces.ts` | New. The 35 draw slots: slug, name, region, weekday. |
| `apps/chrome-extension/src/tools/lottery/api.ts` | New. Fetch, parse `table.result`, verify the `data-url` date, cache per draw. |
| `apps/chrome-extension/src/tools/lottery/prizes.ts` | New. Score a ticket against a draw; pure, so it is the part the fixtures pin. |
| `apps/chrome-extension/src/tools/lottery/panel.ts` | New. The form and the result view. |
| `apps/chrome-extension/src/common/registry.ts` | Register the tool. |
| `apps/chrome-extension/src/popup/tool-ui.ts` | Its icon and its panel renderer. |
| `apps/chrome-extension/extension/manifest.json` | Add `https://xskt.com.vn/*` to `host_permissions`. |
| `apps/chrome-extension/scripts/preview-popup.ts` | A xskt fixture, and assertions plus screenshots for the three result states. |
