# fuongz's Extensions

A small toolbox of browser tweaks. Each one is a **tool** with its own on/off
switch and its own settings, all managed from a single popup dashboard.

## Workspace layout

This repository is a Bun monorepo. Applications live in `apps/`; reusable
libraries, UI, and other shared code belong in `packages/`.

```
apps/
  chrome-extension/  the Chrome extension
  web/               the web app: sign-in, keys, generation history, costs
  api/               the public generation API every client calls
packages/
  auth/              @fuongz/auth — one Better Auth config and one database schema
```

The extension holds no provider credentials. It calls **one** URL — `apps/api` —
with one API key, and that API decides whether a request runs on your own
OpenRouter and Replicate keys or on a small free daily allowance. See
[apps/api/README.md](apps/api/README.md).

| Tool                      | What it does                                                                              | Runs on          |
| ------------------------- | ----------------------------------------------------------------------------------------- | ---------------- |
| **Pinterest Dark/Light**  | Repaints pinterest.com to match the extension's appearance, with no white flash on load.  | `pinterest.com`  |
| **T1 Esports Tracker**    | T1's next matches, recent results, and each tournament's group stage or bracket.          | the popup itself |

## Install (unpacked)

```bash
bun install
bun run build
```

The popup's CSS is compiled by Tailwind, so `bun run build` is required after a
checkout — there is no committed stylesheet to fall back on.

Then in Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → pick the `apps/chrome-extension/extension/` folder.
4. Pin the extension and click it to open the dashboard.

`bun run dev` rebuilds on save. Content-script changes need a reload of the
extension _and_ of the tab; popup changes just need the popup reopened.

Use the popup's Settings button to open the Options page. Paste the API base URL
and an API key created on the web app's **API keys** page, then use **Test
connection** — it reports which account you are on, whether each provider will
use your own key or the free allowance, and how much of today's allowance is
left. The key is stored only in `chrome.storage.local` for this browser profile,
is never synced by Chrome, and is never shown again after saving.

**Sync generations to the web app** decides retention, not routing: on, the
prompt and image are kept in your account and appear under **Generations**; off,
they are used once and not stored. What each request cost is recorded either
way — that is what **Usage** reads.

On any HTTP(S) website, ask **How was this made?** about an image — either by
right-clicking it, or from the button that appears in its top-right corner on
hover. Both open the same dialog, and both only *open* it: the image URL leaves
the browser when you choose **Analyze image** and not before. The API asks
`openai/gpt-5.6-luna` for one copyable prompt for `gpt-image-2`. Creating an
image is a third, separate action that sends that prompt on to `gpt-image-2`.

Image generation is asynchronous: the API records it and the extension polls for
up to a minute. Giving up at a minute writes nothing — the generation keeps
running server-side, and it will appear under **Generations** when it finishes.

The dialog is one card that morphs through the whole flow rather than a
sequence of screens — the image you picked stays on screen and is scanned in
place. Only images at least 160px on a side get the hover button; below that an
image is furniture, not a subject.

## How it's put together

```
apps/chrome-extension/src/
  common/
    types.ts       shapes the registry is built from
    registry.ts    THE list of tools — everything else derives from it
    storage.ts     one chrome.storage.sync blob, plus a localStorage mirror
    appearance.ts  Dark / Light / System — shared by the popup and the tools
    icons.ts       renders Hugeicons' icon data into an <svg>
    ui.ts          Button, Segmented, Switch and Menu
  tools/
    pinterest-theme/
      definition.ts  the registry entry (name, icon, settings)
      constants.ts   keys and colours shared with the content script
      content.ts     the content script itself
      theme.css      the theme, scoped to one attribute on <html>
    t1-tracker/
      definition.ts  the registry entry
      constants.ts   the tool id, and nothing else — see below
      api.ts         the lolesports client, its caches, and its config
      panel.ts       the schedule screen, and routing to the one below
      tournament.ts  standings tables and brackets
  popup/
    index.ts       the dashboard; renders itself from the registry
    tool-ui.ts     tool id → its icon and its panel; the popup-side half
    theme.ts       puts the appearance on screen (the value lives in common/)
    style.css      the palette, and what utilities can't say
```

