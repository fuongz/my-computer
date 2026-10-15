# fuongz's tools

A small toolbox, in two shapes. Most of it is a **Chrome extension**, where each
tool has its own on/off switch and its own settings, all managed from a single
popup dashboard. The rest is a **web app**, for the tools that want more room
than a 340px browser action gives them.

## Workspace layout

This repository is a Bun monorepo with two applications in it. Applications live
in `apps/`; reusable libraries, UI, and other shared code belong in `packages/`.

```
apps/
  chrome-extension/  the extension and its popup dashboard
  webapp/            the web app — TanStack Start on Cloudflare Workers
packages/
  (empty; shared code goes here when a second consumer exists)
```

Nothing is shared between the two yet, and that is deliberate. They overlap in
taste — the same registry-is-the-source-of-truth idea, the same Hugeicons, the
same black-and-white palette — but not in code, and a `packages/ui` extracted
before a second consumer exists is a package shaped by exactly one caller.

### The extension's tools

| Tool                     | What it does                                                                             | Runs on                  |
| ------------------------ | ---------------------------------------------------------------------------------------- | ------------------------ |
| **Pinterest Dark/Light** | Repaints pinterest.com to match the extension's appearance, with no white flash on load. | `pinterest.com`          |
| **T1 Esports Tracker**   | T1's next matches — each one told which round of which bracket it is — and every tournament's bracket, readable before it is filled in. | the popup itself         |
| **Task Name Translator** | Rewrites selected text — Vietnamese or English — as one English task title.              | any page, on right-click |
| **Dò vé số**             | Checks a Vietnamese lottery ticket against one province's draw on one date.              | the popup itself         |
| **YouTube Cinema**       | Gives a watch page's video the whole window — no masthead, no comments, no fullscreen.   | `youtube.com`            |
| **Instagram Full Size**  | A button on every post photo: view it full size, download it, or zip a whole carousel.   | `instagram.com`          |

The extension talks to seven servers and no more: pinterest.com and youtube.com
(nothing, it only restyles them), instagram.com and its image CDN for a post's
full-size photos, lolesports.com for the schedule, OpenRouter for the task titles,
xskt.com.vn for the lottery results, and lol.fandom.com for the seeds an unfilled
bracket is waiting on. There is no backend of ours in between — the OpenRouter
call is billed to a key you paste in Settings and is made only when you pick the
item from the right-click menu, and the wiki read is off until you switch it on
in the tracker's own settings.

### The web app's tools

| Tool                              | What it does                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------- |
| **Bộ sưu tập Mobile Legends**     | Marks which of 133 heroes and 1,007 skins you own, and shows what is missing.  |

The web app has no backend either, and that is the point: every tool in it runs
in the browser and keeps its state in `localStorage`. The Worker only serves the
app, which is why `apps/webapp/wrangler.jsonc` declares no bindings at all.

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

## Running the web app

```bash
bun run dev:webapp     # vite dev on :5174
bun run deploy:webapp  # vite build, then wrangler deploy
```

`bun run dev` is the extension, not this — there are two apps and no sensible
default, so each is named explicitly. Running both at once is two terminals, not
one command.

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

## Dò vé số

Switch the tool on, pick a province, pick a date, type the six digits. The panel
answers with a celebratory card if the ticket won and a gentle one if it did not,
over the full draw table with every matching digit highlighted.

**Scoring happens here, not there.** `prizes.ts` takes the drawn numbers and the
ticket and works out the result locally: a suffix match for giải tám up through
giải nhất, an exact match for đặc biệt, phụ đặc biệt when only the first digit
differs, khuyến khích when exactly one of the last five does, and the prizes
summed when a ticket takes more than one. The site is asked for numbers, never
for a verdict.

**The province table is offline.** `provinces.ts` holds all 35 draw slots — 21
southern, 14 central — as slug, name, region and weekday, so the panel can say
*"Hậu Giang chỉ xổ Thứ Bảy"* without spending a request. Miền Bắc is deliberately
absent: it draws once for the whole region on a different prize structure with
five-digit tickets, so it needs its own parser and its own rules rather than
another row.

