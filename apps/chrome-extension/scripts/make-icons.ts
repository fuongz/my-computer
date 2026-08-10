/*
 * Rasterizes assets/icon.svg into the extension's PNG icons.
 *
 *   bun run icons        # writes extension/assets/icons/icon-{16,48,128}.png
 *
 * WHY CHROME AND NOT A CONVERTER
 *
 * This replaced a stdlib-Python script that *drew* the old mark procedurally —
 * fine for one glyph on a rounded tile, hopeless for arbitrary artwork with
 * gradients and a clip path. The obvious fix is rsvg-convert or ImageMagick,
 * but both are homebrew installs that `bun run icons` would then silently
 * depend on.
 *
 * Chrome is already a hard requirement here: it is the target runtime, and the
 * three preview scripts all drive it over CDP. So the icons are rendered by the
 * same engine that will draw them in the toolbar, at each size from the vector
 * rather than downsampled from one raster — which is why the 16px comes out
 * crisp.
 *
 * TRANSPARENCY
 *
 * The artwork is a rounded square, so the corners must be transparent or the
 * toolbar gets a white-cornered box. A screenshot is opaque by default;
 * Emulation.setDefaultBackgroundColorOverride with alpha 0 is what makes the
 * capture carry an alpha channel.
 *
 * Every file is read back and sampled at the end — see verify() — because a
 * silently-opaque or wrong-sized icon looks fine in a file listing and wrong
 * in the browser.
 */

import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const CDP_PORT = 9339
const PROFILE = '/tmp/fuongz-icons-profile'
const SVG_PATH = new URL('../assets/icon.svg', import.meta.url).pathname
const OUT_DIR = new URL('../extension/assets/icons', import.meta.url).pathname

/** The three the manifest declares, in `icons` and in `action.default_icon`. */
const SIZES = [16, 48, 128] as const

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

async function waitForDevtools(): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      const body = (await res.json()) as { webSocketDebuggerUrl?: string }
      if (body.webSocketDebuggerUrl) return body.webSocketDebuggerUrl
    } catch {
      // Chrome is still starting up.
    }
    await sleep(200)
  }
  throw new Error('Chrome never opened its devtools endpoint')
}

// --- render ----------------------------------------------------------------

async function render(page: Cdp, svg: string, size: number): Promise<Buffer> {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: size,
    height: size,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await page.send('Emulation.setDefaultBackgroundColorOverride', {
    color: { r: 0, g: 0, b: 0, a: 0 },
  })

  /*
   * The source carries width="512" height="512"; those are overwritten so the
   * viewBox scales to the target instead of being cropped to the viewport.
   */
  await page.evaluate(`
    (() => {
      document.documentElement.style.cssText = 'margin:0;padding:0;background:transparent';
      document.body.style.cssText =
        'margin:0;padding:0;background:transparent;width:${size}px;height:${size}px;overflow:hidden';
      document.body.innerHTML = ${JSON.stringify(svg)};
      const node = document.querySelector('svg');
      node.setAttribute('width', '${size}');
      node.setAttribute('height', '${size}');
      node.style.cssText = 'display:block';
      return true;
    })()
  `)
  await sleep(120)

  const shot = await page.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  })
  if (!shot?.data) throw new Error(`capture failed at ${size}px`)
  return Buffer.from(shot.data, 'base64')
}

/**
 * Reads each written file back through Chrome's own PNG decoder and samples it.
 *
 * The corner check is the one that matters: a rounded-square icon whose
 * corners came out opaque is the exact failure this whole transparency dance
 * exists to prevent, and it is invisible until the icon is in a toolbar.
 */
async function verify(page: Cdp, size: number, png: Buffer): Promise<void> {
  const sample = await page.evaluate<Record<string, number>>(`
    (async () => {
      const image = new Image();
      image.src = 'data:image/png;base64,${png.toString('base64')}';
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const at = (x, y) => context.getImageData(x, y, 1, 1).data;
      const corner = at(0, 0);
      const middle = at(Math.floor(image.naturalWidth / 2), Math.floor(image.naturalHeight / 2));
      const edge = at(Math.floor(image.naturalWidth / 2), 1);
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        cornerAlpha: corner[3],
        middleAlpha: middle[3],
        middleR: middle[0], middleG: middle[1], middleB: middle[2],
        edgeR: edge[0], edgeG: edge[1], edgeB: edge[2],
      };
    })()
  `)

  ok(
    `${size}px is ${size}×${size}`,
    sample['width'] === size && sample['height'] === size,
    `${sample['width']}×${sample['height']}`,
  )
  ok(`${size}px has transparent corners`, sample['cornerAlpha'] === 0, `alpha ${sample['cornerAlpha']}`)
  ok(`${size}px is opaque in the middle`, Number(sample['middleAlpha']) > 250, `alpha ${sample['middleAlpha']}`)
  // The centre of the artwork is the blue face of the stack; the top edge is
  // the green tile. Both wrong means the SVG rendered blank or as a solid.
  ok(
    `${size}px centre is the blue face`,
    Number(sample['middleB']) > Number(sample['middleR']) + 40,
    `rgb(${sample['middleR']},${sample['middleG']},${sample['middleB']})`,
  )
  ok(
    `${size}px edge is the green tile`,
    Number(sample['edgeG']) > Number(sample['edgeB']) + 40,
    `rgb(${sample['edgeR']},${sample['edgeG']},${sample['edgeB']})`,
  )
}

// --- run -------------------------------------------------------------------

const svg = await readFile(SVG_PATH, 'utf8')
await mkdir(OUT_DIR, { recursive: true })

const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${PROFILE}`,
  'about:blank',
])
chrome.on('error', (err) => {
  console.error(err)
  process.exit(1)
})

try {
  const browser = await Cdp.attach(await waitForDevtools())
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
  const page = await Cdp.attach(`ws://127.0.0.1:${CDP_PORT}/devtools/page/${targetId}`)
  await page.send('Page.enable')
  await sleep(200)

  console.log('\nicons — from assets/icon.svg')
  for (const size of SIZES) {
    const png = await render(page, svg, size)
    const path = `${OUT_DIR}/icon-${size}.png`
    await writeFile(path, png)
    console.log(`  wrote icon-${size}.png (${png.length} bytes)`)
  }

  // Verification is a second pass so the files on disk are what gets sampled,
  // not the buffers that were just in memory.
  console.log('')
  await page.send('Emulation.clearDeviceMetricsOverride')
  for (const size of SIZES) {
    await verify(page, size, await readFile(`${OUT_DIR}/icon-${size}.png`))
  }

  console.log(failures === 0 ? '\nAll icons written and checked.' : `\n${failures} check(s) failed.`)
} finally {
  chrome.kill()
}

process.exit(failures === 0 ? 0 : 1)
