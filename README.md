# fuongz's Extensions

A small toolbox of browser tweaks. Each one is a **tool** with its own on/off
switch and its own settings, all managed from a single popup dashboard.

## Workspace layout

This repository is a Bun monorepo with one application in it. Applications live
in `apps/`; reusable libraries, UI, and other shared code belong in `packages/`.

```
apps/
  chrome-extension/  the Chrome extension — this is the whole product
packages/
  (empty; shared code goes here when a second consumer exists)
```

| Tool                       | What it does                                                                             | Runs on          |
| -------------------------- | ---------------------------------------------------------------------------------------- | ---------------- |
| **Pinterest Dark/Light**   | Repaints pinterest.com to match the extension's appearance, with no white flash on load. | `pinterest.com`  |
| **T1 Esports Tracker**     | T1's next matches, recent results, and each tournament's group stage or bracket.         | the popup itself |
| **Task Name Translator**   | Rewrites selected text — Vietnamese or English — as one English task title.               | any page, on right-click |

The extension talks to three servers and no more: pinterest.com (nothing, it
only restyles it), lolesports.com for the schedule, and OpenRouter for the task
titles. There is no backend of ours in between — the OpenRouter call is billed
to a key you paste in Settings and is made only when you pick the item from the
right-click menu.

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

## Task Name Translator