That offline table is also what makes the site survivable. **Asking xskt.com.vn
for a date a province did not draw does not 404** — it answers with that
province's same calendar day from some *other* year, which is a wrong result that
looks exactly like a right one. So `api.ts` reads the date the returned table
declares in its own `i.dockq[data-url]` and rejects anything that is not the date
asked for, and the weekday check refuses to send the request in the first place.

The site has no API, so this parses the result page's `table.result`. The HTML
only ever reaches `DOMParser` — which runs no scripts, and whose document is
never attached to the popup's — and the request goes out from the popup directly,
because the extension page holds the `https://xskt.com.vn/*` permission and needs
no worker in the middle.

## YouTube Cinema

A YouTube watch page never gives the video the window. Theater mode widens it
and stops there: the masthead stays on top, and the title, the channel row, the
comments and the related rail stay below. The only way to fill the screen is
native fullscreen, which also takes the browser's own chrome and the menu bar —
so watching something full-size *and* keeping a window is not on offer. Netflix's
player does exactly that, and this is that, on YouTube.

Switch the tool on and every `/watch` page opens with the video filling the
viewport.

**Shift+F** leaves and re-enters; **Escape** leaves. There is deliberately
nothing in the player's control bar: a toggle lived there for a while — as an
icon, then as a switch shaped like the player's own autoplay control — and every
version of it either outweighed the icons it sat among or sat a few pixels off
their line. The bar is Google's, it is rebuilt without warning, and a control
that never looks quite native is worse than no control.

What cinema does owe the viewer is a way home: hiding the masthead hides the
YouTube logo with it. So it puts one back — a left arrow over the video's top
left corner, where Netflix keeps its own, appearing and fading with the player's
own controls and going to youtube.com. It exists only while the video is filling
the window; the moment it isn't, the masthead is back and the arrow is not.

On a livestream, cinema owes it something else: hiding the page below the video
hides the "N watching now" count with it. So the top right corner gets an eye
and that same number, read straight out of the DOM YouTube already rendered it
into — no API call, no new request, just the text the page itself is keeping
current. It appears only while that wording is actually there, follows it as
YouTube updates it, and disappears the moment it isn't — a stream ending, the
page turning out not to be live at all, or cinema itself going off.

Two settings sit on top of that button, and they are two switches rather than one
either/or because they are not alternatives:

| Setting           | On                                                     | Off                                                     |
| ----------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| **Every video**   | A watch page opens with the window already filled.     | It opens as YouTube drew it, until you press Shift+F.   |
| **Shift+F hotkey**| **Shift+F** toggles cinema and **Escape** leaves it.   | The keys are YouTube's again — an F reaches its own fullscreen. |

They are two switches rather than one either/or because they are not
alternatives. Turning both off, though, leaves the tool with nothing to act on:
no keys, and nothing that starts by itself. That combination is a way of parking
the tool without switching it off, and not much else.

`f` still does what it always did. Entering native fullscreen drops cinema
entirely, so YouTube's own fullscreen layout is the only thing positioning the
player; leaving fullscreen puts cinema back, rather than dumping you in a grid
you never asked to see.

**One rule does the work.** `#movie_player` is pinned to `inset: 0` above
YouTube's own fixed masthead. Nothing is relayouted — the grid the player came
out of is still there, behind an opaque player — and that is what keeps the tool
from having an opinion about a layout Google rewrites every few months. What
`cinema.css` hides (masthead, guide, `#below`, `#secondary`) is belt and braces:
it stops the page scrolling and stops YouTube drawing over the video, but the
video is full-size without any of it.

Two details are where this kind of thing usually breaks. The player writes the
video's box as inline pixels, measured for a grid cell it is no longer in, so the
stylesheet overrides that with a percentage box and `object-fit: contain` — which
letterboxes a 4:3 video exactly as fullscreen does instead of stretching it. And
`position: fixed` is measured against the nearest ancestor with a transform, a
filter or containment rather than against the viewport, so every ancestor between
`ytd-app` and the player has all three cleared; without that the player drops
back into the page the moment YouTube animates a route change.

