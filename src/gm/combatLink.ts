import type { CombatSummary } from '../shared/combat'
import { loadPortraits } from './combatTokens'
import { useGm } from './store'

/**
 * The connection to the V:tM combat tracker. imagineVTT opens it in a window named
 * "vtm-tracker"; both apps are served from the same address, so they talk over a
 * BroadcastChannel (which survives either of them reloading). The tracker's side is its
 * js/imagine-link.js. See docs/combat-link.md for the messages.
 */

const APP = 'imagine-combat'
const V = 1
/** The tracker's window name: opening it again finds the same window. */
const WINDOW = 'vtm-tracker'
/** Without a heartbeat for this long, the tracker counts as gone. */
const GONE_MS = 6000

/** The tracker: next to imagineVTT on GitHub Pages; served by the dev server locally. */
export const TRACKER_URL = new URL('/vtm-combat-tracker/', location.origin).href

type ToTracker =
  | { type: 'hello' | 'ping' }
  | { type: 'encounter'; linkId: string; payload: unknown }
  | { type: 'resume'; linkId: string; saved: unknown }

type FromTracker =
  | { type: 'hello' | 'beat'; linkId: string | null }
  | { type: 'state'; linkId: string; summary: CombatSummary; snapshot: unknown }

let channel: BroadcastChannel | null = null
/** Waits for the tracker to say hello: the fight to start or resume there. */
let pending: ToTracker | null = null

function post(msg: ToTracker) {
  channel?.postMessage({ app: APP, v: V, from: 'vtt', ...msg })
}

/** Whether the tracker has been heard from lately. */
export const trackerConnected = (seen: number) => Date.now() - seen < GONE_MS

/**
 * Open the tracker (or bring up the one already open) and, once it's there, start or resume
 * the fight in it. Call from a click: browsers only open windows on one.
 */
export function openTracker(then?: ToTracker): boolean {
  // An empty URL finds the window if it's open, without reloading it (and opens a blank one if not).
  const win = window.open('', WINDOW)
  if (!win) {
    useGm.getState().notify('The browser blocked the tracker window: allow pop-ups for imagineVTT.')
    if (then) pending = then
    return false
  }
  let open = false
  try {
    open = win.location.href !== 'about:blank'
  } catch {
    open = true // another page's address can't be read: something is there
  }
  if (open) {
    win.focus()
    if (then) post(then)
  } else {
    // A new window: the tracker says hello once it has loaded, and gets the fight then.
    if (then) pending = then
    win.location.href = TRACKER_URL
  }
  return true
}

/** Ask the tracker to report its fight now (after the scene took on the fight's link). */
export const askTrackerState = () => post({ type: 'hello' })

/** Start the encounter in the tracker (the linkId ties it to this scene). */
export const startInTracker = (linkId: string, payload: unknown) => openTracker({ type: 'encounter', linkId, payload })

/** Put the scene's saved fight back into the tracker. */
export const resumeInTracker = (linkId: string, saved: unknown) => openTracker({ type: 'resume', linkId, saved })

/** Listen to the tracker. Returns a stop function. */
export function startCombatLink(): () => void {
  if (!('BroadcastChannel' in window)) return () => {}
  channel = new BroadcastChannel(APP)
  channel.onmessage = (e: MessageEvent) => {
    const msg = e.data as ({ app?: string; from?: string } & FromTracker) | null
    if (!msg || msg.app !== APP || msg.from !== 'tracker') return
    const gm = useGm.getState()
    if (msg.type === 'state') {
      gm.receiveTrackerState(msg.linkId, msg.summary, msg.snapshot)
      gm.trackerHeard(msg.linkId)
      return
    }
    gm.trackerHeard(msg.linkId)
    // A tracker that has just loaded gets the fight waiting for it.
    if (pending && msg.type === 'hello') {
      post(pending)
      pending = null
    }
  }
  post({ type: 'hello' })
  // Now and then, so a tracker that opened on its own (or reloaded) finds us.
  const timer = window.setInterval(() => post({ type: 'ping' }), 2000)
  // Everyone's portraits, for the tokens and the players' order (also a fight opened with a scene).
  loadPortraits(useGm.getState().combat?.summary)
  const unsubscribe = useGm.subscribe((s, prev) => {
    if (s.combat?.summary !== prev.combat?.summary) loadPortraits(s.combat?.summary)
  })
  return () => {
    clearInterval(timer)
    unsubscribe()
    channel?.close()
    channel = null
  }
}