Switch the tool on in the popup, then use the **Settings** button in the app bar
to paste an [OpenRouter](https://openrouter.ai/settings/keys) API key. **Test
connection** confirms the key works and reports what is left on it. The key is
stored only in `chrome.storage.local` for this browser profile, is never synced
by Chrome, and is never shown again after saving.

The model defaults to `deepseek/deepseek-v4-flash-0731` and the field takes any
slug OpenRouter accepts. A title is a dozen tokens out of a sentence in, so the
cheapest capable model is simply the right one here — $0.08/M in, $0.18/M out.

Requests send `reasoning: { enabled: false }`. Most models worth using now think
before they answer, those tokens are output tokens, and they are spent *before*
the first character of the title — so a token ceiling sized to a title produces
no title at all, only `finish_reason: "length"`. There is nothing to deliberate
about here, so it is switched off and the ceiling is generous anyway, for the
models that will not switch it off.

**Test connection** makes two round trips: the key, then the model actually
rewriting a Vietnamese line, and it prints what came back. A valid key on a
model that cannot answer otherwise looks exactly like a working setup right up
until the first right-click.

Then select some text anywhere. A small button appears just past the end of the
selection; press it and a popover opens pointing at the text, showing what it
picked up under **Selected**, then the English task title, then **Copy**. The
right-click menu still works and does the same thing — useful when the button is
in the way.

The raw selection stays on screen throughout, including while you wait. Chrome
normalises whitespace and cuts a selection off at 1024 characters, so a drag
that grabbed one word too few is otherwise invisible — you would just get a
title that is subtly about the wrong thing.

**On Google Sheets there is also a Replace button**, which writes the title
straight back over the selected text and leaves Sheets' own undo working. It
appears on `https://docs.google.com/spreadsheets/*` and nowhere else: replacing
text means writing into whatever is focused, and on an arbitrary page that is a
good way to overwrite something you did not mean. The URL is checked in the
service worker against Chrome's own `pageUrl`, so a page cannot talk its way
onto the list. Sheets draws its grid on a canvas and replaces the right-click
menu there, so this works where a text selection actually exists — inside a cell
you have double-clicked into, or in the formula bar.

The title follows the conventions a board already uses: an imperative verb,
sentence case, no trailing period, no invented ticket id, at most twelve words.
Identifiers, file paths and product names in the input are kept verbatim.

> Cần sửa lỗi đăng nhập bị treo khi token hết hạn trên trang thanh toán
>
> → **Fix login hanging when the token expires on the checkout page**

Nothing leaves the browser until you press the button or pick the menu item, and
only the selected text is sent — never the page. With the tool switched off
there is no button and no menu item, and the content script reads nothing.

**This tool is why the extension asks to read every site.** A button that
appears when you select text has to be listening before you select it, and
there is no way to be listening on a page you have not been injected into — so
it ships as a content script on `http(s)://*/*`, and Chrome says so at install:
*"Read and change all your data on all websites."* What that script may do is
narrow by construction: it holds no API key, makes no network request of its
own, and with the tool switched off it draws nothing and reads nothing. The key
lives in the service worker and stays there.

## How it's put together

```
apps/chrome-extension/src/
  common/
    types.ts       shapes the registry is built from
    registry.ts    THE list of tools — everything else derives from it
    storage.ts     one chrome.storage.sync blob, plus a localStorage mirror
    appearance.ts  Dark / Light / System — shared by the popup and the tools
    openrouter.ts  the API key, and the two calls it is spent on
    icons.ts       renders Hugeicons' icon data into an <svg>
    ui.ts          Button, Segmented, Switch and Menu
  background/
    index.ts       the service worker: the context menu, and the only key reader
  options/
    index.html     the Settings page
    index.ts       its behaviour
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
    task-namer/
      definition.ts  the registry entry
      constants.ts   the tool id, the message names, and where Replace is offered
      naming.ts      the instruction, and cleaning up what comes back
      overlay.ts     the button over a selection, and the popover that answers
      overlay.css    its styles, which import none of the popup's
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

**One appearance, everywhere — except in someone else's page.** Dark / Light /
System is a single value in `chrome.storage.sync`, set from the app bar. The
popup applies it as `data-theme`; the Pinterest content script reads the *same*
value to decide whether to darken the page, so its own switch only says whether
to apply it at all. That is why it lives in `common/appearance.ts` — a content
script importing anything under `popup/` would drag the dashboard's DOM code
into every content bundle. Each surface keeps a `localStorage` mirror in its own
origin for the same reason the tool states do: `chrome.storage` is async, and at
`document_start` async means "after the page painted in the wrong theme".

The task-name card is the exception: it follows `prefers-color-scheme` alone. It
is injected mid-gesture, after the page has already painted, so reading the
setting would mean an async hop before the card can appear — to theme a surface
that is on screen for ten seconds.

**Two kinds of tool.** Most act on a page and ship a declared content script —
Pinterest Dark/Light on `pinterest.com`, Task Name Translator everywhere. A tool
can instead draw its own view inside the popup, as T1 Esports Tracker does, by
setting `hasPanel` and registering a renderer in `src/popup/tool-ui.ts`.

`activeTab` and `scripting` remain for one narrow case: Chrome does not
retro-inject a newly declared content script into tabs that were already open,
so the worker's `send()` falls back to `chrome.scripting` when a tab has nothing
listening. Without it, installing or reloading the extension would mean
reloading every open tab before the right-click menu worked.

**The key never leaves the service worker.** The worker reads it, spends it, and
sends the page a finished string or an error sentence. The injected card holds no
credential and makes no request of its own — it runs inside a document the
extension does not trust, and anything it held would be one `debugger` away from
that document's author.

**Nothing survives between events.** MV3 tears a worker down after ~30 seconds
idle, so `background/index.ts` keeps no state: every handler re-reads what it
needs from storage, and the context menu is rebuilt on install, on startup, and
whenever the tool's switch changes.

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
win, loss, the LIVE badge, and the violet the buttons are pressed in.

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
one-way migration from the pre-registry `pinterestDarkEnabled` boolean. The
OpenRouter key is the one thing kept out of that blob: it lives under
`chrome.storage.local['fz.openrouter.v1']`, because `sync` would put a secret on
every machine the profile has ever touched.

**Content scripts decide before first paint.** `chrome.storage` is async, and at
`document_start` async means "after the page painted white". Each content script
reads a `localStorage` mirror of that blob synchronously, acts on it, then
reconciles against `chrome.storage.sync` and listens for changes.

`tool-ui.ts` is deliberately not part of the registry. Content scripts import
`registry.ts` (through `storage.ts`), so anything hanging off a tool's
definition ships to every page that tool runs on — a panel renderer drags the
popup's DOM code along, and an icon drags a couple of kilobytes of SVG no
content script will ever draw. The same reasoning keeps
`t1-tracker/constants.ts` down to the tool id alone, and keeps
`task-namer/constants.ts` down to the id, the message names and the asset paths:
the instruction and the OpenRouter client live in `naming.ts`, which only the
worker imports. `bun run build` prints every bundle size if you want to check
you haven't undone that.

**Icons come from [Hugeicons](https://hugeicons.com)'** free Stroke Rounded set
(`@hugeicons/core-free-icons`, MIT). Their packages ship icons as data — a list
of `[tag, attributes]` pairs — with renderers for React, Vue, Angular and
Svelte; this popup has none of those, so `common/icons.ts` renders the same data
itself. Importing one icon at a time keeps the rest of the 5,400 out of the
bundle.

### Adding a tool

1. Add `apps/chrome-extension/src/tools/<id>/definition.ts` and register it in
   `apps/chrome-extension/src/common/registry.ts`.
2. **For a page tool:** write `apps/chrome-extension/src/tools/<id>/content.ts`;
   read state via `readMirroredStates()` and keep it in step with
   `onToolStatesChanged()`. Add a `content_scripts` entry (and any host
   permission) to `apps/chrome-extension/extension/manifest.json`, and build
   steps to `apps/chrome-extension/package.json`.
3. **For a panel tool:** set `hasPanel: true`, write a renderer taking
   `(host, enabled)`, and add it to
   `apps/chrome-extension/src/popup/tool-ui.ts` — along with the tool's icon,
   which goes in the same file. It needs no build step — the popup bundle
   already reaches it — but any server it calls needs a `host_permissions` entry.
The popup picks the tool up on its own either way.

A page tool must gate itself on its own switch — read it with
`readMirroredStates()` before first paint and follow `onToolStatesChanged()`.
That gate is the whole justification for a broad `matches` pattern: a tool
switched off should cost the pages it matches nothing at all.

## Scripts

| Command                    | What it does                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `bun run build`            | Full build into `apps/chrome-extension/extension/dist/`, Tailwind included.         |
| `bun run dev`              | Build, then rebuild content scripts, popup, worker and CSS on save.                 |
| `bun run gate`             | `build` + `lint` + `typecheck`, in that order.                                      |
| `bun run typecheck`        | `tsc --noEmit`.                                                                     |
| `bun run lint`             | Biome.                                                                              |
| `bun run icons`            | Rasterize `apps/chrome-extension/assets/icon.svg` into the three PNG sizes the manifest declares. |
| `bun run preview`          | Screenshot real Pinterest pages with the theme applied, into `.preview/`.           |
| `bun run preview:popup`    | Drive the built popup in headless Chrome and check the dashboard, into `.preview/`. |
| `bun run preview:task-name`| Drive the task-name card through its three states over a hostile host page.          |

## Verifying

Chrome 137 disabled `--load-extension`, so none of these scripts loads a real
unpacked extension — each reproduces one part of it over CDP instead.

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

`bun run preview:task-name` serves a deliberately hostile host page — Comic
Sans on `*`, uppercase on every `button`, a 20px root and a loud background —
then injects the built stylesheet and bundle and plays the worker's messages at
it. It drives the real path: select the paragraph, check the button appears past
the end of the selection and clear of it, press it, and check the popover opens
pointing at the text.

Every press is a real `Input.dispatchMouseEvent` rather than `element.click()`,
and that distinction is the whole point. A programmatic click never moves focus,
so it sails straight past the entire class of bug these buttons guard against:
pressing anything in this UI blurs the page and collapses the selection — the
input, and the thing **Replace** overwrites — unless the `mousedown` default is
prevented. The suite asserts the selection survives the press, and drives
**Replace** into a contenteditable standing in for a spreadsheet's cell editor.

Its other load-bearing assertions are the ones only a hostile page can make: the
card keeps its own font and its buttons keep their own case. It also checks the
tool's switch actually gates the content script, that the card is reused rather
than stacked when the bundle is injected twice, that the raw selection is on
screen in every state, that Copy reaches the clipboard, and that **Try again**
and **Open settings** send exactly the messages `background/index.ts` listens
for.

What it can't reach: the context menu itself, the real OpenRouter round trip,
and Google Sheets specifically — its grid is a canvas with its own right-click
menu, so both the selection and the native menu only exist inside a cell editor.
Those need Load unpacked and a human.

`bun run icons` is the same trick pointed at artwork: `assets/icon.svg` is the
source of truth, and each size is rendered from the vector by the engine that
will draw it in the toolbar rather than downsampled from one raster. It reads
every file back afterwards and samples it, because the failure that matters —
opaque corners on a rounded-square icon — is invisible until it is in a
toolbar.

The bracket fixture is EWC 2026 Group C copied field for field from the live
response, `origin.structuralId` included, so the connector logic is checked
against a real double-elimination group rather than something invented.

Everything is stubbed there so live results can't move under the assertions,
which means the checks prove the tool's behaviour but not that the real
endpoint still answers the shape it parses. That one is worth spot-checking by
hand when the tool misbehaves — Riot's esports API is undocumented, and the key
in `api.ts` is the one their web client ships.

None of them checks manifest parsing, permissions, or real cross-profile sync.
Those need Load unpacked and a human.

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
> • **Task Name Translator** — select any text, in Vietnamese or English, press
> the button that appears, and get one properly written English task title back,
> ready to paste into Jira or Linear. In Google Sheets it can write the title
> straight into the cell. It runs on your own OpenRouter key, which stays in this
> browser, and only when you ask for it. It's off until you switch it on, and
> while it's off it does nothing on any page.
>
> One appearance control, in the toolbar popup: follow your system, or pin
> everything to light or dark.
>
> No accounts, no tracking, no analytics. Settings sync with your browser
> profile; your OpenRouter key deliberately does not, and never leaves this
> device except as the request you asked for.

## Permissions

| Permission                             | Why                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `storage`                              | Remembers which tools are on and their settings, synced to your profile.  |
| `contextMenus`                         | Puts **Translate to task name** on the right-click menu — only when you have text selected, and only while that tool is switched on. |
| content script on `http(s)://*/*`      | Task Name Translator's button over a selection, and its popover. It cannot listen for a selection on a page it is not on. This is what Chrome describes as "read and change all your data on all websites"; the script holds no key, makes no request, and does nothing at all while the tool is off. |
| `scripting` + `activeTab`              | Only to cover tabs that were already open when the extension was installed or reloaded — Chrome does not retro-inject a content script into those. |
| `https://*.pinterest.com/*`            | The Pinterest theme's content script and stylesheet.                      |
| `https://esports-api.lolesports.com/*` | T1's schedule. Only requested once the tracker is switched on.            |
| `https://static.lolesports.com/*`      | Team logos in the tracker's list.                                         |
| `https://openrouter.ai/*`              | The task-title call, on your own key, on the click that asks for it.      |
