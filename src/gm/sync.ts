import { HEARTBEAT_MS, openChannel } from '../shared/channel'
import { activeAreas } from '../shared/hidden'
import { save } from '../shared/persist'
import { curtainImageMap, useCurtain } from './curtainStore'
import { tableHandout, useHandouts } from './handoutStore'
import { tableOrder } from './tableOrder'
import { levelFogMemory, levelImage, tableState, useGm, type SavedFloors } from './store'

const SAVE_DELAY_MS = 300
const FOG_SEND_MS = 120
const FOG_SAVE_MS = 1000
const CAMERA_SAVE_MS = 500
const FOG_STAMP_MS = 100

/** The map image and fog memory of the floor the table shows. */
const tableImage = (s: ReturnType<typeof useGm.getState>) => levelImage(s, s.tableLevelId)
const tableFog = (s: ReturnType<typeof useGm.getState>) => levelFogMemory(s, s.tableLevelId)

/** Broadcast GM state to the table window and persist it. Returns a stop function. */
export function startGmSync(): () => void {
  let lastSeen = 0
  const channel = openChannel((msg) => {
    if (msg.type === 'hello' || msg.type === 'screen') lastSeen = Date.now()
    switch (msg.type) {
      case 'hello':
        // The curtain first (pictures, then state): a table opening with it down never shows the map.
        channel.post({ type: 'curtain-images', images: curtainImageMap(useCurtain.getState().images) })
        channel.post({ type: 'curtain', state: useCurtain.getState().state })
        channel.post({ type: 'handout', handout: tableHandout(useHandouts.getState()) })
        useGm.getState().setTableScreen(msg.screen)
        channel.post({ type: 'state', state: tableState(useGm.getState()) })
        channel.post({ type: 'map', image: tableImage(useGm.getState()) })
        channel.post({ type: 'fog', memory: tableFog(useGm.getState()) })
        channel.post({ type: 'assets', images: useGm.getState().objectImages })
        sendOrder(useGm.getState(), true)
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
  let floorsSaveTimer: number | undefined
  let fogSaveTimer: number | undefined
  let fogSendTimer: number | undefined
  /** Fog memory is ~0.1–0.25MB: send it at most ~8 times a second, and the latest state last. */
  const sendFog = () => {
    if (fogSendTimer !== undefined) return
    fogSendTimer = window.setTimeout(() => {
      fogSendTimer = undefined
      channel.post({ type: 'fog', memory: tableFog(useGm.getState()) })
    }, FOG_SEND_MS)
  }

  /** The players' order of initiative: sent when what they'd see of it changes. */
  let lastOrder = ''
  const sendOrder = (s: ReturnType<typeof useGm.getState>, force = false) => {
    const strip = tableOrder(s)
    const json = JSON.stringify(strip)
    if (!force && json === lastOrder) return
    lastOrder = json
    channel.post({ type: 'order', strip })
  }

  let cameraSaveTimer: number | undefined
  /**
   * Stamping fog memory is CPU work (line of sight over many cells). While something is
   * dragged, stamp at most every FOG_STAMP_MS: now, and once more when changes settle.
   * What's in sight right now is drawn separately, so only memory waits.
   */
  let stampTimer: number | undefined
  let stampPending = false
  const look = () => {
    useGm.getState().revealSeen() // first: what's uncovered is then remembered
    useGm.getState().stampFog()
    useGm.getState().noticeObjects()
  }
  const scheduleStamp = () => {
    if (stampTimer !== undefined) {
      stampPending = true
      return
    }
    look()
    stampTimer = window.setTimeout(function settle() {
      if (stampPending) {
        stampPending = false
        look()
        stampTimer = window.setTimeout(settle, FOG_STAMP_MS)
      } else {
        stampTimer = undefined
      }
    }, FOG_STAMP_MS)
  }

  const unsubscribe = useGm.subscribe((s, prev) => {
    // Anything that goes into a scene file counts as a change to save.
    const floorsChanged =
      s.levels !== prev.levels ||
      s.levelId !== prev.levelId ||
      s.tableLevelId !== prev.tableLevelId ||
      s.levelImages !== prev.levelImages ||
      s.levelFog !== prev.levelFog
    // Looking at another floor isn't a change to the scene.
    const sceneChanged =
      s.display.orientation !== prev.display.orientation ||
      (s.levelId === prev.levelId &&
        (s.scene !== prev.scene || s.mapImage !== prev.mapImage || s.fogVersion !== prev.fogVersion || floorsChanged))
    // The linked fight is part of the scene: its progress is a change to save.
    const combatChanged = s.combat !== prev.combat
    if ((sceneChanged || combatChanged) && !s.unsaved) useGm.getState().markUnsaved()
    if (combatChanged) void save('combat', s.combat)
    if (s.sceneName !== prev.sceneName || s.unsaved !== prev.unsaved || s.sceneFile !== prev.sceneFile) {
      void save('sceneName', { name: s.sceneName, unsaved: s.unsaved, file: s.sceneFile })
    }
    if (s.gmCamera !== prev.gmCamera) {
      clearTimeout(cameraSaveTimer)
      cameraSaveTimer = window.setTimeout(() => void save('gmCamera', useGm.getState().gmCamera), CAMERA_SAVE_MS)
    }
    // A vision token walking into a hidden area reveals it (also on arriving on a floor).
    if (activeAreas(s.scene).length && s.levelId === s.tableLevelId) {
      if (s.tableLevelId !== prev.tableLevelId || s.levelId !== prev.levelId) useGm.getState().revealEntered(null)
      else if (s.scene.lights !== prev.scene.lights) useGm.getState().revealEntered(prev.scene.lights)
    }
    // Vision tokens moving (or the map under them) reveal more of the fog.
    const sightMatters = s.scene.fog.mode !== 'off' || activeAreas(s.scene).some((a) => a.revealWithVision)
    if (sightMatters && s.scene !== prev.scene) scheduleStamp()
    if (s.fogVersion !== prev.fogVersion || s.tableLevelId !== prev.tableLevelId) {
      sendFog()
      clearTimeout(fogSaveTimer)
      fogSaveTimer = window.setTimeout(() => void save('fogMemory', useGm.getState().fogMemory), FOG_SAVE_MS)
    }
    // Editing a floor the table doesn't show changes nothing there but the shared parts.
    const tableSceneChanged =
      s.levelId === s.tableLevelId || prev.levelId === prev.tableLevelId
        ? s.scene !== prev.scene
        : s.scene.view !== prev.scene.view ||
          s.scene.viewZoom !== prev.scene.viewZoom ||
          s.scene.squareMm !== prev.scene.squareMm ||
          s.scene.fog.safety !== prev.scene.fog.safety
    if (
      tableSceneChanged ||
      s.levels !== prev.levels ||
      s.tableLevelId !== prev.tableLevelId ||
      s.display !== prev.display ||
      s.calibrating !== prev.calibrating
    ) {
      channel.post({ type: 'state', state: tableState(useGm.getState()) })
    }
    if (floorsChanged) {
      clearTimeout(floorsSaveTimer)
      floorsSaveTimer = window.setTimeout(() => {
        const { levels, levelId, tableLevelId, levelImages, levelFog } = useGm.getState()
        void save('floors', { levels, levelId, tableLevelId, levelImages, levelFog } satisfies SavedFloors)
      }, SAVE_DELAY_MS)
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
    if (tableImage(s) !== tableImage(prev)) channel.post({ type: 'map', image: tableImage(s) })
    if (s.mapImage !== prev.mapImage) void save('mapImage', s.mapImage)
    if (s.soundClips !== prev.soundClips || s.masterVolume !== prev.masterVolume || s.audioOutput !== prev.audioOutput) {
      void save('sound', { clips: s.soundClips, master: s.masterVolume, output: s.audioOutput })
    }
    if (s.lastAlert && s.lastAlert !== prev.lastAlert) channel.post({ type: 'alert', at: s.lastAlert.at })
    if (s.measureDraft !== prev.measureDraft) channel.post({ type: 'measure', draft: s.measureDraft })
    if (s.measure !== prev.measure) void save('measure', s.measure)
    if (s.objectImages !== prev.objectImages) {
      channel.post({ type: 'assets', images: s.objectImages })
      void save('objectImages', s.objectImages)
    }
    sendOrder(s)
  })

  // The picture shown to the players: when it, or its turn, changes.
  const unsubscribeHandouts = useHandouts.subscribe((s, prev) => {
    const now = tableHandout(s)
    const before = tableHandout(prev)
    if (now?.id !== before?.id || now?.turn !== before?.turn || now?.image !== before?.image || now?.fill !== before?.fill) {
      channel.post({ type: 'handout', handout: now })
    }
  })

  // The curtain: pictures first, so the state finds them.
  const unsubscribeCurtain = useCurtain.subscribe((s, prev) => {
    if (s.images !== prev.images) channel.post({ type: 'curtain-images', images: curtainImageMap(s.images) })
    if (s.state !== prev.state) channel.post({ type: 'curtain', state: s.state })
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
    unsubscribeCurtain()
    unsubscribeHandouts()
    clearTimeout(saveTimer)
    clearTimeout(stampTimer)
    clearTimeout(fogSaveTimer)
    clearTimeout(fogSendTimer)
    clearTimeout(cameraSaveTimer)
    channel.close()
  }
}
