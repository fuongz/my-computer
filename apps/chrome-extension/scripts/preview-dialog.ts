/*
 * Drives the "How was this made?" dialog through all five of its states in a
 * real Chrome and screenshots each one.
 *
 *   bun run build && bun run preview:dialog     # screenshots to .preview/
 *
 * WHY THIS EXISTS
 *
 * The dialog's whole premise is that it is ONE card that morphs, not five that
 * replace each other — and nothing in typecheck or the build can tell those
 * two apart. The load-bearing assertion here is `image survives every state`:
 * it stamps an expando on the <img> at the confirm step and checks the same
 * node is still on screen after the generated step. If a future edit goes back
 * to rebuilding the overlay per message, that check fails and the screenshots
 * show why.
 *
 * WHAT THIS DOES AND DOESN'T PROVE
 *
 * Chrome 137 disabled --load-extension, so as with the other two previews this
 * reproduces the extension rather than loading it: it serves a host page, then
 * injects the built stylesheet, a chrome.* stand-in, and the built content
 * bundle — the same three things the manifest would have delivered.
 *
 * So it *does* verify: the card is built once and morphs, the frame grows, the
 * scan runs only while the model is out, the two buttons send exactly the
 * messages background/index.ts listens for, and the glass and spring resolve.
 *
 * It does *not* verify: the real OpenRouter and Replicate round trips, the
 * context menu, or how the glass reads over a real page's imagery. Those need
 * Load unpacked and a human.
 */

import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const CDP_PORT = 9337
const HTTP_PORT = 9338
const PROFILE = '/tmp/fuongz-dialog-preview-profile'
const BUNDLE = new URL('../extension/dist/tools/pinterest-theme.js', import.meta.url).pathname
const STYLES = new URL('../extension/dist/tools/pinterest-theme.css', import.meta.url).pathname
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

// --- fixtures --------------------------------------------------------------

/*
 * Data URIs rather than files on the network, so a run is deterministic and
 * offline. Both carry an explicit width/height because the dialog reads
 * naturalWidth/naturalHeight to shape its frame — a sizeless SVG would leave
 * --fz-aspect at its default and quietly skip the thing being checked.
 */
function svgDataUri(width: number, height: number, body: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

const SOURCE_IMAGE = svgDataUri(
  1200,
  800,
  `<defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="1">
     <stop offset="0" stop-color="#7cc7ff"/><stop offset=".5" stop-color="#c9a6ff"/>
     <stop offset="1" stop-color="#ff9d7e"/></linearGradient></defs>
   <rect width="1200" height="800" fill="url(#s)"/>
   <circle cx="880" cy="220" r="130" fill="#fff8e7" opacity=".85"/>
   <path d="M0 620 L280 400 L520 620 L760 430 L1200 690 L1200 800 L0 800Z" fill="#2f3d52" opacity=".82"/>
   <path d="M0 700 L340 520 L700 720 L1200 560 L1200 800 L0 800Z" fill="#1b2534" opacity=".9"/>`,
)

const GENERATED_IMAGE = svgDataUri(
  1024,
  1024,
  `<defs><radialGradient id="g" cx=".4" cy=".35">
     <stop offset="0" stop-color="#ffe8a3"/><stop offset="1" stop-color="#b04a6a"/></radialGradient></defs>
   <rect width="1024" height="1024" fill="url(#g)"/>
   <circle cx="410" cy="360" r="190" fill="#fff" opacity=".55"/>
   <rect x="300" y="600" width="420" height="300" rx="28" fill="#2a1730" opacity=".7"/>`,
)

const PROMPT_TEXT =
  'A wide cinematic landscape at golden hour, layered ridgelines receding into pastel haze, ' +
  'a low sun blooming behind the third ridge. Shot on a 85mm lens at f/2.0, shallow depth of ' +
  'field, warm highlights against cool slate shadows. Soft volumetric light, fine film grain, ' +
  'muted teal and apricot palette, tranquil and expansive mood.'

/*
 * The host page. It is deliberately busy and colourful: a glass card over a
 * flat white page proves nothing, because backdrop-filter has nothing to
 * refract. The screenshots are the only way to judge the material.
 */
const HOST_PAGE = `<!doctype html><meta charset="utf-8"><title>dialog preview</title>
<style>
  body { margin:0; min-height:100vh; font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
         background:
           radial-gradient(60% 50% at 15% 20%, #ffd9a8 0%, transparent 60%),
           radial-gradient(50% 45% at 85% 15%, #a8d5ff 0%, transparent 60%),
           radial-gradient(70% 60% at 60% 90%, #d9b8ff 0%, transparent 65%),
           linear-gradient(160deg,#f6f7fb,#e6e9f2);
         color:#1a1f2b; }
  main { max-width:760px; padding:64px 48px; }
  h1 { font-size:44px; letter-spacing:-.03em; margin:0 0 18px; }
  p { max-width:56ch; color:#3c4557; }
  .tiles { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-top:36px; }
  .tile { height:150px; border-radius:20px; background:linear-gradient(140deg,#ff9d7e,#c9a6ff); }
  .tile:nth-child(2){ background:linear-gradient(140deg,#7cc7ff,#5f6bff); }
  .tile:nth-child(3){ background:linear-gradient(140deg,#ffd58a,#ff7e9d); }
  .shots { position:relative; display:flex; gap:20px; margin-top:28px; }
  #big { width:260px; height:260px; border-radius:18px; display:block; }
  #small { width:64px; height:64px; border-radius:12px; display:block; }
  /* Sites layer their own anchors over a photo; the trigger has to find the
     <img> underneath one, so the fixture reproduces that. */
  #cover { position:absolute; inset:0 0 0 0; width:260px; }
  /* A host stylesheet that reaches into the dialog. This is not hypothetical —
     it is what painted a white slab behind the prompt text on a real site. */
  p { background:#fff; }
</style>
<main>
  <h1>A page with something behind the glass</h1>
  <p>The dialog floats over this. Colour and edges underneath are what make the
     card read as a material rather than as a grey rectangle, so this page is
     part of the fixture.</p>
  <div class="tiles"><div class="tile"></div><div class="tile"></div><div class="tile"></div></div>
  <div class="shots">
    <img id="big" src="/photo.svg" alt="a big one">
    <img id="small" src="/photo.svg" alt="a small one">
    <a id="cover" href="https://example.test/should-not-navigate"></a>
  </div>
</main>`

/** Served at /photo.svg so the trigger sees an http(s) src, as it requires. */
const PHOTO = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <defs><linearGradient id="p" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#5f6bff"/><stop offset="1" stop-color="#ff7e9d"/></linearGradient></defs>
  <rect width="600" height="600" fill="url(#p)"/>
  <circle cx="300" cy="240" r="110" fill="#fff" opacity=".7"/>
</svg>`

/*
 * Stands in for everything the manifest would have provided. It captures the
 * listener the content bundle registers, so the driver below can deliver the
 * exact messages background/index.ts sends, and records outgoing sendMessage
 * calls so the two buttons can be checked against what the worker listens for.
 */
const CHROME_STUB = `
  (() => {
    window.__fzSent = [];
    window.__fzListeners = [];
    const noopEvent = { addListener() {} };
    window.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => window.__fzListeners.push(fn) },
        sendMessage: async (message) => { window.__fzSent.push(message); },
        openOptionsPage: async () => {},
      },
      storage: {
        sync: { get: async () => ({}), set: async () => {} },
        local: { get: async () => ({}), set: async () => {} },
        onChanged: noopEvent,
      },
    };
    // Headless has no clipboard permission; the copy button's success path
    // must still be reachable.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text) => { window.__fzClipboard = text; } },
    });
    window.__fzDeliver = (message) => {
      for (const fn of window.__fzListeners) fn(message);
    };
  })();
