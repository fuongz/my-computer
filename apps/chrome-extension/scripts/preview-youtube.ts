/*
 * Drives the built YouTube Cinema tool over real youtube.com watch pages, so
 * the thing that matters — the player is the viewport, and both ways out of it
 * work — can be checked without clicking through Chrome by hand.
 *
 *   bun run build && bun run preview:youtube      # screenshots to .preview/
 *
 * WHAT THIS DOES AND DOESN'T PROVE
 *
 * Chrome 137 disabled the --load-extension switch and 150 removed the escape
 * hatch, so a headless Chrome can no longer load an unpacked extension. This
 * runs the real thing anyway: the built stylesheet and the built bundle out of
 * extension/dist, against a chrome.storage.sync stand-in the harness can flip
 * the tool's switch in. Nothing here reimplements the tool — every attribute,
 * every button and every keystroke below is the shipped content script's own.
 *
 * So it *does* verify: the storage gate (the tool draws nothing until its switch
 * says so, and undraws when it goes off), the player ending up exactly the size
 * of the viewport over YouTube's own markup, the masthead and everything below
 * the video being gone, the video letterboxing rather than stretching, the
 * way home appearing over the video's top left, fading with the player's own
 * controls, leaving with cinema and — under a real mouse press — actually
 * reaching youtube.com; Shift+F and Escape both toggling from the keyboard;
 * either of the two settings being off doing what it says; and YouTube's own
 * layout coming back intact each time. It also verifies the viewer count in
 * the top right: absent on a page with no live data, appearing the moment
 * YouTube's own "watching" wording exists, following it when that wording
 * changes, never duplicated, and gone the moment the wording is — whether
 * that is a stream ending or cinema itself going off.
 *
 * Neither watch page below is actually live, and a real live URL cannot be
 * pinned to a fixed test the way "Me at the zoo" can — a stream ends on its
 * own schedule, not this script's. So the viewer count checks synthesize
 * exactly the DOM shape content.ts's selector looks for, inside the real
 * ytd-watch-metadata these pages do have, rather than depend on one of
 * YouTube's livestreams staying live for the run.
 *
 * It does *not* verify: manifest parsing, and the two things a headless tab
 * cannot have — real fullscreen, which the tool stands down for, and a
 * client-side route change from a related video. Those need Load unpacked and a
 * human, as does the popup switch itself (bun run preview:popup covers the
 * dashboard's half).
 *
 * The bundle is injected once the player exists rather than at document_start,
 * because CDP runs new-document scripts earlier than Chrome runs a content
 * script — early enough that document.documentElement can be null, which the
 * real thing never sees. So this says nothing about the first frame; what it
 * checks is every frame after it.
 */

import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9335
const PROFILE = '/tmp/youtube-cinema-preview-profile'
const TOOLS_DIR = new URL('../extension/dist/tools', import.meta.url).pathname
const OUT_DIR = new URL('../.preview', import.meta.url).pathname
const ATTRIBUTE = 'data-fz-youtube-cinema'
const BACK = '.fz-cinema-back'
const VIEWERS = '.fz-cinema-viewers'

/*
 * The window, not the viewport: headless Chrome keeps a few pixels for itself,
 * so what 100vh resolves to is asked of the page rather than assumed here.
 */
const WINDOW = { width: 1400, height: 900 }

const PAGES = [
  // 4:3, and 19 seconds long: the letterboxing check needs a video whose shape
  // is not the window's, and this one has been at the same URL since 2005. The
  // full run — button, hotkey, switch — happens here.
  { name: 'watch-4x3', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', full: true },
  // 16:9, so the frame should reach both edges with no bars at all.
  { name: 'watch-16x9', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', full: false },
]

/*
 * chrome.storage.sync, reduced to what storage.ts touches: one key, one
 * onChanged listener list, and a way for the harness to flip the switch the way
 * the popup would. Everything else the tool needs is the page's own.
 */
const STORAGE_SHIM = `
  (() => {
    const KEY = 'fz.tools.v1';
    const states = { 'youtube-cinema': { enabled: true, settings: { 'auto-cinema': 'on', hotkey: 'on' } } };
    const listeners = [];
    const announce = () => {
      const value = JSON.parse(JSON.stringify(states));
      for (const fn of listeners) fn({ [KEY]: { newValue: value } }, 'sync');
    };
    globalThis.__setEnabled = (on) => { states['youtube-cinema'].enabled = on; announce(); };
    globalThis.__setAuto = (on) => { states['youtube-cinema'].settings['auto-cinema'] = on ? 'on' : 'off'; announce(); };
    globalThis.__setHotkey = (on) => { states['youtube-cinema'].settings.hotkey = on ? 'on' : 'off'; announce(); };
    globalThis.chrome = {
      storage: {
        sync: {
          get: () => Promise.resolve({ [KEY]: states }),
          set: () => Promise.resolve(),
        },
        onChanged: { addListener: (fn) => listeners.push(fn) },
      },
    };
  })();
`

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
    return result?.result?.value as T
  }
}

