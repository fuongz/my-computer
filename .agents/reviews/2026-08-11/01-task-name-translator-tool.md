---
status: processing # todo | processing | done | dropped
assignees: ["fuongz"]
created_at: 2026-08-11 00:00:00Z # the date for this card
priority: medium # low | medium | high
tags: ["chrome-extension", "tool", "openrouter", "llm", "settings"]
---

# Review: Task Name Translator, and the OpenRouter key that feeds it

A third tool. Select text on any page — Vietnamese or English — and a small
button appears past the end of the selection; press it and a popover opens
pointing at the text, holding one grammatical English task title of the kind an
IT team writes in Jira or Linear. The right-click item **Translate to task
name** does the same thing, for when the button is in the way.

This also brings back a Settings page and the app-bar Settings button, deleted
an hour earlier with `apps/api`. It now holds an **OpenRouter key of your own**
rather than a URL and a key for a backend that no longer exists.

Written `processing` rather than `todo`: the user asked for the implementation
directly in the same message that specified the tool. The decisions below are
recorded so they can be argued with after the fact, not before.

## Decisions taken

- **D1. ~~No new static content script.~~ Reversed by the user, same day.**
  Recorded rather than rewritten, because the reversal is the interesting part.

  The first version injected the card on demand with
  `chrome.scripting.executeScript` under `activeTab`, so the extension stayed
  out of every page until you right-clicked. The user then asked for Google
  Translate's shape: a button that appears **over the selection itself**, and a
  popover anchored to it. There is no way to be listening for a selection on a
  page you have not been injected into, so that shape requires a
  `content_scripts` entry on `http(s)://*/*` and the permission warning that
  comes with it — "Read and change all your data on all websites".

  Put to the user as three options (Sheets-only, everywhere, or popover-without-
  trigger). They chose everywhere, knowing the warning. What softens it:
  - the tool ships **off**, and with the switch off the content script attaches
    listeners but reads nothing and draws nothing;
  - it still holds no key and makes no request — D2 is unchanged and is what
    actually matters here;
  - no `<all_urls>` host permission was added. The content-script match is what
    injects; `activeTab` still covers the `executeScript` fallback for tabs that
    were already open when the extension was reloaded.
- **D2. The service worker owns the call.** It reads the key, calls OpenRouter,
  and messages the page. The key never reaches a content script, so a hostile
  page cannot read it out of the injected bundle.
- **D3. The key lives in `chrome.storage.local`, never `sync`.** Same stance as
  the connection it replaces: a synced key is a key on every machine the profile
  has ever touched.
- **D4. `https://openrouter.ai/*` is a static `host_permissions` entry.** It is
  one fixed, known endpoint, so there is nothing to ask for at runtime — unlike
  the arbitrary API base URL this replaces, which had to be optional.
- **D5. Off by default,** like the T1 tracker: switching a tool on is what
  permits its first network call. With the tool off there is no context menu and
  no button over a selection — the content script tests one boolean per mouseup
  and stops.
- **D6. The prompt names the output contract, not the input language.** One
  imperative English title, sentence case, no trailing period, no ticket id, no
  quotes, ≤ 12 words. The model detects Vietnamese on its own; enumerating
  source languages only invites it to translate literally.
- **D7. Model is `deepseek/deepseek-v4-flash-0731`,** and it is editable on the
  Settings page — a task title is a cheap call and the right model for it
  changes faster than this repo does. Verified against OpenRouter's public model
  list on 2026-08-11: $0.08/M in, $0.18/M out, 1M context, and it supports
  `temperature`. It replaced `openai/gpt-5.6-luna` (the removed API's model,
  $0.10/$0.60), which does not list `temperature` among its parameters at all —
  so the determinism this code asks for was being dropped on the floor.
- **D8. Errors are actionable.** A missing key renders an **Open settings**
  button in the card rather than a sentence telling you to go find it. A 200
  with no content is taken apart rather than reported as one sentence: the empty
  answer names the model, and says whether it ran out of room, spent the budget
  reasoning, or simply returned nothing.
