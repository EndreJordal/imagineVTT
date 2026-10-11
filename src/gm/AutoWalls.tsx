import { useEffect, useRef, useState } from 'react'
import { useGm } from './store'
import type { WallDetectRequest, WallDetectResponse } from './wallDetect.worker'

type Status = { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; walls: number; doors: number } | { kind: 'error'; message: string }

/**
 * Finds walls and doors on the map (needs the map matched to the grid first: walls are
 * placed along its lines). Experimental: the result is a draft to tidy with the wall tools.
 */
export function AutoWalls() {
  const image = useGm((s) => s.mapImage)
  const hasMap = useGm((s) => !!s.scene.map)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const worker = useRef<Worker | null>(null)
  useEffect(() => () => worker.current?.terminate(), [])

  const run = () => {
    const { mapImage, scene } = useGm.getState()
    const map = scene.map
    if (!mapImage || !map) return
    const existing = scene.walls.length
    const replace =
      existing > 0 &&
      confirm(`Replace the ${existing} existing walls and doors? Cancel keeps them and adds the new ones.`)
    // The scene grid in the image's own pixels.
    const k = map.width / map.naturalWidth
    const grid = {
      period: scene.grid.size / k,
      phaseX: (scene.grid.offsetX - map.x) / k,
      phaseY: (scene.grid.offsetY - map.y) / k,
    }
    worker.current?.terminate()
    const w = new Worker(new URL('./wallDetect.worker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    setStatus({ kind: 'running' })
    w.onmessage = (e: MessageEvent<WallDetectResponse>) => {
      w.terminate()
      worker.current = null
      const res = e.data
      if (!res.ok) return setStatus({ kind: 'error', message: res.error })
      useGm.getState().addDetectedWalls(res.walls, replace)
      const doors = res.walls.filter((d) => d.door).length
      setStatus({ kind: 'done', walls: res.walls.length - doors, doors })
    }
    w.onerror = (e) => {
      w.terminate()
      setStatus({ kind: 'error', message: e.message })
    }
    w.postMessage({ image: mapImage, width: map.naturalWidth, height: map.naturalHeight, grid } satisfies WallDetectRequest)
  }

  if (!hasMap || !image) return null
  return (
    <>
      <button
        onClick={run}
        disabled={status.kind === 'running'}
        title="Find walls and doors on the map (experimental). Match the grid to the map first."
      >
        {status.kind === 'running' ? 'Finding walls…' : '✨ Auto walls (beta)'}
      </button>
      {status.kind === 'done' && (
        <p className="hint">
          Added {status.walls} walls and {status.doors} doors: a draft to tidy up. <kbd>Ctrl+Z</kbd> undoes it.
        </p>
      )}
      {status.kind === 'error' && <p className="hint">Couldn’t find walls: {status.message}</p>}
    </>
  )
}
