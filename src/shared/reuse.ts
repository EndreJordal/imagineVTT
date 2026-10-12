/**
 * `next`, with every part that equals the matching part of `prev` replaced by `prev`'s own
 * object. Messages between windows arrive as fresh copies, so without this every cache
 * keyed by identity (softened hidden areas, light maps, sight) misses on every message.
 * Returns `prev` itself when nothing changed.
 */
export function reuse<T>(prev: unknown, next: T): T {
  if (typeof next !== 'object' || next === null || prev === next) return next
  if (typeof prev !== 'object' || prev === null) return next
  if (Array.isArray(next)) {
    if (!Array.isArray(prev)) return next
    let same = prev.length === next.length
    const out = next.map((v, i) => {
      const r = reuse(prev[i], v)
      if (r !== prev[i]) same = false
      return r
    })
    return (same ? prev : out) as T
  }
  if (ArrayBuffer.isView(next)) return next // big buffers come in their own messages
  if (Array.isArray(prev) || ArrayBuffer.isView(prev)) return next
  const p = prev as Record<string, unknown>
  const n = next as Record<string, unknown>
  const keys = Object.keys(n)
  let same = keys.length === Object.keys(p).length
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    const r = reuse(p[k], n[k])
    if (r !== p[k]) same = false
    out[k] = r
  }
  return (same ? prev : out) as T
}
