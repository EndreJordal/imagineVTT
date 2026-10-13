import { useEffect, useState } from 'react'
import { sceneFileName, type CombatLink, type CombatSave } from '../shared/combat'
import type { SceneFile } from '../shared/sceneFile'
import { askTrackerState, resumeInTracker, startInTracker } from './combatLink'
import { usePendingLink } from './linkStore'
import { createInFolder, openFromFolder, readFromFolder, saveToFolder } from './sceneFiles'
import { chooseScenesFolder, findScene, reconnectScenesFolder, useScenesFolder } from './scenesFolder'
import { useGm } from './store'

/**
 * The banner a combat link opens with: which scene the fight belongs to, and a click to open
 * (or create) it and start the fight in the tracker, or resume the fight saved in it.
 * Nothing is replaced until the GM clicks; unsaved changes can be saved first.
 */

/** What's known about the link's scene in the scenes folder. */
type Found =
  | { kind: 'looking' }
  | { kind: 'missing' }
  | { kind: 'current'; combat: CombatSave | null }
  | { kind: 'found'; scene: SceneFile; fileName: string; combat: CombatSave | null }

export function CombatBanner() {
  const link = usePendingLink((s) => s.link)
  const seq = usePendingLink((s) => s.seq)
  if (!link) return null
  // A new link starts the banner afresh.
  return <Banner key={seq} link={link} />
}

function Banner({ link }: { link: CombatLink }) {
  const folder = useScenesFolder()
  const sceneFile = useGm((s) => s.sceneFile)
  const sceneName = useGm((s) => s.sceneName)
  const unsaved = useGm((s) => s.unsaved)
  const [found, setFound] = useState<Found>({ kind: 'looking' })
  const [saveFirst, setSaveFirst] = useState(true)
  const [busy, setBusy] = useState(false)
  const name = link.encounter.name ?? 'the encounter'
  const target = link.scene
  const isCurrent = !!target && sceneFile === sceneFileName(target)

  // Look for the scene in the folder (and read it, to see if a fight is saved in it).
  useEffect(() => {
    if (!target || folder.status !== 'ready') return
    let live = true
    void (async () => {
      if (isCurrent) return live && setFound({ kind: 'current', combat: useGm.getState().combat })
      const file = await findScene(target)
      if (!live) return
      if (!file) return setFound({ kind: 'missing' })
      const scene = await readFromFolder(file)
      if (!live) return
      setFound(scene ? { kind: 'found', scene, fileName: file.name, combat: scene.combat ?? null } : { kind: 'missing' })
    })()
    return () => {
      live = false
    }
  }, [target, folder.status, isCurrent])

  const close = () => usePendingLink.setState({ link: null })
  const replacing = !!target && !isCurrent
  const canSave = folder.status === 'ready'
  const saved = found.kind === 'found' || found.kind === 'current' ? found.combat : null

  /** Save the open scene first, if asked and it has changes. */
  async function saveCurrent() {
    if (!replacing || !unsaved || !saveFirst || !canSave) return
    await saveToFolder(sceneName ?? 'Untitled scene')
  }

  /** Start the encounter: in its scene (opened or made), or in the open scene. */
  async function start(where: 'scene' | 'here', again = false) {
    const linkId = crypto.randomUUID()
    // The tracker window first, while this still counts as the click.
    startInTracker(linkId, link.encounter)
    setBusy(true)
    try {
      if (where === 'scene' && target) {
        await saveCurrent()
        if (found.kind === 'found') openFromFolder(found.scene, found.fileName)
        else if (found.kind === 'missing' && !(await createInFolder(target))) return
      }
      const gm = useGm.getState()
      if (again) gm.clearCombatTokens()
      gm.setCombat({
        linkId,
        encounter: name,
        payload: link.encounter,
        summary: null,
        snapshot: null,
        showOrder: true,
        edge: 'bottom',
        facing: 'out',
        both: false,
      })
      if (where === 'scene' && target) await saveToFolder(target, false)
      askTrackerState()
      close()
    } finally {
      setBusy(false)
    }
  }

  /** Resume the fight saved in the scene: the scene, then the tracker as it was. */
  async function resume(combat: CombatSave) {
    resumeInTracker(combat.linkId, combat.snapshot)
    setBusy(true)
    try {
      if (found.kind === 'found') {
        await saveCurrent()
        openFromFolder(found.scene, found.fileName)
      }
      askTrackerState()
      close()
    } finally {
      setBusy(false)
    }
  }

  const fight = saved?.summary
  return (
    <div className="combat-banner" role="dialog" aria-label="Combat link">
      <h2>⚔ {name}</h2>
      {target ? <p className="hint">Scene: “{target}”</p> : <p className="hint">This fight has no scene of its own.</p>}

      {target && folder.status === 'unsupported' && (
        <p className="hint">This browser can’t keep a scenes folder: the fight can only go into the open scene.</p>
      )}
      {target && folder.status === 'none' && (
        <>
          <p>Choose the folder where imagineVTT keeps its scenes (once; it’s remembered).</p>
          <button className="primary" onClick={() => void chooseScenesFolder()}>
            Choose scenes folder…
          </button>
        </>
      )}
      {target && folder.status === 'reconnect' && (
        <button className="primary" onClick={() => void reconnectScenesFolder()}>
          Allow the scenes folder “{folder.name}”
        </button>
      )}
      {target && folder.status === 'ready' && (
        <>
          {found.kind === 'looking' && <p className="hint">Looking for the scene in “{folder.name}”…</p>}
          {replacing && unsaved && (found.kind === 'found' || found.kind === 'missing') && (
            <label className="check">
              <input type="checkbox" checked={saveFirst} onChange={(e) => setSaveFirst(e.target.checked)} />
              Save “{sceneName ?? 'Untitled scene'}” first (it has unsaved changes)
            </label>
          )}
          {fight ? (
            <>
              <p>
                This scene has the fight saved: turn {fight.round}, {fight.combatants.filter((c) => !c.inactive).length} in
                the fight.
              </p>
              <div className="row">
                <button className="primary" disabled={busy} onClick={() => void resume(saved!)}>
                  Resume the fight
                </button>
                <button
                  disabled={busy}
                  title="Start the encounter afresh: its tokens are taken off the map"
                  onClick={() => void start('scene', true)}
                >
                  Start again
                </button>
              </div>
            </>
          ) : (
            (found.kind === 'found' || found.kind === 'current' || found.kind === 'missing') && (
              <button className="primary" disabled={busy} onClick={() => void start('scene')}>
                {found.kind === 'missing' ? 'Create the scene and start the fight' : 'Open the scene and start the fight'}
              </button>
            )
          )}
        </>
      )}

      <div className="row">
        {(!target || folder.status === 'unsupported' || !isCurrent) && (
          <button
            className={target && folder.status !== 'unsupported' ? '' : 'primary'}
            disabled={busy}
            title="The fight goes into the scene that's open now (replacing any fight linked to it)"
            onClick={() => void start('here')}
          >
            Start it in the open scene
          </button>
        )}
        <button disabled={busy} onClick={close}>
          Cancel
        </button>
      </div>
      <p className="hint">The tracker opens in its own window.</p>
    </div>
  )
}
