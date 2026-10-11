import { useEffect, useState } from 'react'
import { useGm } from './store'

const SHOW_MS = 4000

/** A brief message over the GM's map (vision safety and the like), fading after a while. */
export function GmNotice() {
  const notice = useGm((s) => s.notice)
  const [hidden, setHidden] = useState<number | null>(null)
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setHidden(notice.id), SHOW_MS)
    return () => clearTimeout(timer)
  }, [notice])
  if (!notice || hidden === notice.id) return null
  // Keyed by id, so a repeat message restarts the animation.
  return (
    <div key={notice.id} className="gm-notice" role="status">
      {notice.text}
    </div>
  )
}
