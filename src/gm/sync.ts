import { HEARTBEAT_MS, openChannel } from '../shared/channel'
import { save } from '../shared/persist'
import { tableState, useGm } from './store'

const SAVE_DELAY_MS = 300

/** Broadcast GM state to the table window and persist it. Returns a stop function. */
export function startGmSync(): () => void {
  let lastSeen = 0
  const channel = openChannel((msg) => {
    if (msg.type === 'hello' || msg.type === 'screen') lastSeen = Date.now()
    switch (msg.type) {
      case 'hello':
        useGm.getState().setTableScreen(msg.screen)
        channel.post({ type: 'state', state: tableState(useGm.getState()) })
        channel.post({ type: 'map', image: useGm.getState().mapImage })
        break
      case 'screen':
        useGm.getState().setTableScreen(msg.screen)
        break
      case 'bye':
        if (msg.from === 'table') useGm.getState().setTableDisconnected()
        break
    }
  })

  let saveTimer: number | undefined
  const unsubscribe = useGm.subscribe((s, prev) => {
    if (s.scene !== prev.scene || s.display !== prev.display || s.calibrating !== prev.calibrating) {
      channel.post({ type: 'state', state: tableState(s) })
    }
    if (s.scene !== prev.scene || s.display !== prev.display) {
      clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => {
        const { scene, display } = useGm.getState()
        void save('scene', scene)
        void save('display', display)
      }, SAVE_DELAY_MS)
    }
    if (s.tableScreen !== prev.tableScreen) void save('tableScreen', s.tableScreen)
    if (s.gmVision !== prev.gmVision) void save('gmVision', s.gmVision)
    if (s.mapImage !== prev.mapImage) {
      channel.post({ type: 'map', image: s.mapImage })
      void save('mapImage', s.mapImage)
    }
  })

  // Pick up a table window that was already open (e.g. after a GM reload).
  channel.post({ type: 'gm-hello' })

  // 'bye' isn't guaranteed when a tab closes, so also time out on missed heartbeats.
  const watchdog = window.setInterval(() => {
    if (useGm.getState().tableConnected && Date.now() - lastSeen > HEARTBEAT_MS * 2.5) {
      useGm.getState().setTableDisconnected()
    }
  }, 1000)

  const onUnload = () => channel.post({ type: 'bye', from: 'gm' })
  window.addEventListener('pagehide', onUnload)

  return () => {
    window.removeEventListener('pagehide', onUnload)
    clearInterval(watchdog)
    unsubscribe()
    clearTimeout(saveTimer)
    channel.close()
  }
}