// --- helpers ---------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitForDevtools(): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      const body = (await res.json()) as { webSocketDebuggerUrl?: string }
      if (body.webSocketDebuggerUrl) return body.webSocketDebuggerUrl
    } catch {
      // Chrome is still starting up.
    }
    await sleep(200)
  }
  throw new Error('Chrome never opened its devtools endpoint')
}

/** Polls a page expression until it is true, or gives up and says so. */
async function until(page: Cdp, expression: string, tries = 40): Promise<boolean> {
  for (let attempt = 0; attempt < tries; attempt++) {
    if (await page.evaluate<boolean>(expression)) return true
    await sleep(250)
  }
  return false
}

const inCinema = `document.documentElement.getAttribute(${JSON.stringify(ATTRIBUTE)}) === 'on'`
const notInCinema = `!document.documentElement.hasAttribute(${JSON.stringify(ATTRIBUTE)})`

type Box = { x: number; y: number; width: number; height: number }
type Viewport = { width: number; height: number }

const rectOf = (selector: string) => `
  (() => {
    const el = document.querySelector(${JSON.stringify('SELECTOR')});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()
`.replace(JSON.stringify('SELECTOR'), JSON.stringify(selector))

/** Within a pixel: a 1399.5-wide box still fills a 1400-wide viewport. */
function fillsViewport(box: Box | null, viewport: Viewport): boolean {
  if (!box) return false
  return (
    Math.abs(box.x) <= 1 &&
    Math.abs(box.y) <= 1 &&
    Math.abs(box.width - viewport.width) <= 1 &&
    Math.abs(box.height - viewport.height) <= 1
  )
}

const describe = (box: Box | null) =>
  box
    ? `${Math.round(box.width)}x${Math.round(box.height)} at ${Math.round(box.x)},${Math.round(box.y)}`
    : 'missing'

/**
 * Synthesizes exactly the DOM shape content.ts's selector looks for — a
 * `.view-count` inside the page's real `#below`, the video's own info column,
 * whose text says "watching" — so the viewer count checks below exercise the
 * shipped selector against neither page actually being live. Passing `null`
 * removes it, standing in for a stream ending or the page never having had
 * one.
 */
const setLiveViewerCount = (text: string | null) => `
  (() => {
    const info = document.querySelector('ytd-watch-flexy #below');
    if (!info) return false;
    let renderer = info.querySelector('.fz-preview-view-count');
    if (${JSON.stringify(text)} === null) {
      renderer?.remove();
      return true;
    }
    if (!renderer) {
      // Built with createElement rather than innerHTML: YouTube's own CSP
      // enforces Trusted Types, which throws on a plain-string innerHTML
      // assignment.
      renderer = document.createElement('div');
      renderer.className = 'fz-preview-view-count';
      const span = document.createElement('span');
      span.className = 'view-count';
      renderer.appendChild(span);
      info.appendChild(renderer);
    }
    renderer.querySelector('.view-count').textContent = ${JSON.stringify(text)};
    return true;
  })()
`

/**
 * A real press on the way home, not element.click(): it sits on top of the video,
 * which treats a click as play/pause, and it fades out when the pointer is idle.
 * Moving the mouse first is what a viewer reaching for it does, and it is the
 * only way to know the press lands rather than being swallowed.
 */
