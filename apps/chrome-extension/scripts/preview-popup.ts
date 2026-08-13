/*
 * Renders the built popup in a real Chrome and drives it, so the dashboard can
 * be checked without clicking through Load unpacked by hand.
 *
 *   bun run build && bun run preview:popup      # screenshots to .preview/
 *
 * WHAT THIS DOES AND DOESN'T PROVE
 *
 * Chrome 137 disabled the --load-extension switch, so a headless Chrome cannot
 * load an unpacked extension. Instead this serves extension/dist/popup over
 * http (ES modules are blocked over file://) and injects a chrome.storage.sync
 * stand-in before the popup's script runs — same API surface, in-memory.
 *
 * So it *does* verify: the dashboard renders from the registry, the switches
 * and the detail view work, and both write the shape of state the content
 * scripts read back.
 *
 * It does *not* verify: manifest parsing, permissions, real cross-profile sync,
 * or that a content script reacts. Those need Load unpacked and a human.
 */

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const CDP_PORT = 9335
const HTTP_PORT = 9336
const PROFILE = '/tmp/fuongz-popup-preview-profile'
const POPUP_DIR = new URL('../extension/dist/popup', import.meta.url).pathname
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

/**
 * In-memory chrome.storage.sync and .local, installed before the popup's script
 * runs. Sync holds tool state; local holds the T1 tracker's schedule cache.
 */
const STORAGE_SHIM = `
  (() => {
    const store = {};
    const local = {};
    const listeners = [];
    globalThis.__store = store;
    globalThis.__local = local;

    const area = (backing) => ({
      async get(keys) {
        const wanted = Array.isArray(keys) ? keys
          : typeof keys === 'string' ? [keys] : Object.keys(backing);
        const out = {};
        for (const key of wanted) if (key in backing) out[key] = backing[key];
        return out;
      },
      async set(items) {
        Object.assign(backing, items);
      },
    });

    // sessionStorage, not localStorage: this has to survive the reload the
    // appearance check does, but NOT the profile in /tmp, which outlives the
    // run and would carry one run's tool state into the next one's assertions.
    Object.assign(store, JSON.parse(sessionStorage.getItem('__preview.sync') || '{}'));

    const sync = area(store);
    const persist = () => sessionStorage.setItem('__preview.sync', JSON.stringify(store));
    globalThis.chrome = {
      storage: {
        sync: {
          ...sync,
          async set(items) {
            const changes = {};
            for (const [key, value] of Object.entries(items)) {
              changes[key] = { oldValue: store[key], newValue: value };
            }
            await sync.set(items);
            persist();
            for (const fn of listeners) fn(changes, 'sync');
          },
        },
        local: area(local),
        onChanged: { addListener: (fn) => listeners.push(fn) },
      },
    };
  })();
`

/**
 * A stand-in for lolesports.com, so the panel can be driven without the real
 * API's live results moving under the assertions.
 *
 * The bracket fixture is EWC 2026 Group C, reproduced field for field from the
 * live response — including every `origin.structuralId`, which is what the
 * connector lines are drawn from. It is the case the feature was designed
 * against, so it is the case that gets checked.
 *
 * `__fetchMode` switches between a normal response, an outage, and an empty
 * schedule; `__fetchCalls` records the URLs so request budgets can be checked.
 */
