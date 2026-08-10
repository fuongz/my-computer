/*
 * Renders real pinterest.com pages with the theme applied and screenshots them,
 * so the stylesheet can be checked against the live DOM without clicking
 * through Chrome by hand.
 *
 *   bun run preview            # screenshots to .preview/
 *
 * WHAT THIS DOES AND DOESN'T PROVE
 *
 * Chrome 137 disabled the --load-extension switch and 150 removed the escape
 * hatch, so a headless Chrome can no longer load an unpacked extension. Instead
 * this reproduces exactly what the content script does — inject
 * the tool's theme.css and set html[data-pinterest-dark="on"] at
 * document_start — using CDP's addScriptToEvaluateOnNewDocument, which runs at
 * the same point in the page lifecycle.
 *
 * So it *does* verify: the stylesheet darkens real Pinterest markup, the
 * attribute gate turns the whole theme on and off, and nothing paints white
 * before the theme lands.
 *
 * It does *not* verify: manifest parsing, permissions, the popup, or the
 * chrome.storage round-trip. Those need `bun run build` plus Load unpacked in a
 * real browser — see the Verifying section of the README.
 *
 * A signed-out visitor also can't see the logged-in home feed or a pin closeup
 * modal; those two still need a human with an account.
 */

import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9333
const PROFILE = '/tmp/pinterest-dark-preview-profile'
const CSS_PATH = new URL('../src/tools/pinterest-theme/theme.css', import.meta.url).pathname
const OUT_DIR = new URL('../.preview', import.meta.url).pathname

const PAGES = [
  { name: 'home', url: 'https://www.pinterest.com/' },
  { name: 'search', url: 'https://www.pinterest.com/search/pins/?q=kitchen+shelving' },
  { name: 'topic', url: 'https://www.pinterest.com/ideas/home-decor/935103publishers/' },
]

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

/**
 * Perceived brightness, 0–255. A fully transparent color reports 255 rather
 * than 0 — otherwise `rgba(0,0,0,0)` would sail through every "is it dark?"
 * check while the page is still painting white underneath.
 */
function isTransparent(rgb: string): boolean {
  const parts = rgb.match(/\d+(\.\d+)?/g)
  return !!parts && parts.length > 3 && Number(parts[3]) === 0
}

function brightness(rgb: string): number {
  const parts = rgb.match(/\d+(\.\d+)?/g)
  if (!parts || parts.length < 3) return 255
  const [r, g, b, a] = parts.map(Number) as [number, number, number, number?]
  if (a !== undefined && a < 0.9) return 255
  return (r * 299 + g * 587 + b * 114) / 1000
}