async function pressBack(page: Cdp, viewport: Viewport): Promise<boolean> {
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: Math.round(viewport.width / 2),
    y: Math.round(viewport.height / 2),
  })
  await sleep(400)

  const box = await page.evaluate<Box | null>(rectOf(BACK))
  if (!box || box.width === 0) return false

  const x = Math.round(box.x + box.width / 2)
  const y = Math.round(box.y + box.height / 2)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await sleep(150)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
  }
  await sleep(600)
  return true
}

/** A keystroke, as the keyboard sends it — and as a user gesture. */
async function pressKey(page: Cdp, key: string, code: string, modifiers = 0): Promise<void> {
  const virtualKeyCode = key.toUpperCase().charCodeAt(0)
  for (const type of ['keyDown', 'keyUp']) {
    await page.send('Input.dispatchKeyEvent', {
      type,
      key,
      code,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
      modifiers,
    })
  }
  await sleep(800)
}

const pressShiftF = (page: Cdp) => pressKey(page, 'F', 'KeyF', 8)
/** YouTube's own fullscreen key, which the tool has to get out of the way of. */
const pressF = (page: Cdp) => pressKey(page, 'f', 'KeyF')

async function shoot(page: Cdp, name: string): Promise<void> {
  const shot = await page.send('Page.captureScreenshot', { format: 'png' })
  if (shot?.data) await writeFile(`${OUT_DIR}/${name}.png`, Buffer.from(shot.data, 'base64'))
}

// --- the run ---------------------------------------------------------------