`

// --- the run ---------------------------------------------------------------

async function shoot(page: Cdp, name: string): Promise<void> {
  const shot = await page.send('Page.captureScreenshot', { format: 'png' })
  if (shot?.data) await writeFile(`${OUT_DIR}/dialog-${name}.png`, Buffer.from(shot.data, 'base64'))
}

async function main(browser: Cdp, bundle: string, styles: string) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
  const page = await Cdp.attach(`ws://127.0.0.1:${CDP_PORT}/devtools/page/${targetId}`)
  await page.send('Page.enable')
  await page.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/` })
  await sleep(900)

  // The three things the manifest delivers, in the order it delivers them.
  await page.evaluate(`
    (() => {
      const style = document.createElement('style');
      style.textContent = ${JSON.stringify(styles)};
      document.head.appendChild(style);
    })();
  `)
  await page.evaluate(CHROME_STUB)
  await page.evaluate(bundle)

  const listening = await page.evaluate<number>('window.__fzListeners.length')
  ok('content bundle registered its message listener', listening === 1, `${listening} listener(s)`)

  /* --- 1. confirm ---------------------------------------------------- */

  await page.evaluate(
    `window.__fzDeliver({ type: 'fz:prompt-dialog', imageUrl: ${JSON.stringify(SOURCE_IMAGE)} })`,
  )
  await sleep(900)

  const confirm = await page.evaluate<Record<string, unknown>>(`
    (() => {
      const overlay = document.getElementById('fz-prompt-overlay');
      const image = document.querySelector('.fz-stage-img');
      if (image) image.__fzMark = 'the-one-and-only';
      const card = document.querySelector('.fz-card');
      const stage = document.querySelector('.fz-stage');
      return {
        state: overlay?.dataset.state,
        overlays: document.querySelectorAll('#fz-prompt-overlay').length,
        stageWidth: Math.round(stage?.getBoundingClientRect().width ?? 0),
        headingText: overlay.textContent.includes('How was this made?'),
        accessibleName: overlay.getAttribute('aria-label'),
        backdrop: getComputedStyle(card).backdropFilter || getComputedStyle(card).webkitBackdropFilter,
        spring: getComputedStyle(overlay).getPropertyValue('--fz-spring').trim().slice(0, 7),
        aspect: getComputedStyle(overlay).getPropertyValue('--fz-aspect').trim(),
        scanOpacity: getComputedStyle(document.querySelector('.fz-scan')).opacity,
        modal: overlay?.getAttribute('aria-modal'),
        button: document.querySelector('.fz-btn')?.textContent,
        noConfirmHint: !overlay.textContent.includes('Analyze its subject, composition, lighting, style, and materials.'),
      };
    })()
  `)
  ok('opens in the confirm state', confirm['state'] === 'confirm', String(confirm['state']))
  ok('exactly one overlay exists', confirm['overlays'] === 1, `${confirm['overlays']}`)
  ok('frame opens full-width', Number(confirm['stageWidth']) > 300, `${confirm['stageWidth']}px`)
  // The heading is gone from the design but must survive as an accessible
  // name, or a screen reader announces an unlabelled dialog.
  ok('no visible heading', confirm['headingText'] === false)
  ok('still names itself to a screen reader', confirm['accessibleName'] === 'How was this made?', String(confirm['accessibleName']))
  ok('card is glass', String(confirm['backdrop']).includes('blur'), String(confirm['backdrop']))
  ok('spring resolved to a linear() easing', confirm['spring'] === 'linear(', String(confirm['spring']))
  ok('frame took the image aspect', confirm['aspect'] === '1200 / 800', String(confirm['aspect']))
  ok('nothing is scanning yet', Number(confirm['scanOpacity']) === 0, String(confirm['scanOpacity']))
  ok('does not claim modality', confirm['modal'] === null, String(confirm['modal']))
  ok('primary action is Analyze image', confirm['button'] === 'Analyze image', String(confirm['button']))
  ok('confirm state has no descriptive hint card', confirm['noConfirmHint'] === true)

  const dragged = await page.evaluate<Record<string, unknown>>(`
    (() => {
      const overlay = document.getElementById('fz-prompt-overlay');
      const handle = document.querySelector('.fz-drag-handle');
      const surface = document.querySelector('.fz-card');
      const before = overlay.getBoundingClientRect();
      const fire = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y,
      }));
      // On the handle, not on the card: the card is not a drag surface.
      const grip = handle.getBoundingClientRect();
      fire(handle, 'pointerdown', grip.left + grip.width / 2, grip.top + grip.height / 2);
      const dragOpacity = getComputedStyle(overlay).opacity;
      fire(window, 'pointermove', before.left - 1000, before.top + 1000);
      fire(window, 'pointerup', before.left - 1000, before.top + 1000);
      const after = overlay.getBoundingClientRect();
      window.dispatchEvent(new Event('resize'));
      const resized = overlay.getBoundingClientRect();
      return {
        hasHandle: !!handle,
        label: handle?.getAttribute('aria-label'),
        dragOpacity,
        releasedOpacity: getComputedStyle(overlay).opacity,
        moved: after.left !== before.left || after.top !== before.top,
        withinViewport: after.left >= 12 && after.top >= 12 && after.right <= innerWidth - 12 && after.bottom <= innerHeight - 12,
        staysClampedOnResize: resized.left >= 12 && resized.top >= 12 && resized.right <= innerWidth - 12 && resized.bottom <= innerHeight - 12,
        /*
         * It is centred by left: 50% plus a translate, and the translate is
         * one declaration away from ending up on the ::before that carries the
         * hit area — which is exactly what happened once. Nothing else here
         * notices an off-centre pill.
         */
        offCentre: Math.abs(
          (handle.getBoundingClientRect().left + handle.getBoundingClientRect().right) / 2 -
          (surface.getBoundingClientRect().left + surface.getBoundingClientRect().right) / 2,
        ),
        // Pressing the card itself must do nothing at all now.
        cardDrags: (() => {
          const at = overlay.getBoundingClientRect();
          fire(surface, 'pointerdown', at.left + at.width / 2, at.top + at.height - 4);
          const armed = overlay.dataset.dragging === '1';
          fire(window, 'pointermove', at.left + 40, at.top + 40);
          fire(window, 'pointerup', at.left + 40, at.top + 40);
          const now = overlay.getBoundingClientRect();
          return armed || now.left !== at.left || now.top !== at.top;
        })(),
      };
    })()
  `)
  ok('has a labelled drag handle', dragged['hasHandle'] === true && dragged['label'] === 'Drag dialog to move it')
  ok('dragging softens the dialog and release restores it', dragged['dragOpacity'] === '0.72' && dragged['releasedOpacity'] === '1')
  ok('dragging moves the dialog', dragged['moved'] === true)
  ok('dragging clamps the dialog inside the viewport', dragged['withinViewport'] === true)
  ok('the grip sits centred on the card', Number(dragged['offCentre']) < 1, `${Number(dragged['offCentre']).toFixed(1)}px off`)
  ok('the card itself is not a drag surface', dragged['cardDrags'] === false)

  /*
   * Real mouse input, not a dispatched event: the grip is 5px of drawn pill
   * with a much larger invisible hit area, and only the browser's own
   * hit-testing can tell whether a press 9px above the pill lands on it.
   * A dispatchEvent aimed at the handle reaches the handle by definition.
   */
  const grip = await page.evaluate<Record<string, number>>(
    `(() => { const r = document.querySelector('.fz-drag-handle').getBoundingClientRect();
              return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`,
  )
  const press = async (x: number, y: number): Promise<string> => {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    const armed = await page.evaluate<string>(
      `String(document.getElementById('fz-prompt-overlay').dataset.dragging)`,
    )
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    return armed
  }
  ok('a press on the pill takes hold', (await press(grip.x, grip.y)) === '1')
  ok('and so does one 9px above it', (await press(grip.x, grip.y - 9)) === '1')
  // Beyond the grip's reach is the picture, which is not a drag surface.
  ok('but one on the picture does not', (await press(grip.x, grip.y + 90)) === 'undefined')
  ok('resize keeps the dialog reachable', dragged['staysClampedOnResize'] === true)
  /*
   * The card is as wide as the picture needs. A 9:16 image in a fixed 452px
   * column could only obey `contain` by letterboxing ~90px down each side, so
   * the width is derived from the aspect — asserted by driving --fz-aspect
   * directly rather than by shipping a second fixture image.
   */
  const shapes = await page.evaluate<Record<string, unknown>>(`
    (() => {
      const overlay = document.getElementById('fz-prompt-overlay');
      const frame = document.querySelector('.fz-stage-source');
      // The card eases its width when the aspect lands late, so measuring the
      // frame in the same tick would read the value the transition started
      // from. This asserts the layout maths, not the easing.
      overlay.style.transition = 'none';
      const measure = (aspect) => {
        overlay.style.setProperty('--fz-aspect', aspect);
        const box = frame.getBoundingClientRect();
        return { w: Math.round(box.width), h: Math.round(box.height) };
      };
      const landscape = measure('1200 / 800');
      const portrait = measure('9 / 16');
      const pano = measure('32 / 9');
      overlay.style.setProperty('--fz-aspect', '1200 / 800');
      overlay.style.transition = '';
      return { landscape, portrait, pano, cap: window.innerHeight * 0.72 };
    })()
  `)
  const shape = (key: string) => shapes[key] as { w: number; h: number }
  ok(
    'a landscape picture keeps the full column',
    shape('landscape').w === 442,
    `${shape('landscape').w}px wide`,
  )
  // Tall: the frame fills the height cap and the card narrows to suit, so the
  // picture reaches both edges instead of sitting between grey bars.
  ok(
    'a tall picture narrows the whole dialog',
    shape('portrait').w < 442 &&
      Math.abs(shape('portrait').h - Number(shapes['cap'])) < 2,
    `${shape('portrait').w}x${shape('portrait').h}, cap ${Math.round(Number(shapes['cap']))}`,
  )
  /*
   * The one that matters: a frame whose ratio is off by even a few pixels puts
   * the grey bars straight back, because `contain` fills the difference.
   */
  ok(
    'and its frame is exactly 9:16, so nothing letterboxes',
    Math.abs(shape('portrait').w / shape('portrait').h - 9 / 16) < 0.005,
    `${(shape('portrait').w / shape('portrait').h).toFixed(4)} vs ${(9 / 16).toFixed(4)}`,
  )
  // A panorama's frame would be shorter than the strip standing on it.
  ok(
    'a panorama frame stays tall enough for the strip',
    shape('pano').h === 240,
    `${shape('pano').h}px tall`,
  )
  await shoot(page, '1-confirm')

  /* --- 2. analyzing --------------------------------------------------- */

  await page.evaluate(`document.querySelector('.fz-btn').click()`)
  await sleep(1100) // mid-sweep, so the scan is caught in motion

  const analyzing = await page.evaluate<Record<string, unknown>>(`
    (() => {
      const overlay = document.getElementById('fz-prompt-overlay');
      const stage = document.querySelector('.fz-stage');
      return {
        state: overlay?.dataset.state,
        sent: window.__fzSent.filter((m) => m.type === 'fz:analyze-image').length,
        sentUrlMatches: window.__fzSent.some((m) => m.imageUrl === ${JSON.stringify(SOURCE_IMAGE)}),
        stageWidth: Math.round(stage.getBoundingClientRect().width),
        busy: stage.dataset.busy,
        scanOpacity: getComputedStyle(document.querySelector('.fz-scan')).opacity,
        blurred: getComputedStyle(document.querySelector('.fz-stage-img')).filter,
        beamRunning: document.querySelector('.fz-scan-beam').getAnimations().length,
        sameImage: document.querySelector('.fz-stage-img').__fzMark,
        badgeOpacity: getComputedStyle(document.querySelector('.fz-stage-source .fz-stage-status')).opacity,
        badgeText: document.querySelector('.fz-stage-source .fz-stage-status b').textContent,
        badgeInsideFrame: (() => {
          const frame = document.querySelector('.fz-stage-source').getBoundingClientRect();
          const badge = document.querySelector('.fz-stage-source .fz-stage-status').getBoundingClientRect();
          return badge.top >= frame.top && badge.left >= frame.left && badge.right <= frame.right;
        })(),
      };
    })()
  `)
  ok('advances to analyzing', analyzing['state'] === 'analyzing', String(analyzing['state']))
  ok('Analyze sends exactly one request', analyzing['sent'] === 1, `${analyzing['sent']}`)
  ok('it sends the chosen image', analyzing['sentUrlMatches'] === true)
  ok('frame stays full while scanning', Number(analyzing['stageWidth']) > 300, `${analyzing['stageWidth']}px`)
  ok('the image is blurred', String(analyzing['blurred']).includes('blur'), String(analyzing['blurred']))
  ok('the scan is showing', Number(analyzing['scanOpacity']) === 1, String(analyzing['scanOpacity']))
  ok('the beam is sweeping', Number(analyzing['beamRunning']) > 0, `${analyzing['beamRunning']} animation(s)`)
  ok('image survived confirm → analyzing', analyzing['sameImage'] === 'the-one-and-only')
  // The status rides on the picture rather than under it, so it must actually
  // be inside the frame — a pill hanging off the corner is worse than no pill.
  ok('the status pill is on the image', Number(analyzing['badgeOpacity']) === 1, String(analyzing['badgeOpacity']))
  ok('it sits inside the frame', analyzing['badgeInsideFrame'] === true)
  ok('it names what is happening', String(analyzing['badgeText']).length > 8, String(analyzing['badgeText']))
  await shoot(page, '2-analyzing')

  /* --- 3. prompt ------------------------------------------------------ */

  await page.evaluate(
    `window.__fzDeliver({ type: 'fz:prompt-result', prompt: ${JSON.stringify(PROMPT_TEXT)} })`,
  )
  await sleep(900)

  const prompt = await page.evaluate<Record<string, unknown>>(`
    (() => {
      const overlay = document.getElementById('fz-prompt-overlay');
      return {
        state: overlay?.dataset.state,
        text: document.querySelector('.fz-prompt-text')?.textContent,
        eyebrow: document.querySelector('.fz-eyebrow')?.textContent,
        busy: document.querySelector('.fz-stage').dataset.busy,
        scanOpacity: getComputedStyle(document.querySelector('.fz-scan')).opacity,
        blurred: getComputedStyle(document.querySelector('.fz-stage-img')).filter,
        buttons: [...document.querySelectorAll('.fz-btn')].map((b) => b.textContent),
        sameImage: document.querySelector('.fz-stage-img').__fzMark,
        promptBg: getComputedStyle(document.querySelector('.fz-prompt-text')).backgroundColor,
        promptResize: getComputedStyle(document.querySelector('.fz-prompt-text')).resize,
        copyBlur: getComputedStyle(document.querySelector('.fz-btn-copy')).backdropFilter,
        heroFit: getComputedStyle(document.querySelector('.fz-stage-source .fz-stage-img')).objectFit,
        promptFont: getComputedStyle(document.querySelector('.fz-prompt-text')).fontFamily,
        isFixedWidth: (() => {
          const css = getComputedStyle(document.querySelector('.fz-prompt-text'));
          const canvas = document.createElement('canvas').getContext('2d');
          canvas.font = css.fontSize + ' ' + css.fontFamily;
          // A proportional face renders these at very different widths.
          return canvas.measureText('iiiii').width === canvas.measureText('MMMMM').width;
        })(),
        // Inside the picture the box is 4.5 lines rather than the 7.5 it was
        // below it: a scroll box that fills the frame stops the picture being
        // the subject. The half line still says there is more.
        lineBox: (() => {
          const css = getComputedStyle(document.querySelector('.fz-prompt-text'));
          return Math.round(parseFloat(css.maxHeight) / parseFloat(css.lineHeight) * 10) / 10;
        })(),
        // Copy01Icon is two paths in a 24 viewBox; the hand-drawn one it replaced
        // was a single path in 14. Cheapest way to catch a silent revert.
        copyIconPaths: document.querySelectorAll('.fz-btn-copy svg path').length,
        copyIconBox: document.querySelector('.fz-btn-copy svg')?.getAttribute('viewBox'),
        sheetBorder: getComputedStyle(document.querySelector('.fz-hero-sheet')).borderTopWidth,
        sheetBg: getComputedStyle(document.querySelector('.fz-hero-sheet')).backgroundImage,
        // The prompt reads on the picture now, so it has to BE on the picture.
        promptOnImage: !!document.querySelector('.fz-stage-source .fz-hero .fz-prompt-text'),
        promptColor: getComputedStyle(document.querySelector('.fz-prompt-text')).color,
        // The scrim is what makes white text legible over an unknown photo.
        scrim: getComputedStyle(document.querySelector('.fz-hero'), '::before').backgroundImage,
        panelEmpty: document.querySelector('.fz-panel').children.length,
      };
    })()
  `)
  ok('advances to prompt', prompt['state'] === 'prompt', String(prompt['state']))
  ok('shows the prompt it was given', prompt['text'] === PROMPT_TEXT)
  ok('labels it PROMPT', prompt['eyebrow'] === 'Prompt', String(prompt['eyebrow']))
  ok('the scan stopped', Number(prompt['scanOpacity']) === 0, String(prompt['scanOpacity']))
  ok('the image is sharp again', prompt['blurred'] === 'none', String(prompt['blurred']))
  ok(
    'offers Copy, collapse and Generate image',
    JSON.stringify(prompt['buttons']) === JSON.stringify(['Copy', '', 'Generate image']),
    JSON.stringify(prompt['buttons']),
  )
  ok('image survived analyzing → prompt', prompt['sameImage'] === 'the-one-and-only')
  /*
   * The host page in this fixture ships `p { background:#fff }` on purpose.
   * The dialog lives in the page's DOM, so that rule reaches the prompt — it
   * is what put a white slab behind the text on a real site, and these three
   * are the properties that had to be taken back.
   */
  ok(
    'host CSS does not paint the prompt white',
    prompt['promptBg'] !== 'rgb(255, 255, 255)',
    String(prompt['promptBg']),
  )
  ok('the prompt is not resizable', prompt['promptResize'] === 'none', String(prompt['promptResize']))
  ok('the copy chip is glass', String(prompt['copyBlur']).includes('blur'), String(prompt['copyBlur']))
  ok('the hero shows the whole image', prompt['heroFit'] === 'contain', String(prompt['heroFit']))
  // Measured, not matched: naming a mono family proves nothing if the face
  // does not resolve. Equal widths for 'iiiii' and 'MMMMM' means it did.
  ok('the prompt renders fixed-width', prompt['isFixedWidth'] === true, String(prompt['promptFont']))
  // The half line is the scroll affordance — a clean edge at the last line
  // reads as the end of the text.
  ok('it is exactly 4.5 lines tall', prompt['lineBox'] === 4.5, `${prompt['lineBox']} lines`)
  ok('the copy button draws Copy01Icon', prompt['copyIconPaths'] === 2 && prompt['copyIconBox'] === '0 0 24 24', `${prompt['copyIconPaths']} paths in ${prompt['copyIconBox']}`)
  ok('the prompt sheet has no frame', prompt['sheetBorder'] === '0px', String(prompt['sheetBorder']))
  ok('the prompt sheet has no fill', prompt['sheetBg'] === 'none', String(prompt['sheetBg']))
  ok('the prompt reads on the picture', prompt['promptOnImage'] === true)
  ok('and reads light on it', prompt['promptColor'] === 'rgb(255, 255, 255)', String(prompt['promptColor']))
  ok('over a scrim, not bare', String(prompt['scrim']).includes('gradient'), String(prompt['scrim']))
  ok('nothing is left below the picture', prompt['panelEmpty'] === 0, `${prompt['panelEmpty']} child(ren)`)
  await shoot(page, '3-prompt')

  /* --- prompt minimized into its orb, then restored ---------------- */

  await page.evaluate(`document.querySelector('.fz-minimize').click()`)
  await sleep(450)
  const minimized = await page.evaluate<Record<string, unknown>>(`
    (() => {
      const overlay = document.getElementById('fz-prompt-overlay');
      const orb = document.querySelector('.fz-orb');
      const before = overlay.getBoundingClientRect();
      const fire = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerId: 8, pointerType: 'mouse', button: 0, clientX: x, clientY: y,
      }));
      fire(orb, 'pointerdown', before.left + 20, before.top + 20);
      fire(window, 'pointermove', before.left - 600, before.top + 700);
      fire(window, 'pointerup', before.left - 600, before.top + 700);
      const after = overlay.getBoundingClientRect();
      return {
        minimized: overlay.dataset.minimized,
        restoreLabel: orb.getAttribute('aria-label'),
        closeVisible: getComputedStyle(document.querySelector('.fz-orb-close')).pointerEvents,
        moved: after.left !== before.left || after.top !== before.top,
        clamped: after.left >= 12 && after.top >= 12 && after.right <= innerWidth - 12 && after.bottom <= innerHeight - 12,
      };
    })()
  `)
  ok('minimize turns the dialog into an orb', minimized['minimized'] === '1')
  ok('orb names its restore action', minimized['restoreLabel'] === 'Restore image analysis dialog')
  ok('orb reveals its close button on focus', minimized['closeVisible'] === 'auto')
  ok('orb can move without restoring', minimized['moved'] === true && minimized['minimized'] === '1')
  ok('orb remains inside the viewport', minimized['clamped'] === true)

  await page.evaluate(`document.querySelector('.fz-orb').click(); document.querySelector('.fz-orb').click()`)
  await sleep(450)
  const restored = await page.evaluate<Record<string, unknown>>(`
    (() => {
      const overlay = document.getElementById('fz-prompt-overlay');
      return {
        minimized: overlay.dataset.minimized,
        state: overlay.dataset.state,
        prompt: document.querySelector('.fz-prompt-text')?.textContent,
      };
    })()
  `)
  ok('orb click restores the dialog', restored['minimized'] === undefined)
  ok('restore keeps the prior prompt state', restored['state'] === 'prompt' && restored['prompt'] === PROMPT_TEXT)

  // The copy control is the one thing on this panel with a side effect.
  await page.evaluate(`document.querySelector('.fz-btn-copy').click()`)
  await sleep(350)
  const copied = await page.evaluate<Record<string, unknown>>(`
    ({ clipboard: window.__fzClipboard,
       label: document.querySelector('.fz-btn-copy').textContent })
  `)
  ok('Copy writes the prompt to the clipboard', copied['clipboard'] === PROMPT_TEXT)
  ok('Copy confirms itself', String(copied['label']).includes('Copied'), String(copied['label']))

  /*
   * Collapse and back. The strip is over the picture, so the whole point of
   * collapsing is that the picture is briefly uncovered — hence the two
   * assertions about what is left, not just about what the buttons say.
   */
  await page.evaluate(`document.querySelector('.fz-btn-collapse').click()`)
  await sleep(250)
  const away = await page.evaluate<Record<string, unknown>>(`
    (() => {
      const hero = document.querySelector('.fz-stage-source .fz-hero');
      return {
        mode: hero.dataset.prompt,
        buttons: [...hero.querySelectorAll('.fz-btn')].map((b) => b.textContent),
        text: !!hero.querySelector('.fz-prompt-text'),
        // Collapsed, the strip is one button tall — the scrim should have
        // followed it down rather than staying over half the picture.
        share: hero.getBoundingClientRect().height /
               document.querySelector('.fz-stage-source').getBoundingClientRect().height,
      };
    })()
  `)
  ok('collapsing leaves one button', JSON.stringify(away['buttons']) === JSON.stringify(['See prompt']), JSON.stringify(away['buttons']))
  ok('and takes the prompt off the picture', away['text'] === false)
  ok('it says which shape it is in', away['mode'] === 'collapsed', String(away['mode']))
  ok('the strip shrank with it', Number(away['share']) < 0.3, `${Math.round(Number(away['share']) * 100)}% of the frame`)
  await shoot(page, '3b-prompt-collapsed')

  await page.evaluate(
    `[...document.querySelectorAll('.fz-btn')].find((b) => b.textContent === 'See prompt').click()`,
  )
  await sleep(250)
  const back = await page.evaluate<Record<string, unknown>>(`
    (() => {
      const hero = document.querySelector('.fz-stage-source .fz-hero');
      return { mode: hero.dataset.prompt, text: hero.querySelector('.fz-prompt-text')?.textContent };
    })()
  `)
  ok('See prompt brings it back', back['mode'] === 'expanded' && back['text'] === PROMPT_TEXT, String(back['mode']))

  /* --- 4. generating -------------------------------------------------- */

  await page.evaluate(
    `[...document.querySelectorAll('.fz-btn')].find((b) => b.textContent === 'Generate image').click()`,
  )
  await sleep(1100)

  const generating = await page.evaluate<Record<string, unknown>>(`
    (() => {
      const overlay = document.getElementById('fz-prompt-overlay');
      const tile = document.querySelector('.fz-stage-result');
      return {
        state: overlay?.dataset.state,
        sent: window.__fzSent.filter((m) => m.type === 'fz:generate-image').length,
        sentPrompt: window.__fzSent.find((m) => m.type === 'fz:generate-image')?.prompt,
        tileExists: !!tile,
        tileBusy: tile?.dataset.busy,
        tileBox: tile ? Math.round(tile.getBoundingClientRect().width) + 'x' + Math.round(tile.getBoundingClientRect().height) : 'none',
        tileAspectComputed: tile ? getComputedStyle(tile).aspectRatio : 'none',
        tileFlex: tile ? getComputedStyle(tile).flexShrink + '/' + getComputedStyle(tile).minHeight : 'none',
        tileSquare: tile ? Math.abs(tile.getBoundingClientRect().width - tile.getBoundingClientRect().height) < 2 : false,
        tileScanning: tile ? getComputedStyle(tile.querySelector('.fz-scan')).opacity : '0',
        tileBadge: tile?.querySelector('.fz-stage-status b')?.textContent,
        tileBadgeShown: tile ? getComputedStyle(tile.querySelector('.fz-stage-status')).opacity : '0',
        sourceBadgeHidden: getComputedStyle(document.querySelector('.fz-stage-source .fz-stage-status')).opacity,
        sameImage: document.querySelector('.fz-stage-img').__fzMark,
      };
    })()
  `)
  ok('advances to generating', generating['state'] === 'generating', String(generating['state']))
  ok('Generate sends exactly one request', generating['sent'] === 1, `${generating['sent']}`)
  ok('it sends the prompt that was shown', generating['sentPrompt'] === PROMPT_TEXT)
  ok('a new tile appeared for the result', generating['tileExists'] === true)
  /*
   * Shape, not measured box: the hero rule in §4 of the stylesheet would hand
   * this tile the *source* image's ratio, and the override that stops it is a
   * specificity tie-break. The rendered height is then clamped by max-height,
   * which is why this asserts the computed ratio rather than width === height.
   */
  ok(
    'the empty tile is square, not the source aspect',
    generating['tileAspectComputed'] === '1 / 1',
    `${generating['tileBox']} aspect=${generating['tileAspectComputed']}`,
  )
  ok('the new tile runs the same scan', Number(generating['tileScanning']) === 1, String(generating['tileScanning']))
  ok('the new tile carries its own status pill', Number(generating['tileBadgeShown']) === 1, String(generating['tileBadge']))
  // Only one thing is working at a time; the source's pill must have stood down.
  ok('the source pill stood down', Number(generating['sourceBadgeHidden']) === 0, String(generating['sourceBadgeHidden']))
  ok('image survived prompt → generating', generating['sameImage'] === 'the-one-and-only')
  await shoot(page, '4-generating')

  /* --- 5. generated --------------------------------------------------- */

  await page.evaluate(
    `window.__fzDeliver({ type: 'fz:image-result', imageUrl: ${JSON.stringify(GENERATED_IMAGE)} })`,
  )
  await sleep(1100)

  const generated = await page.evaluate<Record<string, unknown>>(`
    (() => {
      const overlay = document.getElementById('fz-prompt-overlay');
      const tile = document.querySelector('.fz-stage-result');
      const result = document.querySelector('.fz-result-img');
      return {
        state: overlay?.dataset.state,
        overlays: document.querySelectorAll('#fz-prompt-overlay').length,
        hasResult: !!result,
        resultLoaded: result?.naturalWidth ?? 0,
        tileBusy: tile?.dataset.busy,
        tileScanning: tile ? getComputedStyle(tile.querySelector('.fz-scan')).opacity : '1',
        tileAspect: tile?.style.aspectRatio,
        link: document.querySelector('a.fz-btn')?.getAttribute('href') === ${JSON.stringify(GENERATED_IMAGE)},
        linkIsButton: !!document.querySelector('a.fz-btn.fz-btn-block'),
        doneText: document.querySelector('.fz-panel').textContent.includes('Done.'),
        sameImage: document.querySelector('.fz-stage-img').__fzMark,
        panels: document.querySelectorAll('.fz-panel').length,
        sourceWidth: Math.round(document.querySelector('.fz-stage-source').getBoundingClientRect().width),
        fitsViewport: document.querySelector('.fz-card').getBoundingClientRect().bottom <= window.innerHeight,
      };
    })()
  `)
  ok('advances to generated', generated['state'] === 'generated', String(generated['state']))
  ok('still exactly one overlay', generated['overlays'] === 1, `${generated['overlays']}`)
  ok('the generated image rendered', Number(generated['resultLoaded']) === 1024, `${generated['resultLoaded']}px wide`)
  ok('the tile stopped scanning', Number(generated['tileScanning']) === 0, String(generated['tileScanning']))
  ok('the tile took the result aspect', generated['tileAspect'] === '1024 / 1024', String(generated['tileAspect']))
  ok('the download link points at it', generated['link'] === true)
  ok('the download control is a button', generated['linkIsButton'] === true)
  ok('no "Done." label — the image is the notice', generated['doneText'] === false)
  ok('outgoing panels were cleaned up', generated['panels'] === 1, `${generated['panels']} panel(s)`)
  // The source demotes so the result can take the frame — and so the card,
  // which was running off the bottom of the screen before, still fits.
  ok('the source image demoted to a thumbnail', generated['sourceWidth'] === 66, `${generated['sourceWidth']}px`)
  ok('the card fits on screen', generated['fitsViewport'] === true)
  ok(
    'image survived every state — one card, not five',
    generated['sameImage'] === 'the-one-and-only',
  )
  await shoot(page, '5-generated')

  /*
   * The prompt outlives being the subject. Once the generated image has the
   * frame the prompt is three faded lines below it — but it is still the
   * artifact worth keeping, so it still opens and it still copies.
   */
  const recap = await page.evaluate<Record<string, unknown>>(`
    (() => {
      const block = document.querySelector('.fz-panel .fz-prompt-block');
      return {
        mode: block?.dataset.prompt,
        clamped: block?.querySelector('.fz-prompt-text')?.dataset.clamped,
        hasCopy: !!block?.querySelector('.fz-btn-copy'),
        lines: (() => {
          const css = getComputedStyle(block.querySelector('.fz-prompt-text'));
          return Math.round(parseFloat(css.maxHeight) / parseFloat(css.lineHeight) * 10) / 10;
        })(),
      };
    })()
  `)
  ok('the prompt is still there, clamped', recap['mode'] === 'collapsed' && recap['clamped'] === '1', String(recap['mode']))
  ok('and still copyable', recap['hasCopy'] === true)
  ok('clamped to three lines', recap['lines'] === 3, `${recap['lines']} lines`)

  await page.evaluate(
    `document.querySelector('.fz-panel .fz-prompt-block .fz-btn-collapse').click()`,
  )
  await sleep(800)
  const opened = await page.evaluate<Record<string, unknown>>(`
    (() => {
      const block = document.querySelector('.fz-panel .fz-prompt-block');
      const css = getComputedStyle(block.querySelector('.fz-prompt-text'));
      return {
        mode: block.dataset.prompt,
        clamped: block.querySelector('.fz-prompt-text').dataset.clamped,
        expanded: block.querySelector('.fz-btn-collapse').getAttribute('aria-expanded'),
        lines: Math.round(parseFloat(css.maxHeight) / parseFloat(css.lineHeight) * 10) / 10,
        scrollable: css.overflowY,
        text: block.querySelector('.fz-prompt-text').textContent,
        // Opening it grew the card, and the tile below moved with it.
        fitsViewport: document.querySelector('.fz-card').getBoundingClientRect().bottom <= window.innerHeight,
      };
    })()
  `)
  ok('opening it shows the whole prompt', opened['mode'] === 'expanded' && opened['clamped'] === undefined, String(opened['mode']))
  ok('as a 7.5-line scroll box', opened['lines'] === 7.5 && opened['scrollable'] === 'auto', `${opened['lines']} lines, overflow ${opened['scrollable']}`)
  ok('it is the prompt that was analyzed', opened['text'] === PROMPT_TEXT)
  ok('it says so to a screen reader', opened['expanded'] === 'true', String(opened['expanded']))
  ok('and the grown card still fits on screen', opened['fitsViewport'] === true)
  await shoot(page, '5b-generated-prompt-open')

  /* --- dark ------------------------------------------------------------ */

  await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'dark' }],
  })
  await sleep(400)
  const dark = await page.evaluate<string>(
    `getComputedStyle(document.querySelector('.fz-card')).backgroundColor`,
  )
  ok('dark scheme repaints the glass', dark.replace(/\s/g, '').startsWith('rgba(24,27,35'), dark)
  await shoot(page, '6-generated-dark')

  /* --- escape ---------------------------------------------------------- */

  await page.send('Emulation.setEmulatedMedia', { features: [] })
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(300)
  const closed = await page.evaluate<number>(`document.querySelectorAll('#fz-prompt-overlay').length`)
  ok('Escape closes the dialog', closed === 0, `${closed} left`)

  /* --- the quick trigger ----------------------------------------------- *
   *
   * The fixture puts an <a> over the big image, because that is the case that
   * decides the whole design: on a real feed the pointer is never over the
   * <img> itself, so reading event.target would find nothing and the button
   * would never appear.
   */

  const hover = async (selector: string) =>
    page.evaluate(`
      (() => {
        const node = document.querySelector('${selector}');
        const rect = node.getBoundingClientRect();
        const x = Math.round(rect.left + rect.width / 2);
        const y = Math.round(rect.top + rect.height / 2);
        node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }));
        return true;
      })()
    `)

  await hover('#cover')
  await sleep(350)

  const onBig = await page.evaluate<Record<string, unknown>>(`
    (() => {
      const trigger = document.getElementById('fz-quick-trigger');
      const image = document.querySelector('#big').getBoundingClientRect();
      const box = trigger.getBoundingClientRect();
      return {
        shown: trigger.dataset.shown,
        gradient: getComputedStyle(trigger).backgroundImage,
        // Parked inside the image's top-right corner.
        insideTop: Math.abs(box.top - image.top) < 20,
        insideRight: Math.abs(box.right - image.right) < 20,
        hasIcon: !!trigger.querySelector('svg path'),
      };
    })()
  `)
  ok('an overlaid link does not hide the image', onBig['shown'] === '1', `data-shown=${onBig['shown']}`)
  ok('the trigger keeps its lime gradient', String(onBig['gradient']).includes('linear-gradient'), String(onBig['gradient']))
  ok('it parks in the top-right of the image', onBig['insideTop'] === true && onBig['insideRight'] === true)
  ok('it draws the AI-image mark', onBig['hasIcon'] === true)
  await shoot(page, '7-quick-trigger')

  await hover('#small')
  await sleep(300)
  const onSmall = await page.evaluate<string>(
    `document.getElementById('fz-quick-trigger').dataset.shown`,
  )
  ok('furniture-sized images get no trigger', onSmall === '0', `data-shown=${onSmall}`)

  // Clicking must open the dialog and must NOT follow the link underneath.
  await hover('#cover')
  await sleep(300)
  await page.evaluate(`document.getElementById('fz-quick-trigger').click()`)
  await sleep(800)

  const afterClick = await page.evaluate<Record<string, unknown>>(`
    (() => {
      const overlay = document.getElementById('fz-prompt-overlay');
      return {
        opened: !!overlay,
        state: overlay?.dataset.state,
        src: document.querySelector('.fz-stage-img')?.getAttribute('src'),
        stayedPut: location.pathname === '/',
        triggerHidden: document.getElementById('fz-quick-trigger').dataset.shown,
      };
    })()
  `)
  ok('the trigger opens the dialog', afterClick['opened'] === true)
  ok('it opens on confirm, not mid-flow', afterClick['state'] === 'confirm', String(afterClick['state']))
  ok('it passes the image it was parked on', String(afterClick['src']).endsWith('/photo.svg'), String(afterClick['src']))
  ok('the click did not follow the link underneath', afterClick['stayedPut'] === true)
  ok('the trigger steps aside for the dialog', afterClick['triggerHidden'] === '0')
  await shoot(page, '8-quick-trigger-opened')

  await page.evaluate(`document.querySelector('.fz-minimize').click()`)
  await sleep(250)
  await page.evaluate(`document.querySelector('.fz-orb-close').click()`)
  await sleep(250)
  const orbClosed = await page.evaluate<number>(`document.querySelectorAll('#fz-prompt-overlay').length`)
  ok('the orb close control destroys the minimized dialog', orbClosed === 0, `${orbClosed} left`)

  await browser.send('Target.closeTarget', { targetId })
}

// --- run -------------------------------------------------------------------

const bundle = await readFile(BUNDLE, 'utf8')
const styles = await readFile(STYLES, 'utf8')

await rm(PROFILE, { recursive: true, force: true })
await mkdir(OUT_DIR, { recursive: true })

const server = Bun.serve({
  port: HTTP_PORT,
  fetch: (request) =>
    new URL(request.url).pathname === '/photo.svg'
      ? new Response(PHOTO, { headers: { 'content-type': 'image/svg+xml' } })
      : new Response(HOST_PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
})

const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--window-size=1400,1000',
  '--force-device-scale-factor=2',
  'about:blank',
])
chrome.on('error', (err) => {
  console.error(err)
  process.exit(1)
})

try {
  console.log('\nHow was this made? — dialog states')
  await main(await Cdp.attach(await waitForDevtools()), bundle, styles)
  console.log(
    failures === 0
      ? `\nAll checks passed. Screenshots in .preview/`
      : `\n${failures} check(s) failed. Screenshots in .preview/`,
  )
} finally {
  chrome.kill()
  server.stop(true)
}

process.exit(failures === 0 ? 0 : 1)