**Styling is Tailwind utilities**, written onto the elements in the TypeScript
that builds them. `style.css` is the entry: design tokens, a few base rules, and
the bracket's SVG connectors. The bare class names beside the utilities
(`.tool-card`, `.t1-side-code`, …) carry no styles — they are how this code and
`apps/chrome-extension/scripts/preview-popup.ts` address elements.

Tailwind finds classes by scanning source text, so **never build a class name by
concatenation**: `` `t1-side-${position}` `` compiles to no CSS at all. Anything
conditional picks between whole literal strings.

**One size, with one exception.** The popup is a normal 340px browser action.
The tournament view marks its own root with `t1-wide` and `style.css` widens the
window around it to 780px, because a bracket does not fit in 340. That rule
lives in the utilities layer, not base: it overrides `w-[340px]` on the element
itself, and a later cascade layer beats a higher specificity every time.

**One appearance, everywhere.** Dark / Light / System is a single value in
`chrome.storage.sync`, set from the app bar. The popup applies it as
`data-theme`; the Pinterest content script reads the *same* value to decide
whether to darken the page, so its own switch only says whether to apply it at
all. That is why it lives in `common/appearance.ts` — a content script importing
anything under `popup/` would drag the dashboard's DOM code into every content
bundle. Each surface keeps a `localStorage` mirror in its own origin for the
same reason the tool states do: `chrome.storage` is async, and at
`document_start` async means "after the page painted in the wrong theme".

**Four shared components** live in `common/ui.ts` — `button()`, `segmented()`,
`switchControl()` and `menu()` — beside `icons.ts` and for the same reason: the
T1 panel draws with them, and a tool reaching into `popup/` would invert the
one-way dependency the panel contract keeps. A list is a `menu()`: one raised
container, flat rows, hairline dividers. Only things that are not lists — the
match cards — stay individually elevated.

`button()` has **no caller yet**. It was built to a supplied reference for the
next screen that needs one; until then it is dead code, deliberately.

**Elevation, not outline.** Cards, rows and controls separate by tone plus a
soft two-layer shadow rather than a hairline — `shadow-rest` at rest,
`shadow-raised` on hover. Dark mode folds `--edge`, a 1px inner highlight, into
both: without it a dark card on a dark page has no top edge at all. Radii come
from a four-step scale (`sm` 8 / `md` 12 / `lg` 16 / `xl` 22) rather than the
eleven ad-hoc values this replaced.

Two deliberate exceptions. **Dense surfaces stay flat** — the standings table
and the bracket boxes separate by tone only, because ten stacked shadows at
340px read as mush and a pillowy table stops reading as a table. And every
elevated surface keeps a `border: 1px solid transparent`: invisible normally,
but Windows high-contrast drops `box-shadow` outright, and without it those
cards would lose their edges entirely there.

**Black and white, three states.** The palette carries no brand hue: `--accent`
is full-strength ink — near-black on light, white on dark — and emphasis comes
from muting whatever it competes with. Anything drawn *on top* of accent uses
`--on-accent`, which flips with the theme; hard-coding `text-white` there breaks
one of the two modes. The only colours left are the ones that mean something:
win, loss, and the LIVE badge.

Type is **Geist** (SIL OFL), bundled as one variable file rather than fetched —
a popup has to paint immediately and offline, and it is the only way the
`font-[650]` weights resolve. Colours are plain custom properties, exposed to
Tailwind with `@theme inline` so `bg-surface` resolves to `var(--color-surface)`
instead of a baked hex — which is what lets the same utilities follow the theme
without a `dark:` variant on every element. Light is the bare `:root` palette;
dark arrives either from `prefers-color-scheme` or from `data-theme="dark"`, and
"System" is the *absence* of that attribute. `theme.ts` mirrors the choice into
`localStorage` and applies it at module top level, because an extension page
can't run an inline script and `chrome.storage` would arrive after first paint.

**The registry is the single source of truth.** The popup has no knowledge of
any specific tool: it reads `TOOLS`, draws a card per entry, and draws a detail
view from each entry's `settings`. Storage does the same for defaults.