async function main(browser: Cdp, css: string, bundle: string) {
  // What the manifest's declared CSS does; the bundle below is the other half.
  const cssShim = `
    (() => {
      const apply = () => {
        const root = document.documentElement;
        if (!root) return false;
        if (document.getElementById('__youtube-cinema-preview')) return true;
        const style = document.createElement('style');
        style.id = '__youtube-cinema-preview';
        style.textContent = ${JSON.stringify(css)};
        (document.head || root).appendChild(style);
        return true;
      };
      if (!apply()) {
        const observer = new MutationObserver(() => { if (apply()) observer.disconnect(); });
        observer.observe(document, { childList: true, subtree: true });
      }
    })();
  `

  for (const target of PAGES) {
    console.log(`\n${target.name} — ${target.url}`)

    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
    const page = await Cdp.attach(`ws://127.0.0.1:${PORT}/devtools/page/${targetId}`)
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: STORAGE_SHIM })
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: cssShim })
    await page.send('Page.navigate', { url: target.url })

    const built = await until(page, '!!document.querySelector("ytd-watch-flexy #movie_player video")')
    if (!built) {
      // Say what the page actually is instead of just that it isn't a player:
      // a consent wall, a sign-in redirect and a boot that died all look the
      // same from a failed selector.
      const where = await page.evaluate<string>(
        '(() => location.href + " | " + document.title + " | flexy:" + !!document.querySelector("ytd-watch-flexy") + " | " + (document.body ? document.body.innerText.slice(0, 120).replace(/\\s+/g, " ") : "no body"))()'
      )
      ok('the player is up', false, where)
      await shoot(page, `${target.name}-no-player`)
      await browser.send('Target.closeTarget', { targetId })
      continue
    }
    ok('the player is up', true)

    // Before the bundle: the page is YouTube's, and nothing of ours is on it.
    const cleanBefore = await page.evaluate<boolean>(
      `${notInCinema} && !document.querySelector(${JSON.stringify(BACK)})`
    )
    ok('the stylesheet alone changes nothing', cleanBefore)

    await page.evaluate(bundle)
    const engaged = await until(page, inCinema)
    ok('the content script enters cinema once storage answers', engaged)

    const viewport = await page.evaluate<Viewport>(
      '({ width: window.innerWidth, height: window.innerHeight })'
    )

    const playerBox = await page.evaluate<Box | null>(rectOf('ytd-watch-flexy #movie_player'))
    ok(
      'player fills the viewport',
      fillsViewport(playerBox, viewport),
      `${describe(playerBox)} in ${viewport.width}x${viewport.height}`
    )

    const videoBox = await page.evaluate<Box | null>(rectOf('ytd-watch-flexy #movie_player video'))
    ok('video fills the player', fillsViewport(videoBox, viewport), describe(videoBox))

    /*
     * object-fit is what keeps a 4:3 video 4:3 in a 16:9 window. Without it the
     * forced 100%/100% box would stretch the picture, which is a worse failure
     * than the small player it replaced.
     */
    const objectFit = await page.evaluate<string>(
      '(() => { const v = document.querySelector("ytd-watch-flexy #movie_player video"); return v ? getComputedStyle(v).objectFit : "no video"; })()'
    )
    ok('video letterboxes rather than stretches', objectFit === 'contain', objectFit)

    const shown = await page.evaluate<string[]>(`
      (() => {
        const visible = [];
        for (const selector of ['#masthead-container', 'ytd-watch-flexy #below', 'ytd-watch-flexy #secondary', 'ytd-mini-guide-renderer']) {
          const el = document.querySelector(selector);
          if (el && el.getBoundingClientRect().height > 0) visible.push(selector);
        }
        return visible;
      })()
    `)
    ok('masthead and the page below the video are gone', shown.length === 0, shown.join(', '))

    const controls = await page.evaluate<Box | null>(rectOf('.ytp-chrome-bottom'))
    ok(
      'control bar spans the window',
      !!controls && Math.abs(controls.width - (viewport.width - 24)) <= 2,
      describe(controls)
    )

    const scrollable = await page.evaluate<boolean>(
      'document.documentElement.scrollHeight > window.innerHeight + 1'
    )
    ok('page does not scroll', !scrollable)

    await shoot(page, `${target.name}-cinema`)

    /*
     * Page two is the same profile and the same origin as page one, so the
     * localStorage mirror is already warm and the tool decides synchronously at
     * boot instead of waiting for chrome.storage — a different path through the
     * same file, and the one where a module-level declaration read too early
     * takes the whole script down with it. Cheap to assert, so assert it here.
     */
    const mounted = await page.evaluate<boolean>(
      `!!document.querySelector(${JSON.stringify(BACK)})`
    )
    ok(
      target.full ? 'the way home is drawn' : 'the way home survives a warm-start boot',
      mounted
    )

    console.log('\n  the livestream viewer count')

    const noOverlayYet = await page.evaluate<boolean>(
      `!document.querySelector(${JSON.stringify(VIEWERS)})`
    )
    ok('neither of these pages is live, so there is no overlay yet', noOverlayYet)

    const injected = await page.evaluate<boolean>(setLiveViewerCount('1,234 watching now'))
    ok('YouTube’s own live viewer markup can be synthesized', injected)

    const drawn = await until(page, `!!document.querySelector(${JSON.stringify(VIEWERS)})`)
    ok('the overlay appears once that markup exists', drawn)

    const shows = await page.evaluate<string>(
      `document.querySelector(${JSON.stringify(VIEWERS)})?.textContent.trim() ?? ''`
    )
    ok('and shows the exact text YouTube rendered', shows.includes('1,234 watching now'), shows)

    await shoot(page, `${target.name}-viewers`)

    await page.evaluate(setLiveViewerCount('5,678 watching now'))
    const updated = await until(
      page,
      `(document.querySelector(${JSON.stringify(VIEWERS)})?.textContent ?? '').includes('5,678')`
    )
    ok('and follows it when YouTube updates the count', updated)

    const overlayCount = await page.evaluate<number>(
      `document.querySelectorAll(${JSON.stringify(VIEWERS)}).length`
    )
    ok('without ever drawing a second one', overlayCount === 1, `${overlayCount} found`)

    await page.evaluate(setLiveViewerCount(null))
    const withdrawn = await until(page, `!document.querySelector(${JSON.stringify(VIEWERS)})`)
    ok('and it is gone once the live data is, same as a stream ending', withdrawn)

    if (!target.full) {
      // And that the boot got past sync() at all: a hotkey only answers if the
      // listeners after it were reached.
      await pressShiftF(page)
      ok('and so do the listeners registered after it', await page.evaluate<boolean>(notInCinema))
      await pressShiftF(page)
      ok('with cinema one keystroke away again', await page.evaluate<boolean>(inCinema))
    }

    if (target.full) {
      console.log('\n  the way home')

      /*
       * Cinema hides the masthead, and with it the only thing on the page that
       * goes home. This button belongs to cinema rather than to the tool: it is
       * there while the video fills the window and gone the moment it does not.
       */
      const placed = await page.evaluate<string>(`
        (() => {
          const b = document.querySelector(${JSON.stringify(BACK)});
          if (!b) return 'missing';
          if (!b.closest('ytd-watch-flexy #movie_player')) return 'not in the player';
          const r = b.getBoundingClientRect();
          if (r.x > 80 || r.y > 80) return 'not top left: ' + Math.round(r.x) + ',' + Math.round(r.y);
          if (r.width < 24 || r.height < 24) return 'drawn ' + Math.round(r.width) + 'x' + Math.round(r.height);
          return b.title;
        })()
      `)
      ok('sits over the video, top left', placed === 'Back to YouTube', placed)

      const fades = await page.evaluate<string>(`
        (() => {
          const player = document.querySelector('ytd-watch-flexy #movie_player');
          const b = document.querySelector(${JSON.stringify(BACK)});
          if (!player || !b) return 'missing';
          const shown = getComputedStyle(b).opacity;
          player.classList.add('ytp-autohide');
          const hidden = getComputedStyle(b).opacity;
          player.classList.remove('ytp-autohide');
          return shown + ' -> ' + hidden;
        })()
      `)
      ok('and fades with the player’s own controls', fades === '1 -> 0', fades)

      console.log('\n  leaving cinema')

      // Live data present this time, so leaving cinema — not the data going
      // away — is what the overlay's disappearance is being pinned on.
      await page.evaluate(setLiveViewerCount('9,000 watching now'))
      await until(page, `!!document.querySelector(${JSON.stringify(VIEWERS)})`)

      await pressShiftF(page)
      ok('Shift+F leaves cinema', await page.evaluate<boolean>(notInCinema))

      const restored = await page.evaluate<Box | null>(rectOf('ytd-watch-flexy #movie_player'))
      ok(
        'YouTube’s own layout comes back',
        !!restored && restored.height < viewport.height - 40,
        describe(restored)
      )

      const mastheadBack = await page.evaluate<number>(
        '(() => { const el = document.querySelector("#masthead-container"); return el ? el.getBoundingClientRect().height : 0; })()'
      )
      ok('masthead comes back', mastheadBack > 0, `${Math.round(mastheadBack)}px`)

      const backGone = await page.evaluate<boolean>(
        `!document.querySelector(${JSON.stringify(BACK)})`
      )
      ok('and the way home goes with it, the masthead being back', backGone)

      const viewersGone = await page.evaluate<boolean>(
        `!document.querySelector(${JSON.stringify(VIEWERS)})`
      )
      ok('and the viewer count goes with it too, live data or not', viewersGone)

      await shoot(page, `${target.name}-off`)

      await pressShiftF(page)
      ok('Shift+F returns to cinema', await page.evaluate<boolean>(inCinema))

      const viewersBack = await until(page, `!!document.querySelector(${JSON.stringify(VIEWERS)})`)
      ok('with the viewer count back too, the live data never having left', viewersBack)

      await page.evaluate(setLiveViewerCount(null))

      console.log('\n  the hotkey')

      await pressKey(page, 'Escape', 'Escape')
      ok('Escape leaves it too', await page.evaluate<boolean>(notInCinema))
      await pressShiftF(page)
      ok('and Shift+F is still the way back', await page.evaluate<boolean>(inCinema))

      console.log('\n  native fullscreen, which cinema gets out of the way of')

      /*
       * `f` is YouTube's, and has to stay YouTube's: the tool drops the
       * attribute for as long as the browser is really fullscreen, then puts it
       * back. A CDP key event is a user gesture, so this is the real path.
       */
      await pressF(page)
      const fullscreened = await page.evaluate<boolean>('!!document.fullscreenElement')
      ok('f still gives real fullscreen', fullscreened)
      if (fullscreened) {
        ok('cinema stands down for it', await page.evaluate<boolean>(notInCinema))
        const tucked = await page.evaluate<boolean>(
          `!document.querySelector(${JSON.stringify(BACK)})`
        )
        ok('and takes the way home with it — YouTube draws its own', tucked)
        await pressF(page)
        ok('leaving fullscreen returns to cinema', await page.evaluate<boolean>(inCinema))
      }

      console.log('\n  the two settings, and the button underneath them')

      /*
       * Two switches rather than one either/or: one says what a watch page does
       * on its own, the other whether the keyboard can change it. Each is
       * checked for doing exactly what it says and nothing more.
       */
      await page.evaluate('__setHotkey(false)')
      await sleep(600)
      await pressShiftF(page)
      /*
       * Not consumed means not consumed: with the setting off the keystroke goes
       * to YouTube, which reads an F as fullscreen whatever else is held down.
       * Either way the tool must not have toggled anything itself.
       */
      const afterKey = await page.evaluate<{ cinema: boolean; fullscreen: boolean }>(
        `({ cinema: ${inCinema}, fullscreen: !!document.fullscreenElement })`
      )
      ok(
        'with the hotkey off, Shift+F is not the tool’s to take',
        afterKey.cinema || afterKey.fullscreen,
        afterKey.fullscreen ? 'YouTube took it as fullscreen' : 'nothing moved'
      )
      if (afterKey.fullscreen) await pressF(page)
      ok('cinema is intact either way', await page.evaluate<boolean>(inCinema))
      await page.evaluate('__setHotkey(true)')
      await sleep(600)

      await page.evaluate('__setAuto(false)')
      await sleep(600)
      ok(
        'with Every video off, the page is left as YouTube drew it',
        await page.evaluate<boolean>(notInCinema)
      )
      await pressShiftF(page)
      ok('and Shift+F is still the way in', await page.evaluate<boolean>(inCinema))
      await page.evaluate('__setAuto(true)')
      await sleep(600)

      console.log('\n  the switch')

      await page.evaluate('__setEnabled(false)')
      await sleep(600)
      ok('switching the tool off leaves the page alone', await page.evaluate<boolean>(notInCinema))
      const drawnGone = await page.evaluate<boolean>(
        `!document.querySelector(${JSON.stringify(BACK)})`
      )
      ok('and takes what it drew with it', drawnGone)

      await page.evaluate('__setEnabled(true)')
      await sleep(600)
      ok('switching it back on returns to cinema', await page.evaluate<boolean>(inCinema))

      // Last, because it leaves the page: the way home under a real press.
      console.log('\n  going home')
      const reached = await pressBack(page, viewport)
      ok('the way home can be pressed', reached)
      const landed = await until(page, 'location.pathname === "/"', 20)
      ok('and lands on youtube.com', landed, await page.evaluate<string>('location.href'))
      ok(
        'with the page left as YouTube draws it',
        await page.evaluate<boolean>(notInCinema)
      )
    }

    await browser.send('Target.closeTarget', { targetId })
  }
}