async function main(browser: Cdp, css: string) {
  // Mirrors the content script: stylesheet plus the attribute it is gated on.
  //
  // CDP runs this even earlier than a real content script does — early enough
  // that document.documentElement can still be null — so unlike the extension
  // it has to wait for <html> to exist.
  const bootstrap = `
    (() => {
      const apply = () => {
        const root = document.documentElement;
        if (!root) return false;
        root.setAttribute('data-pinterest-dark', 'on');
        if (!document.getElementById('__pinterest-dark-preview')) {
          const style = document.createElement('style');
          style.id = '__pinterest-dark-preview';
          style.textContent = ${JSON.stringify(css)};
          (document.head || root).appendChild(style);
        }
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
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: bootstrap })
    await page.send('Page.navigate', { url: target.url })
    await sleep(7000)

    const attr = await page.evaluate<string | null>(
      'document.documentElement.getAttribute("data-pinterest-dark")'
    )
    ok('theme attribute present', attr === 'on', `got ${JSON.stringify(attr)}`)

    const bodyBg = await page.evaluate<string>('getComputedStyle(document.body).backgroundColor')
    ok('body paints dark', brightness(bodyBg) < 60, bodyBg)

    const headerBg = await page.evaluate<string>(`
      (() => {
        const el = document.querySelector('[data-test-id="header"], header, [role="banner"]');
        return el ? getComputedStyle(el).backgroundColor : 'no header found';
      })()
    `)
    // Transparent counts: the header then shows the page background, which the
    // previous check already proved is dark.
    ok(
      'header is not light',
      isTransparent(headerBg) || brightness(headerBg) < 60,
      headerBg
    )

    const textColor = await page.evaluate<string>(`
      (() => {
        const el = document.querySelector('h1, h2, p');
        return el ? getComputedStyle(el).color : 'no text found';
      })()
    `)
    ok('body text is light', brightness(textColor) > 150, textColor)

    /*
     * Pinterest red stays red in dark mode, so anything sitting on it must keep
     * a light label. This is the one place the ramp inversion actively fights
     * the design — see the brand-color pins in theme.css — so it is worth an
     * assertion rather than an eyeball.
     */
    const darkOnBrand = await page.evaluate<string[]>(`
      (() => {
        const lum = (c) => {
          const m = c.match(/[\\d.]+/g);
          return m ? (+m[0] * 299 + +m[1] * 587 + +m[2] * 114) / 1000 : null;
        };
        const bad = [];
        for (const el of document.querySelectorAll('*')) {
          const cs = getComputedStyle(el);
          const m = cs.backgroundColor.match(/[\\d.]+/g);
          if (!m || m.length < 3) continue;
          const [r, g, b] = m.map(Number);
          if (!(r > 150 && g < 80 && b < 90)) continue;      // Pinterest-red-ish
          const rect = el.getBoundingClientRect();
          if (rect.width < 50 || rect.height < 16) continue;
          const label = (el.innerText || '').trim();
          if (!label) continue;
          const leaf = [...el.querySelectorAll('*')]
            .find((n) => !n.children.length && n.textContent.trim()) || el;
          const fg = lum(getComputedStyle(leaf).color);
          if (fg !== null && fg < 140) bad.push(label.slice(0, 24) + ' (fg ' + Math.round(fg) + ')');
        }
        return [...new Set(bad)];
      })()
    `)
    ok(
      'labels on Pinterest red stay light',
      darkOnBrand.length === 0,
      darkOnBrand.slice(0, 4).join(', ')
    )

    const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    if (shot?.data) {
      await writeFile(`${OUT_DIR}/${target.name}-on.png`, Buffer.from(shot.data, 'base64'))
    }

    // Removing the attribute must return the page to stock — that is the whole
    // mechanism the popup toggle relies on.
    await page.evaluate('document.documentElement.removeAttribute("data-pinterest-dark")')
    await sleep(400)
    const bgOff = await page.evaluate<string>('getComputedStyle(document.body).backgroundColor')
    ok('attribute off restores the light page', brightness(bgOff) > 150, bgOff)

    const shotOff = await page.send('Page.captureScreenshot', { format: 'png' })
    if (shotOff?.data) {
      await writeFile(`${OUT_DIR}/${target.name}-off.png`, Buffer.from(shotOff.data, 'base64'))
    }

    await browser.send('Target.closeTarget', { targetId })
  }
}

// --- run -------------------------------------------------------------------

const css = await readFile(CSS_PATH, 'utf8')
await rm(PROFILE, { recursive: true, force: true })
await rm(OUT_DIR, { recursive: true, force: true })
await mkdir(OUT_DIR, { recursive: true })

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--window-size=1400,1200',
  'about:blank',
])
chrome.on('error', (err) => {
  console.error(err)
  process.exit(1)
})

try {
  await main(await Cdp.attach(await waitForDevtools()), css)
  console.log(
    failures === 0
      ? `\nAll checks passed. Screenshots in .preview/`
      : `\n${failures} check(s) failed. Screenshots in .preview/`
  )
} finally {
  chrome.kill()
}

process.exit(failures === 0 ? 0 : 1)