- **D11. Reasoning is turned off, and the token ceiling is generous.** Shipped
  broken and fixed the same day, so the reasoning is worth recording. The first
  version sent `max_tokens: 60` — sized to a twelve-word title — and got
  `OpenRouter answered with nothing usable` on every call. `GET /api/v1/models`
  reports `deepseek-v4-flash-0731` as
  `{ default_enabled: true, default_effort: "high", mandatory: false }`: it
  reasons hard unless told not to, and reasoning tokens are output tokens
  counted **before** the first character of the answer. Sixty tokens of a
  high-effort preamble is not a short title, it is an empty one with
  `finish_reason: "length"`. Fixed on both axes — `reasoning: { enabled: false }`
  (legal here because `mandatory` is false) and a 512-token ceiling that saves
  the call on a model where it is not.
- **D9. The raw selection is shown in every state,** under a "Selected" label,
  clamped to three lines. Chrome normalises whitespace and truncates a selection
  at 1024 characters, so a drag that grabbed the wrong range is otherwise
  invisible — the only symptom is a title that is subtly about the wrong thing.
- **D10. Replace is allow-listed, not universal.** On
  `https://docs.google.com/spreadsheets/*` the card offers **Replace**, which
  writes the title back over the selection with `execCommand("insertText")` —
  deprecated, and still the only path that leaves the host app's undo stack
  intact. Everywhere else there is no such button: writing into whatever happens
  to be focused on an arbitrary page is a good way to destroy something the user
  did not mean. The match is made in the worker against Chrome's own `pageUrl`,
  and the card is told only the boolean, so a page cannot argue itself onto the
  list. The whole card prevents its own `mousedown` default, without which
  pressing anything in it would blur the cell editor and collapse the selection
  being replaced.
- **D12. The button is bound to `mouseup`/`keyup`, not `selectionchange`.**
  `selectionchange` fires on every pixel of a drag, so a button bound to it
  flickers along under the cursor for the whole gesture. These fire once, when
  the user has finished saying what they meant.
- **D13. The button sits just *past* the end of the selection, not above it.**
  It is anchored to the last of the range's client rects, and "above the last
  line" is "on top of the line before it" for anything that wrapped — the button
  would cover the very text it is offering to rewrite. Below also puts it under
  the hand that just released there.
- **D14. The popover is placed in page coordinates, not the viewport.** It
  scrolls with the text it points at, because a popover that stays put while its
  subject scrolls away is pointing at nothing. It flips above the selection when
  the window bottom is closer than the card is tall, and its arrow tracks the
  selection independently once the card has been pushed sideways to stay on
  screen. With no selection to point at — a right-click whose selection was
  already dropped — it falls back to a corner rather than aiming at nothing.
- **D15. The input can be corrected, and the card borrows focus to do it.**
  Added the same day, on the user's ask. **Try again** rolls the same dice
  again, which is the wrong tool for the failure D9 exists to make visible: a
  drag that grabbed one word too few, or a cell that says "login bug" and leaves
  out where. Those want a different question, not another answer to the same
  one — so **Edit** reopens the text that was sent in a box, and **Regenerate**
  asks with it.

  The cost is that this breaks the invariant D10 leans on. A textarea cannot be
  typed into inside a card that prevents every `mousedown` default, so the box
  is the one exemption — and taking the caret is exactly what collapses the
  selection Replace writes over. So the editor notes the page's `activeElement`
  and a clone of its `Range` on the way in and puts both back on the way out,
  and Replace still lands in the cell the card was opened over. Best-effort by
  nature: a range whose nodes the page has since torn out throws, and the
  existing "Select it again" is what that degrades to.

  Placed beside the "Selected" label rather than in the row of answers — it acts
  on the text above it, not the title below — and absent while a request is in
  flight, where the only thing it could do is discard a call already paid for.
  Escape backs out of the editor before it closes the card.

## Verification