**State lives in one key.** `chrome.storage.sync['fz.tools.v1']` holds
`{ [toolId]: { enabled, settings } }`. Stored values are never trusted —
`resolveStates()` rebuilds state from the registry on every read, so a removed
tool, a renamed setting, or a stale value all fall back to defaults. There is a
one-way migration from the pre-registry `pinterestDarkEnabled` boolean.

**Content scripts decide before first paint.** `chrome.storage` is async, and at
`document_start` async means "after the page painted white". Each content script
reads a `localStorage` mirror of that blob synchronously, acts on it, then
reconciles against `chrome.storage.sync` and listens for changes.

**Two kinds of tool.** Most act on a page and ship a content script. A tool can
instead draw its own view inside the popup — T1 Esports Tracker is the first —
by setting `hasPanel` and registering a renderer in
`apps/chrome-extension/src/popup/tool-ui.ts`.

That file is deliberately not part of the registry. Content scripts import
`registry.ts` (through `storage.ts`), so anything hanging off a tool's
definition ships to every page that tool runs on — a panel renderer drags the
popup's DOM code along, and an icon drags a couple of kilobytes of SVG no
content script will ever draw. The same reasoning keeps
`t1-tracker/constants.ts` down to the tool id alone: its endpoint, API key and
cache live in `api.ts`, which no content script imports. `bun run build` prints
both bundle sizes if you want to check you haven't undone that.

