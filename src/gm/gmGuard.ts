/**
 * One GM window at a time: two would fight over the saved scene and the table window. A new
 * GM window asks whether one is open already; if so it hands over a combat link it was
 * opened with, and stands down.
 */

const CHANNEL = 'imaginevtt-gm'

type Msg = { type: 'who' } | { type: 'here' } | { type: 'link'; hash: string }

/** Whether another GM window is open (it answers within `wait` ms). */
export function otherGmWindow(wait = 400): Promise<boolean> {
  if (!('BroadcastChannel' in window)) return Promise.resolve(false)
  return new Promise((resolve) => {
    const ch = new BroadcastChannel(CHANNEL)
    const done = (found: boolean) => {
      clearTimeout(timer)
      ch.close()
      resolve(found)
    }
    ch.onmessage = (e: MessageEvent<Msg>) => e.data?.type === 'here' && done(true)
    const timer = window.setTimeout(() => done(false), wait)
    ch.postMessage({ type: 'who' } satisfies Msg)
  })
}

/** Pass a combat link on to the GM window that's already open. */
export function handLinkOver(hash: string) {
  const ch = new BroadcastChannel(CHANNEL)
  ch.postMessage({ type: 'link', hash } satisfies Msg)
  ch.close()
}

/** Be the GM window: answer new ones, and take the combat links they pass on. */
export function serveAsGm(onLink: (hash: string) => void): () => void {
  if (!('BroadcastChannel' in window)) return () => {}
  const ch = new BroadcastChannel(CHANNEL)
  ch.onmessage = (e: MessageEvent<Msg>) => {
    if (e.data?.type === 'who') ch.postMessage({ type: 'here' } satisfies Msg)
    else if (e.data?.type === 'link') onLink(e.data.hash)
  }
  return () => ch.close()
}