The selector is scoped under `ytd-watch-flexy` for one reason: the same
`#movie_player` element is reparented into `ytd-miniplayer` when the miniplayer
opens, and a miniplayer pinned to `inset: 0` is not a miniplayer.

## Instagram Full Size

Instagram shows a post's photo at whatever size fits the column and gives no way
to see it larger or save it. Switch the tool on, hover a photo in the feed, on a
post's own page or in a post opened over a profile, and a button appears in its
top-right corner. It opens a menu:

| Item                 | What it does                                                                 |
| -------------------- | ---------------------------------------------------------------------------- |
| **View image**       | A lightbox with the photo at full size. On a carousel, ← and → (or the arrows on screen) step through every photo in it. |
| **Download image**   | Saves the photo on screen — on a carousel, the slide you are looking at — as `{username}_{shortcode}_{n}.jpg`. |
| **Download all (N)** | Carousels only. Every photo in the post, in one `{username}_{shortcode}.zip`. |

Videos are not handled: on a video slide the first two items are disabled, and
**Download all** counts and zips the photos only, numbered by their slide so
`_3` is still the third dot.

**Where the full size comes from.** The `<img>` tags on the page carry 1080px at
most, and a carousel only renders the slides next to the one on screen, so the
page alone can neither give the original nor list every photo. The first time a
post's menu opens, the tool asks Instagram the same thing its own page does —
`/api/v1/media/{id}/info/`, from the tab you are signed in with, so it can only
ever see what you can — and gets every slide at its largest size, typically
1440px. The id is the post's shortcode decoded from base 64, so it costs no
extra lookup. If that request fails, **View** and **Download image** still work
from the largest size the `<img>` offers, and **Download all** says it could not
load the post.

**Which photo is "this one".** The button finds its photo by asking the browser
what is under the pointer (`elementsFromPoint`), not by walking Instagram's
markup: the class names there change with every deploy, and a transparent layer
over each photo takes every mouse event. On a carousel, the slide on screen is
matched to its place in the post by its CDN file name, which every size of the
same image shares. Thumbnails — anything inside a link to a post, like a profile
grid — are left alone; open the post.

**The downloads happen in the worker.** Only there can Chrome name the file,
and only there do the CDN host permissions let it read the bytes to zip them.
The zip is written by a small store-only writer (`src/common/zip.ts`, no
compression: JPEGs do not get smaller), and if building it fails the photos come
down one by one instead. The worker trusts nothing in the message: it has to
come from an instagram.com tab with the tool on, every URL has to be on
Instagram's CDN, and every file name is reduced to a bare name in your
Downloads folder.

## The web app

A dashboard shell plus one tool, served as a Cloudflare Worker. It exists because
some tools want a grid of a thousand tiles, and a 340px browser action is the
wrong shape for that.

```
apps/webapp/src/
  routes/          __root, the dashboard index, and one route per tool
  components/
    shared/        the app shell (sidebar + app bar) and the theme toggle
    ui/            vendored by the shadcn CLI — see biome.jsonc
  tools/
    registry.ts    THE list of tools — the sidebar and the dashboard both read it
    mlbb/          the Mobile Legends collection tool
      data/        heroes.json, skins.json, meta.json — baked at build time
      store.ts     zustand + persist over localStorage
  lib/theme.ts     the pre-paint theme script
  styles/app.css   the token block
scripts/
  sync-mlbb-data.ts  rebuilds data/ from the Fandom wiki
  download-art.ts    downloads every picture into public/mlbb/
```

