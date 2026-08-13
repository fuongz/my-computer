/*
 * Drives the Task Name Translator's in-page card through its three states, so
 * the one surface that renders inside somebody else's document can be checked
 * without loading the extension by hand.
 *
 *   bun run build && bun run preview:task-name   # screenshots to .preview/
 *
 * WHAT THIS DOES AND DOESN'T PROVE
 *
 * Chrome 137 disabled --load-extension, so this reproduces the card's half of
 * the extension instead: it serves a deliberately busy host page, injects the
 * built stylesheet and bundle the way chrome.scripting would, and stands in for
 * chrome.runtime so the worker's messages can be played at it.
 *
 * The host page is loud on purpose. A card checked over flat white proves
 * nothing about a card that has to stay readable on a real site, and the two
 * bugs this catches — inherited fonts and inherited text-transform — only show
 * up when the page fights back.
 *
 * So it *does* verify: each state renders, the host page's typography does not
 * leak in, Copy reaches the clipboard, Try again and Open settings send the
 * messages background/index.ts listens for, the editor takes the caret and
 * hands the page's selection back, and Escape closes the card.
 *
 * It does *not* verify: the context menu, the real OpenRouter round trip, or
 * activeTab injection. Those need Load unpacked and a human.
 */

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const CDP_PORT = 9337
const HTTP_PORT = 9338
const PROFILE = '/tmp/fuongz-task-name-preview-profile'
const TOOLS_DIR = new URL('../extension/dist/tools', import.meta.url).pathname
const OUT_DIR = new URL('../.preview', import.meta.url).pathname

let failures = 0

function ok(label: string, passed: boolean, detail = '') {
  if (!passed) failures++
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}

// --- minimal CDP client ----------------------------------------------------

class Cdp {
  private id = 0
  private pending = new Map<number, (value: any) => void>()

  private constructor(private socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data))
      const resolve = this.pending.get(msg.id)
      if (resolve) {
        this.pending.delete(msg.id)
        resolve(msg.result ?? msg.error)
      }
    })
  }

  static async attach(wsUrl: string): Promise<Cdp> {
    const socket = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    return new Cdp(socket)
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = ++this.id
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result?.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed')
    }
    return result?.result?.value as T
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * The socket for the *tab*, not the browser.
 *
 * `/json/version` hands back the browser target, which has no `Runtime.evaluate`
 * and no `Page.navigate` — every command in this script would come back
 * "wasn't found". `/json/list` is where the page targets are; a fresh profile
 * also lists a component extension's background page, so pick by type.
 */
async function waitForDevtools(): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
      const targets = (await res.json()) as Array<{
        type?: string
        webSocketDebuggerUrl?: string
      }>
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      // Chrome is still starting up.
    }
    await sleep(200)
  }
  throw new Error('Chrome never opened a page to attach to')
}

/*
 * chrome.runtime, reduced to the two things the card touches: a listener list
 * the harness can fire messages into, and an outbox it can read back. The card
 * imports nothing else from the extension, so this is the whole contract.
 */
const RUNTIME_SHIM = `
  (() => {
    const listeners = [];
    globalThis.__sent = [];
    globalThis.__deliver = (message) => { for (const fn of listeners) fn(message, {}, () => {}); };
    // The tool's own switch, which the content script reads before it draws
    // anything. Flipped from the harness to check the off state costs the page
    // nothing.
    const states = { 'task-namer': { enabled: true, settings: { 'selection-popup': 'on' } } };
    globalThis.__setEnabled = (on) => {
      states['task-namer'].enabled = on;
      const value = JSON.parse(JSON.stringify(states));
      for (const fn of storageListeners) fn({ 'fz.tools.v1': { newValue: value } }, 'sync');
    };
    globalThis.__setSelectionPopup = (on) => {
      states['task-namer'].settings['selection-popup'] = on ? 'on' : 'off';
      const value = JSON.parse(JSON.stringify(states));
      for (const fn of storageListeners) fn({ 'fz.tools.v1': { newValue: value } }, 'sync');
    };
    const storageListeners = [];
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => listeners.push(fn) },
        sendMessage: (message) => { globalThis.__sent.push(message); return Promise.resolve(); },
      },
      storage: {
        sync: { get: () => Promise.resolve({ 'fz.tools.v1': states }) },
        onChanged: { addListener: (fn) => storageListeners.push(fn) },
      },
    };
  })();
`