**Icons come from [Hugeicons](https://hugeicons.com)'** free Stroke Rounded set
(`@hugeicons/core-free-icons`, MIT). Their packages ship icons as data — a list
of `[tag, attributes]` pairs — with renderers for React, Vue, Angular and
Svelte; this popup has none of those, so `common/icons.ts` renders the same data
itself. Importing one icon at a time keeps the rest of the 5,400 out of the
bundle.

### Adding a tool

1. Add `apps/chrome-extension/src/tools/<id>/definition.ts` and register it in
   `apps/chrome-extension/src/common/registry.ts`.
2. **For a page tool:** write `apps/chrome-extension/src/tools/<id>/content.ts`; read state via
   `readMirroredStates()` and keep it in step with `onToolStatesChanged()`. Add
   a `content_scripts` entry (and any host permission) to
   `apps/chrome-extension/extension/manifest.json`, and build steps to
   `apps/chrome-extension/package.json`.
3. **For a panel tool:** set `hasPanel: true`, write a renderer taking
   `(host, enabled)`, and add it to `apps/chrome-extension/src/popup/tool-ui.ts` — along with the
   tool's icon, which goes in the same file. It needs no build
   step — the popup bundle already reaches it — but any server it calls needs a
   `host_permissions` entry.

The popup picks the tool up on its own either way.

## Scripts

| Command                 | What it does                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `bun run build`         | Full build into `apps/chrome-extension/extension/dist/`, Tailwind included.         |
| `bun run dev`           | Build, then rebuild content script and popup on save.                               |
| `bun run typecheck`     | `tsc --noEmit`.                                                                     |
| `bun run icons`         | Rasterize `apps/chrome-extension/assets/icon.svg` into the three PNG sizes the manifest declares. |
| `bun run preview`       | Screenshot real Pinterest pages with the theme applied, into `.preview/`.           |
| `bun run preview:popup` | Drive the built popup in headless Chrome and check the dashboard, into `.preview/`. |
| `bun run preview:dialog` | Drive the "How was this made?" dialog through all five states, into `.preview/`. |
| `bun run test:connection` | Verify the API URL and key stay in local storage, are masked in status reads, and that old provider keys are only removed when asked. |
| `bun run test:prompt-flow` | Verify a context-menu click alone calls nothing, that **Analyze image** goes to the configured API rather than a provider, and that an unconfigured extension offers Settings. |
| `bun run test:api`      | Verify the API's key auth, cross-account isolation, allowance ceilings under concurrency, refund rules, cost arithmetic, and the poll that finishes a generation. |

## Verifying

Chrome 137 disabled `--load-extension`, so neither script loads a real unpacked
extension — each reproduces one half of it over CDP instead.

`bun run preview` injects the theme the way the content script does, and checks
that the stylesheet darkens live Pinterest markup and that the attribute gate
turns it all off. A signed-out visitor can't reach the logged-in home feed or a
pin closeup modal, so those two still need a human with an account.

`bun run preview:popup` serves the built popup with `chrome.storage` and
`fetch` stand-ins and drives it, checking that the dashboard renders from the
registry, the switches and detail view work, both persist the state shape
content scripts read back, and the appearance control stamps, clears and
remembers `data-theme`. It also drives the T1 tool end to end: off (and
silent — it asserts zero requests), the schedule cards, the tournament list,
a standings table, a bracket with its connectors, the widening and the way
back, then a failed refresh over a stale cache and an outage with nothing
cached.

`bun run icons` is the same trick pointed at artwork: `assets/icon.svg` is the
source of truth, and each size is rendered from the vector by the engine that
will draw it in the toolbar rather than downsampled from one raster. It reads
every file back afterwards and samples it, because the failure that matters —
opaque corners on a rounded-square icon — is invisible until it is in a
toolbar.

`bun run preview:dialog` serves a deliberately colourful host page — a glass
card over a flat white page proves nothing, because `backdrop-filter` has
nothing to refract — then injects the built stylesheet, a `chrome.*` stand-in
and the built content bundle, and walks the dialog from the context-menu
message through to a generated image.

Its load-bearing assertion is `image survived every state`. The dialog's whole
premise is that it is **one** card that morphs rather than five that replace
each other, and nothing in `typecheck` or the build can tell those apart — so
the script stamps an expando on the `<img>` at the confirm step and checks the
same node is still on screen at the end. It also proves the two buttons send
exactly the messages `background/index.ts` listens for, which is how a missing
`fz:generate-image` call was caught before it shipped.

What it can't reach: the real OpenRouter and Replicate round trips, the context
menu itself, and how the glass reads over a real photograph. The API's own suites
stub both providers and R2 and run every SQL statement against real SQLite, so
what they cannot reach is the providers' actual response shapes.

The bracket fixture is EWC 2026 Group C copied field for field from the live
response, `origin.structuralId` included, so the connector logic is checked
against a real double-elimination group rather than something invented.

Everything is stubbed there so live results can't move under the assertions,
which means the checks prove the tool's behaviour but not that the real
endpoint still answers the shape it parses. That one is worth spot-checking by
hand when the tool misbehaves — Riot's esports API is undocumented, and the key
in `api.ts` is the one their web client ships.

Neither checks manifest parsing, permissions, real cross-profile sync, or that a
content script actually reacts to a popup write. Those need Load unpacked and a
human.

## Store description

> **fuongz's Extensions** — a small toolbox of browser tweaks in one place.
>
> Open the toolbar icon to see every tool on one dashboard, switch each one on
> or off, and open a tool for its own settings.
>
> Included today:
>
> • **Pinterest Dark/Light** — a proper dark theme for pinterest.com. It loads
> before the page paints, so there's no white flash, and it survives Pinterest's
> in-app navigation. It follows whichever appearance you pick for the extension.
>
> • **T1 Esports Tracker** — T1's upcoming League of Legends matches and recent
> results, shown in your own timezone, plus the group stage or bracket of every
> tournament they're in. It's off until you switch it on.
>
> One appearance control, in the toolbar popup: follow your system, or pin
> everything to light or dark.
>
> No accounts, no tracking, no analytics. Settings sync with your browser
> profile. Pinterest Dark/Light needs access to pinterest.com. T1 Esports
> Tracker reads the public schedule from lolesports.com and asks for nothing
> about you — and while it's switched off, the extension makes no network
> requests at all.

## Permissions

| Permission                             | Why                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `storage`                              | Remembers which tools are on and their settings, synced to your profile.  |
| `https://*.pinterest.com/*`            | The Pinterest theme's content script and stylesheet.                      |
| `https://esports-api.lolesports.com/*` | T1's schedule. Only requested once the tracker is switched on.            |
| `https://static.lolesports.com/*`      | Team logos in the tracker's list.                                         |
| `contextMenus`                          | Shows **How was this made?** only when right-clicking an image.            |
| `optional_host_permissions`            | Requested for the one API origin you enter, on the click that saves it. The extension ships able to reach no API at all. |