// --- run -------------------------------------------------------------------

const cssFile = Bun.file(`${TOOLS_DIR}/youtube-cinema.css`)
const bundleFile = Bun.file(`${TOOLS_DIR}/youtube-cinema.js`)
if (!(await cssFile.exists()) || !(await bundleFile.exists())) {
  console.error('extension/dist/tools is missing the built tool — run `bun run build` first.')
  process.exit(1)
}

const css = await cssFile.text()
const bundle = await bundleFile.text()

await rm(PROFILE, { recursive: true, force: true })
await mkdir(OUT_DIR, { recursive: true })

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  // Let the video actually play — a running player is what the checks are
  // about — but never out of the speakers: this thing opens real watch pages,
  // and a headless Chrome plays their sound like any other tab.
  '--autoplay-policy=no-user-gesture-required',
  '--mute-audio',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  `--window-size=${WINDOW.width},${WINDOW.height}`,
  'about:blank',
])
chrome.on('error', (err) => {
  console.error(err)
  process.exit(1)
})

try {
  await main(await Cdp.attach(await waitForDevtools()), css, bundle)
  console.log(
    failures === 0
      ? `\nAll checks passed. Screenshots in .preview/`
      : `\n${failures} check(s) failed. Screenshots in .preview/`
  )
} finally {
  chrome.kill()
}

process.exit(failures === 0 ? 0 : 1)