/*
 * A host page that fights the card: its own font stack, uppercase buttons, a
 * loud background and a stacking context with a high z-index of its own.
 */
const HOST_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Host page</title>
    <style>
      * { font-family: "Comic Sans MS", cursive; box-sizing: content-box; }
      button { text-transform: uppercase; letter-spacing: 3px; font-size: 22px; }
      html { font-size: 20px; }
      body {
        margin: 0; min-height: 100vh; padding: 48px;
        background:
          radial-gradient(1200px 600px at 12% 8%, #ff8a3d 0%, transparent 60%),
          radial-gradient(900px 700px at 88% 22%, #2563eb 0%, transparent 62%),
          linear-gradient(160deg, #0f172a 0%, #3b0764 55%, #831843 100%);
        color: #fff;
      }
      .overlay { position: fixed; inset: auto 0 0 0; height: 90px; z-index: 999999; background: rgba(0,0,0,.35); }
      p { max-width: 46ch; line-height: 1.7; }
      /* Stands in for a spreadsheet's cell editor: a plain contenteditable. */
      #cell { max-width: 46ch; padding: 8px 10px; background: #fff; color: #111; }
    </style>
  </head>
  <body>
    <h1>Sprint planning notes</h1>
    <p id="selection">Cần sửa lỗi đăng nhập bị treo khi token hết hạn trên trang thanh toán</p>
    <div id="cell" contenteditable="true">Cần sửa lỗi đăng nhập bị treo khi token hết hạn trên trang thanh toán</div>
    <div class="overlay"></div>
  </body>
</html>`

async function screenshot(page: Cdp, name: string) {
  const shot = await page.send('Page.captureScreenshot', { format: 'png' })
  if (shot?.data) await writeFile(`${OUT_DIR}/${name}.png`, Buffer.from(shot.data, 'base64'))
}

const SOURCE = 'Cần sửa lỗi đăng nhập bị treo khi token hết hạn trên trang thanh toán'
const TASK_NAME = 'Fix login hanging when the token expires on the checkout page'

/** What a drag that stopped one phrase short leaves out, typed back in. */
const EXTRA = ' của app mobile'
const EDITED = SOURCE + EXTRA

/** Select the host page's paragraph, the way a drag across it would. */
async function selectParagraph(page: Cdp) {
  await page.evaluate(
    `(() => {
       const node = document.getElementById('selection');
       const range = document.createRange();
       range.selectNodeContents(node);
       getSelection().removeAllRanges();
       getSelection().addRange(range);
       document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
     })()`
  )
  // The content script defers its read by a tick so it sees the settled selection.
  await sleep(120)
}

/**
 * A real press at the element's centre.
 *
 * Not `element.click()`: a programmatic click never moves focus, so it sails
 * past the entire class of bug these buttons guard against — a press that
 * blurs the page and collapses the selection being worked on.
 */
async function pressButton(page: Cdp, selector: string) {
  const spot = await page.evaluate<{ x: number; y: number }>(
    `(() => {
       const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
       return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
     })()`
  )
  for (const type of ['mousePressed', 'mouseReleased'] as const) {
    await page.send('Input.dispatchMouseEvent', {
      type,
      x: spot.x,
      y: spot.y,
      button: 'left',
      clickCount: 1,
    })
  }
}

/** The same press, on the action button that reads like this. */
async function pressLabelled(page: Cdp, label: string) {
  await page.evaluate(
    `(() => {
       const target = [...document.querySelectorAll('.fz-tn-btn')]
         .find(b => b.textContent === ${JSON.stringify(label)});
       target.id = 'fz-under-test';
     })()`
  )
  await pressButton(page, '#fz-under-test')
  // The press usually redraws the body out from under it; clean up if it didn't.
  await page.evaluate(`document.getElementById('fz-under-test')?.removeAttribute('id')`)
}

async function main(page: Cdp) {
  await page.send('Page.enable')
  await page.send('Runtime.enable')
  // A headless tab is never focused, and the Clipboard API refuses to read or
  // write in an unfocused document. This is what makes the Copy check possible.
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: RUNTIME_SHIM })
  await page.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/` })
  await sleep(700)

  // What chrome.scripting.insertCSS + executeScript do, in the same order.
  const css = await Bun.file(`${TOOLS_DIR}/task-namer.css`).text()
  await page.evaluate(
    `(() => {
       const style = document.createElement('style');
       style.textContent = ${JSON.stringify(css)};
       document.documentElement.append(style);
     })()`
  )
  await page.evaluate(await Bun.file(`${TOOLS_DIR}/task-namer.js`).text())

  const mounted = await page.evaluate<boolean>('window.__fzTaskNamerMounted === true')
  ok('the bundle mounts once', mounted)

  // Re-running the bundle is what re-injecting into an already-covered tab does.
  await page.evaluate(await Bun.file(`${TOOLS_DIR}/task-namer.js`).text())

  console.log('\nthe button over a selection')

  await page.evaluate('__setEnabled(false)')
  await sleep(100)
  await selectParagraph(page)
  const whenOff = await page.evaluate<number>(
    'document.querySelectorAll(".fz-tn-trigger").length'
  )
  ok('a tool switched off draws nothing over a selection', whenOff === 0, `${whenOff}`)

  await page.evaluate('__setEnabled(true); __setSelectionPopup(false)')
  await sleep(100)
  await selectParagraph(page)
  const popupDisabled = await page.evaluate<number>(
    'document.querySelectorAll(".fz-tn-trigger").length'
  )
  ok('a disabled selection popup draws nothing over highlighted text', popupDisabled === 0, `${popupDisabled}`)

  await page.evaluate('__setSelectionPopup(true)')
  await sleep(100)
  await selectParagraph(page)
  const appeared = await page.evaluate<number>(
    'document.querySelectorAll(".fz-tn-trigger").length'
  )
  ok('a selection gets a button', appeared === 1, `${appeared}`)

  // Page coordinates, not viewport: the button belongs to the text, so it has
  // to travel with it rather than hang in front of whatever scrolls past.
  const pinned = await page.evaluate<string>(
    `getComputedStyle(document.querySelector('.fz-tn-trigger')).position`
  )
  ok('and is placed in the page, not the viewport', pinned === 'absolute', pinned)

  /*
   * Below the end of the selection and clear of it. The host page's paragraph
   * wraps, which is the case that matters: a button placed above the *last*
   * line of a wrapped selection sits on top of the line before it.
   */
  const near = await page.evaluate<string>(
    `(() => {
       const btn = document.querySelector('.fz-tn-trigger').getBoundingClientRect();
       const text = document.getElementById('selection').getBoundingClientRect();
       // Where the words stop on the final line — NOT the paragraph's right
       // edge, which is the width of its longest line and nowhere near the end
       // of a selection that wrapped.
       const lines = getSelection().getRangeAt(0).getClientRects();
       const end = lines[lines.length - 1];
       const clear = btn.top >= text.bottom - 2 && btn.top - text.bottom < 24;
       const nearEnd = Math.abs((btn.left + btn.right) / 2 - end.right) < 4;
       return (clear ? 'clear' : 'covering') + ',' + (nearEnd ? 'at the end' : 'adrift');
     })()`
  )
  ok(
    'and sits just past the end of the text, clear of it',
    near === 'clear,at the end',
    near
  )

  await screenshot(page, 'task-name-1-trigger')

  // A press, not a click: the guard being checked is that pressing the button
  // does not take focus and collapse the selection it is about to send.
  await pressButton(page, '.fz-tn-trigger')
  await sleep(200)

  const asked = await page.evaluate<string>('JSON.stringify(__sent.at(-1))')
  ok(
    'pressing it asks the worker to rewrite the selection',
    asked === JSON.stringify({ type: 'fz:task-name-request', source: SOURCE }),
    asked
  )

  const stillSelected = await page.evaluate<string>('getSelection().toString().trim()')
  ok('and the selection survives the press', stillSelected === SOURCE, stillSelected)

  const dismissed = await page.evaluate<number>(
    'document.querySelectorAll(".fz-tn-trigger").length'
  )
  ok('the button steps out of the way', dismissed === 0, `${dismissed}`)

  console.log('\nloading')

  await page.evaluate(
    `__deliver({ type: 'fz:task-name-loading', source: ${JSON.stringify(SOURCE)} })`
  )
  await sleep(250)

  const cards = await page.evaluate<number>('document.querySelectorAll(".fz-tn-card").length')
  ok('one card, however many times the bundle ran', cards === 1, `${cards} card(s)`)

  const spinner = await page.evaluate<boolean>('!!document.querySelector(".fz-tn-spinner")')
  ok('the wait is visible', spinner)

  // What was picked up, shown while the answer is still being written — the
  // point being that a selection which grabbed the wrong range is visible
  // immediately rather than inferred later from an odd title.
  const waitingSource = await page.evaluate<string>(
    'document.querySelector(".fz-tn-source")?.textContent ?? ""'
  )
  ok('the raw selection is shown during the wait', waitingSource === SOURCE, waitingSource)

  // The host page sets Comic Sans on *, uppercase on every button, and a 20px
  // root. All three have to stop at the card's edge.
  const typography = await page.evaluate<string>(
    `(() => {
       const card = getComputedStyle(document.querySelector('.fz-tn-card'));
       return card.fontFamily.split(',')[0].replace(/"/g, '') + ' / ' + card.fontSize;
     })()`
  )
  ok(
    "the host page's font does not leak in",
    typography.startsWith('-apple-system') && typography.endsWith('13px'),
    typography
  )

  // The close mark is an SVG rather than a `×` for exactly this reason: a glyph
  // sits on the math axis, above the middle of its line box, by an amount the
  // host page's font decides. Geometry does not drift.
  const centred = await page.evaluate<string>(
    `(() => {
       const btn = document.querySelector('.fz-tn-close').getBoundingClientRect();
       const mark = document.querySelector('.fz-tn-close-mark').getBoundingClientRect();
       const dx = (mark.left + mark.width / 2) - (btn.left + btn.width / 2);
       const dy = (mark.top + mark.height / 2) - (btn.top + btn.height / 2);
       return dx.toFixed(2) + ',' + dy.toFixed(2);
     })()`
  )
  ok('the close mark is centred in its button', centred === '0.00,0.00', centred)

  await screenshot(page, 'task-name-1-loading')

  console.log('\nresult')

  await page.evaluate(
    `__deliver({ type: 'fz:task-name-result', source: ${JSON.stringify(SOURCE)}, taskName: ${JSON.stringify(TASK_NAME)} })`
  )
  await sleep(250)

  const shown = await page.evaluate<string>(
    'document.querySelector(".fz-tn-result")?.textContent ?? ""'
  )
  ok('the title is the thing on screen', shown === TASK_NAME, shown)

  const both = await page.evaluate<string>(
    `[document.querySelector('.fz-tn-source')?.textContent,
      document.querySelector('.fz-tn-result')?.textContent].join(' → ')`
  )
  ok('and the raw text stays beside it', both === `${SOURCE} → ${TASK_NAME}`, both)

  // The popover points at the text, and the arrow points at the text even after
  // the card itself has been shoved sideways to stay on screen.
  const pointing = await page.evaluate<string>(
    `(() => {
       const card = document.querySelector('.fz-tn-card');
       const box = card.getBoundingClientRect();
       const text = document.getElementById('selection').getBoundingClientRect();
       const arrow = card.querySelector('.fz-tn-arrow').getBoundingClientRect();
       const place = card.dataset.place;
       const touching = place === 'below'
         ? box.top >= text.bottom && box.top - text.bottom < 24
         : box.bottom <= text.top && text.top - box.bottom < 24;
       const centre = (arrow.left + arrow.right) / 2;
       const onText = centre > text.left - 2 && centre < text.right + 2;
       return place + ',' + (touching ? 'touching' : 'adrift') +
              ',' + (onText ? 'aimed' : 'off-target');
     })()`
  )
  ok('the popover points at the selection', pointing === 'below,touching,aimed', pointing)

  const offered = await page.evaluate<string>(
    `[...document.querySelectorAll('.fz-tn-btn')].map(b => b.textContent).join(',')`
  )
  ok(
    'a page that cannot be written to offers no Replace',
    offered === 'Copy,Try again',
    offered
  )

  const buttonCase = await page.evaluate<string>(
    `getComputedStyle(document.querySelector('.fz-tn-primary')).textTransform`
  )
  ok("the host page's uppercase buttons do not leak in", buttonCase === 'none', buttonCase)

  const onePlace = await page.evaluate<number>('document.querySelectorAll(".fz-tn-card").length')
  ok('the card is reused, not stacked', onePlace === 1, `${onePlace} card(s)`)

  await screenshot(page, 'task-name-2-result')

  console.log('\nactions')

  await page.send('Browser.grantPermissions', {
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    origin: `http://127.0.0.1:${HTTP_PORT}`,
  })
  await page.evaluate(`document.querySelector('.fz-tn-primary').click()`)
  await sleep(350)

  const copied = await page.evaluate<string>('navigator.clipboard.readText()')
  ok('Copy puts the title on the clipboard', copied === TASK_NAME, copied)

  const flashed = await page.evaluate<string>(
    `document.querySelector('.fz-tn-primary').textContent`
  )
  ok('and says so without moving anything', flashed === 'Copied', flashed)

  await page.evaluate(
    `[...document.querySelectorAll('.fz-tn-ghost')].find(b => b.textContent === 'Try again').click()`
  )
  await sleep(200)

  const retry = await page.evaluate<string>('JSON.stringify(__sent.at(-1))')
  ok(
    'Try again asks the worker again, with the same text',
    retry === JSON.stringify({ type: 'fz:task-name-request', source: SOURCE }),
    retry
  )

  console.log('\nediting what was asked')

  await page.evaluate(
    `__deliver({ type: 'fz:task-name-result', source: ${JSON.stringify(SOURCE)}, taskName: ${JSON.stringify(TASK_NAME)} })`
  )
  await sleep(200)

  /*
   * A selection in the stand-in cell editor: the thing Replace writes over, and
   * the thing the card gives up when it takes the caret. Losing it here is the
   * whole risk of putting a text box in this card, so it is set before the
   * editor opens and read again after it closes.
   */
  await page.evaluate(
    `(() => {
       const cell = document.getElementById('cell');
       cell.focus();
       const range = document.createRange();
       range.selectNodeContents(cell);
       getSelection().removeAllRanges();
       getSelection().addRange(range);
     })()`
  )

  await pressButton(page, '.fz-tn-edit')
  await sleep(200)

  const drafted = await page.evaluate<string>(
    'document.querySelector(".fz-tn-input")?.value ?? ""'
  )
  ok('Edit opens the text that was sent', drafted === SOURCE, drafted)

  // Every other press in the card is swallowed to protect the page's selection.
  // The box has to be the one exception or there is nothing to type into.
  const caret = await page.evaluate<boolean>(
    'document.activeElement === document.querySelector(".fz-tn-input")'
  )
  ok('and the box takes the caret', caret)

  // Real typing, at whatever the caret is: this is also the check that the
  // caret was left at the end rather than in front of everything.
  await page.send('Input.insertText', { text: EXTRA })
  await sleep(150)

  const typed = await page.evaluate<string>('document.querySelector(".fz-tn-input").value')
  ok('typing carries on from the end of it', typed === EDITED, typed)

  const grown = await page.evaluate<string>(
    `(() => {
       const box = document.querySelector('.fz-tn-input');
       return (box.scrollHeight <= box.clientHeight ? 'fits' : 'clipped')
         + ',' + (box.getBoundingClientRect().bottom
                  <= document.querySelector('.fz-tn-card').getBoundingClientRect().bottom
                  ? 'inside' : 'overflowing');
     })()`
  )
  ok('the box grows to hold what is in it', grown === 'fits,inside', grown)

  await screenshot(page, 'task-name-6-edit')

  await pressLabelled(page, 'Regenerate')
  await sleep(200)

  const reasked = await page.evaluate<string>('JSON.stringify(__sent.at(-1))')
  ok(
    'Regenerate asks the worker about the corrected text',
    reasked === JSON.stringify({ type: 'fz:task-name-request', source: EDITED }),
    reasked
  )

  const waiting = await page.evaluate<string>(
    `(document.querySelector('.fz-tn-spinner') ? 'waiting' : 'idle') + ',' +
     (document.querySelector('.fz-tn-source')?.textContent ?? '')`
  )
  ok('and the card waits on the new text, not the old', waiting === `waiting,${EDITED}`, waiting)

  const handedBack = await page.evaluate<string>('getSelection().toString().trim()')
  ok(
    "and the page has its selection back, so Replace still has a target",
    handedBack === SOURCE,
    handedBack
  )

  await page.evaluate(
    `__deliver({ type: 'fz:task-name-result', source: ${JSON.stringify(EDITED)}, taskName: ${JSON.stringify(TASK_NAME)} })`
  )
  await sleep(200)
  await pressButton(page, '.fz-tn-edit')
  await sleep(150)
  await page.evaluate(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`
  )
  await sleep(200)

  const backedOut = await page.evaluate<string>(
    `[document.querySelectorAll('.fz-tn-card').length,
      document.querySelector('.fz-tn-input') ? 'editing' : 'closed',
      document.querySelector('.fz-tn-result')?.textContent ?? ''].join(',')`
  )
  ok(
    'Escape leaves the editor before it closes the card',
    backedOut === `1,closed,${TASK_NAME}`,
    backedOut
  )

  await pressButton(page, '.fz-tn-edit')
  await sleep(150)

  const emptied = await page.evaluate<string>(
    `(() => {
       const box = document.querySelector('.fz-tn-input');
       box.value = '   ';
       box.dispatchEvent(new Event('input', { bubbles: true }));
       const go = [...document.querySelectorAll('.fz-tn-btn')]
         .find(b => b.textContent === 'Regenerate');
       const before = __sent.length;
       go.click();
       return (go.disabled ? 'off' : 'on') + ',' +
              (__sent.length === before ? 'silent' : 'sent');
     })()`
  )
  ok('a box with nothing in it sends nothing', emptied === 'off,silent', emptied)

  console.log('\nreplace')

  /*
   * The worker decides this from Chrome's own pageUrl and sends the answer; the
   * card never looks at its own location. So this is the whole difference
   * between a spreadsheet and any other page, and it is one boolean.
   */
  await page.evaluate(
    `__deliver({
       type: 'fz:task-name-result',
       source: ${JSON.stringify(SOURCE)},
       taskName: ${JSON.stringify(TASK_NAME)},
       canReplace: true,
     })`
  )
  await sleep(250)

  const withReplace = await page.evaluate<string>(
    `[...document.querySelectorAll('.fz-tn-btn')].map(b => b.textContent).join(',')`
  )
  ok(
    'a spreadsheet gets Replace, and Copy steps back',
    withReplace === 'Replace,Copy,Try again',
    withReplace
  )

  const emphasis = await page.evaluate<string>(
    `[...document.querySelectorAll('.fz-tn-btn')]
       .map(b => b.className.includes('fz-tn-primary') ? 'primary' : 'ghost').join(',')`
  )
  ok('Replace is the one being offered', emphasis === 'primary,ghost,ghost', emphasis)

  // Put a selection in the stand-in cell editor, exactly as a user would have
  // before right-clicking.
  await page.evaluate(
    `(() => {
       const cell = document.getElementById('cell');
       cell.focus();
       const range = document.createRange();
       range.selectNodeContents(cell);
       getSelection().removeAllRanges();
       getSelection().addRange(range);
     })()`
  )

  // A real press, for the reason given on pressButton: the card blurring the
  // cell editor is exactly the failure being guarded against.
  await page.evaluate(
    `(() => {
       const target = [...document.querySelectorAll('.fz-tn-btn')]
         .find(b => b.textContent === 'Replace');
       target.id = 'fz-replace-under-test';
     })()`
  )
  await pressButton(page, '#fz-replace-under-test')
  await sleep(250)

  const cellText = await page.evaluate<string>('document.getElementById("cell").textContent')
  ok('Replace writes the title over the selection', cellText === TASK_NAME, cellText)

  const said = await page.evaluate<string>(
    `[...document.querySelectorAll('.fz-tn-btn')].map(b => b.textContent).join(',')`
  )
  ok('and says so', said.startsWith('Replaced,'), said)

  await screenshot(page, 'task-name-5-replace')

  console.log('\nerror')

  await page.evaluate(
    `__deliver({
       type: 'fz:task-name-error',
       source: ${JSON.stringify(SOURCE)},
       message: 'Add your OpenRouter API key in Settings, then try again.',
       openSettings: true,
     })`
  )
  await sleep(250)

  const message = await page.evaluate<string>(
    'document.querySelector(".fz-tn-error")?.textContent ?? ""'
  )
  ok('the failure is stated in the card', message.startsWith('Add your OpenRouter API key'), message)

  await screenshot(page, 'task-name-3-error')

  await page.evaluate(
    `[...document.querySelectorAll('.fz-tn-btn')].find(b => b.textContent === 'Open settings').click()`
  )
  await sleep(200)

  const opened = await page.evaluate<string>('JSON.stringify(__sent.at(-1))')
  ok(
    'a missing key offers the page that fixes it',
    opened === JSON.stringify({ type: 'fz:open-options' }),
    opened
  )

  const goneAfterSettings = await page.evaluate<number>(
    'document.querySelectorAll(".fz-tn-card").length'
  )
  ok('and closes on the way there', goneAfterSettings === 0, `${goneAfterSettings} card(s)`)

  console.log('\ndismissal')

  await page.evaluate(
    `__deliver({ type: 'fz:task-name-result', source: ${JSON.stringify(SOURCE)}, taskName: ${JSON.stringify(TASK_NAME)} })`
  )
  await sleep(200)
  await page.evaluate(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`
  )
  await sleep(200)

  const gone = await page.evaluate<number>('document.querySelectorAll(".fz-tn-card").length')
  ok('Escape closes the card', gone === 0, `${gone} card(s)`)

  // Dark is the only theme this card has — it reads the system, not the
  // extension's appearance setting. See the note in overlay.css.
  await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'dark' }],
  })
  await page.evaluate(
    `__deliver({ type: 'fz:task-name-result', source: ${JSON.stringify(SOURCE)}, taskName: ${JSON.stringify(TASK_NAME)} })`
  )
  await sleep(300)
  await screenshot(page, 'task-name-4-result-dark')
}

// --- run -------------------------------------------------------------------

await mkdir(OUT_DIR, { recursive: true })

const server = Bun.serve({
  port: HTTP_PORT,
  fetch: () => new Response(HOST_PAGE, { headers: { 'content-type': 'text/html' } }),
})

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--window-size=1100,760',
  'about:blank',
])
chrome.on('error', (err) => {
  console.error(err)
  process.exit(1)
})

try {
  await main(await Cdp.attach(await waitForDevtools()))
  console.log(
    failures === 0
      ? `\nAll checks passed. Screenshots in .preview/`
      : `\n${failures} check(s) failed. Screenshots in .preview/`
  )
} finally {
  chrome.kill()
  server.stop(true)
}

process.exit(failures === 0 ? 0 : 1)