- [x] `bun run gate` — build, lint, typecheck.
- [x] `bun run preview:task-name` — 40 checks over a hostile host page, driving
      the real path end to end: select → the button appears past the end of the
      selection → a real `Input.dispatchMouseEvent` press asks the worker and
      leaves the selection intact → the popover opens pointing at the text. Plus
      a press on **Replace** writing into a contenteditable, which is what proves
      the focus guard, and the off state drawing nothing.
- [x] The D15 editor, in the same run: a real press on **Edit** opens the box and
      the caret lands in it, `Input.insertText` types at the end, **Regenerate**
      asks the worker about the corrected text, and the contenteditable gets its
      selection back — the last of those being the invariant D15 puts at risk.
- [ ] Load unpacked, add a key, select Vietnamese text, right-click → the card
      opens, resolves, and Copy puts the title on the clipboard.
- [ ] In a Google Sheet, edit the text, **Regenerate**, then **Replace** — the
      hand-back in D15 is best-effort against a host app that may commit or tear
      down its cell editor the moment it loses focus, and Sheets is the one host
      that matters here. If it does not survive, Replace says "Select it again"
      rather than writing somewhere wrong.
- [ ] In a Google Sheet, double-click into a cell, select its text, right-click →
      **Replace** appears and writes the title into the cell, and ⌘Z undoes it.
      This is the one thing the preview cannot reach: Sheets draws its grid on a
      canvas and replaces the right-click menu there, so whether Chrome's native
      menu appears at all depends on being inside the cell editor.
- [ ] With the tool switched off, the context menu item is absent and selecting
      text draws no button.
- [ ] The button behaves on a real Sheets grid, where the selection lives in a
      cell editor over a canvas.
- [ ] Chrome's install prompt says "Read and change all your data on all
      websites" — the cost D1 was reversed for. Confirm it reads as expected.
- [ ] With the tool on and no key, the card offers **Open settings**.
- [ ] Chrome's extension details page lists `contextMenus`, `scripting`,
      `activeTab`, `storage` and no broad host access.
- [ ] **Test connection** now makes two round trips — the key, then the model
      rewriting a Vietnamese line — and prints the title it produced. A valid key
      on a model that cannot answer used to look exactly like a working setup
      until you right-clicked something; that is how the reasoning bug in D11 got
      as far as being the default.
- [ ] Judge `deepseek-v4-flash-0731` on real Vietnamese input. Its price,
      parameters and reasoning defaults check out; the quality of its
      Vietnamese → English rewriting is the one thing that cannot be verified
      without spending a key.

## Out of scope

- Any per-language or per-team style setting beyond the model field.
- History of past translations, or a popup panel for this tool.
- Streaming the answer; a task title is short enough to wait for.

## Files touched

| File | Change |
| --- | --- |
| `src/common/openrouter.ts` | New: key + model storage, the chat call with reasoning off, `GET /key`, and one error type that takes an empty answer apart. |
| `src/tools/task-namer/constants.ts` | New: tool id, message names, asset paths, the Replace allow-list. |
| `src/tools/task-namer/definition.ts` | New: the registry entry. |
| `src/tools/task-namer/naming.ts` | New: the instruction and the cleanup of what comes back. |
| `src/tools/task-namer/overlay.{ts,css}` | New: the button over a selection, the popover, and the D15 editor that borrows the page's focus to correct the input; gated on the tool's switch. |
| `src/background/index.ts` | New again: the context menu and the only read of the key. |
| `src/options/{index.html,index.ts}` | New again: the OpenRouter key, model, and a Test connection that exercises both. |
| `src/common/registry.ts` | Register the tool; note the shapes a tool can take. |
| `src/popup/{index.ts,index.html}` | The Settings button returns to the app bar. |
| `src/popup/tool-ui.ts` | The tool's icon. |
| `extension/manifest.json` | `contextMenus`/`scripting`/`activeTab`, openrouter.ai, worker, options page, and the `http(s)://*/*` content script per D1. |
| `scripts/preview-task-name.ts` | New: 40 checks, every press a real mouse event. |
| `package.json` | Build steps for the worker, the options page and the overlay bundle; `preview:task-name`. |
