/**
 * Names that tell things apart: "Torch 1", "Torch 2"; for assets the asset's name first, then
 * "Crate 2", "Crate 3".
 */

/** A name without its number: "Crate 3" → "Crate". */
export const baseName = (name: string) => name.replace(/\s+\d+$/, '')

/**
 * The next free name for `base` among `taken`: numbered from 1 ("Torch 1"), or with
 * `bareFirst`, the base itself first, then from 2 ("Crate", "Crate 2").
 */
export function nextName(base: string, taken: (string | undefined)[], bareFirst = false): string {
  let highest = 0
  let bare = false
  for (const name of taken) {
    if (!name) continue
    if (name === base) bare = true
    const m = name.startsWith(base + ' ') && /^\d+$/.test(name.slice(base.length + 1))
    if (m) highest = Math.max(highest, Number(name.slice(base.length + 1)))
  }
  if (bareFirst) return !bare && !highest ? base : `${base} ${Math.max(highest, 1) + 1}`
  return `${base} ${highest + 1}`
}