const FETCH_SHIM = `
  (() => {
    const now = Date.now();
    const DAY = 86400000;
    const at = (offset) => new Date(now + offset).toISOString();
    const day = (offset) => new Date(now + offset).toISOString().slice(0, 10);
    const logo = (code) => 'http://static.lolesports.com/teams/' + code + '.png';

    /* --- schedule --- */

    const team = (code, wins) => ({
      name: code, code, image: logo(code),
      result: { outcome: null, gameWins: wins },
    });

    const event = (id, offset, state, league, slug, block, foe, mine, theirs) => ({
      id, type: 'match', startTime: at(offset), state,
      league: { name: league, slug },
      blockName: block,
      match: {
        id,
        strategy: { type: 'bestOf', count: 3 },
        teams: [team('T1', mine), team(foe, theirs)],
      },
    });

    const EVENTS = [
      event('m1', -6 * DAY, 'completed', 'LCK', 'lck', 'Week 11', 'DK', 2, 0),
      event('m2', -2 * DAY, 'completed', 'LCK', 'lck', 'Week 11', 'HLE', 1, 2),
      event('m3', -1800000, 'inProgress', 'LCK', 'lck', 'Week 12', 'KT', 1, 0),
      event('m4', 2 * DAY, 'unstarted', 'LCK', 'lck', 'Week 12', 'GEN', 0, 0),
      event('m5', 5 * DAY, 'unstarted', 'KeSPA Cup', 'kespa_cup', 'Knockouts', 'NS', 0, 0),
      event('m6', 8 * DAY, 'unstarted', 'LCK', 'lck', 'Week 13', 'DRX', 0, 0),
    ];

    /* --- reference data --- */

    const LEAGUES = { data: { leagues: [
      { id: '98767991310872058', slug: 'lck', name: 'LCK',
        image: 'http://static.lolesports.com/leagues/lck.png' },
      { id: '116929044967296666', slug: 'kespa_cup', name: 'KeSPA Cup',
        image: 'http://static.lolesports.com/leagues/kespa.png' },
    ] } };

    const tournamentsFor = (leagueId) => ({ data: { leagues: [ { tournaments: [
      { id: 't-' + leagueId, slug: 'split_2026',
        startDate: day(-30 * DAY), endDate: day(30 * DAY) },
    ] } ] } });

    /* --- standings: a group table, then EWC 2026 Group C --- */

    const seat = (code, wins, outcome, from, slot) => ({
      code, name: code, image: logo(code),
      result: { outcome, gameWins: wins },
      origin: from
        ? { type: 'match', structuralId: from, slot }
        : { type: 'seeding', slot: 1 },
    });
    const bout = (id, teams) => ({ id, structuralId: id, state: 'completed', teams });
    const round = (name, matches) => ({ name, slug: name, matches });
    const seed = (code, name, wins, losses) => ({
      code, name, image: logo(code), record: { wins, ties: 0, losses },
    });

    const STANDINGS = { data: { standings: [ { stages: [
      { name: 'Groups', slug: 'groups', sections: [ {
        name: 'Legend Group', type: 'group', columns: [], rankings: [
          { ordinal: 1, teams: [seed('DK', 'Dplus KIA', 2, 1)] },
          { ordinal: 2, teams: [seed('GEN', 'Gen.G', 2, 2), seed('T1', 'T1', 2, 2)] },
          { ordinal: 4, teams: [seed('HLE', 'Hanwha Life', 1, 3)] },
        ],
      } ] },
      { name: 'Group Stage', slug: 'group_stage', sections: [ {
        name: 'Group C', type: 'bracket', rankings: [], columns: [
          { cells: [ round('Upper Bracket - Semifinals', [
            bout('ub1', [seat('BLG', 1, 'win'), seat('MKOI', 0, 'loss')]),
            bout('ub2', [seat('GAM', 0, 'loss'), seat('T1', 1, 'win')]),
          ]) ] },
          { cells: [
            round('Finals', [
              bout('f1', [seat('T1', 0, 'loss', 'ub2', 1), seat('BLG', 1, 'win', 'ub1', 1)]),
            ]),
            round('Lower Bracket - Semifinals', [
              bout('lb1', [seat('GAM', 2, 'win', 'ub2', 2), seat('MKOI', 1, 'loss', 'ub1', 2)]),
            ]),
          ] },
          { cells: [ round('Lower Bracket - Finals', [
            bout('lb2', [seat('GAM', 0, 'loss', 'lb1', 1), seat('T1', 2, 'win', 'f1', 2)]),
          ]) ] },
        ],
      } ] },
    ] } ] } };

    /* --- the router --- */

    globalThis.__fetchCalls = [];
    globalThis.__fetchMode = 'ok';

    const json = (body) => new Response(JSON.stringify(body), {
      status: 200, headers: { 'content-type': 'application/json' },
    });

    globalThis.fetch = async (url) => {
      const href = String(url);
      globalThis.__fetchCalls.push(href);
      if (globalThis.__fetchMode === 'error') return new Response('', { status: 503 });

      if (href.includes('getLeagues')) return json(LEAGUES);
      if (href.includes('getTournamentsForLeague')) {
        return json(tournamentsFor(new URL(href).searchParams.get('leagueId')));
      }
      if (href.includes('getStandingsV3')) return json(STANDINGS);

      const events = globalThis.__fetchMode === 'empty' ? [] : EVENTS;
      return json({ data: { schedule: { events, pages: { older: 'o', newer: 'n' } } } });
    };
  })();
`

