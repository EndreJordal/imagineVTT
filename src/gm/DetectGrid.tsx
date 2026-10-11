import { mapNatural } from '../shared/geometry'
import { useEffect, useRef, useState } from 'react'
import { MIN_CONFIDENCE } from '../shared/gridDetect'
import type { MapInfo } from '../shared/types'
import type { DetectRequest, DetectResponse } from './gridDetect.worker'
import { useGm } from './store'
import { Icon } from './icons'

type Status =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'found'; cols: number; rows: number; period: number; confidence: number; previous: MapInfo }
  | { kind: 'none' }
  | { kind: 'error'; message: string }

/** Finds a grid drawn on the map image and scales/places the map to match the scene grid. */
export function DetectGrid() {
  const image = useGm((s) => s.mapImage)
  const [result, setResult] = useState<{ image: Blob; status: Status } | null>(null)
  const worker = useRef<Worker | null>(null)
  // A result belongs to the image it was made for; a new map makes it (and its undo) moot.
  const status: Status = result && result.image === image ? result.status : { kind: 'idle' }

  useEffect(() => () => worker.current?.terminate(), [])

  const detect = () => {
    const { mapImage, scene } = useGm.getState()
    if (!mapImage || !scene.map) return
    const previous = scene.map
    const setStatus = (status: Status) => setResult({ image: mapImage, status })
    worker.current?.terminate()
    const w = new Worker(new URL('./gridDetect.worker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    setStatus({ kind: 'running' })

    w.onmessage = (e: MessageEvent<DetectResponse>) => {
      w.terminate()
      worker.current = null
      const res = e.data
      if (!res.ok) return setStatus({ kind: 'error', message: res.error })
      const d = res.detection
      if (!d || d.confidence < MIN_CONFIDENCE) return setStatus({ kind: 'none' })
      useGm.getState().alignMapToGrid(d)
      setStatus({
        kind: 'found',
        cols: mapNatural(previous).width / d.period,
        rows: mapNatural(previous).height / d.period,
        period: d.period,
        confidence: d.confidence,
        previous,
      })
    }
    w.onerror = (e) => {
      w.terminate()
      setStatus({ kind: 'error', message: e.message })
    }
    const request: DetectRequest = {
      image: mapImage,
      width: previous.naturalWidth,
      height: previous.naturalHeight,
      turns: previous.turns ?? 0,
    }
    w.postMessage(request)
  }

  return (
    <>
      <button onClick={detect} disabled={status.kind === 'running'}>
        <Icon name="detect-grid" /> {status.kind === 'running' ? 'Detecting grid…' : 'Detect grid'}
      </button>
      {status.kind === 'found' && (
        <>
          <p className="hint">
            Found {formatCells(status.cols)} × {formatCells(status.rows)} squares (
            {status.period.toFixed(2)} px, confidence {Math.round(status.confidence)}). The map is
            scaled so its squares match yours, and locked to the grid.
          </p>
          <button
            onClick={() => {
              useGm.getState().restoreMap(status.previous)
              setResult(null)
            }}
          >
            Undo
          </button>
        </>
      )}
      {status.kind === 'none' && (
        <p className="hint">No grid found on this map. Scale it by hand with the corner handle.</p>
      )}
      {status.kind === 'error' && <p className="hint">Detection failed: {status.message}</p>}
    </>
  )
}

/** Whole numbers plainly; partial cells (cropped maps) with one decimal. */
function formatCells(n: number) {
  return Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1)
}
