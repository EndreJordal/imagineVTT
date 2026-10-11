import { HEARTBEAT_MS, openChannel } from '../shared/channel'
import { save } from '../shared/persist'
import { tableState, useGm } from './store'

const SAVE_DELAY_MS = 300
const FOG_SEND_MS = 120
const FOG_SAVE_MS = 1000
const CAMERA_SAVE_MS = 500
const FOG_STAMP_MS = 100

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
        channel.post({ type: 'fog', memory: useGm.getState().fogMemory })
        channel.post({ type: 'assets', images: useGm.getState().objectImages })
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
  let fogSaveTimer: number | undefined
  let fogSendTimer: number | undefined
  /** Fog memory is ~0.1–0.25MB: send it at most ~8 times a second, and the latest state last. */
  const sendFog = () => {
    if (fogSendTimer !== undefined) return
    fogSendTimer = window.setTimeout(() => {
      fogSendTimer = undefined
      channel.post({ type: 'fog', memory: useGm.getState().fogMemory })
    }, FOG_SEND_MS)
  }

  let cameraSaveTimer: number | undefined
  /**
   * Stamping fog memory is CPU work (line of sight over many cells). While something is
   * dragged, stamp at most every FOG_STAMP_MS: now, and once more when changes settle.
   * What's in sight right now is drawn separately, so only memory waits.
   */
  let stampTimer: number | undefined
  let stampPending = false
  const scheduleStamp = () => {
    if (stampTimer !== undefined) {
      stampPending = true
      return
    }
    useGm.getState().stampFog()
    stampTimer = window.setTimeout(function settle() {
      if (stampPending) {
        stampPending = false
        useGm.getState().stampFog()
        stampTimer = window.setTimeout(settle, FOG_STAMP_MS)
      } else {
        stampTimer = undefined
      }
    }, FOG_STAMP_MS)
  }

  const unsubscribe = useGm.subscribe((s, prev) => {
    // Anything that goes into a scene file counts as a change to save.
    const sceneChanged =
      s.scene !== prev.scene ||
      s.display.orientation !== prev.display.orientation ||
      s.mapImage !== prev.mapImage ||
      s.fogVersion !== prev.fogVersion
    if (sceneChanged && !s.unsaved) useGm.getState().markUnsaved()
    if (s.sceneName !== prev.sceneName || s.unsaved !== prev.unsaved) {
      void save('sceneName', { name: s.sceneName, unsaved: s.unsaved })
    }
    if (s.gmCamera !== prev.gmCamera) {
      clearTimeout(cameraSaveTimer)
    clearTimeout(stampTimer)
      cameraSaveTimer = window.setTimeout(() => void save('gmCamera', useGm.getState().gmCamera), CAMERA_SAVE_MS)
    }
    // Vision tokens moving (or the map under them) reveal more of the fog.
    if (s.scene.fog.enabled && s.scene !== prev.scene) scheduleStamp()
    if (s.fogVersion !== prev.fogVersion) {
      sendFog()
      clearTimeout(fogSaveTimer)
      fogSaveTimer = window.setTimeout(() => void save('fogMemory', useGm.getState().fogMemory), FOG_SAVE_MS)
    }
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
    if (s.objectImages !== prev.objectImages) {
      channel.post({ type: 'assets', images: s.objectImages })
      void save('objectImages', s.objectImages)
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
    clearTimeout(fogSaveTimer)
    clearTimeout(fogSendTimer)
    clearTimeout(cameraSaveTimer)
    channel.close()
  }
}