async function main(browser: Cdp) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
  const page = await Cdp.attach(`ws://127.0.0.1:${CDP_PORT}/devtools/page/${targetId}`)

  await page.send('Page.enable')
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: STORAGE_SHIM })
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: FETCH_SHIM })
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `globalThis.isBordered = (el) => {
      const s = getComputedStyle(el);
      return s.borderTopWidth !== '0px' && !s.borderTopColor.startsWith('rgba(0, 0, 0, 0');
    };
    /*
     * Whether an element carries a shadow you can SEE. Not the same as
     * boxShadow !== 'none': Tailwind v4 compiles \`shadow-none\` to four fully
     * transparent layers rather than the keyword, so a flat surface reads as
     * "rgba(0, 0, 0, 0) 0px 0px 0px 0px, …" and a keyword test calls it raised.
     */
    globalThis.isRaised = (el) => {
      const value = getComputedStyle(el).boxShadow;
      if (!value || value === 'none') return false;
      return (value.match(/rgba?\\([^)]*\\)/g) ?? []).some((color) => {
        const parts = color.replace(/^rgba?\\(|\\)$/g, '').split(',').map(Number);
        return parts.length < 4 || parts[3] !== 0;
      });
    };`,
  })
  await page.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/index.html` })
  await sleep(1200)

  console.log('\ndashboard')

  const cards = await page.evaluate<number>('document.querySelectorAll(".tool-card").length')
  ok('renders one card per registered tool', cards === 3, `${cards} card(s)`)

  const names = await page.evaluate<string>(
    '[...document.querySelectorAll(".menu-title")].map(n => n.textContent).join(",")'
  )
  ok(
    'cards name the tools',
    names === 'Pinterest Dark/Light,T1 Esports Tracker,Task Name Translator',
    names
  )

  const summary = await page.evaluate<string>('document.getElementById("summary").textContent')
  ok('header summarises active tools', summary === '1 of 3 tools active', JSON.stringify(summary))

  const defaultOn = await page.evaluate<boolean>(
    'document.querySelector(".tool-card").dataset.enabled === "true"'
  )
  ok('tool defaults to on', defaultOn)

  const trackerOff = await page.evaluate<boolean>(
    'document.querySelectorAll(".tool-card")[1].dataset.enabled === "false"'
  )
  ok('the tracker ships switched off', trackerOff)

  // The font is a bundled file, so a broken path fails silently into the
  // fallback stack — worth asserting it actually arrived.
  await page.evaluate('document.fonts.ready')
  const font = await page.evaluate<string>(
    `(() => {
       const loaded = document.fonts.check('600 14px Geist');
       const used = [...document.querySelectorAll('body, .menu-title, #summary, button')]
         .map(n => getComputedStyle(n).fontFamily.split(',')[0].replace(/"/g, ''));
       return (loaded ? 'loaded' : 'missing') + ':' + [...new Set(used)].join('|');
     })()`
  )
  ok('every element is set in Geist', font === 'loaded:Geist', font)

  // The dashboard uses a two-column grid of elevated cards. This stays scoped
  // to the dashboard so the detailed tool menus keep their divided-list shape.
  const elevated = await page.evaluate<string>(
    `(() => {
       const box = document.querySelector('#tool-list .menu');
       const rows = [...document.querySelectorAll('.tool-card')];
       const lifted = rows.filter(isRaised).length;
       return (isRaised(box) ? 'raised' : 'flat') +
              ' container, ' + rows.length + ' rows, ' + lifted + ' lifted';
     })()`
  )
  ok(
    'a flat grid holds elevated tool cards',
    elevated === 'flat container, 3 rows, 3 lifted',
    elevated
  )

  const columns = await page.evaluate<string>(
    `getComputedStyle(document.querySelector('#tool-list .tool-grid')).gridTemplateColumns`
  )
  ok('tool cards fill two dashboard columns', columns.split(' ').length === 2, columns)

  const outlined = await page.evaluate<number>(
    `[...document.querySelectorAll('#tool-list .menu')].filter(isBordered).length`
  )
  ok('and the container carries no visible border', outlined === 0, `${outlined} outlined`)

  const size = await page.evaluate<string>(
    `getComputedStyle(document.body).width + ' / ' +
     getComputedStyle(document.querySelector('.view')).maxHeight`
  )
  ok('the dashboard uses the shared popup dimensions', size === '780px / 530px', size)

  await screenshot(page, 'popup-dashboard')

  // --- the switch ---------------------------------------------------------

  await page.evaluate('document.querySelector(".switch-input").click()')
  await sleep(200)

  const offSummary = await page.evaluate<string>('document.getElementById("summary").textContent')
  ok('switching off updates the header', offSummary === '0 of 3 tools active', offSummary)

  const written = await page.evaluate<any>('globalThis.__store["fz.tools.v1"]')
  ok(
    'switching off persists enabled:false',
    written?.['pinterest-theme']?.enabled === false,
    JSON.stringify(written)
  )

  await page.evaluate('document.querySelector(".switch-input").click()')
  await sleep(200)
  await screenshot(page, 'popup-dashboard-off')

  // --- the detail view ----------------------------------------------------

  console.log('\ndetail view')

  // Pinterest follows the extension's appearance, while T1 and Task Name
  // Translator each expose controls in their detail views.
  const openable = await page.evaluate<string>(
    `[...document.querySelectorAll('.tool-card')]
       .map(c => c.querySelector('button.menu-open') ? 'open' : 'flat').join(',')`
  )
  ok('tools with controls are openable', openable === 'flat,open,open', openable)

  await page.evaluate('document.querySelector("button.menu-open").click()')
  await sleep(200)

  const detailShown = await page.evaluate<boolean>(
    '!document.getElementById("view-detail").hidden && document.getElementById("view-dashboard").hidden'
  )
  ok('opens the tool detail view', detailShown)

  const header = await page.evaluate<string>(
    `(() => {
       const bar = document.getElementById('back').parentElement;
       const style = getComputedStyle(bar);
       return style.display + '/' + style.justifyContent + '/' +
              (document.querySelector('#detail-switch .switch-input') ? 'switch' : 'none');
     })()`
  )
  ok('puts the switch opposite the way back', header === 'flex/space-between/switch', header)

  const noRow = await page.evaluate<number>(
    'document.querySelectorAll("#detail-body .row").length'
  )
  ok('and drops the labelled row it used to sit in', noRow === 0, `${noRow} row(s)`)

  const ownSettings = await page.evaluate<number>(
    'document.querySelectorAll("#detail-body .segment").length'
  )
  ok('and shows no appearance of its own', ownSettings === 0, `${ownSettings} control(s)`)

  await screenshot(page, 'popup-detail')

  await page.evaluate('document.getElementById("back").click()')
  await sleep(200)
  const backShown = await page.evaluate<boolean>(
    '!document.getElementById("view-dashboard").hidden && document.getElementById("view-detail").hidden'
  )
  ok('back returns to the dashboard', backShown)

  await page.evaluate(
    'document.querySelector(`[data-row-id="task-namer"] button.menu-open`).click()',
  )
  await sleep(200)

  const selectionPopup = await page.evaluate<string>(
    `(() => {
       const inputs = [...document.querySelectorAll('#detail-body input')];
       return inputs.length + '/' + inputs.find(input => input.value === 'on')?.checked;
     })()`,
  )
  ok('Task Name Translator defaults its selection popup to on', selectionPopup === '2/true', selectionPopup)

  await page.evaluate('document.querySelector(`#detail-body input[value="off"]`).click()')
  await sleep(200)
  const popupSetting = await page.evaluate<string>(
    'globalThis.__store["fz.tools.v1"]["task-namer"].settings["selection-popup"]',
  )
  ok('turning it off persists the selection-popup setting', popupSetting === 'off', popupSetting)

  await screenshot(page, 'popup-task-namer-detail')

  await page.evaluate('document.getElementById("back").click()')
  await sleep(200)

  // --- appearance ----------------------------------------------------------

  console.log('\nappearance')

  // A component brings its own surface; a styled mount point wraps it in a
  // second one, which is invisible in code and obvious on screen.
  const mounts = await page.evaluate<string>(
    `['appearance', 'tool-list', 'detail-switch']
       .map(id => {
         const el = document.getElementById(id);
         const s = getComputedStyle(el);
         const painted = s.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
                         s.borderTopWidth !== '0px' ||
                         s.boxShadow !== 'none' ||
                         s.paddingTop !== '0px';
         return id + (painted ? ':painted' : ':bare');
       }).join(' ')`
  )
  ok(
    'mount points draw nothing of their own',
    mounts === 'appearance:bare tool-list:bare detail-switch:bare',
    mounts
  )

  const roles = await page.evaluate<number>(
    'document.querySelectorAll("#appearance [role=radiogroup]").length'
  )
  ok('and nest exactly one radiogroup', roles === 1, `${roles} found`)

  const options = await page.evaluate<string>(
    '[...document.querySelectorAll("#appearance .segment span")].map(n => n.textContent).join(",")'
  )
  ok('offers three appearances', options === 'Auto,Dark,Light', options)

  // "system" is the absence of the attribute, not a value of it.
  const initial = await page.evaluate<string>(
    `document.documentElement.dataset.theme ?? '(none)'`
  )
  ok('defaults to system, stamping nothing', initial === '(none)', initial)

  const autoChecked = await page.evaluate<boolean>(
    `document.querySelector('[data-value="system"] input').checked`
  )
  ok('and preselects Auto', autoChecked)

  const lightBg = await page.evaluate<string>(
    `(() => {
       document.querySelector('[data-value="light"] input').click();
       return getComputedStyle(document.body).backgroundColor;
     })()`
  )
  const lightAttr = await page.evaluate<string>('document.documentElement.dataset.theme')
  ok('Light stamps data-theme and repaints', lightAttr === 'light', lightAttr)
  ok('…to the light background', lightBg === 'rgb(236, 236, 238)', lightBg)

  // Assert what is painted, not just what the DOM property says: a control
  // whose old choice stays lit passes a `.checked` check and still looks broken.
  // The wait is not padding — `transition-colors` runs 150ms, and reading the
  // computed style inside it returns the interpolated value, not the target.
  await sleep(400)
  const lit = await page.evaluate<string>(
    `[...document.querySelectorAll('#appearance label')]
       .filter(l => getComputedStyle(l).backgroundColor !== 'rgba(0, 0, 0, 0)')
       .map(l => l.dataset.value).join(',')`
  )
  ok('exactly the chosen segment is lit', lit === 'light', lit || '(none lit)')

  await screenshot(page, 'popup-light')

  const darkBg = await page.evaluate<string>(
    `(() => {
       document.querySelector('[data-value="dark"] input').click();
       return getComputedStyle(document.body).backgroundColor;
     })()`
  )
  ok('Dark repaints the other way', darkBg === 'rgb(11, 12, 15)', darkBg)

  await sleep(400)
  await screenshot(page, 'popup-dark')

  // The choice has to survive the popup closing, which is every time.
  await page.send('Page.reload')
  await sleep(1200)

  const afterReload = await page.evaluate<string>('document.documentElement.dataset.theme')
  ok('the choice survives a reload', afterReload === 'dark', afterReload)

  const synced = await page.evaluate<string>('globalThis.__store["fz.appearance.v1"]')
  ok('and is stored where a profile can sync it', synced === 'dark', JSON.stringify(synced))

  await page.evaluate(`document.querySelector('[data-value="system"] input').click()`)
  await sleep(150)
  const backToSystem = await page.evaluate<string>(
    `document.documentElement.dataset.theme ?? '(none)'`
  )
  ok('and System clears it again', backToSystem === '(none)', backToSystem)

  // --- the T1 tracker panel -----------------------------------------------

  console.log('\nT1 tracker panel')

  await page.evaluate('document.querySelector("button.menu-open").click()')
  await sleep(300)

  const offCopy = await page.evaluate<string>(
    'document.querySelector(".t1-placeholder")?.textContent'
  )
  ok("an off tool explains itself", offCopy === "Switch this on to load T1's schedule.", JSON.stringify(offCopy))

  const quietWhenOff = await page.evaluate<number>('globalThis.__fetchCalls.length')
  ok('an off tool makes no requests', quietWhenOff === 0, `${quietWhenOff} request(s)`)

  await page.evaluate('document.getElementById("detail-switch-t1-tracker").click()')
  await sleep(900)

  const sections = await page.evaluate<string>(
    '[...document.querySelectorAll(".t1-section-title")].map(n => n.textContent).join(",")'
  )
  ok(
    'leads with tournaments, then the fixtures',
    sections === 'Tournaments,Live now,Upcoming,Recent results',
    sections
  )

  const fixtures = await page.evaluate<number>('document.querySelectorAll(".t1-card").length')
  ok('renders every T1 fixture in the window', fixtures === 6, `${fixtures} card(s)`)

  // The card is two tiers: both sides and the score above, competition below.
  const sides = await page.evaluate<string>(
    '[...document.querySelectorAll(".t1-card")[1].querySelectorAll(".t1-side-code")].map(n => n.textContent).join(" v ")'
  )
  ok('a card names both sides in the API’s order', sides === 'T1 v GEN', sides)

  const foot = await page.evaluate<string>(
    '[...document.querySelectorAll(".t1-card")[1].querySelectorAll(".t1-card-comp, .t1-card-bo")].map(n => n.textContent).join(" | ")'
  )
  ok('a card names the competition and format', foot === 'LCK • Week 12 | BO3', foot)

  // The slot, not the <img>: these fixtures point at logo URLs that don't
  // resolve offline, and a logo that fails to load removes itself on purpose.
  // Whether real logos arrive is what the live spot-check is for.
  const badges = await page.evaluate<number>(
    'document.querySelectorAll(".t1-card .t1-league-badge").length'
  )
  ok('every card carries a league badge slot', badges === 6, `${badges} slot(s)`)

  const live = await page.evaluate<string>('document.querySelector(".t1-live")?.textContent')
  ok('flags a match in progress', live === 'LIVE', JSON.stringify(live))

  const scores = await page.evaluate<string>(
    `[...document.querySelectorAll('.t1-card[data-state="completed"]')].map(n =>
       n.dataset.result + ' ' + [...n.querySelectorAll('.t1-score-num')].map(s => s.textContent).join('-')).join(',')`
  )
  ok("scores a result from T1's side", scores === 'loss 1-2,win 2-0', scores)

  const dimmed = await page.evaluate<string>(
    `document.querySelector('.t1-card[data-result="loss"] .t1-score-num').dataset.outcome`
  )
  ok('marks the losing number so it can be dimmed', dimmed === 'loss', dimmed)

  // D3: six leagues in one request, and no second page once three upcoming
  // fixtures are already in hand.
  const calls = await page.evaluate<string[]>('globalThis.__fetchCalls')
  const schedules = calls.filter((c) => c.includes('getSchedule'))
  ok(
    'asks for every league T1 can appear in',
    schedules[0]?.match(/leagueId=[\d%2C,]+/)?.[0].split(/%2C|,/).length === 6,
    schedules[0]
  )
  ok('stops paging once it has enough fixtures', schedules.length === 1, `${schedules.length} request(s)`)
  ok(
    'asks for tournaments one league at a time',
    calls.filter((c) => c.includes('getTournamentsForLeague')).length === 2,
    calls.filter((c) => c.includes('getTournamentsForLeague')).join(' ')
  )
  ok(
    'does not fetch standings until asked',
    calls.every((c) => !c.includes('getStandings'))
  )

  const cached = await page.evaluate<boolean>(
    'Array.isArray(globalThis.__local["fz.t1.cache.v1"]?.value?.matches)'
  )
  ok('caches the list for the next open', cached)

  const matchCards = await page.evaluate<string>(
    `(() => {
       const cards = [...document.querySelectorAll('.t1-card')];
       const flat = cards.filter(c => getComputedStyle(c).boxShadow === 'none').length;
       // The live fixture keeps a red edge on purpose — it is a status marker,
       // not the structural hairline this design removed.
       const bordered = cards
         .filter(c => c.dataset.state !== 'inProgress')
         .filter(isBordered).length;
       return cards.length + ' cards, ' + flat + ' flat, ' + bordered + ' bordered';
     })()`
  )
  ok(
    'match cards stay raised and borderless',
    matchCards === '6 cards, 0 flat, 0 bordered',
    matchCards
  )

  // …while the Tournaments list is a menu, so its rows are flat and ruled.
  const tourneyRows = await page.evaluate<string>(
    `(() => {
       const rows = [...document.querySelectorAll('.t1-tourney')];
       const lifted = rows.filter(r => getComputedStyle(r).boxShadow !== 'none').length;
       const ruled = rows.filter(r => getComputedStyle(r).borderTopWidth !== '0px').length;
       return rows.length + ' rows, ' + lifted + ' lifted, ' + ruled + ' ruled';
     })()`
  )
  ok(
    'and the tournament list is a flat, ruled menu',
    tourneyRows === '2 rows, 0 lifted, 1 ruled',
    tourneyRows
  )

  await screenshot(page, 'popup-t1')

  // …and the same screen in the other palette, so a light-mode regression shows
  // up in .preview/ rather than only in someone's eyes.
  await page.evaluate(`document.querySelector('[data-value="dark"] input').click()`)
  await sleep(400)
  await screenshot(page, 'popup-t1-dark')
  await page.evaluate(`document.querySelector('[data-value="system"] input').click()`)
  await sleep(200)

  // --- the tournament view ------------------------------------------------

  console.log('\ntournament view')

  const tournaments = await page.evaluate<string>(
    '[...document.querySelectorAll(".t1-tourney .menu-title")].map(n => n.textContent).join(",")'
  )
  ok('lists the tournaments T1 is in', tournaments === 'LCK,KeSPA Cup', tournaments)

  const narrow = await page.evaluate<string>('getComputedStyle(document.body).width')
  ok('the schedule uses the shared popup width', narrow === '780px', narrow)

  await page.evaluate('document.querySelector(".t1-tourney .menu-open").click()')
  await sleep(900)

  const wide = await page.evaluate<string>(
    `getComputedStyle(document.body).width + ' / ' +
     getComputedStyle(document.querySelector('.view')).maxHeight`
  )
  ok('the tournament keeps the shared popup dimensions', wide === '780px / 530px', wide)

  const stages = await page.evaluate<string>(
    '[...document.querySelectorAll(".t1-stage-title")].map(n => n.textContent).join(",")'
  )
  ok('stacks every stage', stages === 'Groups,Group Stage', stages)

  // A round-robin section becomes a table...
  const table = await page.evaluate<string>(
    `[...document.querySelectorAll('.t1-table tbody tr')].map(r =>
       [...r.children].map(c => c.textContent.trim()).join(' ')).join(' | ')`
  )
  ok(
    'draws a round-robin section as a standings table',
    table === '1 Dplus KIA 2–1 | 2 Gen.G 2–2 |  T1 2–2 | 4 Hanwha Life 1–3',
    table
  )

  const marked = await page.evaluate<string>(
    `document.querySelector('.t1-table tr[data-t1="true"] .t1-team-name')?.textContent`
  )
  ok("marks T1's own row", marked === 'T1', JSON.stringify(marked))

  // ...and a knockout section becomes a bracket.
  const rounds = await page.evaluate<string>(
    '[...document.querySelectorAll(".t1-round-name")].map(n => n.textContent).join(" | ")'
  )
  ok(
    'draws a knockout section as named rounds',
    rounds === 'Upper Bracket - Semifinals | Finals | Lower Bracket - Semifinals | Lower Bracket - Finals',
    rounds
  )

  // D3a: the dense surfaces deliberately stay flat, separating by tone alone.
  const dense = await page.evaluate<string>(
    `(() => {
       const nodes = [...document.querySelectorAll('.t1-table, .t1-bout')];
       const raised = nodes.filter(n => getComputedStyle(n).boxShadow !== 'none').length;
       return nodes.length + ' surfaces, ' + raised + ' raised';
     })()`
  )
  ok('tables and bracket boxes stay flat', dense === '6 surfaces, 0 raised', dense)

  const bouts = await page.evaluate<number>('document.querySelectorAll(".t1-bout").length')
  ok('draws every match in the bracket', bouts === 5, `${bouts} bout(s)`)

  // Six teams arrive from an earlier match; the two seeded pairs do not.
  const lines = await page.evaluate<number>('document.querySelectorAll(".t1-line").length')
  ok('joins each match to the one it came from', lines === 6, `${lines} line(s)`)

  const elbows = await page.evaluate<boolean>(
    `[...document.querySelectorAll('.t1-line')].every(l => /^M[\\d.]+ [\\d.]+ H[\\d.]+ V[\\d.]+ H[\\d.]+$/.test(l.getAttribute('d')))`
  )
  ok('draws them as elbows between the box edges', elbows)

  const t1Lines = await page.evaluate<number>('document.querySelectorAll(".t1-line-t1").length')
  ok("highlights T1's own path through the bracket", t1Lines === 2, `${t1Lines} line(s)`)

  await screenshot(page, 'popup-t1-bracket')

  await page.evaluate('document.querySelector(".t1-back").click()')
  await sleep(700)

  // A fixture is the other way in: clicking the card opens the same screen.
  await page.evaluate('document.querySelector(".t1-card-open").click()')
  await sleep(900)

  const fromCard = await page.evaluate<string>(
    'document.querySelector(".t1-tourney-title h2")?.textContent'
  )
  ok('a match card opens its own tournament', fromCard === 'LCK', JSON.stringify(fromCard))

  await page.evaluate('document.querySelector(".t1-back").click()')
  await sleep(700)

  const backToSchedule = await page.evaluate<boolean>(
    'document.querySelectorAll(".t1-card").length === 6 && !document.querySelector(".t1-tournament")'
  )
  ok('back returns to the schedule', backToSchedule)

  const narrowAgain = await page.evaluate<string>('getComputedStyle(document.body).width')
  ok('and the popup keeps its shared width', narrowAgain === '780px', narrowAgain)

  // --- failure states -----------------------------------------------------

  console.log('\nfailure states')

  // A stale cache plus an outage keeps the list and admits it is old.
  await page.evaluate(
    'globalThis.__fetchMode = "error", globalThis.__local["fz.t1.cache.v1"].value.fetchedAt -= 11 * 60000'
  )
  await page.evaluate('document.getElementById("detail-switch-t1-tracker").click()')
  await sleep(200)
  await page.evaluate('document.getElementById("detail-switch-t1-tracker").click()')
  await sleep(700)

  const staleCards = await page.evaluate<number>('document.querySelectorAll(".t1-card").length')
  const warning = await page.evaluate<string>('document.querySelector(".t1-warn")?.textContent')
  ok('a failed refresh keeps the cached list', staleCards === 6, `${staleCards} card(s)`)
  ok("a failed refresh says so", warning === "Couldn't refresh just now.", JSON.stringify(warning))

  // With nothing cached, the same outage has to be a real error state.
  await page.evaluate('delete globalThis.__local["fz.t1.cache.v1"]')
  await page.evaluate('document.getElementById("detail-switch-t1-tracker").click()')
  await sleep(200)
  await page.evaluate('document.getElementById("detail-switch-t1-tracker").click()')
  await sleep(700)

  const errorCopy = await page.evaluate<string>(
    'document.querySelector(".t1-placeholder")?.textContent'
  )
  ok(
    'an outage with no cache shows an error',
    errorCopy === "Couldn't reach lolesports.com.",
    JSON.stringify(errorCopy)
  )

  await screenshot(page, 'popup-t1-error')

  await browser.send('Target.closeTarget', { targetId })
}

async function screenshot(page: Cdp, name: string) {
  const shot = await page.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  })
  if (shot?.data) await writeFile(`${OUT_DIR}/${name}.png`, Buffer.from(shot.data, 'base64'))
}

// --- run -------------------------------------------------------------------

await mkdir(OUT_DIR, { recursive: true })

const server = Bun.serve({
  port: HTTP_PORT,
  fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/favicon.ico') return new Response(null, { status: 404 })
    return new Response(Bun.file(`${POPUP_DIR}${path === '/' ? '/index.html' : path}`))
  },
})

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${PROFILE}`,
  // Wide enough for the popup Chrome actually draws. The window sizes itself to
  // the document, so at 780px the dashboard's two-column grid applies; the 380
  // this used to be predates the popup being widened, and left the grid under
  // its own `max-width: 560px` single-column fallback in every run.
  '--window-size=800,700',
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