**The dataset is baked, not fetched.** `bun run data:sync` reads
`Module:Hero/data` and `Module:Skin/data` off the MLBB Fandom wiki, parses the Lua
tables, and writes `src/tools/mlbb/data/` — 133 heroes and 1,007 skins as of the
`syncedAt` in `meta.json`. It validates every role, lane, tier and availability
against the unions in `types.ts` before writing, which is what makes the cast in
`catalogue.ts` honest. A wiki that reorganises a module breaks the sync script,
loudly, instead of shipping a half-parsed dataset.

**The artwork is ours too.** `data:sync` finishes by calling `data:art`, which
downloads one WebP per catalogue row into `public/mlbb/`, named after that row's
id — `181.webp` is Layla's default skin. That naming rule is why `images.ts` needs
no lookup table and the dataset needs no image field. It costs ~17 MB in the repo
and buys a page that does not depend on Fandom staying up, does not leak a visit
to them for every tile, and works offline in dev.

**Ownership lives in `localStorage`**, under one key, written by zustand's
`persist`. The page is server-rendered and `localStorage` does not exist there, so
rehydration is deferred to an effect and the store carries a `hydrated` flag —
rendering the grid against an empty store and then again against the real one is
how you get a flash of "you own nothing". Export and import are plain JSON — a
collection is yours, so backing it up is a file you hold, not a row we keep.

`src/tools/registry.ts` is the same idea as the extension's `common/registry.ts`
and for the same reason: adding a tool is that file plus its route, never a third
place that has to be remembered.

## How the extension is put together

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
      wiki.ts        Leaguepedia, for the seeds Riot's API doesn't carry
      panel.ts       the schedule screen, and routing to the one below
      tournament.ts  standings tables, and brackets down to what an empty slot says
    task-namer/
      definition.ts  the registry entry
      constants.ts   the tool id, the message names, and where Replace is offered
      naming.ts      the instruction, and cleaning up what comes back
      overlay.ts     the button over a selection, and the popover that answers
      overlay.css    its styles, which import none of the popup's
    lottery/
      definition.ts  the registry entry
      constants.ts   the tool id, and nothing else — same reason as above
      provinces.ts   the 35 draw slots and the weekday each one draws on
      api.ts         the xskt.com.vn scrape, the date trap, and the per-draw cache
      prizes.ts      scoring a ticket against a draw — all of it local
      panel.ts       the form, the result card, and the draw table
      picker.ts      the searchable province picker
  popup/
    index.ts       the dashboard; renders itself from the registry
    tool-ui.ts     tool id → its icon and its panel; the popup-side half
    theme.ts       puts the appearance on screen (the value lives in common/)
    style.css      the palette, and what utilities can't say
```

**No decorative separators.** A `·` or a ` • ` between two facts says nothing
about how they relate, so nothing here uses one: a hierarchy gets a chevron
(`LCK → Knockouts → Semifinals` on a fixture card, an icon between real spans),
and everything else gets the word or the punctuation that fits — "Hồ Chí Minh
**ngày** Thứ Bảy 15/08/2026", "$0.0012 of $5.00 used **(free tier)**". Same
decision as `.agents/reviews/2026-08-10/08-replace-web-middot-separators.md`,
which settled it for the web app first.

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
Pinterest Dark/Light on `pinterest.com`, YouTube Cinema on `youtube.com`, Task
Name Translator everywhere. A tool
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

Run every one of these from the repo root.

| Command              | What it does                                                            |
| -------------------- | ----------------------------------------------------------------------- |
| `bun run gate`       | `build` + `lint` + `typecheck`, in that order. The one to run before a commit. |
| `bun run build`      | Builds **both** apps — the extension into `apps/chrome-extension/extension/dist/`, Tailwind included, and the web app into `apps/webapp/dist/`. |
| `bun run typecheck`  | `tsc --noEmit` in both apps.                                            |
| `bun run lint`       | Biome's linter.                                                         |
| `bun run check`      | Biome's linter **and** formatter. `gate` does not run this — the formatter is a separate pass. |
| `bun run format`     | Biome's formatter, writing in place.                                    |

### The extension

| Command                     | What it does                                                           |
| --------------------------- | ---------------------------------------------------------------------- |
| `bun run dev`               | Build, then rebuild content scripts, popup, worker and CSS on save.    |
| `bun run icons`             | Rasterize `apps/chrome-extension/assets/icon.svg` into the three PNG sizes the manifest declares. |
| `bun run preview`           | Screenshot real Pinterest pages with the theme applied, into `.preview/`. |
| `bun run preview:popup`     | Drive the built popup in headless Chrome and check the dashboard, into `.preview/`. |
| `bun run preview:task-name` | Drive the task-name card through its three states over a hostile host page. |
| `bun run preview:youtube`   | Screenshot real YouTube watch pages in cinema mode, and check the player is the viewport. |
| `bun run check:instagram`   | Offline checks for Instagram Full Size: the zip opens in `unzip` and `tar`, shortcodes decode to the right ids, and media-info answers parse. Opens nothing. |

### The web app

| Command                 | What it does                                                               |
| ----------------------- | -------------------------------------------------------------------------- |
| `bun run dev:webapp`    | `vite dev` on port 5174.                                                   |
| `bun run deploy:webapp` | `vite build`, then `wrangler deploy`.                                       |
| `bun run data:sync`     | Rebuild `apps/webapp/src/tools/mlbb/data/` from the Fandom wiki, then download any new artwork. |

`data:art` — the download half of `data:sync`, on its own — has no root alias on
purpose; it is not something you run on its own often. Reach it with
`bun run --filter @fuongz/webapp data:art`.

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
the round appended to a fixture that is in one, a standings table, a bracket
with its connectors, the widening and the way
back, then the same view over a bracket nobody has qualified for yet — first
with Leaguepedia off, then switched on so the seeds appear, then with the wiki
answering 503 to prove the bracket doesn't care — and finally a failed refresh
over a stale cache and an outage with nothing cached.

It drives **Dò vé số** the same way, over a stubbed xskt.com.vn: off and silent
(zero requests asserted), the searchable province picker, the exact URL it asks
for a given province and day, a winning ticket, the full draw table, a ticket
that takes more than one prize, a miss, and the whole thing in dark mode. The
stub matters more here than elsewhere — a real draw page changes daily, so live
results would move under every assertion within a day of writing them.

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

`bun run preview:youtube` runs the built tool — the stylesheet *and* the bundle
out of `extension/dist` — over two real watch pages, against a
`chrome.storage.sync` stand-in the harness flips the switch and both settings in.
Nothing in it reimplements the tool: every attribute, button and keystroke it
checks is the shipped content script's own.

It asserts the stylesheet alone changes nothing until the bundle runs, then that
the player ends up exactly the size of the viewport, the masthead and everything
below the video are gone, the control bar spans the window, and the page cannot
scroll. One of the two pages is 4:3 for a single assertion: that the video
letterboxes rather than stretches, the one failure that would be worse than the
small player it replaced.

The rest is the ways in and out, each under real input rather than a
`element.click()`: the way home sitting over the top left, fading with the
player's own controls, leaving with cinema and — under a real mouse press —
reaching youtube.com; Shift+F leaving cinema and bringing YouTube's own layout
and masthead back intact, then returning; Shift+F
and Escape doing the same from the keyboard, `f` still giving real fullscreen —
with cinema standing down and the toggle hiding itself while it lasts, and both
coming back on exit — either setting being off leaving the button working anyway,
and the tool's own switch going off taking the attribute and the button with it
without a reload.

Neither page is actually live, so the viewer count is checked against a
livestream synthesized rather than found: the same "N watching now" text
YouTube writes into the page, in the exact spot the selector reads it from.
It asserts the overlay stays off with none of that text on the page, appears
once it exists, shows exactly what YouTube wrote, follows it when that text
changes, is never drawn twice, and disappears with the text — whether that is
the live data being pulled or cinema itself going off.

What it can't reach: manifest parsing, and a client-side route change from a
related video. Those need Load unpacked and a human.

`bun run icons` is the same trick pointed at artwork: `assets/icon.svg` is the
source of truth, and each size is rendered from the vector by the engine that
will draw it in the toolbar rather than downsampled from one raster. It reads
every file back afterwards and samples it, because the failure that matters —
opaque corners on a rounded-square icon — is invisible until it is in a
toolbar.

The bracket fixtures are copied field for field from live responses,
`origin` included, so the connectors and the slot labels are checked against
real brackets rather than something invented: EWC 2026 Group C for a group that
has been played out, and LCK Split 3 2026's Play-Ins and Regional Championship
for one that has not — where every slot is still TBD and the labels are all
there is to read.

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
> tournament they're in. A fixture in a bracket says which round it is, which
> the schedule alone never does — it names the stage and stops, so "Knockouts"
> becomes "Knockouts → Semifinals". A play-in or playoff bracket is drawn up long before
> anyone qualifies for it, so every empty slot says what will fill it — a seed,
> the winner or loser of an earlier round, or a team still to come out of the
> group stage. Switch on **Read Leaguepedia for seeding** and those slots get
> the wiki's own answer instead — "Rise #1", "Seed 5/6" — along with the teams
> that already have a place in the stage. It's off until you switch it on, and
> so is the wiki read.
>
> • **Task Name Translator** — select any text, in Vietnamese or English, press
> the button that appears, and get one properly written English task title back,
> ready to paste into Jira or Linear. In Google Sheets it can write the title
> straight into the cell. It runs on your own OpenRouter key, which stays in this
> browser, and only when you ask for it. It's off until you switch it on, and
> while it's off it does nothing on any page.
>
> • **Dò vé số** — check a Vietnamese lottery ticket without squinting at a
> results table. Pick the province and the draw date, type your six digits, and
> it tells you what you won, with the matching numbers highlighted in the full
> draw. Covers all 35 southern and central provinces. It's off until you switch
> it on.
>
>
> • **YouTube Cinema** — a watch page where the video actually fills the window.
> Nothing over it, nothing under it, and no need for fullscreen, so you keep your
> tabs, your toolbar and your menu bar. Shift+F gives the normal page back when
> you want to read the comments, and while the video is filling the window
> there's an arrow in the top corner that takes you back to YouTube, since the
> usual logo isn't there to. On a livestream, the top right corner keeps the
> viewer count you'd otherwise lose along with the rest of the page. `f` still
> gets you real fullscreen. It's off until you switch it on, and it touches
> nothing but a watch page.
>
> • **Instagram Full Size** — hover a photo on Instagram and a small button
> appears in its corner: view it full size, download it, or download every photo
> in a carousel as one zip. It's off until you switch it on.
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
| `downloads`                            | Instagram Full Size saving a photo, or a carousel's zip, under a name of its own. Nothing else is downloaded. |
| `https://*.pinterest.com/*`            | The Pinterest theme's content script and stylesheet.                      |
| `https://www.youtube.com/*`            | YouTube Cinema's content script and stylesheet. It reads nothing but the page YouTube already rendered — the live viewer count included — and makes no request; on anything but a watch page it does nothing at all. |
| `https://esports-api.lolesports.com/*` | T1's schedule. Only requested once the tracker is switched on.            |
| `https://lol.fandom.com/*`             | Leaguepedia, for which seed each empty bracket slot is for. Off by default; one request per tournament you open, cached for a day. |
| `https://static.lolesports.com/*`      | Team logos in the tracker's list.                                         |
| `https://openrouter.ai/*`              | The task-title call, on your own key, on the click that asks for it.      |
| `https://xskt.com.vn/*`                | The lottery draw pages. Only requested once **Dò vé số** is switched on, and only for the province and date you ask for. |
| `https://www.instagram.com/*`          | Instagram Full Size's content script and stylesheet, and the one media-info request per post whose menu you open. Nothing while the tool is off. |
| `https://*.cdninstagram.com/*`, `https://*.fbcdn.net/*` | Instagram's image CDN: reading a carousel's photos to zip them. |
